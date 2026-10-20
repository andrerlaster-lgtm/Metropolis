// Labor market and traffic. Residents look for the nearest jobs they can reach by road; each
// commute then loads the road tiles along its route, and busy roads cost more to use. Adapted from Cimulity's aggregate
// nearest-with-overflow matching (MIT, github.com/zeikar/cimulity).

import { soundness } from './disasters.js';
import { STRUCTURES, WORKER_SHARE, ROAD_CAPACITY } from './config.js';

const NEIGHBOURS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
// How much a full road slows commuters down: a jammed tile costs 1 + JAM_PENALTY steps.
const JAM_PENALTY = 3;

// A small binary heap of [key, priority] pairs for the route search.
class MinHeap {
  constructor() {
    this.items = [];
  }
  get size() {
    return this.items.length;
  }
  clear() {
    this.items.length = 0;
  }
  push(key, pri) {
    const a = this.items;
    a.push([key, pri]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][1] <= a[i][1]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][1] < a[m][1]) m = l;
        if (r < a.length && a[r][1] < a[m][1]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

export function workersIn(home) {
  return Math.round(home.structure.residents * WORKER_SHARE);
}

// Returns { flows, employed, unemployed, jobs, load } and writes per-tile employment, workersFilled
// and congestion. Each flow is { from, to, count, path } where path lists road tiles.
// Options for "what if" tests: `extraRoads` (a Set of tile indices treated as road) and `dryRun`
// (write nothing to the tiles; just return the result).
export function computeLaborMarket(city, { extraRoads = null, dryRun = false } = {}) {
  const filled = new Map(); // workplace tile → workers, written to the tile at the end
  const W = city.width;
  const H = city.height;
  const size = W * H;
  // Usable roads (as city.isRoad decides), looked up once instead of per step of every route search.
  const road = new Uint8Array(size);
  for (let i = 0; i < size; i++) road[i] = city.isRoad(i % W, (i / W) | 0) || (extraRoads?.has(i) ?? false) ? 1 : 0;
  const isRoad = (x, y) => x >= 0 && y >= 0 && x < W && y < H && road[y * W + x] === 1;
  const homes = city.homes();
  const workplaces = city.workplaces();

  // Remaining capacity per access road (several workplaces can share one).
  const capacity = new Map();
  const destinations = new Map(); // access road index → workplace tiles
  let jobs = 0;
  for (const w of workplaces) {
    const cap = Math.round(STRUCTURES[w.structure.type].jobs * soundness(w.structure)); // damaged workplaces employ fewer
    jobs += cap;
    filled.set(w, 0);
    const road = city.accessRoad(w.x, w.y);
    if (!road) continue;
    const k = road.y * W + road.x;
    capacity.set(k, (capacity.get(k) || 0) + cap);
    if (!destinations.has(k)) destinations.set(k, []);
    destinations.get(k).push(w);
  }

  const load = new Float32Array(size);
  const flows = [];
  let employed = 0;
  let unemployed = 0;
  const prev = new Int32Array(size);
  const seen = new Uint32Array(size);
  let stamp = 0;

  // Process homes in a stable order so results don't jitter between ticks.
  const origins = homes
    .map((h) => ({ h, workers: workersIn(h), road: city.accessRoad(h.x, h.y) }))
    .sort((a, b) => a.h.y * W + a.h.x - (b.h.y * W + b.h.x));

  // Commuters pick the cheapest route, and a road gets dearer as it fills up, so later commuters
  // spill onto alternatives when there are any (a second street, a shortcut, a ring road).
  const cost = new Float64Array(size);
  const heap = new MinHeap();
  const stepCost = (k) => {
    const busy = load[k] / ROAD_CAPACITY;
    return 1 + JAM_PENALTY * busy * busy;
  };

  for (const o of origins) {
    if (!dryRun) o.h.employment = 0;
    if (o.workers <= 0) continue;
    if (!o.road) {
      unemployed += o.workers;
      continue;
    }
    let left = o.workers;
    stamp++;
    const start = o.road.y * W + o.road.x;
    seen[start] = stamp;
    cost[start] = 0;
    prev[start] = -1;
    heap.clear();
    heap.push(start, 0);
    while (heap.size && left > 0) {
      const [k, c] = heap.pop();
      if (c > cost[k]) continue; // a cheaper way here was already found
      const cap = capacity.get(k);
      if (cap > 0) {
        const take = Math.min(cap, left);
        capacity.set(k, cap - take);
        left -= take;
        const path = [];
        for (let p = k; p !== -1; p = prev[p]) path.push(p);
        path.reverse();
        // Only traffic passing through counts towards a jam. Turning in and out at your own front
        // door (the first and last tile) is what busy buildings do, not a sign the road is too small.
        for (let i = 1; i < path.length - 1; i++) load[path[i]] += take;
        flows.push({ from: start, to: k, count: take, path });
        let remaining = take;
        for (const w of destinations.get(k)) {
          const room = Math.round(STRUCTURES[w.structure.type].jobs * soundness(w.structure)) - filled.get(w);
          const add = Math.min(room, remaining);
          filled.set(w, filled.get(w) + add);
          remaining -= add;
          if (!remaining) break;
        }
      }
      const x = k % W;
      const y = (k - x) / W;
      for (const [dx, dy] of NEIGHBOURS) {
        if (!isRoad(x + dx, y + dy)) continue;
        const n = (y + dy) * W + x + dx;
        const nc = c + stepCost(n);
        if (seen[n] === stamp && nc >= cost[n]) continue;
        seen[n] = stamp;
        cost[n] = nc;
        prev[n] = k;
        heap.push(n, nc);
      }
    }
    employed += o.workers - left;
    unemployed += left;
    if (!dryRun) o.h.employment = (o.workers - left) / o.workers;
  }

  if (!dryRun) {
    for (const [w, n] of filled) w.workersFilled = n;
    for (let i = 0; i < size; i++) city.tiles[i].congestion = Math.min(1, load[i] / ROAD_CAPACITY);
  }
  return { flows, employed, unemployed, jobs, load };
}
