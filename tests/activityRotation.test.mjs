// Run with: node --test tests/
// Life Story activities (Phase 5): essentials are always on offer, the rest rotate each year and the
// rotation is saved on the character; every activity runs to a clean sentence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CityState } from '../src/state.js';
import { Simulation } from '../src/simulation.js';
import { generateTown } from '../src/generator.js';
import { LifeSystem } from '../src/life.js';
import { ACTIVITIES, ROTATION_SIZE, pickRotation } from '../src/lifeActivities.js';
import { ACTIVITY_GAINS } from '../src/autopilot.js';
import { mulberry32 } from '../src/utils.js';

function town(seed = 5) {
  const city = new CityState(32, 32);
  generateTown(city, seed);
  const sim = new Simulation(city);
  sim.refresh();
  return city;
}
const make = (life) => life.create({ first: 'Ava', last: 'Park', pronouns: 'she', look: { outfit: '#ff8f7e' }, traits: ['curious', 'sporty'] });
const essentials = ACTIVITIES.filter((a) => a.essential).map((a) => a.id);

test('there are at least 25 more activities than before, each with a group, an age and an auto-mode value', () => {
  assert.ok(ACTIVITIES.length >= 18 + 25, `${ACTIVITIES.length} activities`);
  assert.equal(new Set(ACTIVITIES.map((a) => a.id)).size, ACTIVITIES.length, 'ids are unique');
  for (const a of ACTIVITIES) {
    assert.ok(a.group && typeof a.label === 'function' && typeof a.run === 'function', a.id);
    assert.ok(ACTIVITY_GAINS[a.id] || ['job_hunt', 'buy_home'].includes(a.id), `${a.id} is understood by auto mode`);
  }
});

test('essentials are on offer at every age; the rest rotate and are saved on the character', () => {
  const life = new LifeSystem(town(), { rng: mulberry32(4) });
  const c = make(life);
  c.age = 15;
  life.birthday();
  const first = c.offered;
  assert.equal(first.age, 16);
  assert.ok(first.ids.length > 0 && first.ids.length <= ROTATION_SIZE);
  assert.ok(first.ids.every((id) => !essentials.includes(id)), 'only non-essentials rotate');
  const ids = () => life.activities().map((a) => a.id);
  for (const e of ['study', 'exercise', 'rest', 'meet']) assert.ok(ids().includes(e), `${e} is always there`);
  // Nothing outside the rotation (and not essential) is offered.
  for (const id of ids()) assert.ok(essentials.includes(id) || first.ids.includes(id), id);
  // The rotation doesn't change within a year, and it survives a save and load.
  assert.deepEqual(life.rotate(), first.ids);
  const back = JSON.parse(JSON.stringify(c));
  assert.deepEqual(back.offered, first);
  // A new year brings a new set, mostly different.
  let changed = 0;
  let prev = first.ids;
  for (let y = 0; y < 8; y++) {
    life.birthday();
    if (c.offered.ids.some((id) => !prev.includes(id))) changed++;
    prev = c.offered.ids;
  }
  assert.ok(changed >= 7, 'a different mix most years');
});

test('an older save with no rotation gets one the first time activities are asked for', () => {
  const life = new LifeSystem(town(), { rng: mulberry32(8) });
  const c = make(life);
  c.age = 30;
  delete c.offered;
  assert.ok(life.activities().length >= essentials.length - 5);
  assert.equal(c.offered.age, 30);
});

test('rotation avoids last year unless there is nothing else', () => {
  const pool = ACTIVITIES.filter((a) => !a.essential);
  const rng = mulberry32(3);
  const prev = pickRotation(pool, [], 9, rng).slice();
  let overlap = 0;
  for (let i = 0; i < 50; i++) overlap += pickRotation(pool, prev, 9, rng).filter((id) => prev.includes(id)).length;
  assert.ok(overlap / 50 < 3, `average overlap ${overlap / 50}`);
  assert.equal(pickRotation(pool.slice(0, 3), [], 9, rng).length, 3, 'a small pool is used whole');
});

test('every activity runs to a clean sentence in a town that has everything', () => {
  const city = town();
  // Put one of every building near the character's home.
  const life = new LifeSystem(city, { rng: mulberry32(12) });
  const c = make(life);
  c.age = 30;
  c.money = 100000;
  c.partner = { name: 'Sam Park', closeness: 60, alive: true };
  c.friends = [{ name: 'Jo Lee', closeness: 50 }];
  c.job = c.job || null;
  const home = c.home || { x: 16, y: 16 };
  const free = city.tiles.filter((t) => t.terrain === 'grass' && !t.structure && Math.hypot(t.x - home.x, t.y - home.y) < 9);
  const types = ['pool', 'library', 'museum', 'restaurant', 'cinema', 'fountain', 'garden', 'market', 'stadium', 'park', 'workshop', 'bank', 'hospital', 'kindergarten'];
  types.forEach((type, i) => {
    if (free[i]) free[i].structure = { id: 9000 + i, type, residents: 0 };
  });
  c.offered = { age: c.age, ids: ACTIVITIES.filter((a) => !a.essential).map((a) => a.id) };
  let ran = 0;
  for (const a of ACTIVITIES) {
    c.energy = 3;
    c.pending = null;
    if (a.id === 'job_hunt' || a.id === 'buy_home') continue;
    if (a.id === 'network' || a.id === 'overtime') c.job = { type: 'shop', x: 1, y: 1, level: 0, years: 3 };
    const offer = life.activities().find((x) => x.id === a.id);
    if (!offer || offer.blocked) continue;
    assert.ok(!/[{}]|undefined|NaN/.test(offer.label + offer.hint), `${a.id}: ${offer.label} / ${offer.hint}`);
    const r = life.doActivity(a.id);
    assert.ok(r?.text && !/[{}]|undefined|NaN/.test(r.text), `${a.id}: ${r?.text}`);
    ran++;
  }
  assert.ok(ran >= 40, `${ran} activities ran`);
});
