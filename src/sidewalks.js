// The pedestrian network: where people may walk. Sidewalks run along both edges of every road,
// zebra crossings sit at junctions and every few tiles along long streets, and parks, squares and
// open ground link up between them. Buildings are only ever a start or an end (people go in and
// out through the door facing their next step), so nobody walks through a building or down the
// middle of a road. Both the overhead and the 3D view draw the same sidewalks and crossings.
// Positions are in grid units, like everything the agents do.

import { STRUCTURES } from './config.js';
import { DIRS } from './state.js';

export const SIDEWALK = 0.15; // width of the sidewalk strip along an unconnected road edge
export const WALK_LINE = 0.075; // people walk down the middle of it
const JAYWALK = 4; // crossing a street away from a zebra crossing costs as much as walking four tiles
const CROSSWALK = 0.15;
const CORNER = [
  [WALK_LINE, WALK_LINE],
  [1 - WALK_LINE, WALK_LINE],
  [1 - WALK_LINE, 1 - WALK_LINE],
  [WALK_LINE, 1 - WALK_LINE],
];
// How much each kind of open ground costs to cross per tile: park paths are pleasant, lawns less so.
const GROUND_COST = { park: 0.9, playground: 1, field: 1.1, tree: 1.3 };
const OPEN_COST = 2;
const TYPE_INDEX = new Map(Object.keys(STRUCTURES).map((k, i) => [k, i]));

const popcount = (m) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);

// A road tile people can walk along (a washed-out road can't be walked; a snowed-in one can).
function roadTile(t) {
  return !!t && t.terrain === 'grass' && t.structure?.type === 'road' && !t.structure.broken;
}

// Which sides of a road tile join another walkable road tile (N, E, S, W bits, like roadMask).
// Same as roadMask, except that snow doesn't close the sidewalks.
export function footArms(city, t) {
  if (!roadTile(t)) return 0;
  let m = 0;
  for (const d of DIRS) if (roadTile(city.getTile(t.x + d.dx, t.y + d.dy))) m |= d.bit;
  return m;
}

// Which sides of a road tile carry a zebra crossing: every arm of a junction, and one side of a
// straight stretch every five tiles (not right next to a junction, which has its own).
export function crosswalkMask(city, x, y) {
  const t = city.getTile(x, y);
  if (!roadTile(t)) return 0;
  const m = footArms(city, t);
  const arms = popcount(m);
  if (arms >= 3) return m;
  const junction = (tx, ty) => {
    const n = city.getTile(tx, ty);
    return roadTile(n) && popcount(footArms(city, n)) >= 3;
  };
  if (m === 10 && ((x % 5) + 5) % 5 === 2 && !junction(x - 1, y) && !junction(x + 1, y)) return 8;
  if (m === 5 && ((y % 5) + 5) % 5 === 2 && !junction(x, y - 1) && !junction(x, y + 1)) return 1;
  return 0;
}

// A cheap fingerprint of everything the network depends on, so it is rebuilt only when the map changes.
function layoutHash(city) {
  let h = 2166136261 ^ city.width ^ (city.height << 8);
  for (const t of city.tiles) {
    const s = t.structure;
    const code = t.terrain === 'water' ? 1 : s ? 2 + TYPE_INDEX.get(s.type) * 4 + (s.broken ? 1 : 0) + (t.roadMask << 10) : 0;
    h = Math.imul(h ^ code, 16777619);
  }
  return h >>> 0;
}

export class SidewalkNetwork {
  constructor(city) {
    this.city = city;
    this.hash = null;
    this.version = 0;
  }

  // Rebuild if the map has changed since the last route. Cheap when it hasn't.
  refresh() {
    const h = layoutHash(this.city);
    if (h !== this.hash) {
      this.hash = h;
      this.build();
      this.version++;
    }
    return this;
  }

  build() {
    const city = this.city;
    const W = city.width;
    const N = city.tiles.length;
    this.N = N;
    this.W = W;
    const adj = (this.adj = new Array(5 * N));
    // Node ids: road tile k has four corners 4k..4k+3 (NW, NE, SE, SW); any other tile k is node 4N + k.
    const kind = (this.kind = new Uint8Array(N)); // 0 none, 1 road, 2 open ground, 3 building
    const cost = (this.cost = new Float32Array(N));
    this.cross = new Uint8Array(N);
    for (const t of city.tiles) {
      const k = t.y * W + t.x;
      if (t.terrain !== 'grass') continue;
      const s = t.structure;
      if (s?.type === 'road') kind[k] = s.broken ? 0 : 1;
      else if (!s) {
        kind[k] = 2;
        cost[k] = OPEN_COST;
      } else if (STRUCTURES[s.type].walkable) {
        kind[k] = 2;
        cost[k] = GROUND_COST[s.type] ?? 1;
      } else if (s.type !== 'rubble') kind[k] = 3;
    }
    const link = (a, b, c, flag = 0) => {
      (adj[a] ||= []).push(b, c, flag);
      (adj[b] ||= []).push(a, c, flag);
    };
    const center = (k) => 4 * N + k;
    for (const t of city.tiles) {
      const k = t.y * W + t.x;
      if (kind[k] === 1) {
        const m = footArms(city, t);
        const marked = crosswalkMask(city, t.x, t.y);
        this.cross[k] = marked;
        for (let s = 0; s < 4; s++) {
          const a = 4 * k + s;
          const b = 4 * k + ((s + 1) % 4);
          const len = 1 - 2 * WALK_LINE;
          const bit = DIRS[s].bit;
          if (!(m & bit)) link(a, b, len); // along the kerb
          else link(a, b, len + (marked & bit ? CROSSWALK : JAYWALK), 1); // across the street
        }
        // Sidewalks carry on into the next road tile east and south.
        for (const s of [1, 2]) {
          if (!(m & DIRS[s].bit)) continue;
          const n = city.getTile(t.x + DIRS[s].dx, t.y + DIRS[s].dy);
          if (!n || kind[n.y * W + n.x] !== 1) continue;
          const nk = n.y * W + n.x;
          const o = (s + 2) % 4;
          link(4 * k + s, 4 * nk + ((o + 1) % 4), 2 * WALK_LINE);
          link(4 * k + ((s + 1) % 4), 4 * nk + o, 2 * WALK_LINE);
        }
      }
      // Any tile beside a road reaches the two sidewalk corners on that side.
      for (let s = 0; s < 4; s++) {
        const n = city.getTile(t.x + DIRS[s].dx, t.y + DIRS[s].dy);
        if (!n) continue;
        const nk = n.y * W + n.x;
        if (kind[k] === 1 && (kind[nk] === 2 || kind[nk] === 3)) {
          const f = kind[nk] === 2 ? cost[nk] : 1;
          for (const c of [s, (s + 1) % 4]) {
            const [cx, cy] = CORNER[c];
            const d = Math.hypot(t.x + cx - (n.x + 0.5), t.y + cy - (n.y + 0.5));
            link(4 * k + c, center(nk), d * f);
          }
        }
        // Open ground links to open ground and to buildings (east and south only, to link each pair once).
        if (s === 1 || s === 2) {
          const a = kind[k];
          const b = kind[nk];
          if ((a === 2 && (b === 2 || b === 3)) || (a === 3 && b === 2)) {
            const f = ((a === 2 ? cost[k] : 1) + (b === 2 ? cost[nk] : 1)) / 2;
            link(center(k), center(nk), f);
          }
        }
      }
    }
  }

  nodeOf(x, y) {
    const k = y * this.W + x;
    const kd = this.kind[k];
    return kd === 2 || kd === 3 ? 4 * this.N + k : -1;
  }

  // Where a node stands, in grid units.
  pos(id) {
    if (id >= 4 * this.N) {
      const k = id - 4 * this.N;
      return { x: (k % this.W) + 0.5, y: Math.floor(k / this.W) + 0.5, k };
    }
    const k = id >> 2;
    const [cx, cy] = CORNER[id & 3];
    return { x: (k % this.W) + cx, y: Math.floor(k / this.W) + cy, k };
  }

  // Dijkstra from one tile, as far as maxCost (or until `goal` is reached). Buildings other than the
  // start are reached but never passed through. The distances and the way back stay valid until the
  // next search.
  explore(from, maxCost = 30, goal = -1) {
    this.refresh();
    const start = this.nodeOf(from.x, from.y);
    if (start < 0) return null;
    const n = this.adj.length;
    if (!this.dist || this.dist.length !== n) {
      this.dist = new Float64Array(n);
      this.prev = new Int32Array(n);
      this.seen = new Uint32Array(n);
      this.stamp = 0;
    }
    const { dist, prev, seen, kind } = this;
    const stamp = ++this.stamp;
    const base = 4 * this.N;
    const reached = [start];
    seen[start] = stamp;
    dist[start] = 0;
    prev[start] = -1;
    const heap = [0, start];
    while (heap.length) {
      const d = heap[0];
      const u = heap[1];
      heapPop(heap);
      if (d > dist[u]) continue; // a stale entry
      if (u === goal) break;
      if (u !== start && u >= base && kind[u - base] === 3) continue; // a building: the end of the line
      const edges = this.adj[u];
      if (!edges) continue;
      for (let i = 0; i < edges.length; i += 3) {
        const v = edges[i];
        const nd = d + edges[i + 1];
        if (nd > maxCost) continue;
        if (seen[v] === stamp) {
          if (nd >= dist[v]) continue;
        } else {
          seen[v] = stamp;
          reached.push(v);
        }
        dist[v] = nd;
        prev[v] = u;
        heapPush(heap, nd, v);
      }
    }
    return { start, reached, stamp };
  }

  reachedCost(ex, id) {
    return this.seen[id] === ex.stamp ? this.dist[id] : Infinity;
  }

  // The walking route between two tiles, or null when there's no way on foot within maxCost.
  route(from, to, maxCost = 30) {
    const goal = this.refresh().nodeOf(to.x, to.y);
    if (goal < 0) return null;
    const ex = this.explore(from, maxCost, goal);
    if (!ex || this.reachedCost(ex, goal) === Infinity || goal === ex.start) return null;
    return this.trace(ex, goal);
  }

  // A walk from a tile to one of the places `weigh` likes, chosen at random by weight.
  // weigh(tile, cost) → weight (0 to skip).
  outing(from, weigh, maxCost = 14, rand = Math.random) {
    const ex = this.explore(from, maxCost);
    if (!ex) return null;
    const tiles = this.city.tiles;
    const base = 4 * this.N;
    const options = [];
    let total = 0;
    for (const id of ex.reached) {
      if (id < base || id === ex.start) continue;
      const w = weigh(tiles[id - base], this.dist[id]);
      if (w > 0) {
        options.push(id, w);
        total += w;
      }
    }
    if (!total) return null;
    let r = rand() * total;
    for (let i = 0; i < options.length; i += 2) {
      r -= options[i + 1];
      if (r <= 0) return this.trace(ex, options[i]);
    }
    return this.trace(ex, options[options.length - 2]);
  }

  // Turn a chain of nodes into the points a walker passes. A building end becomes its door: the
  // middle of the edge it shares with the next step, just inside.
  trace(ex, goal) {
    const ids = [];
    for (let u = goal; u !== -1; u = this.prev[u]) ids.push(u);
    ids.reverse();
    const base = 4 * this.N;
    const pts = ids.map((id) => this.pos(id));
    const crossings = [];
    for (let i = 1; i < ids.length; i++) {
      const a = ids[i - 1];
      const b = ids[i];
      crossings.push(a < base && b < base && a >> 2 === b >> 2 && this.isCrossing(a, b));
    }
    const door = (end, next) => {
      const k = end.k;
      if (this.kind[k] !== 3) return end;
      const tx = k % this.W;
      const ty = Math.floor(k / this.W);
      const dx = next.x - (tx + 0.5);
      const dy = next.y - (ty + 0.5);
      const side = Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)];
      return { x: tx + 0.5 + side[0] * 0.44, y: ty + 0.5 + side[1] * 0.44, k, door: true };
    };
    if (pts.length > 1) {
      pts[0] = door(pts[0], pts[1]);
      pts[pts.length - 1] = door(pts[pts.length - 1], pts[pts.length - 2]);
    }
    return { points: pts, crossings, cost: this.dist[goal] };
  }

  isCrossing(a, b) {
    const edges = this.adj[a];
    for (let i = 0; i < edges.length; i += 3) if (edges[i] === b) return edges[i + 2] === 1;
    return false;
  }

  // Is the tile a point stands on still fit to walk? (Built over, flooded or washed out → no.)
  walkable(k) {
    const t = this.city.tiles[k];
    if (!t || t.terrain !== 'grass') return false;
    const s = t.structure;
    if (!s) return true;
    if (s.type === 'road') return !s.broken;
    return s.type !== 'rubble';
  }
}

// A binary min-heap stored flat as [cost, node, cost, node, ...].
function heapPush(h, d, u) {
  let i = h.length >> 1;
  h.push(d, u);
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[2 * p] <= d) break;
    h[2 * i] = h[2 * p];
    h[2 * i + 1] = h[2 * p + 1];
    i = p;
  }
  h[2 * i] = d;
  h[2 * i + 1] = u;
}

function heapPop(h) {
  const u = h.pop();
  const d = h.pop();
  const n = h.length >> 1;
  if (!n) return;
  let i = 0;
  for (;;) {
    const l = 2 * i + 1;
    if (l >= n) break;
    const r = l + 1;
    const c = r < n && h[2 * r] < h[2 * l] ? r : l;
    if (h[2 * c] >= d) break;
    h[2 * i] = h[2 * c];
    h[2 * i + 1] = h[2 * c + 1];
    i = c;
  }
  h[2 * i] = d;
  h[2 * i + 1] = u;
}
