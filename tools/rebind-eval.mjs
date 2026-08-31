#!/usr/bin/env node
// Re-bind an eval file to the edition as it now stands.
//
//   node tools/rebind-eval.mjs            # newest edition
//   node tools/rebind-eval.mjs 2026-08-29 # a specific date
//   node tools/rebind-eval.mjs --changed  # every edition this run touched (what CI runs)
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
//
// --changed is that same operation with the date worked out from git rather than typed, so
// the pipeline can run it as a step instead of asking the model to remember. It exists
// because asking did not work. On 29 and 30 August a stale binding was the ONLY error left
// at the final gate, twice with no warnings beside it: the loop had converged on the
// journalism and the day still published nothing, because the last line of the repair brief
// went unread. Recomputing a hash is arithmetic, not editorial judgement, and there is
// nothing to gain from making a model on a timeout do it.
//
// Every re-bind stamps reboundAt on the eval. The scores and evidence above it were reached
// against the edition as it stood at review time, so where that field is present the review
// is bound to an edition it did not literally score. Recording it keeps that visible in the
// archive rather than letting a fresh hash imply a re-review that never happened.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { editionHash, readJSON } from './lib/util.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const CHANGED = argv.includes('--changed');
const explicit = argv.find((a) => !a.startsWith('--'));

/** Editions this run created or modified — the same git-based detection tools/gate.mjs uses,
 *  so a backfill of a past date re-binds that date rather than whatever file sorts last. */
function changedDates() {
  let out = '';
  try {
    out = execFileSync('git', ['status', '--porcelain', 'generated/'], { cwd: ROOT, encoding: 'utf8' });
  } catch {
    return [];
  }
  const found = [...out.matchAll(/generated\/(\d{4}-\d{2}-\d{2})\.json/g)].map((m) => m[1]);
  return [...new Set(found)].sort();
}

function newestDate() {
  return readdirSync(join(ROOT, 'generated'))
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .pop()
    ?.replace('.json', '');
}

// Edited as text rather than parsed and re-serialised, so a review's own formatting — inline
// score objects, hand-wrapped evidence paragraphs — survives untouched. Only the binding
// values change.
function setValue(raw, key, value) {
  const re = new RegExp(`("${key}"\\s*:\\s*)(?:"[^"]*"|-?\\d+(?:\\.\\d+)?|null)`);
  if (re.test(raw)) return raw.replace(re, `$1${JSON.stringify(value)}`);
  // Absent: add it as the document's first member. An eval is always a non-empty object, so
  // inserting straight after its opening brace stays valid however the rest of the file wraps.
  const open = raw.indexOf('{');
  if (open === -1) return raw;
  return `${raw.slice(0, open + 1)}\n  ${JSON.stringify(key)}: ${JSON.stringify(value)},${raw.slice(open + 1)}`;
}

/** @returns {'rebound'|'unchanged'|'no-eval'|'no-edition'|'malformed'} */
function rebindOne(date) {
  const editionPath = join(ROOT, 'generated', `${date}.json`);
  const evalPath = join(ROOT, 'evals', `${date}.json`);

  if (!existsSync(editionPath)) return 'no-edition';
  if (!existsSync(evalPath)) return 'no-eval';

  const doc = readJSON(editionPath);
  const hash = editionHash(doc);
  const storyCount = doc.stories.length;
  const sourceCount = new Set(doc.stories.flatMap((s) => (s.sources || []).map((x) => x.url))).size;

  let raw = readFileSync(evalPath, 'utf8');
  let before;
  try {
    before = JSON.parse(raw).edition || {};
  } catch {
    return 'malformed';
  }

  if (before.sha256 === hash) {
    console.log(`✓ evals/${date}.json already matches the edition (${hash.slice(0, 16)}…). Nothing to do.`);
    return 'unchanged';
  }

  raw = setValue(raw, 'sha256', hash);
  raw = setValue(raw, 'storyCount', storyCount);
  raw = setValue(raw, 'sourceCount', sourceCount);
  raw = setValue(raw, 'reboundAt', new Date().toISOString());

  let after;
  try {
    after = JSON.parse(raw).edition || {};
  } catch {
    return 'malformed';
  }
  if (after.sha256 !== hash) return 'malformed';

  writeFileSync(evalPath, raw);

  console.log(`✓ Re-bound evals/${date}.json`);
  console.log(`    sha256      ${String(before.sha256).slice(0, 16)}… → ${hash.slice(0, 16)}…`);
  if (before.storyCount !== storyCount) console.log(`    storyCount  ${before.storyCount} → ${storyCount}`);
  if (before.sourceCount !== sourceCount) console.log(`    sourceCount ${before.sourceCount} → ${sourceCount}`);
  return 'rebound';
}

// ---------------------------------------------------------------------------- --changed ----
//
// Runs between a repair and the gate that judges it, which means it also runs after a repair
// killed by its own timeout — precisely the case where the model is not around to run
// anything. Nothing here fails the step. A missing or malformed eval is a real defect, but
// this is not the tool that rules on it, and exiting non-zero would throw away a paper the
// gate three lines later might well have passed. Anything odd is surfaced as a warning and
// left to the gate.
if (CHANGED) {
  const dates = changedDates();

  if (!dates.length) {
    console.log('No new or changed edition under generated/ — nothing to re-bind.');
    process.exit(0);
  }

  for (const date of dates) {
    const result = rebindOne(date);
    if (result === 'no-eval') {
      console.log(`::warning title=No eval to re-bind::evals/${date}.json does not exist yet.`);
    } else if (result === 'malformed') {
      console.log(`::warning title=Could not re-bind eval::evals/${date}.json has a malformed edition block.`);
    } else if (result === 'no-edition') {
      console.log(`  generated/${date}.json disappeared before it could be re-bound.`);
    }
  }

  console.log('\n  Scores, verdict and evidence are untouched. A re-bind points a review at the');
  console.log('  edition that is actually about to publish; it does not re-review it.');
  process.exit(0);
}

// --------------------------------------------------------------- a single, named edition ----

const date = explicit || newestDate();

if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error('Usage: node tools/rebind-eval.mjs [YYYY-MM-DD | --changed]');
  process.exit(2);
}

const result = rebindOne(date);

if (result === 'no-edition') {
  console.error(`✗ No edition at generated/${date}.json`);
  process.exit(1);
}
if (result === 'no-eval') {
  console.error(
    `✗ No eval at evals/${date}.json. Write the review first — see .claude/skills/editorial-review/SKILL.md.\n` +
      `  This tool re-binds an existing review; it does not invent one.`
  );
  process.exit(1);
}
if (result === 'malformed') {
  console.error(`✗ Could not rewrite the binding in evals/${date}.json — is its edition block malformed?`);
  process.exit(1);
}

if (result === 'rebound') {
  console.log(`\n  Scores, verdict and evidence are untouched. If the edition changed materially`);
  console.log(`  rather than cosmetically, re-run the editorial review as well.`);
}
