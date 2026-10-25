// Run with: node --test tests/
// The 3D view's storybook look (src/view3d/storybook.js): every kind of tile builds clean geometry,
// streets keep the game's sidewalks, crossings and lamps (so people and cars stay on them), building
// heights reach the cameras, and building it never changes the town.
import test from 'node:test';
import assert from 'node:assert/strict';

const { CityState } = await import('../src/state.js');
const { generateTown } = await import('../src/generator.js');
const { Simulation } = await import('../src/simulation.js');
const { growthOf } = await import('../src/renderer.js');
const { STRUCTURES } = await import('../src/config.js');
const { crosswalkMask } = await import('../src/sidewalks.js');
const SB = await import('../src/view3d/storybook.js');

function town(seed = 4242) {
  const city = new CityState(32, 32);
  generateTown(city, seed);
  new Simulation(city).refresh();
  return city;
}

function clean(out) {
  for (const [name, m] of Object.entries(out.layers)) {
    const a = m.arrays();
    assert.equal(a.position.length, m.vertices * 3, `${name} positions`);
    assert.equal(a.normal.length, m.vertices * 3, `${name} normals`);
    assert.equal(a.color.length, m.vertices * 3, `${name} colours`);
    assert.equal(a.uv.length, m.vertices * 2, `${name} texture coordinates`);
    assert.equal(m.vertices % 3, 0, `${name} is whole triangles`);
    for (const k of ['position', 'normal', 'color', 'uv']) assert.ok(a[k].every(Number.isFinite), `${name} ${k} finite`);
  }
}

const all = { x0: 0, y0: 0, x1: 32, y1: 32 };

test('a whole town builds clean geometry with the storybook dressing', () => {
  const city = town();
  const out = SB.buildStorybook(city, all, { growthOf, STRUCTURES, crossMask: (x, y) => crosswalkMask(city, x, y), edges: true });
  clean(out);
  assert.ok(out.layers.roof.vertices > 0, 'shingled roofs');
  assert.ok(out.layers.plaster.vertices > 0, 'plaster walls');
  assert.ok(out.layers.leaf.vertices > 0, 'trees and bushes');
  assert.ok(out.layers.path.vertices > 0, 'cobbled streets');
  assert.ok(out.flowers.length > 100, 'flowers');
  for (const [x, y] of out.roads) assert.equal(city.getTile(x, y).structure.type, 'road');
  // Light enough for a tablet: well under a million vertices for a 32×32 town.
  const verts = Object.values(out.layers).reduce((n, m) => n + m.vertices, 0);
  assert.ok(verts < 800000, `${verts} vertices`);
});

test('every building type, facing every way, builds without errors and has a height', () => {
  const city = new CityState(12, 12);
  for (const type of Object.keys(STRUCTURES).filter((t) => t !== 'road')) {
    for (let r = 0; r < 4; r++) {
      for (const t of city.tiles) t.structure = null;
      const [dx, dy] = [[0, 1], [1, 0], [0, -1], [-1, 0]][r];
      city.getTile(5 + dx, 5 + dy).structure = { type: 'road' };
      city.getTile(5, 5).structure = { type, variant: 'blush', floors: 4, shape: r, residents: 2, id: 1 };
      const out = SB.buildStorybook(city, { x0: 3, y0: 3, x1: 8, y1: 8 }, { growthOf, STRUCTURES });
      clean(out);
      assert.equal(SB.frontOf(city.getTile(5, 5), city), r, `${type} faces its road`);
      const walk = STRUCTURES[type].walkable || type === 'tree' || type === 'park';
      const top = out.tops.find(([i]) => i === 5 * 12 + 5);
      if (!walk && SB.STORY_TYPES.includes(type)) assert.ok(top && top[1] > 0.1, `${type} stands up`);
    }
  }
});

test('streets keep the game layout: sidewalks only on unconnected sides, lamps and crossings where the game has them', () => {
  const city = new CityState(6, 6);
  for (let x = 0; x < 6; x++) city.getTile(x, 2).structure = { type: 'road' };
  const t = city.getTile(2, 2);
  t.roadMask = 2 | 8; // east and west: an east–west street
  const out = SB.buildStorybook(city, { x0: 2, y0: 2, x1: 3, y1: 3 }, { lamp: (tt) => (tt === t ? { gx: 2.5, gy: 2.08 } : null), crossMask: () => 2 });
  clean(out);
  // Sidewalk stones run along the north and south edges and never across the carriageway.
  const P = out.layers.stone.p;
  let north = 0;
  let south = 0;
  for (let i = 0; i < P.length; i += 3) {
    const z = P[i + 2];
    if (P[i + 1] < 0.02 && P[i + 1] > 0.01) continue; // crossing bands sit on the cobbles
    if (z <= 2 + 0.15 + 1e-6) north++;
    else if (z >= 3 - 0.15 - 1e-6) south++;
    else if (P[i + 1] > 0.02) assert.fail(`sidewalk in the middle of the street at z=${z}`);
  }
  assert.ok(north > 0 && south > 0, 'both sidewalks');
  assert.deepEqual(out.lamps.map((l) => [l.x, l.z]), [[2.5, 2.08]]);
  assert.ok(out.layers.glow.vertices > 0, 'a lit lantern');
});

test('building heights reach the camera rules, gardens are not counted as buildings', () => {
  const city = town();
  const out = SB.buildStorybook(city, all, { growthOf, STRUCTURES });
  const tall = new Map(out.tops);
  for (const t of city.tiles) {
    const type = t.structure?.type;
    if (type === 'tower') assert.ok(tall.get(t.y * 32 + t.x) > 0.5, 'towers are tall');
    if (type === 'tree' || type === 'road' || !type) assert.ok(!tall.has(t.y * 32 + t.x), `no height for ${type || 'lawn'}`);
  }
  for (const [, , w, d] of out.feet) assert.ok(w <= 0.75 && d <= 0.7, 'footprints stay on their lot');
});

test('winter lights the chimneys; the map edge gets earthy sides', () => {
  const city = town();
  const warm = SB.buildStorybook(city, all, { growthOf, STRUCTURES });
  const cold = SB.buildStorybook(city, all, { growthOf, STRUCTURES, winter: true, edges: true });
  assert.equal(warm.smoke.length, 0);
  assert.ok(cold.smoke.length > 10);
  assert.ok(cold.layers.dirt.p.some((v, i) => i % 3 === 1 && v < -0.5), 'sides reach down');
});

test('building the look leaves the town untouched and comes out the same every time', () => {
  const city = town();
  const before = JSON.stringify(city.toJSON());
  const a = SB.buildStorybook(city, all, { growthOf, STRUCTURES });
  assert.equal(JSON.stringify(city.toJSON()), before);
  const b = SB.buildStorybook(town(), all, { growthOf, STRUCTURES });
  assert.deepEqual(a.layers.roof.p, b.layers.roof.p);
  assert.deepEqual(a.flowers, b.flowers);
});
