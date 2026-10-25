// Run with: node --test tests/
// The wider building catalog (Phase 4): every kind is in the menu once, costs money, unlocks on a
// milestone and in an era, does what its numbers say (jobs, homes, coverage, greenery, smoke), keeps
// share-link codes stable, and towns that grow by themselves build the new kinds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CityState } from '../src/state.js';
import { Simulation } from '../src/simulation.js';
import { generateTown } from '../src/generator.js';
import { STRUCTURES, COSTS, TOOL_GROUPS, TOOLS, MILESTONES, COVERAGE_IDS, TAX, BUSINESS_TAX } from '../src/config.js';
import { ERAS, buildsFor } from '../src/eras.js';
import { CAREERS } from '../src/lifeData.js';
import { Milestones, unlockTier } from '../src/milestones.js';
import { packCity, unpackCity } from '../src/share.js';
import { CATEGORY_LABELS, categoryOf } from '../src/economy.js';
import { ART2D } from '../src/art2d.js';
import { mulberry32 } from '../src/utils.js';

const NEW = ['bungalow', 'rowhouse', 'villa', 'restaurant', 'market', 'bank', 'hotel', 'warehouse', 'workshop', 'powerplant', 'kindergarten', 'museum', 'pharmacy', 'hospital', 'firehut', 'fountain', 'garden', 'pool', 'cinema', 'stadium', 'farm', 'mill'];
const placeable = Object.keys(STRUCTURES).filter((t) => t !== 'road' && t !== 'rubble');

test('about forty kinds, the first twenty-one in their old order so share links keep working', () => {
  const keys = Object.keys(STRUCTURES);
  assert.ok(keys.length >= 40 && keys.length <= 63, `${keys.length} kinds (share links hold 63)`);
  assert.deepEqual(keys.slice(0, 21), ['house', 'cottage', 'apartments', 'tower', 'shop', 'cafe', 'mall', 'factory', 'office', 'school', 'clinic', 'playground', 'field', 'tree', 'park', 'road', 'rubble', 'bakery', 'library', 'firestation', 'university']);
  assert.deepEqual(keys.slice(21), NEW);
});

test('every kind can be picked from the build menu exactly once', () => {
  const ids = TOOLS.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, 'no tool twice');
  for (const t of placeable) assert.ok(ids.includes(t), `${t} has a menu button`);
  for (const g of TOOL_GROUPS) assert.ok(g.tools.length > 0, g.id);
  for (const t of TOOLS) assert.ok(t.id in STRUCTURES || ['inspect', 'water', 'bulldoze'].includes(t.id), t.id);
});

test('every new kind costs money, unlocks with the town and is added to an era', () => {
  const eraBuilds = ERAS.flatMap((e) => e.builds);
  for (const t of NEW) {
    assert.ok(COSTS[t] > 0, `${t} has a price`);
    assert.ok(eraBuilds.filter((b) => b === t).length === 1, `${t} is in exactly one era`);
    assert.ok(buildsFor(ERAS.length - 1).includes(t));
    // Either always available (hamlet) or on exactly one milestone.
    const tiers = MILESTONES.filter((m) => m.unlocks.includes(t)).length;
    assert.ok(tiers <= 1, `${t} unlocks once`);
  }
  // Basic kinds are there from the start; the bigger ones wait for size.
  for (const t of ['bungalow', 'market', 'pharmacy', 'firehut', 'garden']) assert.equal(unlockTier(t), -1, `${t} is available at once`);
  for (const t of ['hospital', 'stadium', 'powerplant']) assert.equal(unlockTier(t), MILESTONES.findIndex((m) => m.id === 'city'));
  assert.ok(unlockTier('villa') > unlockTier('rowhouse'));
});

test('Milestones towns lock the new kinds; Sandbox towns have all of them', () => {
  const city = new CityState(12, 12);
  const m = new Milestones(city);
  assert.ok(!m.isUnlocked('hospital') && m.isUnlocked('bungalow'));
  city.systems.mode = 'sandbox';
  for (const t of NEW) assert.ok(m.isUnlocked(t), t);
});

test('what each kind does matches its numbers', () => {
  const homes = NEW.filter((t) => STRUCTURES[t].capacity > 0);
  assert.deepEqual(homes, ['bungalow', 'rowhouse', 'villa']);
  for (const t of NEW) {
    const d = STRUCTURES[t];
    if (!d.capacity) assert.ok(d.jobs > 0 || d.walkable, `${t} gives jobs or is open ground`);
    if (d.service) assert.ok(COVERAGE_IDS.includes(d.service) && d.radius >= 3, `${t} has a real service`);
    if (d.service === 'school' || d.service === 'health' || d.service === 'fire') assert.ok(d.serves > 0, `${t} looks after people`);
    // Anything with a pay-roll can be a Life Story job.
    if (d.jobs > 2) assert.ok(CAREERS[t] || ['field'].includes(t), `${t} has careers`);
    // Every kind appears in the budget, as tax or upkeep (or is free of both).
    if (BUSINESS_TAX[t] || categoryOf(t)) assert.ok(CATEGORY_LABELS[categoryOf(t)], `${t} has a budget label`);
  }
  assert.ok(STRUCTURES.hospital.serves > STRUCTURES.clinic.serves * 2);
  assert.ok(STRUCTURES.powerplant.pollution && !STRUCTURES.workshop.pollution);
  assert.ok(STRUCTURES.garden.greenery >= 2 && STRUCTURES.fountain.walkable && STRUCTURES.garden.walkable);
  assert.ok(TAX.resident > 0);
});

test('every new kind has 2D art and a 3D model', async () => {
  for (const t of NEW) assert.equal(typeof ART2D[t], 'function', `${t} 2D art`);
  const { STORY_TYPES } = await import('../src/view3d/storybook.js');
  for (const t of NEW) assert.ok(STORY_TYPES.includes(t), `${t} 3D model`);
});

test('every kind survives a share link', () => {
  const city = new CityState(16, 16);
  for (let x = 0; x < 16; x++) city.getTile(x, 8).structure = { type: 'road' };
  NEW.forEach((t, i) => {
    city.getTile(i % 16, i < 16 ? 7 : 6).structure = { id: i + 1, type: t, residents: 0 };
  });
  const back = unpackCity(packCity(city));
  NEW.forEach((t, i) => assert.equal(back.getTile(i % 16, i < 16 ? 7 : 6).structure.type, t, t));
});

function sandboxTown(seed = 11) {
  const city = new CityState(32, 32);
  generateTown(city, seed);
  city.systems.mode = 'sandbox';
  const sim = new Simulation(city);
  sim.refresh();
  return { city, sim };
}

test('a new service building covers the homes around it, like the ones before it', () => {
  const city = new CityState(14, 14);
  for (let x = 0; x < 14; x++) city.getTile(x, 7).structure = { type: 'road' };
  city.getTile(4, 6).structure = { id: 1, type: 'house', residents: 4 };
  const cases = [['kindergarten', 'school'], ['pharmacy', 'health'], ['firehut', 'fire'], ['fountain', 'fun'], ['cinema', 'fun'], ['hospital', 'health'], ['museum', 'school']];
  for (const [type, service] of cases) {
    const c = JSON.parse(JSON.stringify(city.toJSON()));
    const town = CityState.fromJSON(c);
    town.getTile(6, 6).structure = { id: 2, type, residents: 0 };
    const sim = new Simulation(town);
    sim.refresh();
    assert.ok(town.getTile(4, 6).coverage[service] > 0, `${type} covers ${service}`);
  }
});

test('new workplaces give jobs the way the old ones do', () => {
  const city = new CityState(16, 16);
  for (let x = 0; x < 16; x++) city.getTile(x, 8).structure = { type: 'road' };
  for (let i = 0; i < 7; i++) city.getTile(2 + i, 7).structure = { id: i + 1, type: 'house', residents: 4 };
  city.getTile(10, 7).structure = { id: 9, type: 'bank', residents: 0 };
  city.getTile(12, 7).structure = { id: 10, type: 'warehouse', residents: 0 };
  const sim = new Simulation(city);
  sim.refresh();
  assert.ok(city.getTile(10, 7).workersFilled > 0, 'the bank has staff');
  assert.ok(city.getTile(12, 7).workersFilled > 0, 'the warehouse has staff');
  assert.ok(city.stats.jobs >= STRUCTURES.bank.jobs + STRUCTURES.warehouse.jobs);
});

test('a power plant bothers homes nearby like a factory, a workshop does not', () => {
  const build = (type) => {
    const city = new CityState(14, 14);
    for (let x = 0; x < 14; x++) city.getTile(x, 7).structure = { type: 'road' };
    city.getTile(4, 6).structure = { id: 1, type: 'house', residents: 4 };
    city.getTile(6, 6).structure = { id: 2, type };
    new Simulation(city).refresh();
    return city.getTile(4, 6).factors.pollution || 0;
  };
  assert.ok(build('powerplant') < 0 && build('factory') < 0);
  assert.equal(build('workshop'), 0);
});

test('towns that grow by themselves can build the new kinds', () => {
  const { city, sim } = sandboxTown();
  sim.eras.state.index = ERAS.length - 1;
  city.stats.population = 1200;
  sim.economy.state.money = 50_000_000;
  const g = sim.growth;
  g.payAll = true;
  g.rng = mulberry32(77);
  for (const t of NEW) assert.ok(g.allowed(t), `${t} is allowed in a big modern town`);
  const built = new Set();
  for (let i = 0; i < 400; i++) {
    for (const kind of ['home', 'work']) {
      const r = g.act(kind);
      if (r && NEW.includes(r.type)) built.add(r.type);
    }
    city.stats.population = 1200;
  }
  assert.ok(built.size >= 6, `built ${built.size} new kinds: ${[...built].join(', ')}`);
  for (const t of built) assert.ok(STRUCTURES[t]);
});

test('an early town only builds what its era allows', () => {
  const { city, sim } = sandboxTown();
  sim.eras.state.index = 0;
  const g = sim.growth;
  for (const t of ['bank', 'hospital', 'stadium', 'powerplant', 'villa', 'cinema']) assert.ok(!g.allowed(t), `${t} waits for its era`);
  for (const t of ['bungalow', 'market', 'pharmacy', 'garden']) assert.ok(buildsFor(0).includes(t), t);
  void city;
});
