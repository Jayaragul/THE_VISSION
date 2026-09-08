// Determinism and edge-case coverage for the ordering and scoring paths.
//
// The failure these guard against is not a crash — it is a build that produces different
// bytes on a different machine. verify.yml asserts the committed HTML is exactly what the
// JSON builds to, so an ordering that depends on the host's ICU data or on whatever order
// a Map happened to be filled in does not degrade quietly: it fails CI on a diff nobody
// wrote, in a file nobody touched.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cmp, cmpDesc, monogram } from '../tools/lib/util.mjs';
import { buildWeeklyDoc } from '../tools/lib/weekly.mjs';

// --- cmp / cmpDesc -----------------------------------------------------------

test('cmp keeps human A-Z reading order rather than raw code-unit order', () => {
  // Code-unit comparison puts every capital before every lowercase, so a plain `<` sort
  // renders an entity index as "ADP, Accel" instead of "Accel, ADP". Case-folding first
  // is what keeps the rendered list readable.
  assert.equal(cmp('Accel', 'ADP') < 0, true);
  assert.equal(cmp('adp', 'Accel') > 0, true);
  assert.deepEqual(['ADP', 'Accel', '8VC'].sort(cmp), ['8VC', 'Accel', 'ADP']);
});

test('cmp is a total order: strings equal when case-folded still get one defined order', () => {
  // "Nvidia" and "NVIDIA" both appear in the archive. Without the code-unit tie-break they
  // compare equal, and their order then depends on which one the input happened to list
  // first — the exact class of hidden input-order dependency this file exists to prevent.
  assert.notEqual(cmp('Nvidia', 'NVIDIA'), 0);
  assert.equal(cmp('Nvidia', 'NVIDIA') + cmp('NVIDIA', 'Nvidia'), 0, 'must be antisymmetric');

  const a = ['Nvidia', 'NVIDIA', 'nvidia'];
  assert.deepEqual([...a].sort(cmp), [...a].reverse().sort(cmp), 'order must not depend on input order');
});

test('cmp does not consult the host locale', () => {
  // localeCompare with no locale argument resolves against the running Node's ICU data and
  // the environment's LANG. cmp must not: identical inputs, identical answer, everywhere.
  assert.equal(cmp('a', 'B') < 0, true);
  assert.equal(cmp('Z', 'a') > 0, true);
  assert.equal(cmp('', ''), 0);
  assert.equal(cmp('é', 'e') !== 0, true, 'distinct strings never compare equal');
});

test('cmp coerces non-strings instead of throwing on a missing field', () => {
  assert.equal(cmp(undefined, undefined), 0);
  assert.equal(typeof cmp(null, 'a'), 'number');
  assert.equal(typeof cmp(3, 12), 'number');
});

test('cmpDesc is exactly cmp reversed, tie-break included', () => {
  assert.equal(cmpDesc('a', 'b'), cmp('b', 'a'));
  assert.equal(cmpDesc('Nvidia', 'NVIDIA'), cmp('NVIDIA', 'Nvidia'));
  const dates = ['2026-09-01', '2026-09-08', '2026-08-17'];
  assert.deepEqual([...dates].sort(cmpDesc), ['2026-09-08', '2026-09-01', '2026-08-17']);
});

// --- monogram ----------------------------------------------------------------

test('monogram falls back to ?? for a name with no usable characters', () => {
  // `''.split(/\s+/)` is [''], not [], so the length-0 branch was unreachable and these
  // returned an empty badge instead of the placeholder written for them.
  assert.equal(monogram('!!!'), '??');
  assert.equal(monogram(''), '??');
  assert.equal(monogram('   '), '??');
  assert.equal(monogram('日本経済新聞'), '??', 'characters the A-Za-z0-9 filter strips entirely');
});

test('monogram still handles the ordinary cases', () => {
  assert.equal(monogram('TechCrunch'), 'TE');
  assert.equal(monogram('Hugging Face'), 'HF');
  assert.equal(monogram('A'), 'A');
  // Documenting rather than asserting an improvement: an apostrophe is a separator, so
  // "Sheriff's" splits into "Sheriff" + "s" and the badge reads SS, not SO. It is a real
  // wart, but the fix would change rendered output for every affected publisher badge, so
  // it belongs in a deliberate change rather than smuggled in behind a determinism fix.
  assert.equal(monogram("Sheriff's Office"), 'SS');
  assert.equal(monogram('Siskiyou County Sheriff'), 'SC', 'unaffected when no possessive leads');
});

// --- weekly reproducibility --------------------------------------------------

const EDITIONS = [
  {
    edition: { date: '2026-09-07', number: 15 },
    stories: [{ id: '2026-09-07-a', beat: 'models', headline: 'A', prominence: 'lead', sources: [] }],
  },
];

test('buildWeeklyDoc is byte-identical across runs when the clock is pinned', () => {
  const opts = { now: '2026-09-07T00:00:00.000Z' };
  const a = buildWeeklyDoc(EDITIONS, '2026-09-07', opts);
  const b = buildWeeklyDoc(EDITIONS, '2026-09-07', opts);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.week.generatedAt, '2026-09-07T00:00:00.000Z');
});

test('buildWeeklyDoc still stamps the wall clock when no clock is supplied', () => {
  const doc = buildWeeklyDoc(EDITIONS, '2026-09-07');
  assert.match(doc.week.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
});
