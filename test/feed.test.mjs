// Real-world-shaped fixtures, not synthetic minimal cases — tools/lib/feed.mjs is a
// regex parser standing in for a real XML library, and the way it breaks is on the messy
// formatting actual publishers use, not on textbook RSS.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed } from '../tools/lib/feed.mjs';
import { accumulateHealth, summarizeHealth } from '../tools/lib/feedhealth.mjs';

test('parses RSS 2.0 with CDATA titles and a plain-text <link>', () => {
  const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
<title>Example Feed</title>
<item>
  <title><![CDATA[OpenAI ships GPT-5.6 "Sol"]]></title>
  <link>https://example.com/gpt-5-6-sol</link>
  <pubDate>Mon, 17 Aug 2026 09:06:20 GMT</pubDate>
  <description><![CDATA[<p>A model that does things.</p>]]></description>
</item>
</channel></rss>`;
  const items = parseFeed(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'OpenAI ships GPT-5.6 "Sol"');
  assert.equal(items[0].url, 'https://example.com/gpt-5-6-sol');
  assert.equal(items[0].publishedAt, new Date('Mon, 17 Aug 2026 09:06:20 GMT').toISOString());
  assert.equal(items[0].summary, 'A model that does things.');
});

test('parses Atom with self-closing <link href> and <published>', () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<entry>
  <title>Introducing Gemini 3.7 Flash</title>
  <link href="https://blog.google/gemini-3-7-flash/" rel="alternate"/>
  <link href="https://blog.google/feed.xml" rel="self"/>
  <published>2026-08-13T17:04:18Z</published>
  <summary>A workhorse model for coding and agents.</summary>
</entry>
</feed>`;
  const items = parseFeed(xml);
  assert.equal(items.length, 1);
  // Must prefer rel="alternate" over rel="self" — picking the feed's own URL as the
  // article link would point every single entry at the same wrong page.
  assert.equal(items[0].url, 'https://blog.google/gemini-3-7-flash/');
  assert.equal(items[0].publishedAt, '2026-08-13T17:04:18.000Z');
});

test('Atom entry with a single unadorned <link> (no rel attribute at all)', () => {
  const xml = `<feed><entry>
  <title>Some model release</title>
  <link href="https://example.com/post"/>
  <updated>2026-08-01T00:00:00Z</updated>
</entry></feed>`;
  const items = parseFeed(xml);
  assert.equal(items[0].url, 'https://example.com/post');
});

test('decodes HTML entities and strips inner markup from summaries', () => {
  const xml = `<rss><channel><item>
  <title>Anthropic &amp; OpenAI clash</title>
  <link>https://example.com/a</link>
  <description>&lt;p&gt;It&#8217;s a &ldquo;big&rdquo; deal &mdash; really.&lt;/p&gt;</description>
</item></channel></rss>`;
  const items = parseFeed(xml);
  assert.equal(items[0].title, 'Anthropic & OpenAI clash');
  assert.match(items[0].summary, /It’s a “big” deal — really\./);
});

test('drops an item with no title or no resolvable link, keeps the rest', () => {
  const xml = `<rss><channel>
<item><title>No link here</title></item>
<item><link>https://example.com/no-title</link></item>
<item><title>Fine</title><link>https://example.com/fine</link></item>
</channel></rss>`;
  const items = parseFeed(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Fine');
});

test('arXiv-shaped Atom entry (namespaced elements, id as a URL)', () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
<entry>
  <id>https://arxiv.org/abs/2608.14539v1</id>
  <title>  Multi-Agent Communication Topologies  </title>
  <summary>  We study communication graphs between LLM agents.  </summary>
  <published>2026-08-14T12:00:00Z</published>
  <link href="https://arxiv.org/abs/2608.14539v1" rel="alternate" type="text/html"/>
  <link title="pdf" href="https://arxiv.org/pdf/2608.14539v1" rel="related" type="application/pdf"/>
</entry>
</feed>`;
  const items = parseFeed(xml);
  assert.equal(items.length, 1);
  // Whitespace-padded fields (very common in arXiv's actual feed) must be trimmed.
  assert.equal(items[0].title, 'Multi-Agent Communication Topologies');
  // Prefers alternate over a related/pdf link.
  assert.equal(items[0].url, 'https://arxiv.org/abs/2608.14539v1');
});

test('malformed input degrades to zero items rather than throwing', () => {
  assert.deepEqual(parseFeed(''), []);
  assert.deepEqual(parseFeed(null), []);
  assert.deepEqual(parseFeed('<not-even-xml'), []);
  assert.deepEqual(parseFeed('plain text, no tags at all'), []);
});

test('an unparseable pubDate yields a null publishedAt, not a crash or "Invalid Date"', () => {
  const xml = `<rss><channel><item>
  <title>Weird date</title>
  <link>https://example.com/x</link>
  <pubDate>not a real date</pubDate>
</item></channel></rss>`;
  const items = parseFeed(xml);
  assert.equal(items[0].publishedAt, null);
});

// --- accumulateHealth -------------------------------------------------------
// Regression coverage for the bug tools/harvest.mjs shipped with for its entire history:
// readJSON was called without being imported, the resulting ReferenceError was swallowed by
// a bare catch, and every run silently started from an empty health map — so
// consecutiveFailures could never exceed 1 for any feed, no matter how long it had actually
// been failing. These exercise the pure accumulation step in isolation, with no network and
// no filesystem, which is the only way to actually prove counters survive across runs.

test('a failing feed accumulates consecutiveFailures and totalRuns across two runs', () => {
  const { health: after1 } = accumulateHealth(
    {},
    [{ id: 'TechCrunch', feed: 'TechCrunch', ok: false, count: 0, error: 'HTTP 429' }],
    { deadAfter: 8, now: '2026-09-07T00:00:00.000Z' }
  );
  assert.deepEqual(after1.TechCrunch, {
    feed: 'TechCrunch',
    consecutiveFailures: 1,
    consecutiveEmpty: 0,
    totalRuns: 1,
    lastOk: null,
    lastError: 'HTTP 429',
    lastCount: 0,
  });

  const { health: after2 } = accumulateHealth(
    after1,
    [{ id: 'TechCrunch', feed: 'TechCrunch', ok: false, count: 0, error: 'HTTP 429' }],
    { deadAfter: 8, now: '2026-09-07T06:00:00.000Z' }
  );
  // This is the exact regression: with the bug, `prev` would default to {consecutiveFailures:
  // 0, totalRuns: 0} every run, so this would read 1 and 1 again instead of 2 and 2.
  assert.equal(after2.TechCrunch.consecutiveFailures, 2);
  assert.equal(after2.TechCrunch.totalRuns, 2);
});

test('a success resets consecutiveFailures to 0 but keeps totalRuns climbing, and preserves lastOk on a later failure', () => {
  let { health } = accumulateHealth(
    {},
    [{ id: 'WIRED', feed: 'WIRED', ok: true, count: 12 }],
    { deadAfter: 8, now: '2026-09-07T00:00:00.000Z' }
  );
  assert.equal(health.WIRED.lastOk, '2026-09-07T00:00:00.000Z');

  ({ health } = accumulateHealth(health, [{ id: 'WIRED', feed: 'WIRED', ok: false, count: 0, error: 'timeout' }], {
    deadAfter: 8,
    now: '2026-09-07T06:00:00.000Z',
  }));
  assert.equal(health.WIRED.consecutiveFailures, 1);
  assert.equal(health.WIRED.totalRuns, 2);
  // Carries forward the last known-good timestamp rather than losing it — this is exactly
  // what silently broke when `prev` was always the zero default: lastOk would jump straight
  // to null instead of remembering the feed had, in fact, worked six hours earlier.
  assert.equal(health.WIRED.lastOk, '2026-09-07T00:00:00.000Z');
});

test('feeds sharing a display name but not an id keep independent histories (the Google News collision)', () => {
  const runs = [
    { id: 'google-news:Gemini AI model Google DeepMind', feed: 'Google News', ok: false, count: 0, error: 'HTTP 429' },
    { id: 'google-news:Anthropic Claude announcement', feed: 'Google News', ok: true, count: 5 },
  ];
  const { health } = accumulateHealth({}, runs, { deadAfter: 8, now: '2026-09-07T00:00:00.000Z' });

  assert.equal(Object.keys(health).length, 2, 'nine queries must produce nine records, not one shared record');
  assert.equal(health['google-news:Gemini AI model Google DeepMind'].consecutiveFailures, 1);
  assert.equal(health['google-news:Anthropic Claude announcement'].consecutiveFailures, 0);
  // Both display as "Google News" — that's fine, the id is what keeps them apart.
  assert.equal(health['google-news:Gemini AI model Google DeepMind'].feed, 'Google News');
});

test('crossing deadAfter surfaces the feed in `dead`, and a success clears it', () => {
  let health = {};
  let dead;
  for (let i = 0; i < 8; i++) {
    ({ health, dead } = accumulateHealth(health, [{ id: 'MIT Technology Review', feed: 'MIT Technology Review', ok: false, count: 0, error: 'HTTP 403' }], {
      deadAfter: 8,
    }));
  }
  assert.equal(dead.length, 1);
  assert.equal(dead[0].id, 'MIT Technology Review');
  assert.equal(dead[0].consecutiveFailures, 8);

  ({ health, dead } = accumulateHealth(health, [{ id: 'MIT Technology Review', feed: 'MIT Technology Review', ok: true, count: 3 }], {
    deadAfter: 8,
  }));
  assert.equal(dead.length, 0);
  assert.equal(health['MIT Technology Review'].consecutiveFailures, 0);
});

// --- the failure consecutiveFailures structurally cannot see ------------------
// A feed answering 200 with an empty body is reachable and contributing nothing. Every
// failure counter in this file resets on a 200, so this state is invisible to all of them —
// which is why it gets its own counter. One of the nine Google News queries was sitting in
// exactly this state, undetected, when the check was written.

test('a feed returning 200 with zero items accrues consecutiveEmpty while consecutiveFailures stays 0', () => {
  let health = {};
  for (let i = 0; i < 3; i++) {
    ({ health } = accumulateHealth(health, [{ id: 'google-news:stealth launch', feed: 'Google News', ok: true, count: 0 }], {
      deadAfter: 8,
    }));
  }
  assert.equal(health['google-news:stealth launch'].consecutiveEmpty, 3);
  // The whole point: by every existing measure this feed looks perfectly healthy.
  assert.equal(health['google-news:stealth launch'].consecutiveFailures, 0);
  assert.equal(health['google-news:stealth launch'].totalRuns, 3);
});

test('one non-empty fetch resets consecutiveEmpty, and a failure does not count as empty', () => {
  let { health } = accumulateHealth({}, [{ id: 'WIRED', feed: 'WIRED', ok: true, count: 0 }], { deadAfter: 8 });
  assert.equal(health.WIRED.consecutiveEmpty, 1);

  ({ health } = accumulateHealth(health, [{ id: 'WIRED', feed: 'WIRED', ok: true, count: 7 }], { deadAfter: 8 }));
  assert.equal(health.WIRED.consecutiveEmpty, 0);

  // A failed fetch is a failure, not an empty success — it must not inflate both counters.
  ({ health } = accumulateHealth(health, [{ id: 'WIRED', feed: 'WIRED', ok: false, count: 0, error: 'HTTP 429' }], { deadAfter: 8 }));
  assert.equal(health.WIRED.consecutiveFailures, 1);
  assert.equal(health.WIRED.consecutiveEmpty, 0);
});

test('a feed removed from FEEDS drops out of the health file instead of lingering forever', () => {
  let { health } = accumulateHealth(
    {},
    [
      { id: 'VentureBeat', feed: 'VentureBeat', ok: false, count: 0, error: 'HTTP 429' },
      { id: 'WIRED', feed: 'WIRED', ok: true, count: 9 },
    ],
    { deadAfter: 8 }
  );
  assert.equal(Object.keys(health).length, 2);

  // Next run, VentureBeat is gone from FEEDS, so it is absent from `runs` entirely.
  ({ health } = accumulateHealth(health, [{ id: 'WIRED', feed: 'WIRED', ok: true, count: 9 }], { deadAfter: 8 }));
  assert.deepEqual(Object.keys(health), ['WIRED']);
  // WIRED's own history is untouched by the pruning.
  assert.equal(health.WIRED.totalRuns, 2);
});

// --- summarizeHealth ---------------------------------------------------------

test('summarizeHealth separates dead, degrading and silent, and never double-counts a feed', () => {
  const feeds = {
    dead: { feed: 'dead', consecutiveFailures: 9, consecutiveEmpty: 0 },
    degrading: { feed: 'degrading', consecutiveFailures: 4, consecutiveEmpty: 0 },
    fine: { feed: 'fine', consecutiveFailures: 0, consecutiveEmpty: 0 },
    quiet: { feed: 'quiet', consecutiveFailures: 0, consecutiveEmpty: 30 },
    // One failure is noise, not a trend — a publisher having a bad afternoon.
    blip: { feed: 'blip', consecutiveFailures: 1, consecutiveEmpty: 0 },
  };
  const { dead, degrading, silent } = summarizeHealth(feeds, { deadAfter: 8, degradedAfter: 3, silentAfter: 25 });

  assert.deepEqual(dead.map((f) => f.id), ['dead']);
  assert.deepEqual(degrading.map((f) => f.id), ['degrading'], 'a dead feed must not also be reported as degrading');
  assert.deepEqual(silent.map((f) => f.id), ['quiet']);
});

test('summarizeHealth reports nothing at all when every feed is answering', () => {
  const { dead, degrading, silent } = summarizeHealth(
    { a: { consecutiveFailures: 0, consecutiveEmpty: 0 }, b: { consecutiveFailures: 2, consecutiveEmpty: 4 } },
    { deadAfter: 8, degradedAfter: 3, silentAfter: 25 }
  );
  assert.equal(dead.length + degrading.length + silent.length, 0);
});

test('summarizeHealth tolerates a health file written before consecutiveEmpty existed', () => {
  // Every record in the committed file predates the field; a missing counter is 0, not NaN.
  const { silent, degrading } = summarizeHealth(
    { legacy: { feed: 'legacy', consecutiveFailures: 3 } },
    { deadAfter: 8, degradedAfter: 3, silentAfter: 25 }
  );
  assert.equal(silent.length, 0);
  assert.deepEqual(degrading.map((f) => f.id), ['legacy']);
});
