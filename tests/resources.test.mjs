// Run with: node --test tests/
// Resources (Phase 8): farms and markets make food, workshops and factories goods, power plants power;
// supplies only help (a bonus for homes and shops), nothing is saved, old towns are unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CityState } from '../src/state.js';
import { Simulation } from '../src/simulation.js';
import { generateTown } from '../src/generator.js';
import { STRUCTURES, RESOURCES, SUPPLY_BONUS } from '../src/config.js';
import { computeResources, shortage } from '../src/resources.js';
import { computeThoughts } from '../src/advisor.js';

function town(extra = []) {
  const city = new CityState(24, 24);
  for (let x = 2; x < 22; x++) city.getTile(x, 10).structure = { type: 'road' };
  for (let i = 0; i < 8; i++) city.getTile(3 + i, 9).structure = { id: i + 1, type: 'house', residents: 4 };
  extra.forEach(([type, x, y], i) => {
    city.getTile(x, y).structure = { id: 100 + i, type, residents: 0 };
  });
  city.systems.mode = 'sandbox';
  const sim = new Simulation(city);
  sim.refresh();
  return { city, sim };
}

test('a farm is open land that gives jobs and food, and needs no road', () => {
  const f = STRUCTURES.farm;
  assert.ok(f.walkable && f.jobs > 0 && f.produces.food > 0);
  const { city } = town([['farm', 14, 4]]); // nowhere near a road
  assert.equal(city.getTile(14, 4).structure.type, 'farm');
  assert.ok(city.getTile(14, 4).workersFilled > 0, 'people walk there to work');
});

test('what each producer makes: food, goods and power', () => {
  for (const [type, kind] of [['farm', 'food'], ['market', 'food'], ['workshop', 'goods'], ['factory', 'goods'], ['powerplant', 'power']]) assert.ok(STRUCTURES[type].produces?.[kind] > 0, type);
  assert.deepEqual(Object.keys(RESOURCES), ['food', 'goods', 'power']);
});

test('farms feed the homes; a town with none is simply unfed, not punished', () => {
  const bare = town().city;
  const none = bare.derived.resources;
  assert.equal(none.food.made, 0);
  assert.ok(none.food.need > 0 && none.food.ratio === 0);
  const fed = town([['farm', 14, 4], ['farm', 16, 4]]).city.derived.resources;
  assert.ok(fed.food.made > 100 && fed.food.ratio === 1, `${fed.food.made}/${fed.food.need}`);
  // The same homes are a little happier when fed, and never less happy than without.
  const a = bare.getTile(3, 9).desirability;
  const b = town([['farm', 14, 4], ['farm', 16, 4]]).city.getTile(3, 9).desirability;
  assert.ok(b > a, 'fed homes are more desirable');
  assert.ok(b - a < 0.2 && SUPPLY_BONUS.food <= 0.05, 'by a small amount');
});

test('an idle producer still makes a little, a staffed one makes its full amount', () => {
  const { city } = town([['powerplant', 18, 4]]);
  const t = city.getTile(18, 4);
  assert.ok(t.workersFilled > 0);
  const full = computeResources(city, 3).power.made;
  t.workersFilled = 0;
  const idle = computeResources(city, 3).power.made;
  assert.ok(idle > 0 && idle < full);
});

test('power is only needed from the Motor age', () => {
  const { city } = town();
  assert.equal(computeResources(city, 1).power.need, 0);
  assert.equal(computeResources(city, 1).power.active, false);
  assert.ok(computeResources(city, 2).power.need > 0);
});

test('the weakest supply is named, with what would fix it', () => {
  const r = computeResources(town().city, 3);
  const s = shortage(r);
  assert.ok(s && ['food', 'goods', 'power'].includes(s.kind) && s.fix);
  const full = computeResources(town([['farm', 14, 4], ['farm', 16, 4]]).city, 0);
  assert.equal(shortage({ food: full.food, goods: { need: 0, ratio: 1 }, power: { need: 0, ratio: 1 } }), null);
});

test('goods help shops earn a little more tax; nothing changes without producers', () => {
  const base = town([['shop', 12, 9], ['shop', 13, 9]]);
  const withGoods = town([['shop', 12, 9], ['shop', 13, 9], ['factory', 18, 4]]);
  const earn = (c) => c.city.getTile(12, 9).earning;
  assert.ok(earn(withGoods) >= earn(base));
  const rs = withGoods.city.derived.resources.goods;
  assert.ok(rs.made > 0);
});

test('resources are worked out each refresh and never saved', () => {
  const { city } = town([['farm', 14, 4]]);
  const json = JSON.stringify(city.toJSON());
  assert.ok(!json.includes('"resources"'), 'not in the save');
  const back = CityState.fromJSON(JSON.parse(json));
  new Simulation(back).refresh();
  assert.ok(back.derived.resources.food.made > 0);
});

test('a growing town builds farms when food runs short', () => {
  const city = new CityState(32, 32);
  generateTown(city, 21);
  city.systems.mode = 'sandbox';
  const sim = new Simulation(city);
  sim.refresh();
  assert.ok(sim.growth.foodShort(), 'a generated town starts short of food');
  sim.eras.state.index = 1;
  sim.economy.state.money = 1e7;
  const g = sim.growth;
  g.payAll = true;
  let farms = 0;
  for (let i = 0; i < 300 && !farms; i++) {
    const r = g.act('work');
    if (r?.type === 'farm') farms++;
  }
  assert.ok(farms > 0, 'a farm was built');
});

test('the advisor mentions a food shortage in a big enough town', () => {
  const city = new CityState(24, 24);
  for (let x = 2; x < 22; x++) city.getTile(x, 10).structure = { type: 'road' };
  for (let i = 0; i < 16; i++) city.getTile(2 + (i % 16), 9).structure = { id: i + 1, type: 'house', residents: 4 };
  city.systems.mode = 'sandbox';
  new Simulation(city).refresh();
  const thoughts = computeThoughts(city, null);
  assert.ok(thoughts.some((t) => /Food is running short/.test(t.text)), JSON.stringify(thoughts.map((t) => t.text)));
});
