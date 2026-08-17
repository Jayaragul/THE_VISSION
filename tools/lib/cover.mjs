// Original cover art, generated per story.
//
// Why generate instead of scraping og:image? Three reasons, in order of importance:
// we do not have a licence to republish other people's press photography; hotlinked
// images rot within weeks and take the page's credibility with them; and a house
// visual language is worth more than a grid of mismatched stock photos.
//
// Art is a pure function of the story id, so a published cover never changes.

import { rng, hexToHSL, hslToHex, clamp } from './util.mjs';

const W = 1200;
const H = 675;

export const STYLES = [
  'orbit', 'strata', 'lattice', 'swell', 'shard', 'aperture',
  'contour', 'column', 'spiral', 'mesh',
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

const RENDERERS = { orbit, strata, lattice, swell, shard, aperture, contour, column, spiral, mesh };

// ------------------------------------------------------------------- shell --

/**
 * @param {object} opts
 * @param {string} opts.seed      Stable seed — always the story id.
 * @param {string} opts.accent    Beat accent hex.
 * @param {string} [opts.style]   Force a style; otherwise derived from the seed.
 * @returns {string} A standalone SVG document.
 */
export function renderCover({ seed, accent = '#c8102e', style }) {
  const random = rng(seed);
  const p = palette(accent, random);
  const chosen = style && RENDERERS[style]
    ? style
    : STYLES[Math.floor(random() * STYLES.length) % STYLES.length];

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

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Abstract cover illustration">
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
<g clip-path="url(#frame)">${RENDERERS[chosen](random, p)}</g>
<rect width="${W}" height="${H}" fill="url(#halo)" style="mix-blend-mode:screen"/>
<g clip-path="url(#frame)">${grid}</g>
<rect width="${W}" height="${H}" fill="url(#vig)"/>
<rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.14" style="mix-blend-mode:overlay"/>
</svg>`;
}
