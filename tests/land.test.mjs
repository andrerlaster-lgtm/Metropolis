// Run with: node --test tests/
// Land (land.js): the world around your town is laid out once, every free site stands on a land type
// with pluses and minuses, a settlement's ground is shaped to its land, and each land's effects reach
// building costs, taxes, growth, food, water views and disasters. Towns without saved land (your first
// town, the computer's towns, older saves) play exactly as before.
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
const { World, NEIGHBOUR_SIZE, SETTLE } = await import('../src/world.js');
const { LANDS, LAND_TYPES, landAt, landEffects, landOf, disasterOdds, shapeLand } = await import('../src/land.js');
const { computeResources } = await import('../src/resources.js');
const { FACTORS } = await import('../src/desirability.js');
const { mulberry32 } = await import('../src/utils.js');
const P = await import('../src/persistence.js');

function bigTown(seed = 3, { people = 200, money = 30000 } = {}) {
  const city = new CityState(32, 32);
  generateTown(city, seed);
  const sim = new Simulation(city);
  sim.refresh();
  city.stats.population = people;
  sim.economy.state.money = money;
  return { city, sim, world: new World(city, sim, { rand: mulberry32(seed) }) };
}

// A fresh crossroads town on a given land, with its ground shaped to it.
function townOn(type, seed = 5) {
  const city = new CityState(32, 32);
  generateSeed(city, seed);
  if (type) shapeLand(city, type, seed);
  const sim = new Simulation(city);
  sim.refresh();
  return { city, sim };
}

test('a town without saved land gets no land effects at all', () => {
  const { city } = bigTown();
  const fx = landEffects(city);
  for (const k of ['buildCost', 'businessTax', 'growth', 'food', 'waterView', 'damage']) assert.equal(fx[k], 1, k);
  assert.deepEqual(fx.disaster, {});
  assert.equal(city.systems.land, undefined, 'nothing was added to it');
  assert.ok(LAND_TYPES.includes(landOf(city)), 'its land is still named from its map');
});

test('the world’s land is the same every time from the same seed, comes in all five kinds, and neighbouring places share it', () => {
  const seen = new Set();
  let same = 0;
  let pairs = 0;
  for (let x = -300; x < 300; x += 6) {
    for (let y = -300; y < 300; y += 6) {
      const t = landAt(77, x, y);
      assert.equal(t, landAt(77, x, y));
      seen.add(t);
      pairs++;
      if (landAt(77, x + 3, y) === t) same++;
    }
  }
  assert.deepEqual([...seen].sort(), [...LAND_TYPES].sort());
  assert.ok(same / pairs > 0.8, `places three tiles apart share their land ${Math.round((100 * same) / pairs)}% of the time`);
  const row = (seed) => Array.from({ length: 40 }, (_, i) => landAt(seed, i * 30, 0)).join();
  assert.notEqual(row(1), row(2), 'a different seed lays out different country');
});

test('sites offer different kinds of land where the country has them, nearest and cheapest first', () => {
  let kinds = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const { world } = bigTown(seed);
    const sites = world.sites();
    assert.equal(sites.length, 3);
    for (const s of sites) {
      assert.ok(LANDS[s.land], `${s.name} has a land type`);
      assert.equal(s.land, world.landAtSpot(s.at), 'the land of the place it stands on');
    }
    for (let i = 1; i < sites.length; i++) assert.ok(sites[i].charter >= sites[i - 1].charter, 'cheapest first');
    kinds += new Set(sites.map((s) => s.land)).size;
  }
  assert.ok(kinds / 8 >= 2.5, `on average ${kinds / 8} different lands among three sites`);
});

test('a site further from your town costs more to found; the charter becomes the settlement’s money', () => {
  const { world, sim } = bigTown(3);
  const sites = world.sites();
  const near = sites[0];
  const far = sites[sites.length - 1];
  assert.equal(near.charter, SETTLE.charter, 'right beside your town: the base charter');
  assert.ok(far.charter > near.charter, `further out costs more (${far.charter})`);
  const before = sim.economy.money;
  const c = world.foundSettlement(far.id);
  assert.equal(sim.economy.money, before - far.charter);
  assert.equal(c.sim.economy.money, far.charter);
  assert.equal(c.entry.land, far.land);
  // Not enough for that charter: the reason names this site's price.
  const poor = bigTown(3, { money: SETTLE.charter + 100 });
  const pricey = poor.world.sites().find((s) => s.charter > SETTLE.charter + 100);
  assert.match(poor.world.canFound(pricey.id).reason, /charter here costs/);
  assert.equal(poor.world.foundSettlement(pricey.id), null);
});

test('a settlement’s ground is shaped to its land, around an untouched crossroads start', () => {
  const plain = townOn(null);
  const roads = (c) => c.tiles.filter((t) => t.structure?.type === 'road').length;
  const water = (c) => c.tiles.filter((t) => t.terrain === 'water').length;
  const trees = (c) => c.tiles.filter((t) => t.structure?.type === 'tree').length;
  const coast = townOn('coast');
  assert.ok(water(coast.city) >= 3 * 32 * 0.8, `a coast has the sea along an edge (${water(coast.city)} water tiles)`);
  assert.equal(water(townOn('plains').city), 0, 'plains: no river or pond');
  assert.equal(water(townOn('uplands').city), 0, 'uplands: no river or pond');
  assert.ok(water(townOn('river').city) > 0, 'a river valley keeps its river');
  assert.ok(trees(townOn('forest').city) > 32 * 32 * 0.35, `a forest is thickly wooded (${trees(townOn('forest').city)} trees)`);
  for (const t of LAND_TYPES) {
    const c = townOn(t).city;
    assert.equal(roads(c), roads(plain.city), `${t}: the crossroads is untouched`);
    assert.equal(c.homes().length, plain.city.homes().length, `${t}: the first homes are untouched`);
    assert.equal(c.systems.land.type, t);
    assert.equal(landOf(c), t);
  }
});

test('forest building is cheaper and upland building dearer; coast businesses pay more tax', () => {
  const base = townOn(null).sim.economy.costOf('road');
  const forest = townOn('forest').sim;
  const uplands = townOn('uplands').sim;
  const coast = townOn('coast').sim;
  assert.equal(forest.economy.costOf('road'), Math.round(base * 0.85));
  assert.equal(uplands.economy.costOf('road'), Math.round(base * 1.15));
  assert.equal(coast.economy.modifiers.businessTax, 1.15);
  assert.equal(townOn(null).sim.economy.modifiers.businessTax, 1);
});

test('plains grow faster, forest and uplands slower; a river valley’s farms make more food and its riverside is worth more', () => {
  const rate = (t) => {
    const { sim } = townOn(t);
    return sim.growth.rate();
  };
  const neutral = rate(null);
  assert.ok(Math.abs(rate('plains') / neutral - 1.2) < 1e-9);
  assert.ok(Math.abs(rate('uplands') / neutral - 0.85) < 1e-9);
  assert.ok(Math.abs(rate('forest') / neutral - 0.85) < 1e-9, 'thick woods slow new building');
  // The same farm, on plain land and in a river valley.
  const farmTown = (t) => {
    const { city } = townOn('river');
    if (t !== 'river') delete city.systems.land;
    const spot = city.tiles.find((x) => x.terrain === 'grass' && !x.structure && Math.hypot(x.x - 16, x.y - 16) > 7);
    spot.structure = city.createStructure('farm', mulberry32(1));
    return computeResources(city).food.made;
  };
  assert.ok(Math.abs(farmTown('river') / farmTown(null) - 1.25) < 0.02, 'a quarter more food');
  // Water views: the same riverside tile counts for half as much again in a river valley.
  const { city } = townOn('river');
  const views = FACTORS.find((f) => f.id === 'waterfront');
  const shore = city.tiles.find((t) => t.terrain === 'grass' && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => city.getTile(t.x + dx, t.y + dy)?.terrain === 'water'));
  assert.ok(shore);
  const inValley = views.compute(city, shore);
  delete city.systems.land;
  const elsewhere = views.compute(city, shore);
  assert.ok(elsewhere > 0);
  assert.ok(Math.abs(inValley / elsewhere - 1.5) < 1e-9, `${inValley} vs ${elsewhere}`);
});

test('disasters follow the land: river floods twice as often, uplands never flood, coast storms hit harder', () => {
  const river = townOn('river').city;
  const uplands = townOn('uplands').city;
  const coast = townOn('coast').city;
  const plain = townOn(null).city;
  assert.equal(disasterOdds(river, 'flood'), 2);
  assert.equal(disasterOdds(uplands, 'flood'), 0);
  assert.equal(disasterOdds(coast, 'storm'), 1.5);
  assert.equal(disasterOdds(plain, 'flood'), 1);
  // The same blow to the same kind of building: harder on the coast, softer in the uplands.
  const dent = (city) => {
    const sim = new Simulation(city);
    sim.refresh();
    const home = city.tiles.find((t) => t.structure && city.homes().includes(t));
    home.structure.damage = 0;
    sim.disasters.hit(home, 0.2, null, 'storm');
    return home.structure.damage;
  };
  const d0 = dent(townOn(null).city);
  assert.ok(Math.abs(dent(coast) / d0 - 1.2) < 1e-9, 'coast: 20% harder');
  assert.ok(Math.abs(dent(uplands) / d0 - 0.7) < 1e-9, 'uplands: 30% softer');
});

test('the land of the world, the sites and each settlement’s land survive saving and loading', () => {
  store.clear();
  const { world, sim, city } = bigTown(4);
  const sites = world.sites();
  const c = world.foundSettlement(sites[1].id);
  const seed = world.landSeed;
  for (let i = 0; i < 100; i++) {
    sim.update(0.25);
    world.update(0.25, 3);
  }
  const offered = world.sites().map((s) => s.name);
  assert.equal(offered.length, 3, 'a new site replaced the one used');
  P.setActiveSlot(1);
  assert.ok(P.saveCity(city, 1));
  const back = P.loadCity(1);
  const sim2 = new Simulation(back);
  sim2.refresh();
  const w2 = new World(back, sim2);
  assert.equal(w2.landSeed, seed, 'the same world map');
  assert.deepEqual(w2.sites(), world.sites(), 'the same sites on offer');
  // Founding again in both: the replacement is the same too, saved or not.
  const twin = w2.sites()[0].id;
  world.foundSettlement(twin);
  w2.foundSettlement(twin);
  assert.deepEqual(w2.sites(), world.sites());
  const c2 = w2.settlements[0];
  assert.equal(c2.city.systems.land.type, c.city.systems.land.type);
  assert.deepEqual(landEffects(c2.city), landEffects(c.city));
  assert.equal(c2.city.width, NEIGHBOUR_SIZE);
});

test('a settlement on every kind of land grows over a week and never goes into debt', () => {
  for (const land of LAND_TYPES) {
    // A world whose every site is this land, so the test isn't at the mercy of the map. Only the
    // settlement is run (at 3x, as the world runs it), which keeps the test quick.
    const { world } = bigTown(5);
    world.setRivals(false);
    world.landAtSpot = () => land;
    world.state.sites = [];
    const site = world.sites()[0];
    assert.equal(site.land, land);
    const c = world.foundSettlement(site.id);
    const start = c.city.homes().length;
    let low = Infinity;
    c.sim.speed = 3;
    while (c.city.day < 7) {
      c.sim.update(0.25);
      low = Math.min(low, c.sim.economy.money);
    }
    assert.ok(c.city.homes().length > start, `${land}: built homes (${start} -> ${c.city.homes().length})`);
    assert.ok(low >= 0, `${land}: money went down to ${Math.round(low)}`);
  }
});
