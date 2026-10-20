// Run with: node --test tests/
// The desirability layout cache gives exactly what computing every factor afresh gives, whatever
// changes the map: building, bulldozing, water, roads washed out or snowed in, rubble, resizing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CityState } from '../src/state.js';
import { generateTown, generateSeed } from '../src/generator.js';
import { Simulation } from '../src/simulation.js';
import { FACTORS, recomputeDesirability } from '../src/desirability.js';
import { mulberry32 } from '../src/utils.js';

// The reference: every enabled factor computed afresh for every tile, summed in order.
function fresh(city) {
  return city.tiles.map((tile) => {
    let d = 0.28;
    const factors = {};
    for (const f of FACTORS) {
      if (!f.enabled) continue;
      const v = f.compute(city, tile);
      factors[f.id] = v;
      d += v;
    }
    return { d: Math.min(1, Math.max(0, d)), factors };
  });
}

function assertSame(city, label) {
  const want = fresh(city);
  city.tiles.forEach((t, i) => {
    if (t.desirability !== want[i].d) assert.fail(`${label}: tile ${t.x},${t.y} desirability ${t.desirability} ≠ ${want[i].d}`);
    for (const [k, v] of Object.entries(want[i].factors)) if (t.factors[k] !== v) assert.fail(`${label}: tile ${t.x},${t.y} ${k} ${t.factors[k]} ≠ ${v}`);
  });
}

const TOOLS = ['house', 'apartments', 'shop', 'factory', 'park', 'tree', 'road', 'road', 'school', 'playground', 'water', 'bulldoze', 'mall', 'field'];

test('every kind of map change keeps the cache exact (randomised)', () => {
  for (const seed of [1, 2, 3]) {
    const rng = mulberry32(seed);
    const city = new CityState(32, 32);
    seed === 2 ? generateSeed(city, seed) : generateTown(city, seed);
    const sim = new Simulation(city);
    sim.refresh();
    assertSame(city, `seed ${seed} start`);
    for (let round = 0; round < 60; round++) {
      // A few changes of any kind, some through apply() and some written straight onto tiles.
      for (let k = 0; k < 1 + Math.floor(rng() * 6); k++) {
        const t = city.tiles[Math.floor(rng() * city.tiles.length)];
        const r = rng();
        if (r < 0.6) city.apply(TOOLS[Math.floor(rng() * TOOLS.length)], t.x, t.y);
        else if (r < 0.7 && t.structure?.type === 'road') t.structure.broken = !t.structure.broken; // washed out (no notice)
        else if (r < 0.8 && t.structure?.type === 'road') t.structure.snowed = !t.structure.snowed; // snowed in (no notice)
        else if (r < 0.9 && t.structure && t.structure.type !== 'road') t.structure = { id: city.nextId++, type: 'rubble', residents: 0, was: t.structure.type }; // destroyed
        else t.terrain = t.terrain === 'water' ? 'grass' : 'water'; // terrain flipped directly
      }
      if (round % 3 === 0) sim.refresh();
      else recomputeDesirability(city);
      assertSame(city, `seed ${seed} round ${round}`);
    }
  }
});

test('resizing, a new town in the same city and loading a copy keep it exact', () => {
  const city = new CityState(24, 24);
  generateTown(city, 4);
  const sim = new Simulation(city);
  sim.refresh();
  city.resize(32, 32, 4, 4); // an old town re-centred on a bigger map
  recomputeDesirability(city);
  assertSame(city, 'resized');
  const other = new CityState(32, 32);
  generateSeed(other, 9);
  city.copyFrom(other); // swapping in another town (a save slot or a shared town)
  recomputeDesirability(city);
  assertSame(city, 'copied');
  city.reset();
  recomputeDesirability(city);
  assertSame(city, 'reset');
});

test('a long simulated stretch with growth and wild weather stays exact', () => {
  const city = new CityState(32, 32);
  generateTown(city, 6);
  const sim = new Simulation(city);
  sim.growth.on = true;
  sim.disasters.level = 'wild';
  sim.refresh();
  sim.speed = 10;
  for (let i = 0; i < 6000; i++) {
    if (sim.decisions.pending) sim.decisions.choose(0);
    sim.update(0.1);
    if (i % 500 === 0) {
      recomputeDesirability(city);
      assertSame(city, `step ${i}`);
    }
  }
});
