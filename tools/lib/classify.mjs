// Beat and tier assignment for a harvested candidate — no model, just keyword and source
// book lookups. This is Tier 1.5's honest limit: it can tell you which section a story
// probably belongs in and how trustworthy its publisher is rated. It cannot tell you what
// the story means, which is why digest.mjs never generates prose — see ARCHITECTURE.md.

import { hostOf, matchPublisher, STOPWORDS } from './util.mjs';

// A beat's vocab is a handful of curated queries — real headlines rarely reuse those exact
// words, and "models" vs "model" was losing credit on nothing but the plural. Stripping a
// single trailing 's' (not on a double-s word, so "business" stays "business") closes that
// gap without inventing a real stemmer.
function stem(word) {
  return word.length > 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
}

function tokenize(str) {
  return new Set(
    String(str)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
      .map(stem)
  );
}

// Two shared words is the bar for an ambiguous term, because one is not evidence of anything:
// "open" alone matched "Open Mike Eagle and Kenny Segal crafted a hip-hop breakup masterpiece"
// against the models beat's "open weights model release" query on the first run of this
// classifier. But holding every item to that bar discards short headlines that are perfectly
// clear — "Introducing Gemini 3.7 Flash" is three words and unmistakably a models story.
const MIN_OVERLAP = 2;

// Which vocabulary a beat classifies on. `keywords` is written for this job; `queries` are
// WebSearch seeds and only stand in for beats that have no keywords yet (the test fixtures
// take this path). Unioning the two was a real bug: the queries name companies — "Amazon
// Google Microsoft Meta Anthropic OpenAI new model launch" — so "OpenAI joins PORTS-Pike
// project", a data-centre story, matched the models beat on the word "openai". Company names
// belong in a search seed and nowhere near a beat classifier, since every company appears in
// every beat.
function beatVocab(beat) {
  const own = beat.keywords?.length ? beat.keywords : beat.queries || [];
  return tokenize([beat.label, beat.blurb, ...own].join(' '));
}

/** Tokens that identify a beat on their own: "gemini" only ever means models, "deepfake" only
 *  ever means society. Two conditions, both required.
 *
 *  Drawn only from `keywords`, never from the label, blurb or queries. Those are prose and
 *  search phrases — words land in them incidentally, and a word nobody chose as a classifier
 *  signal must not become decisive by accident. "open weights model release" is a reasonable
 *  search seed that puts the word "open" in the models vocabulary; treating that as decisive
 *  is precisely the bug that filed a hip-hop album review under Models.
 *
 *  And unique across beats: a token several beats claim ("model", "security") proves nothing
 *  alone and still needs MIN_OVERLAP. Derived rather than hand-maintained, so adding a keyword
 *  to a second beat automatically demotes it instead of silently staying decisive. */
function distinctiveTokens(beats) {
  const beatsPerToken = new Map();
  for (const beat of beats) {
    for (const t of tokenize((beat.keywords || []).join(' '))) {
      beatsPerToken.set(t, (beatsPerToken.get(t) || 0) + 1);
    }
  }
  return new Set([...beatsPerToken].filter(([, n]) => n === 1).map(([t]) => t));
}

let distinctiveCache = null;
let distinctiveCacheKey = null;

export function classifyBeat(item, beats) {
  const text = `${item.title} ${item.summary || ''}`;
  const itemTokens = tokenize(text);
  if (!itemTokens.size) return null;

  // Recomputed only when the beat list itself changes — classifyBeat runs once per harvested
  // candidate, several hundred times a build.
  const key = beats.map((b) => b.id).join('|');
  if (distinctiveCacheKey !== key) {
    distinctiveCache = distinctiveTokens(beats);
    distinctiveCacheKey = key;
  }

  let best = null;
  let bestScore = 0;
  let bestOverlap = 0;
  let bestDistinctive = 0;
  for (const beat of beats) {
    const vocab = beatVocab(beat);
    let overlap = 0;
    let distinctive = 0;
    for (const t of vocab) {
      if (!itemTokens.has(t)) continue;
      overlap++;
      if (distinctiveCache.has(t)) distinctive++;
    }
    // Normalise by vocabulary size so a beat with a longer keyword list is not favoured
    // purely for having more words to match against.
    const score = vocab.size ? overlap / Math.sqrt(vocab.size) : 0;
    if (score > bestScore) {
      bestScore = score;
      bestOverlap = overlap;
      bestDistinctive = distinctive;
      best = beat.id;
    }
  }
  return bestOverlap >= MIN_OVERLAP || bestDistinctive >= 1 ? best : null;
}

export function tierOf(item, sourceBook) {
  const host = hostOf(item.url);
  if (!host) return { tier: 4, host: null, blocked: false };
  if (matchPublisher(host, sourceBook.blocked)) return { tier: null, host, blocked: true };
  const known = matchPublisher(host, sourceBook.publishers);
  return { tier: known?.tier ?? 4, host, blocked: false, name: known?.name || host };
}

/** Linear decay to zero at maxAgeHours. A wire item from ten minutes ago scores 1; one at
 *  the edge of the lookback window scores 0; nothing here claims to know if it still matters,
 *  only how fresh it is. */
export function recencyScore(publishedAt, now, maxAgeHours) {
  if (!publishedAt) return 0;
  const ageHours = (now - Date.parse(publishedAt)) / 3600000;
  if (ageHours < 0 || ageHours > maxAgeHours) return 0;
  return 1 - ageHours / maxAgeHours;
}
