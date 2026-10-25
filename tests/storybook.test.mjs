// Run with: node --test tests/
// Storybook visual sample (src/view3d/storybook.js): the area it shows, that every kind of tile builds
// clean geometry, and that it only reads the town.
import test from 'node:test';
import assert from 'node:assert/strict';

const { CityState } = await import('../src/state.js');
const { generateTown } = await import('../src/generator.js');
const { Simulation } = await import('../src/simulation.js');
const { growthOf } = await import('../src/renderer.js');
const { STRUCTURES } = await import('../src/config.js');
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

test('the sample centres on Poppy Row when the town has it, else your home, else the town centre', () => {
  const city = town();
  const run = city.derived.streets.find((r) => r.tiles.length >= 4);
  for (const t of run.tiles) t.street = 'Poppy Row';
  const c = SB.pickCentre(city);
  assert.equal(c.why, 'Poppy Row');
  const mx = run.tiles.reduce((s, t) => s + t.x, 0) / run.tiles.length + 0.5;
  assert.ok(Math.abs(c.x - mx) < 1e-9);
  for (const t of run.tiles) t.street = 'Elm Street';
  city.systems.life = { char: { home: { x: 5, y: 6 } } };
  assert.deepEqual(SB.pickCentre(city), { x: 5.5, y: 6.5, why: 'home' });
  delete city.systems.life;
  assert.equal(SB.pickCentre(city).why, 'centre');
});

test('the area is a square of tiles kept inside the map', () => {
  const city = town();
  for (const [x, y] of [[0, 0], [31, 31], [16, 16], [2, 30]]) {
    const a = SB.areaAround(city, x, y, 8);
    assert.equal(a.x1 - a.x0, 16);
    assert.equal(a.y1 - a.y0, 16);
    assert.ok(a.x0 >= 0 && a.y0 >= 0 && a.x1 <= 32 && a.y1 <= 32);
  }
});

test('a real town builds clean geometry with the storybook dressing', () => {
  const city = town();
  const area = SB.areaAround(city, 16, 16, 8);
  const out = SB.buildStorybook(city, area, { growthOf });
  SB.surroundings(out, area);
  clean(out);
  assert.ok(out.layers.roof.vertices > 0 || out.layers.thatch.vertices > 0, 'roofs');
  assert.ok(out.layers.plaster.vertices > 0, 'walls');
  assert.ok(out.layers.leaf.vertices > 0, 'trees and bushes');
  assert.ok(out.flowers.length > 100, 'flowers');
  assert.ok(out.roads.length > 0, 'lanes for the villagers');
  for (const [x, y] of out.roads) assert.equal(city.getTile(x, y).structure.type, 'road');
  // Under half a million vertices for the sample, so iPads keep up.
  const verts = Object.values(out.layers).reduce((n, m) => n + m.vertices, 0);
  assert.ok(verts < 500000, `${verts} vertices`);
});

test('every building type, facing every way, builds without errors', () => {
  const city = new CityState(12, 12);
  const types = Object.keys(STRUCTURES).filter((t) => t !== 'road');
  for (const type of types) {
    for (let r = 0; r < 4; r++) {
      for (const t of city.tiles) t.structure = null;
      const [dx, dy] = [[0, 1], [1, 0], [0, -1], [-1, 0]][r];
      city.getTile(5 + dx, 5 + dy).structure = { type: 'road' };
      city.getTile(5, 5).structure = { type, variant: 'blush', floors: 4, shape: r, residents: 2, id: 1 };
      const out = SB.buildStorybook(city, { x0: 3, y0: 3, x1: 8, y1: 8 }, { growthOf });
      clean(out);
      assert.equal(SB.frontOf(city.getTile(5, 5), city), r, `${type} faces its road`);
    }
  }
});

test('building the sample leaves the town untouched', () => {
  const city = town();
  const before = JSON.stringify(city.toJSON());
  const out = SB.buildStorybook(city, SB.areaAround(city, 16, 16, 8), { growthOf });
  SB.surroundings(out, SB.areaAround(city, 16, 16, 8));
  assert.equal(JSON.stringify(city.toJSON()), before);
});

test('the same town builds the same village every time', () => {
  const a = SB.buildStorybook(town(), { x0: 8, y0: 8, x1: 24, y1: 24 }, { growthOf });
  const b = SB.buildStorybook(town(), { x0: 8, y0: 8, x1: 24, y1: 24 }, { growthOf });
  assert.deepEqual(a.layers.roof.p, b.layers.roof.p);
  assert.deepEqual(a.flowers, b.flowers);
});
