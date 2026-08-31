// Tests for the search index: dedup across the three tiers, and the BM25 query that
// replaced a plain substring match.
//
// The substring matcher it replaced only ever compared the WHOLE query string against a
// field with .indexOf(), so "nvidia chips" never matched a story headlined "Nvidia's chip"
// — the query and the headline shared every word but not the exact phrase. That is the
// concrete bug these tests are written against, not a hypothetical one.
//
// The other load-bearing case here is the no-results guardrail. A vector-based prototype of
// a semantic layer for this same feature measured itself returning five documents at cosine
// 0.000 — arbitrary, but rendered identically to a real result — when every query term was
// out of vocabulary. This design has no vectors to produce that failure, but the guardrail
// is tested anyway because it is the one behaviour CLAUDE.md rule 1 makes non-negotiable:
// never present an arbitrary result as a genuine one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, collectDocs, buildSearchIndex, queryIndex } from '../tools/lib/searchindex.mjs';
import { searchTokens, searchStem } from '../tools/lib/util.mjs';

const story = (id, headline, extra = {}) => ({
  id,
  headline,
  kicker: 'Kicker',
  deck: 'A deck sentence.',
  entities: [],
  sources: [{ url: `https://a.example/${id}` }],
  ...extra,
});
const edition = (date, stories) => ({ edition: { date }, stories });
const digestItem = (id, title, url, extra = {}) => ({
  id,
  title,
  beat: 'models',
  publishedAt: '2026-08-28T00:00:00Z',
  sources: [{ url }],
  ...extra,
});
const digestPathFn = (date) => `digest/${date}.html`;

// ---------------------------------------------------------------- normalizeUrl ----

test('normalizeUrl strips www, tracking params and a trailing slash', () => {
  const a = normalizeUrl('https://www.Example.com/foo/bar/?utm_source=rss&utm_medium=feed');
  const b = normalizeUrl('https://example.com/foo/bar');
  assert.equal(a, b);
});

test('normalizeUrl keeps a real query param that is not tracking noise', () => {
  const a = normalizeUrl('https://example.com/search?q=nvidia');
  const b = normalizeUrl('https://example.com/search?q=chip');
  assert.notEqual(a, b);
});

// -------------------------------------------------------------------- tokenizer ----

test('searchTokens keeps two-letter identifiers a length filter would drop', () => {
  const tokens = searchTokens('AI regulation in the EU and UK');
  assert.deepEqual(tokens, ['ai', 'regulation', 'eu', 'uk']);
});

test('searchTokens strips a possessive before it can leave a bare "s" token', () => {
  const tokens = searchTokens("Nvidia's chip");
  assert.deepEqual(tokens, ['nvidia', 'chip']);
  assert.equal(tokens.includes('s'), false);
});

test('searchStem does not stem short or already-singular-looking words', () => {
  assert.equal(searchStem('us'), 'us');
  assert.equal(searchStem('bonus'), 'bonus');
  assert.equal(searchStem('gas'), 'gas');
  assert.equal(searchStem('stories'), 'story');
  assert.equal(searchStem('models'), 'model');
});

// ---------------------------------------------------------------------- collectDocs ----

test('a published story wins over a wire or digest copy of the same URL', () => {
  const editions = [edition('2026-08-28', [story('2026-08-28-a', 'Nvidia ships a new chip')])];
  const digests = [
    { edition: { date: '2026-08-28' }, items: [digestItem('2026-08-28-b', 'Digest copy', 'https://a.example/2026-08-28-a')] },
  ];
  const wireHistory = [{ date: '2026-08-28', items: [{ title: 'Wire copy', url: 'https://a.example/2026-08-28-a' }] }];

  const docs = collectDocs({ editions, digests, wireHistory, digestPathFn });
  assert.equal(docs.length, 1);
  assert.equal(docs[0].kind, 'story');
});

test('URL-normalised duplicates across wire and digest collapse to one document', () => {
  const editions = [edition('2026-08-28', [])];
  const digests = [
    { edition: { date: '2026-08-28' }, items: [digestItem('2026-08-28-x', 'Same story', 'https://www.b.example/story/?utm_source=rss')] },
  ];
  const wireHistory = [{ date: '2026-08-28', items: [{ title: 'Same story, wire copy', url: 'https://b.example/story' }] }];

  const docs = collectDocs({ editions, digests, wireHistory, digestPathFn });
  assert.equal(docs.length, 1);
  assert.equal(docs[0].kind, 'digest');
});

test('a wire item gets a positional anchor, never a bare directory-page link', () => {
  const editions = [edition('2026-08-28', [])];
  const wireHistory = [{ date: '2026-08-28', items: [{ title: 'One', url: 'https://x.example/1' }, { title: 'Two', url: 'https://x.example/2' }] }];

  const docs = collectDocs({ editions, digests: [], wireHistory, digestPathFn });
  assert.equal(docs.length, 2);
  assert.equal(docs[0].url, 'wire/2026-08-28.html#w-0');
  assert.equal(docs[1].url, 'wire/2026-08-28.html#w-1');
});

test('an edition and digest window with nothing in it yields no documents, not a throw', () => {
  const docs = collectDocs({ editions: [], digests: [], wireHistory: [], digestPathFn });
  assert.deepEqual(docs, []);
});

// ------------------------------------------------------------------- buildSearchIndex ----

test('the deck is searchable but never shipped in the display record', () => {
  const docs = collectDocs({
    editions: [edition('2026-08-28', [story('2026-08-28-a', 'Headline only', { deck: 'unique-deck-phrase appears only here' })])],
    digests: [],
    wireHistory: [],
    digestPathFn,
  });
  const index = buildSearchIndex(docs);
  assert.equal('deck' in index.docs[0], false);
  const hit = queryIndex(index, 'unique-deck-phrase');
  assert.equal(hit.results.length, 1);
  assert.equal(hit.results[0].id, '2026-08-28-a');
});

test('vocabulary is sorted the same way regardless of the order documents arrive in', () => {
  const a = story('2026-08-28-a', 'Zebra story about zebras');
  const b = story('2026-08-28-b', 'Apple story about apples');
  const forward = buildSearchIndex(collectDocs({ editions: [edition('2026-08-28', [a, b])], digests: [], wireHistory: [], digestPathFn }));
  const backward = buildSearchIndex(collectDocs({ editions: [edition('2026-08-28', [b, a])], digests: [], wireHistory: [], digestPathFn }));
  assert.deepEqual(forward.dict, backward.dict);
});

// ------------------------------------------------------------------------ queryIndex ----

function twoStoryIndex() {
  const docs = collectDocs({
    editions: [
      edition('2026-08-28', [
        story('2026-08-28-a', "Nvidia's chip shortage eases", { entities: ['Nvidia'] }),
        story('2026-08-28-b', 'A story about something unrelated entirely', { deck: 'Nothing to do with chips.' }),
      ]),
    ],
    digests: [],
    wireHistory: [],
    digestPathFn,
  });
  return buildSearchIndex(docs);
}

test('the reported bug: "nvidia chips" matches a headline reading "Nvidia\'s chip"', () => {
  const index = twoStoryIndex();
  const { results, noMatch } = queryIndex(index, 'nvidia chips');
  assert.equal(noMatch, false);
  assert.ok(results.length >= 1);
  assert.equal(results[0].id, '2026-08-28-a');
});

test('a query with no term in the dictionary returns an explicit no-match, never a zero-score list', () => {
  const index = twoStoryIndex();
  const { results, noMatch } = queryIndex(index, 'zzzznonexistentqueryterm');
  assert.equal(noMatch, true);
  assert.deepEqual(results, []);
});

test('an empty query returns the empty state, not no-match', () => {
  const index = twoStoryIndex();
  const { results, empty, noMatch } = queryIndex(index, '   ');
  assert.equal(empty, true);
  assert.equal(noMatch, false);
  assert.deepEqual(results, []);
});

test('a rare exact match outranks a document that only matches by prefix', () => {
  const docs = collectDocs({
    editions: [
      edition('2026-08-28', [
        story('2026-08-28-a', 'Chip export controls tighten', {}),
        story('2026-08-28-b', 'Chipmaker earnings beat expectations', {}),
      ]),
    ],
    digests: [],
    wireHistory: [],
    digestPathFn,
  });
  const index = buildSearchIndex(docs);
  const { results } = queryIndex(index, 'chip');
  assert.equal(results[0].id, '2026-08-28-a'); // exact "chip" beats prefix-matched "chipmaker"
});

test('tied scores break on date, most recent first', () => {
  const docs = collectDocs({
    editions: [
      edition('2026-08-27', [story('2026-08-27-a', 'Identical scoring headline chip')]),
      edition('2026-08-28', [story('2026-08-28-a', 'Identical scoring headline chip')]),
    ],
    digests: [],
    wireHistory: [],
    digestPathFn,
  });
  const index = buildSearchIndex(docs);
  const { results } = queryIndex(index, 'chip');
  assert.equal(results[0].id, '2026-08-28-a');
  assert.equal(results[1].id, '2026-08-27-a');
});
