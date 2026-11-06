// Run with: node --test tests/
// Settlements: once your town has enough people it can found a small town of its own on a free site
// nearby. The charter comes out of your town's money and becomes the new town's. Settlements grow by
// themselves, know what your town has unlocked, keep their own money, survive saving and loading, and
// stay out of the computer's wars and diplomacy.
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
const { World, NEIGHBOUR_SIZE, SETTLE } = await import('../src/world.js');
const { WarRoom } = await import('../src/warRoom.js');
const { mulberry32 } = await import('../src/utils.js');
const P = await import('../src/persistence.js');

// A town big enough to found a settlement, with money to spare.
function bigTown(seed = 3, { people = 200, money = 9000 } = {}) {
  const city = new CityState(32, 32);
  generateTown(city, seed);
  const sim = new Simulation(city);
  sim.refresh();
  city.stats.population = people; // what the town's homes would hold; set directly to test the rule
  sim.economy.state.money = money;
  return { city, sim, world: new World(city, sim, { rand: mulberry32(seed) }) };
}
const overlap = (p, q) => Math.abs(p.x - q.x) < NEIGHBOUR_SIZE && Math.abs(p.y - q.y) < NEIGHBOUR_SIZE;

test('free sites are offered beside your town, clear of every other town, and stay the same', () => {
  const { world } = bigTown();
  const sites = world.sites();
  assert.equal(sites.length, 3);
  for (const s of sites) {
    for (const c of world.neighbours) assert.ok(!overlap(s.at, c.entry.at), `${s.name} is clear of ${c.entry.name}`);
    for (const t of sites) if (t !== s) assert.ok(!overlap(s.at, t.at), 'sites don’t overlap each other');
  }
  assert.equal(new Set(sites.map((s) => s.name)).size, 3, 'each has its own name');
  assert.deepEqual(world.sites(), sites, 'asking again gives the same sites');
});

test('founding needs enough people, the charter money, and room for one more settlement', () => {
  const small = bigTown(4, { people: SETTLE.population - 1 });
  assert.equal(small.world.canFound().ok, false);
  assert.match(small.world.canFound().reason, /needs 150 people/);
  assert.equal(small.world.foundSettlement(small.world.sites()[0].id), null);

  const poor = bigTown(5, { money: SETTLE.charter - 1 });
  assert.match(poor.world.canFound().reason, /charter costs \$3,000/);
  assert.equal(poor.world.foundSettlement(poor.world.sites()[0].id), null);
  assert.equal(poor.sim.economy.money, SETTLE.charter - 1, 'nothing was taken');

  const { world, sim } = bigTown(6, { money: 20000 });
  assert.ok(world.canFound().ok);
  assert.ok(world.foundSettlement(world.sites()[0].id));
  assert.ok(world.foundSettlement(world.sites()[0].id));
  assert.match(world.canFound().reason, /2 settlements already/);
  assert.equal(world.foundSettlement(world.sites()[0].id), null, 'no third one');
  assert.equal(sim.economy.money, 20000 - 2 * SETTLE.charter);
  assert.equal(world.foundSettlement('site-nowhere'), null, 'only a site on offer');
});

test('a new settlement: on its site, the charter as its money, your era and unlocks, growing by itself', () => {
  const { world, sim, city } = bigTown(7);
  sim.milestones.settle(2);
  const site = world.sites()[1];
  const c = world.foundSettlement(site.id);
  assert.equal(c.owner, 'colony');
  assert.equal(c.entry.name, site.name);
  assert.deepEqual(c.entry.at, site.at);
  assert.equal(sim.economy.money, 9000 - SETTLE.charter, 'your town paid the charter');
  assert.equal(c.sim.economy.money, SETTLE.charter, 'and the settlement starts with it');
  assert.ok(c.sim.growth.on, 'it grows by itself');
  assert.equal(c.planner, null, 'the computer doesn’t run it');
  assert.equal(c.city.systems.era.index, city.systems.era.index, 'same era as your town');
  assert.ok(c.sim.milestones.reached >= 2, 'it can build what your town has unlocked');
  assert.ok(c.city.homes().length > 0 && c.city.homes().length <= 10, 'a small start: a crossroads and a few homes');
  assert.ok(!world.sites().some((s) => s.id === site.id), 'the site is used up');
  assert.equal(world.sites().length, 3, 'and another takes its place');
  assert.ok(!world.neighbours.includes(c), 'it is not one of the computer’s towns');
  assert.deepEqual(world.settlements, [c]);
});

test('a settlement grows over the days, pays its way and never goes into debt', () => {
  const { world, sim } = bigTown(8);
  const c = world.foundSettlement(world.sites()[0].id);
  const start = c.city.homes().length;
  let low = Infinity;
  while (c.city.day < 12) {
    sim.update(0.25);
    world.update(0.25, 3);
    low = Math.min(low, c.sim.economy.money);
  }
  assert.equal(c.city.day, sim.city.day, 'it keeps the shared calendar');
  assert.ok(c.city.homes().length > start, `it built homes (${start} → ${c.city.homes().length})`);
  assert.ok(low >= 0, `its money went down to ${Math.round(low)}`);
});

test('money moves between your own towns only, and never more than a town has', () => {
  const { world, sim } = bigTown(9);
  const c = world.foundSettlement(world.sites()[0].id);
  const home = world.cities[0];
  assert.equal(world.transfer('home', c.id, 1000), 1000);
  assert.equal(sim.economy.money, 9000 - SETTLE.charter - 1000);
  assert.equal(c.sim.economy.money, SETTLE.charter + 1000);
  assert.equal(world.transfer(c.id, 'home', 1e9), SETTLE.charter + 1000, 'only what it has');
  assert.equal(c.sim.economy.money, 0);
  assert.equal(world.transfer(c.id, 'home', 50), 0, 'nothing left to send');
  assert.equal(world.transfer('home', world.neighbours[0].id, 100), 0, 'not to the computer’s town');
  assert.equal(world.transfer('home', 'home', 100), 0);
  assert.equal(world.transfer('home', c.id, -5), 0);
  assert.equal(home.sim.economy.money, 9000 - SETTLE.charter + SETTLE.charter, 'it all came back');
});

test('settlements are saved with your town, and stay when rival towns are turned off', () => {
  store.clear();
  const { world, sim, city } = bigTown(10);
  const c = world.foundSettlement(world.sites()[0].id);
  for (let i = 0; i < 400; i++) {
    sim.update(0.25);
    world.update(0.25, 3);
  }
  const sitesBefore = world.sites();
  P.setActiveSlot(1);
  assert.ok(P.saveCity(city, 1));
  const back = P.loadCity(1);
  const sim2 = new Simulation(back);
  sim2.refresh();
  const w2 = new World(back, sim2);
  const c2 = w2.settlements[0];
  assert.ok(c2, 'the settlement came back');
  assert.equal(c2.entry.name, c.entry.name);
  assert.deepEqual(c2.entry.at, c.entry.at);
  assert.deepEqual(c2.city.toJSON().tiles, c.city.toJSON().tiles, 'its buildings');
  assert.equal(c2.sim.economy.money, c.sim.economy.money, 'its money');
  assert.ok(c2.sim.growth.on);
  assert.deepEqual(w2.sites(), sitesBefore, 'the same sites on offer');
  w2.setRivals(false);
  assert.equal(w2.neighbours.length, 0, 'no rival towns');
  assert.equal(w2.settlements.length, 1, 'your settlement stays');
});

test('a game from before settlements keeps them untouched, and damaged settlement data is founded afresh', () => {
  const { world, city } = bigTown(11);
  world.foundSettlement(world.sites()[0].id);
  const saved = JSON.parse(JSON.stringify(city.toJSON()));
  // An older version only runs 'cpu' entries; the settlement's entry rides along in the save as it was.
  const entry = saved.systems.world.cities.find((e) => e.owner === 'colony');
  assert.ok(entry.data.tiles.length === NEIGHBOUR_SIZE * NEIGHBOUR_SIZE);
  // Damaged data: the settlement is founded afresh on its site rather than breaking the world.
  entry.data = { width: 2, height: 2, tiles: 'x' };
  const back = CityState.fromJSON(saved);
  const w2 = new World(back, new Simulation(back));
  assert.equal(w2.settlements.length, 1);
  assert.equal(w2.settlements[0].city.width, NEIGHBOUR_SIZE);
  assert.deepEqual(w2.settlements[0].entry.at, entry.at);
});

test('the computer’s wars leave settlements alone: no army budget, not a target, no diplomacy', () => {
  const { world, sim } = bigTown(12);
  const c = world.foundSettlement(world.sites()[0].id);
  const war = new WarRoom(world, { rand: mulberry32(1) });
  war.attach();
  assert.equal(c.military.state.share, 0, 'none of its income goes to an army');
  assert.match(war.attackError(c), /Pick a town to attack/);
  assert.ok(!world.neighbours.includes(c));
  assert.ok(sim);
});

test('in Sandbox the charter is free and the settlement is a Sandbox town too', () => {
  const { world, sim, city } = bigTown(13, { money: 0 });
  city.systems.mode = 'sandbox';
  assert.ok(world.canFound().ok);
  const c = world.foundSettlement(world.sites()[0].id);
  assert.equal(c.city.systems.mode, 'sandbox');
  assert.equal(sim.economy.money, 0, 'nothing was taken');
  assert.equal(world.transfer('home', c.id, 100), 0, 'a Sandbox town has no budget to send');
});
