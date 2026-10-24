// Run with: node --test tests/
// Diplomacy: war has to be declared before raids and attacks; treaties, trust and reputation;
// negotiations with counteroffers; peace terms that are kept; mayors who decide for themselves and
// whose personalities change with what happens.
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
const { traitWords, makeLeader } = await import('../src/diplomacy.js');
const { mulberry32 } = await import('../src/utils.js');
const P = await import('../src/persistence.js');

function setup(seed = 3) {
  const city = new CityState(32, 32);
  generateTown(city, seed);
  const sim = new Simulation(city);
  sim.refresh();
  const world = new World(city, sim, { rand: mulberry32(seed) });
  const war = new WarRoom(world, { rand: mulberry32(seed + 1) });
  const cpu = world.neighbours[0];
  return { city, sim, world, war, d: war.diplomacy, cpu, id: cpu.id };
}

// Let `days` of game time pass for diplomacy only.
function pass(env, days) {
  const { city, d } = env;
  for (let i = 0; i < days * 20; i++) {
    city.clock += 0.05;
    if (city.clock >= 1) {
      city.clock -= 1;
      city.day++;
    }
    d.update(0.05);
  }
}

test('every computer town has a mayor with a personality; a new world starts without war', () => {
  const { d, cpu, id } = setup();
  const L = d.leader(cpu);
  assert.match(L.name, /^\S+ \S+$/);
  for (const k of ['aggression', 'greed', 'honour', 'caution']) assert.ok(L.traits[k] >= 0.2 && L.traits[k] <= 0.8);
  assert.equal(d.stance(id), 'neutral');
  assert.equal(d.rel(id).trust, 0);
  assert.equal(d.reputation, 60);
  assert.deepEqual(makeLeader(42), makeLeader(42), 'the same town always gets the same mayor');
  assert.ok(Array.isArray(traitWords({ aggression: 0.9, greed: 0.1, honour: 0.5, caution: 0.5 })));
  assert.deepEqual(traitWords({ aggression: 0.9, greed: 0.1, honour: 0.5, caution: 0.5 }), ['warlike', 'generous']);
});

test('a save from before diplomacy keeps an ongoing war going, and is otherwise at peace', () => {
  const env = setup(4);
  const { war, cpu, id, city } = env;
  // As a Phase 1 save looked: a raid already on its way, and no diplomacy data yet.
  while (cpu.military.fit().length < 4) cpu.military.addSoldier('rifleman');
  war.launch(cpu, cpu.military.fit().slice(0, 3));
  delete city.systems.diplomacy;
  assert.equal(war.diplomacy.stance(id), 'war');
  // Without a raid or a battle, the same save starts with no treaty and no war.
  war.state.raids = [];
  delete city.systems.diplomacy;
  assert.equal(war.diplomacy.stance(id), 'neutral');
});

test('no war, no raids and no attacks; declaring war allows both', () => {
  const { war, d, cpu, id, city } = setup(5);
  const m = war.military;
  m.state.since = -10;
  while (cpu.military.fit().filter((s) => !s.post).length < 6) cpu.military.addSoldier('rifleman');
  city.day = 5;
  assert.equal(war.planRaid(cpu), null, 'no raid without a war');
  m.state.funds = 3000;
  for (let i = 0; i < 4; i++) m.recruit('rifleman', { emergency: true });
  assert.match(war.attackError(cpu), /not at war/);
  const r = d.declareWar(id, 'you');
  assert.ok(r.ok);
  assert.equal(r.broken, false);
  assert.equal(d.stance(id), 'war');
  assert.equal(war.attackError(cpu), null);
  cpu.military.state.nextRaidAt = 0;
  assert.ok(war.planRaid(cpu), 'they raid you once at war');
  assert.match(d.declareWar(id, 'you').error, /Already/);
  assert.ok(d.rel(id).trust <= -25, 'they think less of you for it');
});

test('breaking a treaty is a betrayal: every mayor trusts you less and your reputation suffers', () => {
  const { d, id } = setup(6);
  d.sign(id, { kind: 'pact', days: 7 }, 'you');
  assert.equal(d.stance(id), 'pact');
  const trust = d.rel(id).trust;
  const rep = d.reputation;
  const r = d.declareWar(id, 'you');
  assert.equal(r.broken, true);
  assert.equal(d.reputation, rep - 25);
  assert.equal(d.rel(id).trust, Math.max(-100, trust - 60));
  assert.equal(d.treaties(id).length, 0, 'the pact is gone');
  assert.match(d.rel(id).log[0].text, /breaking the non-aggression pact/);
});

test('negotiating peace: they accept a fair offer, counter a poor one, and stop talking when pushed', () => {
  const env = setup(7);
  const { d, id, cpu, sim } = env;
  d.declareWar(id, 'them');
  const L = d.leader(cpu).traits;
  Object.assign(L, { aggression: 0.5, greed: 0.5, honour: 0.5, caution: 0.5 });
  const r = d.rel(id);
  // Fresh war: plain peace isn't enough for them.
  const first = d.propose(id, { kind: 'peace', days: 4 });
  assert.equal(first.outcome, 'countered');
  assert.ok(first.counter.pay > 0, 'they ask for money');
  // Asking them to pay a fortune: they won't hear of it.
  sim.economy.state.money = 50000;
  cpu.sim.economy.state.money = 50000;
  const greedy = d.propose(id, { kind: 'peace', pay: -9000, days: 4 });
  assert.equal(greedy.outcome, 'rejected');
  // A third poor offer and they stop talking for a day.
  const third = d.propose(id, { kind: 'peace', pay: -9000, days: 4 });
  assert.equal(third.outcome, 'closed');
  assert.ok(r.closedUntil > d.now());
  assert.equal(d.propose(id, { kind: 'peace', pay: 5000 }).outcome, 'closed');
  // A day later they'll listen again, and a generous offer ends the war.
  pass(env, 1.1);
  const deal = d.propose(id, { kind: 'peace', pay: first.counter.pay + 500, days: 4 });
  assert.equal(deal.outcome, 'accepted');
  assert.equal(d.stance(id), 'peace');
  assert.equal(d.atWar(id), false);
});

test('taking a counteroffer signs it and moves the money', () => {
  const { d, id, cpu, sim } = setup(8);
  d.declareWar(id, 'them');
  Object.assign(d.leader(cpu).traits, { aggression: 0.6, greed: 0.7, honour: 0.5, caution: 0.4 });
  sim.economy.state.money = 20000;
  const res = d.propose(id, { kind: 'peace', days: 4 });
  assert.equal(res.outcome, 'countered');
  const ours = sim.economy.money;
  const theirs = cpu.sim.economy.money;
  assert.ok(d.acceptCounter(id).ok);
  assert.equal(d.stance(id), 'peace');
  assert.equal(Math.round(ours - sim.economy.money), res.counter.pay);
  assert.equal(Math.round(cpu.sim.economy.money - theirs), res.counter.pay);
});

test('peace calls off raids on the way and protects both bases; its terms are kept', () => {
  const env = setup(9);
  const { war, d, id, cpu, sim } = env;
  d.declareWar(id, 'them');
  while (cpu.military.fit().length < 6) cpu.military.addSoldier('rifleman');
  const raid = war.launch(cpu, cpu.military.fit().slice(0, 4));
  assert.equal(war.coming(), raid);
  sim.economy.state.money = 5000;
  cpu.sim.economy.state.money = 5000;
  // You pay $100 a day for 3 days, and your army is kept to 4 for 3 days.
  const t = d.sign(id, { kind: 'peace', days: 4, tribute: { perDay: 100, days: 3 }, limit: { on: 'you', soldiers: 4, days: 3 } }, 'them');
  assert.equal(war.coming(), null, 'the raid turned back');
  assert.ok(cpu.military.state.soldiers.every((s) => s.status !== 'raiding'));
  assert.ok(war.military.state.protectedUntil >= d.now() + 3.9);
  assert.ok(cpu.military.state.protectedUntil >= d.now() + 3.9);
  assert.ok(t.until >= d.now() + 3.9);
  // The army cap is enforced on recruiting.
  const m = war.military;
  m.state.funds = 5000;
  while (m.state.soldiers.length < 4) m.recruit('rifleman', { emergency: true });
  assert.match(m.recruitError('rifleman', { emergency: true }), /treaty with .* keeps your army to 4/);
  // Tribute flows day by day.
  const before = sim.economy.money;
  pass(env, 2);
  assert.ok(before - sim.economy.money >= 199 && before - sim.economy.money <= 201, `paid ${before - sim.economy.money}`);
  // When the terms run out, the cap lifts and the treaty ends.
  pass(env, 3);
  assert.equal(m.recruitError('rifleman', { emergency: true }), null);
  assert.equal(d.stance(id), 'neutral');
});

test('mayors decide for themselves: war when hostile, peace when worn down, surrender demands when winning', () => {
  const env = setup(10);
  const { war, d, id, cpu, city } = env;
  war.military.state.since = -10;
  city.day = 6;
  d.rand = () => 0;
  Object.assign(d.leader(cpu).traits, { aggression: 0.9, greed: 0.8, honour: 0.5, caution: 0.1 });
  while (cpu.military.state.soldiers.length < 8) cpu.military.addSoldier('rifleman');
  d.rel(id).trust = -40;
  let declared = null;
  d.onEvent = (e) => {
    if (e.kind === 'war') declared = e;
  };
  d.think(cpu);
  assert.equal(declared?.by, 'them', 'a warlike, greedy mayor with the troops declares war');
  // Winning two battles: a greedy mayor demands your surrender.
  d.recordBattle(id, { winner: 'them', lost: { you: 3, them: 0 }, loot: { them: 500 } });
  d.recordBattle(id, { winner: 'them', lost: { you: 3, them: 1 }, loot: { them: 500 } });
  d.rel(id).nextOffer = 0;
  d.think(cpu);
  const demand = d.rel(id).offer;
  assert.ok(demand?.surrender, 'surrender demanded');
  assert.ok(demand.pay > 0 && demand.limit?.on === 'you');
  assert.ok(d.respond(id, false).ok);
  assert.ok(d.rel(id).nextOffer >= d.now() + 3 - 1e-9, 'they wait before asking again');
  // Worn down by losses, they sue for peace.
  const fresh = setup(11);
  fresh.d.declareWar(fresh.id, 'them');
  Object.assign(fresh.d.leader(fresh.cpu).traits, { aggression: 0.3, greed: 0.4, honour: 0.5, caution: 0.6 });
  for (let i = 0; i < 4; i++) fresh.d.recordBattle(fresh.id, { winner: 'you', lost: { you: 0, them: 4 }, loot: {} });
  fresh.d.rel(fresh.id).nextOffer = 0;
  fresh.d.think(fresh.cpu);
  const offer = fresh.d.rel(fresh.id).offer;
  assert.equal(offer?.kind, 'peace');
  assert.ok(!offer.surrender);
  assert.ok(offer.pay <= 0, 'the losing side pays, if anyone does');
  assert.ok(fresh.d.respond(fresh.id, true).ok);
  assert.equal(fresh.d.stance(fresh.id), 'peace');
});

test('with raids off, or in your first days, nobody declares war on you', () => {
  const { war, d, cpu, id, city } = setup(12);
  d.rand = () => 0;
  Object.assign(d.leader(cpu).traits, { aggression: 0.95, greed: 0.95, honour: 0.1, caution: 0.05 });
  d.rel(id).trust = -80;
  while (cpu.military.state.soldiers.length < 10) cpu.military.addSoldier('rifleman');
  city.day = 1;
  d.think(cpu);
  assert.equal(d.atWar(id), false, 'not in the first days');
  city.day = 9;
  war.military.state.raids = 'off';
  d.think(cpu);
  assert.equal(d.atWar(id), false, 'not with raids off');
  war.military.state.raids = 'gentle';
  d.think(cpu);
  assert.equal(d.atWar(id), true);
});

test('personalities change with what happens; gifts and kept peace build trust', () => {
  const env = setup(13);
  const { d, cpu, id, sim } = env;
  const L = d.leader(cpu).traits;
  Object.assign(L, { aggression: 0.5, greed: 0.5, honour: 0.5, caution: 0.5 });
  d.declareWar(id, 'them');
  d.recordBattle(id, { winner: 'them', lost: { you: 2, them: 0 }, loot: {} });
  assert.ok(L.aggression > 0.5, 'winning makes them bolder');
  d.recordBattle(id, { winner: 'you', lost: { you: 0, them: 3 }, loot: {} });
  d.recordBattle(id, { winner: 'you', lost: { you: 0, them: 3 }, loot: {} });
  const caution = L.caution;
  d.sign(id, { kind: 'peace', days: 4 }, 'you');
  assert.ok(L.caution > caution, 'a lost war teaches caution');
  sim.economy.state.money = 5000;
  const trust = d.rel(id).trust;
  assert.ok(d.gift(id, 1000).ok);
  assert.ok(d.rel(id).trust > trust + 5);
  const t2 = d.rel(id).trust;
  pass(env, 3);
  assert.ok(d.rel(id).trust > t2, 'trust grows while the peace holds');
  assert.ok(L.aggression < 0.53, 'long peace softens them');
});

test('alliances need trust, and can be left without a war', () => {
  const { d, id, cpu } = setup(14);
  Object.assign(d.leader(cpu).traits, { aggression: 0.3, greed: 0.4, honour: 0.7, caution: 0.6 });
  d.sign(id, { kind: 'pact', days: 7 }, 'you');
  const low = d.propose(id, { kind: 'alliance' });
  assert.notEqual(low.outcome, 'accepted', 'not while they hardly know you');
  d.rel(id).trust = 80;
  d.rel(id).patience = 3;
  assert.equal(d.propose(id, { kind: 'alliance' }).outcome, 'accepted');
  assert.equal(d.stance(id), 'alliance');
  assert.ok(d.endAlliance(id).ok);
  assert.notEqual(d.stance(id), 'alliance');
  assert.equal(d.reputation, 60, 'leaving an alliance is no betrayal');
});

test('treaties, trust, mayors and wars survive saving and loading', () => {
  const { city, d, id, cpu } = setup(15);
  d.sign(id, { kind: 'pact', days: 9 }, 'you');
  d.rel(id).trust = 33;
  const name = d.leader(cpu).name;
  P.setActiveSlot(1);
  assert.ok(P.saveCity(city, 1));
  const back = P.loadCity(1);
  const sim2 = new Simulation(back);
  sim2.refresh();
  const world2 = new World(back, sim2);
  const war2 = new WarRoom(world2);
  const d2 = war2.diplomacy;
  const c2 = world2.neighbours[0];
  assert.equal(d2.stance(c2.id), 'pact');
  assert.equal(d2.rel(c2.id).trust, 33);
  assert.equal(d2.leader(c2).name, name);
});
