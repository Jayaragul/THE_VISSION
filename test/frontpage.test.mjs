import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectFrontPage } from '../tools/lib/frontpage.mjs';

const story = (title, confidence = 'single-source', url = 'https://example.com/story') => ({
  title, confidence, sources: [{ url, tier: 2 }],
});

test('the visible front page replaces a second report about the same event', () => {
  const lead = story('Google’s Genie 4 world model adds audio, more realistic worlds, and real-time steering', 'confirmed');
  const duplicate = story('DeepMind unveils Genie 4 world model promising more realistic physics and humans');
  const other = story('Apple rolls out new Siri languages and security fixes');
  const next = story('Delaware plan would let AI agents run entire businesses');
  const result = selectFrontPage([lead, duplicate, other, next]);
  assert.equal(result.hero, lead);
  assert.deepEqual(result.rail, [other, next]);
});

test('front-page selection handles an empty digest and excludes arXiv from the rail', () => {
  assert.deepEqual(selectFrontPage([]), { hero: null, rail: [] });
  const lead = story('AI company releases a new coding tool', 'confirmed');
  const paper = story('New preprint studies coding tools', 'single-source', 'https://arxiv.org/abs/123');
  assert.deepEqual(selectFrontPage([lead, paper]), { hero: lead, rail: [] });
});
