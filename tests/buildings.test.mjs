// Run with: node --test tests/
// Bakery, library, fire station and university.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CityState } from '../src/state.js';
import { Simulation } from '../src/simulation.js';
import { generateLand } from '../src/generator.js';
import { STRUCTURES, COSTS, TOOLS, MILESTONES, UPKEEP, BUSINESS_TAX } from '../src/config.js';
import { CAREERS } from '../src/lifeData.js';
import { CATEGORY_LABELS, categoryOf } from '../src/economy.js';
import { buildsFor } from '../src/eras.js';
import { fireCover } from '../src/disasters.js';
import { encodeCity, decodeCity } from '../src/share.js';

const NEW = ['bakery', 'library', 'firestation', 'university'];

function street(size = 24) {
  const city = new CityState(size, size);
  generateLand(city, 1);
  const sim = new Simulation(city);
  sim.economy.reset('land');
  for (let x = 2; x < size - 2; x++) city.apply('road', x, 8);
  return { city, sim };
}

test('each new building is buildable, costs money, employs people and has a career ladder', () => {
  for (const t of NEW) {
    assert.ok(STRUCTURES[t], t);
    assert.ok(STRUCTURES[t].jobs > 0, `${t} has jobs`);
    assert.ok(COSTS[t] > 0, `${t} has a cost`);
    assert.ok(TOOLS.some((tool) => tool.id === t), `${t} is in the toolbar`);
    assert.ok(CATEGORY_LABELS[categoryOf(t)], `${t} shows up in the budget`);
    const c = CAREERS[t];
    assert.ok(c && c.titles.length === c.pay.length, `${t} career`);
    assert.ok(buildsFor(4).includes(t), `${t} can grow by itself`);
  }
  assert.ok(BUSINESS_TAX.bakery, 'bakeries pay business tax');
  for (const t of ['library', 'firestation', 'university']) assert.ok(UPKEEP[t], `${t} costs upkeep`);
});

test('libraries and fire stations unlock at Village, the university at City', () => {
  const at = (t) => MILESTONES.find((m) => m.unlocks.includes(t))?.id;
  assert.equal(at('library'), 'village');
  assert.equal(at('firestation'), 'village');
  assert.equal(at('university'), 'city');
  assert.equal(at('bakery'), undefined, 'bakeries are open from the start');
});

test('libraries and universities give school coverage; a university reaches further', () => {
  const { city, sim } = street();
  city.apply('library', 5, 9);
  city.apply('university', 16, 9);
  sim.refresh();
  assert.ok(city.getTile(5, 13).coverage.school > 0, 'library covers nearby homes');
  assert.equal(city.getTile(5, 15).coverage.school, 0, 'library reach is short');
  assert.ok(city.getTile(16, 17).coverage.school > 0, 'university reaches 8 tiles');
});

test('a fire station covers the tiles around it and softens disaster damage there', () => {
  const { city, sim } = street();
  city.apply('house', 4, 9);
  city.apply('house', 20, 9);
  city.apply('firestation', 5, 7);
  sim.refresh();
  const near = city.getTile(4, 9);
  const far = city.getTile(20, 9);
  assert.ok(near.coverage.fire > 0.5);
  assert.equal(far.coverage.fire, 0);
  assert.ok(fireCover(near, 'fire') < fireCover(near, 'flood'), 'fires are where it helps most');
  assert.equal(fireCover(far, 'fire'), 1);
  sim.disasters.hit(near, 0.5, null, 'fire');
  sim.disasters.hit(far, 0.5, null, 'fire');
  assert.ok(near.structure.damage < far.structure.damage * 0.6, `${near.structure.damage} vs ${far.structure.damage}`);
});

test('a bakery hires workers from nearby homes', () => {
  const { city, sim } = street();
  for (let x = 3; x < 8; x++) city.apply('house', x, 9);
  city.apply('bakery', 9, 7);
  sim.refresh();
  for (let i = 0; i < 40; i++) sim.update(0.25);
  assert.ok(city.getTile(9, 7).workersFilled > 0);
});

test('saves keep the new buildings', () => {
  const { city } = street();
  NEW.forEach((t, i) => city.apply(t, 4 + i * 3, 9));
  const copy = CityState.fromJSON(JSON.parse(JSON.stringify(city.toJSON())));
  NEW.forEach((t, i) => assert.equal(copy.getTile(4 + i * 3, 9).structure?.type, t));
});

test('share links keep their old building codes, and carry the new buildings too', async () => {
  // A type's code in a share link is its position in STRUCTURES, so older links depend on this order.
  const OLD = ['house', 'cottage', 'apartments', 'tower', 'shop', 'cafe', 'mall', 'factory', 'office', 'school', 'clinic', 'playground', 'field', 'tree', 'park', 'road', 'rubble'];
  assert.deepEqual(Object.keys(STRUCTURES).slice(0, OLD.length), OLD);
  const { city } = street();
  NEW.forEach((t, i) => city.apply(t, 4 + i * 3, 9));
  const copy = await decodeCity(await encodeCity(city));
  NEW.forEach((t, i) => assert.equal(copy.getTile(4 + i * 3, 9).structure?.type, t));
});
