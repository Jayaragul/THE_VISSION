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

function tokens(str) {
  return new Set(
    String(str).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3)
  );
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
