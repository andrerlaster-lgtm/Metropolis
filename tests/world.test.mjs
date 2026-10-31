// Run with: node --test tests/
// Two towns in one world: yours, and a neighbour the computer runs. The neighbour starts small, grows
// by itself under the player's rules (paying for everything, only what its era and milestones allow),
// never touches your town, and both survive saving and loading.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { CityState } = await import('../src/state.js');
const { generateTown, generateSeed } = await import('../src/generator.js');
const { Simulation } = await import('../src/simulation.js');
const { World, NEIGHBOUR_SIZE } = await import('../src/world.js');
const { buildsFor } = await import('../src/eras.js');
const { STRUCTURES, START_MONEY } = await import('../src/config.js');
const P = await import('../src/persistence.js');

function homeTown(seed = 3) {
  const city = new CityState(32, 32);
  generateTown(city, seed);
  const sim = new Simulation(city);
  sim.refresh();
  return { city, sim };
}

// Your town as saved, minus the world (which holds the neighbour).
function yours(city) {
  const j = JSON.parse(JSON.stringify(city.toJSON()));
  delete j.systems.world;
  return JSON.stringify(j);
}

test('a save from before the world gets a computer-run neighbour, and your town is untouched', () => {
  const { city, sim } = homeTown();
  assert.equal(city.systems.world, undefined);
  const money = sim.economy.money;
  const before = yours(city);
  const world = new World(city, sim);
  assert.equal(world.cities.length, 2);
  const [home, cpu] = world.cities;
  assert.equal(home.owner, 'player');
  assert.equal(home.city, city);
  assert.equal(cpu.owner, 'cpu');
  assert.notEqual(cpu.city, city);
  assert.equal(cpu.city.width, NEIGHBOUR_SIZE);
  assert.ok(cpu.entry.name && cpu.entry.name !== home.entry.name, 'both towns have their own names');
  // Side by side, not overlapping.
  assert.ok(cpu.entry.at.x >= city.width || cpu.entry.at.y >= city.height || cpu.entry.at.x + cpu.city.width <= 0 || cpu.entry.at.y + cpu.city.height <= 0);
  // A small settlement with the land's starting budget, not a finished town.
  const homes = cpu.city.homes().length;
  assert.ok(homes >= 1 && homes <= 10, `a few homes to start (${homes})`);
  assert.equal(cpu.sim.economy.money, START_MONEY.land);
  assert.equal(cpu.city.day, city.day, 'one calendar');
  assert.equal(yours(city), before, 'your town is as it was');
  assert.equal(sim.economy.money, money, 'and so is your money');
});

test('the neighbour builds over the days by your rules: it pays for roads, services and parks, within its era and milestones', () => {
  const { city, sim } = homeTown(5);
  sim.growth.on = false; // only the computer builds here
  sim.disasters.level = 'off';
  const world = new World(city, sim);
  const cpu = world.neighbours[0];
  cpu.sim.disasters.level = 'off';
  const g = cpu.sim.growth;
  const eco = cpu.sim.economy;
  const grow = g.grow.bind(g);
  const builds = [];
  g.grow = () => {
    const before = eco.money;
    const era = cpu.sim.eras.index;
    const r = grow();
    if (!r) return r;
    builds.push(r);
    // Like yours, its homes and businesses are built by residents; the rest comes out of its budget.
    const cost = g.paid(r.type) ? eco.costOf(r.type) * (r.n || 1) : 0;
    if (g.paid(r.type)) assert.ok(cost > 0, `${r.type} has a price`);
    assert.ok(Math.abs(before - eco.money - cost) < 1e-6, `${r.type} cost ${before - eco.money}, expected ${cost}`);
    assert.ok(eco.money >= g.reserve - 1e-6, `kept the reserve (${eco.money} ≥ ${g.reserve})`);
    if (r.type !== 'road' && r.type !== 'tree') assert.ok(buildsFor(era).includes(r.type), `${r.type} is allowed in era ${era}`);
    assert.ok(cpu.sim.milestones.isUnlocked(r.type), `${r.type} is unlocked`);
    return r;
  };
  const start = cpu.city.tiles.filter((t) => t.structure && t.structure.type !== 'tree').length;
  const startPop = cpu.city.stats.population;
  const homeMoney = () => sim.economy.money;
  let step = 0;
  // 12 days at 3× speed, your town running too; every 50 steps check the neighbour's turn changes nothing of yours.
  for (; step < 4800; step++) {
    sim.speed = 3;
    sim.update(0.25);
    const check = step % 50 === 0;
    const mine = check && yours(city);
    const money = homeMoney();
    world.update(0.25, 3);
    if (check) {
      assert.equal(yours(city), mine, `step ${step}: your town changed during the neighbour's turn`);
      assert.equal(homeMoney(), money, `step ${step}: your money changed during the neighbour's turn`);
    }
    assert.equal(cpu.city.day, city.day);
    assert.equal(cpu.city.clock, city.clock);
  }
  const now = cpu.city.tiles.filter((t) => t.structure && t.structure.type !== 'tree').length;
  assert.ok(builds.length >= 10, `the computer built things (${builds.length})`);
  assert.ok(now > start, `the neighbour grew (${start} → ${now} buildings and roads)`);
  assert.ok(cpu.city.stats.population > startPop, `more people live there (${startPop} → ${cpu.city.stats.population})`);
  const kinds = new Set(builds.map((b) => b.type));
  assert.ok(kinds.has('road'), 'it lays roads');
  assert.ok([...kinds].some((k) => STRUCTURES[k]?.capacity), 'it builds homes');
  assert.ok(cpu.city.systems.cpu.log.length > 0, 'it keeps a log of what it built');
});

test('the computer answers town decisions itself', () => {
  const { city, sim } = homeTown(2);
  const world = new World(city, sim);
  const cpu = world.neighbours[0];
  cpu.city.stats.population = 50;
  cpu.sim.decisions.ask('festival');
  assert.ok(cpu.sim.decisions.pending);
  cpu.planner.update();
  assert.equal(cpu.sim.decisions.pending, null);
  assert.ok(cpu.sim.decisions.state.made >= 1);
});

test('saving and loading keep both towns, through the real save slots', () => {
  store.clear();
  const { city, sim } = homeTown(4);
  const world = new World(city, sim);
  const cpu = world.neighbours[0];
  for (let i = 0; i < 1200; i++) {
    sim.update(0.25);
    world.update(0.25, 3);
  }
  P.setActiveSlot(1);
  assert.ok(P.saveCity(city, 1));
  const back = P.loadCity(1);
  const sim2 = new Simulation(back);
  sim2.refresh();
  const world2 = new World(back, sim2);
  assert.equal(world2.cities.length, 2);
  const cpu2 = world2.neighbours[0];
  assert.equal(cpu2.entry.name, cpu.entry.name);
  assert.deepEqual(cpu2.entry.at, cpu.entry.at);
  assert.deepEqual(cpu2.city.toJSON().tiles, cpu.city.toJSON().tiles, 'the neighbour’s buildings and residents');
  assert.equal(cpu2.sim.economy.money, cpu.sim.economy.money, 'its money');
  assert.equal(world2.cities[0].entry.name, world.cities[0].entry.name);
  assert.deepEqual(yours(back), yours(city), 'your town');
  // And again, after the loaded world has run on: the save follows the live towns.
  for (let i = 0; i < 200; i++) world2.update(0.25, 1);
  const again = JSON.parse(JSON.stringify(back.toJSON()));
  assert.deepEqual(again.systems.world.cities[0].data.tiles, cpu2.city.toJSON().tiles);
  // Exported files carry the neighbour too.
  const file = P.exportCity(back);
  assert.ok(JSON.parse(file.text).city.systems.world.cities[0].data.tiles.length === NEIGHBOUR_SIZE * NEIGHBOUR_SIZE);
});

test('another town in your slot brings its own world; a new town gets a new neighbour', () => {
  const a = homeTown(6);
  const wa = new World(a.city, a.sim);
  const nameA = wa.neighbours[0].entry.name;
  const b = homeTown(7);
  const wb = new World(b.city, b.sim);
  wb.neighbours[0].entry.name = 'Testbrook';
  // Switching slots copies the other town in and rebuilds the world from it.
  a.city.copyFrom(b.city);
  wa.load();
  assert.equal(wa.neighbours[0].entry.name, 'Testbrook');
  // A brand-new town (no world yet) gets a fresh neighbour.
  const fresh = new CityState(32, 32);
  generateSeed(fresh, 9);
  a.city.copyFrom(fresh);
  wa.load();
  assert.equal(wa.neighbours.length, 1);
  assert.ok(wa.neighbours[0].city.homes().length <= 10);
  assert.ok(nameA);
});

test('more computer-run towns can join, each with its own place, money and growth', () => {
  const { city, sim } = homeTown(8);
  const world = new World(city, sim);
  const third = world.addNeighbour({ name: 'Thirdwick' });
  assert.equal(world.cities.length, 3);
  const [a, b] = world.neighbours;
  const overlap = (p, q, s) => Math.abs(p.x - q.x) < s && Math.abs(p.y - q.y) < s;
  assert.ok(!overlap(a.entry.at, b.entry.at, NEIGHBOUR_SIZE), 'they don’t overlap');
  assert.notEqual(a.sim.economy, b.sim.economy);
  for (let i = 0; i < 400; i++) {
    sim.update(0.25);
    world.update(0.25, 3);
  }
  assert.equal(third.city.day, city.day);
  // Saved and loaded with all three.
  const back = CityState.fromJSON(JSON.parse(JSON.stringify(city.toJSON())));
  const w2 = new World(back, new Simulation(back));
  assert.deepEqual(
    w2.neighbours.map((c) => c.entry.name),
    world.neighbours.map((c) => c.entry.name)
  );
});

test('damaged or unknown world data never breaks your town', () => {
  const { city, sim } = homeTown(9);
  const before = yours(city);
  city.systems.world = { cities: 'nope' };
  let world = new World(city, sim);
  assert.equal(world.neighbours.length, 1, 'a fresh neighbour replaces damaged data');
  city.systems.world.cities[0].data = { width: 5000, height: 2, tiles: 'x' };
  city.systems.world.cities.push({ id: 'ally-1', owner: 'someone-else', name: 'Later' });
  const st = JSON.parse(JSON.stringify(city.systems.world));
  city.systems.world = st;
  world = new World(city, sim);
  assert.equal(world.neighbours.length, 1, 'only computer towns run');
  assert.equal(world.neighbours[0].city.width, NEIGHBOUR_SIZE, 'an unreadable town is founded afresh');
  assert.ok(city.systems.world.cities.some((c) => c.owner === 'someone-else'), 'kinds from a later version are kept');
  assert.equal(yours(city), before);
});

test('a computer town that needs a school saves up for one and builds it', () => {
  const { mulberry32 } = { mulberry32: (a) => () => ((a = (a + 0x6d2b79f5) | 0), (((a ^= a >>> 15), (a = Math.imul(a, a | 1)), (a ^= a + Math.imul(a ^ (a >>> 7), a | 61)), (a ^ (a >>> 14)) >>> 0) / 4294967296)) };
  const real = Math.random;
  Math.random = mulberry32(21);
  try {
    const home = new CityState(32, 32);
    generateSeed(home, 3);
    const hsim = new Simulation(home);
    hsim.refresh();
    const world = new World(home, hsim);
    const cpu = world.neighbours[0];
    cpu.sim.disasters.level = 'off';
    cpu.sim.decisions.state.next = Infinity; // no town decisions here (some give a school as a gift)
    let poor = false;
    let saved = false;
    let school = false;
    // Only the computer's town runs here; your town's clock just moves on.
    for (let i = 0; i < 90 * 120 && !school; i++) {
      home.clock += 2.5 / 300;
      if (home.clock >= 1) {
        home.clock -= 1;
        home.day++;
      }
      world.update(0.25, 10);
      if (!poor && cpu.sim.milestones.isUnlocked('school')) {
        // A village now, so schools are allowed: take away any school and empty its purse, so the
        // school has to be saved for.
        for (const t of cpu.city.tiles) if (t.structure?.type === 'school') cpu.city.apply('bulldoze', t.x, t.y);
        cpu.sim.economy.state.money = 300;
        poor = true;
        continue;
      }
      if (cpu.city.systems.cpu.goal?.type === 'school') saved = true;
      school = cpu.city.tiles.some((t) => t.structure?.type === 'school');
    }
    assert.ok(saved, 'it saved up for a school');
    assert.ok(school, 'and built one');
    assert.ok(cpu.city.systems.cpu.log.some((b) => b.type === 'school'), 'its log says so');
  } finally {
    Math.random = real;
  }
});
