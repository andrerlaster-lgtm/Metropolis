// Labor market and traffic. Residents look for the nearest jobs they can reach by road; each
// commute then loads the road tiles along its route, and busy roads cost more to use. Adapted from Cimulity's aggregate
// nearest-with-overflow matching (MIT, github.com/zeikar/cimulity).
//
// A second pass finds jobs for everyone the roads left out: people with no road at their door, and
// people whose road network has no free job left. They walk, along sidewalks, across parks and over
// open grass, around buildings and water, to the nearest free job, up to a limit. Walking never loads a
// road, so it never counts as traffic. A workplace needs no road: if a walking route reaches it, it
// employs people. A long walk is remembered per home (`commuteWalk`) and lowers how much people like
// living there (desirability.js) and shows up as a complaint (advisor.js).

import { soundness } from './disasters.js';
import { STRUCTURES, WORKER_SHARE, ROAD_CAPACITY } from './config.js';

// Walking: what it costs to cross a tile on foot (a step along a sidewalk is 1), and how far people
// will walk to work. A walk of COMFORT or less is fine; past LONG residents complain.
export const WALK_COST = { road: 1, park: 0.9, playground: 1, field: 1.1, tree: 1.3, open: 1.6 };
export const WALK_MAX = 30;
export const WALK_COMFORT = 8;
export const WALK_LONG = 16;

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
export function computeLaborMarket(city, { extraRoads = null, dryRun = false, walking = true } = {}) {
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
  const roadCap = ROAD_CAPACITY * (city.derived.skills?.roadCapacity ?? 1); // Road menders, Tramways (skills.js)
  const capacity = new Int32Array(size);
  let jobs = 0;
  for (let w = 0; w < nw; w++) {
    const t = workplaces[w];
    const sk = city.derived.skills;
    const cap = Math.round(STRUCTURES[t.structure.type].jobs * soundness(t.structure) * (sk?.jobs ?? 1) * (sk?.typeJobs?.[t.structure.type] ?? 1)); // damaged workplaces employ fewer; Business hubs more
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
  const homeWorkers = new Int32Array(homes.length);
  const homeLeft = new Int32Array(homes.length);

  // Commuters pick the cheapest route, and a road gets dearer as it fills up, so later commuters
  // spill onto alternatives when there are any (a second street, a shortcut, a ring road).
  for (let hi = 0; hi < homes.length; hi++) {
    const h = homes[hi];
    if (!dryRun) h.employment = 0;
    const workers = workersIn(h);
    if (workers <= 0) continue;
    homeWorkers[hi] = workers;
    homeLeft[hi] = workers;
    const r = city.accessRoad(h.x, h.y);
    if (!r) continue; // no road at the door: the walking pass below looks after them
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
        const busy = load[n] / roadCap;
        const nc = c + (1 + JAM_PENALTY * busy * busy);
        if (seen[n] === stamp && nc >= cost[n]) continue;
        seen[n] = stamp;
        cost[n] = nc;
        prev[n] = k;
        heapPush(n, nc);
      }
    }
    homeLeft[hi] = left;
  }

  // Everyone still without a job walks to the nearest free one (never in a what-if for new roads).
  const walks = [];
  const walkCost = new Float64Array(homes.length);
  let walkers = 0;
  if (walking && !dryRun) walkers = walkToWork(city, homes, homeLeft, workplaces, jobsAt, filled, walks, walkCost);

  for (let hi = 0; hi < homes.length; hi++) {
    const workers = homeWorkers[hi];
    if (workers <= 0) continue;
    const left = homeLeft[hi];
    employed += workers - left;
    unemployed += left;
    if (!dryRun) homes[hi].employment = (workers - left) / workers;
  }

  if (!dryRun) {
    for (let w = 0; w < nw; w++) workplaces[w].workersFilled = filled[w];
    for (let i = 0; i < size; i++) city.tiles[i].congestion = Math.min(1, load[i] / roadCap);
    for (let hi = 0; hi < homes.length; hi++) homes[hi].commuteWalk = walkCost[hi];
  }
  return { flows, employed, unemployed, jobs, load, walks, walkers };
}

// A tile people can walk across: not water, and either bare ground or something walkable (a road that
// isn't washed out, a park, a playground, a field, a tree). Buildings are only ever a start or an end.
export function canWalk(t) {
  if (!t || t.terrain !== 'grass') return false;
  const s = t.structure;
  if (!s) return true;
  if (s.type === 'road') return !s.broken;
  return !!STRUCTURES[s.type].walkable;
}
// Is there a way in: a walkable tile beside the building (so a worker can step through its door)?
export function hasEntrance(city, tile) {
  for (let d = 0; d < 4; d++) if (canWalk(city.getTile(tile.x + DX[d], tile.y + DY[d]))) return true;
  return false;
}
function walkStep(t) {
  const s = t.structure;
  return s ? WALK_COST[s.type] ?? WALK_COST.open : WALK_COST.open;
}

// The walking pass. Everyone left without a job (homeLeft) walks to the nearest workplace with a free
// job that a walking route reaches within WALK_MAX. One search from all the free jobs at once gives
// every tile its walking distance to the nearest one, so a home only has to look at its own
// neighbours; it is redone only when a workplace fills up. Returns how many people walk to work.
// Writes into `filled`, `walks` ([{ from, to, count, cost }], tile indices) and `walkCost` (a home's
// average walk to work, for the people who walk).
function walkToWork(city, homes, homeLeft, workplaces, jobsAt, filled, walks, walkCost) {
  const W = city.width;
  const H = city.height;
  const size = W * H;
  let any = false;
  for (let hi = 0; hi < homes.length && !any; hi++) any = homeLeft[hi] > 0;
  if (!any) return 0;
  const nw = workplaces.length;
  const open = new Uint8Array(size);
  const step = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    const t = city.tiles[i];
    if (canWalk(t)) {
      open[i] = 1;
      step[i] = walkStep(t);
    }
  }
  // The tiles beside each workplace (where a walker steps in), and the workplaces at each such tile.
  const at = new Map();
  for (let w = 0; w < nw; w++) {
    const t = workplaces[w];
    for (let d = 0; d < 4; d++) {
      const nx = t.x + DX[d];
      const ny = t.y + DY[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (!open[n]) continue;
      const list = at.get(n);
      if (list) list.push(w);
      else at.set(n, [w]);
    }
  }
  const free = (n) => {
    const list = at.get(n);
    if (!list) return -1;
    for (const w of list) if (jobsAt[w] - filled[w] > 0) return w;
    return -1;
  };
  const dist = new Float64Array(size);
  const src = new Int32Array(size);
  const field = () => {
    dist.fill(Infinity);
    src.fill(-1);
    mem.n = 0;
    for (const n of at.keys()) {
      if (free(n) < 0) continue;
      dist[n] = 0;
      src[n] = n;
      heapPush(n, 0);
    }
    while (mem.n) {
      heapPop();
      const k = popKey;
      const c = popPri;
      if (c > dist[k]) continue;
      if (c >= WALK_MAX) continue;
      const x = k % W;
      const y = (k - x) / W;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (!open[n]) continue;
        const nc = c + step[n];
        if (nc >= dist[n] || nc > WALK_MAX) continue;
        dist[n] = nc;
        src[n] = src[k];
        heapPush(n, nc);
      }
    }
  };
  field();
  const flowAt = new Map();
  let walkers = 0;
  for (let hi = 0; hi < homes.length; hi++) {
    let left = homeLeft[hi];
    if (left <= 0) continue;
    const h = homes[hi];
    const total = left;
    let costSum = 0;
    while (left > 0) {
      // The way out of the front door with the shortest walk to a free job.
      let best = -1;
      let bd = Infinity;
      for (let d = 0; d < 4; d++) {
        const nx = h.x + DX[d];
        const ny = h.y + DY[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (open[n] && dist[n] < bd) {
          bd = dist[n];
          best = n;
        }
      }
      if (best < 0 || !Number.isFinite(bd)) break;
      const entry = src[best];
      let w = free(entry);
      if (w < 0) {
        field(); // that one has just filled up
        continue;
      }
      const take = Math.min(left, jobsAt[w] - filled[w]);
      filled[w] += take;
      left -= take;
      walkers += take;
      costSum += take * (bd + 1);
      const key = hi * 65536 + w;
      const f = flowAt.get(key);
      if (f) f.count += take;
      else {
        const flow = { from: h.y * W + h.x, to: workplaces[w].y * W + workplaces[w].x, count: take, cost: bd + 1 };
        flowAt.set(key, flow);
        walks.push(flow);
      }
      if (free(entry) < 0) field(); // nothing left there: look again from what is still free
    }
    homeLeft[hi] = left;
    const walked = total - left;
    walkCost[hi] = walked > 0 ? costSum / walked : 0;
  }
  return walkers;
}
