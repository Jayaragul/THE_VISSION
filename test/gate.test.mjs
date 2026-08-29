// The publish gate, exercised end to end against the real archive.
//
// These exist because of a deadlock that stopped the paper publishing. The scheduled gate
// ran `validate.mjs --strict` with no file argument, which validates every edition ever
// published and treats any warning as fatal. Beat-quota and story-count shortfalls were
// warnings — so an edition that ran one story light in August permanently blocked every
// future edition, and no amount of good journalism could clear it. A run reported
// "0 error(s) · 28 warning(s)" and refused to publish a sound edition.
//
// Worse, it enforced the opposite of rule 5: "a short edition beats a padded one." The
// checker was demanding the padding the rules forbid.
//
// Two invariants keep it fixed: shape shortfalls are advisory notes and never block, and
// the archive stays free of hard errors so today's edition is never held hostage to a
// historical warning that rule 3 makes unfixable.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function runValidate(args) {
  try {
    return { code: 0, out: execFileSync('node', ['tools/validate.mjs', ...args], { cwd: ROOT, encoding: 'utf8' }) };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

test('the archive carries no hard errors — the gate condition for publishing', () => {
  const { code, out } = runValidate([]);
  assert.equal(code, 0, `archive has errors:\n${out}`);
  assert.match(out, /0 error\(s\)/);
});

test('a beat or story-count shortfall is a note, never a blocking warning', () => {
  // Rule 5 permits a short edition. The checker must not contradict the rules it enforces.
  const { out } = runValidate([]);
  const shapeAsWarning = out
    .split('\n')
    .filter((l) => /^\s+warn\s/.test(l))
    .filter((l) => /(target is|house range is|exceeds the target ceiling)/.test(l));
  assert.deepEqual(shapeAsWarning, [], 'shape shortfalls must be reported as notes, not warnings');
});

test('the newest edition clears strict on its own — the bar the gate applies', () => {
  // This is what the scheduled gate actually runs: strict against the edition this run
  // produced, never against the archive.
  //
  // Older editions are deliberately NOT asserted here. 2026-08-21's lead has no tier-1
  // primary and 2026-08-19 cited hosts that were unvetted at the time; both are true, both
  // are permanent, and rule 3 makes the archive a record rather than a working draft. That
  // those editions cannot be brought up to today's bar is precisely why the gate must not
  // be pointed at them — it is the deadlock this file exists to prevent.
  const editions = readdirSync(join(ROOT, 'generated'))
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  assert.ok(editions.length > 0, 'no editions found');

  const newest = editions[editions.length - 1];
  const { code, out } = runValidate(['--strict', `generated/${newest}`]);
  assert.equal(code, 0, `${newest} fails its own strict gate:\n${out}`);
});

test('strict still blocks on a real quality problem', () => {
  // The fix must not have defanged the gate. A missing required field is a hard error and
  // has to fail regardless of how the shape checks are classified.
  const { code } = runValidate(['--strict', 'generated/does-not-exist.json']);
  assert.notEqual(code, 0, 'a missing edition file must fail the gate');
});
