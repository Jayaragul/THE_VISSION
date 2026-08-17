#!/usr/bin/env node
// What the pipeline needs to know before it starts writing: today's date, the next
// edition number, and what already ran — so a run cannot accidentally repeat itself.
//
//   node tools/edition-info.mjs
//   node tools/edition-info.mjs 2026-08-15   # backfill: info as of that date

import { readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJSON, isoDate, formatMasthead } from './lib/util.mjs';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const GENERATED = join(ROOT, 'generated');

const target = process.argv[2] || isoDate();
if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) {
  console.error(`✗ "${target}" is not a YYYY-MM-DD date`);
  process.exit(2);
}

const files = existsSync(GENERATED)
  ? readdirSync(GENERATED).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
  : [];

const editions = files.map((f) => readJSON(join(GENERATED, f)));
const existing = editions.find((ed) => ed.edition.date === target);
const maxNumber = editions.reduce((n, ed) => Math.max(n, ed.edition.number), 0);

console.log(`\n  Date            ${target}  (${formatMasthead(target)})`);
console.log(`  Edition number  ${existing ? existing.edition.number : maxNumber + 1}${existing ? '  ← this date already has an edition; you are rewriting it' : ''}`);
console.log(`  File            generated/${target}.json`);
console.log(`  Editions so far ${editions.length}`);

const recent = editions.slice(-3).reverse();
if (recent.length) {
  console.log('\n  Already published — do not repeat these:\n');
  for (const ed of recent) {
    console.log(`  ${ed.edition.date}  No. ${ed.edition.number}  ${ed.edition.title}`);
    for (const s of ed.stories) {
      console.log(`      [${s.prominence.padEnd(8)}] ${s.headline}`);
    }
    console.log('');
  }
} else {
  console.log('\n  No previous editions. This is issue one.\n');
}

// Entities that have had a lot of coverage lately are worth being deliberate about.
const counts = new Map();
for (const ed of editions.slice(-5)) {
  for (const s of ed.stories) {
    for (const x of s.entities || []) counts.set(x, (counts.get(x) || 0) + 1);
  }
}
const hot = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
if (hot.length) {
  console.log('  Most-covered entities, last 5 editions:');
  console.log('  ' + hot.map(([k, v]) => `${k} (${v})`).join(' · ') + '\n');
}
