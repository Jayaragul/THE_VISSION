// Tests for the Tier 1.5 modules: classify.mjs, cluster.mjs, rank.mjs. These exist because
// the first real run of this pipeline produced a genuinely embarrassing result — a hip-hop
// album review filed under "Models" because its title happened to contain the word "open".
// The fix (an AI-relevance gate before classification, plus a minimum-overlap floor in the
// classifier itself) is encoded here so it cannot regress silently.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyBeat, tierOf, recencyScore } from '../tools/lib/classify.mjs';
import { clusterItems, publisherDiversity, bestTier } from '../tools/lib/cluster.mjs';
import { scoreCluster, confidenceOf, isInstitutional, substanceScore, urgencyScore } from '../tools/lib/rank.mjs';
import { isAiRelevant } from '../tools/lib/util.mjs';

const beats = [
  {
    id: 'models',
    label: 'Models',
    blurb: 'Frontier releases, benchmarks, capability jumps and deprecations.',
    quota: 3,
    queries: ['frontier model release this week', 'open weights model release'],
  },
  {
    id: 'business',
    label: 'Business',
    blurb: 'Funding, revenue, acquisitions, hiring and market structure.',
    quota: 2,
    queries: ['AI startup funding round announced', 'AI acquisition deal'],
  },
];

test('classifyBeat requires a real minimum overlap, not just being the best of a weak field — the regression case', () => {
  // The actual headline that got misfiled as "models" on the first real run, via the single
  // shared token "open" against the models beat's "open weights model release" query.
  const beat = classifyBeat(
    { title: 'Open Mike Eagle and Kenny Segal crafted a hip-hop breakup masterpiece', summary: '' },
    beats
  );
  assert.equal(beat, null);
});

test('classifyBeat correctly assigns a genuinely on-topic item', () => {
  const beat = classifyBeat(
    { title: 'Startup raises funding round for AI acquisition deal', summary: 'A financing announcement.' },
    beats
  );
  assert.equal(beat, 'business');
});

test('classifyBeat returns null for empty or unrelated text rather than forcing a guess', () => {
  assert.equal(classifyBeat({ title: '', summary: '' }, beats), null);
  assert.equal(classifyBeat({ title: 'Local weather forecast for the weekend', summary: '' }, beats), null);
});

// The 18 Aug 2026 coverage review: requiring two overlapping words of any kind discarded 59%
// of AI-relevant items, because a short headline has few chances to hit twice. These beats
// carry `keywords`, so a single curated, beat-unique term is allowed to decide.
const keyworded = [
  {
    id: 'models',
    label: 'Models',
    blurb: 'Frontier releases and benchmarks.',
    quota: 3,
    keywords: ['gemini', 'claude', 'weights', 'benchmark', 'model'],
    queries: ['open weights model release'],
  },
  {
    id: 'society',
    label: 'Society',
    blurb: 'Labour, security and public reaction.',
    quota: 1,
    keywords: ['deepfake', 'workers', 'survey', 'model'],
    queries: ['AI jobs impact study'],
  },
];

test('a single distinctive keyword classifies a headline too short to overlap twice', () => {
  // Three words, one keyword. Unmistakably a models story to any reader.
  assert.equal(classifyBeat({ title: 'Introducing Gemini 3.7 Flash', summary: '' }, keyworded), 'models');
  assert.equal(classifyBeat({ title: 'New deepfake rules', summary: '' }, keyworded), 'society');
});

test('a keyword two beats share is not decisive alone — it still needs a second match', () => {
  // "model" is in both beats' keywords, so it proves nothing on its own.
  assert.equal(classifyBeat({ title: 'A model appeared', summary: '' }, keyworded), null);
  // With a genuine second signal it resolves.
  assert.equal(classifyBeat({ title: 'A model benchmark appeared', summary: '' }, keyworded), 'models');
});

test('only curated keywords can be decisive — never a word that drifted in from a search query', () => {
  // "open" reaches the models vocabulary through the query "open weights model release", but
  // a word nobody chose as a classifier signal must not decide a story by itself. This is the
  // Open Mike Eagle bug restated: it is about provenance of the word, not its rarity.
  assert.equal(classifyBeat({ title: 'Open Mike Eagle drops a breakup record', summary: '' }, keyworded), null);
});

test('isAiRelevant is the gate that should have caught the regression case before classification ever ran', () => {
  assert.equal(isAiRelevant('Open Mike Eagle and Kenny Segal crafted a hip-hop breakup masterpiece'), false);
  assert.equal(isAiRelevant('Google releases new Gemini model'), true);
  assert.equal(isAiRelevant("There's a New Link Between Gut Health and Alzheimer's Disease"), false);
});

test('tierOf resolves a known publisher, an unknown one, and a blocked one distinctly', () => {
  const sourceBook = {
    publishers: [{ host: 'nvidia.com', name: 'NVIDIA', tier: 1 }],
    blocked: [{ host: 'x.com', reason: 'social posts are leads, not sources' }],
  };
  assert.deepEqual(tierOf({ url: 'https://blogs.nvidia.com/x' }, sourceBook), {
    tier: 1, host: 'blogs.nvidia.com', blocked: false, name: 'NVIDIA',
  });
  const unknown = tierOf({ url: 'https://example.com/x' }, sourceBook);
  assert.equal(unknown.tier, 4);
  assert.equal(unknown.blocked, false);
  const blocked = tierOf({ url: 'https://x.com/status/1' }, sourceBook);
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.tier, null);
});

test('recencyScore decays linearly to zero at the age ceiling and rejects future timestamps', () => {
  const now = Date.parse('2026-08-17T12:00:00Z');
  assert.equal(recencyScore(new Date(now).toISOString(), now, 48), 1);
  assert.ok(recencyScore(new Date(now - 24 * 3600000).toISOString(), now, 48) < 1);
  assert.equal(recencyScore(new Date(now - 100 * 3600000).toISOString(), now, 48), 0);
  assert.equal(recencyScore(new Date(now + 3600000).toISOString(), now, 48), 0); // future
  assert.equal(recencyScore(null, now, 48), 0);
});

test('clusterItems groups near-duplicate titles within the time window, keeps distinct stories apart', () => {
  const items = [
    { title: 'Google releases Gemini 3.7 Flash model update', publishedAt: '2026-08-17T10:00:00Z', tier: 1, publisher: 'Google' },
    { title: 'Google Gemini 3.7 Flash model launched today', publishedAt: '2026-08-17T12:00:00Z', tier: 2, publisher: 'TechCrunch' },
    { title: 'Nvidia announces new compute financing deal', publishedAt: '2026-08-17T09:00:00Z', tier: 1, publisher: 'NVIDIA' },
  ];
  const clusters = clusterItems(items, { similarity: 0.32, windowHours: 48 });
  assert.equal(clusters.length, 2);
  const gemini = clusters.find((c) => c.items.length === 2);
  assert.ok(gemini);
  assert.equal(publisherDiversity(gemini), 2);
});

test('clusterItems does not merge similar-sounding items outside the time window', () => {
  const items = [
    { title: 'Company announces new AI model release today', publishedAt: '2026-08-01T00:00:00Z', tier: 1, publisher: 'A' },
    { title: 'Company announces new AI model release today', publishedAt: '2026-08-17T00:00:00Z', tier: 1, publisher: 'A' },
  ];
  const clusters = clusterItems(items, { similarity: 0.32, windowHours: 48 });
  assert.equal(clusters.length, 2);
});

test('bestTier picks the strongest source in a cluster', () => {
  const cluster = { items: [{ tier: 3 }, { tier: 1 }, { tier: 2 }] };
  assert.equal(bestTier(cluster), 1);
});

test('confidenceOf requires a strong source AND two distinct publishers, not either alone', () => {
  // Two publishers, but neither is tier 1 or 2.
  assert.equal(
    confidenceOf({ items: [{ tier: 3, publisher: 'a' }, { tier: 4, publisher: 'b' }] }),
    'single-source'
  );
  // A strong source, but only one publisher.
  assert.equal(confidenceOf({ items: [{ tier: 1, publisher: 'a' }] }), 'single-source');
  // Both conditions met.
  assert.equal(
    confidenceOf({ items: [{ tier: 1, publisher: 'a' }, { tier: 2, publisher: 'b' }] }),
    'confirmed'
  );
});

test('scoreCluster produces a bounded, finite score and rewards independent confirmation', () => {
  const now = Date.parse('2026-08-17T12:00:00Z');
  const single = { items: [{ tier: 2, publisher: 'a', url: 'https://a.com/1', publishedAt: new Date(now).toISOString() }], beat: 'models' };
  const confirmed = {
    items: [
      { tier: 1, publisher: 'a', url: 'https://a.com/1', publishedAt: new Date(now).toISOString() },
      { tier: 2, publisher: 'b', url: 'https://b.com/1', publishedAt: new Date(now).toISOString() },
    ],
    beat: 'models',
  };
  const a = scoreCluster(single, { seenUrls: new Set(), now });
  const b = scoreCluster(confirmed, { seenUrls: new Set(), now });
  assert.ok(a.score >= 0 && a.score <= 1);
  assert.ok(b.score >= 0 && b.score <= 1);
  assert.ok(b.score > a.score, 'a tier-1+independently-confirmed cluster should outscore a lone tier-2 item');
});

test('scoreCluster scores a repeated URL as non-novel', () => {
  const now = Date.parse('2026-08-17T12:00:00Z');
  const cluster = { items: [{ tier: 1, publisher: 'a', url: 'https://a.com/1', publishedAt: new Date(now).toISOString() }], beat: 'models' };
  const fresh = scoreCluster(cluster, { seenUrls: new Set(), now });
  const repeat = scoreCluster(cluster, { seenUrls: new Set(['https://a.com/1']), now });
  assert.equal(fresh.breakdown.novelty, 1);
  assert.equal(repeat.breakdown.novelty, 0);
  assert.ok(repeat.score < fresh.score);
});

// --- significance vs trust -----------------------------------------------------------------
// The 18 Aug 2026 digest ranked OpenAI's own "Advancing responsible AI across Europe" (0.550)
// above WIRED's report on state legislation (0.467). The whole gap was sourceQuality: a company
// blog is the primary source for its own announcement, and the scoring treated "most primary"
// as "most important". These pin the corrected ordering.

const dayOld = (now) => new Date(now - 60 * 3600 * 1000).toISOString(); // outside the 48h window

test('an uncorroborated company post ranks below independent reporting of the same age', () => {
  const now = Date.parse('2026-08-18T12:00:00Z');
  const corporate = {
    items: [{ tier: 1, publisher: 'OpenAI', url: 'https://openai.com/index/responsible-ai-europe', title: 'Advancing responsible AI across Europe', publishedAt: dayOld(now) }],
    beat: 'society',
  };
  const journalism = {
    items: [{ tier: 2, publisher: 'WIRED', url: 'https://www.wired.com/story/marrying-chatbots', title: 'People Are Marrying Chatbots. These Lawmakers Want to Stop Them', publishedAt: dayOld(now) }],
    beat: 'policy',
  };
  const c = scoreCluster(corporate, { seenUrls: new Set(), now });
  const j = scoreCluster(journalism, { seenUrls: new Set(), now });
  assert.equal(c.breakdown.uncorroboratedFirstParty, true);
  // A lone tier-2 newsroom story is a scoop, not a company announcing itself. Penalising it
  // would punish the independent reporting this term exists to promote.
  assert.equal(j.breakdown.uncorroboratedFirstParty, false);
  assert.ok(
    j.score > c.score,
    `independent reporting (${j.score.toFixed(3)}) must outrank an uncorroborated company post (${c.score.toFixed(3)})`
  );
});

test('a lone tier-2 newsroom story is a scoop, not a first-party announcement', () => {
  const now = Date.parse('2026-08-18T12:00:00Z');
  const scoop = {
    items: [{ tier: 2, publisher: 'The Information', url: 'https://theinformation.com/articles/x', title: 'A lab quietly halted its frontier run', publishedAt: dayOld(now) }],
    beat: 'models',
  };
  assert.equal(scoreCluster(scoop, { seenUrls: new Set(), now }).breakdown.uncorroboratedFirstParty, false);
});

test('institutional primaries are exempt from the first-party penalty — a paper is meant to be single-source', () => {
  const now = Date.parse('2026-08-18T12:00:00Z');
  const paper = {
    items: [{ tier: 1, publisher: 'arXiv', url: 'https://arxiv.org/abs/2608.16834v1', title: 'Model Hypnosis: Strong control of AI via additive subliminal effects', publishedAt: dayOld(now) }],
    beat: 'research',
  };
  const companyPost = {
    items: [{ tier: 1, publisher: 'OpenAI', url: 'https://openai.com/index/a-programme', title: 'Model Hypnosis: Strong control of AI via additive subliminal effects', publishedAt: dayOld(now) }],
    beat: 'research',
  };
  assert.equal(scoreCluster(paper, { seenUrls: new Set(), now }).breakdown.uncorroboratedFirstParty, false);
  assert.equal(scoreCluster(companyPost, { seenUrls: new Set(), now }).breakdown.uncorroboratedFirstParty, true);
});

test('isInstitutional matches gov.uk, which has no leading dot before "gov"', () => {
  assert.equal(isInstitutional('https://www.gov.uk/government/news/x'), true);
  assert.equal(isInstitutional('https://aisi.gov.uk/research'), true);
  assert.equal(isInstitutional('https://ftc.gov/press'), true);
  assert.equal(isInstitutional('https://arxiv.org/abs/1'), true);
  assert.equal(isInstitutional('https://openai.com/index/x'), false);
  assert.equal(isInstitutional('https://blog.google/technology/ai/x'), false);
});

test('substanceScore stays inside 0–1 when every signal fires at once', () => {
  // Every positive.
  assert.equal(substanceScore('Nvidia guarantees $105bn for a 8 gigawatt site'), 1);
  // Every negative, including the first-party penalty.
  assert.equal(
    substanceScore('Advancing our commitment, celebrating the journey', { uncorroboratedFirstParty: true }),
    0
  );
  // Neutral headline sits in the middle.
  assert.equal(substanceScore('Neurosymbolic Embodied Agents'), 0.5);
});

test('the beat no longer biases the score — balance is enforced by the per-beat cap alone', () => {
  const now = Date.parse('2026-08-18T12:00:00Z');
  const item = { tier: 2, publisher: 'a', url: 'https://a.com/1', title: 'A company raises $40m', publishedAt: new Date(now).toISOString() };
  const asModels = scoreCluster({ items: [item], beat: 'models' }, { seenUrls: new Set(), now });
  const asPolicy = scoreCluster({ items: [item], beat: 'policy' }, { seenUrls: new Set(), now });
  assert.equal(asModels.score, asPolicy.score);
});

test('urgencyScore ranks an outage above a release, and both above routine news', () => {
  assert.equal(urgencyScore('GitHub is down for many users'), 1);
  assert.equal(urgencyScore('Cloudflare reports a major outage'), 1);
  assert.equal(urgencyScore('Anthropic releases Claude Opus 5'), 0.6);
  assert.equal(urgencyScore('Regulators weigh new rules for AI firms'), 0);
});

// "down" is the whole reason this term needed care: the financial sense is far more common in
// a headline than the outage sense, and matching it bare made every market story breaking news.
test('urgencyScore does not treat the financial sense of "down" as an outage', () => {
  assert.equal(urgencyScore('Nvidia shares close down 3% on chip export news'), 0);
  assert.equal(urgencyScore('Inference costs come down as competition bites'), 0);
  assert.equal(urgencyScore('AWS is down across several regions'), 1);
});

test('urgency expires with recency — stale breaking news is no longer urgent', () => {
  assert.equal(urgencyScore('GitHub is down', 1), 1);
  assert.equal(urgencyScore('GitHub is down', 0.5), 0.5);
  // Outside the lookback window recency is 0, so nothing is urgent regardless of wording.
  assert.equal(urgencyScore('GitHub is down', 0), 0);
});

test('a fresh outage outranks an equally-sourced routine story', () => {
  const now = Date.parse('2026-08-21T12:00:00Z');
  const at = new Date(now - 3600000).toISOString();
  const mk = (title) => ({
    items: [
      { tier: 2, publisher: 'a', url: `https://a.com/${title.length}`, title, publishedAt: at },
      { tier: 2, publisher: 'b', url: `https://b.com/${title.length}`, title, publishedAt: at },
    ],
  });
  const outage = scoreCluster(mk('GitHub is down for many users worldwide'), { seenUrls: new Set(), now });
  const routine = scoreCluster(mk('Analysts weigh the outlook for AI spending'), { seenUrls: new Set(), now });
  assert.ok(
    outage.score > routine.score,
    `a live outage (${outage.score.toFixed(3)}) must outrank routine analysis (${routine.score.toFixed(3)})`
  );
});

// "launch" and "release" are nouns as often as verbs in a headline, and the noun sense points
// backwards at something that already happened — the opposite of urgent.
test('urgencyScore ignores the past-event noun sense of launch and release', () => {
  assert.equal(urgencyScore('A third of web pages published since ChatGPT’s launch show AI signs'), 0);
  assert.equal(urgencyScore('Investors position ahead of the release'), 0);
  // The verb senses still count, including the infinitive.
  assert.equal(urgencyScore('OpenAI launches GPT-5.7'), 0.6);
  assert.equal(urgencyScore('Meta to launch its next open-weights model'), 0.6);
});
