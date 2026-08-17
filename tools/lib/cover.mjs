// Original cover art, generated per story.
//
// Why generate instead of scraping og:image? Three reasons, in order of importance:
// we do not have a licence to republish other people's press photography; hotlinked
// images rot within weeks and take the page's credibility with them; and a house
// visual language is worth more than a grid of mismatched stock photos.
//
// Art is a pure function of the story id, so a published cover never changes.
//
// The shapes come from a fixed, auditable library of 100 canonical plates (see PLATE_COUNT
// below) across 18 composition families, so the site is never leaning on an RNG's luck to
// avoid repetition — run `node tools/gen-cover-sheet.mjs` to render every plate for review.

import { rng, hash32, hexToHSL, hslToHex, clamp } from './util.mjs';
import { renderMotif, MOTIFS_BY_BEAT, MOTIF_NAMES, MOTIF_LABELS } from './motifs.mjs';

const W = 1200;
const H = 675;

export const STYLES = [
  'orbit', 'strata', 'lattice', 'swell', 'shard', 'aperture',
  'contour', 'column', 'spiral', 'mesh',
  'constellation', 'weave', 'terrain', 'current', 'fracture', 'drift', 'beacon', 'strand',
];

// Two stories in the same beat used to come out nearly identical: hue drift worked out to
// about ±5°, so all six `models` covers sat within four degrees of each other, and six
// styles across thirteen stories collided constantly. The fix is a much larger deterministic
// variation space — a wide hue excursion, a per-story colour scheme, varied saturation and
// lightness, and ten styles rather than six.
const HUE_SHIFTS = [-52, -38, -27, -16, -8, 0, 8, 16, 27, 38, 52];

/** Build a duotone-plus-glow palette from the beat's accent colour. */
function palette(accent, random) {
  const { h, s } = hexToHSL(accent);

  // Wide, deterministic excursion. Stays inside an analogous range so the beat's colour
  // family is still recognisable, but far enough apart that no two covers read as twins.
  const shift = HUE_SHIFTS[Math.floor(random() * HUE_SHIFTS.length) % HUE_SHIFTS.length];
  const jitter = (random() - 0.5) * 14;
  const base = h + shift + jitter;

  // Vary the internal spread too — some covers near-monochrome, others split across the wheel.
  const spread = 14 + random() * 46;
  const dir = random() > 0.5 ? 1 : -1;

  // And vary tone, so two covers of the same hue still differ in weight.
  const satScale = 0.72 + random() * 0.55;
  const dark = 5 + random() * 7;

  return {
    bg: hslToHex({ h: base - dir * spread * 0.3, s: clamp(s * 0.45 * satScale, 14, 42), l: dark }),
    bgAlt: hslToHex({ h: base + dir * spread * 0.5, s: clamp(s * 0.55 * satScale, 18, 52), l: dark + 7 + random() * 6 }),
    deep: hslToHex({ h: base - dir * spread * 0.2, s: clamp(s * 0.7 * satScale, 28, 62), l: 20 + random() * 10 }),
    mid: hslToHex({ h: base, s: clamp(s * satScale, 44, 86), l: 38 + random() * 16 }),
    bright: hslToHex({ h: base + dir * spread * 0.7, s: clamp(s * 1.05 * satScale, 52, 94), l: 56 + random() * 14 }),
    glow: hslToHex({ h: base + dir * spread, s: 88 + random() * 10, l: 66 + random() * 12 }),
  };
}

const n = (v) => Math.round(v * 100) / 100;

// ------------------------------------------------------------ compositions --

function orbit(random, p) {
  const cx = W * (0.32 + random() * 0.36);
  const cy = H * (0.34 + random() * 0.3);
  const rings = 6 + Math.floor(random() * 5);
  const step = 46 + random() * 34;
  const tilt = -28 + random() * 56;
  let out = `<g transform="rotate(${n(tilt)} ${n(cx)} ${n(cy)})">`;
  for (let i = rings; i >= 1; i--) {
    const r = step * i;
    const squash = 0.42 + random() * 0.3;
    const op = n(0.1 + (i / rings) * 0.34);
    out += `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(r)}" ry="${n(r * squash)}" fill="none" stroke="${p.mid}" stroke-opacity="${op}" stroke-width="${n(0.8 + random() * 2.2)}"/>`;
  }
  out += '</g>';
  out += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(step * 0.9)}" fill="url(#core)"/>`;
  const sat = 2 + Math.floor(random() * 3);
  for (let i = 0; i < sat; i++) {
    const a = random() * Math.PI * 2;
    const r = step * (1.6 + random() * 3.4);
    out += `<circle cx="${n(cx + Math.cos(a) * r)}" cy="${n(cy + Math.sin(a) * r * 0.55)}" r="${n(4 + random() * 12)}" fill="${p.glow}" fill-opacity="${n(0.5 + random() * 0.4)}"/>`;
  }
  return out;
}

function strata(random, p) {
  const bands = 14 + Math.floor(random() * 10);
  const skew = -10 + random() * 20;
  let out = `<g transform="skewY(${n(skew * 0.35)})">`;
  let y = -H * 0.15;
  for (let i = 0; i < bands && y < H * 1.1; i++) {
    const h = 8 + random() * 62;
    const inset = random() * W * 0.22;
    const op = n(0.08 + random() * 0.5);
    const fill = random() > 0.72 ? p.bright : p.mid;
    out += `<rect x="${n(-40 + inset)}" y="${n(y)}" width="${n(W + 80 - inset * (random() > 0.5 ? 1 : 0.2))}" height="${n(h)}" fill="${fill}" fill-opacity="${op}"/>`;
    if (random() > 0.78) {
      out += `<rect x="${n(inset)}" y="${n(y)}" width="${n(W * (0.1 + random() * 0.3))}" height="${n(h)}" fill="${p.glow}" fill-opacity="${n(0.25 + random() * 0.4)}"/>`;
    }
    y += h + 4 + random() * 22;
  }
  out += '</g>';
  return out;
}

function lattice(random, p) {
  const cols = 26;
  const rows = 15;
  const cw = W / cols;
  const ch = H / rows;
  const gap = 2.5;
  const ax = random() * 2 - 1;
  const ay = random() * 2 - 1;
  const phase = random() * Math.PI * 2;
  let out = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const u = c / cols;
      const v = r / rows;
      const wave = Math.sin(u * Math.PI * (1.4 + ax) + v * Math.PI * (1.2 + ay) + phase);
      const strength = (wave + 1) / 2;
      if (strength < 0.22) continue;
      const filled = strength > 0.55;
      const op = n(clamp(strength * 0.72 - 0.1, 0.05, 0.72));
      const fill = strength > 0.86 ? p.bright : p.mid;
      out += filled
        ? `<rect x="${n(c * cw + gap)}" y="${n(r * ch + gap)}" width="${n(cw - gap * 2)}" height="${n(ch - gap * 2)}" fill="${fill}" fill-opacity="${op}"/>`
        : `<rect x="${n(c * cw + gap)}" y="${n(r * ch + gap)}" width="${n(cw - gap * 2)}" height="${n(ch - gap * 2)}" fill="none" stroke="${p.mid}" stroke-opacity="${n(op * 0.8)}" stroke-width="1"/>`;
    }
  }
  return out;
}

function swell(random, p) {
  const lines = 7 + Math.floor(random() * 5);
  const baseAmp = 40 + random() * 70;
  const freq = 1 + random() * 1.8;
  const phase = random() * Math.PI * 2;
  let out = '';
  for (let i = lines; i >= 0; i--) {
    const t = i / lines;
    const yBase = H * 0.28 + t * H * 0.62;
    const amp = baseAmp * (1 - t * 0.55);
    let d = `M -40 ${n(yBase)}`;
    for (let x = -40; x <= W + 40; x += 30) {
      const y = yBase + Math.sin((x / W) * Math.PI * 2 * freq + phase + t * 1.7) * amp;
      d += ` L ${n(x)} ${n(y)}`;
    }
    d += ` L ${W + 40} ${H + 40} L -40 ${H + 40} Z`;
    const op = n(0.14 + t * 0.42);
    out += `<path d="${d}" fill="${i % 3 === 0 ? p.bright : p.mid}" fill-opacity="${op}"/>`;
    out += `<path d="${d.split(' L ' + (W + 40))[0]}" fill="none" stroke="${p.glow}" stroke-opacity="${n(0.18 + t * 0.3)}" stroke-width="1.4"/>`;
  }
  return out;
}

function shard(random, p) {
  const ox = W * (0.2 + random() * 0.6);
  const oy = H * (0.15 + random() * 0.7);
  const count = 5 + Math.floor(random() * 4);
  let out = '';
  let angle = random() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const spread = 0.22 + random() * 0.5;
    const reach = H * (1.1 + random() * 1.4);
    const a1 = angle;
    const a2 = angle + spread;
    const pts = [
      [ox, oy],
      [ox + Math.cos(a1) * reach, oy + Math.sin(a1) * reach],
      [ox + Math.cos((a1 + a2) / 2) * reach * 1.12, oy + Math.sin((a1 + a2) / 2) * reach * 1.12],
      [ox + Math.cos(a2) * reach, oy + Math.sin(a2) * reach],
    ]
      .map(([x, y]) => `${n(x)},${n(y)}`)
      .join(' ');
    const op = n(0.1 + random() * 0.42);
    out += `<polygon points="${pts}" fill="${i % 3 === 0 ? p.bright : p.mid}" fill-opacity="${op}"/>`;
    out += `<line x1="${n(ox)}" y1="${n(oy)}" x2="${n(ox + Math.cos(a1) * reach)}" y2="${n(oy + Math.sin(a1) * reach)}" stroke="${p.glow}" stroke-opacity="0.35" stroke-width="1"/>`;
    angle = a2 + random() * 0.35;
  }
  out += `<circle cx="${n(ox)}" cy="${n(oy)}" r="${n(6 + random() * 10)}" fill="${p.glow}" fill-opacity="0.9"/>`;
  return out;
}

function aperture(random, p) {
  const cx = W * (0.38 + random() * 0.24);
  const cy = H * (0.42 + random() * 0.18);
  const blades = 7 + Math.floor(random() * 6);
  const outer = 180 + random() * 150;
  const inner = outer * (0.2 + random() * 0.3);
  const twist = 0.35 + random() * 0.55;
  let out = `<g>`;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2;
    const b = a + (Math.PI * 2) / blades;
    const pts = [
      [cx + Math.cos(a) * inner, cy + Math.sin(a) * inner],
      [cx + Math.cos(a + twist) * outer, cy + Math.sin(a + twist) * outer],
      [cx + Math.cos(b + twist) * outer, cy + Math.sin(b + twist) * outer],
      [cx + Math.cos(b) * inner, cy + Math.sin(b) * inner],
    ]
      .map(([x, y]) => `${n(x)},${n(y)}`)
      .join(' ');
    const op = n(0.16 + (i / blades) * 0.46);
    out += `<polygon points="${pts}" fill="${i % 2 ? p.mid : p.bright}" fill-opacity="${op}" stroke="${p.glow}" stroke-opacity="0.22" stroke-width="1"/>`;
  }
  out += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(inner)}" fill="url(#core)"/>`;
  out += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(outer * 1.28)}" fill="none" stroke="${p.mid}" stroke-opacity="0.3" stroke-width="1.2"/>`;
  out += '</g>';
  return out;
}

function contour(random, p) {
  const lines = 16 + Math.floor(random() * 14);
  const cx = W * (0.2 + random() * 0.6);
  const cy = H * (0.2 + random() * 0.6);
  const warp = 0.4 + random() * 1.4;
  const phase = random() * Math.PI * 2;
  let out = '';
  for (let i = 0; i < lines; i++) {
    const t = i / lines;
    const r = 40 + t * H * 1.15;
    let d = '';
    for (let a = 0; a <= 361; a += 6) {
      const rad = (a * Math.PI) / 180;
      const wobble = 1 + Math.sin(rad * (2 + Math.floor(warp * 3)) + phase + t * 2.4) * 0.16 * warp;
      const x = cx + Math.cos(rad) * r * wobble;
      const y = cy + Math.sin(rad) * r * wobble * 0.62;
      d += `${a === 0 ? 'M' : 'L'} ${n(x)} ${n(y)} `;
    }
    out += `<path d="${d}Z" fill="none" stroke="${i % 5 === 0 ? p.bright : p.mid}" stroke-opacity="${n(0.12 + (1 - t) * 0.45)}" stroke-width="${n(0.7 + (1 - t) * 1.6)}"/>`;
  }
  return out;
}

function column(random, p) {
  const cols = 26 + Math.floor(random() * 26);
  const gap = 2 + random() * 4;
  const cw = (W + 60) / cols;
  const phase = random() * Math.PI * 2;
  const freq = 0.8 + random() * 2.6;
  const baseline = H * (0.55 + random() * 0.3);
  let out = '';
  for (let i = 0; i < cols; i++) {
    const u = i / cols;
    const env = Math.abs(Math.sin(u * Math.PI * freq + phase));
    const h = 20 + env * H * (0.42 + random() * 0.4);
    const x = -30 + i * cw;
    const fill = env > 0.78 ? p.glow : env > 0.45 ? p.bright : p.mid;
    out += `<rect x="${n(x)}" y="${n(baseline - h)}" width="${n(cw - gap)}" height="${n(h)}" fill="${fill}" fill-opacity="${n(0.2 + env * 0.55)}"/>`;
    if (random() > 0.82) {
      out += `<rect x="${n(x)}" y="${n(baseline)}" width="${n(cw - gap)}" height="${n(h * (0.15 + random() * 0.35))}" fill="${p.mid}" fill-opacity="0.18"/>`;
    }
  }
  out += `<line x1="-30" y1="${n(baseline)}" x2="${W + 30}" y2="${n(baseline)}" stroke="${p.glow}" stroke-opacity="0.4" stroke-width="1"/>`;
  return out;
}

function spiral(random, p) {
  const cx = W * (0.3 + random() * 0.4);
  const cy = H * (0.32 + random() * 0.36);
  const turns = 3 + random() * 4;
  const dots = 150 + Math.floor(random() * 180);
  const growth = 0.9 + random() * 0.9;
  const tilt = random() * Math.PI;
  let out = '';
  for (let i = 0; i < dots; i++) {
    const t = i / dots;
    const a = t * Math.PI * 2 * turns + tilt;
    const r = Math.pow(t, growth) * H * 0.72;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * 0.6;
    const size = 1.2 + t * 6.5;
    out += `<circle cx="${n(x)}" cy="${n(y)}" r="${n(size)}" fill="${t > 0.72 ? p.glow : t > 0.4 ? p.bright : p.mid}" fill-opacity="${n(0.25 + t * 0.6)}"/>`;
  }
  return out;
}

function mesh(random, p) {
  const blobs = 4 + Math.floor(random() * 4);
  let defs = '';
  let out = '';
  for (let i = 0; i < blobs; i++) {
    const cx = random();
    const cy = random();
    const r = 0.3 + random() * 0.5;
    const col = i % 3 === 0 ? p.glow : i % 3 === 1 ? p.bright : p.mid;
    defs += `<radialGradient id="m${i}" cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}">
<stop offset="0" stop-color="${col}" stop-opacity="${n(0.5 + random() * 0.45)}"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></radialGradient>`;
    out += `<rect width="${W}" height="${H}" fill="url(#m${i})" style="mix-blend-mode:screen"/>`;
  }
  // A few crisp edges stop it reading as an undifferentiated blur.
  const cuts = 2 + Math.floor(random() * 3);
  for (let i = 0; i < cuts; i++) {
    const y = H * random();
    out += `<line x1="0" y1="${n(y)}" x2="${W}" y2="${n(y + (random() - 0.5) * 120)}" stroke="${p.glow}" stroke-opacity="${n(0.15 + random() * 0.25)}" stroke-width="${n(0.8 + random())}"/>`;
  }
  return `<defs>${defs}</defs>${out}`;
}

function constellation(random, p) {
  const count = 22 + Math.floor(random() * 26);
  const pts = Array.from({ length: count }, () => ({
    x: -40 + random() * (W + 80),
    y: -40 + random() * (H + 80),
    r: 1.4 + random() * 5.5,
  }));
  const reach = 90 + random() * 130;
  let out = '';
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i].x - pts[j].x;
      const dy = pts[i].y - pts[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < reach) {
        out += `<line x1="${n(pts[i].x)}" y1="${n(pts[i].y)}" x2="${n(pts[j].x)}" y2="${n(pts[j].y)}" stroke="${p.mid}" stroke-opacity="${n(0.35 * (1 - dist / reach))}" stroke-width="0.8"/>`;
      }
    }
  }
  for (const pt of pts) {
    const hub = pt.r > 4.5;
    out += `<circle cx="${n(pt.x)}" cy="${n(pt.y)}" r="${n(pt.r)}" fill="${hub ? p.glow : p.bright}" fill-opacity="${n(hub ? 0.85 : 0.55)}"/>`;
  }
  return out;
}

function weave(random, p) {
  const angleA = 22 + random() * 20;
  const angleB = -(22 + random() * 20);
  const gap = 26 + random() * 30;
  const width = 4 + random() * 10;
  const diag = Math.hypot(W, H) * 1.4;
  let out = `<g opacity="0.85">`;
  for (const [angle, tone] of [[angleA, p.mid], [angleB, p.bright]]) {
    let group = `<g transform="rotate(${n(angle)} ${W / 2} ${H / 2})">`;
    for (let x = -diag / 2; x < diag; x += gap) {
      group += `<rect x="${n(x)}" y="${n(-diag / 2)}" width="${n(width)}" height="${n(diag * 2)}" fill="${tone}" fill-opacity="${n(0.14 + random() * 0.22)}"/>`;
    }
    group += '</g>';
    out += group;
  }
  out += '</g>';
  return out;
}

function terrain(random, p) {
  const layers = 3 + Math.floor(random() * 3);
  let out = '';
  for (let l = 0; l < layers; l++) {
    const t = l / layers;
    const baseline = H * (0.4 + t * 0.5);
    const blockW = 30 + random() * 70;
    const tone = l === layers - 1 ? p.bright : p.mid;
    let x = -40;
    let d = `M ${x} ${H + 20} `;
    while (x < W + 40) {
      const h = 30 + random() * H * (0.2 + (1 - t) * 0.35);
      d += `L ${n(x)} ${n(baseline - h)} L ${n(x + blockW * 0.7)} ${n(baseline - h)} `;
      x += blockW * (0.7 + random() * 0.6);
      d += `L ${n(x)} ${n(baseline - h * (0.4 + random() * 0.5))} `;
    }
    d += `L ${n(W + 40)} ${H + 20} Z`;
    out += `<path d="${d}" fill="${tone}" fill-opacity="${n(0.16 + t * 0.5)}"/>`;
  }
  return out;
}

function current(random, p) {
  const ribbons = 3 + Math.floor(random() * 4);
  let out = '';
  for (let i = 0; i < ribbons; i++) {
    const t = i / ribbons;
    const y0 = H * (0.15 + random() * 0.7);
    const y1 = H * (0.15 + random() * 0.7);
    const y2 = H * (0.15 + random() * 0.7);
    const widthStart = 6 + random() * 30;
    const widthEnd = 6 + random() * 30;
    const c1x = W * (0.25 + random() * 0.2);
    const c2x = W * (0.55 + random() * 0.2);
    const top = `M -20 ${n(y0)} C ${n(c1x)} ${n(y0)}, ${n(c1x)} ${n(y1)}, ${n(W / 2)} ${n(y1)} S ${n(c2x)} ${n(y2)}, ${n(W + 20)} ${n(y2)}`;
    const bottom = `L ${n(W + 20)} ${n(y2 + widthEnd)} C ${n(c2x)} ${n(y2 + widthEnd)}, ${n(W / 2)} ${n(y1 + (widthStart + widthEnd) / 2)}, ${n(c1x)} ${n(y1 + widthStart)} S -20 ${n(y0 + widthStart)}, -20 ${n(y0 + widthStart)} Z`;
    const tone = i % 3 === 0 ? p.glow : i % 2 === 0 ? p.bright : p.mid;
    out += `<path d="${top} ${bottom}" fill="${tone}" fill-opacity="${n(0.14 + t * 0.4)}"/>`;
  }
  return out;
}

function fracture(random, p) {
  const cols = 8 + Math.floor(random() * 5);
  const rows = 5 + Math.floor(random() * 4);
  const cw = W / cols;
  const ch = H / rows;
  const jitter = 0.3 + random() * 0.35;
  const grid = [];
  for (let r = 0; r <= rows; r++) {
    const row = [];
    for (let c = 0; c <= cols; c++) {
      row.push({
        x: c * cw + (random() - 0.5) * cw * jitter,
        y: r * ch + (random() - 0.5) * ch * jitter,
      });
    }
    grid.push(row);
  }
  let out = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = grid[r][c];
      const b = grid[r][c + 1];
      const cPt = grid[r + 1][c + 1];
      const d = grid[r + 1][c];
      const splitOne = random() > 0.5;
      const tris = splitOne ? [[a, b, cPt], [a, cPt, d]] : [[a, b, d], [b, cPt, d]];
      for (const tri of tris) {
        const shade = random();
        const tone = shade > 0.86 ? p.glow : shade > 0.55 ? p.bright : p.mid;
        const pts = tri.map((pt) => `${n(pt.x)},${n(pt.y)}`).join(' ');
        out += `<polygon points="${pts}" fill="${tone}" fill-opacity="${n(0.08 + shade * 0.34)}" stroke="${p.bg}" stroke-opacity="0.4" stroke-width="0.6"/>`;
      }
    }
  }
  return out;
}

function drift(random, p) {
  const blobs = 9 + Math.floor(random() * 10);
  let out = '';
  for (let i = 0; i < blobs; i++) {
    const cx = random() * W;
    const cy = random() * H;
    const r = 40 + random() * 220;
    const tone = i % 4 === 0 ? p.glow : i % 3 === 0 ? p.bright : p.mid;
    out += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${tone}" fill-opacity="${n(0.06 + random() * 0.16)}"/>`;
  }
  return out;
}

function beacon(random, p) {
  const ox = random() > 0.5 ? -60 : W + 60;
  const oy = H * (0.1 + random() * 0.8);
  const arcs = 7 + Math.floor(random() * 6);
  const spread = 0.35 + random() * 0.5;
  const baseAngle = Math.atan2(H / 2 - oy, W / 2 - ox);
  let out = '';
  for (let i = arcs; i >= 1; i--) {
    const r = 60 + i * (Math.hypot(W, H) / arcs) * 0.55;
    const a1 = baseAngle - spread;
    const a2 = baseAngle + spread;
    const large = a2 - a1 > Math.PI ? 1 : 0;
    const x1 = ox + Math.cos(a1) * r;
    const y1 = oy + Math.sin(a1) * r;
    const x2 = ox + Math.cos(a2) * r;
    const y2 = oy + Math.sin(a2) * r;
    const op = n(0.06 + ((arcs - i) / arcs) * 0.3);
    out += `<path d="M ${n(x1)} ${n(y1)} A ${n(r)} ${n(r)} 0 ${large} 1 ${n(x2)} ${n(y2)}" fill="none" stroke="${i % 4 === 0 ? p.glow : p.mid}" stroke-opacity="${op}" stroke-width="${n(1 + (arcs - i) * 0.5)}"/>`;
  }
  out += `<circle cx="${n(ox)}" cy="${n(oy)}" r="14" fill="${p.glow}" fill-opacity="0.9"/>`;
  return out;
}

function strand(random, p) {
  const ribbons = 2 + Math.floor(random() * 3);
  let out = '';
  for (let i = 0; i < ribbons; i++) {
    const y0 = H * random();
    const y1 = H * random();
    const y2 = H * random();
    const c1 = W * (0.2 + random() * 0.25);
    const c2 = W * (0.55 + random() * 0.25);
    const d = `M -20 ${n(y0)} C ${n(c1)} ${n(y0)}, ${n(c1)} ${n(y1)}, ${n(W / 2)} ${n(y1)} S ${n(c2)} ${n(y2)}, ${n(W + 20)} ${n(y2)}`;
    const width = 2 + random() * 5;
    const tone = i === 0 ? p.glow : p.bright;
    out += `<path d="${d}" fill="none" stroke="${tone}" stroke-opacity="${n(0.4 + random() * 0.4)}" stroke-width="${n(width)}" stroke-linecap="round"/>`;
    out += `<path d="${d}" fill="none" stroke="${tone}" stroke-opacity="0.15" stroke-width="${n(width * 4)}" stroke-linecap="round"/>`;
  }
  return out;
}

const RENDERERS = {
  orbit, strata, lattice, swell, shard, aperture, contour, column, spiral, mesh,
  constellation, weave, terrain, current, fracture, drift, beacon, strand,
};

// ------------------------------------------------------------------- shell --

// A hundred stories can pass through this file long before a hundred distinct random seeds
// happen to produce a hundred distinct-*looking* pieces of art by chance. So instead of
// trusting the RNG to never repeat, the geometry is drawn from a fixed, auditable library of
// exactly PLATE_COUNT canonical plates: `plate-0` through `plate-99`, each one a specific,
// reproducible combination of a style family and that family's internal parameters. Which
// plate a story uses is picked from the story's own id; the plate's shape is generated from
// the plate's own seed, not the story's, so plate 42 draws identically everywhere it is used
// and the library can be rendered once and inspected in full — see tools/gen-cover-sheet.mjs.
// Colour is layered on top from the story id and the beat's accent, so two stories sharing a
// plate still read as different covers: same silhouette, different light.
export const PLATE_COUNT = 100;

function drawPlate(plateIndex, p) {
  const idx = ((plateIndex % PLATE_COUNT) + PLATE_COUNT) % PLATE_COUNT;
  // Family is picked by hashing the plate index directly, salted separately from the
  // geometry seed — not by taking the first draw from a freshly-seeded PRNG. That first
  // draw turned out to correlate badly across the near-identical seed strings "plate-0"
  // through "plate-99": one family (mesh) never appeared anywhere in the 100-plate library,
  // while three others were drawn 9 times each. hash32 has better avalanche on adjacent
  // integers than mulberry32's first output does on adjacent seed strings — confirmed by
  // re-running the family-distribution audit after this change (see tools/gen-cover-sheet.mjs).
  const style = STYLES[hash32(`plate-family-${idx}`) % STYLES.length];
  const plateRandom = rng(`plate-geometry-${idx}`);
  return { style, svg: RENDERERS[style](plateRandom, p) };
}

/**
 * @param {object} opts
 * @param {string} opts.seed      Stable seed — always the story id.
 * @param {string} opts.accent    Beat accent hex.
 * @param {string} [opts.style]      Force a style, bypassing the plate library, for editorial
 *                                   control over one specific cover. Geometry is then seeded
 *                                   from the story itself rather than a shared plate.
 * @param {number} [opts.plateIndex] Force a specific plate (0..PLATE_COUNT-1) rather than
 *                                   deriving one from the seed. For QA/preview tooling —
 *                                   see tools/gen-cover-sheet.mjs, which uses this to render
 *                                   every plate in the library once for visual inspection.
 * @param {string} [opts.beat]       Beat id. Selects a subject-appropriate pictorial motif —
 *                                   a policy story gets scales, an infrastructure story gets
 *                                   a server rack. Without it the cover is abstract pattern
 *                                   only, which is what every cover used to be.
 * @param {string} [opts.motif]      Force a specific motif by name, for editorial control.
 * @returns {string} A standalone SVG document.
 */
export function renderCover({ seed, accent = '#c8102e', style, plateIndex, beat, motif }) {
  const random = rng(seed);
  const p = palette(accent, random);

  let chosen, geometry;
  if (style && RENDERERS[style]) {
    chosen = style;
    geometry = RENDERERS[chosen](random, p);
  } else {
    const idx = plateIndex != null ? plateIndex : Math.floor(random() * PLATE_COUNT);
    const plate = drawPlate(idx, p);
    chosen = plate.style;
    geometry = plate.svg;
  }

  // The pictorial layer. The plate above becomes a background wash behind it — an
  // illustration on a textured field, rather than the field being the whole cover.
  let subject = '';
  let motifName = null;
  if (motif && MOTIF_NAMES.includes(motif)) {
    motifName = motif;
  } else if (beat && MOTIFS_BY_BEAT[beat]) {
    const options = MOTIFS_BY_BEAT[beat];
    motifName = options[Math.floor(random() * options.length) % options.length];
  }
  if (motifName) {
    // Seeded separately from the plate so a story's subject illustration varies
    // independently of which background field it landed on.
    subject = renderMotif(motifName, rng(`motif-${seed}-${motifName}`), p);
  }

  const gx = 20 + random() * 60;
  const gy = 10 + random() * 50;

  // Fine rule grid — the thing that reads as "designed" rather than "generated".
  let grid = '';
  for (let x = 0; x <= W; x += 100) {
    grid += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#ffffff" stroke-opacity="0.035" stroke-width="1"/>`;
  }
  for (let y = 0; y <= H; y += 100) {
    grid += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#ffffff" stroke-opacity="0.035" stroke-width="1"/>`;
  }

  // Describe what is actually drawn. These covers depict specific subjects now, so
  // "abstract illustration" would be both unhelpful and untrue to a screen reader.
  const label = motifName ? `${MOTIF_LABELS[motifName]} — original cover illustration` : 'Abstract cover illustration';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${label}">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="${p.bgAlt}"/><stop offset="0.55" stop-color="${p.bg}"/><stop offset="1" stop-color="${p.deep}"/>
</linearGradient>
<radialGradient id="core" cx="0.4" cy="0.35" r="0.75">
<stop offset="0" stop-color="${p.glow}" stop-opacity="0.95"/><stop offset="0.5" stop-color="${p.bright}" stop-opacity="0.55"/><stop offset="1" stop-color="${p.mid}" stop-opacity="0"/>
</radialGradient>
<radialGradient id="halo" cx="${n(gx / 100)}" cy="${n(gy / 100)}" r="0.85">
<stop offset="0" stop-color="${p.glow}" stop-opacity="0.4"/><stop offset="1" stop-color="${p.glow}" stop-opacity="0"/>
</radialGradient>
<radialGradient id="vig" cx="0.5" cy="0.5" r="0.75">
<stop offset="0.55" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.55"/>
</radialGradient>
<filter id="grain" x="0" y="0" width="100%" height="100%">
<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch" result="t"/>
<feColorMatrix type="saturate" values="0" in="t" result="g"/>
</filter>
<clipPath id="frame"><rect x="0" y="0" width="${W}" height="${H}"/></clipPath>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<g clip-path="url(#frame)"${subject ? ' opacity="0.42"' : ''}>${geometry}</g>
<rect width="${W}" height="${H}" fill="url(#halo)" style="mix-blend-mode:screen"/>
<g clip-path="url(#frame)">${grid}</g>
${subject ? `<rect width="${W}" height="${H}" fill="${p.bg}" opacity="0.3"/>\n<g clip-path="url(#frame)">${subject}</g>` : ''}
<rect width="${W}" height="${H}" fill="url(#vig)"/>
<rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.14" style="mix-blend-mode:overlay"/>
</svg>`;
}
