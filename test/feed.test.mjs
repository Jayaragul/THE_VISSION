// Real-world-shaped fixtures, not synthetic minimal cases — tools/lib/feed.mjs is a
// regex parser standing in for a real XML library, and the way it breaks is on the messy
// formatting actual publishers use, not on textbook RSS.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed } from '../tools/lib/feed.mjs';

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
