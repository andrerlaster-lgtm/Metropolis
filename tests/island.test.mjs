// A new town stands on one large island (generator.js with { island: true }, island.js): the sea on
// every side, one connected piece of land with room round the start, beaches along parts of the
// coast, and water that stops ordinary building. Maps made without the option are laid out as before.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CityState } from '../src/state.js';
import { STRUCTURES, TOOLS } from '../src/config.js';
import { generateLand, generateSeed, generateTown } from '../src/generator.js';
import { beachAt, seaMargin } from '../src/island.js';

const SIZES = [16, 32, 48];
const SEEDS = [1, 7, 42, 2024, 99991, 0xdecaf];
const STARTS = { seed: generateSeed, land: generateLand, town: generateTown };

const island = (size, seed, start = 'seed') => {
  const city = new CityState(size, size);
  const at = STARTS[start](city, seed, { island: true });
  return { city, at };
};
const isLand = (t) => t.terrain === 'grass';

// Every land tile you can walk to from (x, y) without crossing water.
function reachable(city, x, y) {
  const seen = new Set([`${x},${y}`]);
  const queue = [[x, y]];
  while (queue.length) {
    const [cx, cy] = queue.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const t = city.getTile(cx + dx, cy + dy);
      if (!t || !isLand(t) || seen.has(`${t.x},${t.y}`)) continue;
      seen.add(`${t.x},${t.y}`);
      queue.push([t.x, t.y]);
    }
  }
  return seen;
}

test('an island has the sea on all four sides', () => {
  for (const size of SIZES) {
    for (const seed of SEEDS) {
      for (const start of Object.keys(STARTS)) {
        const { city } = island(size, seed, start);
        const ring = seaMargin(size);
        for (const t of city.tiles) {
          const edge = Math.min(t.x, t.y, size - 1 - t.x, size - 1 - t.y);
          if (edge < ring) assert.equal(t.terrain, 'water', `${start} ${size}/${seed}: sea at ${t.x},${t.y}`);
        }
        assert.ok(!city.tiles.some((t) => t.terrain === 'water' && t.structure), `${start} ${size}/${seed}: nothing stands in the water`);
      }
    }
  }
});

test('the island is one piece of land, and a good half of the map', () => {
  for (const size of SIZES) {
    for (const seed of SEEDS) {
      const { city, at } = island(size, seed);
      const land = city.tiles.filter(isLand);
      const share = land.length / city.tiles.length;
      assert.ok(share > 0.42 && share < 0.75, `${size}/${seed}: land is ${Math.round(share * 100)}% of the map`);
      assert.equal(reachable(city, at.x, at.y).size, land.length, `${size}/${seed}: every bit of land joins the start`);
    }
  }
});

test('the starting town has connected, buildable land to grow into', () => {
  for (const size of SIZES) {
    for (const seed of SEEDS) {
      const { city, at } = island(size, seed);
      assert.ok(city.tiles.some((t) => t.structure?.type === 'road'), `${size}/${seed}: the crossroads is there`);
      assert.ok(city.homes().length >= 3, `${size}/${seed}: and its first homes`);
      // Dry ground all round the crossroads…
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) assert.equal(city.getTile(at.x + dx, at.y + dy).terrain, 'grass', `${size}/${seed}: dry at ${dx},${dy} from the start`);
      // …and open land joined to it that roads and buildings can go on: at least a third of the map.
      const open = [...reachable(city, at.x, at.y)].map((k) => city.getTile(...k.split(',').map(Number))).filter((t) => !t.structure || t.structure.type === 'tree');
      assert.ok(open.length >= size * size * 0.33, `${size}/${seed}: ${open.length} open tiles to build on`);
      assert.ok(open.every((t) => city.canApply('road', t.x, t.y) || t.structure), `${size}/${seed}: a road can go on any open tile`);
    }
  }
});

test('a starter town on an island keeps its streets and homes on dry land', () => {
  for (const size of [32, 48]) {
    for (const seed of SEEDS) {
      const { city } = island(size, seed, 'town');
      assert.ok(city.homes().length >= 20, `${size}/${seed}: ${city.homes().length} homes`);
      assert.ok(city.workplaces().length >= 5, `${size}/${seed}: places to work`);
      assert.ok(city.homes().every((h) => city.accessRoad(h.x, h.y)), `${size}/${seed}: every home is on a street`);
    }
  }
});

test('the same seed gives the same island; different seeds give different coasts', () => {
  const shape = (seed) => island(32, seed).city.tiles.map((t) => (isLand(t) ? '#' : '~')).join('');
  assert.equal(shape(5), shape(5));
  assert.notEqual(shape(5), shape(6));
});

test('the coast has beaches: sand by the sea, and only on islands', () => {
  let withBeach = 0;
  for (const seed of SEEDS) {
    const { city } = island(32, seed);
    const beach = city.tiles.filter((t) => beachAt(city, t.x, t.y));
    if (beach.length) withBeach++;
    for (const t of beach) {
      assert.equal(t.terrain, 'grass', 'a beach is land');
      let nearSea = false;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (city.getTile(t.x + dx, t.y + dy)?.terrain === 'water') nearSea = true;
      assert.ok(nearSea, `${seed}: the beach at ${t.x},${t.y} is by the water`);
      assert.notEqual(t.structure?.type, 'tree', 'no woods on the sand');
      assert.ok(city.canApply('road', t.x, t.y), 'sand is ordinary land: you can build on it');
    }
    assert.ok(beach.length < city.tiles.filter(isLand).length * 0.25, `${seed}: beaches are stretches of the coast, not all of it`);
  }
  assert.ok(withBeach >= SEEDS.length - 1, 'nearly every island has a beach');
  const plain = new CityState(32, 32);
  generateTown(plain, 7);
  assert.ok(!plain.tiles.some((t) => beachAt(plain, t.x, t.y)), 'a map that is not an island has none');
});

test('water blocks ordinary building: no road or building can be placed on it', () => {
  const { city } = island(32, 7);
  const sea = city.getTile(0, 0);
  const shoreWater = city.tiles.find((t) => t.terrain === 'water' && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => city.getTile(t.x + dx, t.y + dy)?.structure?.type === 'road' || city.getTile(t.x + dx, t.y + dy)?.terrain === 'grass'));
  for (const t of [sea, shoreWater]) {
    for (const type of Object.keys(STRUCTURES)) {
      assert.equal(city.canApply(type, t.x, t.y), false, `${type} can't be placed on water`);
      assert.equal(city.apply(type, t.x, t.y), false, `${type} is not built on water`);
      assert.equal(city.placeError(type, t.x, t.y), "Can't build on water");
    }
    assert.equal(t.terrain, 'water');
    assert.equal(t.structure, null);
  }
  // Every building tool in the menu is covered by that rule.
  for (const tool of TOOLS) if (STRUCTURES[tool.id]) assert.equal(city.canApply(tool.id, sea.x, sea.y), false, tool.id);
  // A stroke that runs off the shore builds on the land and skips the water.
  const row = city.tiles.filter((t) => t.y === 16);
  const before = row.filter((t) => t.structure?.type === 'road').length;
  const built = city.applyMany('road', row.map((t) => ({ x: t.x, y: t.y })));
  assert.ok(built > 0);
  assert.ok(row.every((t) => (t.terrain === 'water' ? !t.structure : t.structure)), 'road on the land, none in the sea');
  assert.equal(row.filter((t) => t.structure?.type === 'road').length, before + built);
});

test('the Water tool and the bulldozer still reshape the shore, as before', () => {
  const { city, at } = island(32, 7);
  assert.equal(city.apply('water', at.x + 4, at.y + 4), true);
  assert.equal(city.getTile(at.x + 4, at.y + 4).terrain, 'water');
  assert.equal(city.apply('house', at.x + 4, at.y + 4), false, 'and that new water blocks building too');
  assert.equal(city.apply('bulldoze', at.x + 4, at.y + 4), true);
  assert.equal(city.getTile(at.x + 4, at.y + 4).terrain, 'grass');
});

test('maps made without the island option are unchanged, and an island survives saving', () => {
  const plain = new CityState(32, 32);
  generateTown(plain, 7);
  assert.equal(plain.systems.island, undefined);
  assert.ok(plain.tiles.some((t) => t.terrain === 'grass' && (t.x === 0 || t.y === 0)), 'land still runs to the edge of the map');
  const { city } = island(32, 7);
  const back = CityState.fromJSON(JSON.parse(JSON.stringify(city.toJSON())));
  assert.deepEqual(back.systems.island, city.systems.island);
  assert.deepEqual(back.tiles.map((t) => t.terrain), city.tiles.map((t) => t.terrain));
  assert.deepEqual(back.tiles.map((t) => beachAt(back, t.x, t.y)), city.tiles.map((t) => beachAt(city, t.x, t.y)));
});
