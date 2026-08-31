// Small shared helpers. Deliberately dependency-free: the whole toolchain must run
// on a bare `node` with no install step, so CI stays fast and cannot rot.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`Could not read JSON at ${path}: ${err.message}`);
  }
}

/** FNV-1a. Stable across runs and platforms, which is the whole point — cover art
 *  for a given story must never change once published. */
/** SHA-256 of an edition's stories array. What an eval file's edition binding is checked
 *  against — any change to the edition after review changes this, which is the point. */
export function editionHash(doc) {
  return createHash('sha256').update(JSON.stringify(doc.stories)).digest('hex');
}

export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Seeded PRNG (mulberry32). Same seed, same picture, forever. */
export function rng(seed) {
  let a = typeof seed === 'string' ? hash32(seed) : seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(random, arr) {
  return arr[Math.floor(random() * arr.length) % arr.length];
}

export function slugify(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFKD')
    // Strip the combining marks NFKD just split accented letters into (Über → u + ̈ber),
    // so "über" transliterates to "uber" instead of the catch-all below turning the
    // orphaned diacritic into its own separator and producing "u-ber".
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

export function escapeHTML(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(str) {
  return escapeHTML(str);
}

export function escapeXML(str) {
  return escapeHTML(str);
}

/** JSON.stringify does not escape `<`, so a field containing the literal text "</script>"
 *  — a headline quoting one, say — would close the tag early and let whatever follows run
 *  as markup instead of data. The JSON spec allows \u-escaping any character, so this stays
 *  valid JSON while being unable to contain a tag-closing sequence. */
export function safeJsonLd(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

// ---------------------------------------------------------------- colour ----

export function hexToRGB(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function rgbToHSL({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

export function hslToHex({ h, s, l }) {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 100) / 100;
  l = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return (
    '#' +
    rgb
      .map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0'))
      .join('')
  );
}

export function hexToHSL(hex) {
  return rgbToHSL(hexToRGB(hex));
}

export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

// ------------------------------------------------------------------ time ----

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Monday, 17 August 2026" — masthead style, no locale dependency. */
export function formatMasthead(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "17 Aug 2026" */
export function formatShort(dateStr) {
  const d = new Date(dateStr.length === 10 ? `${dateStr}T12:00:00Z` : dateStr);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`;
}

export function isoDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  const ms = new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

/** Rough but honest reading time: 220 wpm over everything the reader actually reads. */
export function readMinutes(story) {
  const text = [story.deck, ...(story.summary || []), ...(story.body || []), story.whyItMatters]
    .filter(Boolean)
    .join(' ');
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Match a host against the publisher list, allowing subdomains of a listed root. */
export function matchPublisher(host, publishers) {
  if (!host) return null;
  return (
    publishers.find((p) => host === p.host || host.endsWith(`.${p.host}`)) || null
  );
}

/** Two-letter monogram for a publisher chip. No external favicon requests, ever. */
// Several harvested feeds are general technology or general business, not AI-only — SCMP,
// Ars Technica and TechCrunch all carry plenty that has nothing to do with this paper's
// subject, and the harvest deliberately stays broad so downstream stages see everything.
// This is the shared relevance gate both the wire and the Tier 1.5 digest apply before doing
// anything with an item — without it, a beat classifier's incidental keyword overlap can
// and does misfire on things like "Open Mike Eagle" matching "open weights model release".
export const AI_TERMS = new RegExp(
  [
    '\\bAI\\b', 'artificial intelligence', 'machine learning', '\\bLLM', '\\bGPT\\b',
    'neural', 'transformer', 'deep learning', 'generative', 'inference', 'training run',
    '\\bmodels?\\b', 'chatbot', 'agentic', '\\bagents?\\b', 'benchmark', 'open.?weights',
    'fine.?tun', 'datacent', 'data cent', '\\bGPU', '\\bTPU\\b', 'accelerator',
    'OpenAI', 'Anthropic', 'Claude', 'Gemini', 'DeepMind', 'Nvidia', 'Qwen', 'DeepSeek',
    'Mistral', 'Llama', 'Hugging Face', 'Kimi', '\\bGLM\\b', 'MiniMax', 'Ernie', 'Copilot',
    'Midjourney', 'Stable Diffusion', 'Sora', 'xAI', 'Grok', 'Perplexity', 'Cohere',
  ].join('|'),
  'i'
);

/** Title only, deliberately — feed summaries are long and frequently mention AI in passing
 *  (an aircraft story quoting an "AI-assisted" design process, say), which let non-AI items
 *  through when this checked the summary too. */
export function isAiRelevant(title) {
  return AI_TERMS.test(String(title || ''));
}

// Shared by tools/validate.mjs's copyright check and tools/lib/classify.mjs's beat
// classifier. Found because "and", from a beat's own blurb text, plus one genuine keyword
// was enough to clear a two-token overlap threshold and misclassify an unrelated headline —
// a plain word-length filter does not catch function words like this at any length cutoff
// that would not also drop real short terms (GPU, LLM).
export const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'at', 'by',
  'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'that', 'this',
]);

// ---------------------------------------------------------------- search ----

// Search needs its OWN stemmer and tokenizer, not the digest classifier's — cluster.mjs and
// classify.mjs both apply a `w.length > 2` filter that silently drops two-letter identifiers
// (ai, eu, uk, us), a defect cluster.mjs's own comment already names for GPT/AWS/EU/API/xAI
// without actually fixing it. Search cannot inherit that: "AI" is the single most frequent
// term in this paper's whole corpus. Extending STOPWORDS itself was considered and rejected
// — that Set is imported by validate.mjs's copyright gate, classify.mjs's beat classifier and
// cluster.mjs's digest clustering, so widening it here would silently change all three.

/** classify.mjs's stemmer drops one trailing 's'. Search adds two more of the cheapest,
 *  safest English patterns — plural -ies and a guard against stemming words that only look
 *  plural (bonus, us, status) — without reaching for a real stemming library. */
export function searchStem(word) {
  if (word.length > 4 && word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.length > 4 && word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us')) {
    return word.slice(0, -1);
  }
  return word;
}

/** Tokenize for the search index. Differs from classify.mjs/cluster.mjs in exactly one way,
 *  deliberately: no length filter, only a stopword filter — see the comment above.
 *
 *  The possessive strip runs BEFORE punctuation is collapsed to spaces, and that ordering is
 *  the whole fix: "Nvidia's" was previously splitting into "nvidia" + a bare "s" token, and
 *  that "s" alone had non-trivial document frequency across the archive — pure index noise
 *  that diluted every query touching it. */
export function searchTokens(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/['’]s\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .map(searchStem);
}

export function monogram(name) {
  const words = String(name).replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/);
  if (words.length === 0) return '??';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
