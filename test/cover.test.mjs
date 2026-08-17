import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderCover, PLATE_COUNT, STYLES } from '../tools/lib/cover.mjs';
import { hash32 } from '../tools/lib/util.mjs';

test('renderCover is byte-for-byte deterministic for the same seed and accent', () => {
  const a = renderCover({ seed: '2026-08-17-example-story', accent: '#c8102e' });
  const b = renderCover({ seed: '2026-08-17-example-story', accent: '#c8102e' });
  assert.equal(a, b);
});

test('a different seed produces different art (not a hard collision on the same input)', () => {
  const a = renderCover({ seed: 'story-a', accent: '#c8102e' });
  const b = renderCover({ seed: 'story-b', accent: '#c8102e' });
  assert.notEqual(a, b);
});

test('forcing a plateIndex draws the same shape regardless of which story asked for it', () => {
  const a = renderCover({ seed: 'story-a', accent: '#c8102e', plateIndex: 42 });
  const b = renderCover({ seed: 'story-b', accent: '#0369a1', plateIndex: 42 });
  // Same plate index must draw the same geometry (coordinates, radii, element order) —
  // that is the whole plate-library guarantee. Colour legitimately differs, since it comes
  // from the story's own id and the beat's accent, not the plate; strip fill/stroke hex
  // values before comparing so the test checks shape, not colour.
  const shapeOf = (svg) => {
    const g = svg.slice(svg.indexOf('<g clip-path="url(#frame)">'), svg.lastIndexOf('</g>'));
    return g.replace(/#[0-9a-f]{6}/gi, '#______');
  };
  assert.equal(shapeOf(a), shapeOf(b));
  // And colour genuinely does differ between them, or the "shared plate, different light"
  // design claim would be false in the other direction.
  assert.notEqual(a, b);
});

test('output is well-formed SVG with a closing tag and no unresolved template gaps', () => {
  const svg = renderCover({ seed: 'x', accent: '#5b3fd6' });
  assert.match(svg, /^<svg /);
  assert.match(svg, /<\/svg>$/);
  assert.equal(svg.includes('undefined'), false);
  assert.equal(svg.includes('NaN'), false);
});

test('every one of the 100 plates renders non-trivial geometry (catches a family silently producing near-empty output)', () => {
  for (let i = 0; i < PLATE_COUNT; i++) {
    const svg = renderCover({ seed: `audit-${i}`, accent: '#0f7a5a', plateIndex: i });
    const geomStart = svg.indexOf('<g clip-path="url(#frame)">') + '<g clip-path="url(#frame)">'.length;
    const geomEnd = svg.indexOf('</g>', geomStart);
    const geom = svg.slice(geomStart, geomEnd);
    const primitives = (geom.match(/<(rect|circle|ellipse|path|polygon|line)\b/g) || []).length;
    assert.ok(primitives >= 2, `plate ${i} rendered only ${primitives} primitive(s)`);
  }
});

test('all 18 style families appear at least once across the 100-plate library (regression for the mesh-never-appears bug)', () => {
  const seen = new Set();
  for (let i = 0; i < PLATE_COUNT; i++) {
    seen.add(STYLES[hash32(`plate-family-${i}`) % STYLES.length]);
  }
  const missing = STYLES.filter((s) => !seen.has(s));
  assert.deepEqual(missing, [], `these families never appear in the 100-plate library: ${missing.join(', ')}`);
});
