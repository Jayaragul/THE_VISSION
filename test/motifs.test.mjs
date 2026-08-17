import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMotif, MOTIF_NAMES, MOTIF_LABELS, MOTIFS_BY_BEAT } from '../tools/lib/motifs.mjs';
import { renderCover } from '../tools/lib/cover.mjs';
import { rng } from '../tools/lib/util.mjs';

const palette = {
  bg: '#0c0b0a', bgAlt: '#171614', deep: '#2a2724',
  mid: '#8a5a3a', bright: '#d08a5a', glow: '#ffb87a',
};

test('every motif renders non-trivial geometry and no template gaps', () => {
  for (const name of MOTIF_NAMES) {
    const svg = renderMotif(name, rng(`t-${name}`), palette);
    const primitives = (svg.match(/<(rect|circle|ellipse|path|polygon|line)\b/g) || []).length;
    assert.ok(primitives >= 4, `${name} drew only ${primitives} primitive(s)`);
    assert.equal(svg.includes('undefined'), false, `${name} emitted "undefined"`);
    assert.equal(svg.includes('NaN'), false, `${name} emitted NaN`);
  }
});

test('every motif has a plain-language label for screen readers', () => {
  for (const name of MOTIF_NAMES) {
    assert.ok(MOTIF_LABELS[name], `${name} has no MOTIF_LABELS entry`);
    assert.ok(MOTIF_LABELS[name].length > 12, `${name}'s label is too terse to be useful`);
  }
});

test('every beat maps only to motifs that actually exist', () => {
  for (const [beat, names] of Object.entries(MOTIFS_BY_BEAT)) {
    assert.ok(names.length >= 2, `beat ${beat} has too few motif options`);
    for (const name of names) {
      assert.ok(MOTIF_NAMES.includes(name), `beat ${beat} references unknown motif "${name}"`);
    }
  }
});

test('an unknown motif name throws rather than silently drawing nothing', () => {
  assert.throws(() => renderMotif('notAMotif', rng('x'), palette), /unknown motif/);
});

test('a cover with a beat depicts a subject; one without stays abstract', () => {
  const withBeat = renderCover({ seed: 'story-1', accent: '#0369a1', beat: 'infrastructure' });
  const without = renderCover({ seed: 'story-1', accent: '#0369a1' });
  assert.match(withBeat, /aria-label="[^"]+— original cover illustration"/);
  assert.match(without, /aria-label="Abstract cover illustration"/);
  assert.notEqual(withBeat, without);
});

test('beat selection stays within that beat\'s own motif set — a policy story never gets a server rack', () => {
  const policyLabels = MOTIFS_BY_BEAT.policy.map((m) => MOTIF_LABELS[m]);
  for (let i = 0; i < 40; i++) {
    const svg = renderCover({ seed: `policy-story-${i}`, accent: '#b45309', beat: 'policy' });
    const label = /aria-label="([^"]+) — original cover illustration"/.exec(svg)[1];
    assert.ok(policyLabels.includes(label), `policy story ${i} got an off-beat motif: ${label}`);
  }
});

test('covers stay deterministic with motifs in play', () => {
  const a = renderCover({ seed: 'story-x', accent: '#c8102e', beat: 'models' });
  const b = renderCover({ seed: 'story-x', accent: '#c8102e', beat: 'models' });
  assert.equal(a, b);
});

test('forcing a motif overrides beat selection, for editorial control', () => {
  const svg = renderCover({ seed: 'story-y', accent: '#c8102e', beat: 'models', motif: 'scales' });
  assert.match(svg, new RegExp(MOTIF_LABELS.scales));
});
