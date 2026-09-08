import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rankedHeadlines, renderHeadlineRSS, renderNewsroom } from '../tools/lib/newsroom.mjs';
const site = JSON.parse(readFileSync(new URL('../input/site.json', import.meta.url)));
const items = [{ id: 'b', title: '<script>alert(1)</script>', beat: 'models', score: 0.2, sources: [{ publisher: 'A & B', url: 'https://example.test/?a=1&b=2' }] },
  { id: 'a', title: 'Another headline', beat: 'models', score: 0.2, sources: [{ publisher: 'Source', url: 'https://example.test/a' }] }];
const digest = { edition: { date: '2036-02-29', generatedAt: '2036-02-29T00:00:00Z' }, items };
const ctx = { site, latestDate: '2036-02-29', generatedAt: digest.edition.generatedAt, beatMap: new Map([['models', { label: 'Models' }]]), wireItems: [], harvestedAt: null };
const edition = { edition: { date: '2036-02-29' }, stories: [] };
test('homepage rankings are stable under tied scores and changed input order', () => {
  assert.deepEqual(rankedHeadlines(digest).map(i => i.id), ['a', 'b']);
  assert.deepEqual(rankedHeadlines({ items: [...items].reverse() }), rankedHeadlines(digest));
});
test('homepage escapes publisher titles and supports empty collections', () => {
  const html = renderNewsroom(ctx, digest, edition, null);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /No weekly briefing has been published/);
  assert.match(renderNewsroom(ctx, null, edition, null), /No digest is available/);
  assert.match(html, /id="models"/);
  assert.equal((html.match(/<h1>/g) || []).length, 1);
});
test('headline RSS escapes URLs and is reproducible without wall-clock time', () => {
  const rss = renderHeadlineRSS(site, digest);
  assert.match(rss, /a=1&amp;b=2/);
  assert.equal(rss, renderHeadlineRSS(site, digest));
  assert.ok(!rss.includes('Invalid Date'));
  assert.ok(!renderHeadlineRSS(site, null).includes('Invalid Date'));
});
