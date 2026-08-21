#!/usr/bin/env node
// Tier 1.5: a deterministic edition. No model, no API key, no prose — a story's title here
// is a source's own headline, verbatim, never rewritten. What a machine can actually do
// honestly is cluster, rank and attribute; it cannot verify a claim or explain why something
// matters, so this does not pretend to. See ARCHITECTURE.md and the review that prompted it.
//
//   node tools/digest.mjs                 # requires generated/candidates/<today>.json
//   node tools/digest.mjs 2026-08-15
//
// Run tools/harvest.mjs first — this reads its output, it does not fetch anything itself.

import { writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJSON, isoDate, slugify, isAiRelevant } from './lib/util.mjs';
import { classifyBeat, tierOf } from './lib/classify.mjs';
import { clusterItems, publisherDiversity } from './lib/cluster.mjs';
import { scoreCluster, confidenceOf } from './lib/rank.mjs';
import { validate as validateSchema, assertSupported } from './lib/schema.mjs';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const date = process.argv[2] || isoDate();
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(`✗ "${date}" is not a YYYY-MM-DD date`);
  process.exit(2);
}

const candidatesPath = join(ROOT, 'generated', 'candidates', `${date}.json`);
if (!existsSync(candidatesPath)) {
  console.error(`✗ ${candidatesPath} does not exist — run \`node tools/harvest.mjs ${date}\` first.`);
  process.exit(1);
}

const { beats, edition: editionRules } = readJSON(join(ROOT, 'input', 'beats.json'));
const sourceBook = readJSON(join(ROOT, 'input', 'sources.json'));
const candidates = readJSON(candidatesPath);

// How many headlines each beat may list. The digest is a headline aggregator, not a written
// paper, so it gets `digestQuota`. It previously reused `quota` — the editorial target for a
// hand-written edition — which capped the whole digest at the sum of those quotas: nine items,
// on a day with 82 usable clusters available.
//
// This cap is now the *only* place beat balance is expressed. scoreCluster used to carry a
// beatPriority term derived from the same editorial quotas, which meant a policy story started
// at 0.333 and a models story at 1.0 — a standing advantage that had nothing to do with either
// story. Enforcing balance by capping slots and again by biasing the score was both redundant
// and, for the low-quota beats, actively wrong.
const selectionCap = new Map(beats.map((b) => [b.id, b.digestQuota ?? b.quota]));

// --- prior digest URLs, for novelty ------------------------------------------------------

function priorDigestUrls(beforeDate) {
  const dir = join(ROOT, 'generated', 'digest');
  const seen = new Set();
  if (!existsSync(dir)) return seen;
  for (const f of readdirSync(dir)) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(f) || f.slice(0, 10) >= beforeDate) continue;
    try {
      const doc = readJSON(join(dir, f));
      for (const item of doc.items || []) {
        for (const src of item.sources || []) seen.add(src.url);
      }
    } catch {
      /* a corrupt prior file should not block today's run */
    }
  }
  return seen;
}

// --- pipeline ------------------------------------------------------------------------------

// Aggregator redirects (Google News, etc.) are leads, never citable — same rule as the wire
// and the editorial pipeline. This tier has no model to open the link and find the real
// publisher, so it simply cannot use them. The AI-relevance gate matters even more here than
// on the wire: an off-topic item that slips past it does not just look wrong in a headline
// list, it gets forced into a beat by classifyBeat's keyword overlap — which is exactly how
// "Open Mike Eagle and Kenny Segal crafted a hip-hop breakup masterpiece" ended up filed
// under Models on the first run of this pipeline, via the single shared token "open".
const usable = candidates.items.filter((item) => {
  if (!item.url || !/^https:\/\//i.test(item.url)) return false;
  if (!isAiRelevant(item.title)) return false;
  return true;
});

// An aggregator headline ends in its real publisher: "AWS brings … to India - CNBC TV18".
// That name is the only part of the entry worth anything here, and it is what makes an
// aggregator copy countable as corroboration rather than as one more "Google News" item.
function viaPublisher(item) {
  const m = /\s[-–—]\s([^-–—]{2,40})$/.exec(String(item.title || ''));
  return m ? m[1].trim() : null;
}

const withMeta = [];
for (const item of usable) {
  const { tier, blocked, name } = tierOf(item, sourceBook);
  if (blocked) continue;
  const beat = classifyBeat(item, beats);
  if (!beat) continue;
  // Aggregator redirects stay in the pool as evidence but can never be cited: the URL is an
  // opaque redirect, not the publisher's own page, and this tier has no model to follow it.
  // Dropping them outright — which is what happened until now — discarded the only signal
  // that eleven outlets ran the same story, so every cluster looked single-source and the
  // digest reported "0 confirmed" on a day with heavily corroborated news.
  const publisher = item.discoveryOnly ? viaPublisher(item) : name || item.source;
  if (item.discoveryOnly && !publisher) continue; // no extractable publisher, no evidentiary value
  withMeta.push({ ...item, tier, publisher, beat, citable: !item.discoveryOnly });
}

const clusters = clusterItems(withMeta)
  // A cluster of nothing but aggregator copies has no headline the digest is allowed to print
  // and no URL it is allowed to cite, however many outlets it represents. It is dropped rather
  // than published without a source.
  .filter((cluster) => cluster.items.some((i) => i.citable !== false))
  .map((cluster) => {
  // The cluster's beat is whichever beat its member items agree on most — classifyBeat runs
  // per item before clustering, so a cluster of near-duplicate headlines usually agrees
  // already; a tie just takes the first item's call.
  const counts = new Map();
  for (const i of cluster.items) counts.set(i.beat, (counts.get(i.beat) || 0) + 1);
  const beat = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return { ...cluster, beat };
});

const seenUrls = priorDigestUrls(date);
const now = Date.parse(`${date}T12:00:00Z`);

const scored = clusters.map((cluster) => {
  const { score, bestTier: tier } = scoreCluster(cluster, {
    seenUrls,
    now,
    maxAgeHours: editionRules.lookbackHours,
  });
  // Confidence is judged on citable items only. Aggregator copies may lift a cluster's
  // ranking, because ranking is an internal ordering decision — but "confirmed" is a printed
  // claim, and printing it on the strength of sources the page does not show would be telling
  // the reader something they cannot check. Ranking may use soft evidence; a claim may not.
  const citableOnly = { ...cluster, items: cluster.items.filter((i) => i.citable !== false) };
  return { cluster, score, confidence: confidenceOf(citableOnly), tier };
});

// Per-beat quota, same shape as the editorial pipeline's own targets — highest-scored
// clusters first, capped at each beat's quota so one very active beat cannot crowd out
// everything else.
const byBeat = new Map(beats.map((b) => [b.id, []]));
for (const entry of scored.sort((a, b) => b.score - a.score)) {
  const bucket = byBeat.get(entry.cluster.beat);
  if (bucket && bucket.length < selectionCap.get(entry.cluster.beat)) bucket.push(entry);
}

const selected = [...byBeat.values()].flat().sort((a, b) => b.score - a.score);

const items = selected.map(({ cluster, score, confidence }) => {
  // The title is the best-available source's own headline — highest tier first, then most
  // recent — never rewritten. This is the whole difference from the AI edition, made
  // structural rather than a matter of style.
  // Only citable items can supply the headline or the source list. Aggregator copies have
  // already done their job by this point, in the corroboration count.
  const citable = cluster.items.filter((i) => i.citable !== false);
  const bySourceQuality = [...citable].sort(
    (a, b) => a.tier - b.tier || Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0)
  );
  const best = bySourceQuality[0];
  // Truncating slugify()'s output can land mid-word right after a hyphen and leave a
  // trailing one — strip it again rather than ship an id that fails the schema pattern.
  const slug = slugify(best.title).slice(0, 60).replace(/-+$/, '') || `item-${Math.abs(best.url.length)}`;

  const sources = bySourceQuality.slice(0, 4).map((i) => ({
    title: i.title,
    publisher: i.publisher,
    url: i.url,
    tier: i.tier,
  }));

  // Outlets seen covering this story through an aggregator. Named, never linked: the only URL
  // on hand is an opaque redirect, and printing it as though it were the outlet's own page
  // would be a citation the reader cannot follow to the thing it claims. Naming them is what
  // makes the corroboration behind this item's ranking visible instead of hidden.
  // "Amazon" and "Amazon Web Services (AWS)" are one outlet under two names, and listing the
  // second as corroboration for the first would manufacture agreement out of a naming
  // difference. Compare on a squashed form and treat containment either way as the same body.
  const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const cited = sources.map((s) => squash(s.publisher)).filter(Boolean);
  const isCited = (p) => {
    const q = squash(p);
    return !q || cited.some((c) => c.includes(q) || q.includes(c));
  };
  const corroboratedBy = [
    ...new Map(
      cluster.items
        .filter((i) => i.citable === false && i.publisher && !isCited(i.publisher))
        .map((i) => [squash(i.publisher), i.publisher])
    ).values(),
  ].slice(0, 6);

  return {
    id: `${date}-${slug}`,
    slug,
    beat: cluster.beat,
    title: best.title,
    publishedAt: best.publishedAt || undefined,
    confidence,
    score: Math.round(score * 1000) / 1000,
    sources,
    ...(corroboratedBy.length ? { corroboratedBy } : {}),
  };
});

// Two items can still collide on slug (two different clusters whose best headline
// transliterates the same way) — de-duplicate ids deterministically rather than let a
// later write silently overwrite an earlier one.
const seenIds = new Set();
for (const item of items) {
  let id = item.id;
  let n = 2;
  while (seenIds.has(id)) id = `${item.id}-${n++}`;
  seenIds.add(id);
  item.id = id;
  item.slug = id.slice(date.length + 1);
}

const doc = {
  $schema: '../../schema/digest.schema.json',
  edition: {
    date,
    generatedAt: new Date().toISOString(),
    itemCount: items.length,
  },
  items,
};

// Self-validating, same discipline as the editorial pipeline: nothing this script writes
// has skipped the schema gate, even though there is no separate CI step forcing it to run.
const digestSchema = readJSON(join(ROOT, 'schema', 'digest.schema.json'));
assertSupported(digestSchema);
const schemaErrors = validateSchema(doc, digestSchema);
if (schemaErrors.length) {
  console.error(`✗ digest failed its own schema — refusing to write it:`);
  for (const e of schemaErrors) console.error(`    ${e.path}: ${e.message}`);
  process.exit(1);
}

const outDir = join(ROOT, 'generated', 'digest');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `${date}.json`), JSON.stringify(doc, null, 2) + '\n');

console.log(
  `✓ digest ${date}: ${items.length} items from ${clusters.length} cluster(s) ` +
    `(${withMeta.length} classified candidates, ${usable.length} usable of ${candidates.items.length} harvested)`
);
const confirmed = items.filter((i) => i.confidence === 'confirmed').length;
console.log(`  ${confirmed} confirmed (2+ independent publishers), ${items.length - confirmed} single-source`);
