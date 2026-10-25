// The overhead (2D) drawings of the buildings added in Phase 4. Each is a method of the Renderer
// (mixed in at the bottom of renderer.js), so they use its box, window and roof helpers. They only
// draw: the rules for what each building does live in config.js and the systems that read it.

import { PALETTE, STRUCTURES } from './config.js';
import { HALF_W, HALF_H, gridToWorld } from './iso.js';
import { lit, litA } from './color.js';
import { hash2 } from './utils.js';

function poly(ctx, pts) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const px = (p[0] - p[1]) * HALF_W;
    const py = (p[0] + p[1]) * HALF_H - (p[2] || 0);
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.closePath();
}

function fillPoly(ctx, L, pts, color, shade = 1) {
  ctx.fillStyle = lit(color, shade, L);
  poly(ctx, pts);
  ctx.fill();
}

// A pyramid roof over the rectangle, peak at (px, py, top).
function pyramid(ctx, L, x0, y0, x1, y1, h, top, color, px = (x0 + x1) / 2, py = (y0 + y1) / 2) {
  fillPoly(ctx, L, [[x0, y1, h], [x1, y1, h], [px, py, top]], color, 1.02);
  fillPoly(ctx, L, [[x1, y1, h], [x1, y0, h], [px, py, top]], color, 0.8);
}

// How lit a building's windows are: homes by who lives there, shops while open, services all night.
function lightOf(r, x, y, s, ghost, L, kind) {
  if (ghost) return { lit: () => false, fill: 0 };
  const t = r.city.getTile(x, y);
  const def = STRUCTURES[s.type];
  const fill = def.capacity ? (s.residents || 0) / def.capacity : t ? t.workersFilled / Math.max(1, def.jobs) : 0;
  const level = kind === 'night' ? Math.max(0.35, fill) : kind === 'shop' ? (fill > 0 && r.shopOpen(L) ? 0.85 : 0) : fill;
  return { lit: (i) => level > 0 && r.isWindowLit(x, y, i, level, L), fill };
}

// A row of n windows along one face of a box.
function windowRow(r, ctx, L, face, b, n, v0, v1, light, idx = 0, u0 = 0.1, u1 = 0.9, gap = 0.3) {
  const w = (u1 - u0) / n;
  for (let k = 0; k < n; k++) {
    const a = u0 + k * w + (w * gap) / 2;
    const c = u0 + (k + 1) * w - (w * gap) / 2;
    r.drawWindow(ctx, L, r.faceQuad(face, b.x0, b.y0, b.x1, b.y1, a, c, v0, v1), face === 'L' ? 0.92 : 0.8, light.lit(idx + k + (face === 'L' ? 0 : 7)));
  }
}

// A door on the left (front) face.
function doorL(r, ctx, L, b, u0, u1, h, color = '#8a5a3b') {
  fillPoly(ctx, L, r.faceQuad('L', b.x0, b.y0, b.x1, b.y1, u0, u1, 0, h), color, 0.9);
}

// Stripes of an awning sloping out from the front face at height v, over the box's front.
function awning(ctx, L, b, v, depth, a, c, n = 6, u0 = 0.05, u1 = 0.95) {
  const w = (b.x1 - b.x0) * (u1 - u0);
  const xs = b.x0 + (b.x1 - b.x0) * u0;
  for (let k = 0; k < n; k++) {
    const xa = xs + (w * k) / n;
    const xb = xs + (w * (k + 1)) / n;
    fillPoly(ctx, L, [[xa, b.y1, v], [xb, b.y1, v], [xb, b.y1 + depth, v - 3], [xa, b.y1 + depth, v - 3]], k % 2 ? c : a, 0.96);
  }
}

function chimney(r, ctx, L, x, y, h, z0 = 0) {
  r.drawBox(ctx, L, x, y, x + 0.08, y + 0.08, z0, h, '#d9c0a8');
}

// Smoke puffs rising from a point, for chimneys and stacks.
function smoke(r, ctx, L, x, y, z, seed, size = 1, tone = '#f2eee8') {
  if (r.reduceMotion) return;
  const top = gridToWorld(x, y, z);
  for (let i = 0; i < 3; i++) {
    const t = (r.time * 0.3 + i / 3 + hash2(Math.floor(x * 10), Math.floor(y * 10), seed)) % 1;
    ctx.fillStyle = litA(tone, 1, L, (0.5 * (1 - t)).toFixed(3));
    ctx.beginPath();
    ctx.arc(top.x + t * 7 * size + Math.sin(t * 6) * 1.5, top.y - t * 16 * size, (1.8 + t * 3.5) * size, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---- Homes ---------------------------------------------------------------------------------------

function bungalow(ctx, x, y, s, L, ghost) {
  const v = this.variantOf(s, 'mint');
  const b = { x0: x + 0.12, x1: x + 0.88, y0: y + 0.3, y1: y + 0.7 };
  const h = 9;
  const light = lightOf(this, x, y, s, ghost, L, 'home');
  this.drawBox(ctx, L, b.x0, b.y0, b.x1, b.y1, 0, h, v.wall, false);
  windowRow(this, ctx, L, 'L', b, 3, 3, 7, light, 0, 0.08, 0.68);
  doorL(this, ctx, L, b, 0.76, 0.9, 7);
  windowRow(this, ctx, L, 'R', b, 2, 3, 7, light, 3, 0.15, 0.85);
  // A long low roof, and a veranda along the front.
  this.gableRoof(ctx, L, b.x0, b.y0, b.x1, b.y1, h, 7, this.roofColor(v.roof), v.wall);
  this.drawBox(ctx, L, b.x0 + 0.04, b.y1, b.x1 - 0.04, b.y1 + 0.07, 0, 1.2, PALETTE.stone);
  chimney(this, ctx, L, b.x0 + 0.14, b.y0 + 0.06, 8, h - 1);
}

function rowhouse(ctx, x, y, s, L, ghost) {
  const light = lightOf(this, x, y, s, ghost, L, 'home');
  const walls = ['#f4d9c6', '#d9e7d2', '#f2e1b8'];
  const roofs = ['#c97a5a', '#8e6aa8', '#5e8f8a'];
  const hs = [19, 22, 19];
  for (let k = 0; k < 3; k++) {
    const x0 = x + 0.1 + k * 0.265;
    const b = { x0, x1: x0 + 0.265, y0: y + 0.26, y1: y + 0.74 };
    this.drawBox(ctx, L, b.x0, b.y0, b.x1, b.y1, 0, hs[k], walls[k], false);
    this.drawWindow(ctx, L, this.faceQuad('L', b.x0, b.y0, b.x1, b.y1, 0.2, 0.8, 3, 8), 0.92, light.lit(k));
    this.drawWindow(ctx, L, this.faceQuad('L', b.x0, b.y0, b.x1, b.y1, 0.12, 0.38, hs[k] - 9, hs[k] - 3), 0.92, light.lit(k + 3));
    this.drawWindow(ctx, L, this.faceQuad('L', b.x0, b.y0, b.x1, b.y1, 0.62, 0.88, hs[k] - 9, hs[k] - 3), 0.92, light.lit(k + 6));
    fillPoly(ctx, L, this.faceQuad('L', b.x0, b.y0, b.x1, b.y1, 0.4, 0.6, 0, 7), '#7a4b2e', 0.9);
    if (k === 2) this.drawWindow(ctx, L, this.faceQuad('R', b.x0, b.y0, b.x1, b.y1, 0.25, 0.75, 5, 12), 0.8, light.lit(9));
    this.gableRoof(ctx, L, b.x0, b.y0, b.x1, b.y1, hs[k], 6 + k % 2 * 2, roofs[k], walls[k]);
  }
}

function villa(ctx, x, y, s, L, ghost) {
  const v = this.variantOf(s, 'blush');
  const light = lightOf(this, x, y, s, ghost, L, 'home');
  const b = { x0: x + 0.2, x1: x + 0.8, y0: y + 0.24, y1: y + 0.72 };
  const h = 16;
  this.drawBox(ctx, L, b.x0, b.y0, b.x1, b.y1, 0, h, '#fbf3e4', false);
  windowRow(this, ctx, L, 'L', b, 3, 4, 11, light, 0, 0.18, 0.84);
  windowRow(this, ctx, L, 'R', b, 2, 4, 11, light, 3, 0.15, 0.85);
  doorL(this, ctx, L, b, 0.4, 0.55, 8, '#6b4630');
  // A corner tower with a pointed roof, and a hip roof over the rest.
  const t = { x0: b.x0 - 0.03, x1: b.x0 + 0.2, y0: b.y1 - 0.2, y1: b.y1 + 0.03 };
  this.drawBox(ctx, L, t.x0, t.y0, t.x1, t.y1, 0, 22, '#fbf3e4', false);
  this.drawWindow(ctx, L, this.faceQuad('L', t.x0, t.y0, t.x1, t.y1, 0.3, 0.7, 12, 19), 0.92, light.lit(8));
  pyramid(ctx, L, t.x0 - 0.02, t.y0 - 0.02, t.x1 + 0.02, t.y1 + 0.02, 22, 34, v.roof);
  this.gableRoof(ctx, L, b.x0, b.y0, b.x1, b.y1, h, 8, this.roofColor(v.roof), '#fbf3e4');
  // A balcony, and round bushes in the garden.
  this.drawBox(ctx, L, b.x1 - 0.22, b.y1, b.x1 - 0.04, b.y1 + 0.07, 8, 1.3, '#ece0cc');
  for (const [bx, by] of [[0.12, 0.84], [0.88, 0.8], [0.5, 0.88]]) {
    const p = gridToWorld(x + bx, y + by, 0);
    ctx.fillStyle = lit('#7fb878', 1, L);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y - 3, 4.5, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---- Shops and food ---------------------------------------------------------------------------

function restaurant(ctx, x, y, s, L, ghost) {
  const light = lightOf(this, x, y, s, ghost, L, 'shop');
  const b = { x0: x + 0.14, x1: x + 0.86, y0: y + 0.2, y1: y + 0.66 };
  const h = 13;
  this.drawBox(ctx, L, b.x0, b.y0, b.x1, b.y1, 0, h, '#fbe3cf', false);
  this.drawWindow(ctx, L, this.faceQuad('L', b.x0, b.y0, b.x1, b.y1, 0.08, 0.5, 2.5, 8.5), 0.92, light.lit(0));
  doorL(this, ctx, L, b, 0.58, 0.72, 8, '#7a4b2e');
  this.drawWindow(ctx, L, this.faceQuad('L', b.x0, b.y0, b.x1, b.y1, 0.78, 0.92, 2.5, 8.5), 0.92, light.lit(1));
  windowRow(this, ctx, L, 'R', b, 2, 3, 8, light, 3, 0.15, 0.85);
  awning(ctx, L, b, 10.5, 0.1, '#c8483f', '#f8f1e4', 6, 0.04, 0.96);
  this.gableRoof(ctx, L, b.x0, b.y0, b.x1, b.y1, h, 7, '#a95a45', '#fbe3cf');
  chimney(this, ctx, L, b.x1 - 0.2, b.y0 + 0.06, 9, h - 1);
  if (light.fill > 0 && !ghost) smoke(this, ctx, L, b.x1 - 0.16, b.y0 + 0.1, h + 9, 21, 0.8);
  // Tables out front, with little round tops.
  for (const [tx, ty] of [[0.28, 0.8], [0.52, 0.84], [0.76, 0.8]]) {
    const p = gridToWorld(x + tx, y + ty, 3);
    ctx.fillStyle = lit('#fff7ea', 1, L);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 4, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = lit('#8a6a52', 1, L);
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x, p.y + 3);
    ctx.stroke();
  }
}

function market(ctx, x, y, s, L, ghost) {
  const light = lightOf(this, x, y, s, ghost, L, 'shop');
  const open = light.fill > 0;
  // Four posts, a striped canopy and tables of produce beneath.
  const x0 = x + 0.14;
  const x1 = x + 0.86;
  const y0 = y + 0.22;
  const y1 = y + 0.74;
  for (const [px, py] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) this.drawBox(ctx, L, px - 0.012, py - 0.012, px + 0.012, py + 0.012, 0, 12, '#c9b8a0');
  for (let k = 0; k < 2; k++) {
    const ty = y0 + 0.08 + k * 0.28;
    this.drawBox(ctx, L, x0 + 0.06, ty, x1 - 0.06, ty + 0.14, 0, 4, '#b68a5c');
    const cols = ['#e5534b', '#f4b942', '#7fb85c', '#e98a3c', '#f2e8d0'];
    for (let i = 0; i < 9; i++) {
      const p = gridToWorld(x0 + 0.1 + ((x1 - x0 - 0.2) * i) / 8, ty + 0.07, 4.8);
      ctx.fillStyle = lit(cols[(i + k * 2) % cols.length], 1, L);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const n = 8;
  for (let k = 0; k < n; k++) {
    const xa = x0 - 0.04 + ((x1 - x0 + 0.08) * k) / n;
    const xb = x0 - 0.04 + ((x1 - x0 + 0.08) * (k + 1)) / n;
    const a = open ? '#e5534b' : '#d6a29c';
    fillPoly(ctx, L, [[xa, y0 - 0.04, 12], [xb, y0 - 0.04, 12], [xb, y1 + 0.06, 9.5], [xa, y1 + 0.06, 9.5]], k % 2 ? '#f8f1e4' : a, 1.02);
  }
}

// ---- Work ---------------------------------------------------------------------------------------

function bank(ctx, x, y, s, L, ghost) {
  const light = lightOf(this, x, y, s, ghost, L, 'shop');
  const b = { x0: x + 0.14, x1: x + 0.86, y0: y + 0.18, y1: y + 0.68 };
  const h = 22;
  this.drawBox(ctx, L, b.x0, b.y0, b.x1, b.y1, 0, h, '#ece6da');
  this.drawBox(ctx, L, b.x0 - 0.02, b.y0 - 0.02, b.x1 + 0.02, b.y1 + 0.02, h, 2.5, '#b9a98c');
  windowRow(this, ctx, L, 'R', b, 4, 6, 17, light, 4, 0.1, 0.9, 0.45);
  // A columned portico with a pediment, and a gold plaque.
  const px0 = b.x0 + 0.1;
  const px1 = b.x1 - 0.1;
  const py = b.y1 + 0.1;
  this.drawBox(ctx, L, px0 - 0.03, b.y1, px1 + 0.03, py + 0.03, 0, 1.5, PALETTE.stone);
  for (let k = 0; k < 4; k++) {
    const cx = px0 + ((px1 - px0) * (k + 0.5)) / 4;
    this.drawBox(ctx, L, cx - 0.026, py - 0.05, cx + 0.026, py, 1.5, 15, '#fffaf2');
  }
  this.drawBox(ctx, L, px0 - 0.02, b.y1, px1 + 0.02, py + 0.01, 16.5, 2.5, '#ece6da');
  fillPoly(ctx, L, [[px0 - 0.02, py + 0.01, 19], [px1 + 0.02, py + 0.01, 19], [(px0 + px1) / 2, py + 0.01, 25]], '#d9cfba', 1);
  const g = gridToWorld((px0 + px1) / 2, py + 0.02, 21.5);
  ctx.fillStyle = lit('#e0b648', 1, L);
  ctx.beginPath();
  ctx.arc(g.x, g.y, 2, 0, Math.PI * 2);
  ctx.fill();
  doorL(this, ctx, L, b, 0.42, 0.58, 10, '#5b4a3a');
}

function hotel(ctx, x, y, s, L, ghost) {
  const light = lightOf(this, x, y, s, ghost, L, 'night');
  const b = { x0: x + 0.2, x1: x + 0.8, y0: y + 0.2, y1: y + 0.72 };
  const h = 36;
  this.drawBox(ctx, L, b.x0, b.y0, b.x1, b.y1, 0, h, '#f1e2d4');
  this.drawBox(ctx, L, b.x0 - 0.02, b.y0 - 0.02, b.x1 + 0.02, b.y1 + 0.02, h, 3, '#8f6f9e');
  for (let row = 0; row < 4; row++) {
    windowRow(this, ctx, L, 'L', b, 4, 11 + row * 6, 15 + row * 6, light, row * 4, 0.1, 0.9, 0.4);
    windowRow(this, ctx, L, 'R', b, 3, 11 + row * 6, 15 + row * 6, light, 16 + row * 3, 0.1, 0.9, 0.4);
  }
  // Ground-floor lobby with a canopy and revolving door.
  fillPoly(ctx, L, this.faceQuad('L', b.x0, b.y0, b.x1, b.y1, 0.1, 0.9, 0, 8), '#b9d4de', 0.92);
  awning(ctx, L, b, 9, 0.12, '#8f6f9e', '#d9c8e4', 8, 0.3, 0.7);
  // A rooftop sign that glows at night.
  const sg = gridToWorld((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, h + 5);
  ctx.fillStyle = lit('#f6d56a', 1, L);
  ctx.fillRect(sg.x - 8, sg.y - 3, 16, 5);
  if (L.lamps > 0.1) this.glows.push({ x: sg.x, y: sg.y, r: 14, a: 0.3 * L.lamps, rgb: '255,220,120' });
}

function warehouse(ctx, x, y, s, L, ghost) {
  const light = lightOf(this, x, y, s, ghost, L, 'shop');
  const b = { x0: x + 0.08, x1: x + 0.92, y0: y + 0.2, y1: y + 0.76 };
  const h = 12;
  this.drawBox(ctx, L, b.x0, b.y0, b.x1, b.y1, 0, h, '#cfc8dc', false);
  for (const [u0, u1] of [[0.1, 0.34], [0.4, 0.64]]) {
    fillPoly(ctx, L, this.faceQuad('L', b.x0, b.y0, b.x1, b.y1, u0, u1, 0, 9), '#8f98b0', 0.95);
    for (const v of [2.5, 5, 7.5]) fillPoly(ctx, L, this.faceQuad('L', b.x0, b.y0, b.x1, b.y1, u0, u1, v, v + 0.5), '#7a839c', 1);
  }
  windowRow(this, ctx, L, 'L', b, 2, 7, 10, light, 0, 0.72, 0.94);
  windowRow(this, ctx, L, 'R', b, 3, 6, 9, light, 3, 0.15, 0.85);
  this.gableRoof(ctx, L, b.x0, b.y0, b.x1, b.y1, h, 5, '#8c8ca0', '#cfc8dc');
  // Pallets and crates by the door.
  for (const [cx, cy, c] of [[0.76, 0.84, '#c79a63'], [0.84, 0.8, '#b88a55'], [0.68, 0.86, '#d3a870']]) this.drawBox(ctx, L, x + cx - 0.04, y + cy - 0.04, x + cx + 0.04, y + cy + 0.04, 0, 4, c);
}

function workshop(ctx, x, y, s, L, ghost) {
  const light = lightOf(this, x, y, s, ghost, L, 'shop');
  const b = { x0: x + 0.16, x1: x + 0.84, y0: y + 0.24, y1: y + 0.72 };
  const h = 10;
  this.drawBox(ctx, L, b.x0, b.y0, b.x1, b.y1, 0, h, '#e8d8c0', false);
  fillPoly(ctx, L, this.faceQuad('L', b.x0, b.y0, b.x1, b.y1, 0.1, 0.4, 0, 8), '#7a5a3c', 0.9);
  this.drawWindow(ctx, L, this.faceQuad('L', b.x0, b.y0, b.x1, b.y1, 0.5, 0.9, 3, 8), 0.92, light.lit(0));
  windowRow(this, ctx, L, 'R', b, 2, 3, 8, light, 2, 0.2, 0.8);
  // A sawtooth roof: two teeth with glass faces.
  for (let k = 0; k < 2; k++) {
    const xa = b.x0 + ((b.x1 - b.x0) * k) / 2;
    const xb = b.x0 + ((b.x1 - b.x0) * (k + 1)) / 2;
    fillPoly(ctx, L, [[xa, b.y1 + 0.02, h], [xb, b.y1 + 0.02, h + 6], [xb, b.y0 - 0.02, h + 6], [xa, b.y0 - 0.02, h]], '#a86a52', 1);
    fillPoly(ctx, L, [[xb, b.y1 + 0.02, h], [xb, b.y1 + 0.02, h + 6], [xb, b.y0 - 0.02, h + 6], [xb, b.y0 - 0.02, h]], '#a7d3e3', 0.85);
  }
  chimney(this, ctx, L, b.x1 - 0.14, b.y0 + 0.04, 8, h);
  if (light.fill > 0 && !ghost) smoke(this, ctx, L, b.x1 - 0.1, b.y0 + 0.08, h + 8, 22, 0.8, '#d8d2cc');
  // A woodpile.
  for (let i = 0; i < 4; i++) this.drawBox(ctx, L, x + 0.2 + i * 0.05, y + 0.8, x + 0.24 + i * 0.05, y + 0.9, 0, 2.5 + (i % 2), '#9a6b44');
}

function powerplant(ctx, x, y, s, L, ghost) {
  const light = lightOf(this, x, y, s, ghost, L, 'night');
  const b = { x0: x + 0.1, x1: x + 0.62, y0: y + 0.3, y1: y + 0.82 };
  const h = 17;
  // Two cooling towers behind the hall, as stacked tapering slabs.
  for (const [cx, cy] of [[0.72, 0.24], [0.84, 0.5]]) {
    for (let k = 0; k < 5; k++) {
      const r = 0.1 - Math.sin((k / 4) * Math.PI) * 0.025;
      this.drawBox(ctx, L, x + cx - r, y + cy - r, x + cx + r, y + cy + r, k * 7, 7.4, k % 2 ? '#d6d0dc' : '#cbc4d4', k === 4);
    }
    if (light.fill > 0 && !ghost) smoke(this, ctx, L, x + cx, y + cy, 38, Math.floor(cx * 10), 1.3, '#f6f3f0');
  }
  this.drawBox(ctx, L, b.x0, b.y0, b.x1, b.y1, 0, h, '#c9c3d6');
  this.drawBox(ctx, L, b.x0 - 0.02, b.y0 - 0.02, b.x1 + 0.02, b.y1 + 0.02, h, 2, '#8c8aa0');
  windowRow(this, ctx, L, 'L', b, 3, 5, 12, light, 0, 0.12, 0.88, 0.5);
  windowRow(this, ctx, L, 'R', b, 3, 5, 12, light, 3, 0.12, 0.88, 0.5);
  // A striped stack with a red band.
  this.drawBox(ctx, L, b.x0 + 0.06, b.y0 + 0.06, b.x0 + 0.16, b.y0 + 0.16, h, 16, '#e6e0ea');
  this.drawBox(ctx, L, b.x0 + 0.06, b.y0 + 0.06, b.x0 + 0.16, b.y0 + 0.16, h + 10, 3, '#e5534b');
  // A lightning bolt on the front.
  const p = gridToWorld(b.x0 + (b.x1 - b.x0) * 0.5, b.y1 + 0.01, 8);
  ctx.fillStyle = lit('#f6d04a', 1, L);
  ctx.beginPath();
  ctx.moveTo(p.x + 1, p.y - 6);
  ctx.lineTo(p.x - 3, p.y + 1);
  ctx.lineTo(p.x, p.y + 1);
  ctx.lineTo(p.x - 1, p.y + 6);
  ctx.lineTo(p.x + 3, p.y - 1);
  ctx.lineTo(p.x, p.y - 1);
  ctx.closePath();
  ctx.fill();
}

// ---- Services ---------------------------------------------------------------------------------

function kindergarten(ctx, x, y, s, L, ghost) {
  const light = lightOf(this, x, y, s, ghost, L, 'shop');
  const b = { x0: x + 0.14, x1: x + 0.86, y0: y + 0.26, y1: y + 0.7 };
  const h = 10;
  this.drawBox(ctx, L, b.x0, b.y0, b.x1, b.y1, 0, h, '#fde7a8', false);
  // Rainbow band under a flat roof, big round-ish windows, a bright door.
  const rainbow = ['#ff8f8f', '#ffc46b', '#8fd18f', '#78b8e8'];
  rainbow.forEach((c, i) => fillPoly(ctx, L, this.faceQuad('L', b.x0, b.y0, b.x1, b.y1, 0, 1, h - 1.2 - i * 0.9, h - 0.3 - i * 0.9), c, 0.95));
  windowRow(this, ctx, L, 'L', b, 3, 2.5, 7, light, 0, 0.06, 0.7, 0.3);
  doorL(this, ctx, L, b, 0.78, 0.93, 7, '#ef7d6d');
  windowRow(this, ctx, L, 'R', b, 2, 2.5, 7, light, 4, 0.2, 0.8);
  this.drawBox(ctx, L, b.x0 - 0.03, b.y0 - 0.03, b.x1 + 0.03, b.y1 + 0.03, h, 2, '#7fc4ad');
  // A little play yard: a sandpit and a ball.
  fillPoly(ctx, L, [[x + 0.2, y + 0.8, 0.5], [x + 0.46, y + 0.8, 0.5], [x + 0.46, y + 0.93, 0.5], [x + 0.2, y + 0.93, 0.5]], '#eed9a4');
  const p = gridToWorld(x + 0.7, y + 0.86, 2);
  ctx.fillStyle = lit('#ef6f6f', 1, L);
  ctx.beginPath();
  ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
  ctx.fill();
}

function museum(ctx, x, y, s, L, ghost) {
  const light = lightOf(this, x, y, s, ghost, L, 'shop');
  const b = { x0: x + 0.12, x1: x + 0.88, y0: y + 0.18, y1: y + 0.66 };
  const h = 17;
  this.drawBox(ctx, L, b.x0, b.y0, b.x1, b.y1, 0, h, '#efe6dc');
  this.drawBox(ctx, L, b.x0 - 0.02, b.y0 - 0.02, b.x1 + 0.02, b.y1 + 0.02, h, 2, '#b9a2a8');
  windowRow(this, ctx, L, 'R', b, 4, 4, 13, light, 4, 0.1, 0.9, 0.5);
  // A low dome over the middle.
  const c = gridToWorld((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, h + 2);
  ctx.fillStyle = lit('#cdb3be', 1, L);
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, 15, 11, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = lit('#e5d1d9', 1, L);
  ctx.beginPath();
  ctx.ellipse(c.x - 3, c.y - 3, 6, 4, 0, Math.PI, 0);
  ctx.fill();
  // Steps, and banners either side of the door.
  for (let i = 0; i < 3; i++) this.drawBox(ctx, L, b.x0 + 0.22 - i * 0.015, b.y1 + i * 0.03, b.x1 - 0.22 + i * 0.015, b.y1 + 0.03 + i * 0.03, 0, 2 - i * 0.6, PALETTE.stone);
  doorL(this, ctx, L, b, 0.43, 0.57, 9, '#6b4f5a');
  for (const u of [[0.22, 0.3], [0.7, 0.78]]) fillPoly(ctx, L, this.faceQuad('L', b.x0, b.y0, b.x1, b.y1, u[0], u[1], 4, 14), '#a64d5a', 0.95);
}

function pharmacy(ctx, x, y, s, L, ghost) {
  const light = lightOf(this, x, y, s, ghost, L, 'shop');
  const b = { x0: x + 0.2, x1: x + 0.8, y0: y + 0.3, y1: y + 0.7 };
  const h = 11;
  this.drawBox(ctx, L, b.x0, b.y0, b.x1, b.y1, 0, h, '#f4fbf6');
  this.drawWindow(ctx, L, this.faceQuad('L', b.x0, b.y0, b.x1, b.y1, 0.1, 0.5, 2.5, 8), 0.92, light.lit(0));
  doorL(this, ctx, L, b, 0.6, 0.78, 8, '#7fb8a0');
  windowRow(this, ctx, L, 'R', b, 2, 3, 8, light, 2, 0.2, 0.8);
  awning(ctx, L, b, 9, 0.08, '#6dbf9d', '#f4fbf6', 6, 0.04, 0.96);
  // A green cross sign on a post.
  const p = gridToWorld(b.x0 + (b.x1 - b.x0) * 0.5, b.y1 + 0.02, h + 4);
  ctx.fillStyle = lit('#4fb38a', 1, L);
  ctx.fillRect(p.x - 1.5, p.y - 5, 3, 10);
  ctx.fillRect(p.x - 5, p.y - 1.5, 10, 3);
  if (L.lamps > 0.1) this.glows.push({ x: p.x, y: p.y, r: 9, a: 0.3 * L.lamps, rgb: '120,230,170' });
}

function hospital(ctx, x, y, s, L, ghost) {
  const light = lightOf(this, x, y, s, ghost, L, 'night');
  const wall = '#f7f9f8';
  const mid = { x0: x + 0.3, x1: x + 0.7, y0: y + 0.2, y1: y + 0.7 };
  const wl = { x0: x + 0.06, x1: x + 0.3, y0: y + 0.3, y1: y + 0.7 };
  const wr = { x0: x + 0.7, x1: x + 0.94, y0: y + 0.3, y1: y + 0.7 };
  this.drawBox(ctx, L, wl.x0, wl.y0, wl.x1, wl.y1, 0, 18, wall);
  this.drawBox(ctx, L, wr.x0, wr.y0, wr.x1, wr.y1, 0, 18, wall);
  this.drawBox(ctx, L, mid.x0, mid.y0, mid.x1, mid.y1, 0, 30, wall);
  for (const [b, i] of [[wl, 0], [wr, 20]]) {
    windowRow(this, ctx, L, 'L', b, 2, 4, 9, light, i, 0.1, 0.9, 0.4);
    windowRow(this, ctx, L, 'L', b, 2, 11, 15, light, i + 2, 0.1, 0.9, 0.4);
  }
  for (let row = 0; row < 4; row++) windowRow(this, ctx, L, 'L', mid, 3, 11 + row * 4.5, 14.5 + row * 4.5, light, 8 + row * 3, 0.12, 0.88, 0.4);
  windowRow(this, ctx, L, 'R', mid, 3, 8, 12, light, 24, 0.12, 0.88, 0.4);
  fillPoly(ctx, L, this.faceQuad('L', mid.x0, mid.y0, mid.x1, mid.y1, 0.3, 0.7, 0, 8), '#a9d4cc', 0.92);
  awning(ctx, L, mid, 9, 0.1, '#e5534b', '#fbf0ee', 4, 0.25, 0.75);
  // A big red cross on the tower and a helipad on the right wing's roof.
  const p = gridToWorld((mid.x0 + mid.x1) / 2, mid.y1 + 0.005, 22);
  ctx.fillStyle = lit('#e5534b', 1, L);
  ctx.fillRect(p.x - 2, p.y - 7, 4, 14);
  ctx.fillRect(p.x - 7, p.y - 2, 14, 4);
  const hp = gridToWorld((wr.x0 + wr.x1) / 2, (wr.y0 + wr.y1) / 2, 18.5);
  ctx.fillStyle = lit('#8d98a0', 1, L);
  ctx.beginPath();
  ctx.ellipse(hp.x, hp.y, 8, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = lit('#f7f9f8', 1, L);
  ctx.font = 'bold 6px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('H', hp.x, hp.y + 2.2);
  if (L.lamps > 0.1) this.glows.push({ x: p.x, y: p.y, r: 14, a: 0.3 * L.lamps, rgb: '255,150,150' });
}

function firehut(ctx, x, y, s, L, ghost) {
  const light = lightOf(this, x, y, s, ghost, L, 'night');
  const b = { x0: x + 0.18, x1: x + 0.8, y0: y + 0.3, y1: y + 0.74 };
  const h = 11;
  this.drawBox(ctx, L, b.x0, b.y0, b.x1, b.y1, 0, h, '#f4978e', false);
  fillPoly(ctx, L, this.faceQuad('L', b.x0, b.y0, b.x1, b.y1, 0.1, 0.6, 0, 8.5), '#fff3ef', 0.92);
  for (const v of [2.5, 5, 7.5]) fillPoly(ctx, L, this.faceQuad('L', b.x0, b.y0, b.x1, b.y1, 0.1, 0.6, v, v + 0.4), '#e0c8c2', 1);
  this.drawWindow(ctx, L, this.faceQuad('L', b.x0, b.y0, b.x1, b.y1, 0.7, 0.9, 3, 8), 0.92, light.lit(0));
  this.gableRoof(ctx, L, b.x0, b.y0, b.x1, b.y1, h, 5, '#8b6a62', '#f4978e');
  // A small bell tower, with a beacon.
  const tw = { x0: b.x1 - 0.18, x1: b.x1 - 0.04, y0: b.y0 + 0.02, y1: b.y0 + 0.16 };
  this.drawBox(ctx, L, tw.x0, tw.y0, tw.x1, tw.y1, 0, 22, '#f4978e', false);
  pyramid(ctx, L, tw.x0 - 0.015, tw.y0 - 0.015, tw.x1 + 0.015, tw.y1 + 0.015, 22, 30, '#8b6a62');
  const bp = gridToWorld(b.x0 + 0.1, b.y1 - 0.1, h + 3);
  ctx.fillStyle = lit('#ff6b5e', 1, L);
  ctx.beginPath();
  ctx.arc(bp.x, bp.y, 1.6, 0, Math.PI * 2);
  ctx.fill();
  if (L.lamps > 0.1) this.glows.push({ x: bp.x, y: bp.y, r: 9, a: 0.35 * L.lamps, rgb: '255,110,100' });
}

// ---- Leisure ------------------------------------------------------------------------------------

function cinema(ctx, x, y, s, L, ghost) {
  const light = lightOf(this, x, y, s, ghost, L, 'shop');
  const b = { x0: x + 0.14, x1: x + 0.86, y0: y + 0.2, y1: y + 0.68 };
  const h = 20;
  this.drawBox(ctx, L, b.x0, b.y0, b.x1, b.y1, 0, h, '#4a4260');
  this.drawBox(ctx, L, b.x0 - 0.02, b.y0 - 0.02, b.x1 + 0.02, b.y1 + 0.02, h, 2, '#8f6f9e');
  // Poster frames and a marquee over the doors that lights up in the evening.
  for (const u of [[0.08, 0.26], [0.74, 0.92]]) {
    fillPoly(ctx, L, this.faceQuad('L', b.x0, b.y0, b.x1, b.y1, u[0], u[1], 4, 15), '#f0d27c', 0.95);
    fillPoly(ctx, L, this.faceQuad('L', b.x0, b.y0, b.x1, b.y1, u[0] + 0.02, u[1] - 0.02, 6, 13), '#d96a7a', 0.95);
  }
  fillPoly(ctx, L, this.faceQuad('L', b.x0, b.y0, b.x1, b.y1, 0.34, 0.66, 0, 8), '#241f33', 0.92);
  const on = !ghost && light.fill > 0 && this.shopOpen(L) && L.windowLit > 0.05;
  const mq = [[b.x0 + (b.x1 - b.x0) * 0.3, b.y1 + 0.1, 11], [b.x0 + (b.x1 - b.x0) * 0.7, b.y1 + 0.1, 11], [b.x0 + (b.x1 - b.x0) * 0.7, b.y1 + 0.1, 15.5], [b.x0 + (b.x1 - b.x0) * 0.3, b.y1 + 0.1, 15.5]];
  fillPoly(ctx, L, mq, on ? '#ffe28a' : '#d8cfa8', on ? 1.1 : 0.95);
  if (on) {
    const g = gridToWorld(b.x0 + (b.x1 - b.x0) * 0.5, b.y1 + 0.1, 13);
    this.glows.push({ x: g.x, y: g.y, r: 16, a: 0.4, rgb: '255,210,110' });
  }
}

function stadium(ctx, x, y, s, L, ghost) {
  const light = lightOf(this, x, y, s, ghost, L, 'shop');
  const x0 = x + 0.06;
  const x1 = x + 0.94;
  const y0 = y + 0.08;
  const y1 = y + 0.92;
  // Back and side stands first, the pitch, then the front low stand.
  this.drawBox(ctx, L, x0, y0, x1, y0 + 0.2, 0, 18, '#cdbfa8');
  this.drawBox(ctx, L, x1 - 0.2, y0 + 0.2, x1, y1, 0, 14, '#d8caB4');
  this.drawBox(ctx, L, x0, y0 + 0.2, x0 + 0.2, y1, 0, 14, '#d8cab4');
  fillPoly(ctx, L, [[x0 + 0.2, y0 + 0.2, 0.6], [x1 - 0.2, y0 + 0.2, 0.6], [x1 - 0.2, y1 - 0.18, 0.6], [x0 + 0.2, y1 - 0.18, 0.6]], '#7fc47a');
  for (let k = 0; k < 5; k++) fillPoly(ctx, L, [[x0 + 0.2 + k * 0.1, y0 + 0.2, 0.7], [x0 + 0.25 + k * 0.1, y0 + 0.2, 0.7], [x0 + 0.25 + k * 0.1, y1 - 0.18, 0.7], [x0 + 0.2 + k * 0.1, y1 - 0.18, 0.7]], '#6fb56c', 1);
  this.drawBox(ctx, L, x0, y1 - 0.18, x1, y1, 0, 8, '#d8cab4');
  // Seats in team colours along the back stand, and a pennant.
  for (let k = 0; k < 12; k++) {
    const u = 0.04 + k * 0.08;
    fillPoly(ctx, L, this.faceQuad('L', x0, y1 - 0.18, x1, y1, u, u + 0.06, 2, 6), k % 3 ? '#e5534b' : '#f4f1e8', 0.95);
  }
  // Floodlight masts at the corners.
  for (const [px, py] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
    this.drawBox(ctx, L, px - 0.012, py - 0.012, px + 0.012, py + 0.012, 0, 30, '#9a96a4');
    const p = gridToWorld(px, py, 31);
    ctx.fillStyle = lit('#fff4c8', 1, L);
    ctx.fillRect(p.x - 3, p.y - 2, 6, 3);
    if (!ghost && L.lamps > 0.2 && light.fill > 0) this.glows.push({ x: p.x, y: p.y, r: 14, a: 0.4 * L.lamps, rgb: '255,244,200' });
  }
}

// What walkable ones draw on the ground itself, and the props on top of it.
function fountainGround(ctx, t, L) {
  const { x, y } = t;
  fillPoly(ctx, L, [[x + 0.08, y + 0.08], [x + 0.92, y + 0.08], [x + 0.92, y + 0.92], [x + 0.08, y + 0.92]], '#e4dccb');
  for (let k = 0; k < 4; k++) {
    fillPoly(ctx, L, [[x + 0.08 + k * 0.2, y + 0.08], [x + 0.12 + k * 0.2, y + 0.08], [x + 0.12 + k * 0.2, y + 0.92], [x + 0.08 + k * 0.2, y + 0.92]], '#d6cdb9');
  }
}

function fountain(ctx, x, y, s, L, ghost) {
  if (ghost) fountainGround.call(this, ctx, { x, y }, L);
  const c = gridToWorld(x + 0.5, y + 0.5, 0);
  ctx.fillStyle = lit('#c9c2b4', 1, L);
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, 17, 8.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = lit('#8fd0e8', 1, L);
  ctx.beginPath();
  ctx.ellipse(c.x, c.y - 1, 14.5, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = lit('#cfc8ba', 1, L);
  ctx.beginPath();
  ctx.ellipse(c.x, c.y - 9, 5, 2.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(c.x - 1.5, c.y - 9, 3, 8);
  // Arcs of water, always moving a little.
  ctx.strokeStyle = litA('#bfe8f5', 1, L, 0.85);
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';
  const wob = this.reduceMotion ? 0 : Math.sin(this.time * 4 + x) * 0.8;
  for (const d of [-1, 0, 1]) {
    ctx.beginPath();
    ctx.moveTo(c.x, c.y - 12);
    ctx.quadraticCurveTo(c.x + d * 7, c.y - 20 + wob, c.x + d * 11, c.y - 4);
    ctx.stroke();
  }
}

function gardenGround(ctx, t, L) {
  const { x, y } = t;
  fillPoly(ctx, L, [[x + 0.06, y + 0.06], [x + 0.94, y + 0.06], [x + 0.94, y + 0.94], [x + 0.06, y + 0.94]], '#a98664');
  const crops = ['#7fb85c', '#e5883c', '#d8566a', '#9fcf6a'];
  for (let k = 0; k < 3; k++) {
    const by = y + 0.14 + k * 0.26;
    fillPoly(ctx, L, [[x + 0.12, by], [x + 0.88, by], [x + 0.88, by + 0.16], [x + 0.12, by + 0.16]], '#7d5f45');
    for (let i = 0; i < 8; i++) {
      const p = gridToWorld(x + 0.16 + i * 0.095, by + 0.08, 0);
      ctx.fillStyle = lit(crops[(i + k) % crops.length], 1, L);
      ctx.beginPath();
      ctx.arc(p.x, p.y - 1, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function garden(ctx, x, y, s, L, ghost) {
  if (ghost) gardenGround.call(this, ctx, { x, y }, L);
  // A little tool shed in the corner and a watering barrel.
  this.drawBox(ctx, L, x + 0.7, y + 0.76, x + 0.9, y + 0.92, 0, 7, '#c79a63', false);
  fillPoly(ctx, L, [[x + 0.68, y + 0.74, 7], [x + 0.92, y + 0.74, 7], [x + 0.92, y + 0.94, 7], [x + 0.68, y + 0.94, 7]], '#8b6a52', 1);
}

function poolGround(ctx, t, L) {
  const { x, y } = t;
  fillPoly(ctx, L, [[x + 0.06, y + 0.06], [x + 0.94, y + 0.06], [x + 0.94, y + 0.94], [x + 0.06, y + 0.94]], '#eadfc9');
  fillPoly(ctx, L, [[x + 0.14, y + 0.24], [x + 0.86, y + 0.24], [x + 0.86, y + 0.7], [x + 0.14, y + 0.7]], '#cfc8bc');
  fillPoly(ctx, L, [[x + 0.17, y + 0.27], [x + 0.83, y + 0.27], [x + 0.83, y + 0.67], [x + 0.17, y + 0.67]], '#7fd0ee');
  ctx.strokeStyle = litA('#ffffff', 1, L, 0.8);
  ctx.lineWidth = 0.8;
  for (let k = 1; k < 4; k++) {
    poly(ctx, [[x + 0.17, y + 0.27 + k * 0.1], [x + 0.83, y + 0.27 + k * 0.1]]);
    ctx.stroke();
  }
}

function pool(ctx, x, y, s, L, ghost) {
  if (ghost) poolGround.call(this, ctx, { x, y }, L);
  // A changing hut and a pair of loungers.
  this.drawBox(ctx, L, x + 0.1, y + 0.76, x + 0.34, y + 0.92, 0, 9, '#fbe3cf');
  this.drawBox(ctx, L, x + 0.08, y + 0.74, x + 0.36, y + 0.94, 9, 1.5, '#e5534b');
  for (const [lx, ly] of [[0.55, 0.8], [0.72, 0.8]]) this.drawBox(ctx, L, x + lx, y + ly, x + lx + 0.1, y + ly + 0.1, 0, 1.6, '#f8f1e4');
  const p = gridToWorld(x + 0.5, y + 0.47, 0);
  if (!this.reduceMotion) {
    ctx.strokeStyle = litA('#ffffff', 1, L, 0.55);
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 3; i++) {
      const px = p.x + Math.sin(this.time * 1.4 + i * 2 + x) * 8;
      ctx.beginPath();
      ctx.arc(px, p.y - 1 + i * 2 - 2, 1.8, 0, Math.PI);
      ctx.stroke();
    }
  }
}

function farmGround(ctx, t, L) {
  const { x, y } = t;
  fillPoly(ctx, L, [[x + 0.04, y + 0.04], [x + 0.96, y + 0.04], [x + 0.96, y + 0.96], [x + 0.04, y + 0.96]], '#c9b36a');
  // Ploughed rows of green crop across the field, a path of bare earth down the middle.
  for (let k = 0; k < 6; k++) {
    const gy = y + 0.08 + k * 0.145;
    fillPoly(ctx, L, [[x + 0.08, gy], [x + 0.6, gy], [x + 0.6, gy + 0.1], [x + 0.08, gy + 0.1]], k % 2 ? '#8fbf5f' : '#7fb255');
    fillPoly(ctx, L, [[x + 0.66, gy], [x + 0.92, gy], [x + 0.92, gy + 0.1], [x + 0.66, gy + 0.1]], k % 2 ? '#e0c25a' : '#d4b34c');
  }
}

function farm(ctx, x, y, s, L, ghost) {
  if (ghost) farmGround.call(this, ctx, { x, y }, L);
  const light = lightOf(this, x, y, s, ghost, L, 'shop');
  // A red barn with a gambrel-style roof, and a tall silo beside it.
  const b = { x0: x + 0.6, x1: x + 0.9, y0: y + 0.1, y1: y + 0.44 };
  this.drawBox(ctx, L, b.x0, b.y0, b.x1, b.y1, 0, 10, '#c4574a', false);
  fillPoly(ctx, L, this.faceQuad('L', b.x0, b.y0, b.x1, b.y1, 0.3, 0.7, 0, 8), '#f2e8d8', 0.95);
  this.drawWindow(ctx, L, this.faceQuad('R', b.x0, b.y0, b.x1, b.y1, 0.35, 0.65, 4, 8), 0.8, light.lit(0));
  this.gableRoof(ctx, L, b.x0, b.y0, b.x1, b.y1, 10, 6, '#7a5a4e', '#c4574a');
  this.drawBox(ctx, L, x + 0.5, y + 0.14, x + 0.6, y + 0.24, 0, 20, '#d9d2c4');
  const c = gridToWorld(x + 0.55, y + 0.19, 20);
  ctx.fillStyle = lit('#b9b1a2', 1, L);
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, 6.5, 3.4, 0, Math.PI, 0);
  ctx.fill();
  // A scarecrow in the crops.
  const p = gridToWorld(x + 0.3, y + 0.7, 0);
  ctx.strokeStyle = lit('#7a5a3c', 1, L);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x, p.y - 12);
  ctx.moveTo(p.x - 4, p.y - 9);
  ctx.lineTo(p.x + 4, p.y - 9);
  ctx.stroke();
  ctx.fillStyle = lit('#e8c070', 1, L);
  ctx.beginPath();
  ctx.arc(p.x, p.y - 13, 2, 0, Math.PI * 2);
  ctx.fill();
}

function mill(ctx, x, y, s, L, ghost) {
  const light = lightOf(this, x, y, s, ghost, L, 'shop');
  // A little mill house, and a tower windmill behind it whose sails turn while people work.
  const h0 = { x0: x + 0.12, x1: x + 0.5, y0: y + 0.5, y1: y + 0.86 };
  const cx = x + 0.66;
  const cy = y + 0.34;
  for (let k = 0; k < 4; k++) {
    const r = 0.2 - k * 0.015;
    this.drawBox(ctx, L, cx - r, cy - r, cx + r, cy + r, k * 7, 7.4, k % 2 ? '#e4d9c4' : '#d9cdb4', k === 3);
  }
  pyramid(ctx, L, cx - 0.15, cy - 0.15, cx + 0.15, cy + 0.15, 28, 38, '#8a6a52');
  const hub = gridToWorld(cx - 0.17, cy + 0.17, 24);
  const turning = !ghost && !this.reduceMotion && light.fill > 0;
  const a0 = turning ? this.time * 0.8 : 0.5;
  ctx.strokeStyle = lit('#7a5a3c', 1, L);
  ctx.lineWidth = 1.6;
  for (let k = 0; k < 4; k++) {
    const a = a0 + (k * Math.PI) / 2;
    const ex = hub.x + Math.cos(a) * 17;
    const ey = hub.y + Math.sin(a) * 17;
    ctx.beginPath();
    ctx.moveTo(hub.x, hub.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.fillStyle = litA('#f4ecdc', 1, L, 0.9);
    ctx.beginPath();
    ctx.moveTo(hub.x + Math.cos(a) * 5, hub.y + Math.sin(a) * 5);
    ctx.lineTo(ex, ey);
    ctx.lineTo(ex + Math.cos(a + 1.5) * 4.5, ey + Math.sin(a + 1.5) * 4.5);
    ctx.lineTo(hub.x + Math.cos(a) * 5 + Math.cos(a + 1.5) * 4.5, hub.y + Math.sin(a) * 5 + Math.sin(a + 1.5) * 4.5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = lit('#5a4231', 1, L);
  ctx.beginPath();
  ctx.arc(hub.x, hub.y, 1.8, 0, Math.PI * 2);
  ctx.fill();
  this.drawBox(ctx, L, h0.x0, h0.y0, h0.x1, h0.y1, 0, 10, '#e8d9bc', false);
  this.drawWindow(ctx, L, this.faceQuad('L', h0.x0, h0.y0, h0.x1, h0.y1, 0.1, 0.4, 3, 8), 0.92, light.lit(0));
  fillPoly(ctx, L, this.faceQuad('L', h0.x0, h0.y0, h0.x1, h0.y1, 0.55, 0.85, 0, 8), '#7a5a3c', 0.9);
  this.gableRoof(ctx, L, h0.x0, h0.y0, h0.x1, h0.y1, 10, 6, '#a86a52', '#e8d9bc');
  // Sacks of flour by the door.
  for (const [sx, sy] of [[0.58, 0.86], [0.66, 0.9]]) this.drawBox(ctx, L, x + sx - 0.03, y + sy - 0.03, x + sx + 0.03, y + sy + 0.03, 0, 4, '#f4efe2');
}

export const ART2D = {
  mill,
  farm,
  bungalow,
  rowhouse,
  villa,
  restaurant,
  market,
  bank,
  hotel,
  warehouse,
  workshop,
  powerplant,
  kindergarten,
  museum,
  pharmacy,
  hospital,
  firehut,
  fountain,
  garden,
  pool,
  cinema,
  stadium,
};

// Types that paint something on the ground tile itself (under their props).
export const GROUND2D = { farm: farmGround, fountain: fountainGround, garden: gardenGround, pool: poolGround };

// Contact-shadow footprints, as renderer.footprint returns them.
export const FOOTPRINT2D = {
  mill: { inset: 0.12, h: 34 },
  bungalow: { inset: 0.14, h: 16 },
  rowhouse: { inset: 0.12, h: 22 },
  villa: { inset: 0.18, h: 26 },
  restaurant: { inset: 0.16, h: 18 },
  bank: { inset: 0.14, h: 24 },
  hotel: { inset: 0.18, h: 38 },
  warehouse: { inset: 0.1, h: 14 },
  workshop: { inset: 0.16, h: 14 },
  powerplant: { inset: 0.1, h: 30 },
  kindergarten: { inset: 0.14, h: 12 },
  museum: { inset: 0.12, h: 20 },
  pharmacy: { inset: 0.2, h: 14 },
  hospital: { inset: 0.06, h: 30 },
  firehut: { inset: 0.16, h: 14 },
  cinema: { inset: 0.14, h: 22 },
  stadium: { inset: 0.05, h: 20 },
};
