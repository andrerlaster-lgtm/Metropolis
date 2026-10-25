// Run with: node --test tests/
// Mayor duties (Phase 6): sixteen in all, four everyday and twelve opportunities that rotate each day,
// each with a real effect; three actions a day.
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
const { Mayor, ACTIONS_PER_DAY, OPPORTUNITIES, DUTIES } = await import('../src/mayor.js');
const { maxHpOf } = await import('../src/militaryData.js');
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


const EXTRAS = DUTIES.filter((d) => !d.core).map((d) => d.id);
const today = (env) => Math.floor(env.city.day + env.city.clock);
// Put every opportunity on offer and give the mayor plenty of actions.
function openAll(env) {
  env.mayor.state.offered = { day: today(env), ids: EXTRAS.slice() };
  env.mayor.state.actions = 20;
  env.sim.economy.state.money = 100000;
}

test('sixteen duties: four everyday ones always, and a few opportunities that change each day', () => {
  const env = setup(3);
  const { mayor } = env;
  assert.equal(DUTIES.length, 16);
  assert.equal(EXTRAS.length, 12);
  const first = mayor.offered().map((d) => d.id);
  assert.deepEqual(first.slice(0, 4), ['speech', 'fundraiser', 'inspect', 'envoy']);
  assert.equal(first.length, 4 + OPPORTUNITIES);
  assert.deepEqual(mayor.offered().map((d) => d.id), first, 'the same all day');
  assert.deepEqual(JSON.parse(JSON.stringify(mayor.state)).offered.ids.slice().sort(), first.slice(4).sort(), 'saved with the mayor');
  const seen = new Set();
  for (let d = 0; d < 10; d++) {
    env.city.day += 1;
    mayor.update();
    const ids = mayor.offered().map((x) => x.id);
    assert.deepEqual(ids.slice(0, 4), first.slice(0, 4));
    ids.slice(4).forEach((id) => seen.add(id));
  }
  assert.ok(seen.size >= 9, `${seen.size} different opportunities over ten days`);
});

test('three actions a day by default, four with a Town council; not-on-offer duties are refused', () => {
  const env = setup(3);
  assert.equal(env.mayor.actionsPerDay(), ACTIONS_PER_DAY);
  assert.equal(ACTIONS_PER_DAY, 3);
  env.city.derived.skills = { actions: 1 };
  assert.equal(env.mayor.actionsPerDay(), 4);
  env.city.derived.skills = {};
  const off = EXTRAS.find((id) => !env.mayor.offered().some((d) => d.id === id));
  assert.match(env.mayor.perform(off).error, /Not on offer today/);
});

test('an old save without opportunities gets today’s the first time', () => {
  const env = setup(4);
  delete env.mayor.state.offered;
  assert.equal(env.mayor.offered().length, 4 + OPPORTUNITIES);
});

test('a festival costs money and lifts spirits for three days; a tour is free and lighter', () => {
  const env = setup(5);
  openAll(env);
  const eco = env.sim.economy;
  const m0 = eco.state.money;
  const n0 = env.sim.decisions.state.effects.length;
  assert.match(env.mayor.perform('festival').text, /festival/);
  assert.ok(eco.state.money < m0 && env.sim.decisions.state.effects.length === n0 + 1);
  const big = env.sim.decisions.state.effects.at(-1).amount;
  const m1 = eco.state.money;
  env.mayor.perform('tour');
  assert.equal(eco.state.money, m1);
  assert.ok(env.sim.decisions.state.effects.at(-1).amount < big);
  eco.state.money = 0;
  env.city.systems.mode = 'milestones';
  assert.match(env.mayor.perform('festival').error || '', /Needs \$|Already/);
});

test('a ribbon speeds growth, scholars bring the next era closer, greening plants trees', () => {
  const env = setup(6);
  openAll(env);
  const boosts = env.sim.growth.state.boosts.length;
  env.mayor.perform('ribbon');
  assert.equal(env.sim.growth.state.boosts.length, boosts + 1);
  const years = env.sim.eras.state.bonusYears || 0;
  const m0 = env.sim.economy.state.money;
  env.sim.eras.state.index = 1;
  env.mayor.perform('scholars');
  assert.equal(env.sim.eras.state.bonusYears, years + 1);
  assert.ok(env.sim.economy.state.money < m0);
  const trees = () => env.city.tiles.filter((t) => t.structure?.type === 'tree').length;
  const t0 = trees();
  const r = env.mayor.perform('greening');
  assert.ok(r.text);
  assert.ok(trees() >= t0);
});

test('a grant, trade and a market day bring money; trade also builds trust', () => {
  const env = setup(7);
  openAll(env);
  const eco = env.sim.economy;
  const dip = env.war.diplomacy;
  let m = eco.state.money;
  env.mayor.perform('grant');
  assert.ok(eco.state.money > m, 'grant');
  m = eco.state.money;
  const t0 = dip.rel(env.cpu.id).trust;
  env.mayor.perform('trade');
  assert.ok(eco.state.money > m && dip.rel(env.cpu.id).trust > t0, 'trade');
  m = eco.state.money;
  assert.ok(env.city.tiles.some((t) => t.structure?.type === 'shop'), 'the test town has shops');
  env.mayor.perform('market_day');
  assert.ok(eco.state.money > m, 'market day');
});

test('a parade drills the soldiers; resupply mends defences for a price', () => {
  const env = setup(8);
  openAll(env);
  const m = env.war.military;
  const xp0 = m.fit().map((s) => s.xp);
  env.mayor.perform('parade');
  m.fit().forEach((s, i) => assert.ok(s.xp > xp0[i]));
  m.hq.hp = Math.round(maxHpOf('hq') / 3);
  const cash = env.sim.economy.state.money;
  env.mayor.perform('supply');
  assert.ok(m.hq.hp > Math.round(maxHpOf('hq') / 3));
  assert.ok(env.sim.economy.state.money < cash);
  assert.match(env.mayor.perform('supply').error || '', /Already|Nothing needs/);
});

test('a summit and a gift build trust with the neighbours', () => {
  const env = setup(9);
  openAll(env);
  const dip = env.war.diplomacy;
  const id = env.cpu.id;
  const t0 = dip.rel(id).trust;
  env.mayor.perform('summit');
  const t1 = dip.rel(id).trust;
  assert.ok(t1 > t0);
  const cash = env.sim.economy.state.money;
  env.mayor.perform('gift');
  assert.ok(dip.rel(id).trust > t1 && env.sim.economy.state.money < cash);
});

test('opportunities need what they need: no base, no neighbour, no shop, no money', () => {
  const env = setup(10);
  openAll(env);
  const noWar = new Mayor(env.city, { life: () => env.sim.life, economy: () => env.sim.economy, decisions: () => env.sim.decisions, growth: () => env.sim.growth, eras: () => env.sim.eras, war: () => null, rand: mulberry32(1) });
  assert.match(noWar.needsError('parade'), /no base/);
  assert.match(noWar.needsError('summit'), /neighbouring/);
  for (const t of env.city.tiles) if (['shop', 'market'].includes(t.structure?.type)) t.structure = null;
  assert.match(env.mayor.needsError('market_day'), /shop or a market/);
  assert.equal(env.mayor.costOf('festival') > 0, true);
  env.sim.economy.state.money = 5;
  assert.match(env.mayor.dutyError('gift') || '', /Needs \$/);
});

test('auto mode follows its focus through the new duties', async () => {
  const { Autopilot, MAYOR_FOCUS } = await import('../src/autopilot.js');
  assert.ok(MAYOR_FOCUS.some((f) => f.id === 'growth'));
  const env = setup(11);
  openAll(env);
  const auto = new Autopilot(env.city, { life: () => env.sim.life, mayor: () => env.mayor });
  for (const f of MAYOR_FOCUS.filter((x) => x.tag)) {
    auto.set('mayor', { on: true, focus: f.id });
    const id = auto.pickDuty();
    assert.ok(DUTIES.find((d) => d.id === id).tags.includes(f.tag), `${f.id} picks ${id}`);
  }
});
