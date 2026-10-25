// Renderer: reads the city, agents and clock and draws the isometric diorama. It never changes city state.

import { PALETTE, BUILDING_VARIANTS, STRUCTURES, SEVERITY_COLORS } from './config.js';
import { HALF_W, HALF_H, gridToWorld, worldToGrid } from './iso.js';
import { lightingAt } from './lighting.js';
import { lit, litA, rgba, mixHex } from './color.js';
import { clamp, hash2 } from './utils.js';
import { shortName, addressOf } from './streets.js';
import { rampStops, settings } from './settings.js';
import { notableType } from './notables.js';
import { crosswalkMask } from './sidewalks.js';
import { ART2D, GROUND2D, FOOTPRINT2D } from './art2d.js';

const SLAB_DEPTH = 18;
// Unlit lighting for the cached ground layer; the frame's real light is multiplied on afterwards.
const NEUTRAL_LIGHT = { ambient: [1, 1, 1], daylight: 1, windowLit: 0, lamps: 0, shadow: { alpha: 0 }, clock: 0.5 };
const GROUND_SCALES = [0.5, 0.75, 1, 1.5, 2, 3];
const MAX_GROUND_PX = 4096;
const FLOWER_COLORS = ['#fff4f7', '#ffd3df', '#fff0b3', '#e2d3f5'];

// Tile edges in N, E, S, W order (matching road mask bits). `n` points into the tile.
const EDGES = [
  { a: [0, 0], b: [1, 0], n: [0, 1] },
  { a: [1, 0], b: [1, 1], n: [-1, 0] },
  { a: [0, 1], b: [1, 1], n: [0, -1] },
  { a: [0, 0], b: [0, 1], n: [1, 0] },
];

function poly(ctx, pts) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const x = (p[0] - p[1]) * HALF_W;
    const y = (p[0] + p[1]) * HALF_H - (p[2] || 0);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

function tilePoly(ctx, x, y, inset = 0) {
  poly(ctx, [
    [x + inset, y + inset],
    [x + 1 - inset, y + inset],
    [x + 1 - inset, y + 1 - inset],
    [x + inset, y + 1 - inset],
  ]);
}

function edgeStrip(x, y, e, w0, w1) {
  return [
    [x + e.a[0] + e.n[0] * w0, y + e.a[1] + e.n[1] * w0],
    [x + e.b[0] + e.n[0] * w0, y + e.b[1] + e.n[1] * w0],
    [x + e.b[0] + e.n[0] * w1, y + e.b[1] + e.n[1] * w1],
    [x + e.a[0] + e.n[0] * w1, y + e.a[1] + e.n[1] * w1],
  ];
}

function gridEllipse(ctx, gx, gy, z, r) {
  const p = gridToWorld(gx, gy, z);
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, r * HALF_W * Math.SQRT2, r * HALF_H * Math.SQRT2, 0, 0, Math.PI * 2);
}

function convexHull(points) {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// Seasonal colours. Autumn leaves pick a warm colour per tree; winter frosts everything over.
const AUTUMN_LEAVES = [
  ['#e8935a', '#f2a66a', '#f8c28a'],
  ['#d9725a', '#e88a6c', '#f2aa8c'],
  ['#e0b04f', '#eec468', '#f6d88e'],
  ['#c98a5a', '#dca06e', '#ecbc8e'],
];
const SNOW = '#f3f6f9';

// Visible growth: houses gain a stage as they fill; towers and offices add floors as people arrive.
// Pure function of the tile, so shadows, pins and drawing all agree.
export function growthOf(t, ghost = false) {
  const s = t.structure;
  if (!s) return null;
  if (s.type === 'house') {
    if (ghost) return { stage: 1 };
    return { stage: s.residents === 0 ? 0 : s.residents < 3 ? 1 : 2 };
  }
  if (s.type === 'tower') {
    const total = s.floors || 5;
    if (ghost) return { floors: total };
    const occ = s.residents / STRUCTURES.tower.capacity;
    return { floors: Math.max(2, Math.min(total, Math.ceil(total * (0.3 + 0.7 * occ)))) };
  }
  if (s.type === 'apartments') {
    const total = s.floors || 3;
    if (ghost) return { floors: total };
    const occ = s.residents / STRUCTURES.apartments.capacity;
    return { floors: Math.max(2, Math.min(total, Math.ceil(total * (0.4 + 0.6 * occ)))) };
  }
  if (s.type === 'office') {
    const total = s.floors || 4;
    if (ghost) return { floors: total };
    const fill = (t.workersFilled || 0) / STRUCTURES.office.jobs;
    return { floors: Math.max(2, Math.min(total, Math.ceil(total * (0.35 + 0.65 * fill)))) };
  }
  return null;
}

// A soft round shadow drawn once and stamped under every building.
let contactCanvas = null;
function contactSprite() {
  if (contactCanvas) return contactCanvas;
  contactCanvas = document.createElement('canvas');
  contactCanvas.width = contactCanvas.height = 64;
  const c = contactCanvas.getContext('2d');
  const grad = c.createRadialGradient(32, 32, 9.6, 32, 32, 32);
  grad.addColorStop(0, 'rgba(52,44,96,0.26)');
  grad.addColorStop(1, 'rgba(52,44,96,0)');
  c.fillStyle = grad;
  c.fillRect(0, 0, 64, 64);
  return contactCanvas;
}

// Low → high: blush red, butter yellow, mint green.
function rampColor(v, alpha) {
  const t = Math.max(0, Math.min(1, v));
  const stops = rampStops();
  const i = t < 0.5 ? 0 : 1;
  const [a0, c0] = stops[i];
  const [a1, c1] = stops[i + 1];
  const k = (t - a0) / (a1 - a0);
  const c = c0.map((v0, j) => Math.round(v0 + (c1[j] - v0) * k));
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

export class Renderer {
  constructor(canvas, city, camera, agents) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.city = city;
    this.camera = camera;
    this.agents = agents;
    this.w = 1;
    this.h = 1;
    this.dpr = 1;
    this.time = 0;
    this.bounces = new Map();
    this.particles = [];
    this.glows = [];
    this.reduceMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.ground = { canvas: null, key: '' };
    this.growth = new Map();
    this.onGrow = null;
    this.season = 'spring';
    this.snowCover = 0;
    this.drops = [];
    this._weatherL = { key: '', L: null };
    this.confettiBits = [];
    this.thoughtRects = []; // screen-space hit boxes for the resident thought bubbles
    this.showThoughts = true;
    this.textScale = 1;
    city.on((ev) => this.onCityEvent(ev));
  }

  resize(w, h) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
  }

  // ---- Event-driven effects ------------------------------------------------

  onCityEvent(ev) {
    const key = `${ev.x},${ev.y}`;
    switch (ev.type) {
      case 'placed': {
        const t = ev.structure.type;
        const d = ev.delay || 0;
        if (t === 'road' || t === 'park') this.ring(ev.x, ev.y, '#ffffff', d);
        if (t !== 'road') this.bounces.set(key, { start: this.time, delay: d, kind: 'pop' });
        break;
      }
      case 'removed':
        this.bounces.delete(key);
        if (ev.wasWater) this.ring(ev.x, ev.y, '#ffffff', ev.delay || 0);
        else this.dust(ev.x, ev.y, ev.previous?.type === 'tower' ? 16 : 10, ev.delay || 0);
        break;
      case 'watered':
        this.bounces.delete(key);
        if (ev.previous) this.dust(ev.x, ev.y, 8, ev.delay || 0);
        this.ring(ev.x, ev.y, PALETTE.water, ev.delay || 0);
        this.ring(ev.x, ev.y, '#ffffff', (ev.delay || 0) + 0.15);
        break;
      case 'restored':
        ev.tiles.forEach((c, i) => {
          const t = this.city.getTile(c.x, c.y);
          const d = Math.min(i * 0.02, 0.6);
          if (t?.structure && t.structure.type !== 'road') this.bounces.set(`${c.x},${c.y}`, { start: this.time, delay: d, kind: 'pop' });
          else if (i < 120) this.ring(c.x, c.y, '#ffffff', d);
        });
        break;
      case 'lightning':
        this.bolt = { x: ev.x, y: ev.y, age: 0, seed: Math.random() };
        break;
      case 'disasterHit':
        this.dust(ev.x, ev.y, ev.destroyed ? 18 : 6);
        break;
      case 'movedIn':
        if (this.particles.filter((p) => p.kind === 'heart').length < 10) this.heart(ev.x, ev.y);
        break;
      case 'reset':
      case 'loaded':
        this.bounces.clear();
        this.particles.length = 0;
        if (this.reduceMotion) break;
        for (const t of this.city.tiles) {
          if (t.structure && t.structure.type !== 'road') {
            this.bounces.set(`${t.x},${t.y}`, {
              start: this.time,
              delay: (t.x + t.y) * 0.03 + hash2(t.x, t.y, 5) * 0.12,
              kind: 'pop',
            });
          }
        }
        break;
    }
  }

  // Notice when a building reaches a new stage and celebrate it with a stretch and sparkles.
  trackGrowth(t) {
    const g = growthOf(t);
    if (!g) return;
    const key = `${t.x},${t.y}`;
    const sig = `${t.structure.id}:${g.stage ?? g.floors}`;
    const prev = this.growth.get(key);
    this.growth.set(key, sig);
    if (!prev || prev.split(':')[0] !== sig.split(':')[0]) return;
    if (Number(sig.split(':')[1]) > Number(prev.split(':')[1]) && !this.bounces.has(key)) {
      this.bounces.set(key, { start: this.time, delay: 0, kind: 'grow' });
      const f = this.footprint(t);
      const top = gridToWorld(t.x + 0.5, t.y + 0.5, (f?.h || 20) + 4);
      for (let i = 0; i < 6; i++) {
        this.particles.push({ kind: 'spark', x: top.x + (Math.random() - 0.5) * 18, y: top.y + (Math.random() - 0.5) * 8, age: -i * 0.05, life: 0.8 });
      }
      this.onGrow?.(t);
    }
  }

  nudge(x, y) {
    this.bounces.set(`${x},${y}`, { start: this.time, delay: 0, kind: 'wobble' });
  }

  dust(x, y, count, delay = 0) {
    const c = gridToWorld(x + 0.5, y + 0.5);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const sp = 14 + Math.random() * 22;
      this.particles.push({
        kind: 'dust',
        x: c.x + Math.cos(a) * 6,
        y: c.y + Math.sin(a) * 3 - 4,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * 0.5 - 12,
        r: 3 + Math.random() * 3.5,
        age: -delay,
        life: 0.7 + Math.random() * 0.35,
      });
    }
  }

  ring(x, y, color, delay = 0) {
    this.particles.push({ kind: 'ring', gx: x + 0.5, gy: y + 0.5, color, age: -delay, life: 0.6 });
  }

  heart(x, y) {
    const tile = this.city.getTile(x, y);
    const h = tile?.structure ? STRUCTURES[tile.structure.type].height : 20;
    const p = gridToWorld(x + 0.5, y + 0.5, h * (tile?.structure?.type === 'tower' ? (tile.structure.floors || 5) / 5 : 1) + 6);
    this.particles.push({ kind: 'heart', x: p.x + (Math.random() - 0.5) * 8, y: p.y, age: 0, life: 1.5 });
  }

  bounceFor(x, y) {
    const key = `${x},${y}`;
    const b = this.bounces.get(key);
    if (!b) return { sx: 1, sy: 1, hidden: false };
    const t = (this.time - b.start - b.delay) / (b.kind === 'wobble' ? 0.35 : 0.6);
    if (t < 0) return { sx: 1, sy: 1, hidden: true };
    if (t >= 1) {
      this.bounces.delete(key);
      return { sx: 1, sy: 1, hidden: false };
    }
    if (b.kind === 'wobble') {
      const s = Math.sin(t * 28) * 0.06 * (1 - t);
      return { sx: 1 + s, sy: 1 - s, hidden: false };
    }
    if (b.kind === 'grow') {
      const s = Math.sin(t * Math.PI) * 0.12 * (1 - t * 0.5);
      return { sx: 1 - s * 0.4, sy: 1 + s, hidden: false };
    }
    // Squash and stretch: grow from flat, overshoot tall and thin, settle.
    const sy = 1 - Math.exp(-5 * t) * Math.cos(9 * t);
    const sx = clamp(1 + (1 - sy) * 0.5, 0.86, 1.3);
    return { sx, sy: Math.max(0.02, sy), hidden: false };
  }

  // ---- Frame ----------------------------------------------------------------

  render(dt, view) {
    this.time += dt;
    const { ctx, camera: cam, city } = this;
    const w = city.derived.weather || { rain: 0, snow: 0, fog: 0, cloud: 0, snowCover: 0, season: 'spring' };
    this.weather = w;
    this.season = w.season || 'spring';
    this.era = city.systems.era?.index ?? 3; // older towns without eras keep today's look
    this.snowCover = Math.round((w.snowCover || 0) * 10) / 10;
    const L = this.weatherLight(lightingAt(city.clock), w);
    this.L = L;
    this.glows.length = 0;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawSky(ctx, L);

    const z = cam.zoom;
    ctx.setTransform(this.dpr * z, 0, 0, this.dpr * z, this.dpr * (this.w / 2 - cam.x * z), this.dpr * (this.h / 2 - cam.y * z));
    const rect = {
      left: cam.x - this.w / 2 / z - HALF_W,
      right: cam.x + this.w / 2 / z + HALF_W,
      top: cam.y - this.h / 2 / z - HALF_H,
      bottom: cam.y + this.h / 2 / z + 110,
    };
    const tiles = this.visibleTiles(rect);

    if (this.ensureGround()) {
      this.drawSlabShadow(ctx);
      this.drawCachedGround(ctx, L);
      for (const t of tiles) if (t.terrain === 'water') this.drawWaterMotion(ctx, t, L);
    } else {
      this.drawSlab(ctx, L);
      for (const t of tiles) this.drawGround(ctx, t, L);
    }
    this.drawFlood(ctx, tiles, L);
    if (view.overlay && view.overlay !== 'none') for (const t of tiles) this.drawOverlay(ctx, t, view.overlay);
    if (view.issues?.length) this.drawIssues(ctx, view.issues);
    this.drawStreetNames(ctx, rect);
    if (view.needs?.length) this.drawNeeds(ctx, view.needs);
    if (view.reach) this.drawReach(ctx, view.reach);
    if (view.selected) this.drawSelected(ctx, view.selected);
    if (view.hover) this.drawHover(ctx, view.hover);
    if (view.plan) this.drawPlan(ctx, view.plan);
    for (const t of tiles) if (t.structure) this.drawShadow(ctx, t, L);

    // Everything with height is depth-sorted together: buildings, props, cars and people.
    const items = [];
    for (const t of tiles) {
      const s = t.structure;
      if (!s) continue;
      if (s.type === 'road') {
        const lamp = this.lampSpot(t);
        if (lamp) items.push({ d: lamp.gx + lamp.gy, kind: 'lamp', t, lamp });
      } else items.push({ d: t.x + t.y + 1, kind: s.type, t });
    }
    for (const c of this.agents.cars) {
      const pose = this.agents.carPose(c);
      items.push({ d: pose.gx + pose.gy + 0.05, kind: 'car', c, pose });
    }
    for (const w of this.agents.walkers) items.push({ d: w.gx + w.gy + 0.05, kind: 'walker', w });
    const twister = city.systems.disasters?.active;
    if (twister?.kind === 'tornado' && twister.pos) items.push({ d: twister.pos.x + twister.pos.y + 0.5, kind: 'tornado', pos: twister.pos });
    if (view.ghost) items.push({ d: view.ghost.x + view.ghost.y + 1.01, kind: 'ghost', ghost: view.ghost });
    if (view.plan && STRUCTURES[view.plan.tool] && view.plan.tool !== 'road') {
      for (const c of view.plan.tiles) {
        if (!c.valid) continue;
        const t = this.city.getTile(c.x, c.y);
        if (t.structure) continue;
        const ghost = { x: c.x, y: c.y, structure: { type: view.plan.tool, variant: 'blush', floors: 4, shape: (c.x + c.y) % 4, residents: 0 } };
        items.push({ d: c.x + c.y + 1.01, kind: 'ghost', ghost });
      }
    }
    items.sort((a, b) => a.d - b.d);
    for (const it of items) this.drawItem(ctx, it, L);
    this.drawLifePins(ctx, L);
    if (view.issues?.length) this.drawIssueMarkers(ctx, view.issues);

    this.drawParticles(ctx, dt, L);
    this.drawGlows(ctx, L);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawPrecipitation(ctx, dt, w);
    this.drawWeatherFx(ctx, dt, w);
    this.drawFog(ctx, w, L);
    this.drawVignette(ctx, L);
    this.drawThoughts(ctx);
    if (view.reach) this.drawReachLabel(ctx, view.reach);
    this.drawConfetti(ctx, dt);
  }

  worldToScreen(p) {
    const cam = this.camera;
    return { x: this.w / 2 + (p.x - cam.x) * cam.zoom, y: this.h / 2 + (p.y - cam.y) * cam.zoom };
  }

  // Up to two resident thoughts float over their homes, taking turns every few seconds.
  drawThoughts(ctx) {
    this.thoughtRects = [];
    const all = this.showThoughts ? this.city.derived.thoughts || [] : [];
    const placed = all.filter((t) => t.x != null);
    if (!placed.length) return;
    const shown = [];
    const turn = Math.max(0, Math.floor(this.time / 6));
    for (let i = 0; i < Math.min(2, placed.length); i++) shown.push(placed[(turn * 2 + i) % placed.length]);
    const phase = (this.time % 6) / 6;
    const fade = Math.min(1, phase * 8, (1 - phase) * 8);
    ctx.save();
    const k = this.textScale || 1; // larger text setting
    ctx.font = `600 ${11 * k}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textBaseline = 'middle';
    for (const th of new Set(shown)) {
      const tile = this.city.getTile(th.x, th.y);
      if (!tile) continue;
      const f = tile.structure ? this.footprint(tile) : null;
      const bob = this.reduceMotion ? 0 : Math.sin(this.time * 1.8 + th.x) * 1.5;
      const s = this.worldToScreen(gridToWorld(th.x + 0.5, th.y + 0.5, (f?.h || 8) + 8));
      const text = th.text.length > 34 ? `${th.text.slice(0, 32)}…` : th.text;
      const icon = th.kind === 'happy' ? '♥' : '!';
      const tw = ctx.measureText(text).width;
      const w = tw + 34 * k;
      const h = 24 * k;
      const x = clamp(s.x - w / 2, 6, this.w - w - 6);
      let y = clamp(s.y - h - 10 + bob, 6, this.h - h - 6);
      // Keep clear of the Life Story home tag: hop above it.
      const tag = this.homeTag;
      if (tag && x < tag.x + tag.w && x + w > tag.x && y < tag.y + tag.h && y + h > tag.y) y = Math.max(6, tag.y - h - 8);
      if (s.x < -40 || s.x > this.w + 40 || s.y < -20 || s.y > this.h + 60) continue;
      ctx.globalAlpha = fade;
      ctx.fillStyle = 'rgba(52,44,96,0.18)';
      ctx.beginPath();
      ctx.roundRect(x, y + 2, w, h, 12);
      ctx.fill();
      const sev = SEVERITY_COLORS[th.severity] || SEVERITY_COLORS.caution;
      ctx.fillStyle = 'rgba(255,255,255,0.96)';
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 12);
      ctx.fill();
      ctx.strokeStyle = sev;
      ctx.lineWidth = 2;
      ctx.stroke();
      // Tail pointing at the home.
      const tx = clamp(s.x, x + 14, x + w - 14);
      ctx.beginPath();
      ctx.moveTo(tx - 5, y + h - 1);
      ctx.lineTo(tx, y + h + 6);
      ctx.lineTo(tx + 5, y + h - 1);
      ctx.fill();
      ctx.fillStyle = sev;
      ctx.beginPath();
      ctx.arc(x + 13 * k, y + h / 2, 8 * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(icon, x + 13 * k, y + h / 2 + 0.5);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#4a4270';
      ctx.fillText(text, x + 26 * k, y + h / 2 + 0.5);
      this.thoughtRects.push({ x, y, w, h: h + 6, thought: th });
    }
    ctx.restore();
  }

  thoughtAt(sx, sy) {
    for (const r of this.thoughtRects) if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) return r.thought;
    return null;
  }

  // Rising "+3%" style labels over tiles: placement feedback.
  floatText(x, y, text, color, delay = 0, z = 26) {
    const p = gridToWorld(x + 0.5, y + 0.5, z);
    this.particles.push({ kind: 'float', x: p.x, y: p.y, text, color, age: -delay, life: 1.6 });
  }

  confetti() {
    if (this.reduceMotion) return;
    const colors = [PALETTE.peach, PALETTE.mint, PALETTE.lavender, '#ffd98f', '#9cc4ea', '#ffffff'];
    for (let i = 0; i < 90; i++) {
      this.confettiBits.push({
        x: this.w * (0.2 + Math.random() * 0.6),
        y: -10 - Math.random() * this.h * 0.3,
        vx: (Math.random() - 0.5) * 80,
        vy: 60 + Math.random() * 80,
        r: Math.random() * 6.28,
        vr: (Math.random() - 0.5) * 10,
        size: 4 + Math.random() * 4,
        color: colors[i % colors.length],
        life: 3 + Math.random(),
        age: 0,
      });
    }
  }

  drawConfetti(ctx, dt) {
    if (!this.confettiBits.length) return;
    const keep = [];
    for (const c of this.confettiBits) {
      c.age += dt;
      if (c.age >= c.life || c.y > this.h + 20) continue;
      keep.push(c);
      c.x += (c.vx + Math.sin(c.age * 3 + c.r) * 30) * dt;
      c.y += c.vy * dt;
      c.r += c.vr * dt;
      ctx.save();
      ctx.globalAlpha = Math.min(1, (c.life - c.age) * 2);
      ctx.translate(c.x, c.y);
      ctx.rotate(c.r);
      ctx.scale(1, Math.cos(c.age * 6 + c.r));
      ctx.fillStyle = c.color;
      ctx.fillRect(-c.size / 2, -c.size / 4, c.size, c.size / 2);
      ctx.restore();
    }
    this.confettiBits = keep;
  }

  // Overcast skies dim and cool the light. Cached so the colour cache survives between frames.
  weatherLight(base, w) {
    const q = (v) => Math.round(v * 20) / 20;
    const key = `${base.clock}|${q(w.cloud)}|${q(w.fog)}`;
    if (this._weatherL.key === key) return this._weatherL.L;
    const cloud = q(w.cloud);
    const dim = 1 - 0.16 * cloud;
    const grey = (hex, amt) => mixHex(hex, base.daylight > 0.4 ? '#a7afc0' : '#3c3f5c', amt);
    const L = {
      ...base,
      ambient: [base.ambient[0] * dim * 0.98, base.ambient[1] * dim, base.ambient[2] * (dim + 0.03 * cloud)],
      skyTop: grey(base.skyTop, cloud * 0.55),
      skyBottom: grey(base.skyBottom, cloud * 0.5 + q(w.fog) * 0.2),
      shadow: { ...base.shadow, alpha: base.shadow.alpha * (1 - cloud * 0.85) },
      cloud,
    };
    this._weatherL = { key, L };
    return L;
  }

  // Seasonal colour for grass, trees and water.
  grassColor(base = PALETTE.grass) {
    const tint = this.season === 'summer' ? mixHex(base, '#8fca8c', 0.35) : this.season === 'autumn' ? mixHex(base, '#c4cf8a', 0.45) : base;
    return this.snowCover ? mixHex(tint, SNOW, this.snowCover * 0.85) : tint;
  }

  treeColors(x, y, blossom) {
    if (this.snowCover >= 0.5) return { deep: '#c9d8d6', mid: '#e1eae9', light: '#ffffff' };
    if (this.season === 'autumn' && !blossom) {
      const [deep, mid, light] = AUTUMN_LEAVES[Math.floor(hash2(x | 0, y | 0, 51) * AUTUMN_LEAVES.length)];
      return { deep, mid, light };
    }
    if (blossom) {
      return this.season === 'spring' ? { deep: '#ef9fb0', mid: '#f9bfcc', light: '#ffe3ea' } : { deep: '#e9aab6', mid: PALETTE.blossom, light: PALETTE.blossomLight };
    }
    if (this.season === 'summer') return { deep: '#5fa874', mid: '#7cc28a', light: '#a4d99a' };
    return { deep: PALETTE.leafDeep, mid: PALETTE.leaf, light: PALETTE.leafLight };
  }

  roofColor(hex) {
    return this.snowCover ? mixHex(hex, SNOW, this.snowCover * 0.8) : hex;
  }

  // Rain streaks and snowflakes, drawn in screen space over the city.
  // Lightning (a flash and a bolt to the spot it hit) and the orange haze of a heatwave.
  drawWeatherFx(ctx, dt, w) {
    if ((w.heat || 0) > 0.02) {
      ctx.save();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = `rgba(255,150,60,${(0.09 * w.heat).toFixed(3)})`;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.restore();
    }
    const b = this.bolt;
    if (!b) return;
    b.age += dt;
    if (b.age > 0.9) {
      this.bolt = null;
      return;
    }
    const k = 1 - b.age / 0.9;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (!this.reduceMotion) {
      ctx.fillStyle = `rgba(235,240,255,${(0.35 * k * k).toFixed(3)})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    const end = this.worldToScreen(gridToWorld(b.x + 0.5, b.y + 0.5, 20));
    ctx.strokeStyle = `rgba(255,252,220,${k.toFixed(3)})`;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let px = end.x + (b.seed - 0.5) * 80;
    ctx.moveTo(px, -10);
    const steps = 7;
    for (let i = 1; i <= steps; i++) {
      const yy = -10 + ((end.y + 10) * i) / steps;
      px = i === steps ? end.x : px + (end.x - px) / (steps - i + 1) + (hash2(i, b.seed * 100, 3) - 0.5) * 30;
      ctx.lineTo(px, yy);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawPrecipitation(ctx, dt, w) {
    const rain = w.rain || 0;
    const snow = w.snow || 0;
    const want = Math.round(170 * rain + 140 * snow) * (this.reduceMotion ? 0.4 : 1);
    while (this.drops.length < want) this.drops.push({ x: Math.random() * this.w, y: Math.random() * this.h, s: 0.6 + Math.random() * 0.8, p: Math.random() * 6.28 });
    if (this.drops.length > want) this.drops.length = want;
    if (!want) return;
    const snowy = snow > rain;
    ctx.save();
    ctx.beginPath();
    if (snowy) ctx.fillStyle = 'rgba(255,255,255,0.85)';
    else {
      ctx.strokeStyle = 'rgba(214,226,246,0.5)';
      ctx.lineWidth = 1.1;
      ctx.lineCap = 'round';
    }
    for (const d of this.drops) {
      if (snowy) {
        d.y += (38 + 30 * d.s) * dt;
        d.x += Math.sin(this.time * 1.3 + d.p) * 14 * dt - 220 * (w.wind || 0) * dt;
      } else {
        d.y += (620 + 260 * d.s) * dt;
        d.x -= (140 + 520 * (w.wind || 0)) * dt;
      }
      if (d.y > this.h + 10) {
        d.y = -10;
        d.x = Math.random() * (this.w + 60);
      }
      if (d.x < -20) d.x += this.w + 40;
      if (snowy) {
        const r = 1 + d.s * 1.3;
        ctx.moveTo(d.x + r, d.y);
        ctx.arc(d.x, d.y, r, 0, Math.PI * 2);
      } else {
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x + (3 + 10 * (w.wind || 0)) * d.s, d.y - 13 * d.s);
      }
    }
    if (snowy) ctx.fill();
    else ctx.stroke();
    ctx.restore();
  }

  // Morning fog: a soft haze with slow drifting bands.
  drawFog(ctx, w, L) {
    const fog = w.fog || 0;
    if (fog < 0.02) return;
    const tone = L.daylight > 0.4 ? '242,242,248' : '120,124,160';
    ctx.fillStyle = `rgba(${tone},${(0.32 * fog).toFixed(3)})`;
    ctx.fillRect(0, 0, this.w, this.h);
    for (let i = 0; i < 3; i++) {
      const y = this.h * (0.3 + i * 0.22);
      const x = ((this.time * (8 + i * 4)) % (this.w + 400)) - 200;
      const g = ctx.createRadialGradient(x, y, 0, x, y, this.w * 0.45);
      g.addColorStop(0, `rgba(${tone},${(0.28 * fog).toFixed(3)})`);
      g.addColorStop(1, `rgba(${tone},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, this.w * 0.45, this.h * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Only walk the slice of the grid that can be on screen, so large maps stay cheap.
  visibleTiles(rect) {
    const city = this.city;
    const corners = [
      worldToGrid(rect.left, rect.top),
      worldToGrid(rect.right, rect.top),
      worldToGrid(rect.left, rect.bottom),
      worldToGrid(rect.right, rect.bottom),
    ];
    const gx0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.gx))));
    const gx1 = Math.min(city.width - 1, Math.ceil(Math.max(...corners.map((c) => c.gx))));
    const gy0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.gy))));
    const gy1 = Math.min(city.height - 1, Math.ceil(Math.max(...corners.map((c) => c.gy))));
    const out = [];
    for (let y = gy0; y <= gy1; y++) {
      for (let x = gx0; x <= gx1; x++) {
        const c = gridToWorld(x + 0.5, y + 0.5);
        if (c.x < rect.left || c.x > rect.right || c.y < rect.top || c.y > rect.bottom) continue;
        out.push(city.tiles[y * city.width + x]);
      }
    }
    return out;
  }

  // ---- Backdrop ---------------------------------------------------------------

  drawSky(ctx, L) {
    const g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, L.skyTop);
    g.addColorStop(1, L.skyBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);

    const starAlpha = clamp(1 - L.daylight / 0.5, 0, 1);
    if (starAlpha > 0) {
      for (let i = 0; i < 60; i++) {
        const sx = hash2(i, 1, 9) * this.w;
        const sy = hash2(i, 2, 9) * this.h * 0.6;
        const tw = 0.6 + 0.4 * Math.sin(this.time * (0.8 + hash2(i, 3, 9)) + i);
        ctx.fillStyle = `rgba(255,248,235,${(starAlpha * tw * (0.35 + hash2(i, 4, 9) * 0.6)).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(sx, sy, 0.6 + hash2(i, 5, 9) * 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const overcast = L.cloud || 0;
    const cloudAlpha = Math.min(0.85, 0.25 + 0.35 * L.daylight + overcast * 0.3);
    for (let i = 0; i < 4 + Math.round(overcast * 4); i++) {
      const speed = 6 + i * 2.5;
      const span = this.w + 360;
      const cx = ((hash2(i, 7, 3) * span + this.time * speed) % span) - 180;
      const cy = this.h * (0.07 + 0.11 * i);
      const s = 0.8 + hash2(i, 8, 3) * 0.7;
      ctx.fillStyle =
        L.daylight > 0.5
          ? overcast > 0.3
            ? `rgba(214,219,230,${cloudAlpha})`
            : `rgba(255,255,255,${cloudAlpha})`
          : `rgba(220,214,245,${cloudAlpha * 0.6})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 46 * s, 14 * s, 0, 0, Math.PI * 2);
      ctx.ellipse(cx - 22 * s, cy + 3, 26 * s, 11 * s, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + 18 * s, cy - 8 * s, 24 * s, 15 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---- Cached ground layer -------------------------------------------------------
  // Terrain, roads and lawns change only when the player edits the map, so they are drawn once
  // into an offscreen canvas at a resolution matched to the zoom. Returns false when the view is
  // zoomed in past what the cache can hold sharply; the caller then draws visible tiles live.
  ensureGround() {
    const city = this.city;
    const W = city.width;
    const H = city.height;
    const worldW = (W + H) * HALF_W;
    const worldH = (W + H) * HALF_H + SLAB_DEPTH + 4;
    const cap = Math.min(MAX_GROUND_PX / worldW, MAX_GROUND_PX / worldH);
    const want = this.camera.zoom * this.dpr;
    if (want > cap * 1.05) return false;
    const scale = Math.min(cap, GROUND_SCALES.find((s) => s >= want * 0.95) || cap);
    const key = `${city.revision}|${W}x${H}|${scale.toFixed(3)}|${this.season}|${this.snowCover}|${this.era}`;
    if (this.ground.key === key) return true;
    const g = this.ground;
    if (!g.canvas) g.canvas = document.createElement('canvas');
    g.canvas.width = Math.ceil(worldW * scale);
    g.canvas.height = Math.ceil(worldH * scale);
    g.left = -H * HALF_W;
    g.top = 0;
    g.scale = scale;
    const c = g.canvas.getContext('2d');
    c.setTransform(scale, 0, 0, scale, -g.left * scale, -g.top * scale);
    c.clearRect(g.left, g.top, worldW, worldH);
    this._caching = true;
    this.drawSlab(c, NEUTRAL_LIGHT, false);
    for (const t of city.tiles) this.drawGround(c, t, NEUTRAL_LIGHT);
    this._caching = false;
    g.key = key;
    return true;
  }

  drawCachedGround(ctx, L) {
    const g = this.ground;
    const W = this.city.width;
    const H = this.city.height;
    ctx.drawImage(g.canvas, g.left, g.top, g.canvas.width / g.scale, g.canvas.height / g.scale);
    const a = L.ambient;
    if (a[0] > 0.995 && a[1] > 0.995 && a[2] > 0.995) return;
    // Apply the frame's light to the whole board in one multiply pass.
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    const ch = (v) => Math.round(Math.min(1, v) * 255);
    ctx.fillStyle = `rgb(${ch(a[0])},${ch(a[1])},${ch(a[2])})`;
    poly(ctx, [
      [0, 0, 0],
      [W, 0, 0],
      [W, 0, -SLAB_DEPTH],
      [W, H, -SLAB_DEPTH],
      [0, H, -SLAB_DEPTH],
      [0, H, 0],
    ]);
    ctx.fill();
    ctx.restore();
  }

  // Animated parts of water that can't live in the cache.
  drawWaterMotion(ctx, t, L) {
    if (this.camera.zoom < 0.5) return;
    const { x, y } = t;
    const rain = this.weather?.rain || 0;
    if (rain > 0.2) {
      ctx.strokeStyle = `rgba(255,255,255,${(0.45 * rain).toFixed(3)})`;
      ctx.lineWidth = 0.8;
      for (let i = 0; i < 2; i++) {
        const ph = (this.time * 1.4 + hash2(x, y, 120 + i)) % 1;
        const c = gridToWorld(x + 0.2 + hash2(x, y, 130 + i) * 0.6, y + 0.2 + hash2(x, y, 140 + i) * 0.6);
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, 1 + ph * 5, 0.5 + ph * 2.5, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 2; i++) {
      const ph = this.time * (0.7 + hash2(x, y, 70 + i) * 0.6) + hash2(x, y, 80 + i) * 6.28;
      const a = (Math.sin(ph) * 0.5 + 0.5) * (L.daylight > 0.3 ? 0.6 : 0.35);
      const p = gridToWorld(x + 0.25 + hash2(x, y, 90 + i) * 0.5, y + 0.25 + hash2(x, y, 95 + i) * 0.5);
      const drift = Math.sin(ph * 0.5) * 2;
      ctx.strokeStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(p.x - 4 + drift, p.y);
      ctx.lineTo(p.x + 4 + drift, p.y);
      ctx.stroke();
    }
  }

  drawSlabShadow(ctx) {
    const W = this.city.width;
    const H = this.city.height;
    const D = SLAB_DEPTH;
    for (const [pad, a] of [
      [0.9, 0.05],
      [0.45, 0.07],
    ]) {
      ctx.fillStyle = `rgba(60,48,110,${a})`;
      poly(ctx, [
        [-pad, -pad, -D - 10],
        [W + pad, -pad, -D - 10],
        [W + pad, H + pad, -D - 10],
        [-pad, H + pad, -D - 10],
      ]);
      ctx.fill();
    }
  }

  drawSlab(ctx, L, withShadow = true) {
    const W = this.city.width;
    const H = this.city.height;
    const D = SLAB_DEPTH;
    // Soft drop shadow so the board floats like a diorama.
    if (withShadow) this.drawSlabShadow(ctx);
    const yTop = gridToWorld(W, H).y;
    const left = ctx.createLinearGradient(0, yTop - (W + H) * HALF_H * 0.5, 0, yTop + D);
    left.addColorStop(0, lit(PALETTE.earth, 0.95, L));
    left.addColorStop(1, lit(PALETTE.earthDark, 0.88, L));
    ctx.fillStyle = left;
    poly(ctx, [
      [0, H, 0],
      [W, H, 0],
      [W, H, -D],
      [0, H, -D],
    ]);
    ctx.fill();
    const right = ctx.createLinearGradient(0, yTop - (W + H) * HALF_H * 0.5, 0, yTop + D);
    right.addColorStop(0, lit(PALETTE.earth, 0.8, L));
    right.addColorStop(1, lit(PALETTE.earthDark, 0.72, L));
    ctx.fillStyle = right;
    poly(ctx, [
      [W, H, 0],
      [W, 0, 0],
      [W, 0, -D],
      [W, H, -D],
    ]);
    ctx.fill();
    // Turf lip along the top edge of the slab.
    ctx.fillStyle = lit(PALETTE.grass, 0.78, L);
    poly(ctx, [
      [0, H, 0],
      [W, H, 0],
      [W, H, -4],
      [0, H, -4],
    ]);
    ctx.fill();
    ctx.fillStyle = lit(PALETTE.grass, 0.66, L);
    poly(ctx, [
      [W, H, 0],
      [W, 0, 0],
      [W, 0, -4],
      [W, H, -4],
    ]);
    ctx.fill();
    // Fill the top under the tiles so antialiased seams show grass, not the sky.
    ctx.fillStyle = lit(this.grassColor(), 0.97, L);
    poly(ctx, [
      [0, 0],
      [W, 0],
      [W, H],
      [0, H],
    ]);
    ctx.fill();
  }

  drawVignette(ctx, L) {
    const r = Math.max(this.w, this.h);
    const g = ctx.createRadialGradient(this.w / 2, this.h / 2, r * 0.3, this.w / 2, this.h / 2, r * 0.78);
    g.addColorStop(0, 'rgba(70,58,120,0)');
    g.addColorStop(1, `rgba(70,58,120,${(0.1 + 0.12 * (1 - L.daylight)).toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  // ---- Ground layer -------------------------------------------------------------

  drawGround(ctx, t, L) {
    const { x, y } = t;
    if (t.terrain === 'water') return this.drawWater(ctx, t, L);
    const s = t.structure;
    if (s?.type === 'road') return this.drawRoad(ctx, t, L);
    ctx.fillStyle = lit(this.grassColor(), 0.97 + hash2(x, y, 1) * 0.06, L);
    tilePoly(ctx, x, y);
    ctx.fill();
    if (s?.type === 'park') this.drawParkGround(ctx, t, L);
    else if (s?.type === 'playground') this.drawPlaygroundGround(ctx, t, L);
    else if (s?.type === 'field') this.drawFieldGround(ctx, t, L);
    else if (s && GROUND2D[s.type]) GROUND2D[s.type].call(this, ctx, t, L);
    else if (!s) this.drawMeadow(ctx, t, L);
  }

  drawMeadow(ctx, t, L) {
    const { x, y } = t;
    if (this.snowCover >= 0.6) return;
    ctx.strokeStyle = lit(this.grassColor(), 0.8, L);
    ctx.lineWidth = 0.9;
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      if (hash2(x, y, 20 + i) > 0.55) continue;
      const p = gridToWorld(x + 0.15 + hash2(x, y, 30 + i) * 0.7, y + 0.15 + hash2(x, y, 40 + i) * 0.7);
      ctx.beginPath();
      ctx.moveTo(p.x - 2, p.y - 2.5);
      ctx.lineTo(p.x - 0.5, p.y);
      ctx.lineTo(p.x + 0.5, p.y - 3);
      ctx.lineTo(p.x + 1.5, p.y);
      ctx.lineTo(p.x + 3, p.y - 2);
      ctx.stroke();
    }
    const flowers = this.season === 'spring' ? 0.45 : this.season === 'summer' ? 0.3 : this.season === 'autumn' ? 0.4 : 0;
    if (hash2(x, y, 3) < flowers) {
      for (let i = 0; i < 4; i++) {
        const p = gridToWorld(x + 0.15 + hash2(x, y, 50 + i) * 0.7, y + 0.15 + hash2(x, y, 60 + i) * 0.7);
        const palette = this.season === 'autumn' ? AUTUMN_LEAVES[(i + x) % AUTUMN_LEAVES.length] : FLOWER_COLORS;
        ctx.fillStyle = lit(palette[(i + x + y) % palette.length], 1, L);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  drawWater(ctx, t, L) {
    const { x, y } = t;
    const city = this.city;
    const water = this.snowCover ? mixHex(PALETTE.water, '#cfe9f4', this.snowCover * 0.6) : PALETTE.water;
    ctx.fillStyle = lit(water, 1, L);
    tilePoly(ctx, x, y);
    ctx.fill();
    // Slightly deeper centre where the tile is surrounded by water.
    let wet = 0;
    EDGES.forEach((e, i) => {
      const n = city.getTile(x + [0, 1, 0, -1][i], y + [-1, 0, 1, 0][i]);
      if (!n || n.terrain === 'water') wet++;
    });
    if (wet >= 3) {
      ctx.fillStyle = lit(water, 0.93, L);
      gridEllipse(ctx, x + 0.5, y + 0.5, 0, 0.28);
      ctx.fill();
    }
    // Sandy bank and foam on edges that meet land.
    EDGES.forEach((e, i) => {
      const n = city.getTile(x + [0, 1, 0, -1][i], y + [-1, 0, 1, 0][i]);
      if (!n || n.terrain === 'water') return;
      ctx.fillStyle = lit(PALETTE.sand, 1, L);
      poly(ctx, edgeStrip(x, y, e, 0, 0.09));
      ctx.fill();
      ctx.fillStyle = litA('#ffffff', 1, L, 0.55);
      poly(ctx, edgeStrip(x, y, e, 0.09, this._caching ? 0.13 : 0.13 + Math.sin(this.time * 1.6 + x + y) * 0.02));
      ctx.fill();
    });
    // Shimmer.
    if (this._caching || this.camera.zoom < 0.5) return;
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 2; i++) {
      const ph = this.time * (0.7 + hash2(x, y, 70 + i) * 0.6) + hash2(x, y, 80 + i) * 6.28;
      const a = (Math.sin(ph) * 0.5 + 0.5) * (L.daylight > 0.3 ? 0.6 : 0.35);
      const p = gridToWorld(x + 0.25 + hash2(x, y, 90 + i) * 0.5, y + 0.25 + hash2(x, y, 95 + i) * 0.5);
      const drift = Math.sin(ph * 0.5) * 2;
      ctx.strokeStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(p.x - 4 + drift, p.y);
      ctx.lineTo(p.x + 4 + drift, p.y);
      ctx.stroke();
    }
  }

  drawRoad(ctx, t, L) {
    if ((this.era ?? 3) < 2) {
      this.drawOldRoad(ctx, t, L);
      if (t.structure.broken || t.structure.snowed) this.drawRoadTrouble(ctx, t, L);
      return;
    }
    this.drawModernRoad(ctx, t, L);
    if (t.structure.broken || t.structure.snowed) this.drawRoadTrouble(ctx, t, L);
  }

  drawModernRoad(ctx, t, L) {
    const { x, y, roadMask: m } = t;
    ctx.fillStyle = lit(PALETTE.road, 0.98 + hash2(x, y, 2) * 0.03, L);
    tilePoly(ctx, x, y);
    ctx.fill();
    EDGES.forEach((e, i) => {
      if (m & (1 << i)) return;
      ctx.fillStyle = lit(PALETTE.sidewalk, 1.02, L);
      poly(ctx, edgeStrip(x, y, e, 0, 0.15));
      ctx.fill();
      ctx.fillStyle = lit(PALETTE.road, 0.86, L);
      poly(ctx, edgeStrip(x, y, e, 0.15, 0.18));
      ctx.fill();
    });
    // Lane markings follow the connections.
    ctx.strokeStyle = lit(PALETTE.marking, 1, L);
    ctx.lineWidth = 1.3;
    ctx.lineCap = 'butt';
    ctx.setLineDash([3.5, 3.5]);
    const c = gridToWorld(x + 0.5, y + 0.5);
    const mids = [
      [x + 0.5, y],
      [x + 1, y + 0.5],
      [x + 0.5, y + 1],
      [x, y + 0.5],
    ];
    ctx.beginPath();
    if (m === 5 || m === 10) {
      const a = gridToWorld(...mids[m === 5 ? 0 : 3]);
      const b = gridToWorld(...mids[m === 5 ? 2 : 1]);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    } else {
      for (let i = 0; i < 4; i++) {
        if (!(m & (1 << i))) continue;
        const p = gridToWorld(...mids[i]);
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(p.x, p.y);
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
    this.drawKerbCorners(ctx, x, y, m, PALETTE.sidewalk, 0.15, L);
    // Zebra crossings where people cross (sidewalks.js decides where): across every arm of a
    // junction, and now and then along a long street.
    const zebra = crosswalkMask(this.city, x, y) & m;
    if (zebra) {
      ctx.fillStyle = litA(PALETTE.marking, 1, L, 0.9);
      EDGES.forEach((e, i) => {
        if (!(zebra & (1 << i))) return;
        for (let k = 0; k < 6; k++) {
          const u0 = 0.19 + k * 0.11;
          const u1 = u0 + 0.06;
          const at = (u, v) => [x + e.a[0] + (e.b[0] - e.a[0]) * u + e.n[0] * v, y + e.a[1] + (e.b[1] - e.a[1]) * u + e.n[1] * v];
          poly(ctx, [at(u0, 0.02), at(u1, 0.02), at(u1, 0.14), at(u0, 0.14)]);
          ctx.fill();
        }
      });
    }
  }

  // Where two arms of a junction meet, the sidewalks join in a little square at the corner.
  drawKerbCorners(ctx, x, y, m, color, w, L) {
    ctx.fillStyle = lit(color, 1.02, L);
    for (let c = 0; c < 4; c++) {
      const a = 1 << c;
      const b = 1 << ((c + 3) % 4);
      if (!(m & a) || !(m & b)) continue;
      const cx = c === 1 || c === 2 ? x + 1 - w : x;
      const cy = c >= 2 ? y + 1 - w : y;
      poly(ctx, [
        [cx, cy],
        [cx + w, cy],
        [cx + w, cy + w],
        [cx, cy + w],
      ]);
      ctx.fill();
    }
  }

  // Pioneer dirt lanes with grassy verges and wheel ruts; railway-age cobbles with kerbs.
  drawOldRoad(ctx, t, L) {
    const { x, y, roadMask: m } = t;
    const dirt = this.era === 0;
    const base = dirt ? '#dcc59e' : '#cfc5b6';
    ctx.fillStyle = lit(base, 0.97 + hash2(x, y, 2) * 0.05, L);
    tilePoly(ctx, x, y);
    ctx.fill();
    EDGES.forEach((e, i) => {
      if (m & (1 << i)) return;
      ctx.fillStyle = lit(dirt ? this.grassColor() : PALETTE.sidewalk, dirt ? 0.96 : 1.0, L);
      poly(ctx, edgeStrip(x, y, e, 0, dirt ? 0.13 : 0.12));
      ctx.fill();
    });
    this.drawKerbCorners(ctx, x, y, m, dirt ? this.grassColor() : PALETTE.sidewalk, dirt ? 0.13 : 0.12, L);
    if (dirt) {
      // Two wheel ruts along each connection.
      ctx.strokeStyle = lit('#c3a87c', 1, L);
      ctx.lineWidth = 0.9;
      const c = gridToWorld(x + 0.5, y + 0.5);
      const mids = [
        [x + 0.5, y],
        [x + 1, y + 0.5],
        [x + 0.5, y + 1],
        [x, y + 0.5],
      ];
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        if (!(m & (1 << i))) continue;
        const p = gridToWorld(...mids[i]);
        for (const off of [-2.2, 2.2]) {
          ctx.moveTo(c.x + off, c.y);
          ctx.lineTo(p.x + off, p.y);
        }
      }
      ctx.stroke();
    } else {
      // Cobblestones: a sprinkle of darker setts.
      ctx.fillStyle = lit('#b9ae9f', 1, L);
      for (let k = 0; k < 14; k++) {
        const gx = x + 0.12 + hash2(x, y, 50 + k) * 0.76;
        const gy = y + 0.12 + hash2(x, y, 80 + k) * 0.76;
        const p = gridToWorld(gx, gy);
        ctx.fillRect(p.x - 1.2, p.y - 0.5, 2.4, 1);
      }
    }
  }

  drawParkGround(ctx, t, L) {
    const { x, y } = t;
    const city = this.city;
    ctx.fillStyle = lit(this.grassColor(PALETTE.parkGrass), 1, L);
    tilePoly(ctx, x, y, 0.04);
    ctx.fill();
    // Paths run to the edge where they meet another park or a road.
    const opens = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ].map(([dx, dy]) => {
      const n = city.getTile(x + dx, y + dy);
      return !!n && (n.structure?.type === 'park' || n.structure?.type === 'road');
    });
    ctx.fillStyle = lit(PALETTE.path, 1, L);
    const w = 0.07;
    poly(ctx, [
      [x + 0.5 - w, y + (opens[0] ? 0 : 0.2)],
      [x + 0.5 + w, y + (opens[0] ? 0 : 0.2)],
      [x + 0.5 + w, y + (opens[2] ? 1 : 0.8)],
      [x + 0.5 - w, y + (opens[2] ? 1 : 0.8)],
    ]);
    ctx.fill();
    poly(ctx, [
      [x + (opens[3] ? 0 : 0.2), y + 0.5 - w],
      [x + (opens[1] ? 1 : 0.8), y + 0.5 - w],
      [x + (opens[1] ? 1 : 0.8), y + 0.5 + w],
      [x + (opens[3] ? 0 : 0.2), y + 0.5 + w],
    ]);
    ctx.fill();
    gridEllipse(ctx, x + 0.5, y + 0.5, 0, 0.2);
    ctx.fill();
    for (let i = 0; i < 6; i++) {
      const q = i % 4;
      const gx = x + (q === 0 || q === 3 ? 0.22 : 0.78) + (hash2(x, y, 100 + i) - 0.5) * 0.12;
      const gy = y + (q < 2 ? 0.22 : 0.78) + (hash2(x, y, 110 + i) - 0.5) * 0.12;
      const p = gridToWorld(gx, gy);
      ctx.fillStyle = lit(FLOWER_COLORS[(i + x) % FLOWER_COLORS.length], 1, L);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // A sandpit with a soft rubber path around it.
  drawPlaygroundGround(ctx, t, L) {
    const { x, y } = t;
    ctx.fillStyle = lit(PALETTE.blush, 0.98, L);
    tilePoly(ctx, x, y, 0.06);
    ctx.fill();
    ctx.fillStyle = lit(this.snowCover >= 0.5 ? SNOW : PALETTE.sand, 1, L);
    tilePoly(ctx, x, y, 0.14);
    ctx.fill();
    ctx.fillStyle = lit(PALETTE.sand, 0.9, L);
    for (let i = 0; i < 5; i++) {
      const p = gridToWorld(x + 0.25 + hash2(x, y, 60 + i) * 0.5, y + 0.25 + hash2(x, y, 70 + i) * 0.5);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, 1.6, 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // A mown pitch with striped grass and white lines.
  drawFieldGround(ctx, t, L) {
    const { x, y } = t;
    const grass = this.grassColor('#8fd08c');
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = lit(grass, i % 2 ? 0.9 : 1.06, L);
      poly(ctx, [
        [x + 0.06 + i * 0.22, y + 0.06],
        [x + 0.06 + (i + 1) * 0.22, y + 0.06],
        [x + 0.06 + (i + 1) * 0.22, y + 0.94],
        [x + 0.06 + i * 0.22, y + 0.94],
      ]);
      ctx.fill();
    }
    ctx.strokeStyle = litA('#ffffff', 1, L, 0.9);
    ctx.lineWidth = 1;
    tilePoly(ctx, x, y, 0.1);
    ctx.stroke();
    poly(ctx, [
      [x + 0.5, y + 0.1],
      [x + 0.5, y + 0.9],
    ]);
    ctx.stroke();
    gridEllipse(ctx, x + 0.5, y + 0.5, 0, 0.13);
    ctx.stroke();
    for (const gx of [0.1, 0.9]) {
      const d = gx < 0.5 ? 0.14 : -0.14;
      poly(ctx, [
        [x + gx, y + 0.32],
        [x + gx + d, y + 0.32],
        [x + gx + d, y + 0.68],
        [x + gx, y + 0.68],
      ]);
      ctx.stroke();
    }
  }

  // Data views tint the ground so buildings stay readable on top.
  drawOverlay(ctx, t, overlay) {
    let color = null;
    if (overlay === 'desirability') {
      if (t.terrain === 'water' || t.roadMask || t.structure?.type === 'road') return;
      color = rampColor(t.desirability, 0.62);
    } else if (overlay === 'traffic') {
      if (t.structure?.type !== 'road') {
        color = 'rgba(70,60,110,0.28)';
      } else {
        color = t.congestion < 0.02 ? 'rgba(255,255,255,0.35)' : rampColor(1 - t.congestion, 0.8);
      }
    } else if (overlay === 'services') {
      if (t.terrain === 'water') return;
      const c = t.coverage || {};
      const school = c.school || 0;
      const health = c.health || 0;
      const fun = c.fun || 0;
      const fire = c.fire || 0;
      if (school < 0.02 && health < 0.02 && fun < 0.02 && fire < 0.02) color = 'rgba(70,60,110,0.22)';
      else {
        // Schools tint lavender, clinics mint, play areas peach; together they read as a soft blend.
        // Fire cover adds a coral warmth. Strength follows service quality: a crowded building tints less.
        const r = Math.round(200 - 60 * health + 55 * fun + 40 * fire);
        const g = Math.round(180 + 40 * health - 20 * school - 30 * fire);
        const b = Math.round(200 + 40 * school - 50 * fun - 40 * fire);
        color = `rgba(${Math.min(255, r)},${Math.max(0, g)},${Math.max(0, b)},${(0.25 + 0.45 * Math.max(school, health, fun, fire)).toFixed(3)})`;
      }
    }
    if (!color) return;
    ctx.fillStyle = color;
    tilePoly(ctx, t.x, t.y);
    ctx.fill();
  }

  // Street names painted along the roads, like a map. Hidden when zoomed far out.
  drawStreetNames(ctx, rect) {
    const runs = this.city.derived.streets;
    const z = this.camera.zoom;
    if (!runs || z < 0.7) return;
    const size = clamp(10 / z, 6.5, 11) * (this.textScale || 1);
    const len = Math.hypot(HALF_W, HALF_H);
    const ux = HALF_W / len;
    const uy = HALF_H / len;
    const dark = (this.L?.daylight ?? 1) < 0.35;
    ctx.save();
    ctx.font = `800 ${size.toFixed(1)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = size * 0.32;
    ctx.strokeStyle = dark ? 'rgba(40,36,70,0.75)' : 'rgba(255,255,255,0.85)';
    ctx.fillStyle = dark ? 'rgba(255,244,214,0.92)' : 'rgba(98,88,130,0.9)';
    for (const r of runs) {
      if (r.tiles.length < 3) continue;
      const label = shortName(r.name);
      // One label per stretch of about ten tiles, centred in it.
      const every = 10;
      const count = Math.max(1, Math.round(r.tiles.length / every));
      for (let k = 0; k < count; k++) {
        const mid = r.tiles[Math.min(r.tiles.length - 1, Math.floor(((k + 0.5) * r.tiles.length) / count))];
        const p = gridToWorld(mid.x + 0.5, mid.y + 0.5);
        if (p.x < rect.left || p.x > rect.right || p.y < rect.top || p.y > rect.bottom) continue;
        ctx.save();
        ctx.translate(p.x, p.y);
        // Lay the text flat on the road: along the road, and squashed onto the ground the other way.
        if (r.dir === 'h') ctx.transform(ux, uy, -ux, uy, 0, 0);
        else ctx.transform(ux, -uy, ux, uy, 0, 0);
        ctx.strokeText(label, 0, 0);
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  // The ground under each resident thought's area, tinted red, yellow or green. The one being
  // looked at pulses and is drawn on top.
  drawIssues(ctx, issues) {
    const z = this.camera.zoom;
    const pulse = this.reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(this.time * 4);
    const ordered = [...issues].sort((a, b) => (a.focused ? 1 : 0) - (b.focused ? 1 : 0));
    for (const it of ordered) {
      const color = SEVERITY_COLORS[it.severity] || SEVERITY_COLORS.caution;
      const fade = it.focused ? 1 : 0.6;
      ctx.fillStyle = rgba(color, ((it.focused ? 0.32 + 0.22 * pulse : 0.24) * fade).toFixed(3));
      ctx.strokeStyle = rgba(color, (0.95 * fade).toFixed(3));
      ctx.lineWidth = (it.focused ? 2.2 : 1.4) / z;
      for (const c of it.tiles) {
        tilePoly(ctx, c.x, c.y, 0.04);
        ctx.fill();
        ctx.stroke();
      }
    }
    // A suggested road, drawn like a road sketched in pencil: road-coloured with a dashed edge.
    for (const it of ordered) {
      if (!it.plan?.length) continue;
      ctx.fillStyle = `rgba(214,208,196,${(it.focused ? 0.75 + 0.2 * pulse : 0.6).toFixed(3)})`;
      ctx.strokeStyle = it.focused ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1.8 / z;
      ctx.setLineDash([4 / z, 3 / z]);
      ctx.lineDashOffset = -this.time * 8;
      for (const c of it.plan) {
        tilePoly(ctx, c.x, c.y, 0.06);
        ctx.fill();
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  }

  // Buildings hide the ground, so the issue being looked at also gets a bobbing marker on each tile.
  drawIssueMarkers(ctx, issues) {
    const it = issues.find((i) => i.focused);
    if (!it) return;
    const color = SEVERITY_COLORS[it.severity] || SEVERITY_COLORS.caution;
    const z = Math.max(0.7, 1 / Math.sqrt(this.camera.zoom));
    const icon = it.severity === 'good' ? '♥' : '!';
    ctx.save();
    ctx.font = `800 ${(9 * z).toFixed(1)}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    it.tiles.slice(0, 80).forEach((c, i) => {
      const t = this.city.getTile(c.x, c.y);
      if (!t) return;
      const f = t.structure ? this.footprint(t) : null;
      const bob = this.reduceMotion ? 0 : Math.sin(this.time * 3 + i * 0.7) * 2;
      const p = gridToWorld(c.x + 0.5, c.y + 0.5, (f?.h || 4) + 12 + bob);
      const r = 6 * z;
      ctx.fillStyle = color;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5 * z;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(icon, p.x, p.y + 0.5 * z);
    });
    ctx.restore();
  }

  // Tiles a drag stroke will change: tinted where the tool can go, faint red where it can't.
  drawPlan(ctx, plan) {
    const z = this.camera.zoom;
    const destroy = plan.tool === 'bulldoze';
    const fill = destroy ? 'rgba(255,143,128,0.4)' : plan.tool === 'water' ? 'rgba(126,200,227,0.75)' : plan.tool === 'road' ? 'rgba(214,208,196,0.92)' : 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1.4 / z;
    for (const c of plan.tiles) {
      tilePoly(ctx, c.x, c.y, 0.03);
      if (c.valid) {
        ctx.fillStyle = fill;
        ctx.strokeStyle = destroy ? 'rgba(255,120,104,0.95)' : 'rgba(255,255,255,0.95)';
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(255,128,112,0.45)';
        ctx.stroke();
      }
    }
  }

  drawSelected(ctx, sel) {
    const z = this.camera.zoom;
    const pulse = 0.6 + 0.4 * Math.sin(this.time * 4);
    ctx.lineWidth = 2.2 / z;
    ctx.setLineDash([5 / z, 4 / z]);
    ctx.lineDashOffset = -this.time * 12;
    ctx.strokeStyle = `rgba(255,255,255,${pulse.toFixed(3)})`;
    tilePoly(ctx, sel.x, sel.y, -0.02);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // A building's reach (influence.js): the tiles it helps (green) or bothers (coral), a dashed ring
  // at its range, and a label with the homes it reaches. `fade` (0..1) lets a just-placed one fade out.
  drawReach(ctx, reach) {
    const z = this.camera.zoom;
    const a = reach.fade ?? 1;
    for (const e of reach.effects) {
      const rgb = e.good ? '92,191,136' : '239,100,97';
      for (const c of e.tiles) {
        ctx.fillStyle = `rgba(${rgb},${((0.18 + 0.3 * c.s) * a).toFixed(3)})`;
        tilePoly(ctx, c.x, c.y, 0.03);
        ctx.fill();
      }
      ctx.strokeStyle = `rgba(${rgb},${(0.95 * a).toFixed(3)})`;
      ctx.lineWidth = 2 / z;
      ctx.setLineDash([6 / z, 4 / z]);
      gridEllipse(ctx, reach.x + 0.5, reach.y + 0.5, 0, e.radius + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // The reach label, drawn on top of everything in screen space so buildings never hide it.
  drawReachLabel(ctx, reach) {
    const a = reach.fade ?? 1;
    if (!reach.text || a < 0.4) return;
    const k = this.textScale || 1;
    const p = this.worldToScreen(gridToWorld(reach.x + 0.5, reach.y + 0.5, 40));
    ctx.save();
    ctx.font = `800 ${12 * k}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(reach.text).width + 18 * k;
    const h = 24 * k;
    const x = clamp(p.x, w / 2 + 6, this.w - w / 2 - 6); // kept on screen near the edges
    const y = clamp(p.y - h, h / 2 + 6, this.h - h / 2 - 6);
    ctx.fillStyle = `rgba(255,255,255,${(0.94 * a).toFixed(3)})`;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, 8 * k);
    ctx.fill();
    ctx.fillStyle = `rgba(60,48,90,${a.toFixed(3)})`;
    ctx.fillText(reach.text, x, y + 0.5);
    ctx.restore();
  }

  // Homes still missing what the picked building gives: a soft pulsing marker on each.
  drawNeeds(ctx, needs) {
    const z = this.camera.zoom;
    const pulse = this.reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(this.time * 3);
    ctx.fillStyle = `rgba(242,178,48,${(0.18 + 0.14 * pulse).toFixed(3)})`;
    ctx.strokeStyle = 'rgba(232,150,20,0.9)';
    ctx.lineWidth = 1.4 / z;
    for (const c of needs) {
      tilePoly(ctx, c.x, c.y, 0.08);
      ctx.fill();
      ctx.stroke();
    }
  }

  drawHover(ctx, hover) {
    const z = this.camera.zoom;
    ctx.lineWidth = 1.6 / z;
    tilePoly(ctx, hover.x, hover.y, 0.02);
    const warn = hover.tool === 'bulldoze' || (!hover.valid && hover.tool !== 'inspect');
    ctx.fillStyle = warn ? 'rgba(255,143,128,0.22)' : 'rgba(255,255,255,0.28)';
    ctx.strokeStyle = warn ? 'rgba(255,128,112,0.95)' : 'rgba(255,255,255,0.95)';
    ctx.fill();
    ctx.stroke();
  }

  // ---- Shadows and ambient occlusion ------------------------------------------

  footprint(t) {
    const s = t.structure;
    if (s.type === 'house') return { inset: 0.2, h: growthOf(t).stage === 0 ? 22 : 27 };
    if (s.type === 'tower') return { inset: 0.16, h: 6 + growthOf(t).floors * 11 };
    if (s.type === 'tree') return { inset: 0.32, h: 24, round: true };
    if (s.type === 'shop') return { inset: 0.16, h: 22 };
    if (s.type === 'office') return { inset: 0.14, h: 8 + growthOf(t).floors * 12 };
    if (s.type === 'school') return { inset: 0.12, h: 26 };
    if (s.type === 'clinic') return { inset: 0.15, h: 24 };
    if (s.type === 'bakery') return { inset: 0.2, h: 18 };
    if (s.type === 'library') return { inset: 0.14, h: 18 };
    if (s.type === 'firestation') return { inset: 0.12, h: 20 };
    if (s.type === 'university') return { inset: 0.06, h: 26 };
    if (s.type === 'cottage') return { inset: 0.27, h: 18 };
    if (s.type === 'apartments') return { inset: 0.15, h: 8 + growthOf(t).floors * 10 };
    if (s.type === 'cafe') return { inset: 0.24, h: 14 };
    if (s.type === 'mall') return { inset: 0.06, h: 20 };
    if (s.type === 'factory') return { inset: 0.1, h: 22 };
    if (s.type === 'rubble') return { inset: 0.18, h: 6 };
    return FOOTPRINT2D[s.type] || null;
  }

  drawShadow(ctx, t, L) {
    const f = this.footprint(t);
    if (!f) return;
    const b = this.bounceFor(t.x, t.y);
    if (b.hidden) return;
    const { x, y } = t;
    const g = gridToWorld(x + 0.5, y + 0.5);
    // Contact shadow: always present, anchors the object to the ground.
    const r = (1 - f.inset * 2) * HALF_W * 1.25 * b.sx;
    ctx.drawImage(contactSprite(), g.x - r, g.y - r / 2, r * 2, r);

    const sh = L.shadow;
    if (sh.alpha < 0.01) return;
    const h = f.h * b.sy;
    ctx.fillStyle = `rgba(64,58,120,${sh.alpha.toFixed(3)})`;
    if (f.round) {
      gridEllipse(ctx, x + 0.5 + sh.dx * h * 0.75, y + 0.5 + sh.dy * h * 0.75, 0, 0.22);
      ctx.fill();
      return;
    }
    const i0 = f.inset;
    const pts = [];
    for (const [gx, gy] of [
      [x + i0, y + i0],
      [x + 1 - i0, y + i0],
      [x + 1 - i0, y + 1 - i0],
      [x + i0, y + 1 - i0],
    ]) {
      pts.push(gridToWorld(gx, gy));
      pts.push(gridToWorld(gx + sh.dx * h, gy + sh.dy * h));
    }
    const hull = convexHull(pts);
    ctx.beginPath();
    hull.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();
  }

  // ---- Depth-sorted objects -------------------------------------------------------

  drawItem(ctx, it, L) {
    if (it.kind === 'car') return this.drawCar(ctx, it.c, it.pose, L);
    if (it.kind === 'walker') return this.drawWalker(ctx, it.w, L);
    if (it.kind === 'lamp') return this.drawLamp(ctx, it.lamp, L);
    if (it.kind === 'tornado') return this.drawTornado(ctx, it.pos, L);
    if (it.kind === 'ghost') {
      ctx.save();
      ctx.globalAlpha = 0.5;
      this.drawStructure(ctx, it.ghost.x, it.ghost.y, it.ghost.structure, L, true);
      ctx.restore();
      return;
    }
    const t = it.t;
    this.trackGrowth(t);
    const b = this.bounceFor(t.x, t.y);
    if (b.hidden) return;
    const c = gridToWorld(t.x + 0.5, t.y + 0.5);
    ctx.save();
    if (b.sx !== 1 || b.sy !== 1) {
      ctx.translate(c.x, c.y);
      ctx.scale(b.sx, b.sy);
      ctx.translate(-c.x, -c.y);
    }
    this.drawStructure(ctx, t.x, t.y, t.structure, L, false);
    if ((t.structure.damage || 0) >= 0.15 && t.structure.type !== 'road') this.drawDamage(ctx, t, L);
    ctx.restore();
  }

  // ---- Extreme weather ----------------------------------------------------------------------

  // A heap of broken walls, planks and a lone chimney where a building stood.
  drawRubble(ctx, x, y, L) {
    const pile = [
      [0.22, 0.3, 0.55, 0.62, 5, '#b7aa9a'],
      [0.45, 0.4, 0.78, 0.72, 4, '#c9bcac'],
      [0.3, 0.55, 0.6, 0.8, 3.5, '#a99c8c'],
      [0.55, 0.22, 0.75, 0.42, 3, '#d3c6b4'],
    ];
    for (const [a, b, c, d, h, col] of pile) this.drawBox(ctx, L, x + a, y + b, x + c, y + d, 0, h + hash2(x, y, a * 10) * 2, col);
    ctx.strokeStyle = lit('#8a6b4e', 1, L);
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
      const p = gridToWorld(x + 0.3 + hash2(x, y, 60 + k) * 0.4, y + 0.3 + hash2(x, y, 70 + k) * 0.4, 6);
      const ang = hash2(x, y, 80 + k) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(p.x - Math.cos(ang) * 6, p.y - Math.sin(ang) * 2);
      ctx.lineTo(p.x + Math.cos(ang) * 6, p.y + Math.sin(ang) * 2);
      ctx.stroke();
    }
    this.drawBox(ctx, L, x + 0.62, y + 0.32, x + 0.7, y + 0.4, 0, 11, '#c08f7c');
  }

  // Cracks on a damaged building, a blue tarp once it is badly hit, and flames while it burns.
  drawDamage(ctx, t, L) {
    const s = t.structure;
    const f = this.footprint(t) || { inset: 0.2, h: 16 };
    const x0 = t.x + f.inset;
    const x1 = t.x + 1 - f.inset;
    const y1 = t.y + 1 - f.inset;
    const h = f.h;
    ctx.strokeStyle = litA('#4b4157', 1, L, 0.55);
    ctx.lineWidth = 0.9;
    const crack = (u, v) => {
      const a = gridToWorld(x0 + (x1 - x0) * u, y1, h * v);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.x + 2, a.y + 3);
      ctx.lineTo(a.x - 1, a.y + 6);
      ctx.lineTo(a.x + 2.5, a.y + 9);
      ctx.stroke();
    };
    crack(0.3, 0.85);
    if (s.damage >= 0.34) {
      crack(0.7, 0.6);
      // A blue tarp over the broken roof.
      const top = gridToWorld(t.x + 0.5, t.y + 0.5, h + 2);
      ctx.fillStyle = lit('#5f8fd6', 1, L);
      ctx.beginPath();
      ctx.moveTo(top.x - 9, top.y);
      ctx.lineTo(top.x, top.y - 4.5);
      ctx.lineTo(top.x + 9, top.y);
      ctx.lineTo(top.x, top.y + 4.5);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = litA('#ffffff', 1, L, 0.5);
      ctx.stroke();
    }
    const nowDay = this.city.day + this.city.clock;
    if (s.burning && s.burning > nowDay) {
      const top = gridToWorld(t.x + 0.5, t.y + 0.5, h);
      for (let k = 0; k < 3; k++) {
        const fl = 0.6 + 0.4 * Math.sin(this.time * 14 + k * 2);
        ctx.fillStyle = `rgba(255,${140 + k * 30},60,${(0.8 * fl).toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(top.x - 5 + k * 5, top.y - 4 * fl, 2.6, 6 * fl, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      this.glows.push({ x: top.x, y: top.y - 4, r: 26, a: 0.55, rgb: '255,150,70' });
      if (Math.random() < 0.3) this.particles.push({ kind: 'smoke', x: top.x, y: top.y - 8, vx: 6 + Math.random() * 8, vy: -16, r: 3, age: 0, life: 1.8 });
    }
  }

  // Washed-out roads: mud, cracks and a warning cone. Snowed-in roads: a white drift.
  drawRoadTrouble(ctx, t, L) {
    const s = t.structure;
    const { x, y } = t;
    if (s.broken) {
      ctx.fillStyle = litA('#9b7a58', 1, L, 0.85);
      poly(ctx, [
        [x + 0.2, y + 0.25],
        [x + 0.78, y + 0.2],
        [x + 0.82, y + 0.72],
        [x + 0.28, y + 0.8],
      ]);
      ctx.fill();
      ctx.fillStyle = litA('#8ec1dc', 1, L, 0.7);
      gridEllipse(ctx, x + 0.5, y + 0.5, 0, 0.18);
      ctx.fill();
      ctx.strokeStyle = litA('#5d4a3a', 1, L, 0.8);
      ctx.lineWidth = 1;
      const a = gridToWorld(x + 0.25, y + 0.3);
      const b = gridToWorld(x + 0.75, y + 0.7);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo((a.x + b.x) / 2 + 3, (a.y + b.y) / 2 - 2);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      // Orange traffic cone.
      const c = gridToWorld(x + 0.3, y + 0.62);
      ctx.fillStyle = '#f08a3c';
      ctx.beginPath();
      ctx.moveTo(c.x - 2.2, c.y);
      ctx.lineTo(c.x, c.y - 6.5);
      ctx.lineTo(c.x + 2.2, c.y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(c.x - 1.2, c.y - 3.6, 2.4, 1);
    } else if (s.snowed) {
      ctx.fillStyle = litA('#f7f9fc', 1, L, 0.92);
      tilePoly(ctx, x, y, 0.04);
      ctx.fill();
    }
  }

  // Flood water spreading over the land near rivers and lakes.
  drawFlood(ctx, tiles, L) {
    const a = this.city.systems.disasters?.active;
    if (!a?.flooded) return;
    const nowDay = this.city.day + this.city.clock;
    const f = (nowDay - a.started) / Math.max(0.01, a.ends - a.started);
    const level = clamp(Math.min(f / 0.2, (1 - f) / 0.2, 1), 0, 1);
    if (level <= 0) return;
    const set = this._floodSet && this._floodSet.src === a.flooded ? this._floodSet : (this._floodSet = { src: a.flooded, has: new Set(a.flooded) });
    const W = this.city.width;
    ctx.save();
    for (const t of tiles) {
      if (!set.has.has(t.y * W + t.x)) continue;
      ctx.fillStyle = litA(PALETTE.water, 0.95, L, (0.62 * level).toFixed(3));
      tilePoly(ctx, t.x, t.y, 0.02);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${(0.35 * level).toFixed(3)})`;
      ctx.lineWidth = 0.8;
      const r = 0.12 + ((this.time * 0.25 + hash2(t.x, t.y, 9)) % 1) * 0.25;
      gridEllipse(ctx, t.x + 0.5, t.y + 0.5, 0, r);
      ctx.stroke();
    }
    ctx.restore();
  }

  // A grey, spinning funnel with debris swirling round its base.
  drawTornado(ctx, pos, L) {
    const base = gridToWorld(pos.x, pos.y);
    const spin = this.time * 7;
    ctx.save();
    ctx.fillStyle = 'rgba(52,44,96,0.18)';
    ctx.beginPath();
    ctx.ellipse(base.x, base.y, 26, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 34; i++) {
      const k = i / 33;
      const y = base.y - k * 150;
      const rx = 5 + k * k * 44;
      const sway = Math.sin(this.time * 2 + k * 3) * k * 9;
      ctx.fillStyle = litA(mixHex('#4e4a5e', '#8f8aa3', k), 1, L, (0.7 + 0.15 * Math.sin(spin + i * 0.7)).toFixed(3));
      ctx.beginPath();
      ctx.ellipse(base.x + sway, y, rx, Math.max(4, rx * 0.42), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // The storm cloud it hangs from.
    ctx.fillStyle = litA('#6c6880', 1, L, 0.85);
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.ellipse(base.x + (i - 2) * 22 + Math.sin(this.time * 2) * 9, base.y - 156 + (i % 2) * 6, 30, 13, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = litA('#6d5a48', 1, L, 0.85);
    for (let i = 0; i < 10; i++) {
      const a = spin * 1.3 + i * 0.63;
      const r = 14 + (i % 3) * 7;
      const h = 8 + ((i * 7) % 30);
      ctx.fillRect(base.x + Math.cos(a) * r - 1, base.y - h + Math.sin(a) * r * 0.35 - 1, 2.4, 2.4);
    }
    ctx.restore();
  }

  drawStructure(ctx, x, y, s, L, ghost) {
    switch (s.type) {
      case 'house':
        return this.drawHouse(ctx, x, y, s, L, ghost);
      case 'tower':
        return this.drawTower(ctx, x, y, s, L, ghost);
      case 'shop':
        return this.drawShop(ctx, x, y, s, L, ghost);
      case 'cottage':
        return this.drawCottage(ctx, x, y, s, L, ghost);
      case 'apartments':
        return this.drawApartments(ctx, x, y, s, L, ghost);
      case 'cafe':
        return this.drawCafe(ctx, x, y, s, L, ghost);
      case 'mall':
        return this.drawMall(ctx, x, y, s, L, ghost);
      case 'factory':
        return this.drawFactory(ctx, x, y, s, L, ghost);
      case 'office':
        return this.drawOffice(ctx, x, y, s, L, ghost);
      case 'school':
        return this.drawSchool(ctx, x, y, s, L, ghost);
      case 'clinic':
        return this.drawClinic(ctx, x, y, s, L, ghost);
      case 'bakery':
        return this.drawBakery(ctx, x, y, s, L, ghost);
      case 'library':
        return this.drawLibrary(ctx, x, y, s, L, ghost);
      case 'firestation':
        return this.drawFireStation(ctx, x, y, s, L, ghost);
      case 'university':
        return this.drawUniversity(ctx, x, y, s, L, ghost);
      case 'tree':
        return this.drawTree(ctx, x + 0.5, y + 0.5, s.shape || 0, L, hash2(x, y, 12) * 6.28, 1, x, y);
      case 'rubble':
        return this.drawRubble(ctx, x, y, L);
      case 'park':
        return this.drawParkProps(ctx, x, y, L);
      case 'playground':
        if (ghost) this.drawPlaygroundGround(ctx, { x, y }, L);
        return this.drawPlayground(ctx, x, y, L);
      case 'field':
        if (ghost) this.drawFieldGround(ctx, { x, y }, L);
        return this.drawField(ctx, x, y, L);
      case 'road':
        if (ghost) {
          ctx.fillStyle = lit(PALETTE.road, 1, L);
          tilePoly(ctx, x, y, 0.04);
          ctx.fill();
        }
        return;
      default:
        // The kinds added in Phase 4 are drawn in art2d.js.
        return ART2D[s.type]?.call(this, ctx, x, y, s, L, ghost);
    }
  }

  // Building colours follow the era: weathered timber and thatch in pioneer days, brick and clay
  // tiles in the railway age, then today's pastels. Cached per variant and era.
  variantOf(s, fallback) {
    const base = BUILDING_VARIANTS[s.variant] || BUILDING_VARIANTS[fallback];
    const era = this.era ?? 3;
    if (era >= 2) return base;
    const key = `${s.variant || fallback}|${era}`;
    this._variants ||= new Map();
    let v = this._variants.get(key);
    if (!v) {
      v =
        era === 0
          ? { wall: mixHex(base.wall, '#e7d6b8', 0.55), roof: mixHex(base.roof, '#cfa45f', 0.7), trim: mixHex(base.trim, '#f4ead6', 0.5) }
          : { wall: mixHex(base.wall, '#e3a98f', 0.35), roof: mixHex(base.roof, '#b5695a', 0.55), trim: base.trim };
      this._variants.set(key, v);
    }
    return v;
  }

  // A box with soft ambient occlusion toward the ground on both visible faces.
  drawBox(ctx, L, x0, y0, x1, y1, z, h, color, top = true) {
    const ao = Math.min(h, 16);
    const face = (pts, shade, baseY) => {
      const g = ctx.createLinearGradient(0, baseY, 0, baseY - ao);
      g.addColorStop(0, lit(color, shade * 0.8, L));
      g.addColorStop(1, lit(color, shade, L));
      ctx.fillStyle = g;
      poly(ctx, pts);
      ctx.fill();
    };
    face(
      [
        [x0, y1, z],
        [x1, y1, z],
        [x1, y1, z + h],
        [x0, y1, z + h],
      ],
      0.92,
      gridToWorld((x0 + x1) / 2, y1, z).y
    );
    face(
      [
        [x1, y1, z],
        [x1, y0, z],
        [x1, y0, z + h],
        [x1, y1, z + h],
      ],
      0.78,
      gridToWorld(x1, (y0 + y1) / 2, z).y
    );
    if (top) {
      ctx.fillStyle = lit(color, 1.05, L);
      poly(ctx, [
        [x0, y0, z + h],
        [x1, y0, z + h],
        [x1, y1, z + h],
        [x0, y1, z + h],
      ]);
      ctx.fill();
    }
    // Soft highlight on the near edges, like light catching a painted model.
    ctx.strokeStyle = `rgba(255,255,255,${(0.18 + 0.22 * L.daylight).toFixed(3)})`;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    const a = gridToWorld(x0, y1, z + h);
    const b = gridToWorld(x1, y1, z + h);
    const c = gridToWorld(x1, y0, z + h);
    const d = gridToWorld(x1, y1, z);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(d.x, d.y);
    ctx.stroke();
  }

  // Quad on the left (+y) or right (+x) face of a box, in face-relative u (0..1) and height v (px).
  faceQuad(face, x0, y0, x1, y1, u0, u1, v0, v1) {
    if (face === 'L') {
      const gx = (u) => x0 + (x1 - x0) * u;
      return [
        [gx(u0), y1, v0],
        [gx(u1), y1, v0],
        [gx(u1), y1, v1],
        [gx(u0), y1, v1],
      ];
    }
    const gy = (u) => y1 - (y1 - y0) * u;
    return [
      [x1, gy(u0), v0],
      [x1, gy(u1), v0],
      [x1, gy(u1), v1],
      [x1, gy(u0), v1],
    ];
  }

  drawWindow(ctx, L, pts, shade, isLit) {
    poly(ctx, pts);
    if (isLit) {
      ctx.fillStyle = PALETTE.windowLit;
      ctx.fill();
      const p = pts[0];
      const q = pts[2];
      const c = gridToWorld((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2);
      this.glows.push({ x: c.x, y: c.y, r: 7, a: 0.22, rgb: '255,214,140' });
    } else {
      ctx.fillStyle = lit(PALETTE.glass, shade, L);
      ctx.fill();
    }
  }

  isWindowLit(x, y, i, occupancy, L) {
    if (L.windowLit < 0.02 || occupancy <= 0) return false;
    const chance = L.windowLit * clamp(0.25 + occupancy, 0, 1);
    return hash2(x * 7 + i, y * 13 + (this.city.day % 4), 11) < chance;
  }

  drawHouse(ctx, x, y, s, L, ghost) {
    const v = this.variantOf(s, 'peach');
    const t = this.city.getTile(x, y);
    const stage = ghost || !t ? 1 : growthOf(t).stage;
    // An empty lot shows a small cottage; it becomes a full house, then gains a garage.
    const inset = stage === 0 ? 0.26 : 0.2;
    const x0 = x + inset;
    const x1 = x + 1 - inset;
    const y0 = y + inset + 0.02;
    const y1 = y + 1 - inset - 0.02;
    const h = stage === 0 ? 12 : 15;
    const rh = stage === 0 ? 10 : 12;
    const o = 0.05;
    const occ = ghost ? 0 : s.residents / STRUCTURES.house.capacity;
    const roof = ['gableY', 'gableX', 'hip'][Math.floor(hash2(x, y, 41) * 3)];
    this.drawBox(ctx, L, x0, y0, x1, y1, 0, h, v.wall, false);

    ctx.fillStyle = lit(v.roof, 0.72, L);
    poly(ctx, this.faceQuad('L', x0, y0, x1, y1, 0.6, 0.8, 0, Math.min(9, h - 3)));
    ctx.fill();
    this.drawWindow(ctx, L, this.faceQuad('L', x0, y0, x1, y1, 0.16, 0.4, 5, Math.min(11, h - 3)), 0.92, this.isWindowLit(x, y, 0, occ, L));
    this.drawWindow(ctx, L, this.faceQuad('R', x0, y0, x1, y1, 0.16, 0.4, 5, Math.min(11, h - 3)), 0.8, this.isWindowLit(x, y, 1, occ, L));
    if (stage > 0) this.drawWindow(ctx, L, this.faceQuad('R', x0, y0, x1, y1, 0.6, 0.84, 5, 11), 0.8, this.isWindowLit(x, y, 2, occ, L));

    const xm = (x0 + x1) / 2;
    const ym = (y0 + y1) / 2;
    const top = h + rh;
    const roofHex = this.roofColor(v.roof);
    const fillPoly = (pts, shade, color = roofHex) => {
      ctx.fillStyle = lit(color, shade, L);
      poly(ctx, pts);
      ctx.fill();
    };
    if (roof === 'gableY') {
      // Ridge runs front to back; the gable faces the viewer's left.
      fillPoly([[x0, y1, h], [x1, y1, h], [xm, y1, top]], 0.92, v.wall);
      fillPoly([[x0 - o, y0 - o, h], [x0 - o, y1 + o, h], [xm, y1 + o, top], [xm, y0 - o, top]], 1.05);
      fillPoly([[x1 + o, y0 - o, h], [x1 + o, y1 + o, h], [xm, y1 + o, top], [xm, y0 - o, top]], 0.82);
      if (stage > 0) {
        const cx0 = xm + 0.08;
        const cx1 = xm + 0.16;
        const base = h + rh * (1 - (cx1 - xm) / (x1 + o - xm));
        this.drawBox(ctx, L, cx0, y0 + 0.06, cx1, y0 + 0.14, base - 1, 6 + rh * 0.2, v.trim);
      }
      this.roofLines(ctx, L, v, [[xm, y0 - o, top], [xm, y1 + o, top]], [[x0 - o, y1 + o, h], [xm, y1 + o, top], [x1 + o, y1 + o, h]]);
      // Bright future: solar panels on the sunny slope.
      if ((this.era ?? 3) >= 4 && !ghost && hash2(x, y, 43) > 0.3) {
        const at = (u, yy) => [x0 - o + (xm - x0 + o) * u, yy, h + rh * u];
        ctx.fillStyle = lit('#4f6fa8', 1, L);
        poly(ctx, [at(0.25, y0 + 0.06), at(0.25, y1 - 0.06), at(0.8, y1 - 0.06), at(0.8, y0 + 0.06)]);
        ctx.fill();
        ctx.strokeStyle = litA('#cfe0ff', 1, L, 0.7);
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        const a = gridToWorld(...at(0.52, y0 + 0.06));
        const b = gridToWorld(...at(0.52, y1 - 0.06));
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    } else if (roof === 'gableX') {
      // Ridge runs left to right; the gable faces the viewer's right.
      fillPoly([[x0 - o, y0 - o, h], [x1 + o, y0 - o, h], [x1 + o, ym, top], [x0 - o, ym, top]], 0.95);
      fillPoly([[x1, y0, h], [x1, y1, h], [x1, ym, top]], 0.78, v.wall);
      fillPoly([[x0 - o, y1 + o, h], [x1 + o, y1 + o, h], [x1 + o, ym, top], [x0 - o, ym, top]], 1.02);
      if (stage > 0) this.drawBox(ctx, L, x0 + 0.08, ym - 0.05, x0 + 0.16, ym + 0.05, top - 4, 6, v.trim);
      this.roofLines(ctx, L, v, [[x0 - o, ym, top], [x1 + o, ym, top]], [[x1 + o, y1 + o, h], [x1 + o, ym, top], [x1 + o, y0 - o, h]]);
    } else {
      // Hipped roof: four slopes up to a short ridge.
      const r0 = x0 + (x1 - x0) * 0.32;
      const r1 = x1 - (x1 - x0) * 0.32;
      fillPoly([[x0 - o, y0 - o, h], [x1 + o, y0 - o, h], [r1, ym, top], [r0, ym, top]], 0.95);
      fillPoly([[x0 - o, y0 - o, h], [x0 - o, y1 + o, h], [r0, ym, top]], 1.05);
      fillPoly([[x1 + o, y0 - o, h], [x1 + o, y1 + o, h], [r1, ym, top]], 0.8);
      fillPoly([[x0 - o, y1 + o, h], [x1 + o, y1 + o, h], [r1, ym, top], [r0, ym, top]], 1.0);
      this.roofLines(ctx, L, v, [[r0, ym, top], [r1, ym, top]], [[x0 - o, y1 + o, h], [r0, ym, top]], [[x1 + o, y1 + o, h], [r1, ym, top]]);
    }

    // A full house gains a little garage in front.
    if (stage === 2) {
      const g0 = x + 0.56;
      const g1 = x + 0.86;
      const gy0 = y + 0.8;
      const gy1 = y + 0.95;
      this.drawBox(ctx, L, g0, gy0, g1, gy1, 0, 8, v.wall);
      ctx.fillStyle = lit(v.trim, 0.95, L);
      poly(ctx, this.faceQuad('L', g0, gy0, g1, gy1, 0.15, 0.85, 0, 6));
      ctx.fill();
      ctx.fillStyle = lit(roofHex, 0.95, L);
      poly(ctx, [[g0 - 0.02, gy0 - 0.02, 8], [g1 + 0.02, gy0 - 0.02, 8], [g1 + 0.02, gy1 + 0.02, 8], [g0 - 0.02, gy1 + 0.02, 8]]);
      ctx.fill();
    }
  }

  roofLines(ctx, L, v, ridge, ...eaves) {
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = `rgba(255,255,255,${(0.25 + 0.25 * L.daylight).toFixed(3)})`;
    const line = (pts) => {
      ctx.beginPath();
      pts.forEach((p, i) => {
        const w = gridToWorld(p[0], p[1], p[2]);
        if (i) ctx.lineTo(w.x, w.y);
        else ctx.moveTo(w.x, w.y);
      });
      ctx.stroke();
    };
    line(ridge);
    ctx.strokeStyle = lit(v.roof, 0.66, L);
    for (const e of eaves) line(e);
  }

  drawTower(ctx, x, y, s, L, ghost) {
    const v = this.variantOf(s, 'lavender');
    const tile = this.city.getTile(x, y);
    const floors = ghost || !tile ? s.floors || 5 : growthOf(tile).floors;
    const x0 = x + 0.16;
    const x1 = x + 0.84;
    const y0 = y + 0.16;
    const y1 = y + 0.84;
    const fh = 11;
    const h = 6 + floors * fh;
    const occ = ghost ? 0 : s.residents / STRUCTURES.tower.capacity;
    this.drawBox(ctx, L, x0, y0, x1, y1, 0, h, v.wall, false);

    // Plinth band.
    ctx.fillStyle = lit(v.roof, 0.85, L);
    poly(ctx, this.faceQuad('L', x0, y0, x1, y1, 0, 1, 0, 4));
    ctx.fill();
    ctx.fillStyle = lit(v.roof, 0.72, L);
    poly(ctx, this.faceQuad('R', x0, y0, x1, y1, 0, 1, 0, 4));
    ctx.fill();

    let wi = 0;
    for (let f = 0; f < floors; f++) {
      const v0 = 8 + f * fh;
      for (const face of ['L', 'R']) {
        for (let k = 0; k < 3; k++) {
          const u0 = 0.1 + k * 0.3;
          if (f === 0 && face === 'L' && k === 1) {
            ctx.fillStyle = lit(v.roof, 0.72, L);
            poly(ctx, this.faceQuad('L', x0, y0, x1, y1, u0, u0 + 0.2, 0, 9));
            ctx.fill();
            continue;
          }
          const pts = this.faceQuad(face, x0, y0, x1, y1, u0, u0 + 0.2, v0, v0 + 6);
          this.drawWindow(ctx, L, pts, face === 'L' ? 0.92 : 0.8, this.isWindowLit(x, y, wi++, occ, L));
        }
      }
    }

    // Roof deck with a parapet rim and a small rooftop unit.
    ctx.fillStyle = lit(this.roofColor(v.trim), 1, L);
    poly(ctx, [
      [x0, y0, h],
      [x1, y0, h],
      [x1, y1, h],
      [x0, y1, h],
    ]);
    ctx.fill();
    ctx.fillStyle = lit(this.roofColor(v.wall), 0.95, L);
    poly(ctx, [
      [x0 + 0.05, y0 + 0.05, h],
      [x1 - 0.05, y0 + 0.05, h],
      [x1 - 0.05, y1 - 0.05, h],
      [x0 + 0.05, y1 - 0.05, h],
    ]);
    ctx.fill();
    this.drawRooftop(ctx, L, x, y, x0, y0, x1, y1, h, v);
    if (floors >= 6) {
      const a = gridToWorld(x1 - 0.15, y1 - 0.15, h);
      ctx.strokeStyle = lit(PALETTE.pole, 1, L);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.x, a.y - 12);
      ctx.stroke();
      ctx.fillStyle = L.daylight < 0.5 && Math.sin(this.time * 3) > 0 ? '#ff8f8f' : lit('#f3a5a5', 1, L);
      ctx.beginPath();
      ctx.arc(a.x, a.y - 12, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Rooftops vary by building: an air-con unit, a water tank, or a little roof garden.
  drawRooftop(ctx, L, x, y, x0, y0, x1, y1, h, v) {
    const kind = Math.floor(hash2(x, y, 43) * 3);
    if (kind === 0) {
      this.drawBox(ctx, L, x0 + 0.12, y0 + 0.12, x0 + 0.32, y0 + 0.3, h, 5, v.trim);
    } else if (kind === 1) {
      const cx = x0 + 0.24;
      const cy = y0 + 0.24;
      this.drawBox(ctx, L, cx - 0.08, cy - 0.08, cx + 0.08, cy + 0.08, h, 7, '#c9b49a');
      const tip = gridToWorld(cx, cy, h + 12);
      const l = gridToWorld(cx - 0.08, cy + 0.08, h + 7);
      const r = gridToWorld(cx + 0.08, cy - 0.08, h + 7);
      const b = gridToWorld(cx + 0.08, cy + 0.08, h + 7);
      ctx.fillStyle = lit('#a88c74', 1, L);
      ctx.beginPath();
      ctx.moveTo(l.x, l.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.lineTo(r.x, r.y);
      ctx.lineTo(b.x, b.y);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = lit(PALETTE.parkGrass, 0.95, L);
      poly(ctx, [[x0 + 0.1, y0 + 0.1, h], [x1 - 0.1, y0 + 0.1, h], [x1 - 0.1, y1 - 0.1, h], [x0 + 0.1, y1 - 0.1, h]]);
      ctx.fill();
      for (const [gx, gy] of [[x0 + 0.22, y0 + 0.22], [x1 - 0.2, y1 - 0.24], [x0 + 0.24, y1 - 0.2]]) {
        const p = gridToWorld(gx, gy, h);
        ctx.fillStyle = lit(PALETTE.leafDeep, 1, L);
        ctx.beginPath();
        ctx.arc(p.x + 0.5, p.y - 3, 3.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = lit(PALETTE.leaf, 1, L);
        ctx.beginPath();
        ctx.arc(p.x - 0.4, p.y - 3.8, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  workFill(x, y, s, ghost) {
    if (ghost) return 0;
    const t = this.city.getTile(x, y);
    return t ? t.workersFilled / STRUCTURES[s.type].jobs : 0;
  }

  // Shops stay lit through the evening and close late at night.
  shopOpen(L) {
    const c = L.clock;
    return c > 0.29 && c < 0.92;
  }

  drawShop(ctx, x, y, s, L, ghost) {
    const v = this.variantOf(s, 'mint');
    const x0 = x + 0.16;
    const x1 = x + 0.84;
    const y0 = y + 0.2;
    const y1 = y + 0.8;
    const h = 16;
    const fill = this.workFill(x, y, s, ghost);
    this.drawBox(ctx, L, x0, y0, x1, y1, 0, h, v.wall);
    // Shop window: warm when open after dark.
    const open = !ghost && fill > 0 && this.shopOpen(L) && L.windowLit > 0.05;
    this.drawWindow(ctx, L, this.faceQuad('L', x0, y0, x1, y1, 0.08, 0.62, 2.5, 9.5), 0.92, open);
    ctx.fillStyle = lit(v.roof, 0.72, L);
    poly(ctx, this.faceQuad('L', x0, y0, x1, y1, 0.7, 0.9, 0, 9.5));
    ctx.fill();
    this.drawWindow(ctx, L, this.faceQuad('R', x0, y0, x1, y1, 0.2, 0.8, 4, 10), 0.8, open && hash2(x, y, 31) < 0.7);
    // Striped awning over the storefront.
    const segs = 5;
    for (let i = 0; i < segs; i++) {
      const a = x0 + ((x1 - x0) * i) / segs;
      const b = x0 + ((x1 - x0) * (i + 1)) / segs;
      ctx.fillStyle = lit(i % 2 ? v.trim : v.roof, i % 2 ? 1 : 0.95, L);
      poly(ctx, [
        [a, y1, 12],
        [b, y1, 12],
        [b, y1 + 0.12, 8.5],
        [a, y1 + 0.12, 8.5],
      ]);
      ctx.fill();
    }
    // Rooftop sign.
    this.drawBox(ctx, L, x0 + 0.12, y1 - 0.1, x1 - 0.12, y1 - 0.04, h, 6, v.trim);
    ctx.fillStyle = lit(v.roof, 0.85, L);
    poly(ctx, this.faceQuad('L', x0 + 0.12, y1 - 0.1, x1 - 0.12, y1 - 0.04, 0.12, 0.88, h + 1.6, h + 4.4));
    ctx.fill();
  }

  // A little cottage: low walls, a steep roof, a chimney and a round window.
  drawCottage(ctx, x, y, s, L, ghost) {
    const v = this.variantOf(s, 'blush');
    const x0 = x + 0.27;
    const x1 = x + 0.73;
    const y0 = y + 0.29;
    const y1 = y + 0.71;
    const h = 9;
    const top = h + 11;
    const occ = ghost ? 0 : s.residents / STRUCTURES.cottage.capacity;
    this.drawBox(ctx, L, x0, y0, x1, y1, 0, h, v.wall, false);
    const xm = (x0 + x1) / 2;
    const o = 0.04;
    const roof = this.roofColor(v.roof);
    ctx.fillStyle = lit(v.wall, 0.92, L);
    poly(ctx, [[x0, y1, h], [x1, y1, h], [xm, y1, top]]);
    ctx.fill();
    ctx.fillStyle = lit(roof, 1.05, L);
    poly(ctx, [[x0 - o, y0 - o, h], [x0 - o, y1 + o, h], [xm, y1 + o, top], [xm, y0 - o, top]]);
    ctx.fill();
    ctx.fillStyle = lit(roof, 0.82, L);
    poly(ctx, [[x1 + o, y0 - o, h], [x1 + o, y1 + o, h], [xm, y1 + o, top], [xm, y0 - o, top]]);
    ctx.fill();
    // Door and a round attic window on the gable.
    ctx.fillStyle = lit(v.roof, 0.7, L);
    poly(ctx, this.faceQuad('L', x0, y0, x1, y1, 0.38, 0.62, 0, 6.5));
    ctx.fill();
    const w = gridToWorld(xm, y1, h + 4.5);
    const isLit = this.isWindowLit(x, y, 0, occ, L);
    ctx.fillStyle = isLit ? lit(PALETTE.windowLit, 1.1, NEUTRAL_LIGHT) : lit(PALETTE.glass, 0.95, L);
    ctx.beginPath();
    ctx.arc(w.x, w.y, 1.8, 0, Math.PI * 2);
    ctx.fill();
    if (isLit) this.glows.push({ x: w.x, y: w.y, r: 7, a: 0.35 * L.windowLit, rgb: '255,226,154' });
    this.drawWindow(ctx, L, this.faceQuad('R', x0, y0, x1, y1, 0.25, 0.75, 3, 7.5), 0.8, this.isWindowLit(x, y, 1, occ, L));
    this.drawBox(ctx, L, xm + 0.06, y0 + 0.06, xm + 0.13, y0 + 0.13, top - 7, 8, v.trim);
  }

  // Apartments: a mid-rise block with balconies on every floor and a railing round the roof.
  drawApartments(ctx, x, y, s, L, ghost) {
    const v = this.variantOf(s, 'mint');
    const tile = this.city.getTile(x, y);
    const floors = ghost || !tile ? s.floors || 3 : growthOf(tile).floors;
    const x0 = x + 0.15;
    const x1 = x + 0.85;
    const y0 = y + 0.15;
    const y1 = y + 0.85;
    const fh = 10;
    const h = 6 + floors * fh;
    const occ = ghost ? 0 : s.residents / STRUCTURES.apartments.capacity;
    this.drawBox(ctx, L, x0, y0, x1, y1, 0, h, v.wall);
    let wi = 0;
    for (let f = 0; f < floors; f++) {
      const v0 = 4 + f * fh;
      for (const face of ['L', 'R']) {
        for (let k = 0; k < 2; k++) {
          const u0 = 0.14 + k * 0.44;
          this.drawWindow(ctx, L, this.faceQuad(face, x0, y0, x1, y1, u0, u0 + 0.28, v0 + 1.5, v0 + 7), face === 'L' ? 0.94 : 0.82, this.isWindowLit(x, y, wi++, occ, L));
        }
      }
      // A balcony slab with a railing on the front face.
      ctx.fillStyle = lit(v.trim, 0.98, L);
      poly(ctx, [
        [x0 + 0.08, y1, v0],
        [x0 + 0.4, y1, v0],
        [x0 + 0.4, y1 + 0.07, v0],
        [x0 + 0.08, y1 + 0.07, v0],
      ]);
      ctx.fill();
      ctx.strokeStyle = lit(v.trim, 0.85, L);
      ctx.lineWidth = 0.7;
      poly(ctx, [
        [x0 + 0.08, y1 + 0.07, v0 + 2.5],
        [x0 + 0.4, y1 + 0.07, v0 + 2.5],
      ]);
      ctx.stroke();
    }
    // Roof railing.
    ctx.strokeStyle = lit(v.trim, 1, L);
    ctx.lineWidth = 0.8;
    poly(ctx, [
      [x0 + 0.02, y0 + 0.02, h + 2.5],
      [x1 - 0.02, y0 + 0.02, h + 2.5],
      [x1 - 0.02, y1 - 0.02, h + 2.5],
      [x0 + 0.02, y1 - 0.02, h + 2.5],
    ]);
    ctx.stroke();
    this.drawBox(ctx, L, x0 + 0.42, y0 + 0.1, x0 + 0.58, y0 + 0.26, h, 5, v.trim);
  }

  // A café: a small shopfront with an awning and tables with parasols on the pavement.
  drawCafe(ctx, x, y, s, L, ghost) {
    const v = this.variantOf(s, 'peach');
    const x0 = x + 0.24;
    const x1 = x + 0.78;
    const y0 = y + 0.18;
    const y1 = y + 0.6;
    const h = 13;
    const fill = this.workFill(x, y, s, ghost);
    this.drawBox(ctx, L, x0, y0, x1, y1, 0, h, v.wall);
    const open = !ghost && fill > 0 && this.shopOpen(L) && L.windowLit > 0.05;
    this.drawWindow(ctx, L, this.faceQuad('L', x0, y0, x1, y1, 0.1, 0.7, 2, 8.5), 0.92, open);
    for (let i = 0; i < 4; i++) {
      const a = x0 + ((x1 - x0) * i) / 4;
      const b = x0 + ((x1 - x0) * (i + 1)) / 4;
      ctx.fillStyle = lit(i % 2 ? '#ffffff' : v.roof, 1, L);
      poly(ctx, [[a, y1, 11], [b, y1, 11], [b, y1 + 0.1, 8], [a, y1 + 0.1, 8]]);
      ctx.fill();
    }
    // A coffee cup sign on the roof.
    const c = gridToWorld((x0 + x1) / 2, (y0 + y1) / 2, h + 5);
    ctx.fillStyle = lit('#ffffff', 1, L);
    ctx.beginPath();
    ctx.roundRect(c.x - 3, c.y - 2.5, 6, 5, 1.5);
    ctx.fill();
    ctx.strokeStyle = lit('#ffffff', 1, L);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(c.x + 3.2, c.y, 1.4, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
    ctx.fillStyle = lit(v.roof, 0.8, L);
    ctx.fillRect(c.x - 2, c.y - 1.2, 4, 1.2);
    // Two tables with parasols out front.
    for (const [gx, gy] of [
      [x + 0.36, y + 0.8],
      [x + 0.66, y + 0.82],
    ]) {
      const p = gridToWorld(gx, gy);
      ctx.fillStyle = lit('#ffffff', 0.92, L);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y - 3, 2.6, 1.3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = lit('#b0a8c4', 1, L);
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x, p.y - 9);
      ctx.stroke();
      ctx.fillStyle = lit(v.roof, 1, L);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y - 9, 4.4, 2.2, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
    }
  }

  // A mall: a wide, low block with a glass entrance, a coloured sign band and rooftop units.
  drawMall(ctx, x, y, s, L, ghost) {
    const v = this.variantOf(s, 'lavender');
    const x0 = x + 0.06;
    const x1 = x + 0.94;
    const y0 = y + 0.08;
    const y1 = y + 0.9;
    const h = 18;
    const fill = this.workFill(x, y, s, ghost);
    this.drawBox(ctx, L, x0, y0, x1, y1, 0, h, v.trim);
    const open = !ghost && fill > 0 && this.shopOpen(L) && L.windowLit > 0.05;
    // Sign band across the top of both faces.
    ctx.fillStyle = lit(v.wall, 1, L);
    poly(ctx, this.faceQuad('L', x0, y0, x1, y1, 0, 1, h - 5, h));
    ctx.fill();
    ctx.fillStyle = lit(v.wall, 0.82, L);
    poly(ctx, this.faceQuad('R', x0, y0, x1, y1, 0, 1, h - 5, h));
    ctx.fill();
    // Glass entrance and display windows.
    this.drawWindow(ctx, L, this.faceQuad('L', x0, y0, x1, y1, 0.36, 0.64, 0, 10), 0.95, open);
    this.drawWindow(ctx, L, this.faceQuad('L', x0, y0, x1, y1, 0.06, 0.3, 3, 10), 0.92, open);
    this.drawWindow(ctx, L, this.faceQuad('L', x0, y0, x1, y1, 0.7, 0.94, 3, 10), 0.92, open);
    this.drawWindow(ctx, L, this.faceQuad('R', x0, y0, x1, y1, 0.1, 0.9, 3, 10), 0.8, open && hash2(x, y, 7) < 0.8);
    // Rooftop air-conditioning units and a skylight.
    this.drawBox(ctx, L, x0 + 0.12, y0 + 0.14, x0 + 0.28, y0 + 0.3, h, 4, '#e8e4ee');
    this.drawBox(ctx, L, x1 - 0.3, y0 + 0.14, x1 - 0.14, y0 + 0.3, h, 4, '#e8e4ee');
    ctx.fillStyle = lit(PALETTE.glass, 1.05, L);
    poly(ctx, [
      [x0 + 0.3, y0 + 0.42, h + 0.2],
      [x1 - 0.3, y0 + 0.42, h + 0.2],
      [x1 - 0.3, y1 - 0.18, h + 0.2],
      [x0 + 0.3, y1 - 0.18, h + 0.2],
    ]);
    ctx.fill();
  }

  // A factory: a sawtooth roof, a tall chimney and smoke while people are at work.
  drawFactory(ctx, x, y, s, L, ghost) {
    const x0 = x + 0.1;
    const x1 = x + 0.9;
    const y0 = y + 0.14;
    const y1 = y + 0.86;
    const h = 14;
    const wall = '#d9d2e3';
    const fill = this.workFill(x, y, s, ghost);
    this.drawBox(ctx, L, x0, y0, x1, y1, 0, h, wall, false);
    // Sawtooth roof: three ridges running front to back.
    const teeth = 3;
    for (let i = 0; i < teeth; i++) {
      const a = x0 + ((x1 - x0) * i) / teeth;
      const b = x0 + ((x1 - x0) * (i + 1)) / teeth;
      ctx.fillStyle = lit('#b8aed0', 0.96, L);
      poly(ctx, [[a, y0, h], [a, y1, h], [b, y1, h + 7], [b, y0, h + 7]]);
      ctx.fill();
      ctx.fillStyle = lit(PALETTE.glass, 0.82, L);
      poly(ctx, [[b, y0, h], [b, y1, h], [b, y1, h + 7], [b, y0, h + 7]]);
      ctx.fill();
      ctx.fillStyle = lit(wall, 0.9, L);
      poly(ctx, [[a, y1, h], [b, y1, h], [b, y1, h + 7]]);
      ctx.fill();
    }
    // Loading door and windows.
    ctx.fillStyle = lit('#a99fc2', 0.85, L);
    poly(ctx, this.faceQuad('L', x0, y0, x1, y1, 0.1, 0.36, 0, 8));
    ctx.fill();
    const working = !ghost && fill > 0 && L.clock > 0.27 && L.clock < 0.78;
    this.drawWindow(ctx, L, this.faceQuad('L', x0, y0, x1, y1, 0.5, 0.9, 5, 10), 0.92, working && L.windowLit > 0.05);
    this.drawWindow(ctx, L, this.faceQuad('R', x0, y0, x1, y1, 0.15, 0.85, 5, 10), 0.8, working && L.windowLit > 0.05);
    // Chimney.
    const cx0 = x1 - 0.2;
    const cy0 = y0 + 0.06;
    this.drawBox(ctx, L, cx0, cy0, cx0 + 0.1, cy0 + 0.1, 0, 34, '#e9a89a');
    this.drawBox(ctx, L, cx0 - 0.01, cy0 - 0.01, cx0 + 0.11, cy0 + 0.11, 30, 3, '#ffffff');
    if (working && !this.reduceMotion) {
      const top = gridToWorld(cx0 + 0.05, cy0 + 0.05, 36);
      for (let i = 0; i < 4; i++) {
        const t = (this.time * 0.35 + i / 4 + hash2(x, y, 3)) % 1;
        ctx.fillStyle = litA('#f4f1f7', 1, L, (0.6 * (1 - t)).toFixed(3));
        ctx.beginPath();
        ctx.arc(top.x + t * 10 + Math.sin(t * 6) * 2, top.y - t * 22, 2.5 + t * 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  drawOffice(ctx, x, y, s, L, ghost) {
    const v = this.variantOf(s, 'lavender');
    const otile = this.city.getTile(x, y);
    const floors = ghost || !otile ? s.floors || 4 : growthOf(otile).floors;
    const x0 = x + 0.14;
    const x1 = x + 0.86;
    const y0 = y + 0.14;
    const y1 = y + 0.86;
    const fh = 12;
    const h = 8 + floors * fh;
    const fill = this.workFill(x, y, s, ghost);
    this.drawBox(ctx, L, x0, y0, x1, y1, 0, h, v.trim, false);
    // Glass ribbon windows; offices light up in the early evening while people work late.
    const evening = L.clock > 0.7 && L.clock < 0.86 ? 1 : 0.25;
    let wi = 0;
    for (let f = 0; f < floors; f++) {
      const v0 = 9 + f * fh;
      for (const face of ['L', 'R']) {
        for (let k = 0; k < 3; k++) {
          const u0 = 0.06 + k * 0.3;
          const isLit = !ghost && L.windowLit > 0.05 && hash2(x * 5 + wi, y * 11, 17) < fill * evening;
          wi++;
          this.drawWindow(ctx, L, this.faceQuad(face, x0, y0, x1, y1, u0, u0 + 0.28, v0, v0 + 7), face === 'L' ? 0.95 : 0.84, isLit);
        }
      }
    }
    // Lobby band and entrance.
    ctx.fillStyle = lit(v.wall, 0.85, L);
    poly(ctx, this.faceQuad('L', x0, y0, x1, y1, 0, 1, 0, 6));
    ctx.fill();
    ctx.fillStyle = lit(PALETTE.glass, 0.85, L);
    poly(ctx, this.faceQuad('L', x0, y0, x1, y1, 0.38, 0.62, 0, 6));
    ctx.fill();
    ctx.fillStyle = lit(v.wall, 0.7, L);
    poly(ctx, this.faceQuad('R', x0, y0, x1, y1, 0, 1, 0, 6));
    ctx.fill();
    // Roof deck in the accent colour with a small plant room.
    ctx.fillStyle = lit(v.wall, 1.02, L);
    poly(ctx, [
      [x0, y0, h],
      [x1, y0, h],
      [x1, y1, h],
      [x0, y1, h],
    ]);
    ctx.fill();
    this.drawBox(ctx, L, x0 + 0.38, y0 + 0.08, x1 - 0.08, y0 + 0.3, h, 6, v.trim);
  }

  drawSchool(ctx, x, y, s, L, ghost) {
    const wall = PALETTE.peach;
    const roof = '#e9968c';
    const x0 = x + 0.1;
    const x1 = x + 0.9;
    const y0 = y + 0.2;
    const y1 = y + 0.8;
    const h = 16;
    const fill = this.workFill(x, y, s, ghost);
    this.drawBox(ctx, L, x0, y0, x1, y1, 0, h, wall);
    for (let k = 0; k < 4; k++) {
      if (k === 2) continue;
      const u0 = 0.06 + k * 0.23;
      this.drawWindow(ctx, L, this.faceQuad('L', x0, y0, x1, y1, u0, u0 + 0.15, 5, 11), 0.92, this.isWindowLit(x, y, k, fill * 0.4, L));
    }
    ctx.fillStyle = lit(roof, 0.72, L);
    poly(ctx, this.faceQuad('L', x0, y0, x1, y1, 0.52, 0.66, 0, 10));
    ctx.fill();
    this.drawWindow(ctx, L, this.faceQuad('R', x0, y0, x1, y1, 0.15, 0.45, 5, 11), 0.8, false);
    this.drawWindow(ctx, L, this.faceQuad('R', x0, y0, x1, y1, 0.55, 0.85, 5, 11), 0.8, false);
    // Bell tower with a pitched cap and a little clock.
    const bx0 = x + 0.42;
    const bx1 = x + 0.58;
    const by0 = y + 0.38;
    const by1 = y + 0.54;
    this.drawBox(ctx, L, bx0, by0, bx1, by1, h, 10, PALETTE.blush);
    const bm = (by0 + by1) / 2;
    ctx.fillStyle = lit(roof, 1.04, L);
    poly(ctx, [
      [bx0 - 0.03, by0 - 0.03, h + 10],
      [bx0 - 0.03, by1 + 0.03, h + 10],
      [(bx0 + bx1) / 2, by1 + 0.03, h + 17],
      [(bx0 + bx1) / 2, by0 - 0.03, h + 17],
    ]);
    ctx.fill();
    ctx.fillStyle = lit(roof, 0.82, L);
    poly(ctx, [
      [bx1 + 0.03, by0 - 0.03, h + 10],
      [bx1 + 0.03, by1 + 0.03, h + 10],
      [(bx0 + bx1) / 2, by1 + 0.03, h + 17],
      [(bx0 + bx1) / 2, by0 - 0.03, h + 17],
    ]);
    ctx.fill();
    const c = gridToWorld((bx0 + bx1) / 2, by1, h + 5.5);
    ctx.fillStyle = lit('#fffaf2', 1, L);
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, 2.3, 2.3, 0, 0, Math.PI * 2);
    ctx.fill();
    // Flag.
    const f = gridToWorld(x0 + 0.06, y0 + 0.06, h);
    ctx.strokeStyle = lit(PALETTE.pole, 1, L);
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(f.x, f.y);
    ctx.lineTo(f.x, f.y - 14);
    ctx.stroke();
    const wave = this.reduceMotion ? 0 : Math.sin(this.time * 3 + x) * 1.2;
    ctx.fillStyle = lit(PALETTE.lavender, 0.9, L);
    ctx.beginPath();
    ctx.moveTo(f.x, f.y - 14);
    ctx.quadraticCurveTo(f.x + 4, f.y - 14 + wave, f.x + 7, f.y - 13);
    ctx.lineTo(f.x + 7, f.y - 9.5);
    ctx.quadraticCurveTo(f.x + 4, f.y - 10.5 + wave, f.x, f.y - 10.5);
    ctx.closePath();
    ctx.fill();
  }

  drawClinic(ctx, x, y, s, L, ghost) {
    const wall = '#fff6f2';
    const accent = PALETTE.mint;
    const x0 = x + 0.15;
    const x1 = x + 0.85;
    const y0 = y + 0.15;
    const y1 = y + 0.85;
    const h = 20;
    const fill = this.workFill(x, y, s, ghost);
    this.drawBox(ctx, L, x0, y0, x1, y1, 0, h, wall);
    // Mint band and windows.
    ctx.fillStyle = lit(accent, 0.92, L);
    poly(ctx, this.faceQuad('L', x0, y0, x1, y1, 0, 1, 12.5, 14.5));
    ctx.fill();
    ctx.fillStyle = lit(accent, 0.78, L);
    poly(ctx, this.faceQuad('R', x0, y0, x1, y1, 0, 1, 12.5, 14.5));
    ctx.fill();
    // Clinics keep a few lights on all night.
    const night = Math.max(0.35, fill);
    for (let k = 0; k < 3; k++) {
      const u0 = 0.08 + k * 0.3;
      this.drawWindow(ctx, L, this.faceQuad('R', x0, y0, x1, y1, u0, u0 + 0.22, 5, 10.5), 0.8, this.isWindowLit(x, y, k, night, L));
      if (k !== 1) this.drawWindow(ctx, L, this.faceQuad('L', x0, y0, x1, y1, u0, u0 + 0.22, 5, 10.5), 0.92, this.isWindowLit(x, y, k + 3, night, L));
    }
    ctx.fillStyle = lit(PALETTE.glass, 0.8, L);
    poly(ctx, this.faceQuad('L', x0, y0, x1, y1, 0.4, 0.6, 0, 9));
    ctx.fill();
    // Rooftop cross.
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const a = 0.06;
    const b = 0.19;
    ctx.fillStyle = lit('#ff9a9a', 1, L);
    poly(ctx, [
      [cx - a, cy - b, h],
      [cx + a, cy - b, h],
      [cx + a, cy + b, h],
      [cx - a, cy + b, h],
    ]);
    ctx.fill();
    poly(ctx, [
      [cx - b, cy - a, h],
      [cx + b, cy - a, h],
      [cx + b, cy + a, h],
      [cx - b, cy + a, h],
    ]);
    ctx.fill();
    if (L.lamps > 0.1) {
      const p = gridToWorld(cx, cy, h);
      this.glows.push({ x: p.x, y: p.y, r: 14, a: 0.3 * L.lamps, rgb: '255,150,150', flat: true });
    }
  }

  // A pitched roof with its ridge running along x, gable end on the right face.
  gableRoof(ctx, L, x0, y0, x1, y1, h, rise, roof, wall) {
    const ym = (y0 + y1) / 2;
    const e = 0.03;
    ctx.fillStyle = lit(wall, 0.78, L);
    poly(ctx, [[x1, y0, h], [x1, y1, h], [x1, ym, h + rise]]);
    ctx.fill();
    ctx.fillStyle = lit(roof, 0.86, L);
    poly(ctx, [[x0 - e, y0 - e, h], [x1 + e, y0 - e, h], [x1 + e, ym, h + rise], [x0 - e, ym, h + rise]]);
    ctx.fill();
    ctx.fillStyle = lit(roof, 1.02, L);
    poly(ctx, [[x0 - e, y1 + e, h], [x1 + e, y1 + e, h], [x1 + e, ym, h + rise], [x0 - e, ym, h + rise]]);
    ctx.fill();
  }

  // A bakery: a cream cottage with a big shop window, a bread sign and a warm oven chimney that
  // smokes from before dawn.
  drawBakery(ctx, x, y, s, L, ghost) {
    const wall = '#fbe7c6';
    const roof = '#d49a6a';
    const x0 = x + 0.2;
    const x1 = x + 0.8;
    const y0 = y + 0.22;
    const y1 = y + 0.74;
    const h = 12;
    const fill = this.workFill(x, y, s, ghost);
    this.drawBox(ctx, L, x0, y0, x1, y1, 0, h, wall, false);
    const open = !ghost && fill > 0 && L.clock > 0.2 && L.clock < 0.8 && L.windowLit > 0.05;
    this.drawWindow(ctx, L, this.faceQuad('L', x0, y0, x1, y1, 0.08, 0.56, 2.5, 8.5), 0.92, open);
    ctx.fillStyle = lit('#b9845c', 0.8, L);
    poly(ctx, this.faceQuad('L', x0, y0, x1, y1, 0.66, 0.86, 0, 8.5));
    ctx.fill();
    this.drawWindow(ctx, L, this.faceQuad('R', x0, y0, x1, y1, 0.3, 0.7, 4, 9), 0.8, open && hash2(x, y, 17) < 0.6);
    // Chimney behind the ridge, then the roof.
    const cx0 = x0 + 0.1;
    const cy0 = y0 + 0.06;
    this.drawBox(ctx, L, cx0, cy0, cx0 + 0.09, cy0 + 0.09, h, 12, '#e3b08f');
    this.gableRoof(ctx, L, x0, y0, x1, y1, h, 8, roof, wall);
    // Bread sign over the window: a golden loaf with three scores.
    const p = gridToWorld(x0 + (x1 - x0) * 0.32, y1 + 0.04, 10.5);
    ctx.fillStyle = lit('#e8b56a', 1, L);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 4.6, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = lit('#b9845c', 1, L);
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (const d of [-2, 0, 2]) {
      ctx.moveTo(p.x + d - 0.7, p.y + 1);
      ctx.lineTo(p.x + d + 0.7, p.y - 1);
    }
    ctx.stroke();
    // Ovens are lit from the small hours until the afternoon.
    const baking = !ghost && fill > 0 && L.clock > 0.15 && L.clock < 0.6;
    if (baking && !this.reduceMotion) {
      const top = gridToWorld(cx0 + 0.045, cy0 + 0.045, h + 13);
      for (let i = 0; i < 3; i++) {
        const t = (this.time * 0.3 + i / 3 + hash2(x, y, 5)) % 1;
        ctx.fillStyle = litA('#f7f2ea', 1, L, (0.55 * (1 - t)).toFixed(3));
        ctx.beginPath();
        ctx.arc(top.x + t * 7 + Math.sin(t * 6) * 1.5, top.y - t * 16, 1.8 + t * 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // A library: a pale stone hall with a columned porch and a pediment, tall windows down the side.
  drawLibrary(ctx, x, y, s, L, ghost) {
    const wall = '#f3ecf6';
    const accent = PALETTE.lavender;
    const x0 = x + 0.14;
    const x1 = x + 0.86;
    const y0 = y + 0.18;
    const y1 = y + 0.72;
    const h = 15;
    const fill = this.workFill(x, y, s, ghost);
    this.drawBox(ctx, L, x0, y0, x1, y1, 0, h, wall);
    this.drawBox(ctx, L, x0 - 0.02, y0 - 0.02, x1 + 0.02, y1 + 0.02, h, 2.5, accent);
    const open = !ghost && fill > 0 && this.shopOpen(L) && L.windowLit > 0.05;
    for (let k = 0; k < 4; k++) {
      const u0 = 0.08 + k * 0.23;
      this.drawWindow(ctx, L, this.faceQuad('R', x0, y0, x1, y1, u0, u0 + 0.13, 3, 12), 0.8, open && this.isWindowLit(x, y, k, 0.8, L));
    }
    ctx.fillStyle = lit('#a98fbf', 0.85, L);
    poly(ctx, this.faceQuad('L', x0, y0, x1, y1, 0.42, 0.58, 0, 9));
    ctx.fill();
    // Porch: a step, four columns, a beam and a triangular pediment.
    const px0 = x0 + 0.1;
    const px1 = x1 - 0.1;
    const py = y1 + 0.1;
    this.drawBox(ctx, L, px0 - 0.03, y1, px1 + 0.03, py + 0.03, 0, 1.5, PALETTE.stone);
    for (let k = 0; k < 4; k++) {
      const cx = px0 + ((px1 - px0) * (k + 0.5)) / 4;
      this.drawBox(ctx, L, cx - 0.025, py - 0.05, cx + 0.025, py, 1.5, 10.5, '#fffaf6');
    }
    this.drawBox(ctx, L, px0 - 0.02, y1, px1 + 0.02, py + 0.01, 12, 2.5, wall);
    ctx.fillStyle = lit(accent, 0.95, L);
    poly(ctx, [[px0 - 0.02, py + 0.01, 14.5], [px1 + 0.02, py + 0.01, 14.5], [(px0 + px1) / 2, py + 0.01, 20]]);
    ctx.fill();
  }

  // A fire station: a coral brick hall with two big engine doors and a tall hose tower. Its beacon
  // glows red at night.
  drawFireStation(ctx, x, y, s, L, ghost) {
    const wall = '#f4978e';
    const trim = '#fff3ef';
    const x0 = x + 0.12;
    const x1 = x + 0.88;
    const y0 = y + 0.18;
    const y1 = y + 0.84;
    const h = 17;
    const fill = this.workFill(x, y, s, ghost);
    // Hose tower at the back, drawn first so the hall sits in front of it.
    const tx0 = x1 - 0.22;
    const ty0 = y0 + 0.02;
    this.drawBox(ctx, L, tx0, ty0, tx0 + 0.16, ty0 + 0.16, 0, 34, wall);
    this.drawBox(ctx, L, tx0 - 0.02, ty0 - 0.02, tx0 + 0.18, ty0 + 0.18, 34, 2.5, trim);
    this.drawWindow(ctx, L, this.faceQuad('R', tx0, ty0, tx0 + 0.16, ty0 + 0.16, 0.3, 0.7, 24, 30), 0.8, this.isWindowLit(x, y, 7, fill, L));
    this.drawBox(ctx, L, x0, y0, x1, y1, 0, h, wall);
    this.drawBox(ctx, L, x0 - 0.01, y0 - 0.01, x1 + 0.01, y1 + 0.01, h, 2, trim);
    // Two engine doors with panel lines.
    for (const [u0, u1] of [[0.08, 0.44], [0.54, 0.9]]) {
      ctx.fillStyle = lit(trim, 0.92, L);
      poly(ctx, this.faceQuad('L', x0, y0, x1, y1, u0, u1, 0, 11));
      ctx.fill();
      ctx.strokeStyle = lit('#e0c8c2', 1, L);
      ctx.lineWidth = 0.6;
      for (const v of [3.5, 6.5, 9.5]) {
        const a = gridToWorld(x0 + (x1 - x0) * u0, y1, v);
        const b = gridToWorld(x0 + (x1 - x0) * u1, y1, v);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    // Crew quarters upstairs keep a light on all night.
    const night = Math.max(0.4, fill);
    for (let k = 0; k < 3; k++) {
      const u0 = 0.1 + k * 0.3;
      this.drawWindow(ctx, L, this.faceQuad('R', x0, y0, x1, y1, u0, u0 + 0.2, 6, 12), 0.8, this.isWindowLit(x, y, k, night, L));
    }
    // Beacon on the roof.
    const b = gridToWorld(x0 + 0.14, y1 - 0.14, h + 4);
    ctx.fillStyle = lit('#ff6b5e', 1, L);
    ctx.beginPath();
    ctx.arc(b.x, b.y, 1.8, 0, Math.PI * 2);
    ctx.fill();
    if (L.lamps > 0.1) this.glows.push({ x: b.x, y: b.y, r: 10, a: 0.35 * L.lamps, rgb: '255,110,100' });
  }

  // A university: a long two-storey hall in warm sandstone, a clock tower in the middle and a
  // flag on top.
  drawUniversity(ctx, x, y, s, L, ghost) {
    const wall = '#f3dcc8';
    const roof = '#b79ad0';
    const x0 = x + 0.06;
    const x1 = x + 0.94;
    const y0 = y + 0.12;
    const y1 = y + 0.88;
    const h = 22;
    const fill = this.workFill(x, y, s, ghost);
    this.drawBox(ctx, L, x0, y0, x1, y1, 0, h, wall);
    this.drawBox(ctx, L, x0 - 0.02, y0 - 0.02, x1 + 0.02, y1 + 0.02, h, 2.5, roof);
    // Two floors of windows; students study late, so a few stay lit into the night.
    const late = Math.max(0.25, fill * 0.7);
    for (let row = 0; row < 2; row++) {
      const v0 = 3.5 + row * 9;
      for (let k = 0; k < 5; k++) {
        const u0 = 0.06 + k * 0.19;
        if (row === 0 && k === 2) continue;
        this.drawWindow(ctx, L, this.faceQuad('L', x0, y0, x1, y1, u0, u0 + 0.11, v0, v0 + 5.5), 0.92, this.isWindowLit(x, y, row * 5 + k, late, L));
        this.drawWindow(ctx, L, this.faceQuad('R', x0, y0, x1, y1, u0, u0 + 0.11, v0, v0 + 5.5), 0.8, this.isWindowLit(x, y, 10 + row * 5 + k, late, L));
      }
    }
    // Arched entrance.
    ctx.fillStyle = lit('#a98fbf', 0.85, L);
    poly(ctx, this.faceQuad('L', x0, y0, x1, y1, 0.43, 0.57, 0, 10));
    ctx.fill();
    // Clock tower with a pyramid cap.
    const bx0 = x + 0.4;
    const bx1 = x + 0.6;
    const by0 = y + 0.4;
    const by1 = y + 0.6;
    const top = h + 2.5;
    this.drawBox(ctx, L, bx0, by0, bx1, by1, top, 16, wall);
    const c = gridToWorld((bx0 + bx1) / 2, by1, top + 10);
    ctx.fillStyle = lit('#fffaf2', 1, L);
    ctx.beginPath();
    ctx.arc(c.x, c.y, 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = lit('#7d6a8f', 1, L);
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(c.x, c.y - 2);
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(c.x + 1.4, c.y);
    ctx.stroke();
    const apex = [(bx0 + bx1) / 2, (by0 + by1) / 2, top + 26];
    const e = 0.02;
    ctx.fillStyle = lit(roof, 1.02, L);
    poly(ctx, [[bx0 - e, by1 + e, top + 16], [bx1 + e, by1 + e, top + 16], apex]);
    ctx.fill();
    ctx.fillStyle = lit(roof, 0.8, L);
    poly(ctx, [[bx1 + e, by1 + e, top + 16], [bx1 + e, by0 - e, top + 16], apex]);
    ctx.fill();
  }

  drawTree(ctx, gx, gy, shape, L, phase, scale, tx = gx, ty = gy) {
    const col = this.treeColors(tx * 3, ty * 3, shape === 3);
    const p = gridToWorld(gx, gy);
    const sway = this.reduceMotion ? 0 : Math.sin(this.time * 1.2 + phase) * 0.7;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(scale, scale);
    ctx.fillStyle = lit(PALETTE.trunk, 0.9, L);
    ctx.beginPath();
    ctx.roundRect(-1.6, -9, 3.2, 9.5, 1.2);
    ctx.fill();
    const blob = (cx, cy, r, color, shade) => {
      ctx.fillStyle = lit(color, shade, L);
      ctx.beginPath();
      ctx.arc(cx + sway, cy, r, 0, Math.PI * 2);
      ctx.fill();
    };
    if (shape === 1) {
      // Pine: stacked tiers, darker on the shaded right side.
      for (let i = 0; i < 3; i++) {
        const base = -6 - i * 7;
        const w = 9 - i * 2;
        const s = sway * (0.5 + i * 0.25);
        // Pines stay green all year; in winter their tiers carry snow.
        const pineDeep = this.snowCover >= 0.5 ? '#6f9e88' : PALETTE.leafDeep;
        const pineMid = this.snowCover >= 0.5 ? '#e8efee' : PALETTE.leaf;
        ctx.fillStyle = lit(pineDeep, 1, L);
        ctx.beginPath();
        ctx.moveTo(-w + s * 0.5, base);
        ctx.lineTo(w + s * 0.5, base);
        ctx.lineTo(s, base - 11);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = lit(pineMid, 1, L);
        ctx.beginPath();
        ctx.moveTo(-w + s * 0.5, base);
        ctx.lineTo(s * 0.7, base);
        ctx.lineTo(s, base - 11);
        ctx.closePath();
        ctx.fill();
      }
    } else if (shape === 2) {
      ctx.fillStyle = lit(col.deep, 1, L);
      ctx.beginPath();
      ctx.ellipse(sway + 0.8, -17, 7, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = lit(col.mid, 1, L);
      ctx.beginPath();
      ctx.ellipse(sway - 0.6, -18, 5.8, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      blob(-2.5, -22, 2.6, col.light, 1);
    } else {
      const { deep, mid, light } = col;
      blob(1, -15, 9, deep, 1);
      blob(-4, -16, 6.5, mid, 1);
      blob(3, -20, 6.5, mid, 1);
      blob(-1, -22, 6, mid, 1.02);
      blob(-3.2, -22.5, 3, light, 1);
    }
    ctx.restore();
  }

  // Line between two grid points at given heights.
  stick(ctx, a, b, color, width) {
    const p = gridToWorld(a[0], a[1], a[2] || 0);
    const q = gridToWorld(b[0], b[1], b[2] || 0);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  }

  drawPlayground(ctx, x, y, L) {
    ctx.lineCap = 'round';
    // Swings: an A-frame at each end, a top bar and two seats swaying.
    const pole = lit(PALETTE.lavender, 0.8, L);
    for (const gy of [y + 0.22, y + 0.62]) {
      this.stick(ctx, [x + 0.16, gy - 0.06, 0], [x + 0.2, gy, 15], pole, 1.6);
      this.stick(ctx, [x + 0.24, gy + 0.06, 0], [x + 0.2, gy, 15], pole, 1.6);
    }
    this.stick(ctx, [x + 0.2, y + 0.22, 15], [x + 0.2, y + 0.62, 15], lit(PALETTE.lavender, 0.95, L), 2);
    for (let i = 0; i < 2; i++) {
      const gy = y + 0.34 + i * 0.16;
      const sway = this.reduceMotion ? 0 : Math.sin(this.time * 2.2 + i * 1.7 + x) * 0.07;
      const top = [x + 0.2, gy, 15];
      const seat = [x + 0.2 + sway, gy, 4 + Math.abs(sway) * 10];
      this.stick(ctx, top, seat, litA('#7c7396', 1, L, 0.8), 0.7);
      this.stick(ctx, [seat[0] - 0.01, gy - 0.04, seat[2]], [seat[0] + 0.01, gy + 0.04, seat[2]], lit(PALETTE.peach, 0.85, L), 2.2);
    }
    // Slide: a ladder tower and a sloped chute.
    this.drawBox(ctx, L, x + 0.58, y + 0.22, x + 0.74, y + 0.38, 0, 11, PALETTE.mint);
    ctx.fillStyle = lit(PALETTE.peach, 0.92, L);
    poly(ctx, [
      [x + 0.6, y + 0.38, 11],
      [x + 0.72, y + 0.38, 11],
      [x + 0.72, y + 0.8, 1],
      [x + 0.6, y + 0.8, 1],
    ]);
    ctx.fill();
    ctx.fillStyle = lit(PALETTE.peach, 1.08, L);
    poly(ctx, [
      [x + 0.58, y + 0.22, 11],
      [x + 0.74, y + 0.22, 11],
      [x + 0.74, y + 0.38, 11],
      [x + 0.58, y + 0.38, 11],
    ]);
    ctx.fill();
    // Spring rider.
    const r = gridToWorld(x + 0.8, y + 0.82, 0);
    const bob = this.reduceMotion ? 0 : Math.sin(this.time * 3 + y) * 1.2;
    ctx.fillStyle = lit('#ffd98f', 1, L);
    ctx.beginPath();
    ctx.ellipse(r.x + bob * 0.5, r.y - 5, 3.2, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = lit('#b0a8c4', 1, L);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(r.x, r.y);
    ctx.lineTo(r.x + bob * 0.5, r.y - 3);
    ctx.stroke();
  }

  drawField(ctx, x, y, L) {
    ctx.lineCap = 'round';
    // Goals at each end.
    for (const gx of [x + 0.1, x + 0.9]) {
      const white = lit('#ffffff', 1, L);
      this.stick(ctx, [gx, y + 0.4, 0], [gx, y + 0.4, 7], white, 1.3);
      this.stick(ctx, [gx, y + 0.6, 0], [gx, y + 0.6, 7], white, 1.3);
      this.stick(ctx, [gx, y + 0.4, 7], [gx, y + 0.6, 7], white, 1.3);
      ctx.fillStyle = litA('#ffffff', 1, L, 0.25);
      poly(ctx, [
        [gx, y + 0.4, 7],
        [gx, y + 0.6, 7],
        [gx, y + 0.6, 0],
        [gx, y + 0.4, 0],
      ]);
      ctx.fill();
    }
    // A little bleacher along the far edge.
    this.drawBox(ctx, L, x + 0.3, y + 0.02, x + 0.7, y + 0.08, 0, 4, PALETTE.lavender);
    this.drawBox(ctx, L, x + 0.3, y + 0.0, x + 0.7, y + 0.04, 4, 3, PALETTE.blush);
    // The ball rolls about.
    const t = this.reduceMotion ? 0 : this.time * 0.6 + hash2(x, y, 9) * 6;
    const b = gridToWorld(x + 0.5 + Math.sin(t) * 0.25, y + 0.5 + Math.sin(t * 1.7) * 0.18, 1.5);
    ctx.fillStyle = lit('#ffffff', 1, L);
    ctx.beginPath();
    ctx.arc(b.x, b.y, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  drawParkProps(ctx, x, y, L) {
    this.drawTree(ctx, x + 0.2, y + 0.8, 2, L, hash2(x, y, 13) * 6, 0.62);
    // Fountain.
    const c = gridToWorld(x + 0.5, y + 0.5);
    ctx.fillStyle = lit(PALETTE.stone, 0.82, L);
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, 10, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = lit(PALETTE.stone, 1, L);
    ctx.beginPath();
    ctx.ellipse(c.x, c.y - 2.5, 10, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = lit(PALETTE.water, 1.04, L);
    ctx.beginPath();
    ctx.ellipse(c.x, c.y - 2.7, 7.6, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = lit(PALETTE.stone, 0.95, L);
    ctx.fillRect(c.x - 1, c.y - 8, 2, 6);
    ctx.fillStyle = litA('#ffffff', 1, L, 0.85);
    for (let i = 0; i < 4; i++) {
      const ph = (this.time * 0.9 + i / 4) % 1;
      const side = i % 2 ? 1 : -1;
      ctx.beginPath();
      ctx.arc(c.x + side * ph * 6, c.y - 8 - Math.sin(ph * Math.PI) * 5 + ph * 4, 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
    this.drawTree(ctx, x + 0.8, y + 0.2, 0, L, hash2(x, y, 14) * 6, 0.55);
    // Bench.
    const b = gridToWorld(x + 0.78, y + 0.66);
    ctx.fillStyle = lit(PALETTE.trunk, 0.95, L);
    ctx.beginPath();
    ctx.moveTo(b.x - 5, b.y - 3);
    ctx.lineTo(b.x + 2, b.y - 6.5);
    ctx.lineTo(b.x + 2, b.y - 4.5);
    ctx.lineTo(b.x - 5, b.y - 1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = lit(PALETTE.trunk, 0.7, L);
    ctx.fillRect(b.x - 4.5, b.y - 1.5, 1, 2);
    ctx.fillRect(b.x + 1, b.y - 5, 1, 2);
  }

  // Street lamps sit on a sidewalk edge of some road tiles; four-way junctions stay clear.
  lampSpot(t) {
    if (hash2(t.x, t.y, 7) > 0.5) return null;
    for (const i of [3, 0, 1, 2]) {
      if (t.roadMask & (1 << i)) continue;
      const e = EDGES[i];
      return {
        // At the kerb, clear of the people walking down the middle of the sidewalk.
        gx: t.x + (e.a[0] + e.b[0]) / 2 + e.n[0] * 0.135,
        gy: t.y + (e.a[1] + e.b[1]) / 2 + e.n[1] * 0.135,
      };
    }
    return null;
  }

  drawLamp(ctx, lamp, L) {
    const era = this.era ?? 3;
    if (era < 2) return this.drawOldLamp(ctx, lamp, L, era);
    const base = gridToWorld(lamp.gx, lamp.gy);
    const top = base.y - 20;
    ctx.strokeStyle = lit(PALETTE.pole, 1, L);
    ctx.lineWidth = 1.3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(base.x, top);
    ctx.stroke();
    const on = L.lamps > 0.05;
    ctx.fillStyle = on ? PALETTE.lampOn : lit(PALETTE.lampOff, 1, L);
    ctx.beginPath();
    ctx.arc(base.x, top - 1.5, 2.4, 0, Math.PI * 2);
    ctx.fill();
    if (on) {
      this.glows.push({ x: base.x, y: top - 1.5, r: 15, a: 0.45 * L.lamps, rgb: '255,236,180' });
      this.glows.push({ x: base.x, y: base.y, r: 26, a: 0.22 * L.lamps, rgb: '255,226,160', flat: true });
    }
  }

  // A wooden post with a lantern (pioneer days) or a cast-iron gas lamp (railway age).
  drawOldLamp(ctx, lamp, L, era) {
    const base = gridToWorld(lamp.gx, lamp.gy);
    const top = base.y - (era === 0 ? 12 : 17);
    ctx.strokeStyle = lit(era === 0 ? '#8b6b4a' : '#5f5a72', 1, L);
    ctx.lineWidth = era === 0 ? 1.6 : 1.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(base.x, top);
    ctx.stroke();
    const on = L.lamps > 0.05;
    ctx.fillStyle = on ? '#ffd27a' : lit('#e9dfcf', 1, L);
    ctx.fillRect(base.x - 1.6, top - 3.4, 3.2, 3.4);
    ctx.fillStyle = lit(era === 0 ? '#6e5038' : '#4d4860', 1, L);
    ctx.fillRect(base.x - 2, top - 4.2, 4, 1);
    if (on) {
      this.glows.push({ x: base.x, y: top - 1.7, r: 11, a: 0.5 * L.lamps, rgb: '255,196,110' });
      this.glows.push({ x: base.x, y: base.y, r: era === 0 ? 14 : 20, a: 0.2 * L.lamps, rgb: '255,190,110', flat: true });
    }
  }

  // A horse and cart, for the years before motor cars.
  drawCart(ctx, c, pose, L) {
    if (c.alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = c.alpha;
    const { gx, gy, dx, dy } = pose;
    const g = gridToWorld(gx, gy);
    ctx.fillStyle = 'rgba(52,44,96,0.18)';
    ctx.beginPath();
    ctx.ellipse(g.x, g.y + 1, 7, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    const alongX = Math.abs(dx) >= Math.abs(dy);
    const ex = alongX ? 0.1 : 0.07;
    const ey = alongX ? 0.07 : 0.1;
    // Cart behind, horse in front.
    const bx = gx - dx * 0.08;
    const by = gy - dy * 0.08;
    this.drawBox(ctx, L, bx - ex, by - ey, bx + ex, by + ey, 2, 3.5, c.cartColor || '#b88a5a');
    const hx = gx + dx * 0.13;
    const hy = gy + dy * 0.13;
    const hex = alongX ? 0.07 : 0.03;
    const hey = alongX ? 0.03 : 0.07;
    this.drawBox(ctx, L, hx - hex, hy - hey, hx + hex, hy + hey, 3, 3, c.horse || '#8a5d3b');
    const head = gridToWorld(hx + dx * 0.08, hy + dy * 0.08, 7.5);
    ctx.fillStyle = lit(c.horse || '#8a5d3b', 0.9, L);
    ctx.beginPath();
    ctx.arc(head.x, head.y, 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (L.lamps > 0.1) {
      const f = gridToWorld(bx, by, 7);
      this.glows.push({ x: f.x, y: f.y, r: 7, a: 0.4 * L.lamps * c.alpha, rgb: '255,200,120' });
    }
  }

  drawCar(ctx, c, pose, L) {
    if (c.kind === 'cart') return this.drawCart(ctx, c, pose, L);
    if (c.alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = c.alpha;
    const alongX = Math.abs(pose.dx) >= Math.abs(pose.dy);
    const hl = 0.17;
    const hw = 0.1;
    const ex = alongX ? hl : hw;
    const ey = alongX ? hw : hl;
    const { gx, gy } = pose;
    const g = gridToWorld(gx, gy);
    ctx.fillStyle = 'rgba(52,44,96,0.2)';
    ctx.beginPath();
    ctx.ellipse(g.x, g.y + 1, (ex + ey) * HALF_W * 0.95, (ex + ey) * HALF_H * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();
    this.drawBox(ctx, L, gx - ex, gy - ey, gx + ex, gy + ey, 1.5, 4.5, c.color);
    const cx = alongX ? ex * 0.55 : ex * 0.85;
    const cy = alongX ? ey * 0.85 : ey * 0.55;
    const back = 0.03;
    const ox = -pose.dx * back;
    const oy = -pose.dy * back;
    this.drawBox(ctx, L, gx - cx + ox, gy - cy + oy, gx + cx + ox, gy + cy + oy, 6, 3, '#e9f1f7');
    ctx.fillStyle = lit(c.color, 1.05, L);
    poly(ctx, [
      [gx - cx + ox, gy - cy + oy, 9.2],
      [gx + cx + ox, gy - cy + oy, 9.2],
      [gx + cx + ox, gy + cy + oy, 9.2],
      [gx - cx + ox, gy + cy + oy, 9.2],
    ]);
    ctx.fill();
    ctx.restore();
    if (L.lamps > 0.1) {
      const f = gridToWorld(gx + pose.dx * (hl + 0.08), gy + pose.dy * (hl + 0.08), 3);
      this.glows.push({ x: f.x, y: f.y, r: 12, a: 0.5 * L.lamps * c.alpha, rgb: '255,244,200' });
      const r = gridToWorld(gx - pose.dx * hl, gy - pose.dy * hl, 3);
      this.glows.push({ x: r.x, y: r.y, r: 5, a: 0.5 * L.lamps * c.alpha, rgb: '255,120,120' });
    }
  }

  drawWalker(ctx, w, L) {
    if (w.alpha <= 0) return;
    const p = gridToWorld(w.gx, w.gy);
    const step = w.moving ? Math.sin(this.time * 9 + w.phase) : 0;
    const bob = w.moving ? Math.abs(step) * 0.9 : 0;
    ctx.save();
    ctx.globalAlpha = w.alpha;
    if (w.hero) {
      // The Life Story character: a little bigger, with a ring at their feet in their outfit colour.
      const pulse = this.reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(this.time * 3);
      ctx.strokeStyle = rgba(w.shirt, (0.55 + 0.35 * pulse).toFixed(3));
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, 5 + pulse, 2.5 + pulse * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Children are smaller, adults vary a little in height.
    const s = w.hero ? (w.child ? 1.1 : 1.35) : w.build || 1;
    if (s !== 1) {
      ctx.translate(p.x, p.y);
      ctx.scale(s, s);
      ctx.translate(-p.x, -p.y);
    }
    ctx.fillStyle = 'rgba(52,44,96,0.22)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 2.4, 1.2, 0, 0, Math.PI * 2);
    ctx.fill();
    // Legs swing as they walk.
    ctx.strokeStyle = lit(w.pants || '#5b6a8f', 1, L);
    ctx.lineWidth = 1.1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x - 0.6, p.y - 2 - bob);
    ctx.lineTo(p.x - 0.6 + step * 0.9, p.y - 0.4);
    ctx.moveTo(p.x + 0.6, p.y - 2 - bob);
    ctx.lineTo(p.x + 0.6 - step * 0.9, p.y - 0.4);
    ctx.stroke();
    ctx.fillStyle = lit(w.shirt, 1, L);
    ctx.beginPath();
    ctx.roundRect(p.x - 1.6, p.y - 6.2 - bob, 3.2, 4.6, 1.4);
    ctx.fill();
    ctx.fillStyle = lit(w.skin, 1, L);
    ctx.beginPath();
    ctx.arc(p.x, p.y - 7.8 - bob, 1.7, 0, Math.PI * 2);
    ctx.fill();
    if (w.hat) {
      ctx.fillStyle = lit(w.hat, 1, L);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y - 8.9 - bob, 2.3, 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y - 9.1 - bob, 1.4, Math.PI, 0);
      ctx.fill();
    } else if (w.hair) {
      ctx.fillStyle = lit(w.hair, 1, L);
      ctx.beginPath();
      ctx.arc(p.x, p.y - 8.2 - bob, 1.8, Math.PI * 1.05, Math.PI * 1.95);
      ctx.closePath();
      ctx.fill();
    }
    // Townsfolk wear their mood: a small dot over their head, green when cheerful, red when low.
    if (w.townId && w.mood != null) {
      ctx.fillStyle = SEVERITY_COLORS[w.mood >= 0.55 ? 'good' : w.mood >= 0.35 ? 'caution' : 'bad'];
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.arc(p.x, p.y - 12 - bob, 1.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // Umbrellas come out in the rain and snow.
    const wet = Math.max(this.weather?.rain || 0, this.weather?.snow || 0);
    if (wet > 0.3) {
      const top = p.y - 12.5 - bob;
      ctx.strokeStyle = lit('#6d6890', 1, L);
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(p.x + 1.4, top);
      ctx.lineTo(p.x + 1.4, p.y - 5 - bob);
      ctx.stroke();
      ctx.fillStyle = lit(w.umbrella || w.shirt, 1, L);
      ctx.beginPath();
      ctx.ellipse(p.x + 1.4, top, 4.6, 2.6, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // Pins over the Life Story character's home and workplace, drawn above everything else.
  // Badges over the homes of notable people: their type's colour and symbol, gently bobbing.
  drawNotables(ctx) {
    const people = this.city.systems.notables?.people;
    if (!people?.length) return;
    const z = Math.max(0.7, 1 / Math.sqrt(this.camera.zoom));
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${(8 * z).toFixed(1)}px system-ui, -apple-system, sans-serif`;
    people.forEach((p, i) => {
      if (!p.home) return;
      const t = this.city.getTile(p.home.x, p.home.y);
      const type = notableType(p.type);
      if (!t || !type) return;
      const f = t.structure ? this.footprint(t) : null;
      const bob = this.reduceMotion ? 0 : Math.sin(this.time * 2 + i) * 1.5;
      const pos = gridToWorld(p.home.x + 0.5, p.home.y + 0.5, (f?.h || 12) + 10 + bob);
      const r = 6 * z;
      ctx.fillStyle = 'rgba(52,44,96,0.22)';
      ctx.beginPath();
      ctx.arc(pos.x, pos.y + 1.5 * z, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = type.color;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.6 * z;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#3d3557';
      ctx.fillText(type.icon, pos.x, pos.y + 0.5 * z);
    });
    ctx.restore();
  }

  drawLifePins(ctx, L) {
    this.drawNotables(ctx);
    this.homeTag = null;
    const c = this.city.systems.life?.char;
    if (!c?.alive) return;
    const pin = (spot, color, size, icon, label = null) => {
      const t = this.city.getTile(spot.x, spot.y);
      if (!t) return;
      const f = t.structure ? this.footprint(t) : null;
      const bob = this.reduceMotion ? 0 : Math.sin(this.time * 2.4 + spot.x) * 2;
      const p = gridToWorld(spot.x + 0.5, spot.y + 0.5, (f?.h || 10) + 14 + bob);
      const z = Math.max(0.7, 1 / Math.sqrt(this.camera.zoom));
      const r = size * z;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.fillStyle = 'rgba(52,44,96,0.25)';
      ctx.beginPath();
      ctx.ellipse(0, r * 1.9, r * 0.5, r * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.6 * z;
      ctx.beginPath();
      ctx.moveTo(0, r * 1.6);
      ctx.bezierCurveTo(-r * 0.6, r * 0.6, -r, r * 0.1, -r, -r * 0.2);
      ctx.arc(0, -r * 0.2, r, Math.PI, 0);
      ctx.bezierCurveTo(r, r * 0.1, r * 0.6, r * 0.6, 0, r * 1.6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      if (icon === 'home') {
        ctx.beginPath();
        ctx.moveTo(-r * 0.5, -r * 0.1);
        ctx.lineTo(0, -r * 0.6);
        ctx.lineTo(r * 0.5, -r * 0.1);
        ctx.lineTo(r * 0.35, -r * 0.1);
        ctx.lineTo(r * 0.35, r * 0.35);
        ctx.lineTo(-r * 0.35, r * 0.35);
        ctx.lineTo(-r * 0.35, -r * 0.1);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillRect(-r * 0.42, -r * 0.35, r * 0.84, r * 0.62);
        ctx.fillStyle = color;
        ctx.fillRect(-r * 0.18, -r * 0.5, r * 0.36, r * 0.18);
      }
      ctx.restore();
      if (label) {
        // An address tag over the pin, so the home is easy to find and name.
        const fs = 9 * z;
        ctx.save();
        ctx.font = `800 ${fs.toFixed(1)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
        const tw = ctx.measureText(label).width;
        const w = tw + fs * 1.4;
        const h = fs * 1.9;
        const x = p.x - w / 2;
        const y = p.y - r * 1.4 - h - 3 * z;
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.4 * z;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, h / 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#4a4270';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, p.x, y + h / 2 + 0.5);
        ctx.restore();
        // Remember where the tag is on screen so thought bubbles can keep clear of it.
        const a = this.worldToScreen({ x, y });
        const zz = this.camera.zoom;
        this.homeTag = { x: a.x, y: a.y, w: w * zz, h: (h + r * 3) * zz };
      }
      if (L.lamps > 0.1) this.glows.push({ x: p.x, y: p.y, r: r * 2.4, a: 0.35 * L.lamps, rgb: '255,240,220' });
    };
    if (c.job) pin(c.job, '#a98bd0', 7.5, 'work');
    if (c.home) {
      const t = this.city.getTile(c.home.x, c.home.y);
      const addr = t?.address ? shortName(addressOf(t)) : null;
      pin(c.home, c.look?.outfit || '#ff8f7e', 9.5, 'home', addr && this.camera.zoom >= 0.6 ? addr : null);
    }
    // A small marker bobbing over the character when they're out, so they're easy to spot.
    const h = this.agents.hero;
    if (h && !h.dead && h.alpha > 0.2) {
      const z = Math.max(0.7, 1 / Math.sqrt(this.camera.zoom));
      const bob = this.reduceMotion ? 0 : Math.sin(this.time * 4) * 1.5;
      const p = gridToWorld(h.gx, h.gy, (h.child ? 16 : 19) + bob);
      const r = 3.6 * z;
      ctx.save();
      ctx.globalAlpha = h.alpha;
      ctx.fillStyle = c.look?.outfit || '#ff8f7e';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.3 * z;
      ctx.beginPath();
      ctx.moveTo(p.x - r, p.y - r * 1.2);
      ctx.lineTo(p.x + r, p.y - r * 1.2);
      ctx.lineTo(p.x, p.y + r * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---- Particles and light ----------------------------------------------------------

  drawParticles(ctx, dt, L) {
    const keep = [];
    for (const p of this.particles) {
      p.age += dt;
      if (p.age >= p.life) continue;
      keep.push(p);
      if (p.age < 0) continue;
      const t = p.age / p.life;
      if (p.kind === 'dust') {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.92;
        p.vy = p.vy * 0.92 - 4 * dt;
        ctx.fillStyle = litA('#f3ebdf', 1, L, (0.85 * (1 - t)).toFixed(3));
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (1 + t * 1.4), 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'smoke') {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        ctx.fillStyle = `rgba(90,86,100,${(0.45 * (1 - t)).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (1 + t * 2.5), 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'ring') {
        const r = 0.2 + t * 0.55;
        ctx.strokeStyle = rgba(p.color, (0.8 * (1 - t)).toFixed(3));
        ctx.lineWidth = 2 * (1 - t) + 0.5;
        gridEllipse(ctx, p.gx, p.gy, 0, r);
        ctx.stroke();
      } else if (p.kind === 'spark') {
        const a = 1 - t;
        const r = 2.2 * (1 - t * 0.5);
        const y = p.y - t * 14;
        ctx.fillStyle = `rgba(255,236,170,${a.toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(p.x, y - r * 2);
        ctx.lineTo(p.x + r * 0.6, y - r * 0.6);
        ctx.lineTo(p.x + r * 2, y);
        ctx.lineTo(p.x + r * 0.6, y + r * 0.6);
        ctx.lineTo(p.x, y + r * 2);
        ctx.lineTo(p.x - r * 0.6, y + r * 0.6);
        ctx.lineTo(p.x - r * 2, y);
        ctx.lineTo(p.x - r * 0.6, y - r * 0.6);
        ctx.closePath();
        ctx.fill();
      } else if (p.kind === 'float') {
        const y = p.y - t * 20;
        const a = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
        const z = this.camera.zoom;
        ctx.save();
        ctx.translate(p.x, y);
        ctx.scale(1 / Math.sqrt(z), 1 / Math.sqrt(z));
        ctx.font = '700 12px system-ui, -apple-system, "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = a;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.strokeText(p.text, 0, 0);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, 0, 0);
        ctx.restore();
      } else if (p.kind === 'heart') {
        const y = p.y - t * 22;
        const s = 3.2 * (t < 0.15 ? t / 0.15 : 1);
        ctx.fillStyle = `rgba(255,128,150,${(1 - t * t).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(p.x, y + s * 0.9);
        ctx.bezierCurveTo(p.x - s * 1.6, y - s * 0.2, p.x - s * 0.7, y - s * 1.3, p.x, y - s * 0.4);
        ctx.bezierCurveTo(p.x + s * 0.7, y - s * 1.3, p.x + s * 1.6, y - s * 0.2, p.x, y + s * 0.9);
        ctx.fill();
      }
    }
    this.particles = keep;
  }

  drawGlows(ctx, L) {
    if (!this.glows.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const g of this.glows) {
      if (g.a <= 0.005) continue;
      ctx.save();
      ctx.translate(g.x, g.y);
      if (g.flat) ctx.scale(1, 0.5);
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, g.r);
      grad.addColorStop(0, `rgba(${g.rgb},${g.a.toFixed(3)})`);
      grad.addColorStop(1, `rgba(${g.rgb},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(-g.r, -g.r, g.r * 2, g.r * 2);
      ctx.restore();
    }
    ctx.restore();
  }
}
