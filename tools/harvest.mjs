#!/usr/bin/env node
// Deterministic, zero-token news harvest. Pulls headlines from public RSS/Atom feeds and
// keyless JSON APIs into one candidate pool, so the research stage can start from a list of
// leads instead of paying WebSearch calls across every beat.
//
//   node tools/harvest.mjs             # writes generated/candidates/<today>.json
//   node tools/harvest.mjs 2026-08-15  # label the output for a backfill date
//
// This script decides nothing and asserts nothing. Every item it writes is a lead, exactly
// as trustworthy as a search snippet — the pipeline still has to open it, read it, and find
// a real publisher before it can appear in an edition. See the story-research skill. A feed
// going dark or timing out is not a failure of this script; it just means fewer leads that
// day. The run only exits non-zero if every single feed fails, which is the signal that
// something structural broke rather than one publisher having a bad day.

import { writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isoDate } from './lib/util.mjs';
import { parseFeed } from './lib/feed.mjs';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const date = process.argv[2] || isoDate();
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(`✗ "${date}" is not a YYYY-MM-DD date`);
  process.exit(2);
}

const TIMEOUT_MS = 12000;
const UA = 'Mozilla/5.0 (compatible; THE-VISSION-harvest/1.0; +https://github.com/Jayaragul/THE_VISSION)';

// Direct feeds: general AI press, every lab that publishes one, and arXiv's own API for new
// papers. Verified reachable when this file was written — see the checks run alongside it.
// A URL going stale over time degrades this list gracefully (that feed just returns nothing)
// rather than breaking the run, so there is no urgency to keep this perfectly current.
const FEEDS = [
  { source: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
  { source: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
  { source: 'Ars Technica', url: 'https://arstechnica.com/feed/' },
  { source: 'WIRED', url: 'https://www.wired.com/feed/rss' },
  { source: 'VentureBeat', url: 'https://venturebeat.com/feed/' },
  // MarkTechPost removed 17 Aug 2026: returns 403 to any automated fetch, every run.
  // Left here as a note so nobody re-adds it without checking.
  { source: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/' },
  { source: 'IEEE Spectrum — AI', url: 'https://spectrum.ieee.org/feeds/topic/artificial-intelligence.rss' },
  // Section 91 is SCMP's general China/tech mix, not a tech-only feed — labelled for what
  // it actually contains. The Google News query below is the targeted mechanism for
  // Chinese-lab AI coverage specifically; this is broader background.
  { source: 'SCMP — China', url: 'https://www.scmp.com/rss/91/feed/' },
  { source: 'NVIDIA', url: 'https://blogs.nvidia.com/feed/' },
  { source: 'Google AI', url: 'https://blog.google/technology/ai/rss/' },
  { source: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml' },
  { source: 'OpenAI', url: 'https://openai.com/news/rss.xml' },
  { source: 'Hugging Face — blog', url: 'https://huggingface.co/blog/feed.xml' },
  // Added 18 Aug 2026: Amazon, Microsoft and Meta had no direct feed, so their AI coverage
  // depended entirely on general press picking it up — and classifyBeat's narrow vocabulary
  // (see tools/lib/classify.mjs) was separately dropping most of what did get harvested from
  // digest.mjs. Both fixed together; these close the harvest side.
  { source: 'Amazon Science', url: 'https://www.amazon.science/index.rss' },
  { source: 'AWS — Machine Learning', url: 'https://aws.amazon.com/blogs/machine-learning/feed/' },
  { source: 'Microsoft', url: 'https://blogs.microsoft.com/feed/' },
  { source: 'Meta Newsroom', url: 'https://about.fb.com/news/feed/' },
  { source: 'Meta Engineering', url: 'https://engineering.fb.com/feed/' },
  { source: 'arXiv — cs.AI', url: 'https://export.arxiv.org/api/query?search_query=cat:cs.AI&sortBy=submittedDate&sortOrder=descending&max_results=30' },
  { source: 'arXiv — cs.CL', url: 'https://export.arxiv.org/api/query?search_query=cat:cs.CL&sortBy=submittedDate&sortOrder=descending&max_results=20' },
  { source: 'arXiv — cs.MA', url: 'https://export.arxiv.org/api/query?search_query=cat:cs.MA&sortBy=submittedDate&sortOrder=descending&max_results=15' },
];

// No lab publishes a feed for "everything happening with Chinese models" in English, and
// several important sources (Anthropic among them) have no RSS at all. Rather than miss
// that coverage, run a handful of topic searches through Google News's RSS endpoint — no
// key, no scraping, just a search rendered as a feed. These are aggregator redirects, not
// publishers: every item from this block is marked discoveryOnly and must be opened to find
// the real underlying source before it can be cited. Treat it exactly like a WebSearch hit.
const TOPIC_SEARCHES = [
  'Gemini AI model Google DeepMind',
  '(Qwen OR DeepSeek OR "Kimi K" OR GLM OR MiniMax OR Baidu Ernie) AI model China',
  'Mistral AI model release',
  'Anthropic Claude announcement',
  '(Amazon OR AWS) (Nova OR Bedrock OR Trainium OR Rufus) AI',
  'AI startup funding round raised',
  'AI regulation OR "AI Act" OR AI policy government',
];

for (const q of TOPIC_SEARCHES) {
  FEEDS.push({
    source: 'Google News',
    discoveryOnly: true,
    url: `https://news.google.com/rss/search?q=${encodeURIComponent(`when:2d ${q}`)}&hl=en-US&gl=US&ceid=US:en`,
  });
}

async function fetchWithTimeout(url, accept) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': UA, accept } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// Some publishers (OpenAI's is the extreme case) put their entire multi-year archive in
// one feed rather than the usual recent-20. Sorting within the feed and capping keeps the
// candidate pool focused on actual leads and keeps the file small enough to read cheaply —
// which is the entire point of harvesting instead of searching.
const PER_FEED_CAP = 40;

async function harvestFeed(feed) {
  try {
    const res = await fetchWithTimeout(
      feed.url,
      'application/rss+xml, application/atom+xml, application/xml, text/xml'
    );
    const xml = await res.text();
    const items = parseFeed(xml)
      .sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''))
      .slice(0, PER_FEED_CAP)
      .map((item) => ({ source: feed.source, discoveryOnly: !!feed.discoveryOnly, ...item }));
    return { feed: feed.source, ok: true, count: items.length, items };
  } catch (err) {
    return { feed: feed.source, ok: false, count: 0, error: err.message, items: [] };
  }
}

// Hugging Face's model API needs no key and gives a clean trending-by-recent-likes signal —
// a real complement to the blog feeds, since most model releases show up here before any
// lab writes a post about them.
async function harvestHuggingFaceTrending() {
  const name = 'Hugging Face — trending models';
  try {
    const res = await fetchWithTimeout(
      'https://huggingface.co/api/models?sort=likes7d&direction=-1&limit=25',
      'application/json'
    );
    const rows = await res.json();
    const items = rows.map((m) => ({
      source: name,
      discoveryOnly: false,
      title: m.id,
      url: `https://huggingface.co/${m.id}`,
      publishedAt: m.createdAt || null,
      summary: Array.isArray(m.tags) ? m.tags.slice(0, 6).join(', ') : null,
    }));
    return { feed: name, ok: true, count: items.length, items };
  } catch (err) {
    return { feed: name, ok: false, count: 0, error: err.message, items: [] };
  }
}

function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item.url) continue;
    const key = item.url.replace(/^https?:\/\//i, '').replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

const runs = await Promise.all([...FEEDS.map(harvestFeed), harvestHuggingFaceTrending()]);

const allItems = dedupe(runs.flatMap((r) => r.items)).sort((a, b) =>
  (b.publishedAt || '').localeCompare(a.publishedAt || '')
);

const outDir = join(ROOT, 'generated', 'candidates');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `${date}.json`);

writeFileSync(
  outPath,
  JSON.stringify(
    {
      $comment:
        'Leads, not sources. Every item here is exactly as trustworthy as a search snippet — open it, verify it, and cite the real publisher before it appears in an edition. Items with discoveryOnly:true come from a news-search aggregator and point at a redirect, not the publisher; never cite the aggregator itself.',
      harvestedAt: new Date().toISOString(),
      feedCount: runs.length,
      okCount: runs.filter((r) => r.ok).length,
      itemCount: allItems.length,
      feeds: runs.map(({ feed, ok, count, error }) => ({ feed, ok, count, error: error || undefined })),
      items: allItems,
    },
    null,
    2
  ) + '\n'
);

// --- feed health ------------------------------------------------------------
// A feed that 403s does not fail the run — it just silently contributes nothing, which is
// exactly how coverage degrades without anyone noticing. Consecutive failures are tracked
// across runs so a feed that has been dead for days becomes visible instead of invisible.

const HEALTH_PATH = join(ROOT, 'generated', 'feed-health.json');
const DEAD_AFTER = 8; // ~2 days at the 6-hourly wire cadence

let health = {};
try {
  health = readJSON(HEALTH_PATH).feeds || {};
} catch {
  health = {};
}

const dead = [];
for (const r of runs) {
  const prev = health[r.feed] || { consecutiveFailures: 0, totalRuns: 0 };
  const entry = {
    consecutiveFailures: r.ok ? 0 : prev.consecutiveFailures + 1,
    totalRuns: prev.totalRuns + 1,
    lastOk: r.ok ? new Date().toISOString() : prev.lastOk || null,
    lastError: r.ok ? undefined : r.error,
    lastCount: r.count,
  };
  health[r.feed] = entry;
  if (entry.consecutiveFailures >= DEAD_AFTER) dead.push({ feed: r.feed, ...entry });
}

writeFileSync(
  HEALTH_PATH,
  JSON.stringify(
    {
      $comment:
        'Written by tools/harvest.mjs. consecutiveFailures resets to 0 on any successful fetch. A feed at or above the DEAD_AFTER threshold is reported loudly by the harvest and should be fixed or removed from FEEDS.',
      updatedAt: new Date().toISOString(),
      deadAfter: DEAD_AFTER,
      feeds: health,
    },
    null,
    2
  ) + '\n'
);

// Candidate files are working material, not the archive — generated/YYYY-MM-DD.json is the
// archive. At roughly a third of a megabyte a day, keeping them forever would add ~120MB a
// year to a repository whose whole point is being cheap to clone. Two weeks is enough to
// backfill a missed edition or debug a bad run.
const RETAIN_DAYS = 14;
for (const f of readdirSync(outDir)) {
  if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(f)) continue;
  const age = (Date.parse(date) - Date.parse(f.slice(0, 10))) / 86400000;
  if (age > RETAIN_DAYS) {
    rmSync(join(outDir, f));
    console.log(`  pruned generated/candidates/${f}`);
  }
}

const failed = runs.filter((r) => !r.ok);
console.log(`✓ harvested ${allItems.length} candidate leads from ${runs.length - failed.length}/${runs.length} feeds`);
if (failed.length) {
  console.log(`  ${failed.length} feed(s) unreachable this run (non-fatal):`);
  for (const f of failed) console.log(`    ${f.feed}: ${f.error}`);
}
console.log(`  wrote ${relative(ROOT, outPath)}`);

if (dead.length) {
  console.error(`\n✗ ${dead.length} feed(s) have failed ${DEAD_AFTER}+ runs in a row and are effectively dead:`);
  for (const d of dead) {
    console.error(`    ${d.feed}: ${d.consecutiveFailures} consecutive failures — ${d.lastError}`);
    console.error(`      last succeeded: ${d.lastOk || 'never'}`);
  }
  console.error('  Fix the URL in tools/harvest.mjs FEEDS, or remove the entry.');
}

if (runs.every((r) => !r.ok)) {
  console.error('✗ every feed failed — that is a network or environment problem, not a quiet news day.');
  process.exit(1);
}

// A dead feed is a real coverage gap, so it fails the run and surfaces as a workflow
// failure (which opens an issue) rather than scrolling past in a log nobody reads.
if (dead.length) process.exit(1);
