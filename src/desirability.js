// Desirability: how much people want to live on a tile. Each factor is an independent, pluggable function.
// To add a system later (services, jobs, pollution…), implement its `compute` and flip `enabled`.
//
// Factors marked `layout` depend only on the map layout around the tile (terrain, building types and
// usable roads, within `reach` tiles). Their values are cached per tile and only recomputed near tiles
// whose layout changed, which is checked on every recompute, so a change is never missed whatever made
// it. The results are exactly what computing every factor afresh would give.

import { STRUCTURES, SERVICES, REPUTATION } from './config.js';
import { clamp } from './utils.js';

const BASE = 0.28;

function sumAround(city, tile, radius, valueOf) {
  let sum = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (!dx && !dy) continue;
      const n = city.getTile(tile.x + dx, tile.y + dy);
      if (!n) continue;
      const dist = Math.hypot(dx, dy);
      if (dist > radius + 0.5) continue;
      sum += valueOf(n) * (1 - dist / (radius + 1.5));
    }
  }
  return sum;
}

export const FACTORS = [
  {
    id: 'greenery',
    label: 'Parks & trees',
    enabled: true,
    layout: true,
    reach: 3,
    compute: (city, tile) =>
      Math.min(0.35, sumAround(city, tile, 3, (n) => (n.structure ? STRUCTURES[n.structure.type].greenery * 0.06 : 0))),
  },
  {
    id: 'waterfront',
    label: 'Water views',
    enabled: true,
    layout: true,
    reach: 2,
    compute: (city, tile) => Math.min(0.08, sumAround(city, tile, 2, (n) => (n.terrain === 'water' ? 0.04 : 0))),
  },
  {
    id: 'access',
    label: 'Road access',
    enabled: true,
    layout: true,
    reach: 2,
    compute: (city, tile) => {
      let best = 9;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (city.isRoad(tile.x + dx, tile.y + dy)) best = Math.min(best, Math.abs(dx) + Math.abs(dy));
        }
      }
      return best <= 1 ? 0.1 : best <= 2 ? 0.04 : -0.08;
    },
  },
  {
    id: 'services',
    label: 'Schools & clinics',
    enabled: true,
    compute: (city, tile) => {
      let sum = 0;
      for (const s of SERVICES) sum += tile.coverage[s.id] || 0;
      return 0.16 * (sum / SERVICES.length);
    },
  },
  {
    id: 'employment',
    label: 'Jobs',
    enabled: true,
    // Homes rate their own residents' job prospects; empty lots rate jobs within reach.
    compute: (city, tile) => {
      if (tile.structure && STRUCTURES[tile.structure.type].capacity > 0 && tile.structure.residents > 0) {
        return 0.16 * tile.employment;
      }
      const jobs = city.derived.labor;
      if (!jobs || !jobs.jobs) return 0;
      return 0.16 * Math.min(1, (jobs.jobs - jobs.employed) / Math.max(4, jobs.employed * 0.15));
    },
  },
  {
    id: 'traffic',
    label: 'Traffic',
    enabled: true,
    compute: (city, tile) => {
      let worst = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const n = city.getTile(tile.x + dx, tile.y + dy);
          if (!n || !n.roadMask) continue;
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          worst = Math.max(worst, n.congestion * (1 - d / 3));
        }
      }
      return -0.14 * worst;
    },
  },
  {
    id: 'pollution',
    label: 'Factory smoke',
    enabled: true,
    layout: true,
    reach: 4,
    // Homes near a factory are less pleasant; the effect fades over about five tiles.
    compute: (city, tile) => {
      let worst = 0;
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const n = city.getTile(tile.x + dx, tile.y + dy);
          if (!n?.structure || !STRUCTURES[n.structure.type].pollution) continue;
          worst = Math.max(worst, 1 - Math.hypot(dx, dy) / 5.5);
        }
      }
      return -0.18 * worst;
    },
  },
  { id: 'safety', label: 'Safety', enabled: false, compute: () => 0 },
  {
    id: 'culture',
    label: 'Artist nearby',
    enabled: true,
    // A Great Artist makes their street more appealing.
    compute: (city, tile) => {
      let best = 0;
      for (const a of city.derived.notableEffects?.artists || []) {
        const d = Math.hypot(a.x - tile.x, a.y - tile.y);
        if (d <= 3.5) best = Math.max(best, 1 - d / 4.5);
      }
      return 0.08 * best;
    },
  },
  {
    id: 'spirit',
    label: 'Town spirit',
    enabled: true,
    // Town decisions lift or dent how everyone feels about living here, for a while.
    compute: (city) => city.derived.spirit || 0,
  },
  {
    id: 'reputation',
    label: 'Town reputation',
    enabled: true,
    // A well-thought-of town draws people; a run-down name puts them off.
    compute: (city) => ((city.derived.reputation?.value ?? 0.5) - 0.5) * REPUTATION.homeAppeal,
  },
  { id: 'overcrowding', label: 'Overcrowding', enabled: false, compute: () => 0 },
  { id: 'walkability', label: 'Walkability', enabled: false, compute: () => 0 },
  { id: 'utilities', label: 'Utilities', enabled: false, compute: () => 0 },
  {
    id: 'upgrades',
    label: 'Town upgrades',
    enabled: true,
    // Festivals and Civic pride (skills.js) lift every home a little.
    compute: (city) => city.derived.skills?.happy || 0,
  },
  {
    id: 'entertainment',
    label: 'Playgrounds & sport',
    enabled: true,
    compute: (city, tile) => 0.1 * (tile.coverage?.fun || 0),
  },
];

// ---- Layout cache ---------------------------------------------------------------------------

const ACTIVE = FACTORS.filter((f) => f.enabled);
// Factors the town's upgrades make count for more or less (skills.js), by the same name.
const SCALED = new Set(['greenery', 'traffic', 'pollution', 'entertainment']);
const LAYOUT = ACTIVE.filter((f) => f.layout);
const REACH = Math.max(...LAYOUT.map((f) => f.reach));
const TYPE_CODE = Object.fromEntries(Object.keys(STRUCTURES).map((type, i) => [type, i + 1]));

// Everything a layout factor can see of a tile, packed into one number: water, building type, and
// whether a road is washed out or snowed in (those aren't usable roads).
function layoutCode(t) {
  const s = t.structure;
  if (!s) return t.terrain === 'water' ? 1 : 0;
  return (t.terrain === 'water' ? 1 : 0) | (TYPE_CODE[s.type] << 1) | (s.broken ? 1 << 10 : 0) | (s.snowed ? 1 << 11 : 0);
}

const caches = new WeakMap(); // city → { w, h, codes, valid, values }

// The layout cache, brought up to date: any tile whose layout changed since the last call makes the
// cached factors of every tile within reach of it stale.
function layoutCache(city) {
  const W = city.width;
  const H = city.height;
  const n = W * H;
  let c = caches.get(city);
  if (!c || c.w !== W || c.h !== H) {
    c = { w: W, h: H, codes: new Int32Array(n).fill(-1), valid: new Uint8Array(n), values: LAYOUT.map(() => new Float64Array(n)) };
    caches.set(city, c);
  }
  const { codes, valid } = c;
  for (let i = 0; i < n; i++) {
    const code = layoutCode(city.tiles[i]);
    if (code === codes[i]) continue;
    codes[i] = code;
    const x = i % W;
    const y = (i - x) / W;
    for (let yy = Math.max(0, y - REACH); yy <= Math.min(H - 1, y + REACH); yy++) {
      for (let xx = Math.max(0, x - REACH); xx <= Math.min(W - 1, x + REACH); xx++) valid[yy * W + xx] = 0;
    }
  }
  return c;
}

export function recomputeDesirability(city) {
  const cache = layoutCache(city);
  const { valid, values } = cache;
  const tiles = city.tiles;
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    if (!valid[i]) {
      for (let k = 0; k < LAYOUT.length; k++) values[k][i] = LAYOUT[k].compute(city, tile);
      valid[i] = 1;
    }
    // Same factors, same order, same sum as computing each one afresh. The object is reused.
    let d = BASE;
    const factors = tile.factors || (tile.factors = {});
    let k = 0;
    const sk = city.derived.skills;
    for (const f of ACTIVE) {
      let v = f.layout ? values[k++][i] : f.compute(city, tile);
      if (sk && SCALED.has(f.id)) v *= sk[f.id];
      factors[f.id] = v;
      d += v;
    }
    tile.desirability = clamp(d, 0, 1);
  }
  city.dirty = false;
}
