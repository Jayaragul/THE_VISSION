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
  corroboration: 0.26,
  substance: 0.2,
  // freshness
  urgency: 0.12,
  recency: 0.18,
  // trust
  sourceQuality: 0.16,
  // hygiene
  novelty: 0.06,
  publisherDiversity: 0.02,
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

// --- urgency ---------------------------------------------------------------
//
// Two kinds of story a reader wants at the top of the page the hour it happens: something is
// broken, or something shipped. Everything else can wait for the scroll.
//
// "down" is deliberately not matched bare. Headlines say "shares down 3%" and "costs come
// down" far more often than "GitHub is down", so the outage sense is required to appear as a
// verb phrase or alongside an unambiguous word like outage or offline.
const BREAKING =
  /\b(outage|offline|degraded|disruption|downtime|breach\w*|hacked|compromis\w+|exploit(ed|ing|s)?\b|zero.?day|vulnerabilit\w+|CVE-\d)\b|\b(is|are|was|were|went|goes|going)\s+down\b|\bdown\s+for\b/i;

// A capability actually reaching users. Distinct from EVENT_VERB, which is a broad
// "something happened" signal covering lawsuits, funding and departures too.
// Verb forms only. A bare "launch" or "release" is usually a noun pointing at a past event —
// "since ChatGPT's launch", "ahead of the release" — and matching it made retrospectives read
// as breaking news. Infinitives are kept via the explicit to/will forms.
const RELEASE = new RegExp(
  [
    '\\b(releases|released|releasing)\\b',
    '\\b(launches|launched|launching)\\b',
    '\\b(ships|shipped|shipping)\\b',
    '\\b(?:to|will|set to)\\s+(?:launch|release|ship|roll out)\\b',
    '\\bintroduc(es|ing)\\b',
    '\\bunveil(s|ed|ing)\\b',
    '\\b(now|generally) available\\b',
    '\\bgeneral availability\\b',
    '\\bavailable (?:now|today)\\b',
    '\\bopen.?weights?\\b',
    '\\bopen.?sourc(es|ed|ing)\\b',
    '\\broll(s|ed|ing)? out\\b',
  ].join('|'),
  'i'
);

/**
 * How much this wants to be at the top of the page right now, 0–1.
 *
 * Multiplied by recency rather than added to it, so urgency expires on its own: an outage
 * reported forty hours ago is history, not breaking news, and a release announced last week
 * has already been read. A stale item scores 0 here no matter which words it contains.
 */
export function urgencyScore(title, recency = 1) {
  const text = String(title || '');
  let base = 0;
  if (BREAKING.test(text)) base = 1;
  else if (RELEASE.test(text)) base = 0.6;
  return base * Math.max(0, Math.min(1, recency));
}

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

  // An empty cluster would make this NaN, and NaN is uniquely destructive here: every
  // comparison against it is false, so a NaN score does not sort to an end — it silently
  // freezes the surrounding order wherever it lands. Score it 0 instead.
  const diversity = cluster.items.length ? publishers / cluster.items.length : 0;

  const urgency = urgencyScore(top?.title, recency);

  const score =
    corroboration * WEIGHTS.corroboration +
    substance * WEIGHTS.substance +
    urgency * WEIGHTS.urgency +
    recency * WEIGHTS.recency +
    quality * WEIGHTS.sourceQuality +
    novelty * WEIGHTS.novelty +
    diversity * WEIGHTS.publisherDiversity;

  return {
    score,
    breakdown: {
      corroboration,
      substance,
      urgency,
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

// On 30 Sep 2026, the single highest-scored item across the whole digest was an arXiv
// preprint, "Neural topology optimization of ship structures under propulsion machinery
// vibrations" (score 0.588) — a real, legitimate result, and an indefensible choice for the
// one story a general AI briefing leads with. scoreCluster() isn't wrong for what it ranks
// the whole digest on; it was never asked the narrower question a front-page hero needs
// answered.
//
// This is a gate on top of the existing score, not a second score. Building a parallel
// "FrontPageScore" formula risks drifting out of sync with the DigestScore it would have to
// duplicate; this instead asks one additional, narrower question using functions already
// exported above.
//
// The gate keys on "sole tier-1 source", not isInstitutional() — tested against that same
// digest and nearly caught the same gap from the other direction. Tier 1 in this system
// means "primary for its own story", which in practice is always one of two shapes: an
// institutional primary (a paper, a filing — isInstitutional()'s whole list) or a company's
// own account of itself. isInstitutional() exists in scoreCluster() to stop the SCORE
// unfairly punishing the first shape for being single-source, which is normal for a paper.
// But a front-page hero has no reason to treat those two shapes differently — "a company
// marketing article with no wider significance" leading the page is exactly as indefensible
// as a solo paper, and isInstitutional() is defined to never match a company's own domain,
// so gating on it alone leaves every sole company post structurally exempt. Confirmed live:
// the actual runner-up for 30 Sep's hero was a sole AWS blog post ("Introducing Anthropic
// models on Amazon Bedrock...", score 0.572) that the narrower, institutional-only version
// of this gate would have waved through unconditionally. It happens to still clear the
// escape hatch below on its own merits (its title matches RELEASE), so today's actual hero
// doesn't change — but the next one with a neutral announcement title would have slipped
// through on a technicality, not a judgement.
/**
 * Is this item allowed to be the front page's one "Top story"?
 *
 * A confirmed item is always eligible — two independent publishers already did the
 * generality check scoreCluster() itself cannot do alone. A single-source item whose one
 * source is NOT tier 1 stays eligible too — a tier-2/3 scoop is independent reporting, not
 * a primary speaking for itself, the same distinction uncorroboratedFirstParty draws in
 * scoreCluster(). The gate only fires on the specific combination this was built for: sole
 * tier-1 source, and nothing in the title reads as urgent or substantial — the ship-
 * structures case (and the Bedrock near-miss), not "FTC bans X" or "a lab discloses a
 * breach", both of which clear the escape hatch below via their own EVENT_VERB/BREAKING
 * matches.
 */
export function heroEligible(item) {
  if (item.confidence === 'confirmed') return true;
  const sources = item.sources || [];
  const soleFirstParty = sources.length === 1 && (sources[0]?.tier ?? 4) === 1;
  if (!soleFirstParty) return true;
  const urgency = urgencyScore(item.title, 1);
  const substance = substanceScore(item.title, { uncorroboratedFirstParty: true });
  return urgency > 0 || substance > 0.5;
}

export { tierOf };
