// Run with: node --test tests/
// People walk on sidewalks, cross streets at the kerb-to-kerb crossings, cut through parks, and never
// walk through a building or down the middle of a road.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CityState } from '../src/state.js';
import { generateTown } from '../src/generator.js';
import { Simulation } from '../src/simulation.js';
import { SidewalkNetwork, SIDEWALK, footArms, crosswalkMask } from '../src/sidewalks.js';
import { AgentSystem } from '../src/agents.js';
import { STRUCTURES } from '../src/config.js';
import { mulberry32 } from '../src/utils.js';

function town(size, seed) {
  const city = new CityState(size, size);
  generateTown(city, seed);
  const sim = new Simulation(city);
  sim.refresh();
  return { city, sim };
}

const isBuilding = (t) => !!t.structure && t.structure.type !== 'road' && !STRUCTURES[t.structure.type].walkable;
const tileAt = (city, x, y) => city.getTile(Math.floor(x), Math.floor(y));
const onSidewalk = (x, y) => {
  const fx = x - Math.floor(x);
  const fy = y - Math.floor(y);
  return Math.min(fx, 1 - fx) <= SIDEWALK + 1e-9 || Math.min(fy, 1 - fy) <= SIDEWALK + 1e-9;
};

// Every point along a route (sampled finely) is on a sidewalk, open ground, or the two buildings it
// joins; stretches across a road are flagged as crossings and run between two corners of one tile.
function checkRoute(city, route, from, to, label) {
  const pts = route.points;
  assert.ok(pts.length >= 2, `${label}: has points`);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    for (let s = 0; s <= 10; s++) {
      const x = a.x + ((b.x - a.x) * s) / 10;
      const y = a.y + ((b.y - a.y) * s) / 10;
      const t = tileAt(city, x, y);
      assert.ok(t && t.terrain === 'grass', `${label}: on land at ${x.toFixed(2)},${y.toFixed(2)}`);
      const endTile = (t.x === from.x && t.y === from.y) || (t.x === to.x && t.y === to.y);
      if (isBuilding(t)) assert.ok(endTile, `${label}: walks through the ${t.structure.type} at ${t.x},${t.y}`);
      if (t.structure?.type === 'road' && !route.crossings[i - 1]) assert.ok(onSidewalk(x, y), `${label}: off the sidewalk at ${x.toFixed(2)},${y.toFixed(2)}`);
    }
    if (route.crossings[i - 1]) {
      assert.equal(a.k, b.k, `${label}: a crossing stays within one road tile`);
      const t = city.tiles[a.k];
      assert.equal(t.structure.type, 'road');
      // The side crossed must be one where the road carries on.
      const tx = t.x + 0.5;
      const ty = t.y + 0.5;
      const mx = (a.x + b.x) / 2 - tx;
      const my = (a.y + b.y) / 2 - ty;
      const side = Math.abs(mx) > Math.abs(my) ? (mx > 0 ? 2 : 8) : my > 0 ? 4 : 1;
      assert.ok(footArms(city, t) & side, `${label}: crossing a side with no road`);
    }
  }
}

test('routes between buildings stay on sidewalks, crossings and open ground', () => {
  for (const [size, seed] of [
    [32, 1],
    [32, 2],
    [48, 3],
  ]) {
    const { city } = town(size, seed);
    const net = new SidewalkNetwork(city);
    const rng = mulberry32(seed);
    const buildings = city.tiles.filter(isBuilding);
    let found = 0;
    for (let n = 0; n < 150; n++) {
      const a = buildings[Math.floor(rng() * buildings.length)];
      const b = buildings[Math.floor(rng() * buildings.length)];
      if (a === b) continue;
      const route = net.route(a, b, 40);
      if (!route) continue;
      found++;
      checkRoute(city, route, a, b, `${size}/${seed} ${a.x},${a.y}→${b.x},${b.y}`);
    }
    assert.ok(found > 60, `${size}/${seed}: most buildings can reach each other on foot (${found})`);
  }
});

test('zebra crossings are where people cross, and junctions have them on every arm', () => {
  const { city } = town(48, 3);
  const net = new SidewalkNetwork(city);
  let junctions = 0;
  for (const t of city.tiles) {
    const arms = footArms(city, t);
    if ([1, 2, 4, 8].filter((b) => arms & b).length >= 3) {
      junctions++;
      assert.equal(crosswalkMask(city, t.x, t.y), arms);
    }
  }
  assert.ok(junctions > 3);
  // Over many trips, most street crossings use a zebra crossing.
  const rng = mulberry32(7);
  const buildings = city.tiles.filter(isBuilding);
  let marked = 0;
  let total = 0;
  for (let n = 0; n < 200; n++) {
    const a = buildings[Math.floor(rng() * buildings.length)];
    const b = buildings[Math.floor(rng() * buildings.length)];
    const route = a !== b && net.route(a, b, 40);
    if (!route) continue;
    route.crossings.forEach((c, i) => {
      if (!c) return;
      total++;
      const p = route.points[i];
      const q = route.points[i + 1];
      const t = city.tiles[p.k];
      const mx = (p.x + q.x) / 2 - (t.x + 0.5);
      const my = (p.y + q.y) / 2 - (t.y + 0.5);
      const side = Math.abs(mx) > Math.abs(my) ? (mx > 0 ? 2 : 8) : my > 0 ? 4 : 1;
      if (crosswalkMask(city, t.x, t.y) & side) marked++;
    });
  }
  assert.ok(total > 20, `people cross streets (${total})`);
  assert.ok(marked / total > 0.75, `most crossings are on a zebra crossing (${marked}/${total})`);
});

test('the network follows the map: new buildings block it, bulldozing opens it', () => {
  const { city } = town(32, 1);
  const net = new SidewalkNetwork(city);
  net.refresh();
  const v = net.version;
  net.refresh();
  assert.equal(net.version, v, 'not rebuilt when nothing changed');
  // Fill an open tile next to a road with a house: nothing may walk through it any more.
  const open = city.tiles.find((t) => t.terrain === 'grass' && !t.structure && city.accessRoad(t.x, t.y));
  city.apply('house', open.x, open.y);
  net.refresh();
  assert.equal(net.version, v + 1);
  assert.equal(net.kind[open.y * city.width + open.x], 3);
  // A washed-out road can't be walked.
  const road = city.tiles.find((t) => t.structure?.type === 'road');
  road.structure.broken = true;
  city.refreshAllRoadMasks();
  net.refresh();
  assert.equal(net.kind[road.y * city.width + road.x], 0);
  assert.equal(net.walkable(road.y * city.width + road.x), false);
});

test('walkers keep to the network for a whole day and never change the town', () => {
  const { city, sim } = town(32, 2);
  const before = JSON.stringify(city.toJSON());
  const agents = new AgentSystem(city);
  const real = Math.random;
  const rng = mulberry32(11);
  Math.random = rng;
  let seen = 0;
  try {
    for (let step = 0; step < 6000; step++) {
      city.clock = (0.25 + step / 8000) % 1;
      agents.update(0.1, 1);
      for (const w of agents.walkers) {
        if (w.alpha <= 0.05) continue;
        seen++;
        const t = tileAt(city, w.gx, w.gy);
        assert.ok(t && t.terrain === 'grass', `walker on land at ${w.gx},${w.gy}`);
        if (isBuilding(t)) {
          const ends = [w.pts[0], w.pts[w.pts.length - 1]].map((p) => p.k);
          assert.ok(ends.includes(t.y * city.width + t.x), `walker inside a ${t.structure.type} that isn't their start or end`);
        }
      }
    }
  } finally {
    Math.random = real;
  }
  city.clock = JSON.parse(before).clock; // the test moved the clock itself
  assert.ok(seen > 1000, `people were out walking (${seen})`);
  assert.equal(JSON.stringify(city.toJSON()), before, 'walkers only read the town');
  assert.ok(sim);
});
