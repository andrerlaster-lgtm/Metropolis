// Coverage: each school, clinic, library, university or fire station covers the tiles around it, strongest
// nearby. Each also has a quality (SERVICE_RATING in config.js): it falls when more residents rely on the
// building than it can look after, drifts back when they don't, and scales the coverage it gives.
//
// Quality is derived data like the rest of coverage: it is never saved, so a reloaded town starts at each
// building's current target (no lag) and then drifts as usual.
//   city.derived.serviceRatings: structure id → quality (0.3..1)
//   city.derived.serviceStats:   one entry per service building, for the inspector, advisor and growth

import { STRUCTURES, COVERAGE_IDS, SERVICE_RATING } from './config.js';

// Quality a building is heading for, given how many residents rely on it.
export function targetRating(demand, serves) {
  const load = demand / serves;
  return load <= 1 ? 1 : Math.max(SERVICE_RATING.min, 1 / load);
}

// `days`: in-game days since the last call. Quality moves toward its target by at most
// SERVICE_RATING.perDay a day; with 0 days it only settles buildings that have no quality yet.
export function computeCoverage(city, days = 0) {
  const derived = city.derived;
  const old = derived.serviceRatings || {};
  const ratings = {};
  const stats = [];

  for (const t of city.tiles) {
    const c = (t.coverage ||= {});
    for (const id of COVERAGE_IDS) c[id] = 0;
  }

  // Pass 1: how strongly each service building reaches each tile, and how much total reach every home with
  // residents has per service. A home's residents are shared out in proportion to that reach, weighted by
  // capacity: people use the nearer and the bigger building more, so neighbours end up equally busy.
  const sources = [];
  const reach = new Map(); // home tile → { service → total strength }
  for (const src of city.tiles) {
    const def = src.structure && STRUCTURES[src.structure.type];
    if (!def?.service) continue;
    const r = def.radius + (city.derived.notableEffects?.radius?.[def.service] || 0) + (city.derived.skills?.radius?.[def.service] || 0); // notable people and upgrades widen it
    const cells = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const t = city.getTile(src.x + dx, src.y + dy);
        if (!t) continue;
        const d = Math.hypot(dx, dy);
        if (d > r) continue;
        const v = 1 - (d / (r + 1)) ** 2;
        cells.push(t, v);
        if (def.serves && t.structure?.residents > 0) {
          const sums = reach.get(t) || reach.set(t, {}).get(t);
          sums[def.service] = (sums[def.service] || 0) + v * def.serves;
        }
      }
    }
    sources.push({ src, def, cells });
  }

  // Pass 2: each building's demand, then its quality, then the coverage it gives.
  for (const { src, def, cells } of sources) {
    let demand = 0;
    if (def.serves) {
      for (let i = 0; i < cells.length; i += 2) {
        const t = cells[i];
        if (t.structure?.residents > 0) demand += (t.structure.residents * cells[i + 1] * def.serves) / reach.get(t)[def.service];
      }
    }
    const id = src.structure.id;
    let rating = 1;
    if (def.serves) {
      const target = targetRating(demand, def.serves);
      rating = old[id] ?? target;
      const step = SERVICE_RATING.perDay * days;
      rating += Math.max(-step, Math.min(step, target - rating));
      ratings[id] = rating;
      stats.push({ tile: src, id, type: src.structure.type, service: def.service, demand, serves: def.serves, load: demand / def.serves, target, rating });
    }
    for (let i = 0; i < cells.length; i += 2) {
      const v = cells[i + 1] * rating;
      const c = cells[i].coverage;
      if (v > c[def.service]) c[def.service] = v;
    }
  }

  derived.serviceRatings = ratings;
  derived.serviceStats = stats;
}
