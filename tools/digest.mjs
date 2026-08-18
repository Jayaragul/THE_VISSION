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

// Two different questions, two different maps — conflating them is what capped this tier.
//
// selectionCap: how many headlines this beat may list in the digest. The digest is a headline
// aggregator, not a written paper, so it gets `digestQuota`. It previously reused `quota` —
// the editorial target for a hand-written edition — which capped the whole digest at the sum
// of those quotas: nine items, on a day with 82 usable clusters available.
//
// beatQuota/maxQuota: which beats the paper considers most important, fed to scoreCluster's
// beatPriority term as a ratio. That has to stay on the editorial quotas: the term is scaled
// to land in 0–1, and dividing a digestQuota of 14 by a maxQuota of 3 would push one weighted
// component past its own ceiling and quietly distort every score in the ranking.
const selectionCap = new Map(beats.map((b) => [b.id, b.digestQuota ?? b.quota]));
const beatQuota = new Map(beats.map((b) => [b.id, b.quota]));
const maxQuota = Math.max(...beats.map((b) => b.quota));

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
  if (item.discoveryOnly) return false;
  if (!item.url || !/^https:\/\//i.test(item.url)) return false;
  if (!isAiRelevant(item.title)) return false;
  return true;
});

const withMeta = [];
for (const item of usable) {
  const { tier, blocked, name } = tierOf(item, sourceBook);
  if (blocked) continue;
  const beat = classifyBeat(item, beats);
  if (!beat) continue;
  withMeta.push({ ...item, tier, publisher: name || item.source, beat });
}

const clusters = clusterItems(withMeta).map((cluster) => {
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
    beatQuota,
    maxQuota,
    now,
    maxAgeHours: editionRules.lookbackHours,
  });
  return { cluster, score, confidence: confidenceOf(cluster), tier };
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
  const bySourceQuality = [...cluster.items].sort(
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

  return {
    id: `${date}-${slug}`,
    slug,
    beat: cluster.beat,
    title: best.title,
    publishedAt: best.publishedAt || undefined,
    confidence,
    score: Math.round(score * 1000) / 1000,
    sources,
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
