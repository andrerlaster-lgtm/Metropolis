// Run with: node --test tests/
// The jobs-and-commutes matcher gives exactly the results it gave before it was optimised: who works
// where, every route, traffic on every road. The expected fingerprints below were recorded from the
// original matcher (commit 518bfb4); any change to the matcher's results changes them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CityState } from '../src/state.js';
import { generateTown, generateSeed } from '../src/generator.js';
import { computeLaborMarket } from '../src/labor.js';
import { STRUCTURES } from '../src/config.js';

// A fixed town with residents in every home, a few damaged workplaces and washed-out roads.
function town(kind, size, seed) {
  const city = new CityState(size, size);
  kind === 'town' ? generateTown(city, seed) : generateSeed(city, seed);
  for (const t of city.tiles) {
    const s = t.structure;
    if (!s) continue;
    const cap = STRUCTURES[s.type].capacity;
    if (cap) s.residents = (t.x * 7 + t.y * 13 + seed) % (cap + 1);
    if (STRUCTURES[s.type].jobs && (t.x + t.y * 3 + seed) % 11 === 0) s.damage = 0.5;
    if (s.type === 'road' && (t.x * 5 + t.y + seed) % 23 === 0) s.broken = true;
  }
  city.refreshAllRoadMasks();
  return city;
}

// Everything the matcher decides, written out in full.
function fingerprint(city, result) {
  const tiles = city.tiles.map((t) => [t.employment, t.workersFilled, t.congestion]);
  const flows = result.flows.map((f) => [f.from, f.to, f.count, f.path.join('.')]);
  const data = [result.employed, result.unemployed, result.jobs, Array.from(result.load), flows, tiles];
  return createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 20);
}

const CASES = [
  ['town', 32, 1],
  ['town', 32, 2],
  ['town', 48, 3],
  ['town', 48, 5],
  ['seed', 32, 4],
];

const EXPECTED = {
  'town-32-1': '10875f3578072e859805',
  'town-32-2': '59723824820ffd1fe519',
  'town-48-3': '5183695f2bb63ee0acb0',
  'town-48-5': '7a9367a65d6961133a35',
  'seed-32-4': 'f803570d28e8e578e2a3',
  'what-if-48-3': '05849beb5969a14e84ab',
};

test('the matcher gives exactly its original results', () => {
  const got = {};
  for (const [kind, size, seed] of CASES) {
    const city = town(kind, size, seed);
    const r = computeLaborMarket(city);
    assert.ok(r.employed > 0 || kind === 'seed', `${kind}-${size}-${seed} has commuters`);
    got[`${kind}-${size}-${seed}`] = fingerprint(city, r);
  }
  // The road planner's "what if" run: extra roads, nothing written to the tiles.
  const city = town('town', 48, 3);
  const extra = new Set();
  for (const t of city.tiles) if (!t.structure && t.terrain === 'grass' && (t.x + t.y) % 4 === 0) extra.add(t.y * city.width + t.x);
  const r = computeLaborMarket(city, { extraRoads: extra, dryRun: true });
  got['what-if-48-3'] = fingerprint(city, r);
  if (process.env.RECORD) console.log(JSON.stringify(got, null, 2));
  assert.deepEqual(got, EXPECTED);
});
