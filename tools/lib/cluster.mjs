import { STOPWORDS } from './util.mjs';

// Groups harvested items that are plausibly reporting on the same event, using title
// token-overlap and a time window — no embeddings, no fuzzy-matching library, nothing that
// would need a dependency. This is a deliberately blunt instrument: it catches "three
// outlets covering the same announcement the same day" reliably, and it will miss the subtle
// cases a human editor would not. That trade is the whole point of Tier 1.5 — see
// ARCHITECTURE.md's honesty about what a deterministic pipeline cannot do.

// A plain length filter was dropping exactly the tokens that identify a story: GPT, AWS, EU,
// API, xAI. Three outlets covering "AWS brings OpenAI GPT-5.6 to India" shared almost nothing
// measurable once those went, so each ran as its own single-source item and the digest never
// showed related coverage. Excluding stopwords instead of short words keeps the identifiers
// and still drops "the" and "and".
function tokenize(str) {
  return new Set(
    String(str)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

function sharedCount(a, b) {
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared;
}

const DEFAULT_SIMILARITY = 0.32;
const DEFAULT_WINDOW_HOURS = 60;
// One word in common is a coincidence, not a shared story — two short headlines about
// different things can clear the ratio on a single token. Merging the wrong items is worse
// than missing a merge, because the digest would then credit a source to a story it never
// covered, so the ratio has to be met and this floor cleared.
const MIN_SHARED_TOKENS = 2;

/**
 * @param {Array<object>} items — must already have `.tier` and `.publisher` attached.
 * @returns {Array<{items: object[], tokens: Set<string>}>}
 */
export function clusterItems(items, { similarity = DEFAULT_SIMILARITY, windowHours = DEFAULT_WINDOW_HOURS } = {}) {
  const withTokens = items.map((item) => ({ item, tokens: tokenize(item.title) }));
  const clusters = [];

  for (const entry of withTokens) {
    let placed = false;
    for (const cluster of clusters) {
      const withinWindow = cluster.items.every((other) => {
        const a = Date.parse(entry.item.publishedAt || 0);
        const b = Date.parse(other.publishedAt || 0);
        if (Number.isNaN(a) || Number.isNaN(b)) return true; // don't let a missing date force a new cluster
        return Math.abs(a - b) <= windowHours * 3600000;
      });
      if (
        withinWindow &&
        jaccard(entry.tokens, cluster.tokens) >= similarity &&
        sharedCount(entry.tokens, cluster.tokens) >= MIN_SHARED_TOKENS
      ) {
        cluster.items.push(entry.item);
        // Widen the cluster's vocabulary as items join, so a cluster of three headlines
        // catches a fourth that shares words with any one of them, not only the first.
        for (const t of entry.tokens) cluster.tokens.add(t);
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push({ items: [entry.item], tokens: new Set(entry.tokens) });
    }
  }

  return clusters.map(({ items, tokens }) => ({ items, tokens }));
}

/** Distinct publisher identities in a cluster, by the same canonical-name rule
 *  tools/validate.mjs uses for source independence — not raw hosts. */
export function publisherDiversity(cluster) {
  return new Set(cluster.items.map((i) => (i.publisher || i.host || '').toLowerCase())).size;
}

export function bestTier(cluster) {
  return Math.min(...cluster.items.map((i) => i.tier ?? 4));
}
