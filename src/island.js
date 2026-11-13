// Island: shapes a new town's map into one large island with the sea on every side, and says where
// its beaches are. The shape comes from the town's seed, so the same seed always gives the same coast.
//
// Only terrain changes ('grass' | 'water', as ever), so saves and share links keep their shape. A town
// made as an island remembers it in city.systems.island = { seed }; beaches are worked out from that
// and the coast as it is now (they are looks only: sand is ordinary land you can build on). Towns
// without it (older saves, settlements, shared towns) have no beaches and play exactly as before.

import { mulberry32 } from './utils.js';

const TAU = Math.PI * 2;

const hash = (seed, x, y) => {
  let h = (seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};
const smooth = (t) => t * t * (3 - 2 * t);

// Smooth value noise, 0..1, in cells of `cell` tiles.
export function valueNoise(seed, x, y, cell) {
  const gx = Math.floor(x / cell);
  const gy = Math.floor(y / cell);
  const fx = smooth(x / cell - gx);
  const fy = smooth(y / cell - gy);
  const a = hash(seed, gx, gy);
  const b = hash(seed, gx + 1, gy);
  const c = hash(seed, gx, gy + 1);
  const d = hash(seed, gx + 1, gy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

// How many tiles of open sea ring the map at the very least.
export const seaMargin = (size) => (size >= 24 ? 2 : 1);

// Turn the map into an island around (cx, cy). Every tile within `core` tiles of the centre stays dry,
// so the start always has room; the outer ring of the map is always sea. Clears anything standing on
// tiles that become water. Returns the number of land tiles.
export function shapeIsland(city, seed, { cx = city.width / 2, cy = city.height / 2, core = 5 } = {}) {
  const W = city.width;
  const H = city.height;
  const rand = mulberry32((seed ^ 0x151a9d) >>> 0);
  const margin = seaMargin(Math.min(W, H));
  const big = Math.min(W, H) >= 24;

  // The coast is a rounded square pushed in and out by a few slow waves, with bays bitten into it.
  const lobes = [2, 3, 5].map((k, i) => ({ k, at: rand() * TAU, amp: [0.06, 0.055, 0.03][i] * (0.6 + rand() * 0.8) }));
  const bayCount = big ? 3 + (rand() < 0.5 ? 1 : 0) : 2;
  const turn = rand() * TAU;
  const bays = Array.from({ length: bayCount }, (_, i) => ({
    at: turn + (i / bayCount) * TAU + (rand() - 0.5) * 0.7,
    wide: 0.14 + rand() * 0.13,
    deep: 0.16 + rand() * 0.13,
  }));
  const angleGap = (a, b) => Math.abs(((a - b + Math.PI * 3) % TAU) - Math.PI);
  const reach = (angle) => {
    let r = 0.95;
    for (const l of lobes) r += l.amp * Math.cos(l.k * angle + l.at);
    for (const b of bays) r -= b.deep * Math.exp(-((angleGap(angle, b.at) / b.wide) ** 2));
    return Math.min(0.985, r);
  };

  const P = 2.5; // 2 would be a circle; higher fills the corners of the map
  const land = new Uint8Array(W * H);
  const fixed = new Uint8Array(W * H); // 1: always land (the core), 2: always sea (the ring)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (Math.min(x, y, W - 1 - x, H - 1 - y) < margin) {
        fixed[i] = 2;
        continue;
      }
      const dc = Math.max(Math.abs(x - cx), Math.abs(y - cy));
      if (dc <= core && Math.hypot(x - cx, y - cy) <= core * 1.3) {
        fixed[i] = 1;
        land[i] = 1;
        continue;
      }
      const nx = (x + 0.5 - W / 2) / (W / 2 - margin);
      const ny = (y + 0.5 - H / 2) / (H / 2 - margin);
      const d = (Math.abs(nx) ** P + Math.abs(ny) ** P) ** (1 / P);
      const ragged = (valueNoise(seed ^ 0x51ed, x, y, 3.5) - 0.5) * 0.09;
      if (d + ragged < reach(Math.atan2(ny, nx))) land[i] = 1;
    }
  }

  // Tidy the coast: no one-tile spits or notches, so the shoreline reads as curves.
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : land[y * W + x]);
  for (let pass = 0; pass < 2; pass++) {
    const next = land.slice();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (fixed[i]) continue;
        const n = at(x + 1, y) + at(x - 1, y) + at(x, y + 1) + at(x, y - 1);
        if (land[i] && n <= 1) next[i] = 0;
        else if (!land[i] && n >= 3) next[i] = 1;
      }
    }
    land.set(next);
  }

  // One island: land the start can't walk to goes back to the sea.
  const start = Math.round(cy) * W + Math.round(cx);
  const seen = new Uint8Array(W * H);
  const queue = [start];
  seen[start] = 1;
  while (queue.length) {
    const i = queue.pop();
    const x = i % W;
    const y = (i - x) / W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (seen[j] || !land[j]) continue;
      seen[j] = 1;
      queue.push(j);
    }
  }

  let count = 0;
  city.tiles.forEach((t, i) => {
    if (land[i] && seen[i]) {
      t.terrain = 'grass';
      count++;
    } else {
      t.terrain = 'water';
      t.structure = null;
    }
  });
  city.systems.island = { seed: seed >>> 0 };
  return count;
}

// Is this land tile part of a beach? Beaches lie along some stretches of the coast (chosen by the
// island's seed), one tile deep and two where the stretch is at its widest.
export function beachAt(city, x, y) {
  const isl = city.systems?.island;
  if (!isl) return false;
  const t = city.getTile(x, y);
  if (!t || t.terrain !== 'grass') return false;
  const n = valueNoise((isl.seed ^ 0xbeac4) >>> 0, x, y, 5);
  if (n < 0.63) return false;
  const wet = (dx, dy) => city.getTile(x + dx, y + dy)?.terrain === 'water';
  if (wet(1, 0) || wet(-1, 0) || wet(0, 1) || wet(0, -1)) return true;
  if (n < 0.74) return false;
  if (wet(1, 1) || wet(-1, 1) || wet(1, -1) || wet(-1, -1)) return true;
  return wet(2, 0) || wet(-2, 0) || wet(0, 2) || wet(0, -2);
}
