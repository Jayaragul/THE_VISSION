// Builds the search index: a BM25F inverted index over the paper's own written stories,
// plus the two lower tiers, deduplicated by source URL.
//
// Why BM25F and not something that finds synonyms: three independent designs were prototyped
// against this exact archive — a latent-semantic (SVD) layer, a co-occurrence/PMI expansion,
// and a character-trigram fuzzy layer — and all three measured their own semantic mechanism
// producing junk on this corpus. Documents here average a dozen tokens; there is not enough
// co-occurrence for a machine to learn "chip" means "semiconductor" from headlines alone. One
// prototype returned five stories at cosine 0.000, rendered indistinguishably from a real
// match — presenting an arbitrary result as a genuine one is the exact failure CLAUDE.md rule
// 1 exists to prevent. What was actually reported as broken — "nvidia chips" not matching a
// story headlined "Nvidia's chip" — is a tokenization bug, not a missing semantic layer, and
// it is fixed here by searchTokens() in util.mjs. Fix the journalism, not the checker (rule 4)
// applies just as well to a search box as it does to a story.
//
// Why every visitor is not shown the same headline five times: wire items refresh four times
// a day and the digest recomputes three times a day, so the same story is harvested again and
// again under a different tier. Measured on the live archive: 1,429 raw wire+digest items
// collapse to roughly 700 once deduplicated by source URL. Without this, a common query would
// return the same headline repeated across every tier that happened to carry it.

import { searchTokens } from './util.mjs';
import { storyPath } from './render.mjs';

const BM25_K1 = 1.2;
const BM25_B = 0.75;

/** Strips the parts of a URL that vary per-fetch but not per-article: tracking params,
 *  scheme, a leading "www.", and a trailing slash. Two RSS pickups of the same story
 *  routinely differ only in ?utm_source=..., so this is what makes dedup actually work. */
export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const params = new URLSearchParams(u.search);
    for (const key of [...params.keys()]) {
      if (/^utm_|^ref$|^fbclid$|^gclid$/i.test(key)) params.delete(key);
    }
    const qs = params.toString();
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return `${host}${path}${qs ? '?' + qs : ''}`.toLowerCase();
  } catch {
    return String(url || '').toLowerCase();
  }
}

/**
 * Collects one deduplicated document list across all three tiers. A story always wins over a
 * wire/digest copy of the same URL, because the paper's own verified reporting on a topic
 * should never be buried under an unedited third-party headline of the same story — see
 * tools/lib/wire.mjs's own note that the wire "must never be presented as" journalism.
 *
 * digests and wireHistory are expected to be the SAME already-loaded, already-windowed
 * arrays build.mjs renders pages from (loadDigests()'s 90-day slice, loadWireHistory()'s
 * full history) — not a fresh directory read. generated/digest/<date>.json is kept forever
 * but digest/<date>.html is pruned outside that window, so indexing from a directory listing
 * would link a search result at a page that no longer exists.
 */
export function collectDocs({ editions, digests, wireHistory, digestPathFn = (date) => `digest/${date}.html` }) {
  const claimed = new Set();
  const docs = [];

  for (const ed of editions) {
    for (const s of ed.stories) {
      docs.push({
        id: s.id,
        kind: 'story',
        title: s.headline,
        beat: s.beat,
        date: ed.edition.date,
        url: storyPath(s),
        // Extra scoring text, never shipped in the display record — see buildIndex().
        text: [s.kicker, s.deck, ...(s.entities || [])].filter(Boolean).join(' '),
        entities: s.entities || [],
      });
      for (const src of s.sources || []) claimed.add(normalizeUrl(src.url));
    }
  }

  for (const dg of digests) {
    for (const item of dg.items || []) {
      const primary = item.sources?.[0];
      if (!primary?.url) continue;
      const key = normalizeUrl(primary.url);
      if (claimed.has(key)) continue;
      claimed.add(key);
      docs.push({
        id: item.id,
        kind: 'digest',
        title: item.title,
        beat: item.beat,
        date: (item.publishedAt || dg.edition.date).slice(0, 10),
        url: `${digestPathFn(dg.edition.date)}#${item.id}`,
        text: '',
        entities: [],
      });
    }
  }

  for (const snap of wireHistory) {
    (snap.items || []).forEach((item, i) => {
      if (!item.url) return;
      const key = normalizeUrl(item.url);
      if (claimed.has(key)) return;
      claimed.add(key);
      docs.push({
        // Wire items carry no id of their own in generated/wire/<date>.json. This anchor is
        // positional within one day's snapshot, not a permalink — input/retention.json
        // already documents the wire as carrying "no permalink promise" (rule 3 governs
        // story ids only), and a wire snapshot only changes when that day's file is
        // rewritten, which happens at most a few times before the day ends.
        id: `${snap.date}-w${i}`,
        kind: 'wire',
        title: item.title,
        beat: null,
        date: (item.publishedAt || snap.date).slice(0, 10),
        url: `wire/${snap.date}.html#w-${i}`,
        text: '',
        entities: [],
      });
    });
  }

  return docs;
}

/**
 * Builds the BM25F inverted index and the (small) display record for each document.
 *
 * Field weights (headline/title 3x, entities 3x, kicker 2x, deck 1x) are counted as repeated
 * occurrences in one bag-of-words per document, which is what lets a single BM25 formula do
 * field-weighted scoring with no extra machinery. The deck's words go into the index — a
 * reader searching a phrase that only appears in a story's deck should still find it — but
 * the deck text itself is never stored in the shipped display record, because it is scored
 * today and never rendered by the result template. Confirmed on the current archive: the
 * deck is a third of the current index's bytes for zero display benefit.
 */
export function buildSearchIndex(docs) {
  const df = new Map(); // term -> document frequency
  const postings = new Map(); // term -> Map(docIndex -> weighted term frequency)
  const docLengths = [];

  docs.forEach((doc, i) => {
    const bag = new Map();
    const add = (tokens, weight) => {
      for (const t of tokens) bag.set(t, (bag.get(t) || 0) + weight);
    };
    add(searchTokens(doc.title), 3);
    add(doc.entities.flatMap((e) => searchTokens(e)), 3);
    if (doc.text) add(searchTokens(doc.text), 1);

    let length = 0;
    for (const [term, weight] of bag) {
      length += weight;
      if (!postings.has(term)) postings.set(term, new Map());
      postings.get(term).set(i, weight);
      df.set(term, (df.get(term) || 0) + 1);
    }
    docLengths.push(length);
  });

  const N = docs.length;
  const avgdl = N ? docLengths.reduce((a, b) => a + b, 0) / N : 0;

  // Vocabulary sorted with an explicit comparator, never left to Map insertion order — five
  // workflows rebuild this file and compare it byte-for-byte against what is committed
  // (verify.yml, daily-edition.yml, wire.yml, digest.yml, maintenance.yml), and insertion
  // order is not guaranteed stable across a changed input order or a Node version bump.
  const terms = [...postings.keys()].sort();

  const dict = terms; // sorted term list, doubles as the dictionary for prefix matching
  const post = terms.map((t) => {
    const entries = [...postings.get(t).entries()].sort((a, b) => a[0] - b[0]);
    return [entries.map((e) => e[0]), entries.map((e) => e[1])];
  });

  const display = docs.map((doc) => ({
    id: doc.id,
    kind: doc.kind,
    title: doc.title,
    beat: doc.beat,
    date: doc.date,
    url: doc.url,
  }));

  return {
    n: N,
    avgdl,
    k1: BM25_K1,
    b: BM25_B,
    docLengths,
    dict,
    df: terms.map((t) => df.get(t)),
    post,
    docs: display,
  };
}

/**
 * Reference query implementation. This is the algorithm the browser must reproduce — the
 * client script in tools/build.mjs's renderSearch() is a hand-written ES5 copy of it, the
 * same way that function's escapeHtml is already a hand-written copy of util.mjs's
 * escapeHTML, because a browser <script> tag cannot import from tools/lib. Any change here
 * must be mirrored there; this function is what a test failure should be checked against.
 *
 * Deliberately NOT semantic: this is a plain BM25F lookup, tokenised the same way the index
 * was built. The single guardrail that matters is the last one — if no query term resolves
 * to anything in the dictionary, not even by prefix, this returns an explicit noMatch rather
 * than a sorted list of zero scores. A vector-based prototype of this feature measured that
 * exact failure — five documents at cosine 0.000, indistinguishable from a real result — and
 * that is the one outcome CLAUDE.md rule 1 makes unacceptable.
 */
export function queryIndex(index, queryString, { limit = 40 } = {}) {
  const tokens = searchTokens(queryString);
  if (!tokens.length) return { noMatch: false, empty: true, ignored: [], results: [] };

  const dictSet = new Set(index.dict);
  const matchedTerms = new Map(); // term -> weight (1 for exact, 0.6 for prefix-only)
  const ignored = [];

  for (let ti = 0; ti < tokens.length; ti++) {
    const tok = tokens[ti];
    if (dictSet.has(tok)) {
      matchedTerms.set(tok, 1);
      continue;
    }
    // Prefix expansion, last token only, and only once it is long enough that a prefix
    // match means something — a 1-2 character prefix would match a meaningful fraction of
    // the whole dictionary and add noise rather than recall.
    if (ti === tokens.length - 1 && tok.length >= 3) {
      const lo = lowerBound(index.dict, tok);
      let found = 0;
      for (let i = lo; i < index.dict.length && index.dict[i].startsWith(tok); i++) {
        matchedTerms.set(index.dict[i], 0.6);
        found++;
      }
      if (!found) ignored.push(tok);
    } else {
      ignored.push(tok);
    }
  }

  if (!matchedTerms.size) return { noMatch: true, empty: false, ignored, results: [] };

  const scores = new Map(); // docIndex -> score
  for (const [term, weight] of matchedTerms) {
    const ti = index.dict.indexOf(term); // dict is small enough that this stays cheap
    if (ti === -1) continue;
    const df = index.df[ti];
    const idf = Math.log(1 + (index.n - df + 0.5) / (df + 0.5));
    const [docIdx, tfs] = index.post[ti];
    for (let j = 0; j < docIdx.length; j++) {
      const d = docIdx[j];
      const tf = tfs[j];
      const norm = 1 - index.b + index.b * (index.docLengths[d] / (index.avgdl || 1));
      const contribution = weight * idf * ((tf * (index.k1 + 1)) / (tf + index.k1 * norm));
      scores.set(d, (scores.get(d) || 0) + contribution);
    }
  }

  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || index.docs[b[0]].date.localeCompare(index.docs[a[0]].date))
    .slice(0, limit)
    .map(([d]) => index.docs[d]);

  return { noMatch: false, empty: false, ignored, results: ranked };
}

/** First index in a SORTED array whose value is >= target — used to jump straight to the
 *  start of a prefix's range instead of scanning the whole dictionary from position 0. */
function lowerBound(sorted, target) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
