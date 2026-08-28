#!/usr/bin/env node
// Storage capacity gauge and scratch pruner.
//
//   node tools/retention.mjs            # report only
//   node tools/retention.mjs --prune    # also delete scratch outside its window
//
// Why this exists: a daily paper's storage cost compounds silently. Every edition adds
// story pages, cover art and JSON that must live forever, and GitHub Pages stops
// publishing at 1 GB with no gradual warning. Measured at edition 8 the site was on
// course to stop deploying inside two and a half years, and nothing in the repo would
// have said so until the deploy failed.
//
// So this reports one number that matters — the date the archive crosses the ceiling —
// and keeps it honest by measuring real bytes rather than estimating from a model.

import { readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJSON } from './lib/util.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = (...p) => join(ROOT, ...p);
const PRUNE = process.argv.includes('--prune');

const retention = readJSON(OUT('input', 'retention.json'));
const LIMIT_BYTES = retention.capacity.limitMB * 1024 * 1024;

// Directories that never reach GitHub Pages. Everything else in the tree is published
// and therefore counts against the ceiling — including generated/, which the front end
// fetches at runtime for search.
const NOT_PUBLISHED = new Set(['.git', 'node_modules', '.github', '.claude', '.gemini', 'test', '.scratch']);

function walk(dir, onFile) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue; // a file that vanished mid-walk is not an error worth failing a build over
    }
    if (st.isDirectory()) {
      if (dir === ROOT && NOT_PUBLISHED.has(name)) continue;
      walk(full, onFile);
    } else {
      onFile(full, st.size);
    }
  }
}

function sizeOf(dir) {
  let bytes = 0;
  walk(OUT(dir), (_f, size) => {
    bytes += size;
  });
  return bytes;
}

const mb = (bytes) => bytes / 1024 / 1024;
const fmt = (bytes) => `${mb(bytes).toFixed(1)} MB`;

// ---------------------------------------------------------------- measure ----

let publishedBytes = 0;
walk(ROOT, (_f, size) => {
  publishedBytes += size;
});

const editionFiles = existsSync(OUT('generated'))
  ? readdirSync(OUT('generated')).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
  : [];
const editionCount = editionFiles.length;

// Growth is measured against the parts that actually scale with edition count. Fixed
// costs — fonts, stylesheet, the schema — are one-time and would flatter the projection
// if they were divided across editions too.
const PERMANENT_DIRS = ['story', 'edition', 'assets/img/covers'];
const permanentBytes =
  PERMANENT_DIRS.reduce((sum, d) => sum + sizeOf(d), 0) +
  editionFiles.reduce((sum, f) => sum + statSync(OUT('generated', f)).size, 0);

const perEdition = editionCount ? permanentBytes / editionCount : 0;

// entity/ grows sublinearly — entities recur across editions — so it is reported but
// deliberately left out of the projection, which would otherwise overstate the slope.
const breakdown = {
  'story/ (permanent)': sizeOf('story'),
  'edition/ (permanent)': sizeOf('edition'),
  'covers/ (permanent)': sizeOf('assets/img/covers'),
  'generated/ editions (permanent)': editionFiles.reduce((s, f) => s + statSync(OUT('generated', f)).size, 0),
  'entity/ (permanent, sublinear)': sizeOf('entity'),
  'digest/ + generated/digest (windowed)': sizeOf('digest') + sizeOf(join('generated', 'digest')),
  'generated/candidates (scratch)': sizeOf(join('generated', 'candidates')),
  'generated/wire (windowed)': sizeOf(join('generated', 'wire')),
};

// ------------------------------------------------------------- scratch ----

/** Dated files in a directory that fall outside the retention window, oldest first. */
function expired(dir, keepDays) {
  const full = OUT(dir);
  if (!existsSync(full)) return [];
  const dated = readdirSync(full)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\./.test(f))
    .sort()
    .reverse();
  return dated.slice(keepDays).map((f) => join(dir, f));
}

const staleCandidates = expired(join('generated', 'candidates'), retention.windows.candidates);
const reclaimable = staleCandidates.reduce((sum, f) => sum + statSync(OUT(f)).size, 0);

// -------------------------------------------------------------- report ----

console.log('\n  Published size');
for (const [label, bytes] of Object.entries(breakdown)) {
  if (!bytes) continue;
  console.log(`    ${label.padEnd(40)} ${fmt(bytes).padStart(9)}`);
}
console.log(`    ${'—'.repeat(40)} ${'—'.repeat(9)}`);
console.log(`    ${'total published'.padEnd(40)} ${fmt(publishedBytes).padStart(9)}`);

const usedPercent = (publishedBytes / LIMIT_BYTES) * 100;
console.log(
  `\n  ${usedPercent.toFixed(1)}% of the ${retention.capacity.limitMB} MB GitHub Pages ceiling, across ${editionCount} edition(s)`
);

if (perEdition > 0) {
  const remaining = LIMIT_BYTES - publishedBytes;
  const editionsLeft = Math.floor(remaining / perEdition);
  const crossing = new Date(Date.now() + editionsLeft * 86400000);
  console.log(`  permanent cost per edition   ${(perEdition / 1024).toFixed(0)} KB`);
  console.log(`  editions before the ceiling  ${editionsLeft.toLocaleString()}`);
  console.log(
    `  projected crossing           ${crossing.toISOString().slice(0, 10)} (${(editionsLeft / 365).toFixed(1)} years at one edition a day)`
  );

  if (editionsLeft / 365 < 10) {
    console.log(
      `\n  Note: the permanent archive alone does not fit ten years under this ceiling.\n` +
        `  That is expected and already planned for — see "When the archive outgrows Pages"\n` +
        `  in CLAUDE.md. The projection above is the scheduling signal for that move.`
    );
  }
}

if (usedPercent >= retention.capacity.warnAtPercent) {
  console.log(
    `\n  ⚠ past ${retention.capacity.warnAtPercent}% of the ceiling — start the archive migration in CLAUDE.md`
  );
}

if (staleCandidates.length) {
  console.log(
    `\n  Scratch outside its ${retention.windows.candidates}-day window: ${staleCandidates.length} file(s), ${fmt(reclaimable)} reclaimable`
  );
  if (PRUNE) {
    for (const f of staleCandidates) {
      rmSync(OUT(f));
      console.log(`    removed ${f}`);
    }
    console.log(`  reclaimed ${fmt(reclaimable)}`);
  } else {
    console.log('  run with --prune to reclaim it');
  }
} else {
  console.log('\n  No scratch outside its window.');
}

console.log('');
