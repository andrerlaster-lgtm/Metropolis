// Run with: node --test tests/
// The mayor: your main person's father leads the town, with daily duties that really change it,
// and the family keeps the office: your main person takes over as an adult, a relative until then.
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
const { Mayor, ACTIONS_PER_DAY, ADULT, DUTIES } = await import('../src/mayor.js');
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
  const mayor = new Mayor(city, { life: () => sim.life, economy: () => sim.economy, decisions: () => sim.decisions, war: () => war, rand: mulberry32(seed + 2) });
  mayor.update();
  return { city, sim, world, war, mayor, cpu: world.neighbours[0] };
}

const nextDay = (env) => {
  env.city.day += 1;
  env.mayor.update();
};

test('your main person’s father is the mayor, with three actions a day', () => {
  const { sim, mayor } = setup();
  const st = mayor.state;
  assert.equal(st.who, 'father');
  assert.equal(st.name, sim.life.char.family.father.name);
  assert.equal(st.actions, ACTIONS_PER_DAY);
  assert.match(mayor.relation(), /Ada’s father/);
  assert.equal(mayor.title(), 'Mayor');
  for (const k of ['charisma', 'business', 'command', 'diplomacy']) assert.ok(st.skills[k] >= 30 && st.skills[k] <= 55, k);
  assert.deepEqual(DUTIES.filter((d) => d.core).map((d) => d.id), ['speech', 'fundraiser', 'inspect', 'envoy']);
  assert.equal(DUTIES.length, 16);
});

test('a speech makes homes happier for two days, through the town’s spirit', () => {
  const env = setup(4);
  const { city, sim, mayor } = env;
  sim.decisions.update();
  const before = city.derived.spirit || 0;
  const r = mayor.perform('speech');
  assert.ok(r.text);
  sim.decisions.update();
  assert.ok(city.derived.spirit > before);
  city.day += 3;
  sim.decisions.update();
  assert.equal(city.derived.spirit || 0, before, 'it wears off');
});

test('a fundraiser brings in money; each duty once a day, three a day, skills grow with use', () => {
  const env = setup(5);
  const { sim, mayor } = env;
  const m0 = sim.economy.money;
  const b0 = mayor.state.skills.business;
  assert.ok(mayor.perform('fundraiser').text);
  assert.ok(sim.economy.money > m0);
  assert.equal(mayor.state.skills.business, b0 + 2);
  assert.match(mayor.perform('fundraiser').error, /Already done today/);
  mayor.perform('speech');
  mayor.perform('envoy');
  assert.equal(mayor.state.actions, 0);
  assert.match(mayor.perform('inspect').error, /No actions left/);
  nextDay(env);
  assert.equal(mayor.state.actions, ACTIONS_PER_DAY);
  assert.ok(mayor.perform('fundraiser').text);
});

test('inspecting the base drills the soldiers and patches damaged defences', () => {
  const env = setup(6);
  const m = env.war.military;
  const hq = m.hq;
  hq.hp = Math.round(maxHpOf('hq') / 2);
  const xp0 = m.fit().map((s) => s.xp);
  const r = env.mayor.perform('inspect');
  assert.match(r.text, /drilled/);
  m.fit().forEach((s, i) => assert.ok(s.xp > xp0[i]));
  assert.ok(hq.hp > Math.round(maxHpOf('hq') / 2));
});

test('meeting the neighbour’s mayor builds trust, less so at war', () => {
  const env = setup(7);
  const dip = env.war.diplomacy;
  const id = env.cpu.id;
  const t0 = dip.rel(id).trust;
  env.mayor.perform('envoy');
  const peaceGain = dip.rel(id).trust - t0;
  assert.ok(peaceGain > 0);
  dip.declareWar(id, 'you');
  nextDay(env);
  const t1 = dip.rel(id).trust;
  env.mayor.perform('envoy');
  assert.ok(dip.rel(id).trust - t1 < peaceGain);
});

test('when the father dies, a relative stands in until your main person turns 18, then they lead', () => {
  const env = setup(8);
  const { sim, mayor } = env;
  const c = sim.life.char;
  const seen = [];
  env.city.on((ev) => ev.type === 'mayorChanged' && seen.push(ev));
  c.family.father.alive = false;
  mayor.update();
  assert.equal(mayor.state.who, 'regent');
  assert.equal(mayor.title(), 'Acting mayor');
  assert.ok(mayor.state.name.endsWith(' Lark'));
  assert.match(mayor.relation(), /until Ada turns 18/);
  assert.equal(seen.length, 1);
  c.age = ADULT;
  mayor.update();
  assert.equal(mayor.state.who, 'you');
  assert.equal(mayor.state.name, 'Ada Lark');
  assert.equal(mayor.relation(), 'You');
  assert.equal(seen.length, 2);
});

test('when you are mayor and die, your heir takes over (or a relative while they are young)', () => {
  const env = setup(9);
  const { sim, mayor } = env;
  const c = sim.life.char;
  c.family.father.alive = false;
  c.age = 40;
  mayor.update();
  assert.equal(mayor.state.who, 'you');
  c.children.push({ name: 'Bo Lark', age: 25, pronouns: 'he', alive: true });
  sim.life.die('old age');
  mayor.update();
  assert.equal(mayor.state.who, 'you', 'still in office while the story waits to go on');
  sim.life.continueAsChild();
  mayor.update();
  assert.equal(mayor.state.who, 'you');
  assert.equal(mayor.state.name, 'Bo Lark');
});

test('a town with no main person has a founding mayor until one is born', () => {
  const env = setup(10, { life: false });
  assert.equal(env.mayor.state.who, 'founder');
  env.sim.life.create({ first: 'Cy', last: 'Moss' });
  env.mayor.update();
  assert.equal(env.mayor.state.who, 'father');
  assert.equal(env.mayor.state.name, env.sim.life.char.family.father.name);
});

test('the mayor survives saving and loading', () => {
  const env = setup(11);
  env.mayor.perform('fundraiser');
  const name = env.mayor.state.name;
  P.setActiveSlot(1);
  assert.ok(P.saveCity(env.city, 1));
  const back = P.loadCity(1);
  const sim2 = new Simulation(back);
  sim2.refresh();
  const m2 = new Mayor(back, { life: () => sim2.life, economy: () => sim2.economy, decisions: () => sim2.decisions });
  m2.update();
  assert.equal(m2.state.name, name);
  assert.equal(m2.state.who, 'father');
  assert.equal(m2.state.done.fundraiser, true);
  assert.equal(m2.state.log.length, 1);
});
