import { STOPWORDS } from './util.mjs';

const ENTITIES = { amp: '&', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', mdash: '—', ndash: '–' };

function plainText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity) => {
      if (entity[0] !== '#') return ENTITIES[entity.toLowerCase()] ?? whole;
      const code = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isInteger(code) && code >= 32 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function words(value) {
  return (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .filter(word => word.length > 2 && !STOPWORDS.has(word));
}

// Extract only a complete sentence supplied by the linked publisher. This never invents a
// claim or stitches sentence fragments together; an absent or cut-off feed description stays
// absent. The overlap score favours sentences about the headline over boilerplate.
export function publisherExcerpt(summary, title) {
  const clean = plainText(summary);
  if (!clean || /https?:\/\/|subscribe|sign up|read more|newsletter/i.test(clean)) return null;
  const titleWords = new Set(words(title));
  const sentences = clean.match(/[^.!?]+[.!?](?=\s|$)/g) || [];
  const choices = sentences.map(raw => {
    const sentence = raw.trim();
    const tokens = words(sentence);
    const wordCount = (sentence.match(/[\p{L}\p{N}]+/gu) || []).length;
    if (sentence.length < 58 || sentence.length > 205 || tokens.length < 8 || wordCount > 25) return null;
    const overlap = tokens.filter(word => titleWords.has(word)).length;
    const similarity = overlap / Math.max(1, new Set(tokens).size);
    if (similarity > 0.72 || sentence.toLowerCase() === String(title).toLowerCase()) return null;
    return { sentence, score: overlap + Math.min(tokens.length, 20) / 100 };
  }).filter(Boolean);
  choices.sort((a, b) => b.score - a.score);
  return choices[0]?.sentence || null;
}
