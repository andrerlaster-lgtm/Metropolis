// Run with: node --test tests/
// Reach: the preview of what a building does to the homes around it matches the rules that really
// apply it (coverage for services, desirability for parks and smoke).
import test from 'node:test';
import assert from 'node:assert/strict';

const { CityState } = await import('../src/state.js');
const { generateTown } = await import('../src/generator.js');
const { Simulation } = await import('../src/simulation.js');
const { STRUCTURES } = await import('../src/config.js');
const { influenceOf, reachOf, reachTiles, reachText, homesNeeding } = await import('../src/influence.js');

function town(seed = 5) {
  const city = new CityState(32, 32);
  generateTown(city, seed);
  const sim = new Simulation(city);
  sim.refresh();
  return { city, sim };
}

test('each building says what it affects: services, parks and trees, factory smoke', () => {
  assert.deepEqual(influenceOf('school').map((e) => [e.id, e.radius, e.good]), [['school', STRUCTURES.school.radius, true]]);
  assert.deepEqual(influenceOf('clinic').map((e) => e.id), ['health']);
  assert.deepEqual(influenceOf('field').map((e) => e.id).sort(), ['fun', 'greenery']);
  assert.deepEqual(influenceOf('tree').map((e) => e.id), ['greenery']);
  assert.deepEqual(influenceOf('factory').map((e) => [e.id, e.good]), [['pollution', false]]);
  assert.deepEqual(influenceOf('house'), []);
  assert.deepEqual(influenceOf('road'), []);
});

test('the school preview covers exactly the tiles a real school reaches', () => {
  const { city, sim } = town(6);
  // Somewhere with space: an empty grass tile well inside the map.
  const spot = city.tiles.find((t) => !t.structure && t.terrain === 'grass' && t.x > 8 && t.y > 8 && t.x < 24 && t.y < 24 && city.canApply('school', t.x, t.y));
  assert.ok(spot);
  const preview = reachOf(city, spot.x, spot.y, 'school')[0];
  const before = new Map(city.tiles.map((t) => [t, t.coverage?.school || 0]));
  city.apply('school', spot.x, spot.y);
  sim.refresh();
  const gained = city.tiles.filter((t) => (t.coverage?.school || 0) > before.get(t) + 1e-9).map((t) => `${t.x},${t.y}`);
  const shown = new Set(preview.tiles.map((c) => `${c.x},${c.y}`));
  for (const k of gained) assert.ok(shown.has(k), `coverage at ${k} was in the preview`);
});

test('parks and trees reach 3 tiles and never their own tile; a factory bothers homes 4 tiles away', () => {
  const city = new CityState(20, 20);
  const [green] = influenceOf('tree');
  const t = reachTiles(city, 10, 10, green);
  assert.ok(!t.some((c) => c.x === 10 && c.y === 10));
  assert.ok(t.some((c) => c.x === 13 && c.y === 10));
  assert.ok(!t.some((c) => c.x === 14 && c.y === 10));
  const [smoke] = influenceOf('factory');
  const s = reachTiles(city, 10, 10, smoke);
  assert.ok(s.some((c) => c.x === 14 && c.y === 12));
  assert.ok(!s.some((c) => c.x === 14 && c.y === 14), 'the far corner is beyond the smoke, as in desirability.js');
  assert.ok(!s.some((c) => c.x === 15 && c.y === 10));
});

test('the preview counts homes in reach and the ones that still need it', () => {
  const { city } = town(7);
  const home = city.homes().find((h) => h.structure.residents > 0);
  const r = reachOf(city, home.x, home.y, 'clinic')[0];
  assert.ok(r.homes >= 1);
  assert.ok(r.needing <= r.homes);
  assert.match(reachText([r]), /^Clinics · \d+ tiles · \d+ homes?/);
  assert.match(reachText([{ label: 'Factory smoke', radius: 4, good: false, homes: 3, needing: 0 }]), /bothers 3 homes/);
  // Homes marked as needing a clinic are lived-in homes without clinic cover.
  for (const c of homesNeeding(city, 'clinic')) {
    const t = city.getTile(c.x, c.y);
    assert.ok(t.structure.residents > 0 && (t.coverage?.health || 0) < 0.15);
  }
  assert.deepEqual(homesNeeding(city, 'factory'), []);
});

test('upgrades and notable people that widen a service widen its preview too', () => {
  const { city } = town(8);
  const base = influenceOf('school', city)[0].radius;
  city.derived.skills = { radius: { school: 1 } };
  assert.equal(influenceOf('school', city)[0].radius, base + 1);
});
