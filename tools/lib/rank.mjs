// Scores an event cluster. Every input is something a machine can actually measure — a
// timestamp, a tier lookup, a set of URLs already seen, words present in a headline —
// deliberately excluding anything that would require judging what a story means. That is
// Tier 1.5's whole premise: rank mathematically, and let the confidence label say what the
// ranking cannot.
//
// The weights are grouped into three axes, because conflating them was a real defect. On the
// 18 Aug 2026 digest, OpenAI's own "Advancing responsible AI across Europe" scored 0.550 and
// WIRED's report on state legislation scored 0.467 — the entire gap was sourceQuality, then
// 25% of the score. A company blog is maximally *verifiable* (it is the primary source) and
// frequently minimally *important*, and the old scoring had no term for the second thing at
// all. The same run put twelve raw arXiv preprints at the top of the digest for the same
// reason, helped by a beatPriority term that handed the models beat a free advantage.
//
//   significance — corroboration + substance : does this matter
//   freshness    — recency                   : is it new
//   trust        — sourceQuality             : can it be verified
//
// Freshness and trust are deliberately no longer dominant. Nothing here claims to know what a
// story means; it claims to know how many independent outlets thought it was worth writing up
// and whether the headline states something concrete.

import { hostOf } from './util.mjs';
import { recencyScore, tierOf } from './classify.mjs';
import { bestTier, publisherDiversity } from './cluster.mjs';

const WEIGHTS = {
  // significance
  corroboration: 0.28,
  substance: 0.22,
  // freshness
  recency: 0.2,
  // trust
  sourceQuality: 0.18,
  // hygiene
  novelty: 0.08,
  publisherDiversity: 0.04,
};

function sourceQuality(tier) {
  // tier 1 → 1.0, tier 2 → 0.667, tier 3 → 0.333, tier 4 → 0
  return Math.max(0, 1 - (tier - 1) / 3);
}

// Primaries that are legitimately single-publisher: a paper, a filing, a docket, a regulator's
// notice. Nobody else republishes them and nobody needs to. These are exempt from the
// uncorroborated-announcement penalty below — without the exemption that penalty would demote
// every research item in the paper, which is the opposite of the intent.
//
// Derived from hosts already in input/sources.json rather than a new field there. The (^|\.)
// anchor matters: a plain \.gov would miss gov.uk, which has no leading dot.
const INSTITUTIONAL =
  /(^|\.)gov(\.[a-z]{2})?$|^(arxiv\.org|nature\.com|science\.org|europa\.eu|courtlistener\.com)$/;

export function isInstitutional(url) {
  return INSTITUTIONAL.test(hostOf(url) || '');
}

// A headline that states a quantity with a unit is usually reporting something that happened.
// "$105bn", "84.5%", "4.25 gigawatts", "27B parameters", "70,000 GPUs".
const QUANTITY = /\$\s?\d|\d+(\.\d+)?\s?%|\b\d[\d,.]*\s?(bn|billion|million|trillion|[kmb]\b|gw|mw|gigawatt|megawatt|parameter|token)/i;

// Perfective event verbs: something occurred. News uses these.
const EVENT_VERB =
  /\b(release[sd]?|launch(e[sd])?|ship[sp]?(ed|s)?|raise[sd]?|acquire[sd]?|buy[s]?|bought|sue[sd]?|ban[s|ned]?|fine[sd]?|resign[s|ed]?|shut[s]?|halt[s|ed]?|pause[sd]?|delay[s|ed]?|guarantee[sd]?|invest[s|ed]?|win[s]?|won|lose[s]?|lost|file[sd]?|open[s|ed]?|cut[s]?|drop[s|ped]?|block[s|ed]?|approve[sd]?|reject[s|ed]?|overtak(e|es|ing)|surge[sd]?|top[s|ped]?)\b/i;

// Progressive and aspirational verbs, and the vocabulary of a corporate programme post rather
// than an event. "Advancing responsible AI across Europe", "How AI is expanding what people do
// at work", "Univé builds an AI-ready workforce" — all real digest entries from 18 Aug 2026.
const CORPORATE_COMMS =
  /\b(advancing|working with|partnering|partners with|celebrat\w*|our commitment|committed to|expanding what|builds? an?\b|join us|introducing our|spotlight|ways to|how we|unlocking|empower\w*|reimagin\w*|journey|thrilled|excited to)\b/i;

/** Deterministic proxy for "is this a story or an announcement". Neutral at 0.5, clamped 0–1. */
export function substanceScore(title, { uncorroboratedFirstParty = false } = {}) {
  const text = String(title || '');
  let s = 0.5;
  if (QUANTITY.test(text)) s += 0.25;
  if (EVENT_VERB.test(text)) s += 0.25;
  if (CORPORATE_COMMS.test(text)) s -= 0.3;
  if (uncorroboratedFirstParty) s -= 0.25;
  return Math.min(1, Math.max(0, s));
}

/** The headline the digest will actually print: strongest source first, then most recent. */
function bestItem(cluster) {
  return [...cluster.items].sort(
    (a, b) => (a.tier ?? 4) - (b.tier ?? 4) || Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0)
  )[0];
}

/**
 * @param {object} cluster        from clusterItems()
 * @param {object} opts
 * @param {Set<string>} opts.seenUrls    URLs already published in a prior digest — novelty
 * @param {number} opts.now       epoch ms
 * @param {number} [opts.maxAgeHours]
 */
export function scoreCluster(cluster, { seenUrls, now, maxAgeHours = 48 }) {
  const newest = cluster.items.reduce(
    (max, i) => Math.max(max, Date.parse(i.publishedAt || 0) || 0),
    0
  );
  const recency = recencyScore(newest ? new Date(newest).toISOString() : null, now, maxAgeHours);

  const tier = bestTier(cluster);
  const quality = sourceQuality(tier);

  const publishers = publisherDiversity(cluster);
  const corroboration = Math.min(publishers, 3) / 3;

  const novel = cluster.items.every((i) => !seenUrls.has(i.url));
  const novelty = novel ? 1 : 0;

  // One publisher, and it is the company the news is about — a company blog only ever writes
  // about itself, so a single first-party source means nobody independent thought it was worth
  // covering. A real launch is picked up within the lookback window; a programme post is not.
  //
  // All three conditions are load-bearing. `tier === 1` is what makes the source first-party at
  // all: a lone tier-2 newsroom story is a scoop, not an announcement, and penalising it would
  // punish exactly the independent reporting this term exists to promote. The institutional
  // exemption then spares papers, filings and regulators, which are single-publisher by nature.
  const top = bestItem(cluster);
  const uncorroboratedFirstParty = publishers < 2 && tier === 1 && !isInstitutional(top?.url);
  const substance = substanceScore(top?.title, { uncorroboratedFirstParty });

  const diversity = publishers / cluster.items.length;

  const score =
    corroboration * WEIGHTS.corroboration +
    substance * WEIGHTS.substance +
    recency * WEIGHTS.recency +
    quality * WEIGHTS.sourceQuality +
    novelty * WEIGHTS.novelty +
    diversity * WEIGHTS.publisherDiversity;

  return {
    score,
    breakdown: {
      corroboration,
      substance,
      recency,
      sourceQuality: quality,
      novelty,
      publisherDiversity: diversity,
      uncorroboratedFirstParty,
    },
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
