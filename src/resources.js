// Resources: a small supply system. Three things the town makes and uses each day: food (farms and
// markets feed the homes), goods (workshops and factories supply the businesses) and power (power
// plants, from the Motor age). Everything here is worked out afresh each refresh from the buildings
// and who works in them, so nothing is saved and old towns need nothing converted.
//
// Supplies only ever help: a fed town is a little happier, a well-supplied one earns a little more.
// A shortage just means missing the bonus, and the City panel says what would help. Producers are the
// `produces` numbers in config.js (per day, scaled by how many of the jobs are filled).

import { STRUCTURES, RESOURCES, RESOURCE_NEED } from './config.js';

// → { food: { made, need, ratio }, goods: {…}, power: {…, active} } with ratio 0..1 (1 when nothing is needed).
export function computeResources(city, eraIndex = 0) {
  const made = { food: 0, goods: 0, power: 0 };
  let residents = 0;
  let workers = 0;
  for (const t of city.tiles) {
    const s = t.structure;
    if (!s) continue;
    const def = STRUCTURES[s.type];
    if (def.capacity) residents += s.residents || 0;
    if (!def.jobs) continue;
    workers += t.workersFilled || 0;
    if (def.produces) {
      const staffed = def.jobs ? Math.min(1, (t.workersFilled || 0) / def.jobs) : 1;
      for (const [k, v] of Object.entries(def.produces)) made[k] += v * (0.4 + 0.6 * staffed); // a idle building still makes a little
    }
  }
  // Open-ground producers (a farm has jobs but needs no road, so it's counted above like any workplace).
  const need = {
    food: residents * RESOURCE_NEED.foodPerResident,
    goods: workers * RESOURCE_NEED.goodsPerWorker,
    power: eraIndex >= RESOURCE_NEED.powerFromEra ? residents * RESOURCE_NEED.powerPerResident + workers * RESOURCE_NEED.powerPerWorker : 0,
  };
  const out = {};
  for (const k of Object.keys(RESOURCES)) {
    out[k] = { made: Math.round(made[k]), need: Math.round(need[k]), ratio: need[k] > 0 ? Math.min(1, made[k] / need[k]) : 1 };
  }
  out.power.active = need.power > 0;
  return out;
}

// What would fix the weakest supply, in words (for the City panel and the advisor).
export function shortage(res) {
  const low = ['food', 'power', 'goods'].filter((k) => res[k] && res[k].need > 0 && res[k].ratio < 0.95).sort((a, b) => res[a].ratio - res[b].ratio)[0];
  if (!low) return null;
  const fix = { food: 'a farm or a market', goods: 'a workshop or a factory', power: 'a power plant' }[low];
  return { kind: low, ratio: res[low].ratio, fix };
}
