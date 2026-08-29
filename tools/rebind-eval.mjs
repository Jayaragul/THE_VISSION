#!/usr/bin/env node
// Re-bind an eval file to the edition as it now stands.
//
//   node tools/rebind-eval.mjs            # newest edition
//   node tools/rebind-eval.mjs 2026-08-29 # a specific date
//
// The eval binding exists so a review cannot silently describe a different edition than the
// one being published: evals/<date>.json records a SHA-256 of the stories array, and the
// validator refuses to publish when it no longer matches. That check is worth keeping.
//
// What was missing is the other half. Editing an edition after review is normal and often
// required — the gate asks for exactly that during a repair — but there was no supported way
// to recompute the hash afterwards. "Stale eval binding" became the single most repeated
// failure in this pipeline's history for that reason, and the run that finally made it
// obvious showed the model writing its own tools/compute-hash.mjs to get at editionHash(),
// only for the repair-containment step to delete it as an out-of-scope file. It was trapped:
// the fix required a capability that did not exist.
//
// This is that capability. It only ever rewrites the binding block — never a score, never a
// verdict, never a line of the review's prose. A re-bind says "this review now points at
// this edition"; it does not claim the edition was re-reviewed.

import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { editionHash, readJSON } from './lib/util.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const arg = process.argv[2];
const date =
  arg ||
  readdirSync(join(ROOT, 'generated'))
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .pop()
    ?.replace('.json', '');

if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error('Usage: node tools/rebind-eval.mjs [YYYY-MM-DD]');
  process.exit(2);
}

const editionPath = join(ROOT, 'generated', `${date}.json`);
const evalPath = join(ROOT, 'evals', `${date}.json`);

if (!existsSync(editionPath)) {
  console.error(`✗ No edition at generated/${date}.json`);
  process.exit(1);
}
if (!existsSync(evalPath)) {
  console.error(
    `✗ No eval at evals/${date}.json. Write the review first — see .claude/skills/editorial-review/SKILL.md.\n` +
      `  This tool re-binds an existing review; it does not invent one.`
  );
  process.exit(1);
}

const doc = readJSON(editionPath);
const hash = editionHash(doc);
const storyCount = doc.stories.length;
const sourceCount = new Set(doc.stories.flatMap((s) => (s.sources || []).map((x) => x.url))).size;

// Edited as text rather than parsed and re-serialised, so a review's own formatting — inline
// score objects, hand-wrapped evidence paragraphs — survives untouched. Only the binding
// values change.
let raw = readFileSync(evalPath, 'utf8');
const before = JSON.parse(raw).edition || {};

if (before.sha256 === hash) {
  console.log(`✓ evals/${date}.json already matches the edition (${hash.slice(0, 16)}…). Nothing to do.`);
  process.exit(0);
}

const swap = (key, value) => {
  const re = new RegExp(`("${key}"\\s*:\\s*)(?:"[^"]*"|\\d+)`);
  if (re.test(raw)) raw = raw.replace(re, `$1${typeof value === 'number' ? value : `"${value}"`}`);
};

swap('sha256', hash);
swap('storyCount', storyCount);
swap('sourceCount', sourceCount);

const after = JSON.parse(raw).edition || {};
if (after.sha256 !== hash) {
  console.error(`✗ Could not rewrite the binding in evals/${date}.json — is its edition block malformed?`);
  process.exit(1);
}

writeFileSync(evalPath, raw);

console.log(`✓ Re-bound evals/${date}.json`);
console.log(`    sha256      ${String(before.sha256).slice(0, 16)}… → ${hash.slice(0, 16)}…`);
if (before.storyCount !== storyCount) console.log(`    storyCount  ${before.storyCount} → ${storyCount}`);
if (before.sourceCount !== sourceCount) console.log(`    sourceCount ${before.sourceCount} → ${sourceCount}`);
console.log(`\n  Scores, verdict and evidence are untouched. If the edition changed materially`);
console.log(`  rather than cosmetically, re-run the editorial review as well.`);
