// Random Town: lays out a starter town in the middle of the map with countryside around it,
// using the same state API the player uses.

import { STRUCTURES } from './config.js';
import { DIRS } from './state.js';
import { mulberry32 } from './utils.js';
import { shapeIsland, beachAt } from './island.js';

// Empty land for building from scratch: a river, a pond and some woods, with open ground in the
// middle and nothing built.
//
// `island: true` (what a new game asks for) sets the same start on one large island instead: the sea on
// every side, a coast with bays and beaches (island.js), a lagoon inland, and no river cutting the land
// in two. Without it the map is laid out exactly as it always was.
export function generateLand(city, seed = (Math.random() * 2 ** 32) >>> 0, { island = false } = {}) {
  return generateTown(city, seed, { town: false, island });
}

export function generateTown(city, seed = (Math.random() * 2 ** 32) >>> 0, { town = true, island = false } = {}) {
  const rand = mulberry32(seed);
  const W = city.width;
  const H = city.height;
  const ri = (a, b) => a + Math.floor(rand() * (b - a + 1));
  city.reset();

  const tile = (x, y) => city.getTile(x, y);
  const place = (x, y, type) => {
    const t = tile(x, y);
    if (!t || (island && t.terrain === 'water')) return; // on an island nothing is built out to sea
    t.terrain = 'grass';
    t.structure = city.createStructure(type, rand);
  };
  const isEmpty = (x, y) => {
    const t = tile(x, y);
    return !!t && t.terrain === 'grass' && !t.structure;
  };

  // Town footprint: under half the map, centred, so there is room to grow.
  const cx = Math.floor(W / 2) + ri(-2, 2);
  const cy = Math.floor(H / 2) + ri(-2, 2);
  const half = Math.max(5, Math.floor(Math.min(W, H) * 0.23));
  const inTown = (x, y) => Math.abs(x - cx) <= half && Math.abs(y - cy) <= half;

  if (island) {
    delete city.systems.land;
    shapeIsland(city, seed, { cx, cy, core: town ? half + 1 : Math.max(5, half - 1) });
    // A small lagoon inland, well away from the start, for a water view that isn't the sea.
    if (W >= 24) {
      const dry = (x, y, r) => {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (tile(x + dx, y + dy)?.terrain !== 'grass') return false;
        return true;
      };
      for (let tries = 0; tries < 80; tries++) {
        const px = ri(4, W - 5);
        const py = ri(4, H - 5);
        if (Math.max(Math.abs(px - cx), Math.abs(py - cy)) < half + 3 || !dry(px, py, W >= 40 ? 3 : 2)) continue;
        const r = 1.2 + rand() * 0.7;
        for (const t of city.tiles) if (Math.hypot(t.x - px, t.y - py) + (rand() - 0.5) * 0.6 < r) t.terrain = 'water';
        break;
      }
    }
  } else {
    delete city.systems.island;
    layRiver();
  }
  // A river winds across one side of the map, and a pond lies on the far side.
  function layRiver() {
  const vertical = rand() < 0.5;
  const span = vertical ? W : H;
  let pos = rand() < 0.5 ? ri(2, Math.max(3, Math.floor(span * 0.18))) : span - 1 - ri(2, Math.max(3, Math.floor(span * 0.18)));
  for (let i = 0; i < (vertical ? H : W); i++) {
    const width = rand() < 0.3 ? 2 : 1;
    for (let k = 0; k < width; k++) {
      const t = vertical ? tile(pos + k, i) : tile(i, pos + k);
      if (t) t.terrain = 'water';
    }
    if (rand() < 0.35) pos = Math.max(1, Math.min(span - 3, pos + (rand() < 0.5 ? -1 : 1)));
  }
  // A pond on the far side, if it fits. On empty land the middle stays dry for building.
  if (W >= 20) {
    const px = vertical ? (pos < W / 2 ? W - 4 : 3) : ri(4, W - 5);
    const py = vertical ? ri(4, H - 5) : pos < H / 2 ? H - 4 : 3;
    const r = 1.5 + rand();
    for (const t of city.tiles) if (Math.hypot(t.x - px, t.y - py) + (rand() - 0.5) * 0.8 < r && !inTown(t.x, t.y)) t.terrain = 'water';
  }
  }
  // Beaches stay open sand: no woods on them.
  const sandy = (x, y) => island && beachAt(city, x, y);

  if (!town) {
    // Woods round the edges, a few lone trees, and clear ground in the middle to start on.
    const woods = Array.from({ length: Math.max(2, Math.round(W / 7)) }, () => ({ x: ri(0, W - 1), y: ri(0, H - 1), r: 1.5 + rand() * 3 }));
    for (const t of city.tiles) {
      if (!isEmpty(t.x, t.y)) continue;
      const fromMiddle = Math.max(Math.abs(t.x - cx), Math.abs(t.y - cy)) / Math.max(1, half);
      let p = fromMiddle < 1 ? 0.02 : 0.07;
      if (DIRS.some((d) => tile(t.x + d.dx, t.y + d.dy)?.terrain === 'water')) p += 0.2;
      for (const f of woods) if (fromMiddle >= 0.8 && Math.hypot(t.x - f.x, t.y - f.y) < f.r) p += 0.5;
      if (sandy(t.x, t.y)) p = 0;
      if (rand() < p) place(t.x, t.y, 'tree');
    }
    city.refreshAllRoadMasks();
    city.dirty = true;
    city.emit('reset', { seed, focus: { x: cx, y: cy, radius: half } });
    return;
  }

  // Streets: two avenues cross downtown and run to the map edge; a grid fills the town.
  for (let i = 0; i < W; i++) place(i, cy, 'road');
  for (let i = 0; i < H; i++) place(cx, i, 'road');
  const step = W >= 24 ? 5 : 4;
  for (let o = step; o <= half; o += step) {
    for (const s of [-1, 1]) {
      const ry = cy + s * o;
      const rx = cx + s * o;
      if (rand() < 0.85) for (let x = cx - half + ri(0, 2); x <= cx + half - ri(0, 2); x++) if (tile(x, ry)) place(x, ry, 'road');
      if (rand() < 0.85) for (let y = cy - half + ri(0, 2); y <= cy + half - ri(0, 2); y++) if (tile(rx, y)) place(rx, y, 'road');
    }
  }

  // Lots along streets. Downtown is dense and busy; the edges of town are leafy houses.
  const nearRoad = (x, y) => DIRS.some((d) => city.isRoad(x + d.dx, y + d.dy));
  const ring = (x, y) => Math.max(Math.abs(x - cx), Math.abs(y - cy));
  const lots = city.tiles.filter((t) => isEmpty(t.x, t.y) && nearRoad(t.x, t.y) && inTown(t.x, t.y));
  for (const t of lots) {
    const d = ring(t.x, t.y);
    const onAvenue = t.x === cx + 1 || t.x === cx - 1 || t.y === cy + 1 || t.y === cy - 1;
    const r = rand();
    if (d <= 3) {
      if (r < 0.28) place(t.x, t.y, 'tower');
      else if (r < 0.52) place(t.x, t.y, 'office');
      else if (r < 0.72) place(t.x, t.y, 'shop');
      else if (r < 0.82) place(t.x, t.y, 'cafe');
      else if (r < 0.92) place(t.x, t.y, 'apartments');
    } else if (d <= Math.max(4, half - 1)) {
      if (onAvenue && r < 0.2) place(t.x, t.y, 'shop');
      else if (onAvenue && r < 0.28) place(t.x, t.y, 'cafe');
      else if (r < 0.38) place(t.x, t.y, 'apartments');
      else if (r < 0.46) place(t.x, t.y, 'tower');
      else if (r < 0.52) place(t.x, t.y, 'office');
      else if (r < 0.92) place(t.x, t.y, 'house');
    } else if (r < (onAvenue ? 0.12 : 0.03)) place(t.x, t.y, 'shop');
    else if (r < 0.62) place(t.x, t.y, 'house');
    else if (r < 0.95) place(t.x, t.y, 'cottage');
  }

  // A mall downtown and a factory out on the edge of town, away from most homes.
  const downtown = lots.filter((t) => isEmpty(t.x, t.y) || ['shop', 'house'].includes(tile(t.x, t.y).structure?.type)).filter((t) => ring(t.x, t.y) <= 4);
  const mallSpot = downtown.sort(() => rand() - 0.5)[0];
  if (mallSpot) place(mallSpot.x, mallSpot.y, 'mall');
  const edge = lots.filter((t) => ring(t.x, t.y) >= half - 1 && (isEmpty(t.x, t.y) || tile(t.x, t.y).structure?.type === 'cottage'));
  const factorySpot = edge.sort(() => rand() - 0.5)[0];
  if (factorySpot) place(factorySpot.x, factorySpot.y, 'factory');

  // A school and a clinic on opposite sides of downtown.
  const serviceSpot = (sx, sy) => {
    const spots = lots
      .filter((t) => {
        const s = tile(t.x, t.y).structure?.type;
        return (!s || s === 'house') && ring(t.x, t.y) >= 3 && ring(t.x, t.y) <= 8 && Math.sign(t.x - cx) === sx && Math.sign(t.y - cy) === sy;
      })
      .sort(() => rand() - 0.5);
    return spots[0];
  };
  const corner = rand() < 0.5 ? 1 : -1;
  const school = serviceSpot(corner, corner);
  if (school) place(school.x, school.y, 'school');
  const clinic = serviceSpot(-corner, -corner);
  if (clinic) place(clinic.x, clinic.y, 'clinic');

  // Parks where people live.
  const homesAround = (x, y) => {
    let n = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const s = tile(x + dx, y + dy)?.structure;
      if (s && STRUCTURES[s.type].capacity > 0) n++;
    }
    return n;
  };
  const parkSpots = city.tiles
    .filter((t) => isEmpty(t.x, t.y) && inTown(t.x, t.y))
    .map((t) => ({ t, score: homesAround(t.x, t.y) + rand() * 3 }))
    .sort((a, b) => b.score - a.score);
  const parks = Math.max(2, Math.round((half * half) / 18));
  for (let i = 0; i < Math.min(parks, parkSpots.length); i++) place(parkSpots[i].t.x, parkSpots[i].t.y, 'park');
  // One playground among the homes.
  const play = parkSpots.slice(parks).find((s) => isEmpty(s.t.x, s.t.y) && nearRoad(s.t.x, s.t.y));
  if (play) place(play.t.x, play.t.y, 'playground');

  // Trees: scattered in town, thick woods in the countryside.
  const forests = Array.from({ length: Math.max(2, Math.round(W / 6)) }, () => ({ x: ri(0, W - 1), y: ri(0, H - 1), r: 2 + rand() * 4 }));
  for (const t of city.tiles) {
    if (!isEmpty(t.x, t.y)) continue;
    const byWater = DIRS.some((d) => tile(t.x + d.dx, t.y + d.dy)?.terrain === 'water');
    let p = inTown(t.x, t.y) ? 0.28 : 0.1;
    if (byWater) p += 0.25;
    for (const f of forests) if (Math.hypot(t.x - f.x, t.y - f.y) < f.r) p += 0.55;
    if (sandy(t.x, t.y)) p = 0;
    if (rand() < p) place(t.x, t.y, 'tree');
  }

  // Some people already live here.
  for (const h of city.homes()) {
    h.structure.residents = Math.floor(STRUCTURES[h.structure.type].capacity * (0.3 + rand() * 0.35));
  }

  city.refreshAllRoadMasks();
  city.dirty = true;
  city.emit('reset', { seed, focus: { x: cx, y: cy, radius: half } });
}

// A seed to grow from: open land with a little crossroads and a few cottages near the middle, so a
// town can grow by itself from almost nothing.
export function generateSeed(city, seed = (Math.random() * 2 ** 32) >>> 0, { island = false } = {}) {
  generateLand(city, seed, { island });
  const rand = mulberry32(seed ^ 0x5eed);
  const W = city.width;
  const H = city.height;
  const dry = (cx, cy, r) => {
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (city.getTile(x, y)?.terrain !== 'grass') return false;
    return true;
  };
  // The closest dry spot to the middle of the map.
  let cx = Math.floor(W / 2);
  let cy = Math.floor(H / 2);
  search: for (let r = 0; r < Math.min(W, H) / 2 - 5; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (dry(cx + dx, cy + dy, 4)) {
          cx += dx;
          cy += dy;
          break search;
        }
      }
    }
  }
  const place = (x, y, type) => {
    const t = city.getTile(x, y);
    if (!t || t.terrain !== 'grass') return;
    t.structure = city.createStructure(type, rand);
  };
  for (let y = cy - 4; y <= cy + 4; y++) for (let x = cx - 4; x <= cx + 4; x++) if (city.getTile(x, y)?.structure) city.getTile(x, y).structure = null;
  for (let d = -3; d <= 3; d++) {
    place(cx + d, cy, 'road');
    place(cx, cy + d, 'road');
  }
  place(cx - 1, cy - 1, 'cottage');
  place(cx + 1, cy - 1, 'cottage');
  place(cx - 1, cy + 1, 'house');
  place(cx + 2, cy + 1, 'cottage');
  place(cx + 1, cy + 2, 'tree');
  place(cx - 2, cy - 2, 'tree');
  city.refreshAllRoadMasks();
  city.dirty = true;
  return { x: cx, y: cy };
}
