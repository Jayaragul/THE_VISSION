// Tests for the Tier 1.5 modules: classify.mjs, cluster.mjs, rank.mjs. These exist because
// the first real run of this pipeline produced a genuinely embarrassing result — a hip-hop
// album review filed under "Models" because its title happened to contain the word "open".
// The fix (an AI-relevance gate before classification, plus a minimum-overlap floor in the
// classifier itself) is encoded here so it cannot regress silently.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyBeat, tierOf, recencyScore } from '../tools/lib/classify.mjs';
import { clusterItems, publisherDiversity, bestTier } from '../tools/lib/cluster.mjs';
import { scoreCluster, confidenceOf } from '../tools/lib/rank.mjs';
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
  const beatQuota = new Map([['models', 3], ['business', 2]]);
  const single = { items: [{ tier: 2, publisher: 'a', url: 'https://a.com/1', publishedAt: new Date(now).toISOString() }], beat: 'models' };
  const confirmed = {
    items: [
      { tier: 1, publisher: 'a', url: 'https://a.com/1', publishedAt: new Date(now).toISOString() },
      { tier: 2, publisher: 'b', url: 'https://b.com/1', publishedAt: new Date(now).toISOString() },
    ],
    beat: 'models',
  };
  const a = scoreCluster(single, { seenUrls: new Set(), beatQuota, maxQuota: 3, now });
  const b = scoreCluster(confirmed, { seenUrls: new Set(), beatQuota, maxQuota: 3, now });
  assert.ok(a.score >= 0 && a.score <= 1);
  assert.ok(b.score >= 0 && b.score <= 1);
  assert.ok(b.score > a.score, 'a tier-1+independently-confirmed cluster should outscore a lone tier-2 item');
});

test('scoreCluster scores a repeated URL as non-novel', () => {
  const now = Date.parse('2026-08-17T12:00:00Z');
  const beatQuota = new Map([['models', 3]]);
  const cluster = { items: [{ tier: 1, publisher: 'a', url: 'https://a.com/1', publishedAt: new Date(now).toISOString() }], beat: 'models' };
  const fresh = scoreCluster(cluster, { seenUrls: new Set(), beatQuota, maxQuota: 3, now });
  const repeat = scoreCluster(cluster, { seenUrls: new Set(['https://a.com/1']), beatQuota, maxQuota: 3, now });
  assert.equal(fresh.breakdown.novelty, 1);
  assert.equal(repeat.breakdown.novelty, 0);
  assert.ok(repeat.score < fresh.score);
});
