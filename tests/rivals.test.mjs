// Run with: node --test tests/
// Rival cities on or off (the start menu's choice): off means no computer-run towns, raids or diplomacy, and
// nothing breaks; on again brings the same rival back. Saved with the town; older saves keep their rival.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { CityState } = await import('../src/state.js');
const { generateTown } = await import('../src/generator.js');
const { Simulation } = await import('../src/simulation.js');
const { World } = await import('../src/world.js');
const { WarRoom } = await import('../src/warRoom.js');
const { Mayor } = await import('../src/mayor.js');
const { mulberry32 } = await import('../src/utils.js');
const P = await import('../src/persistence.js');

function setup(seed = 3, { life = true } = {}) {
  const city = new CityState(32, 32);
  generateTown(city, seed);
  const sim = new Simulation(city);
  sim.life.rng = mulberry32(seed);
  sim.refresh();
  const world = new World(city, sim, { rand: mulberry32(seed) });
  const war = new WarRoom(world, { rand: mulberry32(seed + 1) });
  if (life) sim.life.create({ first: 'Ada', last: 'Lark' });
  const mayor = new Mayor(city, { life: () => sim.life, economy: () => sim.economy, decisions: () => sim.decisions, growth: () => sim.growth, eras: () => sim.eras, war: () => war, rand: mulberry32(seed + 2) });
  mayor.update();
  return { city, sim, world, war, mayor, cpu: world.neighbours[0] };
}


test('rivals are on by default, so older saves keep their neighbour', () => {
  const { world, city } = setup(3);
  assert.equal(world.rivals, true);
  assert.equal(world.neighbours.length, 1);
  assert.equal(city.systems.world.rivals, undefined);
});

test('turning rivals off removes the towns from the game but keeps their saved data; on brings the same one back', () => {
  const { world, city, cpu } = setup(4);
  const id = cpu.id;
  const name = cpu.entry.name;
  const at = { ...cpu.entry.at };
  world.setRivals(false);
  assert.equal(world.rivals, false);
  assert.equal(world.neighbours.length, 0);
  assert.equal(world.cities.length, 1);
  assert.equal(city.systems.world.rivals, false);
  assert.equal(city.systems.world.cities.length, 1, 'its saved town is still there');
  world.setRivals(true);
  assert.equal(world.neighbours.length, 1);
  assert.equal(world.neighbours[0].id, id);
  assert.equal(world.neighbours[0].entry.name, name);
  assert.deepEqual(world.neighbours[0].entry.at, at);
  assert.equal(world.cities.length, 2, 'no extra town was founded');
});

test('a new town with rivals off never founds one, and saving keeps the choice', () => {
  const city = new CityState(24, 24);
  generateTown(city, 5);
  const sim = new Simulation(city);
  sim.refresh();
  city.systems.world = { version: 1, home: { name: 'Solo', at: { x: 0, y: 0 } }, cities: [], rivals: false };
  const world = new World(city, sim, { rand: mulberry32(1) });
  assert.equal(world.neighbours.length, 0);
  const back = CityState.fromJSON(JSON.parse(JSON.stringify(city.toJSON())));
  assert.equal(back.systems.world.rivals, false);
  const world2 = new World(back, new Simulation(back), { rand: mulberry32(1) });
  assert.equal(world2.neighbours.length, 0);
  assert.equal(world2.rivals, false);
});

test('with rivals off nothing breaks: no raids, no diplomacy, duties that need a neighbour say so', () => {
  const env = setup(6);
  env.world.setRivals(false);
  env.war.attach();
  for (let i = 0; i < 200; i++) {
    env.world.update(0.5, 3);
    env.war.update?.(0.5);
    env.city.clock += 0.01;
  }
  assert.equal(env.war.state.raids.length, 0, 'no raids come');
  assert.equal(env.war.diplomacy.world.neighbours.length, 0);
  env.mayor.state.actions = 5;
  assert.match(env.mayor.perform('envoy').error, /no neighbouring town/);
  assert.ok(env.mayor.needsError('summit'));
  assert.equal(env.war.intel().neighbours.length, 0);
});

test('switching rivals off with a raid on the way calls the raid off', () => {
  const env = setup(7);
  const raid = env.war.planRaid?.(env.cpu) || null;
  env.war.state.raids.push({ id: 'raid-x', from: env.cpu.id, fromName: env.cpu.entry.name, status: 'coming', at: env.city.day + env.city.clock + 1, waves: 2, seed: 1 });
  env.world.setRivals(false);
  env.war.attach();
  assert.equal(env.war.state.raids.length, 0);
  void raid;
});
