// Run with: node --test tests/
// Town upgrades: a skill tree of eight branches the town earns points for by growing, by reaching new
// eras and by its family's new generations. Effects reach taxes and costs, how happy homes are,
// services, homes and growth, roads and disasters, jobs, the base, and the mayor and succession.
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
const { World } = await import('../src/world.js');
const { WarRoom } = await import('../src/warRoom.js');
const { Mayor, ACTIONS_PER_DAY } = await import('../src/mayor.js');
const { DEFENCES, UNITS, ARMY_CAP } = await import('../src/militaryData.js');
const { STRUCTURES, ROAD_CAPACITY } = await import('../src/config.js');
const SK = await import('../src/skills.js');
const { Skills, SKILLS, SKILL, BRANCHES, effectsOf, noEffects, costOf, CAPS, START_POINTS, RESIDENTS_PER_POINT, RESIDENTS_PER_POINT_SMALL } = SK;
const { mulberry32 } = await import('../src/utils.js');
const P = await import('../src/persistence.js');
const { assessReputation } = await import('../src/reputation.js');
const { COSTS } = await import('../src/config.js');

function town(seed = 4, size = 32) {
  const city = new CityState(size, size);
  generateTown(city, seed);
  const sim = new Simulation(city);
  sim.refresh();
  return { city, sim, sk: sim.skills };
}

// Give a town plenty of points and the top title, as if it had grown big.
function rich(sk, residents = 4000) {
  sk.state.peak = residents;
  sk.city.systems.milestones = { ...(sk.city.systems.milestones || {}), reached: 4 };
}

// Learn upgrades, then let the town take them in, as the game does.
function learn(env, ...ids) {
  for (const id of ids) assert.equal(env.sk.learn(id).error, undefined, id);
  env.city.dirty = true;
  env.sim.refresh();
}

// The 24 upgrades from the first version of the tree, with what they did then.
const ORIGINAL = {
  taxOffice: { residentTax: 1.1 }, marketDays: { businessTax: 1.15 }, thrifty: { buildCost: 0.9 }, tradeFair: { businessTax: 1.15 }, crews: { upkeep: 0.8 }, bonds: { grantBase: 25, grantPerResident: 0.25 },
  gardeners: { greenery: 1.25 }, quietStreets: { traffic: 0.6 }, cleanAir: { pollution: 0.6 }, festivals: { happy: 0.03 }, sportForAll: { entertainment: 1.5 }, civicPride: { happy: 0.05 },
  catchments: { radius: { school: 1, health: 1 } }, roomyHomes: { capacity: 1.1 }, hubs: { jobs: 1.1 }, playStreets: { radius: { fun: 1 } }, fireDrills: { radius: { fire: 2 } }, welcome: { moveIn: 1.5 },
  drill: { train: 0.7 }, engineers: { defenceCost: 0.8 }, fieldHospital: { recovery: 0.6 }, repairCrews: { repair: 1.5 }, quartermaster: { pay: 0.8 }, veterans: { veteranXp: 40 },
};
const ORIGINAL_COST = { bonds: 2, civicPride: 2, welcome: 2, veterans: 2 };

// Every way of choosing at the forks: one upgrade of each pair, in all combinations.
function choices() {
  const forks = BRANCHES.map((b) => SKILLS.filter((s) => s.branch === b.id && s.excludes?.length).map((s) => s.id));
  const out = [];
  for (let mask = 0; mask < 1 << forks.length; mask++) {
    const pick = new Set(forks.map((f, i) => f[(mask >> i) & 1]));
    out.push(SKILLS.filter((s) => !s.excludes?.length || pick.has(s.id)).map((s) => s.id));
  }
  return out;
}

// ---- The shape of the tree ---------------------------------------------------------------------

test('the tree: eight branches of about seventy upgrades, each a chain from tier 1 to a milestone', () => {
  assert.deepEqual(BRANCHES.map((b) => b.id), ['treasury', 'wellbeing', 'housing', 'services', 'infrastructure', 'industry', 'defence', 'leadership']);
  assert.ok(SKILLS.length >= 68 && SKILLS.length <= 76, `${SKILLS.length} upgrades`);
  assert.equal(new Set(SKILLS.map((s) => s.id)).size, SKILLS.length, 'ids are unique');
  for (const b of BRANCHES) {
    const nodes = SKILLS.filter((s) => s.branch === b.id);
    assert.ok(nodes.length >= 8 && nodes.length <= 10, `${b.id} has ${nodes.length}`);
    const tiers = new Set(nodes.map((s) => s.tier));
    assert.ok(tiers.size >= 6 && tiers.size <= 8, `${b.id} has ${tiers.size} tiers`);
    assert.equal(nodes.filter((s) => s.milestone).length, 1, `${b.id} has one milestone`);
    assert.equal(nodes.find((s) => s.milestone).tier, 7);
    assert.equal(nodes.filter((s) => s.excludes?.length).length, 2, `${b.id} has one fork of two`);
    for (const s of nodes) {
      if (s.tier === 1) assert.ok(!s.needs, s.id);
      else {
        assert.ok(s.needs?.length, `${s.id} needs something`);
        for (const n of s.needs) {
          assert.equal(SKILL[n].branch, b.id, `${s.id} needs ${n} from its own branch`);
          assert.ok(SKILL[n].tier < s.tier, `${s.id} needs an earlier tier`);
        }
      }
      for (const x of s.excludes || []) assert.ok(SKILL[x].excludes.includes(s.id), `${s.id} and ${x} exclude each other`);
    }
  }
});

test('every upgrade from the first tree keeps its id, its effect and its cost', () => {
  for (const [id, fx] of Object.entries(ORIGINAL)) {
    assert.ok(SKILL[id], id);
    assert.deepEqual(SKILL[id].fx, fx, id);
    assert.equal(costOf(id), ORIGINAL_COST[id] || 1, `${id} costs the same`);
  }
});

test('every upgrade does something real, and its description has numbers to match', () => {
  const none = JSON.stringify(noEffects());
  const known = new Set(Object.keys(noEffects()));
  for (const s of SKILLS) {
    for (const k of Object.keys(s.fx)) assert.ok(known.has(k), `${s.id}: ${k} is an effect the game reads`);
    assert.notEqual(JSON.stringify(effectsOf([s.id])), none, `${s.id} changes something`);
    if (!ORIGINAL[s.id]) assert.ok(s.text.length > 20 && /\d/.test(s.text), `${s.id} says how much`);
  }
});

test('costs rise with the tiers: early upgrades are cheap, milestones dear', () => {
  for (const s of SKILLS) {
    if (ORIGINAL[s.id]) continue;
    const c = costOf(s.id);
    if (s.tier <= 2) assert.equal(c, 1, s.id);
    if (s.milestone) assert.equal(c, 4, s.id);
    if (s.tier >= 5 && !s.milestone) assert.ok(c >= 3, s.id);
  }
});

// ---- Points ------------------------------------------------------------------------------------

test('points come from growing, new eras and new generations, and never go away', () => {
  const city = new CityState(32, 32);
  const sk = new Skills(city);
  city.stats = { population: 0 };
  assert.equal(sk.earned(), START_POINTS);
  city.stats = { population: 120 };
  city.systems.milestones = { reached: 1 };
  const res = Math.floor(120 / RESIDENTS_PER_POINT);
  assert.equal(sk.earned(), START_POINTS + 1 + res);
  assert.equal(sk.toNextPoint(), RESIDENTS_PER_POINT - (120 % RESIDENTS_PER_POINT));
  city.systems.era = { index: 2 };
  city.systems.life = { char: { generation: 3 } };
  assert.equal(sk.earned(), START_POINTS + 1 + res + 2 + 2);
  // People moving out, an older era or a new unrelated family never takes points away.
  city.stats = { population: 20 };
  city.systems.era = { index: 0 };
  city.systems.life = { char: { generation: 1 } };
  assert.equal(sk.earned(), START_POINTS + 1 + res + 2 + 2);
  // Generations count up to eight points.
  city.systems.life = { char: { generation: 30 } };
  assert.equal(sk.sources().generations, SK.GEN_POINTS_MAX);
});

test('a small map earns points for fewer residents, so it can still go a long way', () => {
  const small = new Skills(new CityState(16, 16));
  small.city.stats = { population: 150 };
  assert.equal(small.sources().residents, Math.floor(150 / RESIDENTS_PER_POINT_SMALL));
  const medium = new Skills(new CityState(32, 32));
  medium.city.stats = { population: 150 };
  assert.equal(medium.sources().residents, Math.floor(150 / RESIDENTS_PER_POINT));
  assert.ok(RESIDENTS_PER_POINT_SMALL < RESIDENTS_PER_POINT);
});

test('Founding families and Boom town earn points; their points must be free before they go back', () => {
  const city = new CityState(32, 32);
  city.stats = { population: 0 };
  const sk = new Skills(city);
  rich(sk, 1000);
  city.systems.life = { char: { generation: 4 } };
  for (const id of ['clerks', 'envoys', 'familyTutors', 'council', 'peoplesMayor']) assert.equal(sk.learn(id).error, undefined, id);
  const before = sk.earned();
  assert.ok(sk.learn('foundingFamilies').learned);
  assert.equal(sk.earned(), before + 3, 'one more per generation after the first');
  for (const id of ['roomyHomes', 'riverside', 'welcome', 'fineHomes', 'highRise']) sk.learn(id);
  const b2 = sk.earned();
  assert.ok(sk.learn('boomTown').learned);
  assert.equal(sk.earned(), b2 + 10, 'one per 50 residents past 500');
  // Spend everything, then try to give Boom town back: its points are in use.
  for (const s of SKILLS) if (!sk.has(s.id)) sk.learn(s.id);
  if (sk.spent() > sk.earned([...sk.learned].filter((x) => x !== 'boomTown'))) assert.match(sk.forgetError('boomTown'), /points it earned are spent/);
  assert.ok(sk.reset() > 0, 'Reset all still works');
});

// ---- Learning and giving back -------------------------------------------------------------------

test('learning needs the upgrade before it, the town title for its tier, and enough points', () => {
  const city = new CityState(32, 32);
  city.stats = { population: 0 };
  const sk = new Skills(city);
  assert.match(sk.learnError('marketDays'), /Needs Tax office first/);
  assert.ok(sk.learn('taxOffice').learned);
  assert.match(sk.learnError('marketDays'), /Needs a point/);
  sk.state.peak = 1000;
  assert.ok(sk.learn('marketDays').learned);
  assert.match(sk.learnError('tradeFair'), /Needs the Village title/);
  city.systems.milestones = { reached: 1 };
  assert.ok(sk.learn('tradeFair').learned);
  const before = sk.available();
  assert.ok(sk.learn('bonds').learned, 'one of its two upgrades is enough');
  assert.equal(sk.available(), before - 2);
  assert.match(sk.learnError('charter'), /Needs the Town title/);
  city.systems.milestones = { reached: 2 };
  assert.ok(sk.learn('charter').learned);
  assert.ok(sk.learn('savingsBank').learned);
  // The milestone: the City title, or the family's third generation.
  assert.match(sk.learnError('mint'), /City title or your family’s third generation/);
  city.systems.life = { char: { generation: 3 } };
  assert.equal(sk.learnError('mint'), null);
  assert.match(sk.learnError('bonds'), /Already yours/);
});

test('Founding families needs the second generation of your family', () => {
  const city = new CityState(32, 32);
  city.stats = { population: 0 };
  const sk = new Skills(city);
  rich(sk);
  for (const id of ['oratory', 'envoys', 'regents', 'council', 'shrewdMayor']) sk.learn(id);
  assert.match(sk.learnError('foundingFamilies'), /second generation/);
  city.systems.life = { char: { generation: 2 } };
  assert.ok(sk.learn('foundingFamilies').learned);
});

test('forks: choosing one closes the other until you give it back, for free', () => {
  const city = new CityState(32, 32);
  city.stats = { population: 0 };
  const sk = new Skills(city);
  rich(sk);
  for (const id of ['gardeners', 'quietStreets', 'festivals', 'civicPride', 'boulevards']) assert.ok(sk.learn(id).learned, id);
  assert.match(sk.learnError('carFree'), /You chose Tree-lined boulevards/);
  const avail = sk.available();
  assert.ok(sk.forget('boulevards').forgot);
  assert.equal(sk.available(), avail + costOf('boulevards'));
  assert.ok(sk.learn('carFree').learned);
  assert.ok(sk.learn('goodName').learned, 'either side of the fork opens the next tier');
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

test('an older town keeps upgrades learned under the old rules, and can still give others back', () => {
  // In the first tree Play streets came after Roomier homes; now it comes after Bigger classrooms.
  const city = new CityState(32, 32);
  city.stats = { population: 300 };
  city.systems.skills = { v: 1, learned: ['catchments', 'roomyHomes', 'playStreets', 'taxOffice'], peak: 300 };
  const sk = new Skills(city);
  assert.deepEqual(sk.learned, ['catchments', 'roomyHomes', 'playStreets', 'taxOffice']);
  assert.equal(effectsOf(sk.learned).radius.fun, 1, 'its effect still counts');
  assert.ok(sk.forget('taxOffice').forgot, 'unrelated upgrades can go back');
  assert.ok(sk.forget('playStreets').forgot);
  assert.equal(sk.state.v, SK.SKILLS_VERSION);
});

// ---- Effects and their limits -------------------------------------------------------------------

test('effects stack: two tax upgrades multiply, reaches add up', () => {
  const fx = effectsOf(['marketDays', 'tradeFair', 'catchments', 'playStreets']);
  assert.ok(Math.abs(fx.businessTax - 1.15 * 1.15) < 1e-9);
  assert.deepEqual(fx.radius, { school: 1, health: 1, fun: 1, fire: 0 });
  assert.equal(effectsOf([]).residentTax, 1);
  assert.ok(Math.abs(effectsOf(['guilds', 'railSiding', 'smokeless']).typeTax.factory - 1.1 * 1.1) < 1e-9);
});

test('whatever is chosen, effects stay inside their limits, so nothing becomes trivial', () => {
  for (const learned of choices()) {
    const fx = effectsOf(learned);
    for (const [k, [a, b]] of Object.entries(CAPS)) assert.ok(fx[k] >= a - 1e-9 && fx[k] <= b + 1e-9, `${k} = ${fx[k]}`);
    assert.ok(fx.happy <= 0.12, 'no more than 12% happier from upgrades');
    assert.ok(fx.businessTax * Math.max(...Object.values(fx.typeTax)) <= 1.6 * 1.6 + 1e-9);
    for (const v of Object.values(fx.serves)) assert.ok(v >= 0.85 && v <= 1.6);
    for (const r of Object.values(fx.radius)) assert.ok(r >= -1 && r <= 4);
    for (const v of Object.values(fx)) if (typeof v === 'number') assert.ok(Number.isFinite(v));
  }
});

// ---- Balance across a town's life ----------------------------------------------------------------

test('balance against how big towns really get: a taste early, a third to a half of the tree over a whole game', () => {
  const obtainable = Math.max(...choices().map((l) => l.reduce((n, id) => n + costOf(id), 0)));
  assert.ok(obtainable >= 110 && obtainable <= 140, `${obtainable} points to fill a whole tree`);
  const stage = (size, pop, title, era, gen, extra = []) => {
    const city = new CityState(size, size);
    city.stats = { population: pop };
    city.systems.milestones = { reached: title };
    city.systems.era = { index: era };
    city.systems.life = { char: { generation: gen } };
    return new Skills(city).earned(extra);
  };
  // Towns left to grow by themselves level off near 180 (small), 480 (medium) and 770 (large) residents.
  const early = stage(32, 40, 0, 0, 1);
  const midTown = stage(32, 200, 2, 2, 2);
  const smallLate = stage(16, 220, 2, 4, 8, ['foundingFamilies']);
  const mediumLate = stage(32, 480, 3, 4, 8, ['foundingFamilies']);
  const largeLate = stage(48, 770, 3, 4, 8, ['foundingFamilies', 'boomTown']);
  const denseLarge = stage(48, 1500, 4, 4, 11, ['foundingFamilies', 'boomTown']);
  const share = (n) => n / obtainable;
  assert.ok(early >= 2 && early <= 4, `early ${early}`);
  assert.ok(midTown >= 12 && share(midTown) <= 0.2, `a young Town ${midTown}`);
  assert.ok(share(smallLate) >= 0.22 && share(smallLate) <= 0.4, `small map, late ${smallLate}`);
  assert.ok(share(mediumLate) >= 0.3 && share(mediumLate) <= 0.5, `medium map, late ${mediumLate}`);
  assert.ok(share(largeLate) >= 0.4 && share(largeLate) <= 0.65, `large map, late ${largeLate}`);
  assert.ok(share(denseLarge) >= 0.8, `a big, dense, old town gets nearly all of it: ${denseLarge}`);
  // A young Town can reach its first fork.
  const tFork = ['taxOffice', 'marketDays', 'tradeFair', 'bonds', 'charter'].reduce((n, id) => n + costOf(id), 0);
  assert.ok(midTown >= tFork, 'a Town can reach a fork');
});

// ---- The game systems the effects reach ----------------------------------------------------------

test('Treasury: more tax, cheaper building and upkeep, bonds, the mint and the savings bank', () => {
  const env = town(5);
  rich(env.sk);
  const e0 = env.city.derived.economy;
  const cost0 = env.sim.economy.costOf('house');
  learn(env, 'taxOffice', 'marketDays', 'thrifty', 'crews', 'tradeFair', 'bonds');
  const e1 = env.city.derived.economy;
  assert.ok(e1.income.homes > e0.income.homes * 1.05, 'home taxes up');
  assert.ok(env.sim.economy.costOf('house') < cost0, 'building cheaper');
  assert.ok((e1.expenses.road || 0) < (e0.expenses.road || 0) || !e0.expenses.road, 'upkeep down');
  const bonds = 25 + 0.25 * env.city.stats.population;
  assert.equal(Math.round(e1.income.bonds), Math.round(bonds));
  assert.ok(e1.net > e0.net);
  env.city.systems.life = { char: { generation: 3 } };
  env.sim.economy.state.money = 10000;
  learn(env, 'relief', 'savingsBank', 'mint');
  const e2 = env.city.derived.economy;
  assert.equal(Math.round(e2.income.bonds), Math.round(bonds * 1.5), 'the mint');
  assert.equal(Math.round(e2.income.interest), 50, '0.5% of $10,000');
  env.sim.economy.state.money = 1e6;
  env.sim.economy.assess();
  assert.equal(env.city.derived.economy.income.interest, 150, 'interest has a daily limit');
});

test('Wellbeing: parks count for more, Festivals lift every home, a good name lifts reputation', () => {
  const env = town(6);
  rich(env.sk);
  const green = env.city.tiles.find((t) => t.factors?.greenery > 0.05);
  const g0 = green.factors.greenery;
  const h0 = env.city.stats.happiness;
  learn(env, 'gardeners', 'quietStreets', 'festivals');
  assert.ok(Math.abs(green.factors.greenery - g0 * 1.25) < 1e-9);
  assert.equal(green.factors.upgrades, 0.03);
  assert.ok(env.city.stats.happiness > h0);
  learn(env, 'civicPride', 'boulevards', 'goodName');
  const withName = assessReputation(env.city).target;
  env.city.derived.skills = { ...env.city.derived.skills, reputation: 0 };
  const without = assessReputation(env.city).target;
  assert.ok(Math.abs(withName - Math.min(1, without + 0.06)) < 1e-9, 'a good name: 6 points more');
});

test('Housing & Growth: homes hold more, water views count, the town builds itself faster', () => {
  const env = town(7);
  rich(env.sk);
  const cap0 = env.city.stats.capacity;
  const rate0 = env.sim.growth.rate();
  const ins0 = env.sim.notables.state.points;
  learn(env, 'roomyHomes', 'landOffice', 'riverside', 'welcome', 'fineHomes');
  assert.ok(env.city.stats.capacity > cap0);
  assert.ok(Math.abs(env.sim.growth.rate() / rate0 - 1.15) < 1e-6, 'growth 15% faster');
  assert.equal(env.city.derived.skills.waterfront, 1.6);
  const before = { ...env.sim.notables.state.points };
  env.sim.notables.update(0.1);
  const after = env.sim.notables.state.points;
  const rates = env.sim.notables.rates();
  for (const [k, r] of Object.entries(rates)) if (r > 0 && after[k] > (before[k] || 0)) assert.ok(Math.abs(after[k] - (before[k] || 0) - r * 0.1 * 1.25) < 1e-6, `${k} inspired 25% faster`);
  void ins0;
});

test('Education & Services: reach further, serve more residents', () => {
  const env = town(7);
  rich(env.sk);
  const covered = () => env.city.tiles.filter((t) => (t.coverage?.school || 0) > 0).length;
  const c0 = covered();
  learn(env, 'catchments', 'bigClassrooms');
  assert.ok(covered() > c0 || c0 === 0, 'school coverage grew');
  const school = (env.city.derived.serviceStats || []).find((s) => s.type === 'school');
  if (school) assert.equal(school.serves, STRUCTURES.school.serves * 1.2, 'each school serves 20% more');
  learn(env, 'nightNurses', 'playStreets', 'goodSchools', 'boarding');
  const fx = env.city.derived.skills;
  assert.equal(fx.radius.school, 0, 'Wider catchments +1, Boarding schools −1');
  assert.equal(fx.serves.school, 1.6, '1.2 × 1.35 would be 1.62: held to the 60% limit');
});

test('Infrastructure: roads carry more, warnings come early, storms do less, repairs are cheaper', () => {
  const env = town(11);
  rich(env.sk);
  learn(env, 'roadMenders', 'weatherWatch', 'stormShutters', 'publicWorks');
  const d = env.sim.disasters;
  d.state.level = 'gentle';
  const t = env.city.day + env.city.clock;
  d.warn('storm');
  assert.ok(Math.abs(d.state.pending.at - t - 0.12 * 2) < 1e-6, 'twice the warning');
  d.state.pending = null;
  const home = env.city.tiles.find((x) => x.structure?.type === 'house');
  home.structure.damage = 0;
  d.state.prepared = false;
  d.hit(home, 0.3, null, 'wind');
  assert.ok(Math.abs(home.structure.damage - 0.3 * 0.8 * (d.state.resilience ?? 1) * (1 - (home.coverage?.fire || 0) * 0.3)) < 1e-6, 'storm shutters');
  const item = d.repairList().find((x) => x.t === home);
  const full = Math.max(20, Math.round((COSTS.house || 200) * 0.3 * home.structure.damage));
  assert.equal(item.cost, Math.max(1, Math.round(full * 0.75)), 'repairs 25% cheaper');
  assert.equal(env.city.derived.skills.roadCapacity, 1.15);
  void ROAD_CAPACITY;
});

test('Industry & Commerce: more jobs at factories and offices, shops pay more', () => {
  const env = town(12);
  rich(env.sk);
  const shops0 = env.city.derived.economy.income.shop || 0;
  const jobs0 = env.city.stats.jobs;
  learn(env, 'guilds', 'hubs', 'railSiding', 'officeQuarter');
  if (shops0) assert.ok(env.city.derived.economy.income.shop > shops0 * 1.15, 'shops pay more');
  assert.ok(env.city.stats.jobs > jobs0);
});

test('Defence: faster training, cheaper defences, quicker repairs, less pay, veterans, a bigger army', () => {
  const env = town(8);
  rich(env.sk);
  const m = new Military(env.city, { economy: env.sim.economy, rand: mulberry32(1) });
  m.state.funds = 99999;
  const pay0 = m.upkeep();
  const cap0 = m.armyCap;
  assert.equal(m.defenceCost('mg'), DEFENCES.mg.cost);
  learn(env, 'drill', 'engineers', 'fieldHospital', 'quartermaster', 'repairCrews', 'veterans');
  assert.equal(m.defenceCost('mg'), Math.round(DEFENCES.mg.cost * 0.8));
  assert.ok(Math.abs(m.upkeep() - pay0 * 0.8) < 1e-9);
  const r = m.recruit('rifleman');
  const t = (env.city.day || 0) + (env.city.clock || 0);
  assert.ok(r.soldier.until - Math.max(t, 0) <= UNITS.rifleman.train * 0.7 + 1e-9);
  assert.equal(r.soldier.xp, 40, 'starts as a Corporal');
  learn(env, 'militia');
  assert.equal(m.recruitCost('rifleman'), Math.round(UNITS.rifleman.cost * 0.7));
  env.sk.forget('militia');
  learn(env, 'standingArmy');
  assert.equal(m.armyCap, cap0 + 4);
  assert.equal(cap0, ARMY_CAP[m.level]);
});

test('Scouts spot raids earlier', () => {
  const city = new CityState(32, 32);
  generateTown(city, 3);
  const sim = new Simulation(city);
  sim.refresh();
  rich(sim.skills);
  const world = new World(city, sim, { rand: mulberry32(3) });
  const war = new WarRoom(world, { rand: mulberry32(4) });
  for (const id of ['drill', 'scouts']) sim.skills.learn(id);
  sim.refresh();
  assert.equal(city.derived.skills.raidWarning, 1.5);
  assert.equal(war.home.city.derived.skills.raidWarning, 1.5, 'the war room reads your town’s upgrades');
});

test('Leadership & Legacy: a council, stronger duties, faster learning, better heirs and regents', () => {
  const city = new CityState(32, 32);
  generateTown(city, 3);
  const sim = new Simulation(city);
  sim.life.rng = mulberry32(3);
  sim.refresh();
  const world = new World(city, sim, { rand: mulberry32(3) });
  const war = new WarRoom(world, { rand: mulberry32(4) });
  sim.life.create({ first: 'Ada', last: 'Lark' });
  const mayor = new Mayor(city, { life: () => sim.life, economy: () => sim.economy, decisions: () => sim.decisions, war: () => war, rand: mulberry32(5) });
  mayor.update();
  rich(sim.skills);
  const speech0 = mayor.speechAmount(1);
  const funds0 = mayor.fundsAmount(1, 100);
  assert.equal(mayor.actionsPerDay(), ACTIONS_PER_DAY);
  for (const id of ['clerks', 'oratory', 'envoys', 'familyTutors', 'regents', 'council']) assert.equal(sim.skills.learn(id).error, undefined, id);
  sim.refresh();
  assert.equal(mayor.actionsPerDay(), ACTIONS_PER_DAY + 1, 'a Town council gives a fourth duty');
  city.day += 1;
  mayor.update();
  assert.equal(mayor.state.actions, ACTIONS_PER_DAY + 1);
  assert.ok(Math.abs(mayor.speechAmount(1) - speech0 * 1.3) < 1e-9, 'oratory');
  const skill0 = mayor.state.skills.charisma;
  mayor.perform('speech');
  assert.equal(mayor.state.skills.charisma, Math.min(100, skill0 + 3), 'skills grow 50% faster');
  // A regent stands in with at least 50 in every skill; an heir starts with 10 more.
  const regent = mayor.successor({ ...sim.life.char, age: 10 });
  for (const v of Object.values(regent.skills)) assert.ok(v >= 50);
  const grown = { ...sim.life.char, age: 30, alive: true };
  const plain = mayor.skillsOf(grown);
  const heir = mayor.successor(grown);
  for (const k of Object.keys(plain)) assert.equal(heir.skills[k], Math.min(100, plain[k] + 10), k);
  sim.skills.learn('shrewdMayor');
  sim.refresh();
  assert.ok(mayor.fundsAmount(1, 100) > funds0);
});

// ---- Saving --------------------------------------------------------------------------------------

test('upgrades, eras and generations seen survive saving and loading; an older save keeps its points', () => {
  const env = town(10);
  rich(env.sk, 400);
  env.city.systems.era = { ...(env.city.systems.era || {}), index: 2 };
  env.city.systems.life = { ...(env.city.systems.life || {}), char: { ...(env.city.systems.life?.char || {}), generation: 3 } };
  learn(env, 'taxOffice', 'gardeners', 'roadMenders', 'guilds', 'clerks');
  void env.sk.earned();
  P.setActiveSlot(1);
  assert.ok(P.saveCity(env.city, 1));
  const back = P.loadCity(1);
  const sim2 = new Simulation(back);
  sim2.refresh();
  assert.deepEqual(sim2.skills.learned, ['taxOffice', 'gardeners', 'roadMenders', 'guilds', 'clerks']);
  assert.equal(back.derived.skills.residentTax, 1.1);
  assert.equal(back.derived.skills.roadCapacity, 1.15);
  assert.equal(back.systems.skills.peakEra, 2);
  assert.equal(back.systems.skills.peakGen, 3);
  // A town saved before upgrades existed.
  delete back.systems.skills;
  const sk3 = new Skills(back);
  assert.deepEqual(sk3.learned, []);
  assert.equal(sk3.state.peak, back.stats.population);
  assert.ok(sk3.available() >= 1);
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
