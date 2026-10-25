// Run with: node --test tests/
// Legacy events: life events that depend on the era, on leading the town, on war and on the town;
// choices that reach the whole town; consequences that come back years or generations later; a
// family memory that keeps events from repeating; auto mode answering events; saving.
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
const { Autopilot } = await import('../src/autopilot.js');
const { LifeSystem } = await import('../src/life.js');
const { LIFE_EVENTS } = await import('../src/lifeEvents.js');
const { LEGACY_EVENTS } = await import('../src/legacyEvents.js');
const { isEligible } = await import('../src/lifeEngine.js');
const { ERAS, yearOf } = await import('../src/eras.js');
const { mulberry32 } = await import('../src/utils.js');

const EV = (id) => LIFE_EVENTS.find((e) => e.id === id);

function setup(seed = 3) {
  const city = new CityState(32, 32);
  generateTown(city, seed);
  const sim = new Simulation(city);
  sim.life.rng = mulberry32(seed);
  sim.refresh();
  const world = new World(city, sim, { rand: mulberry32(seed) });
  const war = new WarRoom(world, { rand: mulberry32(seed + 1) });
  const life = sim.life;
  life.create({ first: 'Ada', last: 'Lark', traits: ['curious', 'calm'] });
  const mayor = new Mayor(city, { life: () => life, economy: () => sim.economy, decisions: () => sim.decisions, war: () => war, rand: mulberry32(seed + 2) });
  mayor.update();
  life.hooks = { mayor: () => mayor, economy: () => sim.economy, decisions: () => sim.decisions, war: () => war };
  return { city, sim, world, war, mayor, life, c: life.char, cpu: world.neighbours[0] };
}
const grownUp = (c, age = 30) => {
  c.age = age;
  c.livesWithParents = false;
};
const passYears = (city, n) => {
  city.day += n;
};
// Pick the choice whose label starts with `label` and answer it.
function answer(life, label) {
  const view = life.current();
  const i = view.choices.findIndex((t) => t.startsWith(label));
  assert.ok(i >= 0, `"${label}" among ${JSON.stringify(view.choices)}`);
  return life.choose(i);
}

test('the library: every event has a kind, real eras, and every consequence leads to a real event', () => {
  const ids = new Set(LIFE_EVENTS.map((e) => e.id));
  const eraIds = new Set(ERAS.map((e) => e.id));
  const kinds = new Set(['personal', 'family', 'political', 'economic', 'military', 'social']);
  const usedKinds = new Set();
  const scheduledTargets = new Set();
  for (const ev of LEGACY_EVENTS) {
    assert.ok(kinds.has(ev.category), `${ev.id} has a kind`);
    usedKinds.add(ev.category);
    for (const e of ev.eras || []) assert.ok(eraIds.has(e), `${ev.id}: era ${e}`);
    if (typeof ev.choices === 'function') continue;
    for (const ch of ev.choices) for (const out of ch.outcomes) for (const l of [].concat(out.later || [])) {
      assert.ok(ids.has(l.event), `${ev.id} → ${l.event}`);
      assert.ok(EV(l.event).scheduled, `${l.event} only happens as a consequence`);
      scheduledTargets.add(l.event);
    }
  }
  assert.deepEqual([...usedKinds].sort(), [...kinds].sort(), 'all six kinds are represented');
  for (const ev of LEGACY_EVENTS.filter((e) => e.scheduled)) assert.ok(scheduledTargets.has(ev.id), `${ev.id} is reachable`);
  assert.ok(LEGACY_EVENTS.length >= 45);
});

test('events follow the era: gas lamps in the railway age, a motorcar in the motor age', () => {
  const { city, life, c } = setup(4);
  grownUp(c);
  city.systems.era.index = ERAS.findIndex((e) => e.id === 'railway');
  assert.ok(isEligible(EV('lx_gas_lamps'), life.ctx()));
  assert.ok(!isEligible(EV('lx_first_motorcar'), life.ctx()));
  city.systems.era.index = ERAS.findIndex((e) => e.id === 'motor');
  assert.ok(!isEligible(EV('lx_gas_lamps'), life.ctx()));
  assert.ok(isEligible(EV('lx_first_motorcar'), life.ctx()));
});

test('leading the town brings political events; a mayor in the family brings others', () => {
  const { life, c, mayor } = setup(5);
  // The father leads: the child sees family-of-the-mayor events, not the mayor's own.
  c.age = 10;
  assert.equal(life.ctx().leader, 'family');
  assert.ok(isEligible(EV('lx_mayors_kid'), life.ctx()));
  assert.ok(!isEligible(EV('lx_council_budget'), life.ctx()));
  // The father dies and the grown-up child takes office.
  c.family.father.alive = false;
  grownUp(c, 35);
  mayor.update();
  assert.equal(life.ctx().leader, 'you');
  assert.ok(isEligible(EV('lx_council_budget'), life.ctx()));
  assert.ok(isEligible(EV('lx_bribe'), life.ctx()));
  assert.ok(!isEligible(EV('lx_mayors_kid'), life.ctx()));
});

test('war brings military events, and peace a parade', () => {
  const { life, c, war, cpu } = setup(6);
  grownUp(c);
  assert.ok(!isEligible(EV('lx_call_up'), life.ctx()));
  war.diplomacy.declareWar(cpu.id, 'you');
  assert.ok(isEligible(EV('lx_call_up'), life.ctx()));
  assert.ok(!isEligible(EV('lx_peace_parade'), life.ctx()));
  war.diplomacy.sign(cpu.id, { kind: 'peace', days: 3 }, 'you');
  assert.ok(isEligible(EV('lx_peace_parade'), life.ctx()), 'the family saw the war, and now it is over');
});

test('choices can reach the whole town: money, spirit, trust and soldiers', () => {
  const { life, c, sim, war, cpu, city } = setup(7);
  grownUp(c, 40);
  c.family.father.alive = false;
  life.hooks.mayor().update();
  const m0 = sim.economy.money;
  life.fireEvent('lx_council_budget');
  const r = answer(life, 'Raise taxes');
  assert.ok(sim.economy.money > m0);
  assert.ok(r.changes.some((ch) => ch.key === 'town' && ch.money));
  sim.decisions.update();
  assert.ok(city.derived.spirit < 0, 'grumbling: homes a little less happy for a while');
  const t0 = war.diplomacy.rel(cpu.id).trust;
  life.fireEvent('lx_envoy_dinner');
  answer(life, 'Listen carefully');
  assert.equal(war.diplomacy.rel(cpu.id).trust, t0 + 2);
  const xp0 = war.military.fit().map((s) => s.xp);
  life.fireEvent('lx_review_troops');
  answer(life, 'Give a speech');
  war.military.fit().forEach((s, i) => assert.equal(s.xp, xp0[i] + 6));
});

test('a choice comes back years later, as it was made', () => {
  for (const [label, returned] of [['Return it', true], ['Keep the cash', false]]) {
    const { life, c, city } = setup(8);
    grownUp(c, 20);
    life.fireEvent('lx_lost_wallet');
    answer(life, label);
    assert.equal(life.legacy.state.pending.length, 1);
    const due = life.legacy.state.pending[0].at;
    assert.ok(due - yearOf(city) >= 4 && due - yearOf(city) <= 10);
    // Not yet…
    life.fireEvent();
    assert.notEqual(c.pending?.id, 'lx_wallet_owner');
    c.pending = null;
    // …and then it's due, and comes before anything random.
    passYears(city, due - yearOf(city));
    life.fireEvent();
    assert.equal(c.pending.id, 'lx_wallet_owner');
    const view = life.current();
    assert.match(view.text, returned ? /returned years ago/ : /once kept/);
    assert.equal(view.echo.from, 'you');
    const out = answer(life, 'Say hello');
    assert.match(out.text, returned ? /bank manager/ : /did not go well/);
    assert.equal(life.legacy.state.pending.length, 0);
  }
});

test('consequences reach the next generation, but never an unrelated family', () => {
  const { life, c, city } = setup(9);
  grownUp(c, 40);
  life.fireEvent('lx_oak');
  answer(life, 'Plant it by the house');
  const due = life.legacy.state.pending[0].at;
  assert.ok(due - yearOf(city) >= 30);
  // Ada dies; her son carries on the family story.
  c.children.push({ name: 'Bo Lark', age: 20, pronouns: 'he', alive: true });
  life.die('old age');
  life.continueAsChild();
  passYears(city, due - yearOf(city));
  life.fireEvent();
  assert.equal(life.char.pending.id, 'lx_oak_grown');
  assert.equal(life.current().echo.from, 'your parent Ada');
  assert.match(life.current().text, /your parent Ada planted/);
  // A new, unrelated life in the same town doesn't inherit another family's consequences.
  life.char.pending = null;
  life.legacy.schedule('lx_wallet_owner', 0, { data: { returned: true }, origin: { name: 'Bo Lark', gen: 2 }, family: 'Lark' });
  life.create({ first: 'Cy', last: 'Moss' });
  life.char.age = 30;
  assert.equal(life.legacy.due('Moss').length, 0);
});

test('a family-once event happens once in the whole family line', () => {
  const { life, c } = setup(10);
  grownUp(c, 40);
  assert.ok(isEligible(EV('lx_heirloom'), life.ctx()));
  life.fireEvent('lx_heirloom');
  answer(life, 'Treasure it');
  assert.equal(life.legacy.state.heirlooms[0].name, 'the silver pocket watch');
  c.children.push({ name: 'Bo Lark', age: 30, pronouns: 'he', alive: true });
  life.die('old age');
  life.continueAsChild();
  assert.ok(!isEligible(EV('lx_heirloom'), life.ctx()), 'the heir is not handed the watch again');
});

test('events do not repeat too much: recent events and kinds give way to others', () => {
  const { life, city } = setup(11);
  grownUp(life.char, 30);
  life.char.money = 5000;
  const seq = [];
  // Two events a year for 40 years, ageing as the game does.
  for (let i = 0; i < 80; i++) {
    life.char.pending = null;
    const p = life.fireEvent();
    if (!p) continue;
    seq.push({ id: p.id, cat: LIFE_EVENTS.find((e) => e.id === p.id).category || 'life' });
    life.char.pending = null;
    if (i % 2) {
      passYears(city, 1);
      life.char.age += 1;
    }
  }
  assert.ok(seq.length >= 70, `events kept coming: ${seq.length}`);
  for (let i = 0; i < seq.length; i++) {
    const near = seq.slice(Math.max(0, i - 3), i).map((s) => s.id);
    assert.ok(!near.includes(seq[i].id), `${seq[i].id} came back within 3 events (at ${i})`);
  }
  const ids = new Set(seq.map((s) => s.id));
  assert.ok(ids.size >= 30, `variety: ${ids.size} different events in ${seq.length}`);
  // A legacy event comes back to the same person at most every 12 years.
  for (const id of ids) {
    if (!id.startsWith('lx_')) continue;
    assert.ok(seq.filter((s) => s.id === id).length <= 4, `${id} not more than 4 times in 40 years`);
  }
  // The family's memory makes a recent event much less likely.
  const ev = EV('lx_town_fair');
  const fresh = life.legacy.weightFor(ev);
  life.legacy.note(ev);
  assert.ok(life.legacy.weightFor(ev) < fresh / 5);
});

test('auto mode answers life events by its policy, or leaves them to you', () => {
  const { life, c, sim } = setup(12);
  grownUp(c, 25);
  const auto = new Autopilot(sim.city, { life: () => life, mayor: () => life.hooks.mayor() });
  auto.set('kid', { on: true, focus: 'money' });
  c.energy = 0; // no activities, just the event
  life.fireEvent('lx_gold_rumor');
  assert.deepEqual(auto.update(), [], 'Ask me: the event waits');
  assert.equal(c.pending.id, 'lx_gold_rumor');
  auto.set('kid', { events: 'safe' });
  const done = auto.update();
  assert.equal(done[0].event, 'lx_gold_rumor');
  assert.equal(c.pending, null);
  assert.match(done[0].text, /shovel/, 'the safe money choice: sell shovels, no risk of losing');
  // Bold goes for the best possible outcome.
  life.fireEvent('lx_gold_rumor');
  auto.set('kid', { events: 'bold' });
  assert.match(auto.update()[0].text, /gold dust|rocks/);
  // Which job to take (or home to buy) is always left to you.
  life.fireEvent('job_hunt');
  assert.deepEqual(auto.update(), []);
});

test('the family memory and a waiting consequence survive saving and loading; older saves start fresh', () => {
  const { life, c, city } = setup(13);
  grownUp(c, 30);
  life.fireEvent('lx_fence');
  answer(life, 'Take them to court');
  const pend = life.legacy.state.pending[0];
  passYears(city, pend.at - yearOf(city));
  life.fireEvent();
  assert.equal(c.pending.id, 'lx_feud_returns');
  const back = CityState.fromJSON(JSON.parse(JSON.stringify(city.toJSON())));
  const life2 = new LifeSystem(back);
  assert.equal(life2.current().id, 'lx_feud_returns');
  assert.equal(life2.current().echo.from, 'you');
  assert.ok(life2.legacy.recall('rival'));
  assert.ok(life2.legacy.state.seen.lx_fence != null);
  // A town saved before legacy events: no memory yet, and nothing breaks.
  delete back.systems.legacy;
  const life3 = new LifeSystem(back);
  assert.deepEqual(life3.legacy.state.pending, []);
  assert.equal(life3.current().id, 'lx_feud_returns');
});
