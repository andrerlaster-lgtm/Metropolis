// Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { CityState } from '../src/state.js';
import { computeLaborMarket, workersIn } from '../src/labor.js';
import { computeCoverage } from '../src/coverage.js';
import { recomputeDesirability } from '../src/desirability.js';
import { Simulation } from '../src/simulation.js';
import { generateTown } from '../src/generator.js';
import { MIGRATIONS } from '../src/persistence.js';
import { STRUCTURES } from '../src/config.js';

function street(city, y, x0, x1) {
  for (let x = x0; x <= x1; x++) city.apply('road', x, y);
}

test('residents take the nearest jobs they can reach by road', () => {
  const city = new CityState(10, 10);
  street(city, 5, 0, 9);
  city.apply('house', 1, 4);
  city.apply('house', 2, 4);
  city.apply('shop', 8, 4);
  for (const t of city.homes()) t.structure.residents = 4;
  const r = computeLaborMarket(city);
  const workers = city.homes().reduce((n, h) => n + workersIn(h), 0);
  assert.equal(r.jobs, STRUCTURES.shop.jobs);
  assert.equal(r.employed, Math.min(workers, r.jobs));
  assert.equal(r.employed + r.unemployed, workers);
  assert.equal(city.getTile(8, 4).workersFilled, r.employed);
  // Commutes load the road between home and shop, not the road beyond the shop.
  assert.ok(city.getTile(5, 5).congestion > 0);
  assert.equal(city.getTile(9, 5).congestion, 0);
  assert.ok(r.flows.every((f) => f.path[0] === f.from && f.path.at(-1) === f.to));
});

// A home from a town saved before homes needed a road: it can't be placed any more, but it can exist.
function oldHome(city, x, y, residents) {
  city.getTile(x, y).structure = { id: city.nextId++, type: 'house', residents };
  city.refreshAllRoadMasks();
}

test('by road alone, homes without a road connection cannot reach jobs', () => {
  const city = new CityState(8, 8);
  street(city, 2, 0, 7);
  city.apply('shop', 3, 1);
  oldHome(city, 3, 6, 4);
  const r = computeLaborMarket(city, { walking: false });
  assert.equal(r.employed, 0);
  assert.equal(r.unemployed, workersIn(city.getTile(3, 6)));
  assert.equal(city.getTile(3, 6).employment, 0);
  // But they walk (labor.js): a road isn't what stands between a home and a job.
  const walked = computeLaborMarket(city);
  assert.equal(walked.employed, workersIn(city.getTile(3, 6)));
  assert.equal(city.getTile(3, 6).employment, 1);
});

test('by road alone, jobs on a separate road network stay out of reach; on foot they are not', () => {
  const city = new CityState(10, 10);
  street(city, 2, 0, 3);
  street(city, 2, 6, 9);
  city.apply('house', 1, 1);
  city.apply('office', 8, 1);
  city.getTile(1, 1).structure.residents = 4;
  assert.equal(computeLaborMarket(city, { walking: false }).employed, 0);
  assert.ok(computeLaborMarket(city).employed > 0, 'a short walk across the gap');
});

test('schools and clinics raise desirability nearby, fading with distance', () => {
  const city = new CityState(20, 20);
  city.apply('school', 10, 10);
  computeCoverage(city);
  city.derived.labor = computeLaborMarket(city);
  recomputeDesirability(city);
  const near = city.getTile(11, 10);
  const far = city.getTile(16, 10);
  const outside = city.getTile(19, 19);
  assert.ok(near.coverage.school > far.coverage.school);
  assert.ok(far.coverage.school > 0);
  assert.equal(outside.coverage.school, 0);
  assert.ok(near.factors.services > outside.factors.services);
});

test('version 1 saves are centred on the larger map', () => {
  const tiles = Array.from({ length: 144 }, () => ({ terrain: 'grass', structure: null }));
  tiles[0] = { terrain: 'grass', structure: { id: 1, type: 'house', residents: 3, variant: 'mint' } };
  const save = MIGRATIONS[1]({ version: 1, city: { width: 12, height: 12, clock: 0.4, day: 3, tiles } });
  assert.equal(save.city.width, 32);
  assert.equal(save.city.tiles.length, 32 * 32);
  const city = CityState.fromJSON(save.city);
  assert.equal(city.getTile(10, 10).structure.type, 'house');
  assert.equal(city.getTile(10, 10).structure.residents, 3);
  assert.equal(city.day, 3);
});

test('random towns include homes, jobs and services, and grow over time', () => {
  const city = new CityState(32, 32);
  generateTown(city, 12345);
  const count = (type) => city.tiles.filter((t) => t.structure?.type === type).length;
  assert.ok(count('house') > 10);
  assert.ok(count('shop') + count('office') > 3);
  assert.equal(count('school'), 1);
  assert.equal(count('clinic'), 1);
  assert.ok(city.tiles.some((t) => t.terrain === 'water'));

  const sim = new Simulation(city);
  sim.refresh();
  const start = city.stats.population;
  for (let i = 0; i < 600; i++) sim.update(0.25);
  assert.ok(city.stats.population > start, `population ${start} → ${city.stats.population}`);
  assert.ok(city.stats.jobs > 0);
  assert.ok(city.stats.employment > 0.3);
});

test('pausing stops time and the simulation', () => {
  const city = new CityState(12, 12);
  generateTown(city, 7);
  const sim = new Simulation(city);
  sim.refresh();
  sim.speed = 0;
  const clock = city.clock;
  const pop = city.stats.population;
  for (let i = 0; i < 100; i++) sim.update(0.25);
  assert.equal(city.clock, clock);
  assert.equal(city.stats.population, pop);
});
