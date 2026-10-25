// Run with: node --test tests/
// Service quality: schools, clinics, libraries, universities and fire stations slip when too many residents
// rely on them, drift back when they don't, share residents between neighbours, and scale their coverage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CityState } from '../src/state.js';
import { Simulation } from '../src/simulation.js';
import { computeCoverage, targetRating } from '../src/coverage.js';
import { computeThoughts } from '../src/advisor.js';
import { fireCover } from '../src/disasters.js';
import { encodeCity, decodeCity } from '../src/share.js';
import { generateTown } from '../src/generator.js';
import { STRUCTURES, SERVICE_RATING, DAY_LENGTH_SECONDS } from '../src/config.js';

// A school at (10,10) with `residents` living in houses beside it.
function schoolTown(residents, type = 'school') {
  const city = new CityState(24, 24);
  city.apply(type, 10, 10);
  for (const [x, y] of [[12, 10], [8, 10], [10, 12], [10, 8]]) city.apply('road', x, y); // beside each home
  const homes = [city.getTile(11, 10), city.getTile(9, 10), city.getTile(10, 11), city.getTile(10, 9)];
  for (const h of homes) {
    city.apply('house', h.x, h.y);
    h.structure.residents = residents / homes.length;
  }
  return { city, school: city.getTile(10, 10), homes };
}
const SCHOOL = STRUCTURES.school.serves; // residents a school looks after at full quality
const stat = (city, tile) => city.derived.serviceStats.find((s) => s.tile === tile);

test('a service that has no more residents than it can look after stays at full quality', () => {
  const { city, school } = schoolTown(SCHOOL);
  computeCoverage(city);
  assert.equal(stat(city, school).rating, 1);
  assert.equal(stat(city, school).load, 1);
  computeCoverage(city, 30);
  assert.equal(stat(city, school).rating, 1);
});

test('the target quality falls as the load rises, but never below the floor', () => {
  assert.equal(targetRating(SCHOOL / 2, SCHOOL), 1);
  assert.equal(targetRating(SCHOOL, SCHOOL), 1);
  assert.equal(targetRating(SCHOOL * 2, SCHOOL), 0.5);
  assert.equal(targetRating(SCHOOL * 1000, SCHOOL), SERVICE_RATING.min);
});

test('quality slips toward its target gradually, then recovers when the crowd leaves', () => {
  const { city, school, homes } = schoolTown(40);
  computeCoverage(city);
  assert.equal(stat(city, school).rating, 1);

  for (const h of homes) h.structure.residents = SCHOOL / 2; // twice what a school serves
  computeCoverage(city); // no time has passed: nothing moves yet
  assert.equal(stat(city, school).rating, 1);
  assert.equal(stat(city, school).target, 0.5);

  computeCoverage(city, 0.5);
  const step = SERVICE_RATING.perDay * 0.5;
  assert.ok(Math.abs(stat(city, school).rating - (1 - step)) < 1e-9, 'moves by at most perDay a day');
  computeCoverage(city, 0.5);
  assert.ok(Math.abs(stat(city, school).rating - (1 - 2 * step)) < 1e-9);
  computeCoverage(city, 30);
  assert.equal(stat(city, school).rating, 0.5, 'settles on the target and stops');

  for (const h of homes) h.structure.residents = 5;
  computeCoverage(city, 0.5);
  assert.ok(stat(city, school).rating > 0.5 && stat(city, school).rating < 1, 'recovers a step at a time');
  computeCoverage(city, 30);
  assert.equal(stat(city, school).rating, 1);
});

test('quality scales the coverage a building gives, so a crowded school helps its neighbours less', () => {
  const { city, homes } = schoolTown(40);
  computeCoverage(city);
  const full = homes[0].coverage.school;
  for (const h of homes) h.structure.residents = SCHOOL / 2;
  computeCoverage(city, 30);
  assert.ok(Math.abs(homes[0].coverage.school - full * 0.5) < 1e-9);
});

test('residents are shared between the buildings that reach them', () => {
  const city = new CityState(30, 30);
  city.apply('school', 8, 15);
  city.apply('school', 22, 15);
  const mid = city.getTile(15, 15);
  city.apply('road', 15, 14);
  city.apply('house', 15, 15);
  mid.structure.residents = 100;
  computeCoverage(city);
  const [a, b] = city.derived.serviceStats;
  assert.ok(Math.abs(a.demand - 50) < 1e-9 && Math.abs(b.demand - 50) < 1e-9, 'two equal schools split the home');
  assert.ok(Math.abs(a.demand + b.demand - 100) < 1e-9, 'every resident is counted once');

  city.apply('school', 14, 15); // a much nearer school takes the larger share
  computeCoverage(city);
  const near = city.derived.serviceStats.find((s) => s.tile === city.getTile(14, 15));
  assert.ok(near.demand > 50);
  const total = city.derived.serviceStats.reduce((n, s) => n + s.demand, 0);
  assert.ok(Math.abs(total - 100) < 1e-9);
});

test('a bigger building takes a bigger share, so neighbours end up equally busy', () => {
  const city = new CityState(30, 30);
  city.apply('school', 14, 15);
  city.apply('library', 16, 15); // about the same distance from the home, a fraction of the capacity
  city.apply('road', 15, 18);
  city.apply('house', 15, 17);
  city.getTile(15, 17).structure.residents = 100;
  computeCoverage(city);
  const [a, b] = city.derived.serviceStats;
  assert.ok(a.demand > b.demand * 2, 'the school takes the bigger share');
  assert.ok(Math.abs(a.load - b.load) / a.load < 0.2, 'so the two end up about equally busy, not the library swamped');
});

test('a second school takes the pressure off the first', () => {
  const { city, school } = schoolTown(SCHOOL * 2);
  computeCoverage(city);
  assert.equal(stat(city, school).target, 0.5);
  city.apply('school', 12, 12);
  computeCoverage(city);
  assert.ok(stat(city, school).target > 0.5);
});

test('libraries, clinics, universities and fire stations are rated too; play areas are not', () => {
  for (const [type, service] of [['library', 'school'], ['clinic', 'health'], ['university', 'school'], ['firestation', 'fire']]) {
    const { city, school } = schoolTown(STRUCTURES[type].serves * 2, type);
    computeCoverage(city);
    const s = stat(city, school);
    assert.equal(s.service, service, type);
    assert.equal(s.target, 0.5, `${type} is rated against its own capacity`);
  }
  const city = new CityState(20, 20);
  city.apply('cafe', 10, 10);
  city.apply('playground', 5, 5);
  computeCoverage(city);
  assert.equal(city.derived.serviceStats.length, 0);
  assert.ok(city.getTile(10, 11).coverage.fun > 0.5);
});

test('a crowded fire station protects less', () => {
  const { city, homes } = schoolTown(40, 'firestation');
  computeCoverage(city);
  const before = fireCover(homes[0], 'fire');
  for (const h of homes) h.structure.residents = STRUCTURES.firestation.serves; // four times the load it serves
  computeCoverage(city, 30);
  assert.ok(fireCover(homes[0], 'fire') > before, 'less of the damage is prevented');
});

test('removed buildings leave no quality behind, and a rebuilt one starts fresh', () => {
  const { city, school, homes } = schoolTown(SCHOOL * 2);
  computeCoverage(city, 30);
  assert.equal(stat(city, school).rating, 0.5);
  city.apply('bulldoze', 10, 10);
  computeCoverage(city);
  assert.deepEqual(city.derived.serviceRatings, {});
  city.apply('school', 10, 10);
  computeCoverage(city);
  assert.equal(stat(city, school).rating, stat(city, school).target, 'a new building has no lag');
  assert.ok(homes.length);
});

test('quality is derived data: it is not saved, and a loaded town settles at each building\'s target', async () => {
  const { city } = schoolTown(SCHOOL * 2);
  computeCoverage(city, 30);
  assert.ok(city.derived.serviceStats[0].rating < 1);
  const json = JSON.stringify(city.toJSON());
  assert.ok(!/rating|serviceStats/i.test(json), 'nothing about quality is written to the save');

  for (const copy of [CityState.fromJSON(JSON.parse(json)), await decodeCity(await encodeCity(city))]) {
    computeCoverage(copy);
    const s = copy.derived.serviceStats[0];
    assert.equal(s.rating, s.target, 'no lag after loading');
  }
});

test('the simulation moves quality over game days, and keeps it between the floor and 1', () => {
  // Eight full towers (128 residents) around a library, which serves fewer (kept full here, so that the
  // housing rules can't change the load while we watch the quality drift).
  const city = new CityState(24, 24);
  city.apply('library', 10, 10);
  const lib = city.getTile(10, 10);
  for (const [x, y] of [[9, 8], [11, 8], [9, 12], [11, 12], [8, 9], [12, 9]]) city.apply('road', x, y); // every tower has a road beside it
  const towers = [[8, 8], [10, 8], [12, 8], [8, 10], [12, 10], [8, 12], [10, 12], [12, 12]].map(([x, y]) => (city.apply('tower', x, y), city.getTile(x, y)));
  const crowd = (n) => towers.forEach((t) => (t.structure.residents = n));
  crowd(2);
  const sim = new Simulation(city);
  sim.economy.reset('land');
  sim.disasters.level = 'off'; // a random storm must not knock a tower down mid-test
  sim.refresh();
  assert.equal(stat(city, lib).rating, 1);
  const seen = [];
  for (let i = 0; i < (3 * DAY_LENGTH_SECONDS) / 0.25; i++) {
    crowd(16);
    sim.update(0.25);
    if (i % 400 === 0) seen.push(stat(city, lib).rating);
  }
  assert.ok(seen.every((r) => r >= SERVICE_RATING.min - 1e-9 && r <= 1 + 1e-9));
  assert.ok(seen.at(-1) < seen[0], `it slipped while the library was crowded (${seen.map((r) => r.toFixed(2))})`);
  assert.ok(seen.every((r, i) => i === 0 || r <= seen[i - 1] + 1e-9), 'and did not bounce back up');
  assert.ok(Math.abs(seen.at(-1) - STRUCTURES.library.serves / 128) < 1e-9, 'settling on its target within three days');

  for (let i = 0; i < (4 * DAY_LENGTH_SECONDS) / 0.25; i++) {
    crowd(1);
    sim.update(0.25);
  }
  assert.equal(stat(city, lib).rating, 1, 'and it recovers once the crowd is gone');
});

test('residents ask for another school when one is crowded, pointing at it', () => {
  const { city, school } = schoolTown(40);
  computeCoverage(city);
  const fine = computeThoughts(city, null).filter((t) => /crowded/.test(t.text));
  assert.equal(fine.length, 0);

  for (const h of city.homes()) h.structure.residents = 200;
  computeCoverage(city, 30);
  const thoughts = computeThoughts(city, null);
  const crowded = thoughts.find((t) => /school is too crowded/.test(t.text));
  assert.ok(crowded, 'a thought about the crowded school');
  assert.deepEqual([crowded.x, crowded.y], [school.x, school.y]);
});

test('the growing town builds another school when the first is crowded', () => {
  const city = new CityState(32, 32);
  generateTown(city, 7);
  const sim = new Simulation(city);
  sim.economy.reset('town');
  sim.refresh();
  const schools = () => city.tiles.filter((t) => t.structure?.type === 'school').length;
  const before = schools();
  assert.ok(before >= 1);
  for (const h of city.homes()) if (h.structure.residents) h.structure.residents = Math.max(h.structure.residents, 40);
  computeCoverage(city, 30);
  sim.updateStats();
  assert.ok(sim.growth.strained('school').length > 0, 'the school is crowded');
  assert.ok(sim.growth.demand().school > 0, 'so the town wants another');
  assert.ok(sim.growth.needing('school').length > 0, 'and knows whose homes need it');
  sim.economy.state.money = 100000;
  assert.ok(sim.growth.act('school'), 'and builds it');
  assert.equal(schools(), before + 1);
});
