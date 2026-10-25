// Run with: node --test tests/
// Auto mode for your two people (the child's activities, the mayor's duties), and how the way the
// child grows up decides how good a mayor they'll be.
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
const { Mayor, ACTIONS_PER_DAY, DUTY } = await import('../src/mayor.js');
const { Autopilot, scoreActivity, ACTIVITY_GAINS } = await import('../src/autopilot.js');
const { mulberry32 } = await import('../src/utils.js');
const P = await import('../src/persistence.js');

function setup(seed = 3) {
  const city = new CityState(32, 32);
  generateTown(city, seed);
  const sim = new Simulation(city);
  sim.life.rng = mulberry32(seed);
  sim.refresh();
  const world = new World(city, sim, { rand: mulberry32(seed) });
  const war = new WarRoom(world, { rand: mulberry32(seed + 1) });
  sim.life.create({ first: 'Ada', last: 'Lark', traits: ['curious', 'calm'] });
  const mayor = new Mayor(city, { life: () => sim.life, economy: () => sim.economy, decisions: () => sim.decisions, war: () => war, rand: mulberry32(seed + 2) });
  mayor.update();
  const auto = new Autopilot(city, { life: () => sim.life, mayor: () => mayor });
  return { city, sim, war, mayor, auto, c: sim.life.char };
}

test('auto mode is off until you turn it on', () => {
  const env = setup();
  env.c.age = 10;
  env.c.energy = 2;
  env.c.yearProgress = 0.9;
  env.city.clock = 0.9;
  assert.deepEqual(env.auto.update(), []);
  assert.equal(env.auto.state.kid.on, false);
  assert.equal(env.auto.state.mayor.on, false);
});

test('the child picks activities that match the focus', () => {
  const c = { stats: { happiness: 50, health: 50, smarts: 30, looks: 50 }, yearActs: {} };
  const offers = ['study', 'exercise', 'rest', 'babysit', 'overtime'].map((id) => ({ id, cost: 0 }));
  const best = (focus) => offers.slice().sort((a, b) => scoreActivity(b, focus, c) - scoreActivity(a, focus, c))[0].id;
  assert.equal(best('smarts'), 'study');
  assert.equal(best('health'), 'exercise');
  assert.equal(best('happiness'), 'rest');
  assert.equal(best('money'), 'overtime');
  assert.equal(best('balanced'), 'study', 'smarts is the lowest');
  assert.ok(!('job_hunt' in ACTIVITY_GAINS) && !('buy_home' in ACTIVITY_GAINS), 'choices that open a card are left to you');
  const fresh = scoreActivity({ id: 'study', cost: 0 }, 'smarts', c);
  c.yearActs.study = 2;
  assert.ok(scoreActivity({ id: 'study', cost: 0 }, 'smarts', c) < fresh / 2, 'doing it again the same year is worth less');
});

test('the child uses their activities through the year, not all at once', () => {
  const env = setup(4);
  const { c, auto } = env;
  auto.set('kid', { on: true, focus: 'smarts' });
  c.age = 10;
  c.energy = 2;
  c.yearProgress = 0.1;
  assert.deepEqual(auto.update(), []);
  c.yearProgress = 0.4;
  const done = auto.update();
  assert.equal(done.length, 1);
  assert.equal(done[0].who, 'kid');
  assert.equal(done[0].activity, 'study');
  assert.equal(c.energy, 1);
  assert.deepEqual(auto.update(), [], 'the next one waits for later in the year');
  c.yearProgress = 0.7;
  assert.equal(auto.update().length, 1);
  assert.equal(c.energy, 0);
});

test('the mayor does the day’s duties in the order the focus sets, spread over the day', () => {
  const env = setup(5);
  const { auto, mayor, city, sim } = env;
  auto.set('mayor', { on: true, focus: 'money' });
  city.clock = 0.1;
  assert.deepEqual(auto.update(), []);
  const m0 = sim.economy.money;
  city.clock = 0.3;
  const first = auto.update();
  assert.equal(first[0].duty, 'fundraiser');
  assert.ok(sim.economy.money > m0);
  city.clock = 0.55;
  // The focus's own duties come first: another money duty if one is on offer today.
  const second = auto.update()[0].duty;
  assert.ok(DUTY[second].tags.includes('money') || mayor.offered().every((d) => d.id === second || d.id === 'fundraiser' || !d.tags.includes('money')), second);
  city.clock = 0.8;
  assert.ok(auto.update()[0].duty);
  assert.equal(mayor.state.actions, 0);
  assert.deepEqual(auto.update(), []);
  // A new day: actions come back and the order starts again.
  city.day += 1;
  city.clock = 0.3;
  assert.equal(auto.update()[0].duty, 'fundraiser');
  assert.equal(mayor.state.actions, ACTIONS_PER_DAY - 1);
});

test('a balanced mayor starts with a different duty each day', () => {
  const env = setup(6);
  const { auto, city } = env;
  auto.set('mayor', { on: true, focus: 'balanced' });
  const firsts = new Set();
  for (let d = 0; d < 4; d++) {
    city.day += 1;
    city.clock = 0.3;
    firsts.add(auto.update()[0]?.duty);
  }
  assert.ok(firsts.size >= 3);
});

test('how the child grows up decides how good a mayor they will be', () => {
  const env = setup(7);
  const { mayor } = env;
  const base = { traits: [], friends: [], stats: { happiness: 40, health: 40, smarts: 30, looks: 40 }, money: 0 };
  const raised = { traits: ['outgoing', 'calm'], friends: [{}, {}, {}, {}], job: { level: 2 }, partner: {}, money: 30000, stats: { happiness: 85, health: 80, smarts: 90, looks: 75 } };
  const a = mayor.skillsOf(base);
  const b = mayor.skillsOf(raised);
  for (const k of ['charisma', 'business', 'command', 'diplomacy']) assert.ok(b[k] >= a[k] + 20, `${k}: ${a[k]} → ${b[k]}`);
  // While the father leads, the Town hall can show what your main person would bring.
  assert.deepEqual(mayor.prospects(), mayor.skillsOf(env.c));
});

test('auto settings survive saving and loading', () => {
  const env = setup(8);
  env.auto.set('kid', { on: true, focus: 'health' });
  env.auto.set('mayor', { on: true, focus: 'diplomacy' });
  P.setActiveSlot(1);
  assert.ok(P.saveCity(env.city, 1));
  const back = P.loadCity(1);
  const a2 = new Autopilot(back, {});
  assert.deepEqual(a2.state.kid, { on: true, focus: 'health', events: 'ask' }); // life events wait for you unless set
  assert.deepEqual(a2.state.mayor, { on: true, focus: 'diplomacy' });
});
