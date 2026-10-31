// Run with: node --test tests/
// Long-run balance: a new town (seed town, Milestones, growing by itself) and the computer's neighbour
// live 40 game days side by side, at war, with every raid fought out by auto-resolve. The same real
// systems the game runs (simulation, world, war room); Math.random is seeded, so every run is the
// same. Thresholds sit well inside what seeds 1–4 did (noted beside each) and fail on a real shift.
// Takes about 50 seconds; the other test files run alongside it.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { mulberry32 } = await import('../src/utils.js');
const SEED = 3;
Math.random = mulberry32(SEED);
const { CityState } = await import('../src/state.js');
const { generateSeed } = await import('../src/generator.js');
const { Simulation } = await import('../src/simulation.js');
const { World } = await import('../src/world.js');
const { WarRoom } = await import('../src/warRoom.js');
const { START_MONEY, DAY_LENGTH_SECONDS } = await import('../src/config.js');

const DAYS = 40;
const city = new CityState(32, 32);
generateSeed(city, SEED);
city.systems.mode = 'milestones';
const sim = new Simulation(city);
sim.economy.reset('land');
sim.refresh();
sim.eras.found();
sim.growth.on = true;
sim.agentsActive = false; // walkers and cars are only for show
sim.refreshEvery = 4; // jobs and appeal every 4 game seconds, as computer towns do (2.5): keeps the run short
const world = new World(city, sim, { rand: mulberry32(SEED + 1) });
const war = new WarRoom(world, { rand: mulberry32(SEED + 2) });
const cpu = world.neighbours[0];
cpu.sim.agentsActive = false;

const days = []; // one sample a day
const raids = [];
const low = { home: Infinity, cpu: Infinity, cpuFunds: Infinity, homeFunds: Infinity, homeHigh: 0 };
war.onArrive = (r) => {
  const before = sim.economy.money;
  const report = war.autoResolve(r);
  // What the town itself lost: most loot comes out of the military budget, not the town's money.
  raids.push({ day: city.day + city.clock, outcome: report.outcome, loot: report.you?.loot || 0, before, townLost: before - sim.economy.money });
};
sim.speed = 3;
let seen = -1;
while (city.day < DAYS) {
  sim.update(0.25);
  world.update(0.25, sim.speed);
  war.update((0.25 * sim.speed) / DAY_LENGTH_SECONDS);
  low.home = Math.min(low.home, sim.economy.money);
  low.cpu = Math.min(low.cpu, cpu.sim.economy.money);
  low.cpuFunds = Math.min(low.cpuFunds, cpu.military.funds);
  low.homeFunds = Math.min(low.homeFunds, war.military.funds);
  low.homeHigh = Math.max(low.homeHigh, sim.economy.money);
  if (city.day !== seen) {
    seen = city.day;
    days.push({
      day: city.day,
      home: { pop: city.stats?.population ?? 0, money: sim.economy.money, era: city.systems.era?.index ?? 0 },
      cpu: { pop: cpu.city.stats?.population ?? 0, money: cpu.sim.economy.money, era: cpu.city.systems.era?.index ?? 0 },
    });
  }
}
const on = (d) => days.find((s) => s.day === d);

test('your town keeps growing: several times its people by day 40, and into the third era', () => {
  // Seeds 1–4: 64–120 people on day 10, 368–621 on day 40; era 2 by day 40 in all of them.
  assert.ok(on(40).home.pop >= 250, `${on(40).home.pop} people on day 40`);
  assert.ok(on(40).home.pop >= 3 * on(10).home.pop, `from ${on(10).home.pop} to ${on(40).home.pop}`);
  assert.ok(on(40).home.era >= 2, `era ${on(40).home.era} on day 40`);
});

test('your money neither runs out nor runs away', () => {
  // The town's own growth keeps two days of upkeep (at least $250) back. Seeds 1–4: lowest $509–$1,033,
  // never a day under $250; highest about $10,000 (the start). (Without the reserve, seed 3 hit $0.)
  assert.ok(low.home >= 100, `went down to ${Math.round(low.home)}`);
  assert.ok(days.every((s) => s.home.money >= 250), 'a day ended under the $250 reserve');
  assert.ok(low.homeHigh <= 5 * START_MONEY.land, `piled up ${Math.round(low.homeHigh)}`);
});

test("the computer's town and both armies never go into debt", () => {
  assert.ok(low.cpu >= 0, `the neighbour went down to ${Math.round(low.cpu)}`);
  assert.ok(low.cpuFunds >= 0 && low.homeFunds >= 0, 'a military budget went below zero');
});

test("the computer's town keeps growing too, about as fast as yours", () => {
  // It grows by your rules (homes and businesses free, the rest paid for). Seeds 1–4: 604–697 people
  // and era 2 by day 40. (When it paid for every house and shop it stalled at about 100 people.)
  assert.ok(on(40).cpu.pop >= 300, `${on(40).cpu.pop} people on day 40`);
  assert.ok(on(40).cpu.pop >= 2 * on(10).cpu.pop, `from ${on(10).cpu.pop} to ${on(40).cpu.pop}`);
  assert.ok(on(40).cpu.pop >= 0.5 * on(40).home.pop, `${on(40).cpu.pop} people against your ${on(40).home.pop}`);
  assert.ok(on(40).cpu.era >= 2, `era ${on(40).cpu.era}`);
});

test('raids at war: spaced out, the starting garrison holds the first, and a lost raid takes a fair share', () => {
  // Seeds 1–4: raids 4–6 days apart; the first one or two held, the rest lost (nobody recruited, as
  // an idle player wouldn't). Loot comes mostly out of the military budget; the town's own money lost
  // at most $60 in a raid (seed 3).
  assert.ok(raids.length >= 3, `only ${raids.length} raids in ${DAYS} days at war`);
  for (let i = 1; i < raids.length; i++) assert.ok(raids[i].day - raids[i - 1].day >= 3, `raids ${(raids[i].day - raids[i - 1].day).toFixed(1)} days apart`);
  assert.equal(raids[0].outcome, 'held', 'the starting garrison should beat the first raid');
  for (const r of raids) assert.ok(r.townLost <= 0.25 * Math.max(r.before, 0) + 1, `a raid took ${Math.round(r.townLost)} of the town's ${Math.round(r.before)}`);
});
