// Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { CityState } from '../src/state.js';
import { Simulation } from '../src/simulation.js';
import { generateTown, generateLand } from '../src/generator.js';
import { History } from '../src/history.js';
import { COSTS, START_MONEY, DAY_LENGTH_SECONDS, STRUCTURES } from '../src/config.js';
import { Notables, threshold, NOTABLE_TYPES } from '../src/notables.js';
import { CAREERS } from '../src/lifeData.js';
import { encodeCity, decodeCity } from '../src/share.js';

function street(size = 16) {
  const city = new CityState(size, size);
  generateLand(city, 1);
  const sim = new Simulation(city);
  sim.economy.reset('land');
  for (let x = 2; x < 14; x++) city.apply('road', x, 8);
  return { city, sim };
}

test('building costs money, Sandbox is free, and undo refunds it', () => {
  const { city, sim } = street();
  const eco = sim.economy;
  assert.equal(eco.money, START_MONEY.land);
  assert.equal(eco.costOf('house'), COSTS.house);
  const history = new History(city);
  history.onMoney = (d) => (d > 0 ? eco.refund(d) : eco.spend(-d));
  history.record('house', [{ x: 3, y: 7 }], () => city.apply('house', 3, 7), { cost: COSTS.house });
  eco.spend(COSTS.house);
  assert.equal(eco.money, START_MONEY.land - COSTS.house);
  history.undo();
  assert.equal(eco.money, START_MONEY.land, 'refunded');
  history.redo();
  assert.equal(eco.money, START_MONEY.land - COSTS.house, 'charged again');
  assert.equal(eco.affordable('mall', 10), Math.floor(eco.money / COSTS.mall));
  city.systems.mode = 'sandbox';
  assert.equal(eco.costOf('mall'), 0);
  assert.ok(eco.canAfford(1e9));
});

test('residents and businesses pay taxes, services cost upkeep, and money flows each day', () => {
  const { city, sim } = street();
  for (const x of [2, 3, 4, 5, 6, 7]) city.apply('house', x, 7);
  city.apply('office', 11, 7);
  city.apply('school', 9, 9);
  sim.refresh();
  for (const h of city.homes()) h.structure.residents = 4;
  sim.refresh();
  const e = city.derived.economy;
  assert.ok(e.income.wages > 0, 'income tax on wages');
  assert.ok(e.income.office > 0, 'business tax');
  assert.ok(e.expenses.school > 0 && e.expenses.road > 0, 'upkeep');
  assert.ok(city.getTile(11, 7).earning > 0 && city.getTile(9, 9).earning < 0);
  assert.equal(e.top[0].structure.type, 'office', 'the office earns the most');
  const before = sim.economy.money;
  for (let i = 0; i < DAY_LENGTH_SECONDS / 0.25; i++) sim.update(0.25);
  const after = sim.economy.money;
  assert.ok(Math.abs(after - before - e.net) < Math.abs(e.net) * 0.25 + 5, `about a day's net (${after - before} vs ${e.net})`);
  assert.equal(sim.economy.state.days.length, 1, 'yesterday is in the ledger');
});

test('without Sandbox the town never goes below zero', () => {
  const { city, sim } = street();
  city.apply('clinic', 5, 9);
  sim.refresh();
  sim.economy.state.money = 10;
  for (let i = 0; i < 400; i++) sim.update(0.25);
  assert.equal(sim.economy.money, 0);
});

test('new buildings: cottages and apartments house people, cafés, malls and factories employ them', () => {
  assert.equal(STRUCTURES.cottage.capacity, 2);
  assert.equal(STRUCTURES.apartments.capacity, 10);
  for (const t of ['cafe', 'mall', 'factory']) assert.ok(STRUCTURES[t].jobs > 0 && CAREERS[t], t);
  const { city, sim } = street();
  city.apply('apartments', 4, 7);
  city.apply('factory', 6, 7);
  sim.refresh();
  assert.ok(city.getTile(4, 7).factors.pollution < 0, 'factory smoke bothers neighbours');
  assert.equal(city.getTile(4, 7).structure.floors >= 3, true);
});

test('a starter town uses the new buildings and has room for plenty of people', () => {
  const city = new CityState(32, 32);
  generateTown(city, 2);
  const types = new Set(city.tiles.map((t) => t.structure?.type));
  for (const t of ['cottage', 'apartments', 'cafe']) assert.ok(types.has(t), t);
  assert.ok(city.homes().length > 60, "plenty of homes");
});

test('share links keep the new buildings', async () => {
  const city = new CityState(16, 16);
  generateLand(city, 1);
  for (let x = 2; x < 14; x++) city.apply('road', x, 8);
  city.apply('cottage', 3, 7);
  city.apply('mall', 6, 7);
  const copy = await decodeCity(await encodeCity(city));
  assert.equal(copy.getTile(3, 7).structure.type, 'cottage');
  assert.equal(copy.getTile(6, 7).structure.type, 'mall');
  assert.ok(copy.getTile(6, 7).structure.variant);
});

test('notable people arrive when their kind has gathered enough inspiration', () => {
  const { city, sim } = street();
  for (const x of [2, 3, 4]) city.apply('house', x, 7);
  city.apply('school', 9, 7);
  sim.refresh();
  const arrivals = [];
  city.on((e) => e.type === 'notable' && arrivals.push(e));
  const n = sim.notables;
  const rates = n.rates();
  assert.ok(rates.scientist > 0 && rates.doctor === 0);
  // Residents come and go at random, so the rate drifts: allow up to three times the expected wait.
  const days = threshold(0) / rates.scientist + 0.5;
  for (let i = 0; i < (3 * days * DAY_LENGTH_SECONDS) / 0.25 && !arrivals.length; i++) sim.update(0.25);
  assert.equal(arrivals.length >= 1, true, `someone arrived (points ${JSON.stringify(n.state.points)}, day ${city.day}, people ${n.people.length})`);
  assert.equal(arrivals[0].person.type, 'scientist');
  assert.ok(arrivals[0].person.home, 'they live in one of the homes');
  assert.ok(threshold(1) > threshold(0), 'the next one takes longer');
});

test('notable bonuses: wider schools, more tax, cheaper building, less upkeep', () => {
  const { city, sim } = street();
  for (const x of [2, 3]) city.apply('house', x, 7);
  city.apply('school', 9, 7);
  sim.refresh();
  const far = city.getTile(9, 15); // 8 tiles from the school: just out of reach
  const before = far.coverage.school;
  for (const id of ['scientist', 'merchant', 'engineer', 'planner']) sim.notables.arrive(id);
  city.dirty = true;
  sim.refresh();
  assert.ok(far.coverage.school > before, 'school reach grows');
  assert.ok(sim.economy.modifiers.businessTax > 1);
  assert.ok(sim.economy.costOf('house') < COSTS.house);
  assert.ok(sim.economy.modifiers.upkeep < 1);
  assert.equal(NOTABLE_TYPES.length, 7);
});

test('a notable whose home is bulldozed moves to another home', () => {
  const { city, sim } = street();
  for (const x of [2, 3, 4]) city.apply('house', x, 7);
  sim.refresh();
  const p = sim.notables.arrive('artist');
  city.apply('bulldoze', p.home.x, p.home.y);
  sim.notables.syncHomes();
  const t = city.getTile(p.home.x, p.home.y);
  assert.ok(t.structure && STRUCTURES[t.structure.type].capacity > 0);
  const restored = new Notables(CityState.fromJSON(JSON.parse(JSON.stringify(city.toJSON()))));
  assert.equal(restored.people.length, 1, 'saved with the city');
});

// ---- Wages and the income tax ---------------------------------------------------------------------

test('people earn wages at their jobs, and the town takes the income tax rate you set', async () => {
  const { wageOf } = await import('../src/economy.js');
  const { TAX_RATE, WAGE_SCALE } = await import('../src/config.js');
  const city = new CityState(32, 32);
  generateTown(city, 3);
  const sim = new Simulation(city);
  sim.refresh();
  assert.equal(sim.economy.taxRate, TAX_RATE.default, 'a new town starts at the default rate');
  // A worker earns the yearly pay of that job's first rung in Life Story, per day, scaled down.
  assert.equal(wageOf('shop'), CAREERS.shop.pay[0] / WAGE_SCALE);
  let wages = 0;
  for (const t of city.tiles) if (t.workersFilled) wages += t.workersFilled * wageOf(t.structure.type);
  const e10 = city.derived.economy;
  assert.ok(Math.abs(e10.wages - wages) < 1e-6, 'the wage bill is everyone working times their wage');
  assert.ok(Math.abs(e10.income.wages - wages * 0.1) < 1e-6, 'income tax is 10% of wages');
  assert.equal(e10.income.homes, undefined, 'homes pay no flat tax');
  sim.economy.setTaxRate(20);
  sim.refresh();
  assert.ok(Math.abs(city.derived.economy.income.wages - 2 * e10.income.wages) < 1e-6, 'twice the rate, twice the income tax');
  // Kept inside 0–25%.
  assert.equal(sim.economy.setTaxRate(40), TAX_RATE.max);
  assert.equal(sim.economy.setTaxRate(-3), TAX_RATE.min);
  assert.equal(sim.economy.setTaxRate(Number.NaN), TAX_RATE.default);
});

test('low taxes make homes nicer to live in, high taxes less so', () => {
  const city = new CityState(32, 32);
  generateTown(city, 11);
  const sim = new Simulation(city);
  const at = (r) => {
    sim.economy.setTaxRate(r);
    sim.refresh();
    return city.stats.happiness;
  };
  const low = at(0);
  const normal = at(10);
  const high = at(25);
  assert.ok(low > normal && normal > high, `${low} > ${normal} > ${high}`);
  assert.equal(city.homes()[0].factors.taxes, (10 - 25) * 0.006);
});

test('the tax rate is saved; older saves start at 10% and keep a council tax decision', () => {
  const city = new CityState(16, 16);
  const sim = new Simulation(city);
  sim.economy.reset('land');
  sim.economy.setTaxRate(17);
  const back = CityState.fromJSON(JSON.parse(JSON.stringify(city.toJSON())));
  assert.equal(new Simulation(back).economy.taxRate, 17);
  // An older save: no rate, and the council had raised taxes by 20% (decisions.taxRate 1.2).
  const old = JSON.parse(JSON.stringify(city.toJSON()));
  delete old.systems.economy.taxRate;
  old.systems.decisions = { pending: null, next: 99, seen: {}, effects: [], taxRate: 1.2, made: 1 };
  const sim2 = new Simulation(CityState.fromJSON(old));
  assert.equal(sim2.economy.taxRate, 10);
  sim2.decisions.update();
  assert.equal(sim2.economy.taxRate, 12, 'the raise carries over as 12%');
  assert.equal(sim2.decisions.state.taxRate, 1);
});

test('your Life Story character is paid the same wage and pays the same income tax', async () => {
  const { LifeSystem } = await import('../src/life.js');
  const city = new CityState(32, 32);
  generateTown(city, 3);
  const sim = new Simulation(city);
  sim.refresh();
  const life = new LifeSystem(city, { rng: () => 0.5 });
  life.create({ first: 'Ada', last: 'Lane' });
  const c = life.char;
  const gain = (rate) => {
    sim.economy.setTaxRate(rate);
    c.age = 30;
    c.livesWithParents = true;
    c.job = { type: 'shop', level: 0, years: 0 };
    const before = c.money;
    life.yearly();
    return c.money - before;
  };
  const untaxed = gain(0);
  const taxed = gain(20);
  assert.equal(untaxed, Math.round(CAREERS.shop.pay[0] * (c.traits.includes('thrifty') ? 0.25 : 0.15)));
  assert.equal(taxed, Math.round(CAREERS.shop.pay[0] * 0.8 * (c.traits.includes('thrifty') ? 0.25 : 0.15)));
});
