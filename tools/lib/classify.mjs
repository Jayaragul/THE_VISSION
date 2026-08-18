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

/** Score every beat by keyword overlap between the item's text and the beat's own label
 *  and seed queries, and return the best match. Beats already carry a curated query list
 *  written for WebSearch — the same words are a reasonable classifier vocabulary. */
// A single shared word is not evidence of anything — "open" alone matched "Open Mike Eagle
// and Kenny Segal crafted a hip-hop breakup masterpiece" against the models beat's "open
// weights model release" query on the first run of this classifier. Being the best-scoring
// beat among the options is not the bar; clearing an absolute minimum overlap is.
const MIN_OVERLAP = 2;

export function classifyBeat(item, beats) {
  const text = `${item.title} ${item.summary || ''}`;
  const itemTokens = tokenize(text);
  if (!itemTokens.size) return null;

  let best = null;
  let bestScore = 0;
  let bestOverlap = 0;
  for (const beat of beats) {
    const vocab = tokenize([beat.label, beat.blurb, ...(beat.queries || [])].join(' '));
    let overlap = 0;
    for (const t of vocab) if (itemTokens.has(t)) overlap++;
    // Normalise by vocabulary size so a beat with a long query list is not favoured purely
    // for having more words to match against.
    const score = vocab.size ? overlap / Math.sqrt(vocab.size) : 0;
    if (score > bestScore) {
      bestScore = score;
      bestOverlap = overlap;
      best = beat.id;
    }
  }
  return bestOverlap >= MIN_OVERLAP ? best : null;
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
