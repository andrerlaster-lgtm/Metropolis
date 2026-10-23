// Run with: node --test tests/
// Town reputation: a slow score from how green and well kept the town is. It moves gradually, is saved,
// and gives a good name a small pull on how appealing homes are and how fast a self-growing town grows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CityState } from '../src/state.js';
import { Simulation } from '../src/simulation.js';
import { Reputation, assessReputation, titleIndex, TITLES } from '../src/reputation.js';
import { FACTORS } from '../src/desirability.js';
import { eraHTML } from '../src/eraUI.js';
import { REPUTATION, DAY_LENGTH_SECONDS } from '../src/config.js';

// Six occupied houses along a road on a bare map. Sandbox so every service counts as unlocked.
function town() {
  const city = new CityState(24, 24);
  for (let x = 4; x < 20; x++) city.apply('road', x, 10);
  const homes = [];
  for (const x of [5, 8, 11, 14, 17]) {
    city.apply('house', x, 9);
    city.apply('house', x, 11);
  }
  for (const h of city.homes()) {
    h.structure.residents = 3;
    homes.push(h);
  }
  const sim = new Simulation(city);
  sim.economy.reset('land');
  city.systems.mode = 'sandbox';
  sim.disasters.level = 'off';
  sim.refresh();
  return { city, sim, homes };
}
const score = (city) => assessReputation(city, () => false); // greenery and care only

function plant(city, sim, n = 40) {
  let put = 0;
  for (let y = 5; y < 20 && put < n; y++) for (let x = 3; x < 21 && put < n; x++) if (!city.getTile(x, y).structure) put += city.apply('tree', x, y) ? 1 : 0;
  sim.refresh();
}

test('a town with nobody in it has no reputation to judge yet', () => {
  const city = new CityState(16, 16);
  const sim = new Simulation(city);
  sim.economy.reset('land');
  sim.refresh();
  assert.equal(assessReputation(city), null);
  assert.equal(city.derived.reputation.value, 0.5);
  assert.equal(city.derived.reputation.parts, null);
  assert.equal(city.systems.reputation.value, null, 'nothing is recorded until there are residents');
});

test('trees and parks near homes raise it, and it cannot go past 1', () => {
  const { city, sim } = town();
  const bare = score(city).target;
  plant(city, sim, 30);
  const some = score(city).target;
  assert.ok(some > bare, `${some} > ${bare}`);
  plant(city, sim, 400);
  const lots = score(city);
  assert.ok(lots.target >= some && lots.target <= 1);
  assert.ok(lots.parts.green <= 1, 'planting more and more cannot run away');
});

test('damaged and ruined buildings count against the town until repaired', () => {
  const { city, homes } = town();
  const healthy = score(city);
  assert.equal(healthy.parts.care, 1);
  homes[0].structure.damage = 0.5; // badly damaged
  homes[1].structure.type = 'rubble';
  const hurt = score(city);
  assert.equal(hurt.neglected, 2);
  assert.ok(hurt.parts.care < 1);
  assert.ok(hurt.target < healthy.target);
  homes[0].structure.damage = 0;
  homes[1].structure.type = 'house';
  assert.equal(score(city).target, healthy.target, 'repairs put it right');
});

test('services only count once they can be built, and then by how well they reach the homes', () => {
  const { city, sim } = town();
  assert.equal(assessReputation(city, () => false).parts.services, null, 'a young town is not marked down for a clinic it cannot build');
  const none = assessReputation(city, () => true);
  assert.equal(none.parts.services, 0);
  city.apply('school', 12, 12);
  city.apply('clinic', 9, 12);
  sim.refresh();
  assert.ok(assessReputation(city, () => true).parts.services > 0);
  assert.ok(assessReputation(city, () => true).target > none.target);
});

test('the first score is taken as it is; after that it moves gradually and never by more than perDay a day', () => {
  const { city, sim } = town();
  delete city.systems.reputation; // start with no reputation, as in a new town
  const rep = new Reputation(city, { unlocked: () => false });
  rep.update(0);
  const first = city.systems.reputation.value;
  assert.equal(first, city.derived.reputation.target, 'no lag on the first score');

  plant(city, sim, 60);
  rep.update(0);
  assert.equal(city.systems.reputation.value, first, 'no time has passed');
  const target = city.derived.reputation.target;
  assert.ok(target > first + 0.1, 'greener now');
  rep.update(1);
  assert.ok(Math.abs(city.systems.reputation.value - (first + REPUTATION.perDay)) < 1e-9);
  rep.update(100);
  assert.ok(Math.abs(city.systems.reputation.value - target) < 1e-9, 'settles on the score');
});

test('a new title is a chronicle entry, but wobbling at an edge is not', () => {
  assert.equal(titleIndex(0.44), 1);
  assert.equal(titleIndex(0.46), 1, 'just past the edge is not enough');
  assert.equal(titleIndex(0.48), 2);
  assert.equal(titleIndex(0.44, 2), 2, 'and falling back needs the same margin');
  assert.equal(titleIndex(0.42, 2), 1);

  const { city, sim } = town();
  delete city.systems.reputation;
  const rep = new Reputation(city, { unlocked: () => false });
  rep.update(0);
  const before = (city.systems.chronicle || []).length;
  const start = city.systems.reputation.title;
  plant(city, sim, 400);
  rep.update(100);
  assert.ok(city.systems.reputation.title > start, 'a greener town earns a better title');
  const added = (city.systems.chronicle || []).slice(before);
  assert.ok(added.length >= 1 && added.every((c) => c.kind === 'note'));
  assert.ok(added.some((c) => c.text === TITLES[city.systems.reputation.title].up));
});

test('it is saved with the town; an older save without one starts at its score, quietly', () => {
  const { city, sim } = town();
  plant(city, sim, 60);
  sim.reputation.update(0);
  city.systems.reputation.value = 0.321; // a value the town did not just compute
  const loaded = CityState.fromJSON(JSON.parse(JSON.stringify(city.toJSON())));
  assert.equal(loaded.systems.reputation.value, 0.321, 'the value survives a save and load');

  const old = JSON.parse(JSON.stringify(city.toJSON()));
  delete old.systems.reputation; // a save from before reputations existed
  const olden = CityState.fromJSON(old);
  const sim2 = new Simulation(olden);
  sim2.refresh();
  assert.ok(olden.systems.reputation.value > 0 && olden.systems.reputation.value <= 1);
  assert.equal(olden.systems.reputation.value, olden.derived.reputation.target, 'it starts at its score');
  assert.equal((olden.systems.chronicle || []).length, 0, 'with no fanfare');
});

test('a good name makes homes a little more appealing, a bad one a little less', () => {
  const { city } = town();
  const f = FACTORS.find((x) => x.id === 'reputation');
  assert.ok(f.enabled);
  const at = (v) => {
    city.derived.reputation = { value: v };
    return f.compute(city, city.tiles[0]);
  };
  assert.equal(at(0.5), 0);
  assert.ok(Math.abs(at(1) - REPUTATION.homeAppeal / 2) < 1e-9);
  assert.ok(Math.abs(at(0) + REPUTATION.homeAppeal / 2) < 1e-9);
});

test('a good name speeds up a town that grows by itself, a bad one slows it, by at most 15%', () => {
  const { city, sim } = town();
  const at = (v) => {
    city.derived.reputation = { value: v };
    return sim.growth.rate();
  };
  const mid = at(0.5);
  assert.ok(at(1) > mid && at(0) < mid);
  assert.ok(Math.abs(at(1) / mid - 1.15) < 1e-9);
  assert.ok(Math.abs(at(0) / mid - 0.85) < 1e-9);
});

test('in a running town, planting trees lifts the reputation over the following days', () => {
  const { city, sim } = town();
  const days = (n) => {
    for (let i = 0; i < (n * DAY_LENGTH_SECONDS) / 0.25; i++) sim.update(0.25);
  };
  days(0.1);
  const before = city.derived.reputation.value;
  plant(city, sim, 120);
  const target = city.derived.reputation.target;
  assert.ok(target > before + 0.1);
  days(2);
  const mid = city.derived.reputation.value;
  assert.ok(mid > before && mid < target, 'moving, not jumping');
  days(30);
  assert.ok(city.derived.reputation.value > mid);
});

test('the City panel says what the town is known for and why', () => {
  const { city, sim } = town();
  plant(city, sim, 5);
  sim.reputation.update(0);
  const html = eraHTML(sim.eras, sim.growth);
  assert.match(html, /Reputation: (Run-down|Plain|Pleasant|Lovely|Beloved)/);
  assert.match(html, /%/);
  const empty = new CityState(8, 8);
  const sim2 = new Simulation(empty);
  sim2.reputation.update(0);
  assert.doesNotMatch(eraHTML(sim2.eras, sim2.growth), /Reputation/, 'nothing to say about an empty town');
});
