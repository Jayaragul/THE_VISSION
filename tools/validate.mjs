#!/usr/bin/env node
// The publish gate. Nothing reaches the site without passing this.
//
//   node tools/validate.mjs                 # validate every edition
//   node tools/validate.mjs generated/2026-08-17.json
//   node tools/validate.mjs --strict        # warnings become errors (this is what CI runs)
//   node tools/validate.mjs --report evals/last-run.json
//
// Exit code 0 = publishable.

import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJSON, hostOf, matchPublisher, readMinutes } from './lib/util.mjs';
import { validate as validateSchema, assertSupported } from './lib/schema.mjs';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const GENERATED = join(ROOT, 'generated');

const argv = process.argv.slice(2);
const STRICT = argv.includes('--strict');
const reportIdx = argv.indexOf('--report');
const REPORT = reportIdx > -1 ? argv[reportIdx + 1] : null;
const targets = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--report');

const schema = readJSON(join(ROOT, 'schema', 'edition.schema.json'));
const { beats, edition: editionRules } = readJSON(join(ROOT, 'input', 'beats.json'));
const sourceBook = readJSON(join(ROOT, 'input', 'sources.json'));
const beatIds = new Set(beats.map((b) => b.id));

// House-style linter. Every entry here traces back to a rule in input/editorial.md.
const STYLE_TRAPS = [
  [/\bgame[- ]?chang(er|ing)\b/i, 'hype word "game-changer"'],
  [/\brevolutionar(y|ise|ize|izing|ising)\b/i, 'hype word "revolutionary"'],
  [/\bseismic\b/i, 'hype word "seismic"'],
  [/\bunprecedented\b/i, 'hype word "unprecedented"'],
  [/\bit remains to be seen\b/i, 'empty phrase "it remains to be seen"'],
  [/\bexperts say\b/i, 'unattributed authority "experts say"'],
  [/\bcould potentially\b/i, 'double hedge "could potentially"'],
  [/\bmay possibly\b/i, 'double hedge "may possibly"'],
  [/\bfast[- ]paced world\b/i, 'filler opening "fast-paced world"'],
  [/\bever[- ]evolving\b/i, 'filler phrase "ever-evolving"'],
  [/\bdelve\b/i, 'tell-tale filler "delve"'],
  [/\btapestry\b/i, 'tell-tale filler "tapestry"'],
  [/\bis a testament to\b/i, 'empty praise "a testament to"'],
  [/\bharness(ing)? the power\b/i, 'marketing phrase "harness the power"'],
  [/\bin the (rapidly )?changing landscape\b/i, 'filler phrase "changing landscape"'],
];

function collect() {
  if (targets.length) return targets.map((t) => resolvePath(t));
  let files = [];
  try {
    files = readdirSync(GENERATED)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort()
      .map((f) => join(GENERATED, f));
  } catch {
    return [];
  }
  return files;
}

function lintProse(label, text, warn) {
  if (!text) return;
  for (const [re, why] of STYLE_TRAPS) {
    if (re.test(text)) warn(`${label}: ${why}`);
  }
  if (/!/.test(text.replace(/"[^"]*"/g, ''))) {
    warn(`${label}: exclamation mark outside a quote`);
  }
}

// --- copyright safety -------------------------------------------------------
// The paper summarises other people's reporting, which is lawful, and copies it, which is
// not. The line between the two is not something to leave to an unsupervised model's
// judgement at 6am, so it is checked mechanically.

function words(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'at', 'by',
  'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'that', 'this',
]);

/** Longest run of consecutive words shared between two strings, plus the run itself. */
function longestSharedRun(a, b) {
  const A = words(a);
  const B = words(b);
  if (!A.length || !B.length) return { length: 0, run: [] };
  let best = 0;
  let endsAt = 0;
  // Standard LCS-substring DP, kept to one row since we only need the length and position.
  let prev = new Array(B.length + 1).fill(0);
  for (let i = 1; i <= A.length; i++) {
    const cur = new Array(B.length + 1).fill(0);
    for (let j = 1; j <= B.length; j++) {
      if (A[i - 1] === B[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) {
          best = cur[j];
          endsAt = i;
        }
      }
    }
    prev = cur;
  }
  return { length: best, run: A.slice(endsAt - best, endsAt) };
}

/**
 * Tokens that are genuinely proper nouns, read from OUR prose rather than the source's.
 *
 * Source headlines are usually Title Case, where every word is capitalised — using them
 * would classify "Investable Asset Class" as three names and wave the copying through.
 * The paper's own copy is sentence case, so a capital appearing mid-sentence is a real
 * signal. Collected across every field of the story, so a name that opens one sentence is
 * still caught where it appears inside another.
 */
function properNouns(fields) {
  const set = new Set();
  for (const field of fields) {
    // Split into sentences so the first word of each is not mistaken for a name.
    for (const sentence of String(field || '').split(/(?<=[.!?])\s+/)) {
      sentence.split(/\s+/).forEach((w, i) => {
        const clean = w.replace(/[^A-Za-z0-9]/g, '');
        if (i > 0 && /^[A-Z]/.test(clean) && clean.length > 1) set.add(clean.toLowerCase());
      });
    }
  }
  return set;
}

/**
 * How much of a shared run is actually protected expression.
 *
 * Copyright covers creative expression, not facts. "Apollo, BlackRock, Blackstone,
 * Brookfield, Goldman Sachs and KKR" is eight shared words and none of them are ours to
 * paraphrase — it is the list of who did the thing, and there is no other way to write it.
 * "AI factory compute is becoming an investable asset class" is the same length and is
 * entirely someone else's phrasing. Counting only non-name, non-stopword tokens separates
 * the two.
 */
function expressiveLength(run, names) {
  return run.filter((w) => !names.has(w) && !STOPWORDS.has(w)).length;
}

/** Words inside double quotes, as a rough proxy for quoted passages. */
function quotedRuns(text) {
  return [...String(text || '').matchAll(/"([^"]{10,})"/g)].map((m) => words(m[1]).length);
}

const MAX_SHARED_RUN = 7;      // consecutive words lifted from a source headline
const MAX_EXPRESSIVE_RUN = 4;  // of those, how many may be someone else's actual phrasing
const MAX_QUOTE_WORDS = 30;    // a quotation longer than this is excerpting, not quoting

function checkCopyright(story, err, warn) {
  const tag = story.id;
  const ourText = [story.headline, story.deck, ...(story.summary || []), ...(story.body || [])];
  const names = properNouns([...ourText, ...(story.entities || [])]);

  for (const src of story.sources || []) {
    for (const field of ourText) {
      const { length, run } = longestSharedRun(field, src.title);
      if (length <= MAX_SHARED_RUN) continue;

      const expressive = expressiveLength(run, names);
      const phrase = run.join(' ');
      if (expressive > MAX_EXPRESSIVE_RUN) {
        err(
          `${tag}: ${expressive} words of "${src.publisher}"'s own phrasing reused — "${phrase}" — rewrite it`
        );
      } else if (expressive > 2) {
        warn(`${tag}: ${length} words shared with "${src.publisher}" headline — "${phrase}"`);
      }
      // Below that it is a list of names and function words: factual, and there is no
      // other way to write it. Silent, because a warning nobody can act on is noise.
    }
  }

  for (const field of ourText) {
    for (const len of quotedRuns(field)) {
      if (len > MAX_QUOTE_WORDS) {
        warn(`${tag}: a quoted passage runs ${len} words — keep quotations short and attributed`);
      }
    }
  }
}

function tokens(str) {
  return new Set(
    String(str).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3)
  );
}

/**
 * Every edition older than the one being checked, keyed by source URL and headline.
 *
 * Repeating yesterday's story is the failure mode a single run cannot see from the inside:
 * the pipeline reads recent headlines from edition-info.mjs and is told not to repeat them,
 * but nothing enforced it. This does.
 */
function priorEditions(currentDate) {
  const seenUrls = new Map();
  const seenHeadlines = [];
  let files = [];
  try {
    files = readdirSync(GENERATED).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  } catch {
    return { seenUrls, seenHeadlines };
  }
  for (const f of files) {
    const date = f.slice(0, 10);
    if (date >= currentDate) continue; // only look backwards
    let doc;
    try {
      doc = readJSON(join(GENERATED, f));
    } catch {
      continue;
    }
    for (const s of doc.stories || []) {
      for (const src of s.sources || []) {
        if (!seenUrls.has(src.url)) seenUrls.set(src.url, { date, id: s.id });
      }
      seenHeadlines.push({ date, id: s.id, tokens: tokens(s.headline) });
    }
  }
  return { seenUrls, seenHeadlines };
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

function checkEdition(file) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  let doc;
  try {
    doc = readJSON(file);
  } catch (e) {
    return { file, errors: [e.message], warnings: [] };
  }

  // --- structural -----------------------------------------------------------
  for (const e of validateSchema(doc, schema)) {
    err(`schema · ${e.path}: ${e.message}`);
  }
  if (errors.length) return { file, errors, warnings }; // shape is wrong; deeper checks would just be noise

  const stem = basename(file).replace(/\.json$/, '');
  if (doc.edition.date !== stem) {
    err(`edition.date "${doc.edition.date}" does not match filename "${stem}"`);
  }

  const stories = doc.stories;
  const { min: minBriefs, max: maxBriefs } = editionRules.briefCount;
  const { min: minTop, max: maxTop } = editionRules.topCount;

  if (stories.length < editionRules.minStories) {
    err(`only ${stories.length} stories; the floor is ${editionRules.minStories}`);
  }
  if (stories.length > editionRules.maxStories) {
    warn(`${stories.length} stories exceeds the target ceiling of ${editionRules.maxStories}`);
  }

  const byProminence = (p) => stories.filter((s) => s.prominence === p);
  if (byProminence('lead').length !== 1) {
    err(`an edition needs exactly one lead story, found ${byProminence('lead').length}`);
  }
  const topN = byProminence('top').length;
  if (topN < minTop || topN > maxTop) {
    warn(`${topN} top stories; house range is ${minTop}–${maxTop}`);
  }
  const briefN = byProminence('brief').length;
  if (briefN < minBriefs || briefN > maxBriefs) {
    warn(`${briefN} briefs; house range is ${minBriefs}–${maxBriefs}`);
  }

  // --- per story ------------------------------------------------------------
  const { seenUrls: priorUrls, seenHeadlines: priorHeadlines } = priorEditions(doc.edition.date);
  const seenIds = new Set();
  const seenSlugs = new Set();
  const seenSourceUrls = new Map();
  const editionMs = Date.parse(`${doc.edition.date}T23:59:59Z`);
  const oldestAllowed = editionMs - editionRules.maxLookbackHours * 3600 * 1000;

  for (const s of stories) {
    const tag = `${s.id || '(no id)'}`;

    if (seenIds.has(s.id)) err(`${tag}: duplicate story id`);
    seenIds.add(s.id);
    if (seenSlugs.has(s.slug)) err(`${tag}: duplicate slug "${s.slug}"`);
    seenSlugs.add(s.slug);

    if (!s.id.startsWith(`${doc.edition.date}-`)) {
      err(`${tag}: id must be prefixed with the edition date`);
    }
    if (s.id !== `${doc.edition.date}-${s.slug}`) {
      err(`${tag}: id must equal "<date>-<slug>" (slug is "${s.slug}")`);
    }
    if (!beatIds.has(s.beat)) {
      err(`${tag}: unknown beat "${s.beat}" — not in input/beats.json`);
    }

    const isBrief = s.prominence === 'brief';
    const body = s.body || [];

    if (isBrief && body.length) {
      err(`${tag}: briefs carry no body (found ${body.length} paragraphs)`);
    }
    if (!isBrief && body.length < 3) {
      err(`${tag}: ${s.prominence} stories need at least 3 body paragraphs, has ${body.length}`);
    }
    if (!isBrief && !s.whyItMatters) {
      err(`${tag}: ${s.prominence} stories need a "why it matters"`);
    }
    if (isBrief && s.whyItMatters) {
      warn(`${tag}: briefs do not print "why it matters"; it will not be shown`);
    }

    // Sourcing.
    const sources = s.sources || [];
    const needed = s.prominence === 'lead' || s.prominence === 'top' ? 2 : 1;
    if (sources.length < needed) {
      err(`${tag}: ${s.prominence} stories need ${needed} sources, has ${sources.length}`);
    }

    let bestTier = 9;
    for (const src of sources) {
      const host = hostOf(src.url);
      if (!host) {
        err(`${tag}: unparseable source URL "${src.url}"`);
        continue;
      }
      const blocked = matchPublisher(host, sourceBook.blocked);
      if (blocked) {
        err(`${tag}: ${host} is blocked as a source — ${blocked.reason}`);
        continue;
      }
      const known = matchPublisher(host, sourceBook.publishers);
      const tier = known?.tier ?? 4;
      bestTier = Math.min(bestTier, tier);
      if (!known) warn(`${tag}: ${host} is not in the source book (treated as tier 4)`);
      if (src.tier != null && known && src.tier !== known.tier) {
        warn(`${tag}: ${host} declared tier ${src.tier}, source book says ${known.tier}`);
      }

      const prev = seenSourceUrls.get(src.url);
      if (prev && prev !== s.id) {
        err(`${tag}: source ${src.url} is already cited by ${prev} — merge or drop one story`);
      }
      seenSourceUrls.set(src.url, s.id);

      // Same source, earlier edition: this story has already run.
      const before = priorUrls.get(src.url);
      if (before) {
        err(
          `${tag}: source ${src.url} already ran in the ${before.date} edition (${before.id}) — this is not new`
        );
      }

      if (src.publishedAt) {
        const t = Date.parse(src.publishedAt);
        if (t > editionMs + 86400000) {
          err(`${tag}: source "${src.publisher}" is dated in the future (${src.publishedAt})`);
        } else if (t < oldestAllowed) {
          warn(`${tag}: source "${src.publisher}" is older than the ${editionRules.maxLookbackHours}h lookback`);
        }
      }
    }
    if (sources.length && bestTier > 3) {
      err(`${tag}: no source above tier 3 — needs a primary source or an established newsroom`);
    }
    if (s.prominence === 'lead' && bestTier > 2) {
      warn(`${tag}: the lead story has no tier-1 primary source`);
    }
    if (s.confidence === 'low' && (s.prominence === 'lead' || s.prominence === 'top')) {
      warn(`${tag}: low-confidence story is running at ${s.prominence} prominence`);
    }

    // Deck must earn its place.
    const hTok = tokens(s.headline);
    const dTok = tokens(s.deck);
    if (dTok.size) {
      const overlap = [...dTok].filter((t) => hTok.has(t)).length / dTok.size;
      if (overlap > 0.8) warn(`${tag}: the deck mostly restates the headline`);
    }
    if (/:\s/.test(s.headline) && s.headline.split(':')[0].split(/\s+/).length <= 2) {
      warn(`${tag}: headline uses a "Label: thing" construction`);
    }

    // A genuine development on a running story is legitimate, so near-duplicate headlines
    // warn rather than block — but a shared source URL above is an error, because that
    // means the same underlying report is being run twice.
    for (const old of priorHeadlines) {
      const sim = jaccard(hTok, old.tokens);
      if (sim > 0.6) {
        warn(
          `${tag}: headline is ${Math.round(sim * 100)}% similar to ${old.id} (${old.date}) — say what changed, or drop it`
        );
        break;
      }
    }

    checkCopyright(s, err, warn);

    // House style.
    lintProse(`${tag} headline`, s.headline, warn);
    lintProse(`${tag} deck`, s.deck, warn);
    (s.summary || []).forEach((b, i) => lintProse(`${tag} summary[${i}]`, b, warn));
    body.forEach((p, i) => lintProse(`${tag} body[${i}]`, p, warn));
    lintProse(`${tag} whyItMatters`, s.whyItMatters, warn);

    if (s.readMinutes != null && Math.abs(s.readMinutes - readMinutes(s)) > 2) {
      warn(`${tag}: readMinutes ${s.readMinutes} is off (computed ${readMinutes(s)}); the build will correct it`);
    }
  }

  // --- beat coverage --------------------------------------------------------
  for (const beat of beats) {
    const count = stories.filter((s) => s.beat === beat.id).length;
    if (count < beat.minQuota) {
      err(`beat "${beat.id}" has ${count} stories, floor is ${beat.minQuota}`);
    } else if (count < beat.quota) {
      warn(`beat "${beat.id}" has ${count} stories, target is ${beat.quota}`);
    }
  }

  return { file, errors, warnings };
}

// ------------------------------------------------------------------- main ----

try {
  assertSupported(schema);
} catch (e) {
  console.error(`✗ schema/edition.schema.json: ${e.message}`);
  process.exit(2);
}

const files = collect();
if (!files.length) {
  console.log('nothing to validate — generated/ has no editions yet');
  process.exit(0);
}

const results = files.map(checkEdition);
let totalErrors = 0;
let totalWarnings = 0;

for (const r of results) {
  const name = basename(r.file);
  totalErrors += r.errors.length;
  totalWarnings += r.warnings.length;
  if (!r.errors.length && !r.warnings.length) {
    console.log(`  ✓ ${name}`);
    continue;
  }
  console.log(`\n  ${r.errors.length ? '✗' : '!'} ${name}`);
  for (const e of r.errors) console.log(`      error   ${e}`);
  for (const w of r.warnings) console.log(`      warn    ${w}`);
}

const failed = totalErrors > 0 || (STRICT && totalWarnings > 0);
console.log(
  `\n${failed ? '✗' : '✓'} ${files.length} edition(s) · ${totalErrors} error(s) · ${totalWarnings} warning(s)` +
    (STRICT ? ' · strict' : '')
);

if (REPORT) {
  mkdirSync(dirname(resolvePath(REPORT)), { recursive: true });
  writeFileSync(
    resolvePath(REPORT),
    JSON.stringify(
      { ranAt: new Date().toISOString(), strict: STRICT, totalErrors, totalWarnings, results },
      null,
      2
    ) + '\n'
  );
  console.log(`  report written to ${REPORT}`);
}

process.exit(failed ? 1 : 0);
