// Run with: node --test tests/
// Town upgrades: a skill tree the town earns points for by growing, with four branches whose effects
// reach taxes and costs, how happy homes are, how far services reach, jobs and homes, and the base.
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
const { Military } = await import('../src/military.js');
const { DEFENCES, UNITS } = await import('../src/militaryData.js');
const { Skills, SKILLS, SKILL, BRANCHES, effectsOf, START_POINTS, RESIDENTS_PER_POINT } = await import('../src/skills.js');
const { mulberry32 } = await import('../src/utils.js');
const P = await import('../src/persistence.js');

function town(seed = 4) {
  const city = new CityState(32, 32);
  generateTown(city, seed);
  const sim = new Simulation(city);
  sim.refresh();
  return { city, sim, sk: sim.skills };
}

// Give a town plenty of points, as if it had grown big.
function rich(sk, residents = 2000) {
  sk.state.peak = residents;
}

// Learn upgrades, then let the town take them in, as the game does.
function learn(env, ...ids) {
  for (const id of ids) assert.equal(env.sk.learn(id).error, undefined, id);
  env.city.dirty = true;
  env.sim.refresh();
}

test('the tree: four branches, each a chain where later upgrades need an earlier one', () => {
  assert.deepEqual(BRANCHES.map((b) => b.id), ['treasury', 'wellbeing', 'services', 'defence']);
  for (const b of BRANCHES) {
    const nodes = SKILLS.filter((s) => s.branch === b.id);
    assert.equal(nodes.length, 6, b.id);
    for (const s of nodes) {
      if (s.tier === 1) assert.ok(!s.needs, s.id);
      else for (const n of s.needs) assert.equal(SKILL[n].branch, b.id, `${s.id} needs ${n} from its own branch`);
    }
  }
});

test('points come from growing: one to start, one per town title, one per 50 residents at the biggest', () => {
  const city = new CityState(16, 16);
  const sk = new Skills(city);
  city.stats = { population: 0 };
  assert.equal(sk.earned(), START_POINTS);
  city.stats = { population: 120 };
  city.systems.milestones = { reached: 1 };
  assert.equal(sk.earned(), START_POINTS + 1 + Math.floor(120 / RESIDENTS_PER_POINT));
  assert.equal(sk.toNextPoint(), 30);
  // People moving out never takes points away.
  city.stats = { population: 20 };
  assert.equal(sk.earned(), START_POINTS + 1 + 2);
});

test('learning needs the upgrade before it and enough points; the top of a branch costs 2', () => {
  const city = new CityState(16, 16);
  city.stats = { population: 0 };
  const sk = new Skills(city);
  assert.match(sk.learnError('marketDays'), /Needs Tax office first/);
  assert.ok(sk.learn('taxOffice').learned);
  assert.match(sk.learnError('marketDays'), /Needs a point/);
  assert.equal(sk.available(), 0);
  rich(sk, 1000);
  assert.ok(sk.learn('marketDays').learned);
  assert.ok(sk.learn('tradeFair').learned);
  const before = sk.available();
  assert.ok(sk.learn('bonds').learned, 'one of its two upgrades is enough');
  assert.equal(sk.available(), before - 2);
  assert.match(sk.learnError('bonds'), /Already yours/);
});

test('points come back for free: one upgrade when nothing depends on it, or all at once', () => {
  const city = new CityState(16, 16);
  city.stats = { population: 0 };
  const sk = new Skills(city);
  rich(sk);
  for (const id of ['gardeners', 'quietStreets', 'cleanAir']) sk.learn(id);
  const avail = sk.available();
  assert.match(sk.forgetError('gardeners'), /needs it/);
  assert.ok(sk.forget('quietStreets').forgot);
  assert.match(sk.forgetError('gardeners'), /Clean air rules needs it/);
  assert.ok(sk.forget('cleanAir').forgot);
  assert.ok(sk.forget('gardeners').forgot);
  assert.equal(sk.available(), avail + 3);
  sk.learn('drill');
  sk.learn('engineers');
  assert.equal(sk.reset(), 2);
  assert.deepEqual(sk.learned, []);
});

test('effects stack: two tax upgrades multiply, reaches add up', () => {
  const fx = effectsOf(['marketDays', 'tradeFair', 'catchments', 'playStreets']);
  assert.ok(Math.abs(fx.businessTax - 1.15 * 1.15) < 1e-9);
  assert.deepEqual(fx.radius, { school: 1, health: 1, fun: 1, fire: 0 });
  assert.equal(effectsOf([]).residentTax, 1);
});

test('Treasury: more tax, cheaper building and upkeep, and the bonds pay every day', () => {
  const env = town(5);
  rich(env.sk);
  const e0 = env.city.derived.economy;
  const cost0 = env.sim.economy.costOf('house');
  learn(env, 'taxOffice', 'marketDays', 'thrifty', 'crews', 'tradeFair', 'bonds');
  const e1 = env.city.derived.economy;
  assert.ok(e1.income.homes > e0.income.homes * 1.05, 'home taxes up');
  assert.ok(env.sim.economy.costOf('house') < cost0, 'building cheaper');
  assert.ok((e1.expenses.road || 0) < (e0.expenses.road || 0) || !e0.expenses.road, 'upkeep down');
  assert.equal(Math.round(e1.income.bonds), Math.round(25 + 0.25 * env.city.stats.population));
  assert.ok(e1.net > e0.net);
});

test('Wellbeing: parks count for more, and Festivals lift every home', () => {
  const env = town(6);
  rich(env.sk);
  const green = env.city.tiles.find((t) => t.factors?.greenery > 0.05);
  const g0 = green.factors.greenery;
  const h0 = env.city.stats.happiness;
  learn(env, 'gardeners', 'quietStreets', 'festivals');
  assert.ok(Math.abs(green.factors.greenery - g0 * 1.25) < 1e-9);
  assert.equal(green.factors.upgrades, 0.03);
  assert.ok(env.city.stats.happiness > h0);
});

test('Services & growth: schools reach further, homes hold more, more jobs', () => {
  const env = town(7);
  rich(env.sk);
  const covered = () => env.city.tiles.filter((t) => (t.coverage?.school || 0) > 0).length;
  const c0 = covered();
  const cap0 = env.city.stats.capacity;
  const jobs0 = env.city.stats.jobs;
  learn(env, 'catchments', 'roomyHomes', 'hubs');
  assert.ok(covered() > c0 || c0 === 0, 'school coverage grew');
  assert.ok(env.city.stats.capacity > cap0);
  assert.ok(env.city.stats.jobs > jobs0);
});

test('Defence: faster training, cheaper defences, quicker repairs, less pay, veterans', () => {
  const env = town(8);
  rich(env.sk);
  const m = new Military(env.city, { economy: env.sim.economy, rand: mulberry32(1) });
  m.state.funds = 99999;
  const pay0 = m.upkeep();
  assert.equal(m.defenceCost('mg'), DEFENCES.mg.cost);
  learn(env, 'drill', 'engineers', 'fieldHospital', 'quartermaster', 'repairCrews', 'veterans');
  assert.equal(m.defenceCost('mg'), Math.round(DEFENCES.mg.cost * 0.8));
  assert.ok(Math.abs(m.upkeep() - pay0 * 0.8) < 1e-9);
  const r = m.recruit('rifleman');
  const t = (env.city.day || 0) + (env.city.clock || 0);
  assert.ok(r.soldier.until - Math.max(t, 0) <= UNITS.rifleman.train * 0.7 + 1e-9);
  assert.equal(r.soldier.xp, 40, 'starts as a Corporal');
});

test('a new point is announced once, when the town grows past the next step', () => {
  const env = town(9);
  env.city.systems.milestones.reached = 4; // top title already, so newcomers can't earn a title point by chance
  const seen = [];
  env.city.on((ev) => ev.type === 'skillPoint' && seen.push(ev));
  env.sim.tick();
  assert.equal(seen.length, 0);
  env.sk.state.peak = (Math.floor(env.sk.state.peak / RESIDENTS_PER_POINT) + 1) * RESIDENTS_PER_POINT;
  env.sim.tick();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].points, 1);
  assert.equal(seen[0].available, env.sk.available());
  env.sim.tick();
  assert.equal(seen.length, 1);
});

test('upgrades survive saving and loading; an older save starts with the points it has earned', () => {
  const env = town(10);
  rich(env.sk, 400);
  learn(env, 'taxOffice', 'gardeners');
  P.setActiveSlot(1);
  assert.ok(P.saveCity(env.city, 1));
  const back = P.loadCity(1);
  const sim2 = new Simulation(back);
  sim2.refresh();
  assert.deepEqual(sim2.skills.learned, ['taxOffice', 'gardeners']);
  assert.equal(back.derived.skills.residentTax, 1.1);
  // A town saved before upgrades existed.
  delete back.systems.skills;
  const sk3 = new Skills(back);
  assert.deepEqual(sk3.learned, []);
  assert.equal(sk3.state.peak, back.stats.population);
  assert.ok(sk3.available() >= 1);
});
