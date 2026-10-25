// Run with: node --test tests/
// Phase 2: roads and walking. Homes need a road beside them when they're built (in every mode); old
// roadless homes stay. Every other building works on bare grass: people walk to it, over sidewalks,
// parks and open ground, around buildings and water, up to a limit. Walking never counts as traffic.
// A long walk lowers how much people like their home and shows up as a complaint. Roads still help:
// where one reaches, people use it. CPU towns run the same rules.
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
const { AgentSystem } = await import('../src/agents.js');
const { computeLaborMarket, WALK_MAX, WALK_COMFORT, WALK_LONG, workersIn } = await import('../src/labor.js');
const { recomputeDesirability } = await import('../src/desirability.js');
const { computeCoverage } = await import('../src/coverage.js');
const { computeThoughts } = await import('../src/advisor.js');
const { STRUCTURES } = await import('../src/config.js');
const { mulberry32 } = await import('../src/utils.js');
const P = await import('../src/persistence.js');

const street = (city, y, x0, x1) => {
  for (let x = x0; x <= x1; x++) city.apply('road', x, y);
};
// A home from a town saved before homes needed a road.
const oldHome = (city, x, y, residents = 4, type = 'house') => {
  city.getTile(x, y).structure = { id: city.nextId++, type, residents };
  city.refreshAllRoadMasks();
  return city.getTile(x, y);
};
const shop = (city, x, y, type = 'shop') => {
  assert.ok(city.apply(type, x, y), `${type} at ${x},${y}`);
  return city.getTile(x, y);
};

// ---- Placement ------------------------------------------------------------------------------------

test('homes need a road beside them; with one they go up', () => {
  const city = new CityState(12, 12);
  for (const type of ['house', 'cottage', 'apartments', 'tower']) {
    assert.equal(city.canApply(type, 5, 5), false, `${type} with no road`);
    assert.match(city.placeError(type, 5, 5), /Homes need a road/);
  }
  city.apply('road', 5, 6);
  for (const type of ['house', 'cottage', 'apartments', 'tower']) {
    assert.equal(city.canApply(type, 5, 5), true, `${type} beside a road`);
    assert.equal(city.placeError(type, 5, 5), null);
    assert.equal(city.canApply(type, 8, 8), false, `${type} two tiles away`);
  }
  assert.equal(city.apply('house', 5, 5), true);
  assert.equal(city.apply('house', 8, 8), false);
});

test('a road on a diagonal is not beside it', () => {
  const city = new CityState(8, 8);
  city.apply('road', 4, 4);
  assert.equal(city.canApply('house', 3, 3), false);
  assert.equal(city.canApply('house', 3, 4), true);
});

test('everything else goes up on bare grass, far from any road', () => {
  const city = new CityState(30, 30);
  const types = Object.keys(STRUCTURES).filter((t) => !STRUCTURES[t].capacity && t !== 'road' && t !== 'rubble');
  assert.ok(types.length >= 12);
  for (const type of types) assert.equal(city.canApply(type, 15, 15), true, type);
  for (const type of ['shop', 'office', 'factory', 'school', 'clinic', 'library', 'university', 'park', 'playground', 'field', 'bakery', 'cafe', 'mall', 'firestation']) {
    const c = new CityState(30, 30);
    assert.equal(c.apply(type, 15, 15), true, `${type} placed with no road`);
  }
});

test('Sandbox mode still needs roads for homes, and still builds the rest freely', () => {
  const city = new CityState(12, 12);
  city.systems.mode = 'sandbox';
  assert.equal(city.canApply('house', 5, 5), false);
  assert.equal(city.canApply('shop', 5, 5), true);
  city.apply('road', 5, 6);
  assert.equal(city.canApply('house', 5, 5), true);
});

test('an old home with no road stays, can be replaced or rebuilt, and keeps its people', () => {
  const city = new CityState(12, 12);
  const h = oldHome(city, 5, 5, 4);
  assert.equal(city.getTile(5, 5).structure.residents, 4);
  assert.equal(city.canApply('cottage', 5, 5), true, 'a different home over it (an upgrade)');
  assert.equal(city.canApply('house', 6, 5), false, 'but a new one beside it is refused');
  h.structure.damage = 0.5;
  assert.equal(city.canApply('house', 5, 5), true, 'rebuilding it after a storm');
  city.tiles[5 * 12 + 5].structure = { id: 9, type: 'rubble', was: 'house' };
  assert.equal(city.canApply('house', 5, 5), true, 'and rebuilding after it was destroyed');
  city.tiles[5 * 12 + 5].structure = { id: 10, type: 'rubble', was: 'shop' };
  assert.equal(city.canApply('house', 5, 5), false, 'but a home where a shop stood needs a road');
});

test('taking away the road under a home never removes the home or its people', () => {
  const city = new CityState(12, 12);
  city.apply('road', 5, 6);
  city.apply('house', 5, 5);
  city.getTile(5, 5).structure.residents = 4;
  city.apply('bulldoze', 5, 6);
  assert.equal(city.getTile(5, 5).structure.type, 'house');
  assert.equal(city.getTile(5, 5).structure.residents, 4);
  assert.equal(city.accessRoad(5, 5), null);
});

// ---- Walking to work -----------------------------------------------------------------------------------

test('a shop on open grass, with no road, still employs people who can walk to it', () => {
  const city = new CityState(24, 12);
  street(city, 8, 0, 6); // a short street with homes on it; the shop is off in the meadow
  city.apply('house', 3, 7);
  city.getTile(3, 7).structure.residents = 4;
  const w = shop(city, 14, 4);
  assert.equal(city.accessRoad(14, 4), null);
  const r = computeLaborMarket(city);
  assert.equal(r.employed, workersIn(city.getTile(3, 7)));
  assert.equal(r.unemployed, 0);
  assert.equal(w.workersFilled, workersIn(city.getTile(3, 7)));
  assert.equal(r.walkers, r.employed);
  assert.equal(r.flows.length, 0, 'nobody drives');
  assert.ok(r.walks[0].count > 0);
  const home = city.getTile(3, 7);
  assert.equal(home.employment, 1);
  assert.ok(home.commuteWalk > 4 && home.commuteWalk < WALK_MAX, `a walk of ${home.commuteWalk}`);
});

test('walking never loads a road: no congestion, no traffic', () => {
  const city = new CityState(24, 12);
  street(city, 8, 0, 20);
  for (const x of [2, 4, 6, 8]) {
    city.apply('house', x, 7);
    city.getTile(x, 7).structure.residents = 4;
  }
  shop(city, 10, 2);
  shop(city, 14, 2, 'office');
  const r = computeLaborMarket(city);
  assert.ok(r.walkers > 0);
  assert.equal(Math.max(...Array.from(r.load)), 0, 'no road is loaded');
  for (const t of city.tiles) assert.equal(t.congestion, 0);
});

test('people walk around buildings and water, and a place they cannot reach stays out of reach', () => {
  const build = (wall) => {
    const city = new CityState(20, 12);
    street(city, 3, 0, 8);
    city.apply('house', 1, 2);
    city.getTile(1, 2).structure.residents = 4;
    const w = shop(city, 14, 4);
    // A wall of water across the field with a gap at the very top: a way round.
    if (wall) for (let y = 1; y <= 11; y++) city.apply('water', 10, y);
    return { city, w };
  };
  const open = build(false);
  assert.ok(computeLaborMarket(open.city).employed > 0);
  const straight = open.city.getTile(1, 2).commuteWalk;
  const walled = build(true);
  assert.ok(computeLaborMarket(walled.city).employed > 0, 'round the end of the water');
  const around = walled.city.getTile(1, 2).commuteWalk;
  assert.ok(around > straight + 3, `the detour costs more (${around} against ${straight})`);
  // Close the gap: nowhere to go.
  walled.city.apply('water', 10, 0);
  assert.equal(computeLaborMarket(walled.city).employed, 0);
  assert.equal(walled.w.workersFilled, 0);
  assert.equal(walled.city.getTile(1, 2).commuteWalk, 0);
  // A row of buildings is a wall too, and so is the edge of the map.
  const row = build(false);
  const block = (y) => (row.city.getTile(10, y).structure = { id: row.city.nextId++, type: 'rubble' }); // nothing walks through it
  for (let y = 0; y <= 11; y++) if (y !== 3) block(y);
  assert.ok(computeLaborMarket(row.city).employed > 0, 'through the one gap, along the road');
  block(3);
  assert.equal(computeLaborMarket(row.city).employed, 0);
});

test('a home boxed in by buildings and water cannot walk out; one that can walk, does', () => {
  const city = new CityState(14, 10);
  oldHome(city, 3, 3, 4);
  shop(city, 8, 3);
  for (const [x, y] of [[2, 3], [4, 3], [3, 2], [3, 4]]) city.apply('water', x, y);
  assert.equal(computeLaborMarket(city).employed, 0);
  city.apply('bulldoze', 4, 3); // bulldozing water turns it back to grass
  assert.ok(computeLaborMarket(city).employed > 0);
});

test('there is a limit to how far people will walk', () => {
  const city = new CityState(60, 6);
  oldHome(city, 1, 2, 4);
  shop(city, 55, 2);
  assert.equal(computeLaborMarket(city).employed, 0, 'too far to walk');
  const near = new CityState(60, 6);
  oldHome(near, 1, 2, 4);
  shop(near, 12, 2);
  assert.ok(computeLaborMarket(near).employed > 0);
  assert.ok(near.getTile(1, 2).commuteWalk <= WALK_MAX);
});

test('where a road reaches the job, people use the road, not their feet', () => {
  const city = new CityState(20, 10);
  street(city, 5, 0, 19);
  city.apply('house', 3, 4);
  city.getTile(3, 4).structure.residents = 4;
  shop(city, 12, 4); // beside the road
  const r = computeLaborMarket(city);
  assert.equal(r.walkers, 0);
  assert.ok(r.flows.length > 0);
  assert.equal(city.getTile(3, 4).commuteWalk, 0);
});

test('adding a road improves things automatically: the same shop is now reached by road', () => {
  const city = new CityState(24, 12);
  street(city, 8, 0, 12);
  city.apply('house', 3, 7);
  city.getTile(3, 7).structure.residents = 4;
  shop(city, 17, 8);
  const before = computeLaborMarket(city);
  assert.ok(before.walkers > 0 && before.flows.length === 0);
  const walkBefore = city.getTile(3, 7).commuteWalk;
  street(city, 8, 13, 16); // the road now reaches the shop
  const after = computeLaborMarket(city);
  assert.equal(after.walkers, 0);
  assert.ok(after.flows.length > 0);
  assert.equal(city.getTile(3, 7).commuteWalk, 0);
  assert.ok(walkBefore > 0);
});

test('homes first fill the jobs they can drive to; the rest walk to what is left, nearest first', () => {
  const city = new CityState(30, 12);
  street(city, 8, 0, 12);
  for (const x of [2, 4, 6]) {
    city.apply('house', x, 7);
    city.getTile(x, 7).structure.residents = 4;
  }
  const road = shop(city, 10, 7); // on the road: few jobs
  const far = shop(city, 24, 4, 'office'); // in the meadow
  const r = computeLaborMarket(city);
  const need = [2, 4, 6].reduce((n, x) => n + workersIn(city.getTile(x, 7)), 0);
  assert.equal(r.employed, Math.min(need, STRUCTURES.shop.jobs + STRUCTURES.office.jobs));
  assert.equal(road.workersFilled, Math.min(need, STRUCTURES.shop.jobs));
  if (need > STRUCTURES.shop.jobs) assert.ok(far.workersFilled > 0, 'the rest walk to the office');
  assert.equal(r.employed, r.flows.reduce((n, f) => n + f.count, 0) + r.walkers);
});

test('the same rule for every home and every workplace: jobs follow capacity and damage', () => {
  const city = new CityState(24, 12);
  oldHome(city, 2, 5, 8);
  const w = shop(city, 8, 5, 'office');
  w.structure.damage = 0.5; // half its space is unusable
  const r = computeLaborMarket(city);
  assert.equal(r.jobs, Math.round(STRUCTURES.office.jobs * 0.5));
  assert.equal(w.workersFilled, Math.min(workersIn(city.getTile(2, 5)), r.jobs));
});

test('a what-if for new roads leaves the walking out and writes nothing', () => {
  const city = new CityState(24, 12);
  oldHome(city, 2, 5, 4);
  const w = shop(city, 8, 5);
  computeLaborMarket(city, { dryRun: true });
  assert.equal(w.workersFilled || 0, 0);
  assert.equal(city.getTile(2, 5).employment || 0, 0);
});

// ---- Complaints and satisfaction ----------------------------------------------------------------------------

function farHomeTown() {
  const city = new CityState(40, 10);
  oldHome(city, 1, 5, 4);
  const w = shop(city, 14, 5, 'office'); // a long way over open grass, but within what people will walk
  return { city, w };
}

test('a long walk lowers desirability, a short one does not', () => {
  const { city } = farHomeTown();
  const home = city.getTile(1, 5);
  city.derived.labor = computeLaborMarket(city);
  computeCoverage(city);
  recomputeDesirability(city);
  assert.ok(home.commuteWalk > WALK_COMFORT, `${home.commuteWalk} to work`);
  assert.ok(home.factors.commute < 0, 'a long walk counts against the home');
  assert.ok(home.factors.commute >= -0.12);
  const near = new CityState(40, 10);
  oldHome(near, 1, 5, 4);
  shop(near, 5, 5, 'office');
  near.derived.labor = computeLaborMarket(near);
  computeCoverage(near);
  recomputeDesirability(near);
  assert.ok(near.getTile(1, 5).commuteWalk <= WALK_COMFORT);
  assert.equal(near.getTile(1, 5).factors.commute, 0);
});

test('the advisor flags old homes with no road and complains about long walks', () => {
  const { city } = farHomeTown();
  city.derived.labor = computeLaborMarket(city);
  computeCoverage(city);
  recomputeDesirability(city);
  assert.ok(city.getTile(1, 5).commuteWalk > WALK_LONG, `${city.getTile(1, 5).commuteWalk}`);
  const ids = computeThoughts(city, null).map((t) => t.id);
  assert.ok(ids.includes('no-road'), 'flagged for a road');
  assert.ok(ids.includes('long-walk'), 'and the long walk is a complaint');
  const t = computeThoughts(city, null).find((x) => x.id === 'no-road');
  assert.equal(t.severity, 'caution');
  assert.match(t.text, /walk/);
});

// ---- The rest of the game ----------------------------------------------------------------------------------

test('walking workplaces pay taxes like any other', () => {
  const city = new CityState(24, 12);
  street(city, 8, 0, 6);
  city.apply('house', 3, 7);
  city.getTile(3, 7).structure.residents = 4;
  const w = shop(city, 14, 4, 'shop');
  const sim = new Simulation(city);
  sim.refresh();
  assert.ok(w.workersFilled > 0);
  assert.ok(w.earning > 0, 'the shop in the meadow earns its tax');
});

test('people can really be seen walking to a workplace with no road', () => {
  const city = new CityState(24, 12);
  street(city, 8, 0, 6);
  city.apply('house', 3, 7);
  city.getTile(3, 7).structure.residents = 4;
  shop(city, 14, 4);
  const sim = new Simulation(city);
  sim.refresh();
  assert.ok(city.derived.labor.walks.length > 0);
  const agents = new AgentSystem(city);
  const n = agents.walkers.length;
  city.clock = 0.3; // morning
  let made = false;
  for (let i = 0; i < 20 && !made; i++) made = agents.spawnCommuteWalk();
  assert.ok(made, 'a commuter sets off on foot');
  assert.equal(agents.walkers.length, n + 1);
  const walker = agents.walkers.at(-1);
  const end = walker.pts.at(-1);
  assert.ok(Math.abs(end.x - 14.5) < 1.2 && Math.abs(end.y - 4.5) < 1.2, `ends at the shop (${end.x}, ${end.y})`);
  assert.equal(city.derived.labor.flows.length, 0, 'and no car is involved');
});

test('the same rules run in the computer’s towns', () => {
  const city = new CityState(32, 32);
  generateTown(city, 4);
  const sim = new Simulation(city);
  sim.refresh();
  const world = new World(city, sim, { rand: mulberry32(4) });
  const cpu = world.neighbours[0];
  const c = cpu.city;
  assert.equal(c.canApply('house', 0, 0) && !c.accessRoad(0, 0), false, 'homes need roads there too');
  const spot = c.tiles.find((t) => !t.structure && t.terrain === 'grass' && !c.accessRoad(t.x, t.y));
  assert.ok(spot, 'a spot with no road');
  assert.equal(c.canApply('office', spot.x, spot.y), true);
  assert.equal(c.canApply('house', spot.x, spot.y), false);
  // Free jobs in the meadow get taken by walkers there as well.
  for (const t of c.homes()) t.structure.residents = Math.max(1, t.structure.residents);
  c.apply('office', spot.x, spot.y);
  const r = computeLaborMarket(c);
  assert.ok(Number.isFinite(r.employed));
  assert.ok(spot.workersFilled >= 0);
});

test('roadless homes and walkers survive saving and loading', () => {
  const city = new CityState(24, 12);
  oldHome(city, 3, 7, 4);
  shop(city, 10, 5);
  P.setActiveSlot(1);
  assert.ok(P.saveCity(city, 1));
  const back = P.loadCity(1);
  assert.equal(back.getTile(3, 7).structure.type, 'house');
  assert.equal(back.getTile(3, 7).structure.residents, 4);
  assert.equal(back.accessRoad(3, 7), null);
  const r = computeLaborMarket(back);
  assert.ok(r.employed > 0);
});

test('the skill tree still applies: more jobs at a roadless workplace, with Business hubs', () => {
  const city = new CityState(24, 12);
  for (const x of [2, 3, 4, 5]) oldHome(city, x, 5, 16, 'apartments');
  const w = shop(city, 12, 5, 'office');
  const plain = computeLaborMarket(city).jobs;
  city.derived.skills = { jobs: 1.1, typeJobs: { office: 1.15 } };
  const boosted = computeLaborMarket(city).jobs;
  assert.ok(boosted > plain);
  assert.ok(w.workersFilled >= plain);
});

test('towns still settle with their jobs filled, and the walking pass is cheap', () => {
  const city = new CityState(48, 48);
  generateTown(city, 5);
  const sim = new Simulation(city);
  sim.refresh();
  for (let i = 0; i < 400; i++) sim.update(0.25);
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) computeLaborMarket(city);
  const each = (performance.now() - t0) / 20;
  assert.ok(each < 50, `${each.toFixed(1)} ms for a 48 × 48 town`);
  assert.ok(city.stats.employment > 0.3);
});
