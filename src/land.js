// Land: the kind of country a town stands on, Civ-style. The world around your town is laid out once
// from a seed (landAt), so every free site sits on a land type you can see before you settle there,
// and each type has pluses and minuses that change how the town plays:
//
//   River valley   farms make more food, riverside land is worth more   |  floods come more often
//   Coast          trade: businesses pay more tax                        |  storms and hurricanes are likelier and hit harder
//   Forest         timber: building costs less                           |  thick woods: the town grows slower
//   Plains         lots of open land: the town grows fastest             |  no river or pond, so no water views
//   Rocky uplands  no floods, and stone makes buildings sturdier         |  building costs more, the town grows slower
//
// A town's land is saved in city.systems.land = { type } when a settlement is founded. Towns without it
// (your first town, the computer's towns, every save from before this) play exactly as before:
// landEffects() gives them no effects at all. landOf() still names their land from what's on their map,
// for the world map's labels.
//
// Effects (all multipliers, 1 = unchanged), read straight from the town's saved land wherever they apply:
//   buildCost (economy costOf), businessTax (economy, via Simulation.applyNotables), growth (Growth.rate),
//   food (resources: food made), waterView (desirability: water views), disaster[kind] (chance of each
//   disaster), damage (how hard disasters hit buildings).

import { mulberry32 } from './utils.js';

export const LANDS = {
  river: {
    label: 'River valley',
    plus: 'Farms make 25% more food, and riverside land is worth more',
    minus: 'Floods come twice as often',
    fx: { food: 1.25, waterView: 1.5, disaster: { flood: 2 } },
  },
  coast: {
    label: 'Coast',
    plus: 'Trade by sea: businesses pay 15% more tax',
    minus: 'Storms and hurricanes come half as often again, and hit 20% harder',
    fx: { businessTax: 1.15, disaster: { storm: 1.5, hurricane: 1.5 }, damage: 1.2 },
  },
  forest: {
    label: 'Forest',
    plus: 'Timber close at hand: building costs 15% less',
    minus: 'Thick woods slow new building: the town grows 15% slower',
    fx: { buildCost: 0.85, growth: 0.85 },
  },
  plains: {
    label: 'Plains',
    plus: 'Wide open land: the town grows 20% faster',
    minus: 'No river or pond, so no water views',
    fx: { growth: 1.2 },
  },
  uplands: {
    label: 'Rocky uplands',
    plus: 'No floods, and stone buildings take 30% less damage',
    minus: 'Building costs 15% more, and the town grows 15% slower',
    fx: { buildCost: 1.15, growth: 0.85, damage: 0.7, disaster: { flood: 0, hurricane: 0 } },
  },
};
export const LAND_TYPES = Object.keys(LANDS);

const NONE = Object.freeze({ buildCost: 1, businessTax: 1, growth: 1, food: 1, waterView: 1, damage: 1, disaster: Object.freeze({}) });

// The effects a town's land has on it (none for a town without saved land).
export function landEffects(city) {
  const def = LANDS[city?.systems?.land?.type];
  if (!def) return NONE;
  return { ...NONE, ...def.fx, disaster: { ...(def.fx.disaster || {}) } };
}

// A disaster's chance multiplier for this town (1 when its land says nothing about that kind).
export function disasterOdds(city, kind) {
  return landEffects(city).disaster[kind] ?? 1;
}

// What land a town stands on: its saved land, or (for a town without one) read from its map.
export function landOf(city) {
  const saved = city?.systems?.land?.type;
  if (LANDS[saved]) return saved;
  const tiles = city?.tiles || [];
  const water = tiles.filter((t) => t.terrain === 'water').length;
  const trees = tiles.filter((t) => t.structure?.type === 'tree').length;
  if (water > tiles.length * 0.12) return 'coast';
  if (water > 0) return 'river';
  if (trees > tiles.length * 0.25) return 'forest';
  return 'plains';
}

// ---- The world's land ------------------------------------------------------------------------
// Smooth value noise over the world, in cells of CELL tiles: neighbouring places tend to share a land
// type, as real country does, and the same seed always gives the same map.
const CELL = 24;
const hash = (seed, x, y) => {
  let h = (seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};
const smooth = (t) => t * t * (3 - 2 * t);
function noise(seed, x, y) {
  const gx = Math.floor(x / CELL);
  const gy = Math.floor(y / CELL);
  const fx = smooth(x / CELL - gx);
  const fy = smooth(y / CELL - gy);
  const a = hash(seed, gx, gy);
  const b = hash(seed, gx + 1, gy);
  const c = hash(seed, gx, gy + 1);
  const d = hash(seed, gx + 1, gy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

// The land type at a world position (in world tiles, as the world's `at` positions are).
export function landAt(seed, x, y) {
  const wet = noise(seed ^ 0x9e3779b9, x, y); // low: dry country, high: water
  const wild = noise(seed ^ 0x85ebca6b, x + 1000, y - 1000); // low: open, high: wooded or rocky
  if (wet > 0.66) return wet > 0.8 ? 'coast' : 'river';
  if (wild > 0.62) return wet < 0.38 ? 'uplands' : 'forest';
  if (wild < 0.3 && wet < 0.45) return 'plains';
  return wet > 0.5 ? 'river' : wild > 0.5 ? 'forest' : 'plains';
}

// ---- Shaping a new town's ground to its land -------------------------------------------------
// After the usual crossroads start (generateSeed), so the start itself never changes: a coast gets the
// sea along its far edge, plains and uplands have no river or pond, a forest is thickly wooded.
export function shapeLand(city, type, seed = 1) {
  const rand = mulberry32((seed ^ 0x1a4d) >>> 0);
  const W = city.width;
  const H = city.height;
  const roads = city.tiles.filter((t) => t.structure?.type === 'road');
  const cx = roads.length ? roads.reduce((s, t) => s + t.x, 0) / roads.length : W / 2;
  const cy = roads.length ? roads.reduce((s, t) => s + t.y, 0) / roads.length : H / 2;
  const nearStart = (t) => Math.hypot(t.x - cx, t.y - cy) < 6;
  if (type === 'plains' || type === 'uplands') {
    for (const t of city.tiles) if (t.terrain === 'water') t.terrain = 'grass';
  }
  if (type === 'coast') {
    // The sea along the edge farthest from the town's start, with a ragged shore.
    const edges = [
      { d: cx, at: (t) => t.x },
      { d: W - 1 - cx, at: (t) => W - 1 - t.x },
      { d: cy, at: (t) => t.y },
      { d: H - 1 - cy, at: (t) => H - 1 - t.y },
    ];
    const edge = edges.reduce((a, b) => (b.d > a.d ? b : a));
    const depth = Math.max(3, Math.min(6, Math.floor(edge.d) - 7));
    for (const t of city.tiles) {
      if (nearStart(t)) continue;
      if (edge.at(t) < depth + (rand() < 0.35 ? 1 : 0)) {
        t.terrain = 'water';
        t.structure = null;
      }
    }
  }
  if (type === 'forest') {
    for (const t of city.tiles) {
      if (t.terrain !== 'grass' || t.structure || nearStart(t)) continue;
      if (rand() < 0.55) t.structure = city.createStructure('tree', rand);
    }
  }
  if (type === 'uplands') {
    // Scattered stands of hardy trees on the open ground.
    for (const t of city.tiles) {
      if (t.terrain !== 'grass' || t.structure || nearStart(t)) continue;
      if (rand() < 0.08) t.structure = city.createStructure('tree', rand);
    }
  }
  city.systems.land = { type };
  city.refreshAllRoadMasks();
  city.dirty = true;
}
