// Pictorial cover motifs — the thing that makes a cover depict something.
//
// The plate library in cover.mjs generates abstract fields: gradients, lattices, rings. Good
// texture, but a reader looking at a story about data centre financing saw nineteen
// rectangles. These are editorial illustrations instead — a server rack looks like a server
// rack, a balance scale looks like a balance scale — drawn as flat vectors over the plate as
// a background wash, which is roughly what a magazine does when it cannot get a photograph.
//
// Why not photographs: the paper has no licence to republish press imagery, hotlinked images
// rot and would reintroduce the third-party requests privacy.html says do not happen, and
// stock photos of glowing robot hands are the visual cliché this subject already drowns in.
//
// Every motif is a pure function of (random, palette) and draws inside the 1200x675 frame.
// Silhouettes are bold on purpose: a cover is seen at ~290px wide on the front page, so fine
// detail is wasted and thin strokes disappear.

const W = 1200;
const H = 675;
const n = (v) => Math.round(v * 100) / 100;

// ------------------------------------------------------------------- models --

function neuralNet(random, p) {
  const layers = [4, 6, 6, 3];
  const x0 = 300;
  const spanX = 600;
  const cy = 340;
  const nodes = layers.map((count, li) => {
    const x = x0 + (spanX / (layers.length - 1)) * li;
    const gap = 78;
    const top = cy - ((count - 1) * gap) / 2;
    return Array.from({ length: count }, (_, i) => ({ x, y: top + i * gap }));
  });

  let edges = '';
  for (let li = 0; li < nodes.length - 1; li++) {
    for (const a of nodes[li]) {
      for (const b of nodes[li + 1]) {
        const strong = random() > 0.62;
        edges += `<line x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}" stroke="${strong ? p.glow : p.mid}" stroke-opacity="${strong ? 0.55 : 0.22}" stroke-width="${strong ? 2 : 1}"/>`;
      }
    }
  }

  let dots = '';
  nodes.forEach((layer, li) => {
    for (const node of layer) {
      const hot = li === nodes.length - 1 || random() > 0.7;
      dots += `<circle cx="${n(node.x)}" cy="${n(node.y)}" r="${hot ? 16 : 13}" fill="${hot ? p.glow : p.bright}" fill-opacity="0.95"/>`;
      dots += `<circle cx="${n(node.x)}" cy="${n(node.y)}" r="${hot ? 26 : 21}" fill="none" stroke="${p.bright}" stroke-opacity="0.3" stroke-width="1.5"/>`;
    }
  });

  return edges + dots;
}

function transformerStack(random, p) {
  const blocks = 4;
  const bw = 300;
  const bh = 62;
  const gap = 26;
  const cx = 600;
  const top = 340 - ((blocks * (bh + gap) - gap) / 2);
  let out = '';
  for (let i = 0; i < blocks; i++) {
    const y = top + i * (bh + gap);
    const emphasis = i === blocks - 2;
    out += `<rect x="${n(cx - bw / 2)}" y="${n(y)}" width="${bw}" height="${bh}" rx="6" fill="${emphasis ? p.bright : p.mid}" fill-opacity="${emphasis ? 0.75 : 0.5}" stroke="${p.glow}" stroke-opacity="0.4" stroke-width="1.5"/>`;
    // Internal cells, so a block reads as a matrix rather than a plain bar.
    for (let c = 0; c < 6; c++) {
      out += `<rect x="${n(cx - bw / 2 + 16 + c * 46)}" y="${n(y + 18)}" width="30" height="26" rx="3" fill="${p.glow}" fill-opacity="${n(0.18 + random() * 0.5)}"/>`;
    }
    if (i < blocks - 1) {
      const ay = y + bh;
      out += `<path d="M ${cx} ${n(ay)} L ${cx} ${n(ay + gap - 6)}" stroke="${p.glow}" stroke-opacity="0.7" stroke-width="3"/>`;
      out += `<path d="M ${cx - 7} ${n(ay + gap - 12)} L ${cx} ${n(ay + gap - 4)} L ${cx + 7} ${n(ay + gap - 12)}" fill="none" stroke="${p.glow}" stroke-opacity="0.7" stroke-width="3"/>`;
    }
  }
  return out;
}

function weightGrid(random, p) {
  const cols = 14;
  const rows = 8;
  const cell = 44;
  const gx = 600 - (cols * cell) / 2;
  const gy = 340 - (rows * cell) / 2;
  let out = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = random();
      out += `<rect x="${n(gx + c * cell + 2)}" y="${n(gy + r * cell + 2)}" width="${cell - 5}" height="${cell - 5}" rx="2" fill="${v > 0.82 ? p.glow : v > 0.5 ? p.bright : p.mid}" fill-opacity="${n(0.12 + v * 0.62)}"/>`;
    }
  }
  out += `<rect x="${n(gx - 8)}" y="${n(gy - 8)}" width="${n(cols * cell + 16)}" height="${n(rows * cell + 16)}" fill="none" stroke="${p.glow}" stroke-opacity="0.35" stroke-width="2"/>`;
  return out;
}

// ----------------------------------------------------------------- research --

function paperPlot(random, p) {
  const pw = 420;
  const ph = 460;
  const px = 600 - pw / 2;
  const py = 340 - ph / 2;
  let out = `<rect x="${n(px)}" y="${n(py)}" width="${pw}" height="${ph}" rx="4" fill="${p.deep}" fill-opacity="0.55" stroke="${p.bright}" stroke-opacity="0.45" stroke-width="2"/>`;
  // Title bar + text lines.
  out += `<rect x="${n(px + 34)}" y="${n(py + 38)}" width="${n(pw - 130)}" height="14" rx="3" fill="${p.glow}" fill-opacity="0.8"/>`;
  for (let i = 0; i < 3; i++) {
    out += `<rect x="${n(px + 34)}" y="${n(py + 68 + i * 18)}" width="${n(pw - 68 - random() * 90)}" height="7" rx="2" fill="${p.mid}" fill-opacity="0.55"/>`;
  }
  // The chart, which is what makes it read as a paper rather than a page.
  const cx0 = px + 40;
  const cy0 = py + 160;
  const cw = pw - 80;
  const ch = 190;
  out += `<rect x="${n(cx0)}" y="${n(cy0)}" width="${n(cw)}" height="${n(ch)}" fill="${p.bg}" fill-opacity="0.5"/>`;
  out += `<line x1="${n(cx0)}" y1="${n(cy0 + ch)}" x2="${n(cx0 + cw)}" y2="${n(cy0 + ch)}" stroke="${p.bright}" stroke-opacity="0.6" stroke-width="2"/>`;
  out += `<line x1="${n(cx0)}" y1="${n(cy0)}" x2="${n(cx0)}" y2="${n(cy0 + ch)}" stroke="${p.bright}" stroke-opacity="0.6" stroke-width="2"/>`;
  let d = `M ${n(cx0)} ${n(cy0 + ch)}`;
  let prev = ch;
  for (let i = 1; i <= 10; i++) {
    const x = cx0 + (cw / 10) * i;
    prev = Math.max(14, prev - random() * 34);
    d += ` L ${n(x)} ${n(cy0 + prev)}`;
  }
  out += `<path d="${d}" fill="none" stroke="${p.glow}" stroke-opacity="0.95" stroke-width="3.5"/>`;
  for (let i = 0; i < 3; i++) {
    out += `<rect x="${n(px + 34)}" y="${n(cy0 + ch + 28 + i * 18)}" width="${n(pw - 68 - random() * 120)}" height="7" rx="2" fill="${p.mid}" fill-opacity="0.5"/>`;
  }
  return out;
}

function labFlask(random, p) {
  const cx = 600;
  const cy = 360;
  // Conical flask silhouette.
  const body = `M ${cx - 34} ${cy - 150} L ${cx - 34} ${cy - 60} L ${cx - 130} ${cy + 110} Q ${cx - 140} ${cy + 140} ${cx - 105} ${cy + 140} L ${cx + 105} ${cy + 140} Q ${cx + 140} ${cy + 140} ${cx + 130} ${cy + 110} L ${cx + 34} ${cy - 60} L ${cx + 34} ${cy - 150} Z`;
  let out = `<path d="${body}" fill="${p.mid}" fill-opacity="0.3" stroke="${p.glow}" stroke-opacity="0.85" stroke-width="4"/>`;
  // Liquid.
  out += `<path d="M ${cx - 108} ${cy + 40} L ${cx + 108} ${cy + 40} L ${cx + 128} ${cy + 108} Q ${cx + 140} ${cy + 140} ${cx + 105} ${cy + 140} L ${cx - 105} ${cy + 140} Q ${cx - 140} ${cy + 140} ${cx - 128} ${cy + 108} Z" fill="${p.bright}" fill-opacity="0.75"/>`;
  out += `<rect x="${n(cx - 46)}" y="${n(cy - 160)}" width="92" height="16" rx="4" fill="${p.glow}" fill-opacity="0.9"/>`;
  // Bubbles.
  for (let i = 0; i < 9; i++) {
    out += `<circle cx="${n(cx - 80 + random() * 160)}" cy="${n(cy + 60 + random() * 70)}" r="${n(3 + random() * 8)}" fill="${p.glow}" fill-opacity="${n(0.4 + random() * 0.5)}"/>`;
  }
  // Molecule floating above, so it reads as chemistry not glassware.
  const mx = cx + 210;
  const my = cy - 130;
  const pts = [[0, 0], [46, -26], [46, 30], [-44, 22]];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      out += `<line x1="${n(mx + pts[i][0])}" y1="${n(my + pts[i][1])}" x2="${n(mx + pts[j][0])}" y2="${n(my + pts[j][1])}" stroke="${p.bright}" stroke-opacity="0.5" stroke-width="2"/>`;
    }
  }
  for (const [dx, dy] of pts) {
    out += `<circle cx="${n(mx + dx)}" cy="${n(my + dy)}" r="12" fill="${p.glow}" fill-opacity="0.9"/>`;
  }
  return out;
}

// ----------------------------------------------------------------- business --

function growthChart(random, p) {
  const bars = 7;
  const bw = 74;
  const gap = 22;
  const baseY = 520;
  const x0 = 600 - ((bars * (bw + gap) - gap) / 2);
  let out = '';
  let prevTop = 0;
  const tops = [];
  for (let i = 0; i < bars; i++) {
    const h = 70 + (i / bars) * 260 + random() * 50;
    const x = x0 + i * (bw + gap);
    const top = baseY - h;
    tops.push({ x: x + bw / 2, y: top });
    out += `<rect x="${n(x)}" y="${n(top)}" width="${bw}" height="${n(h)}" rx="3" fill="${i === bars - 1 ? p.glow : p.mid}" fill-opacity="${n(0.45 + (i / bars) * 0.45)}"/>`;
    prevTop = top;
  }
  // Trend line over the bars.
  let d = `M ${n(tops[0].x)} ${n(tops[0].y - 26)}`;
  for (let i = 1; i < tops.length; i++) d += ` L ${n(tops[i].x)} ${n(tops[i].y - 26)}`;
  out += `<path d="${d}" fill="none" stroke="${p.glow}" stroke-opacity="0.95" stroke-width="4" stroke-linecap="round"/>`;
  for (const t of tops) out += `<circle cx="${n(t.x)}" cy="${n(t.y - 26)}" r="7" fill="${p.glow}"/>`;
  out += `<line x1="${n(x0 - 30)}" y1="${baseY}" x2="${n(x0 + bars * (bw + gap) + 8)}" y2="${baseY}" stroke="${p.bright}" stroke-opacity="0.7" stroke-width="3"/>`;
  return out;
}

function coinStack(random, p) {
  const stacks = 3;
  const cx = 600;
  let out = '';
  const heights = [5, 8, 6];
  for (let s = 0; s < stacks; s++) {
    const x = cx - 200 + s * 200;
    const count = heights[s];
    for (let i = 0; i < count; i++) {
      const y = 500 - i * 32;
      out += `<ellipse cx="${n(x)}" cy="${n(y)}" rx="84" ry="24" fill="${i === count - 1 ? p.glow : p.mid}" fill-opacity="${n(0.5 + (i / count) * 0.4)}" stroke="${p.bright}" stroke-opacity="0.5" stroke-width="2"/>`;
    }
  }
  // Upward arrow, so it reads as capital moving rather than just discs.
  out += `<path d="M ${cx - 40} 230 L ${cx} 160 L ${cx + 40} 230" fill="none" stroke="${p.glow}" stroke-opacity="0.9" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
  out += `<line x1="${cx}" y1="168" x2="${cx}" y2="290" stroke="${p.glow}" stroke-opacity="0.9" stroke-width="6" stroke-linecap="round"/>`;
  return out;
}

// ------------------------------------------------------------------- policy --

function scales(random, p) {
  const cx = 600;
  const topY = 180;
  const beamY = 250;
  const armLen = 210;
  const tilt = (random() - 0.5) * 26;
  let out = '';
  // Column and base.
  out += `<rect x="${n(cx - 12)}" y="${n(beamY)}" width="24" height="270" fill="${p.mid}" fill-opacity="0.8"/>`;
  out += `<rect x="${n(cx - 110)}" y="520" width="220" height="26" rx="5" fill="${p.bright}" fill-opacity="0.85"/>`;
  out += `<circle cx="${cx}" cy="${n(topY + 20)}" r="16" fill="${p.glow}"/>`;
  // Beam, tilted.
  out += `<g transform="rotate(${n(tilt)} ${cx} ${n(beamY)})">`;
  out += `<rect x="${n(cx - armLen)}" y="${n(beamY - 7)}" width="${n(armLen * 2)}" height="14" rx="6" fill="${p.glow}" fill-opacity="0.95"/>`;
  for (const side of [-1, 1]) {
    const px = cx + side * armLen;
    out += `<line x1="${n(px)}" y1="${n(beamY)}" x2="${n(px)}" y2="${n(beamY + 78)}" stroke="${p.bright}" stroke-opacity="0.8" stroke-width="3"/>`;
    // Pan.
    out += `<path d="M ${n(px - 72)} ${n(beamY + 78)} Q ${n(px)} ${n(beamY + 150)} ${n(px + 72)} ${n(beamY + 78)} Z" fill="${p.mid}" fill-opacity="0.75" stroke="${p.bright}" stroke-opacity="0.7" stroke-width="2.5"/>`;
  }
  out += `</g>`;
  return out;
}

function institution(random, p) {
  const cx = 600;
  const baseY = 500;
  const cols = 6;
  const colW = 34;
  const span = 420;
  const colTop = 300;
  let out = '';
  // Pediment.
  out += `<path d="M ${n(cx - span / 2 - 30)} ${colTop} L ${cx} ${n(colTop - 120)} L ${n(cx + span / 2 + 30)} ${colTop} Z" fill="${p.bright}" fill-opacity="0.8"/>`;
  out += `<rect x="${n(cx - span / 2 - 34)}" y="${n(colTop)}" width="${n(span + 68)}" height="22" fill="${p.glow}" fill-opacity="0.85"/>`;
  // Columns.
  for (let i = 0; i < cols; i++) {
    const x = cx - span / 2 + (span / (cols - 1)) * i - colW / 2;
    out += `<rect x="${n(x)}" y="${n(colTop + 26)}" width="${colW}" height="${n(baseY - colTop - 26)}" fill="${p.mid}" fill-opacity="0.75"/>`;
    out += `<rect x="${n(x - 5)}" y="${n(colTop + 26)}" width="${colW + 10}" height="10" fill="${p.bright}" fill-opacity="0.7"/>`;
  }
  // Steps.
  for (let i = 0; i < 3; i++) {
    out += `<rect x="${n(cx - span / 2 - 50 - i * 22)}" y="${n(baseY + i * 18)}" width="${n(span + 100 + i * 44)}" height="18" fill="${p.bright}" fill-opacity="${n(0.8 - i * 0.15)}"/>`;
  }
  return out;
}

// ----------------------------------------------------------- infrastructure --

function serverRack(random, p) {
  const racks = 3;
  const rw = 230;
  const rh = 400;
  const gap = 40;
  const x0 = 600 - ((racks * (rw + gap) - gap) / 2);
  const y0 = 340 - rh / 2;
  let out = '';
  for (let r = 0; r < racks; r++) {
    const x = x0 + r * (rw + gap);
    out += `<rect x="${n(x)}" y="${n(y0)}" width="${rw}" height="${rh}" rx="6" fill="${p.deep}" fill-opacity="0.7" stroke="${p.bright}" stroke-opacity="0.6" stroke-width="2.5"/>`;
    const units = 9;
    for (let u = 0; u < units; u++) {
      const uy = y0 + 16 + u * ((rh - 32) / units);
      out += `<rect x="${n(x + 14)}" y="${n(uy)}" width="${n(rw - 28)}" height="${n((rh - 32) / units - 8)}" rx="3" fill="${p.mid}" fill-opacity="0.55"/>`;
      // Status LEDs — the detail that makes it read as machinery.
      for (let l = 0; l < 3; l++) {
        const lit = random() > 0.45;
        out += `<circle cx="${n(x + 30 + l * 16)}" cy="${n(uy + ((rh - 32) / units - 8) / 2)}" r="4" fill="${lit ? p.glow : p.bg}" fill-opacity="${lit ? 0.95 : 0.6}"/>`;
      }
      out += `<rect x="${n(x + rw - 70)}" y="${n(uy + 5)}" width="46" height="6" rx="2" fill="${p.bright}" fill-opacity="0.4"/>`;
    }
  }
  return out;
}

function chipDie(random, p) {
  const cx = 600;
  const cy = 340;
  const size = 260;
  const half = size / 2;
  let out = '';
  // Pins.
  const pins = 9;
  for (let i = 0; i < pins; i++) {
    const t = (i + 0.5) / pins;
    const off = -half + t * size;
    for (const [x1, y1, x2, y2] of [
      [cx + off, cy - half, cx + off, cy - half - 58],
      [cx + off, cy + half, cx + off, cy + half + 58],
      [cx - half, cy + off, cx - half - 58, cy + off],
      [cx + half, cy + off, cx + half + 58, cy + off],
    ]) {
      out += `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${p.bright}" stroke-opacity="0.75" stroke-width="7" stroke-linecap="round"/>`;
    }
  }
  // Package.
  out += `<rect x="${n(cx - half)}" y="${n(cy - half)}" width="${size}" height="${size}" rx="10" fill="${p.deep}" fill-opacity="0.9" stroke="${p.glow}" stroke-opacity="0.8" stroke-width="3"/>`;
  // Die + traces.
  out += `<rect x="${n(cx - 78)}" y="${n(cy - 78)}" width="156" height="156" rx="4" fill="${p.mid}" fill-opacity="0.85"/>`;
  for (let i = 0; i < 5; i++) {
    const o = -60 + i * 30;
    out += `<line x1="${n(cx - 78)}" y1="${n(cy + o)}" x2="${n(cx + 78)}" y2="${n(cy + o)}" stroke="${p.glow}" stroke-opacity="${n(0.25 + random() * 0.5)}" stroke-width="2"/>`;
    out += `<line x1="${n(cx + o)}" y1="${n(cy - 78)}" x2="${n(cx + o)}" y2="${n(cy + 78)}" stroke="${p.glow}" stroke-opacity="${n(0.25 + random() * 0.5)}" stroke-width="2"/>`;
  }
  out += `<circle cx="${cx}" cy="${cy}" r="22" fill="${p.glow}" fill-opacity="0.95"/>`;
  return out;
}

function coolingTowers(random, p) {
  const baseY = 540;
  let out = '';
  const towers = [
    { x: 420, w: 150, h: 260 },
    { x: 600, w: 180, h: 320 },
    { x: 800, w: 150, h: 240 },
  ];
  for (const t of towers) {
    const top = baseY - t.h;
    // Hyperboloid silhouette.
    out += `<path d="M ${n(t.x - t.w / 2)} ${n(baseY)} Q ${n(t.x - t.w / 5)} ${n(top + t.h * 0.45)} ${n(t.x - t.w / 2.6)} ${n(top)} L ${n(t.x + t.w / 2.6)} ${n(top)} Q ${n(t.x + t.w / 5)} ${n(top + t.h * 0.45)} ${n(t.x + t.w / 2)} ${n(baseY)} Z" fill="${p.mid}" fill-opacity="0.75" stroke="${p.bright}" stroke-opacity="0.6" stroke-width="2.5"/>`;
    // Plume.
    for (let i = 0; i < 4; i++) {
      out += `<ellipse cx="${n(t.x + (random() - 0.5) * 60)}" cy="${n(top - 30 - i * 34)}" rx="${n(46 + i * 16)}" ry="${n(22 + i * 7)}" fill="${p.glow}" fill-opacity="${n(0.26 - i * 0.05)}"/>`;
    }
  }
  out += `<rect x="300" y="${n(baseY)}" width="620" height="16" fill="${p.bright}" fill-opacity="0.7"/>`;
  return out;
}

function powerGrid(random, p) {
  const baseY = 540;
  let out = '';
  const pylons = [340, 600, 860];
  const tops = [];
  for (const x of pylons) {
    const h = 300 + random() * 60;
    const top = baseY - h;
    tops.push({ x, top });
    // Lattice tower.
    out += `<path d="M ${n(x - 62)} ${n(baseY)} L ${n(x - 20)} ${n(top)} L ${n(x + 20)} ${n(top)} L ${n(x + 62)} ${n(baseY)}" fill="none" stroke="${p.bright}" stroke-opacity="0.85" stroke-width="5"/>`;
    for (let i = 1; i < 6; i++) {
      const t = i / 6;
      const y = baseY - (baseY - top) * t;
      const wHere = 62 - t * 42;
      out += `<line x1="${n(x - wHere)}" y1="${n(y)}" x2="${n(x + wHere)}" y2="${n(y)}" stroke="${p.mid}" stroke-opacity="0.6" stroke-width="3"/>`;
    }
    // Cross-arms.
    out += `<line x1="${n(x - 84)}" y1="${n(top + 40)}" x2="${n(x + 84)}" y2="${n(top + 40)}" stroke="${p.glow}" stroke-opacity="0.9" stroke-width="5"/>`;
    out += `<line x1="${n(x - 62)}" y1="${n(top + 92)}" x2="${n(x + 62)}" y2="${n(top + 92)}" stroke="${p.glow}" stroke-opacity="0.7" stroke-width="4"/>`;
  }
  // Catenary lines between pylons.
  for (let i = 0; i < tops.length - 1; i++) {
    const a = tops[i];
    const b = tops[i + 1];
    for (const [off, sag] of [[40, 62], [92, 54]]) {
      out += `<path d="M ${n(a.x + 84)} ${n(a.top + off)} Q ${n((a.x + b.x) / 2)} ${n(Math.max(a.top, b.top) + off + sag)} ${n(b.x - 84)} ${n(b.top + off)}" fill="none" stroke="${p.glow}" stroke-opacity="0.55" stroke-width="2.5"/>`;
    }
  }
  return out;
}

// ------------------------------------------------------------------ society --

function cityscape(random, p) {
  const baseY = 540;
  let out = '';
  let x = 240;
  while (x < 960) {
    const w = 54 + random() * 66;
    const h = 90 + random() * 300;
    const top = baseY - h;
    out += `<rect x="${n(x)}" y="${n(top)}" width="${n(w)}" height="${n(h)}" fill="${p.mid}" fill-opacity="${n(0.45 + random() * 0.4)}"/>`;
    // Lit windows.
    const cols = Math.max(1, Math.floor(w / 20));
    const rows = Math.max(1, Math.floor(h / 30));
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (random() > 0.58) {
          out += `<rect x="${n(x + 7 + c * 20)}" y="${n(top + 12 + r * 30)}" width="8" height="12" fill="${p.glow}" fill-opacity="${n(0.5 + random() * 0.5)}"/>`;
        }
      }
    }
    x += w + 8 + random() * 14;
  }
  out += `<rect x="200" y="${n(baseY)}" width="800" height="14" fill="${p.bright}" fill-opacity="0.75"/>`;
  return out;
}

function peopleNetwork(random, p) {
  const count = 7;
  const cx = 600;
  const cy = 340;
  const r = 210;
  const people = Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * 0.82 };
  });
  let out = '';
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      if (random() > 0.45) {
        out += `<line x1="${n(people[i].x)}" y1="${n(people[i].y)}" x2="${n(people[j].x)}" y2="${n(people[j].y)}" stroke="${p.mid}" stroke-opacity="0.35" stroke-width="1.5"/>`;
      }
    }
  }
  for (const person of people) {
    // Head + shoulders, so these read as people rather than nodes.
    out += `<circle cx="${n(person.x)}" cy="${n(person.y - 20)}" r="20" fill="${p.glow}" fill-opacity="0.9"/>`;
    out += `<path d="M ${n(person.x - 30)} ${n(person.y + 34)} Q ${n(person.x)} ${n(person.y - 4)} ${n(person.x + 30)} ${n(person.y + 34)} Z" fill="${p.bright}" fill-opacity="0.85"/>`;
  }
  out += `<circle cx="${cx}" cy="${cy}" r="34" fill="${p.glow}" fill-opacity="0.28"/>`;
  return out;
}

function globe(random, p) {
  const cx = 600;
  const cy = 340;
  const r = 200;
  let out = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${p.mid}" fill-opacity="0.35" stroke="${p.glow}" stroke-opacity="0.85" stroke-width="3"/>`;
  // Latitudes.
  for (let i = 1; i < 5; i++) {
    const t = i / 5;
    const y = cy - r + t * 2 * r;
    const rx = Math.sqrt(Math.max(0, r * r - (y - cy) * (y - cy)));
    out += `<ellipse cx="${cx}" cy="${n(y)}" rx="${n(rx)}" ry="${n(rx * 0.22)}" fill="none" stroke="${p.bright}" stroke-opacity="0.45" stroke-width="1.8"/>`;
  }
  // Longitudes.
  for (let i = 0; i < 4; i++) {
    const squash = Math.cos((i / 4) * Math.PI) * 0.92;
    out += `<ellipse cx="${cx}" cy="${cy}" rx="${n(Math.abs(r * squash))}" ry="${r}" fill="none" stroke="${p.bright}" stroke-opacity="0.4" stroke-width="1.8"/>`;
  }
  // Connection arcs, marking it as a network rather than a map.
  for (let i = 0; i < 4; i++) {
    const a1 = random() * Math.PI * 2;
    const a2 = a1 + 1 + random() * 2;
    const x1 = cx + Math.cos(a1) * r * 0.92;
    const y1 = cy + Math.sin(a1) * r * 0.92;
    const x2 = cx + Math.cos(a2) * r * 0.92;
    const y2 = cy + Math.sin(a2) * r * 0.92;
    out += `<path d="M ${n(x1)} ${n(y1)} Q ${cx} ${cy} ${n(x2)} ${n(y2)}" fill="none" stroke="${p.glow}" stroke-opacity="0.7" stroke-width="2.5"/>`;
    out += `<circle cx="${n(x1)}" cy="${n(y1)}" r="7" fill="${p.glow}"/>`;
    out += `<circle cx="${n(x2)}" cy="${n(y2)}" r="7" fill="${p.glow}"/>`;
  }
  return out;
}

// --------------------------------------------------------------------------

const MOTIFS = {
  neuralNet, transformerStack, weightGrid,
  paperPlot, labFlask,
  growthChart, coinStack,
  scales, institution,
  serverRack, chipDie, coolingTowers, powerGrid,
  cityscape, peopleNetwork, globe,
};

/** Which motifs suit which beat. A story's cover should depict something related to its
 *  subject — a policy story gets scales or an institution, not a server rack. */
export const MOTIFS_BY_BEAT = {
  models: ['neuralNet', 'transformerStack', 'weightGrid', 'chipDie'],
  research: ['paperPlot', 'labFlask', 'neuralNet', 'weightGrid'],
  business: ['growthChart', 'coinStack', 'cityscape', 'institution'],
  policy: ['scales', 'institution', 'globe', 'paperPlot'],
  infrastructure: ['serverRack', 'chipDie', 'coolingTowers', 'powerGrid'],
  society: ['peopleNetwork', 'cityscape', 'globe', 'scales'],
};

export const MOTIF_NAMES = Object.keys(MOTIFS);

/** Plain-language description of what each motif depicts, for the cover's aria-label.
 *  A screen reader should get "a stylised computer chip", not "abstract illustration". */
export const MOTIF_LABELS = {
  neuralNet: 'A stylised neural network of connected nodes',
  transformerStack: 'Stacked model layers passing data upward',
  weightGrid: 'A grid of model weights at varying intensity',
  paperPlot: 'A research paper with a rising plotted curve',
  labFlask: 'A laboratory flask beside a molecular diagram',
  growthChart: 'A rising bar chart with a trend line',
  coinStack: 'Stacks of coins beneath an upward arrow',
  scales: 'A tilted set of balance scales',
  institution: 'A classical institutional building with columns',
  serverRack: 'Rows of server racks with status lights',
  chipDie: 'A stylised computer chip with pins and traces',
  coolingTowers: 'Data centre cooling towers venting plumes',
  powerGrid: 'Electricity pylons carrying power lines',
  cityscape: 'A city skyline with lit windows',
  peopleNetwork: 'A ring of people connected by lines',
  globe: 'A wireframe globe crossed by connection arcs',
};

export function renderMotif(name, random, palette) {
  const fn = MOTIFS[name];
  if (!fn) throw new Error(`unknown motif "${name}"`);
  return fn(random, palette);
}
