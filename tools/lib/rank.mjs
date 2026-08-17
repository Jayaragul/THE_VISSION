// Scores an event cluster. Every input is something a machine can actually measure — a
// timestamp, a tier lookup, a set of URLs already seen — deliberately excluding anything
// that would require judging what a story means. That is Tier 1.5's whole premise: rank
// mathematically, and let the confidence label say what the ranking cannot.

import { recencyScore, tierOf } from './classify.mjs';
import { bestTier, publisherDiversity } from './cluster.mjs';

const WEIGHTS = {
  recency: 0.25,
  sourceQuality: 0.25,
  independentSources: 0.2,
  novelty: 0.15,
  beatPriority: 0.1,
  publisherDiversity: 0.05,
};

function sourceQuality(tier) {
  // tier 1 → 1.0, tier 2 → 0.667, tier 3 → 0.333, tier 4 → 0
  return Math.max(0, 1 - (tier - 1) / 3);
}

/**
 * @param {object} cluster        from clusterItems()
 * @param {object} opts
 * @param {Set<string>} opts.seenUrls    URLs already published in a prior digest — novelty
 * @param {Map<string,number>} opts.beatQuota  beat id → quota, for beatPriority
 * @param {number} opts.maxQuota
 * @param {number} opts.now       epoch ms
 * @param {number} [opts.maxAgeHours]
 */
export function scoreCluster(cluster, { seenUrls, beatQuota, maxQuota, now, maxAgeHours = 48 }) {
  const newest = cluster.items.reduce(
    (max, i) => Math.max(max, Date.parse(i.publishedAt || 0) || 0),
    0
  );
  const recency = recencyScore(newest ? new Date(newest).toISOString() : null, now, maxAgeHours);

  const tier = bestTier(cluster);
  const quality = sourceQuality(tier);

  const independentSources = Math.min(publisherDiversity(cluster), 3) / 3;

  const novel = cluster.items.every((i) => !seenUrls.has(i.url));
  const novelty = novel ? 1 : 0;

  const quota = cluster.beat ? beatQuota.get(cluster.beat) || 0 : 0;
  const beatPriority = maxQuota ? quota / maxQuota : 0;

  const diversity = publisherDiversity(cluster) / cluster.items.length;

  const score =
    recency * WEIGHTS.recency +
    quality * WEIGHTS.sourceQuality +
    independentSources * WEIGHTS.independentSources +
    novelty * WEIGHTS.novelty +
    beatPriority * WEIGHTS.beatPriority +
    diversity * WEIGHTS.publisherDiversity;

  return {
    score,
    breakdown: { recency, sourceQuality: quality, independentSources, novelty, beatPriority, publisherDiversity: diversity },
    bestTier: tier,
  };
}

/** "confirmed" needs a primary or newsroom tier plus a genuinely independent second
 *  publisher — the review's proposed bar, stated in code: 1 primary + 1 independent
 *  newsroom on the same cluster, not just "two links". */
export function confidenceOf(cluster) {
  const tiers = cluster.items.map((i) => i.tier ?? 4);
  const diversity = publisherDiversity(cluster);
  const hasStrongSource = tiers.some((t) => t <= 2);
  return diversity >= 2 && hasStrongSource ? 'confirmed' : 'single-source';
}

export { tierOf };
