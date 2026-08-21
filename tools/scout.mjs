#!/usr/bin/env node
// Optional lead discovery via Gemini, for the editorial tier only.
//
//   node tools/scout.mjs [YYYY-MM-DD]
//
// RSS is excellent at "what did these 29 publishers post" and blind to everything else — a
// story broken by an outlet not on the list is invisible to harvest.mjs no matter how big it
// is. This asks a search-grounded model the one question a feed reader cannot: what happened
// in AI today that matters. What comes back is merged into the day's candidate file.
//
// Everything here is a LEAD, never a source. A model can produce a confident URL for an
// article that does not exist, so every item written by this tool is marked
// `discoveryOnly: true` and `via: "gemini"` — the same flag aggregator redirects carry, which
// means the digest cannot cite it and the editorial pipeline must open it and find the real
// publisher before a word is written. That is not a precaution against Gemini specifically;
// it is the paper's first rule, and it applies to any model's output including Claude's.
//
// Failure is never fatal. No key, a bad response, a rate limit: the tool says so and exits 0,
// because the pipeline's guarantee is that it still runs without any API key at all. Tier 1
// and Tier 1.5 never call this — their whole purpose is to work when the models do not.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAiRelevant, hostOf } from './lib/util.mjs';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const CANDIDATES = join(ROOT, 'generated', 'candidates');

const API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const ENDPOINT = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

const date = process.argv[2] || new Date().toISOString().slice(0, 10);

/** Exit 0 on every failure path. A missing scout is a thinner edition, not a broken one. */
function bail(reason) {
  console.log(`  scout skipped — ${reason}`);
  process.exit(0);
}

if (!API_KEY) {
  bail('no GEMINI_API_KEY in the environment (this step is optional)');
}

const PROMPT = `List significant artificial-intelligence news stories published in the last 48 hours, as of ${date}.

Prioritise, in this order:
1. Outages, breaches and security incidents affecting AI or developer infrastructure.
2. New model releases, open-weights drops and major capability changes.
3. Funding rounds above $10m, acquisitions, and earnings that change market structure.
4. Regulation, litigation and government action.
5. Research results with a named institution behind them.

Return ONLY a JSON array, no prose and no code fence. Each element:
{"title": "...", "url": "https://...", "publisher": "...", "publishedAt": "YYYY-MM-DD"}

Rules:
- The url must be the publisher's own article page, never an aggregator, never a search page.
- Use the exact headline as published. Do not rewrite it.
- If you are not confident an item is real and recent, omit it. A short list is correct.
- Maximum 40 items.`;

async function ask() {
  const res = await fetch(`${ENDPOINT(MODEL)}?key=${encodeURIComponent(API_KEY)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: PROMPT }] }],
      // Search grounding is the entire reason to call a model here rather than read a feed.
      // If the account or model cannot do it, the request still returns and the answer is
      // simply weaker — it is not worth failing the run over.
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0, maxOutputTokens: 4096 },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini returned ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const parts = json?.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || '').join('');
}

/** Models wrap JSON in prose or a fence however firmly you ask them not to. */
function extractArray(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

let text;
try {
  text = await ask();
} catch (err) {
  bail(err.message);
}

const parsed = extractArray(text);
if (!Array.isArray(parsed)) {
  bail('Gemini did not return a JSON array');
}

const seen = new Set();
const leads = [];
for (const row of parsed) {
  const title = String(row?.title || '').trim();
  const url = String(row?.url || '').trim();
  if (!title || !/^https:\/\//i.test(url)) continue;
  // The same relevance gate the wire and digest apply. A model asked for AI news will still
  // hand back the occasional general-tech story.
  if (!isAiRelevant(title)) continue;
  const host = hostOf(url);
  // A search page or an aggregator is not a lead worth following; it is a lead to a lead.
  if (!host || /^(news\.google|google|bing|duckduckgo|t\.co)\./i.test(host)) continue;
  if (seen.has(url)) continue;
  seen.add(url);
  leads.push({
    title,
    url,
    source: String(row?.publisher || host).trim() || host,
    publishedAt: /^\d{4}-\d{2}-\d{2}/.test(String(row?.publishedAt || ''))
      ? new Date(`${String(row.publishedAt).slice(0, 10)}T12:00:00Z`).toISOString()
      : new Date(`${date}T12:00:00Z`).toISOString(),
    // Load-bearing. This is what stops a generated URL from ever being cited: the digest
    // refuses to cite discoveryOnly items, and the editorial pipeline is instructed to open
    // them and cite the publisher it actually finds.
    discoveryOnly: true,
    via: 'gemini',
  });
}

if (!leads.length) {
  bail('Gemini returned no usable leads');
}

mkdirSync(CANDIDATES, { recursive: true });
const path = join(CANDIDATES, `${date}.json`);

let doc = { date, harvestedAt: new Date().toISOString(), items: [] };
if (existsSync(path)) {
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // A corrupt candidate file is not worth losing the scout's work over; start clean.
  }
}
doc.items = Array.isArray(doc.items) ? doc.items : [];

const known = new Set(doc.items.map((i) => i.url));
const added = leads.filter((l) => !known.has(l.url));
doc.items.push(...added);
doc.scoutedAt = new Date().toISOString();

writeFileSync(path, JSON.stringify(doc, null, 2) + '\n');
console.log(
  `✓ scout ${date}: ${added.length} new lead(s) from Gemini (${leads.length} returned, ${doc.items.length} candidates total)`
);
console.log('  all marked discoveryOnly — leads for the editorial tier to verify, never citable');
