// Labor market and traffic. Residents look for the nearest jobs they can reach by road; each
// commute then loads the road tiles along its route, and busy roads cost more to use. Adapted from Cimulity's aggregate
// nearest-with-overflow matching (MIT, github.com/zeikar/cimulity).

import { soundness } from './disasters.js';
import { STRUCTURES, WORKER_SHARE, ROAD_CAPACITY } from './config.js';

// How much a full road slows commuters down: a jammed tile costs 1 + JAM_PENALTY steps.
const JAM_PENALTY = 3;
// Neighbours in the order routes are explored: north, east, south, west.
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

// Working memory for the route searches, kept between runs (the matcher runs about once a game
// second) so nothing is allocated per search: a binary min-heap of (tile, cost) in two typed arrays,
// and the per-tile cost, previous step and "seen in this search" stamp.
const mem = { size: 0, prev: null, seen: null, cost: null, stamp: 0, keys: new Int32Array(1024), pris: new Float64Array(1024), n: 0 };

function memoryFor(size) {
  if (mem.size !== size) {
    mem.size = size;
    mem.prev = new Int32Array(size);
    mem.seen = new Uint32Array(size);
    mem.cost = new Float64Array(size);
    mem.stamp = 0;
  }
  if (mem.stamp > 0xfffffff0) {
    mem.seen.fill(0);
    mem.stamp = 0;
  }
  return mem;
}

// Heap operations, the same comparisons and swaps as an array of [tile, cost] pairs would make, so
// ties pop in the same order.
function heapPush(key, pri) {
  if (mem.n === mem.keys.length) {
    const keys = new Int32Array(mem.n * 2);
    const pris = new Float64Array(mem.n * 2);
    keys.set(mem.keys);
    pris.set(mem.pris);
    mem.keys = keys;
    mem.pris = pris;
  }
  const { keys, pris } = mem;
  let i = mem.n++;
  keys[i] = key;
  pris[i] = pri;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (pris[p] <= pris[i]) break;
    const k = keys[p];
    const q = pris[p];
    keys[p] = keys[i];
    pris[p] = pris[i];
    keys[i] = k;
    pris[i] = q;
    i = p;
  }
}

// Removes the cheapest entry; its tile and cost are left in popKey and popPri.
let popKey = 0;
let popPri = 0;
function heapPop() {
  const { keys, pris } = mem;
  popKey = keys[0];
  popPri = pris[0];
  const n = --mem.n;
  if (n > 0) {
    keys[0] = keys[n];
    pris[0] = pris[n];
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < n && pris[l] < pris[m]) m = l;
      if (r < n && pris[r] < pris[m]) m = r;
      if (m === i) break;
      const k = keys[m];
      const q = pris[m];
      keys[m] = keys[i];
      pris[m] = pris[i];
      keys[i] = k;
      pris[i] = q;
      i = m;
    }
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
  const W = city.width;
  const H = city.height;
  const size = W * H;
  const { prev, seen, cost } = memoryFor(size);
  // Usable roads (as city.isRoad decides), looked up once instead of per step of every route search.
  const road = new Uint8Array(size);
  for (let i = 0; i < size; i++) road[i] = city.isRoad(i % W, (i / W) | 0) || (extraRoads?.has(i) ?? false) ? 1 : 0;
  const homes = city.homes(); // in map order, which is the order homes are matched in
  const workplaces = city.workplaces();

  // Jobs per workplace, workers placed so far, and the workplaces each access road serves (in the
  // order they come on the map). Several workplaces can share one road; `capacity` is what's left.
  const nw = workplaces.length;
  const jobsAt = new Int32Array(nw);
  const filled = new Int32Array(nw);
  const nextAtRoad = new Int32Array(nw).fill(-1);
  const firstAtRoad = new Int32Array(size).fill(-1);
  const lastAtRoad = new Int32Array(size).fill(-1);
  const capacity = new Int32Array(size);
  let jobs = 0;
  for (let w = 0; w < nw; w++) {
    const t = workplaces[w];
    const cap = Math.round(STRUCTURES[t.structure.type].jobs * soundness(t.structure)); // damaged workplaces employ fewer
    jobsAt[w] = cap;
    jobs += cap;
    const r = city.accessRoad(t.x, t.y);
    if (!r) continue;
    const k = r.y * W + r.x;
    capacity[k] += cap;
    if (firstAtRoad[k] === -1) firstAtRoad[k] = w;
    else nextAtRoad[lastAtRoad[k]] = w;
    lastAtRoad[k] = w;
  }

  const load = new Float32Array(size);
  const flows = [];
  let employed = 0;
  let unemployed = 0;

  // Commuters pick the cheapest route, and a road gets dearer as it fills up, so later commuters
  // spill onto alternatives when there are any (a second street, a shortcut, a ring road).
  for (const h of homes) {
    if (!dryRun) h.employment = 0;
    const workers = workersIn(h);
    if (workers <= 0) continue;
    const r = city.accessRoad(h.x, h.y);
    if (!r) {
      unemployed += workers;
      continue;
    }
    let left = workers;
    const stamp = ++mem.stamp;
    const start = r.y * W + r.x;
    seen[start] = stamp;
    cost[start] = 0;
    prev[start] = -1;
    mem.n = 0;
    heapPush(start, 0);
    while (mem.n && left > 0) {
      heapPop();
      const k = popKey;
      const c = popPri;
      if (c > cost[k]) continue; // a cheaper way here was already found
      const cap = capacity[k];
      if (cap > 0) {
        const take = Math.min(cap, left);
        capacity[k] = cap - take;
        left -= take;
        let len = 0;
        for (let p = k; p !== -1; p = prev[p]) len++;
        const path = new Array(len);
        for (let p = k, i = len - 1; p !== -1; p = prev[p], i--) path[i] = p;
        // Only traffic passing through counts towards a jam. Turning in and out at your own front
        // door (the first and last tile) is what busy buildings do, not a sign the road is too small.
        for (let i = 1; i < len - 1; i++) load[path[i]] += take;
        flows.push({ from: start, to: k, count: take, path });
        let remaining = take;
        for (let w = firstAtRoad[k]; w !== -1; w = nextAtRoad[w]) {
          const add = Math.min(jobsAt[w] - filled[w], remaining);
          filled[w] += add;
          remaining -= add;
          if (!remaining) break;
        }
      }
      const x = k % W;
      const y = (k - x) / W;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (road[n] !== 1) continue;
        const busy = load[n] / ROAD_CAPACITY;
        const nc = c + (1 + JAM_PENALTY * busy * busy);
        if (seen[n] === stamp && nc >= cost[n]) continue;
        seen[n] = stamp;
        cost[n] = nc;
        prev[n] = k;
        heapPush(n, nc);
      }
    }
    employed += workers - left;
    unemployed += left;
    if (!dryRun) h.employment = (workers - left) / workers;
  }

  if (!dryRun) {
    for (let w = 0; w < nw; w++) workplaces[w].workersFilled = filled[w];
    for (let i = 0; i < size; i++) city.tiles[i].congestion = Math.min(1, load[i] / ROAD_CAPACITY);
  }
  return { flows, employed, unemployed, jobs, load };
}
