#!/usr/bin/env node
// Renders every plate in the 100-plate cover library to one HTML contact sheet, so the
// library can be reviewed by eye before it ships. Not part of the site build — a design
// tool, run by hand.
//
//   node tools/gen-cover-sheet.mjs > /tmp/covers.html

import { renderCover, PLATE_COUNT } from './lib/cover.mjs';

const ACCENTS = ['#c8102e', '#5b3fd6', '#0f7a5a', '#b45309', '#0369a1', '#7c2d6b'];

const cards = Array.from({ length: PLATE_COUNT }, (_, i) => {
  const accent = ACCENTS[i % ACCENTS.length];
  const svg = renderCover({ seed: `preview-plate-${i}`, accent, plateIndex: i });
  const b64 = Buffer.from(svg).toString('base64');
  return `<figure><img src="data:image/svg+xml;base64,${b64}" width="220" height="124"><figcaption>#${i}</figcaption></figure>`;
}).join('\n');

console.log(`<!doctype html><html><head><meta charset="utf-8"><title>Cover library — ${PLATE_COUNT} plates</title>
<style>
body{background:#0c0b0a;margin:0;padding:24px;font-family:sans-serif}
h1{color:#f5f1ea;font-size:16px;margin-bottom:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
figure{margin:0}
img{width:100%;display:block;border-radius:3px}
figcaption{color:#9a928a;font-size:11px;font-family:monospace;margin-top:3px}
</style></head><body>
<h1>Cover library — ${PLATE_COUNT} plates, colour-cycled across the six beat accents</h1>
<div class="grid">
${cards}
</div>
</body></html>`);
