// The storybook look of the 3D view: the town drawn as a painterly village. Cottages with plaster and
// timber walls, shingled or thatched roofs, chimneys and flower boxes; cobbled streets with flagstone
// sidewalks; picket fences, lanterns, lush round trees, bushes and flowers.
//
// Pure geometry like models.js: no Three.js, so it runs in Node tests (textures and materials are in
// storybookLook.js, and view3d.js builds each chunk with buildStorybook). Each surface kind goes into its
// own layer (one mesh and one textured material each). Layers carry texture coordinates in world
// units, so a texture repeats at the same size on every wall and roof.
//
// Axes as everywhere in the 3D view: x is the map's x, z is the map's y, y is up, one tile is one unit.

import { buildersMore } from './storybookMore.js';

export const LAYERS = ['grass', 'path', 'dirt', 'plaster', 'timber', 'roof', 'thatch', 'stone', 'wood', 'leaf', 'bark', 'paint', 'glass', 'glow', 'water'];

// '#rrggbb' → linear-light [r, g, b], the same conversion as mesh.js.
const LIN = new Map();
export function lin(hex) {
  let c = LIN.get(hex);
  if (c) return c;
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  c = [ch((n >> 16) & 255), ch((n >> 8) & 255), ch(n & 255)];
  LIN.set(hex, c);
  return c;
}
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const blend = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// A small deterministic hash in [0, 1).
export function rand(x, y, k = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(k | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---- Geometry with texture coordinates -----------------------------------------------------

export class SBMesh {
  constructor() {
    // Growable typed arrays: 3 floats per vertex for positions, normals and colours, 2 for texture
    // coordinates; `k` vertices in use.
    this._p = new Float32Array(3 * 1024);
    this._n = new Float32Array(3 * 1024);
    this._c = new Float32Array(3 * 1024);
    this._u = new Float32Array(2 * 1024);
    this.k = 0;
    this.frames = [{ cx: 0, cz: 0, r: 0 }];
  }

  get vertices() {
    return this.k;
  }

  // Views of what has been built so far (valid until more is added).
  get p() {
    return this._p.subarray(0, this.k * 3);
  }

  // Room for `n` more vertices.
  room(n) {
    if ((this.k + n) * 3 <= this._p.length) return;
    let size = this._p.length / 3;
    while (size < this.k + n) size *= 2;
    for (const [key, w] of [['_p', 3], ['_n', 3], ['_c', 3], ['_u', 2]]) {
      const a = new Float32Array(size * w);
      a.set(this[key]);
      this[key] = a;
    }
  }

  // One vertex, already in world space.
  vert(x, y, z, nx, ny, nz, c, u, v) {
    const i = this.k * 3;
    const P = this._p;
    const N = this._n;
    const C = this._c;
    P[i] = x;
    P[i + 1] = y;
    P[i + 2] = z;
    N[i] = nx;
    N[i + 1] = ny;
    N[i + 2] = nz;
    C[i] = c[0];
    C[i + 1] = c[1];
    C[i + 2] = c[2];
    this._u[this.k * 2] = u;
    this._u[this.k * 2 + 1] = v;
    this.k++;
  }

  // Whole vertices from another builder (world space, no texture coordinates).
  raw(pos, nor, col) {
    const n = pos.length / 3;
    this.room(n);
    this._p.set(pos, this.k * 3);
    this._n.set(nor, this.k * 3);
    this._c.set(col, this.k * 3);
    this._u.fill(0, this.k * 2, (this.k + n) * 2);
    this.k += n;
  }

  // Put the next shapes at (cx, cz), turned r quarter turns, inside whatever frame is current.
  place(cx, cz, r = 0) {
    this.frames = [{ cx, cz, r: r & 3 }];
    return this;
  }

  // Build fn() in a frame nested in the current one: moved by (dx, dz), turned dr quarter turns.
  nest(dx, dz, dr, fn) {
    this.frames.push({ cx: dx, cz: dz, r: dr & 3 });
    try {
      fn();
    } finally {
      this.frames.pop();
    }
  }

  // A point from the innermost frame to the world.
  tx(x, z) {
    const top = this.frames.length === 1 ? this.frames[0] : null;
    if (top && top.r === 0) return [top.cx + x, top.cz + z];
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const f = this.frames[i];
      let nx = x;
      let nz = z;
      if (f.r === 1) [nx, nz] = [z, -x];
      else if (f.r === 2) [nx, nz] = [-x, -z];
      else if (f.r === 3) [nx, nz] = [-z, x];
      x = f.cx + nx;
      z = f.cz + nz;
    }
    return [x, z];
  }

  // A direction from the innermost frame to the world (no move).
  dir(x, z) {
    const [ax, az] = this.tx(0, 0);
    const [bx, bz] = this.tx(x, z);
    return [bx - ax, bz - az];
  }

  // One triangle (points in the current frame), its normal from the corners, colours per corner.
  tri(a, b, c, ca, cb = ca, cc = ca, ua = [0, 0], ub = [0, 0], uc = [0, 0]) {
    const [ax, az] = this.tx(a[0], a[2]);
    const [bx, bz] = this.tx(b[0], b[2]);
    const [qx, qz] = this.tx(c[0], c[2]);
    const ux = bx - ax;
    const uy = b[1] - a[1];
    const uz = bz - az;
    const vx = qx - ax;
    const vy = c[1] - a[1];
    const vz = qz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) return;
    nx /= l;
    ny /= l;
    nz /= l;
    this.room(3);
    this.vert(ax, a[1], az, nx, ny, nz, ca, ua[0], ua[1]);
    this.vert(bx, b[1], bz, nx, ny, nz, cb, ub[0], ub[1]);
    this.vert(qx, c[1], qz, nx, ny, nz, cc, uc[0], uc[1]);
  }

  // A quad a-b-c-d (counter-clockwise from the front) with texture coordinates for each corner.
  quad(a, b, c, d, col, uvs = null, cols = null) {
    const u = uvs || [[0, 0], [1, 0], [1, 1], [0, 1]];
    const k = cols || [col, col, col, col];
    this.tri(a, b, c, k[0], k[1], k[2], u[0], u[1], u[2]);
    this.tri(a, c, d, k[0], k[2], k[3], u[0], u[2], u[3]);
  }

  // A vertex with its own normal (for smooth shapes), all in the current frame.
  smooth(pts, nors, cols, uvs) {
    this.room(pts.length);
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = this.tx(pts[i][0], pts[i][2]);
      const [nx, nz] = this.dir(nors[i][0], nors[i][2]);
      const l = Math.hypot(nx, nors[i][1], nz) || 1;
      this.vert(x, pts[i][1], z, nx / l, nors[i][1] / l, nz / l, cols[i], uvs[i][0], uvs[i][1]);
    }
  }

  // A box, textured in world units (s: how many texture repeats per unit). Sides darken a touch
  // toward the ground, a cheap ambient occlusion.
  box(x0, y0, z0, x1, y1, z1, col, { s = 1, top = col, bottom = false, ao = 0.86 } = {}) {
    const lo = mul(col, ao);
    const U = (a, b) => [a * s, b * s];
    // front (+z), right (+x), back (-z), left (-x)
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col, [U(x0, y0), U(x1, y0), U(x1, y1), U(x0, y1)], [lo, lo, col, col]);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], col, [U(-z1, y0), U(-z0, y0), U(-z0, y1), U(-z1, y1)], [lo, lo, col, col]);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], col, [U(-x1, y0), U(-x0, y0), U(-x0, y1), U(-x1, y1)], [lo, lo, col, col]);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], col, [U(z0, y0), U(z1, y0), U(z1, y1), U(z0, y1)], [lo, lo, col, col]);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], top, [U(x0, -z1), U(x1, -z1), U(x1, -z0), U(x0, -z0)]);
    if (bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], lo);
  }

  // A square beam of width w from point a to point b, at any angle (swing frames, rails, ropes).
  rod(a, b, w, col, s = 6) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l = Math.hypot(...d) || 1;
    const n = [d[0] / l, d[1] / l, d[2] / l];
    // Two directions across the beam.
    const ref = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let u = [n[1] * ref[2] - n[2] * ref[1], n[2] * ref[0] - n[0] * ref[2], n[0] * ref[1] - n[1] * ref[0]];
    const ul = Math.hypot(...u);
    u = u.map((v) => (v / ul) * (w / 2));
    const v = [(n[1] * u[2] - n[2] * u[1]), (n[2] * u[0] - n[0] * u[2]), (n[0] * u[1] - n[1] * u[0])];
    const at = (p, su, sv) => [p[0] + u[0] * su + v[0] * sv, p[1] + u[1] * su + v[1] * sv, p[2] + u[2] * su + v[2] * sv];
    const lo = mul(col, 0.85);
    const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    for (let i = 0; i < 4; i++) {
      const [su0, sv0] = corners[i];
      const [su1, sv1] = corners[(i + 1) % 4];
      this.quad(at(a, su0, sv0), at(a, su1, sv1), at(b, su1, sv1), at(b, su0, sv0), col, [[0, 0], [w * s, 0], [w * s, l * s], [0, l * s]], [lo, lo, col, col]);
    }
  }

  // A tapered cylinder with smooth sides (trunks, posts, chimneys pots), n sides.
  cyl(x, z, r0, r1, y0, y1, n, col, { top = col, s = 1, a0 = 0 } = {}) {
    const lo = mul(col, 0.8);
    const slope = (r0 - r1) / Math.max(1e-6, y1 - y0);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + a0;
      const b = ((i + 1) / n) * Math.PI * 2 + a0;
      const ca = [Math.cos(a), Math.sin(a)];
      const cb = [Math.cos(b), Math.sin(b)];
      const p0 = [x + ca[0] * r0, y0, z + ca[1] * r0];
      const p1 = [x + cb[0] * r0, y0, z + cb[1] * r0];
      const p2 = [x + cb[0] * r1, y1, z + cb[1] * r1];
      const p3 = [x + ca[0] * r1, y1, z + ca[1] * r1];
      const na = [ca[0], slope, ca[1]];
      const nb = [cb[0], slope, cb[1]];
      const ua = (i / n) * s;
      const ub = ((i + 1) / n) * s;
      const h = (y1 - y0) * s * 3;
      this.smooth([p0, p1, p2, p0, p2, p3], [na, nb, nb, na, nb, na], [lo, lo, col, lo, col, col], [[ua, 0], [ub, 0], [ub, h], [ua, 0], [ub, h], [ua, h]]);
      if (r1 > 0.002) this.tri([x, y1, z], p3, p2, top, top, top, [0.5, 0.5], [0.5 + ca[0] / 2, 0.5 + ca[1] / 2], [0.5 + cb[0] / 2, 0.5 + cb[1] / 2]);
    }
  }

  // A soft lumpy ball (tree crowns, bushes): a subdivided icosahedron, nudged by a hash so no two
  // match, with smooth normals and colour shading from `dark` underneath to `light` on top.
  blob(x, y, z, rx, ry, rz, dark, light, seed = 0, detail = 1) {
    const { verts, faces } = ico(detail);
    const pts = verts.map(([a, b, c], i) => {
      const k = 1 + (rand(i, seed, 7) - 0.5) * 0.22;
      return [x + a * rx * k, y + b * ry * k, z + c * rz * k];
    });
    for (const [i, j, k] of faces) {
      const tri = [i, j, k];
      const P = tri.map((v) => pts[v]);
      const N = tri.map((v) => [verts[v][0] / rx, verts[v][1] / ry, verts[v][2] / rz]);
      const C = tri.map((v) => {
        const t = Math.max(0, Math.min(1, 0.5 + verts[v][1] * 0.55 + (verts[v][0] + verts[v][2]) * 0.12));
        return mul(blend(dark, light, t), 0.94 + rand(v, seed, 3) * 0.12);
      });
      const UV = tri.map((v) => [Math.atan2(verts[v][2], verts[v][0]) * 0.9 * (rx + rz) + seed * 0.37, verts[v][1] * ry * 3]);
      // Mend the texture seam where atan2 jumps from π to -π.
      if (Math.max(...UV.map((u) => u[0])) - Math.min(...UV.map((u) => u[0])) > 2 * (rx + rz)) for (const u of UV) if (u[0] < 0) u[0] += 1.8 * Math.PI * (rx + rz);
      this.smooth(P, N, C, UV);
    }
  }

  arrays() {
    return {
      position: this._p.slice(0, this.k * 3),
      normal: this._n.slice(0, this.k * 3),
      color: this._c.slice(0, this.k * 3),
      uv: this._u.slice(0, this.k * 2),
    };
  }
}

const ICO = new Map();
function ico(detail) {
  if (ICO.has(detail)) return ICO.get(detail);
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let d = 0; d < detail; d++) {
    const mid = new Map();
    const m = (a, b) => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (!mid.has(key)) {
        verts.push(norm([(verts[a][0] + verts[b][0]) / 2, (verts[a][1] + verts[b][1]) / 2, (verts[a][2] + verts[b][2]) / 2]));
        mid.set(key, verts.length - 1);
      }
      return mid.get(key);
    };
    const next = [];
    for (const [a, b, c] of faces) {
      const ab = m(a, b);
      const bc = m(b, c);
      const ca = m(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  const out = { verts, faces };
  ICO.set(detail, out);
  return out;
}
function norm(v) {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
}

// ---- Palette -------------------------------------------------------------------------------

// The game's four pastel building colours, deepened into storybook ones: warm plaster walls and
// terracotta, rose, slate-teal and plum roofs.
export const STORY_VARIANTS = {
  peach: { wall: '#f3dcbc', roof: '#b9583f', trim: '#6b4630', shutter: '#5d8f86' },
  blush: { wall: '#f1d2c4', roof: '#a8464c', trim: '#5e3d2e', shutter: '#4f6f9c' },
  mint: { wall: '#e6e3c6', roof: '#4f7f7a', trim: '#5a4231', shutter: '#b0563f' },
  lavender: { wall: '#eadbd2', roof: '#665b8e', trim: '#4f3a2e', shutter: '#7d9a52' },
};
const FLOWERS = ['#f26a8d', '#ffd166', '#f8f4ec', '#c77dff', '#ff8c42', '#ef476f', '#a0c4ff', '#ffadad'];
const GREENS = [
  ['#2f5d2a', '#7fb24a'],
  ['#2b5a36', '#6ea851'],
  ['#3a6b2c', '#93bf4f'],
  ['#2d5530', '#5f9a49'],
];
const BLOSSOM = ['#b5606f', '#f7b7c5'];
const TIMBER = '#5b3d2b';
const STONE = '#c9bba5';
const COBBLE = '#cdbb9e';
const DIRT = '#ad8b5f';
const GRASS = '#8fbf5a';
const WOOD = '#a77b52';
const FLOOR = 0.24;

// ---- Building the scene ----------------------------------------------------------------------

// Everything for the tiles x0 ≤ x < x1, y0 ≤ y < y1 of a town. Options:
//   fallback(out, t, rot)  draws a structure with no storybook model yet (factories, schools, …) with
//                          the game's own model; returns true if it did
//   growthOf(t)            a building's growth stage and floors (renderer.js), as in the game
//   lamp(t)                where a road tile's street lamp stands ({ gx, gy }) or null
//   crossMask(x, y)        which sides of a road tile have a crossing
//   STRUCTURES             the game's structure list (walkable ones get no height or footprint)
// Streets follow the game's layout (whole-tile cobbles, sidewalks on the same edges and widths as the
// overhead view, crossings and lamps where the game has them), so the 3D view's people and cars stay
// on them.
//   edges                  the earthy sides of the diorama where the map ends
//   winter                 chimneys smoke
// Returns { layers, flowers, tufts, lamps, smoke, roads, tops, feet, counts }:
//   layers   { name: SBMesh }                       one mesh per surface kind
//   flowers  [[x, y, z, scale, colour]]            little flower heads (drawn as instances)
//   tufts    [[x, z, scale, colour]]                grass tufts (instances)
//   lamps    [{ x, y, z }]                          lantern glass, where warm lights can sit
//   smoke    [{ x, y, z, big }]                     chimney tops that smoke
//   roads    [[x, y]]                               road tiles
//   tops     [[tile index, height]]                 how tall each building is (for the cameras)
//   feet     [[cx, cz, w, d]]                        building footprints (for soft contact shadows)
export function buildStorybook(city, area, { fallback = null, growthOf = null, lamp = null, crossMask = null, edges = false, winter = false, STRUCTURES = null } = {}) {
  const out = { layers: {}, flowers: [], tufts: [], lamps: [], smoke: [], roads: [], tops: [], feet: [], counts: {}, winter };
  for (const k of LAYERS) out.layers[k] = new SBMesh();
  const L = out.layers;
  const all = Object.values(L);
  const { x0, y0, x1, y1 } = area;
  const tile = (x, y) => (x >= 0 && y >= 0 && x < city.width && y < city.height ? city.getTile(x, y) : null);
  const isWater = (x, y) => tile(x, y)?.terrain === 'water';
  const solidLayers = all.filter((m) => m !== L.grass && m !== L.path && m !== L.dirt && m !== L.water && m !== L.leaf && m !== L.bark && m !== L.glow);

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const t = tile(x, y);
      if (!t) continue;
      for (const m of all) m.place(x + 0.5, y + 0.5, 0);
      if (edges) mapEdge(out, city, x, y);
      if (t.terrain === 'water') {
        water(out, x, y, isWater);
        continue;
      }
      ground(out, x, y);
      const s = t.structure;
      const type = s?.type || 'empty';
      out.counts[type] = (out.counts[type] || 0) + 1;
      if (type === 'road') {
        street(out, t, lamp ? lamp(t) : null, crossMask ? crossMask(x, y) : 0);
        out.roads.push([x, y]);
        continue;
      }
      const rot = frontOf(t, city);
      for (const m of all) m.place(x + 0.5, y + 0.5, rot);
      const make = BUILDERS[type];
      const ctx = { x, y, rot, t, s, v: STORY_VARIANTS[s?.variant] || STORY_VARIANTS[DEFAULT_VARIANT[type]] || STORY_VARIANTS.peach, floors: s?.floors, growth: s && growthOf ? growthOf(t) : null };
      const from = solidLayers.map((m) => m.p.length);
      if (make) make(out, ctx);
      else if (!(s && fallback && fallback(out, t, rot))) meadow(out, ctx);
      // How tall it stands and where its walls meet the ground.
      if (s && !(STRUCTURES?.[type]?.walkable) && type !== 'tree' && type !== 'park') {
        let top = 0;
        let ax = Infinity;
        let az = Infinity;
        let bx = -Infinity;
        let bz = -Infinity;
        solidLayers.forEach((m, i) => {
          const P = m.p;
          for (let k = from[i]; k < P.length; k += 3) {
            if (P[k + 1] > top) top = P[k + 1];
            if (P[k + 1] > 0.12) continue;
            if (P[k] < ax) ax = P[k];
            if (P[k] > bx) bx = P[k];
            if (P[k + 2] < az) az = P[k + 2];
            if (P[k + 2] > bz) bz = P[k + 2];
          }
        });
        if (top > 0) out.tops.push([y * city.width + x, top]);
        // Fences and gardens spread wide; the footprint is the building, about the middle of the lot.
        if (ax < bx) out.feet.push([x + 0.5, y + 0.5, Math.min(0.75, bx - ax + 0.1), Math.min(0.7, bz - az + 0.1)]);
      }
    }
  }
  return out;
}

const DEFAULT_VARIANT = { bungalow: 'mint', villa: 'blush', house: 'peach', cottage: 'mint', apartments: 'blush', tower: 'lavender', shop: 'mint', cafe: 'peach', bakery: 'blush', office: 'mint' };

// Buildings face their street, the same rule as the game's 3D view.
export function frontOf(t, city) {
  const road = (x, y) => city.getTile(x, y)?.structure?.type === 'road';
  if (road(t.x, t.y + 1)) return 0;
  if (road(t.x + 1, t.y)) return 1;
  if (road(t.x - 1, t.y)) return 3;
  if (road(t.x, t.y - 1)) return 2;
  return ((t.structure?.shape || 0) + t.x) % 2 ? 1 : 0;
}

// ---- Ground -------------------------------------------------------------------------------------

// Grass with soft patches of colour that flow across tiles (corner colours come from the corner's own
// position, so neighbouring tiles agree).
function ground(out, x, y) {
  const g = out.layers.grass;
  const corner = (cx, cy) => {
    const n = rand(cx, cy, 11);
    const m = rand(Math.floor(cx / 3), Math.floor(cy / 3), 12);
    const d = rand(Math.floor((cx + 1) / 2), Math.floor((cy + 1) / 2), 13);
    return mul(blend(blend(lin(GRASS), lin('#b3cf6a'), m * 0.8), lin('#5f9444'), d * d * 0.6), 0.86 + n * 0.22);
  };
  const c = [corner(x, y + 1), corner(x + 1, y + 1), corner(x + 1, y), corner(x, y)];
  g.frames = [{ cx: 0, cz: 0, r: 0 }];
  g.quad([x, 0, y + 1], [x + 1, 0, y + 1], [x + 1, 0, y], [x, 0, y], c[0], [[x, -y - 1], [x + 1, -y - 1], [x + 1, -y], [x, -y]], c);
  g.place(x + 0.5, y + 0.5, 0);
}

// The game's street on one road tile: cobbles across the whole tile, raised flagstone sidewalks on
// the sides with no road (the same edges and widths as ground.js, so walkers stay on them), pale stone
// crossings where people cross, and a lantern where the game has a street lamp.
const WALK = 0.15;
const KERB = 0.022;
const SIDES = [
  { a: [0, 0], b: [1, 0], n: [0, 1] }, // north
  { a: [1, 0], b: [1, 1], n: [-1, 0] }, // east
  { a: [1, 1], b: [0, 1], n: [0, -1] }, // south
  { a: [0, 1], b: [0, 0], n: [1, 0] }, // west
];
const sideAt = (x, y, s, u, v) => {
  const e = SIDES[s];
  return [x + e.a[0] + (e.b[0] - e.a[0]) * u + e.n[0] * v, y + e.a[1] + (e.b[1] - e.a[1]) * u + e.n[1] * v];
};
function street(out, t, lampSpot, cross) {
  const { x, y } = t;
  const m = t.roadMask || 0;
  const P = out.layers.path;
  const S = out.layers.stone;
  for (const l of [P, S]) l.frames = [{ cx: 0, cz: 0, r: 0 }];
  const k = 1.7;
  const c = mul(lin(COBBLE), 0.9 + rand(x, y, 3) * 0.14);
  P.quad([x, 0.006, y + 1], [x + 1, 0.006, y + 1], [x + 1, 0.006, y], [x, 0.006, y], c, [[x * k, -(y + 1) * k], [(x + 1) * k, -(y + 1) * k], [(x + 1) * k, -y * k], [x * k, -y * k]]);
  const flag = lin('#d9cdb6');
  const box = (ax, az, bx, bz) => S.box(Math.min(ax, bx), 0, Math.min(az, bz), Math.max(ax, bx), KERB, Math.max(az, bz), mul(flag, 0.95 + rand(Math.round(ax * 7), Math.round(az * 7), 5) * 0.1), { s: 3.5, ao: 0.8 });
  for (let sd = 0; sd < 4; sd++) {
    if (m & (1 << sd)) continue;
    const [ax, az] = sideAt(x, y, sd, 0, 0);
    const [bx, bz] = sideAt(x, y, sd, 1, WALK);
    box(ax, az, bx, bz);
  }
  // Where two arms meet, the sidewalks join in a square at the corner.
  for (let cn = 0; cn < 4; cn++) {
    const a = 1 << cn;
    const b = 1 << ((cn + 3) % 4);
    if (!(m & a) || !(m & b)) continue;
    const cx = cn === 1 || cn === 2 ? x + 1 - WALK : x;
    const cz = cn >= 2 ? y + 1 - WALK : y;
    box(cx, cz, cx + WALK, cz + WALK);
  }
  // Crossings: bands of pale stone across the lane.
  const pale = lin('#f1e8d6');
  for (let sd = 0; sd < 4; sd++) {
    if (!(cross & m & (1 << sd))) continue;
    for (let i = 0; i < 6; i++) {
      const u0 = 0.19 + i * 0.11;
      const q = [sideAt(x, y, sd, u0, 0.02), sideAt(x, y, sd, u0 + 0.06, 0.02), sideAt(x, y, sd, u0 + 0.06, 0.14), sideAt(x, y, sd, u0, 0.14)];
      const ax = Math.min(...q.map((p) => p[0]));
      const az = Math.min(...q.map((p) => p[1]));
      const bx = Math.max(...q.map((p) => p[0]));
      const bz = Math.max(...q.map((p) => p[1]));
      S.quad([ax, 0.009, bz], [bx, 0.009, bz], [bx, 0.009, az], [ax, 0.009, az], pale, [[ax * 4, -bz * 4], [bx * 4, -bz * 4], [bx * 4, -az * 4], [ax * 4, -az * 4]]);
    }
  }
  if (t.structure.broken) {
    // Washed out: a muddy hole with water in it.
    const D = out.layers.dirt;
    const W = out.layers.water;
    for (const l of [D, W]) l.frames = [{ cx: 0, cz: 0, r: 0 }];
    D.quad([x + 0.25, 0.011, y + 0.7], [x + 0.75, 0.011, y + 0.7], [x + 0.75, 0.011, y + 0.3], [x + 0.25, 0.011, y + 0.3], lin('#8f7a5c'));
    W.quad([x + 0.32, 0.014, y + 0.64], [x + 0.68, 0.014, y + 0.64], [x + 0.68, 0.014, y + 0.36], [x + 0.32, 0.014, y + 0.36], lin('#5fa7c4'));
  }
  if (lampSpot) lantern(out, lampSpot.gx, lampSpot.gy);
  else if (rand(x, y, 52) < 0.25) out.tufts.push([x + 0.06 + rand(x, y, 53) * 0.88, y + 0.04, 0.6, '#6a9a45']);
}

// The diorama's earthy sides where the map ends, with a lip of grass.
function mapEdge(out, city, x, y) {
  const D = out.layers.dirt;
  D.frames = [{ cx: 0, cz: 0, r: 0 }];
  const top = city.getTile(x, y).terrain === 'water' ? -0.09 : 0;
  const soil = lin('#9c7f5e');
  const lo = lin('#7a6248');
  const face = (a, b) => D.quad([a[0], -0.55, a[1]], [b[0], -0.55, b[1]], [b[0], top, b[1]], [a[0], top, a[1]], soil, [[0, 0], [1, 0], [1, 0.5], [0, 0.5]], [lo, lo, soil, soil]);
  if (y === 0) face([x + 1, y], [x, y]);
  if (y === city.height - 1) face([x, y + 1], [x + 1, y + 1]);
  if (x === 0) face([x, y], [x, y + 1]);
  if (x === city.width - 1) face([x + 1, y + 1], [x + 1, y]);
}

function water(out, x, y, isWater) {
  const w = out.layers.water;
  const d = out.layers.dirt;
  w.frames = [{ cx: 0, cz: 0, r: 0 }];
  w.quad([x, -0.03, y + 1], [x + 1, -0.03, y + 1], [x + 1, -0.03, y], [x, -0.03, y], lin('#5fa7c4'), [[x, -y - 1], [x + 1, -y - 1], [x + 1, -y], [x, -y]]);
  d.frames = [{ cx: 0, cz: 0, r: 0 }];
  d.quad([x, -0.09, y + 1], [x + 1, -0.09, y + 1], [x + 1, -0.09, y], [x, -0.09, y], lin('#7c6a4e'));
  // Earthy banks where the water meets land.
  const bank = lin('#9c8360');
  if (!isWater(x, y + 1)) d.quad([x + 1, -0.09, y + 1], [x, -0.09, y + 1], [x, 0, y + 1], [x + 1, 0, y + 1], bank, [[1, 0], [0, 0], [0, 0.1], [1, 0.1]]);
  if (!isWater(x, y - 1)) d.quad([x, -0.09, y], [x + 1, -0.09, y], [x + 1, 0, y], [x, 0, y], bank);
  if (!isWater(x + 1, y)) d.quad([x + 1, -0.09, y], [x + 1, -0.09, y + 1], [x + 1, 0, y + 1], [x + 1, 0, y], bank);
  if (!isWater(x - 1, y)) d.quad([x, -0.09, y + 1], [x, -0.09, y], [x, 0, y], [x, 0, y + 1], bank);
}

// A lamp post with a little glass lantern on top.
function lantern(out, wx, wz) {
  const T = out.layers.timber;
  const G = out.layers.glow;
  for (const m of [T, G]) m.frames = [{ cx: 0, cz: 0, r: 0 }];
  T.box(wx - 0.012, 0, wz - 0.012, wx + 0.012, 0.3, wz + 0.012, lin('#3d3a3f'), { s: 4 });
  T.box(wx - 0.03, 0.3, wz - 0.03, wx + 0.03, 0.31, wz + 0.03, lin('#3d3a3f'));
  G.box(wx - 0.022, 0.31, wz - 0.022, wx + 0.022, 0.37, wz + 0.022, lin('#ffd27a'));
  T.box(wx - 0.032, 0.37, wz - 0.032, wx + 0.032, 0.382, wz + 0.032, lin('#3d3a3f'));
  T.cyl(wx, wz, 0.026, 0.002, 0.382, 0.41, 4, lin('#3d3a3f'));
  out.lamps.push({ x: wx, y: 0.36, z: wz });
}

// An open lawn: tufts, the odd flower patch and bush.
function meadow(out, ctx) {
  const { x, y } = ctx;
  for (let i = 0; i < 7; i++) out.tufts.push([x + 0.1 + rand(x, y, 60 + i) * 0.8, y + 0.1 + rand(x, y, 70 + i) * 0.8, 0.6 + rand(x, y, 80 + i) * 0.7, rand(x, y, 85 + i) < 0.5 ? '#5f9a3e' : '#7aae45']);
  if (rand(x, y, 98) < 0.4) flowerPatch(out, x + 0.2 + rand(x, y, 99) * 0.6, y + 0.2 + rand(x, y, 89) * 0.6, 0.1, 7, rand(x, y, 88));
  if (rand(x, y, 90) < 0.6) flowerPatch(out, x + 0.2 + rand(x, y, 91) * 0.6, y + 0.2 + rand(x, y, 92) * 0.6, 0.12, 9, rand(x, y, 93));
  if (rand(x, y, 94) < 0.3) bushWorld(out, x + 0.2 + rand(x, y, 95) * 0.6, y + 0.2 + rand(x, y, 96) * 0.6, 0.07 + rand(x, y, 97) * 0.04, x * 31 + y, 0);
}

function flowerPatch(out, wx, wz, r, n, seed) {
  const col = FLOWERS[Math.floor(seed * FLOWERS.length) % FLOWERS.length];
  const col2 = FLOWERS[Math.floor(seed * 97) % FLOWERS.length];
  for (let i = 0; i < n; i++) {
    const a = rand(i, seed * 1e4, 1) * Math.PI * 2;
    const d = Math.sqrt(rand(i, seed * 1e4, 2)) * r;
    out.flowers.push([wx + Math.cos(a) * d, 0.025 + rand(i, seed * 1e4, 3) * 0.02, wz + Math.sin(a) * d, 0.8 + rand(i, seed * 1e4, 4) * 0.5, i % 3 ? col : col2]);
    if (i % 2) out.tufts.push([wx + Math.cos(a + 1) * d, wz + Math.sin(a + 1) * d, 0.6, '#4f8a37']);
  }
}

// A bush at a world position, dotted with flowers sometimes.
function bushWorld(out, wx, wz, r, seed, detail = 1) {
  const m = out.layers.leaf;
  m.frames = [{ cx: 0, cz: 0, r: 0 }];
  const [dark, light] = GREENS[seed % GREENS.length].map(lin);
  m.blob(wx, r * 0.7, wz, r * 1.2, r, r * 1.1, dark, light, seed, detail);
  if (seed % 3 === 0) for (let i = 0; i < 6; i++) {
    const a = rand(i, seed, 5) * Math.PI * 2;
    out.flowers.push([wx + Math.cos(a) * r * 0.9, r * (0.8 + rand(i, seed, 6) * 0.6), wz + Math.sin(a) * r * 0.9, 0.9, FLOWERS[seed % FLOWERS.length]]);
  }
}

// ---- Trees ----------------------------------------------------------------------------------------

// A lush storybook tree at world (wx, wz): a tapering trunk and a crown of overlapping soft blobs.
// kind 0 round, 1 tall, 2 pine, 3 blossom.
export function storyTree(out, wx, wz, kind, scale, seed, detail = 1) {
  const B = out.layers.bark;
  const F = out.layers.leaf;
  for (const m of [B, F]) m.frames = [{ cx: 0, cz: 0, r: 0 }];
  const s = scale;
  const [dark, light] = (kind === 3 ? BLOSSOM : GREENS[seed % GREENS.length]).map(lin);
  if (kind === 2) {
    B.cyl(wx, wz, 0.03 * s, 0.02 * s, 0, 0.16 * s, 6, lin('#6b4a33'), { s: 3 });
    const pine = [lin('#24492f'), lin('#4f8a4a')];
    for (let i = 0; i < 3; i++) {
      const y = (0.12 + i * 0.16) * s;
      const r = (0.24 - i * 0.06) * s;
      F.blob(wx, y + 0.06 * s, wz, r, 0.13 * s, r, pine[0], pine[1], seed + i, detail);
    }
    F.blob(wx, 0.66 * s, wz, 0.05 * s, 0.1 * s, 0.05 * s, pine[0], pine[1], seed + 9, 0);
    return;
  }
  const tall = kind === 1;
  const h = (tall ? 0.34 : 0.24) * s;
  B.cyl(wx, wz, 0.035 * s, 0.022 * s, 0, h + 0.06 * s, 7, lin('#6e4b32'), { s: 3 });
  // Two short branches into the crown.
  B.cyl(wx + 0.03 * s, wz, 0.012 * s, 0.006 * s, h * 0.7, h + 0.1 * s, 5, lin('#6e4b32'));
  const n = tall ? 4 : 5;
  const cy = h + (tall ? 0.2 : 0.14) * s;
  const R = (tall ? 0.15 : 0.2) * s;
  F.blob(wx, cy, wz, R, R * (tall ? 1.5 : 0.95), R, dark, light, seed, 1);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand(seed, i, 1) * 0.6;
    const d = R * (0.6 + rand(seed, i, 2) * 0.3);
    const yy = cy + (rand(seed, i, 3) - 0.35) * R * (tall ? 1.6 : 0.9);
    const r = R * (0.55 + rand(seed, i, 4) * 0.25);
    F.blob(wx + Math.cos(a) * d, yy, wz + Math.sin(a) * d, r, r * 0.9, r, dark, light, seed * 7 + i, 0);
  }
  if (kind === 3) for (let i = 0; i < 10; i++) {
    const a = rand(seed, i, 8) * Math.PI * 2;
    out.flowers.push([wx + Math.cos(a) * R * 1.3, 0.012, wz + Math.sin(a) * R * 1.3, 0.6, '#f7c6d3']); // fallen petals
  }
}

// ---- Building pieces (in the building's frame: front faces +z) --------------------------------------

// A point on wall `face` of block b: u along the wall from its left end (as seen from outside), at
// height v, `e` out from it. face 0 front (+z), 1 right (+x), 2 back (-z), 3 left (-x).
function wallFrame(b, face) {
  if (face === 0) return { ox: b.x0, oz: b.z1, ux: 1, uz: 0, nx: 0, nz: 1, w: b.x1 - b.x0 };
  if (face === 1) return { ox: b.x1, oz: b.z1, ux: 0, uz: -1, nx: 1, nz: 0, w: b.z1 - b.z0 };
  if (face === 2) return { ox: b.x1, oz: b.z0, ux: -1, uz: 0, nx: 0, nz: -1, w: b.x1 - b.x0 };
  return { ox: b.x0, oz: b.z0, ux: 0, uz: 1, nx: -1, nz: 0, w: b.z1 - b.z0 };
}
const onWall = (f, u, v, e = 0) => [f.ox + f.ux * u + f.nx * e, v, f.oz + f.uz * u + f.nz * e];

// A flat rectangle on a wall (windows, doors, signs), textured in world units.
function wallRect(m, f, u0, u1, v0, v1, e, col, s = 1) {
  m.quad(onWall(f, u0, v0, e), onWall(f, u1, v0, e), onWall(f, u1, v1, e), onWall(f, u0, v1, e), col, [[u0 * s, v0 * s], [u1 * s, v0 * s], [u1 * s, v1 * s], [u0 * s, v1 * s]]);
}

// A timber beam on a wall from (ua, va) to (ub, vb), standing slightly proud of it.
function beam(m, f, ua, va, ub, vb, w, col) {
  const dx = ub - ua;
  const dy = vb - va;
  const l = Math.hypot(dx, dy) || 1;
  const px = (-dy / l) * (w / 2);
  const py = (dx / l) * (w / 2);
  const e = 0.006;
  const P = (u, v, ee = e) => onWall(f, u, v, ee);
  const s = 6;
  m.quad(P(ua - px, va - py), P(ub - px, vb - py), P(ub + px, vb + py), P(ua + px, va + py), col, [[0, 0], [l * s, 0], [l * s, w * s], [0, w * s]]);
  if (w < 0.016) return; // thin window bars need no sides
  // Its thickness, so beams catch the light at the edges.
  m.quad(P(ua + px, va + py, 0), P(ua + px, va + py), P(ub + px, vb + py), P(ub + px, vb + py, 0), mul(col, 1.15));
  m.quad(P(ub - px, vb - py, 0), P(ub - px, vb - py), P(ua - px, va - py), P(ua - px, va - py, 0), mul(col, 0.7));
}

// Plaster walls on all four faces of block b from y0 to y1.
function walls(out, b, y0, y1, col, layer = 'plaster') {
  const m = out.layers[layer];
  const s = layer === 'stone' ? 5 : 3;
  for (let face = 0; face < 4; face++) {
    const f = wallFrame(b, face);
    wallRect(m, f, 0, f.w, y0, y1, 0, col, s);
  }
}

// A window: glass that glows warmly, a timber frame with a cross, shutters or a flower box.
function windowAt(out, b, face, u, v, w, h, ctx, { box = false, shutters = false } = {}) {
  const f = wallFrame(b, face);
  const T = out.layers.timber;
  const trim = lin(ctx.v.trim);
  wallRect(out.layers.glass, f, u - w / 2, u + w / 2, v, v + h, 0.004, lin('#ffd98f'));
  const fw = 0.014;
  beam(T, f, u - w / 2, v, u + w / 2, v, fw, trim);
  beam(T, f, u - w / 2, v + h, u + w / 2, v + h, fw, trim);
  beam(T, f, u - w / 2, v, u - w / 2, v + h, fw, trim);
  beam(T, f, u + w / 2, v, u + w / 2, v + h, fw, trim);
  beam(T, f, u, v, u, v + h, fw * 0.6, trim);
  beam(T, f, u - w / 2, v + h * 0.55, u + w / 2, v + h * 0.55, fw * 0.6, trim);
  if (shutters) {
    const sc = lin(ctx.v.shutter);
    wallRect(out.layers.wood, f, u - w / 2 - w * 0.42, u - w / 2 - 0.006, v, v + h, 0.005, sc, 8);
    wallRect(out.layers.wood, f, u + w / 2 + 0.006, u + w / 2 + w * 0.42, v, v + h, 0.005, sc, 8);
  }
  if (box) {
    // A flower box under the window, spilling with flowers.
    const a = onWall(f, u - w / 2 - 0.01, v - 0.03, 0);
    const c = onWall(f, u + w / 2 + 0.01, v - 0.03, 0.04);
    const W = out.layers.wood;
    W.box(Math.min(a[0], c[0]), v - 0.03, Math.min(a[2], c[2]), Math.max(a[0], c[0]), v, Math.max(a[2], c[2]), lin('#8a5a3b'), { s: 8 });
    const col = FLOWERS[Math.floor(rand(ctx.x, ctx.y, face * 7 + Math.round(u * 100)) * FLOWERS.length)];
    for (let i = 0; i < 6; i++) {
      const p = onWall(f, u - w / 2 + (i + 0.5) * (w / 6), v + 0.008, 0.02 + (i % 2) * 0.01);
      const [wx, wz] = out.layers.wood.tx(p[0], p[2]);
      out.flowers.push([wx, v + 0.01, wz, 0.75, i % 3 ? col : '#f8f4ec']);
    }
  }
}

// A plank door with a frame, a step and a little lamp beside it.
function doorAt(out, b, u, w, h, ctx) {
  const f = wallFrame(b, 0);
  wallRect(out.layers.wood, f, u - w / 2, u + w / 2, 0.03, 0.03 + h, 0.005, lin('#7a4b2e'), 10);
  const T = out.layers.timber;
  const trim = lin(ctx.v.trim);
  beam(T, f, u - w / 2, 0.03, u - w / 2, 0.03 + h, 0.016, trim);
  beam(T, f, u + w / 2, 0.03, u + w / 2, 0.03 + h, 0.016, trim);
  beam(T, f, u - w / 2 - 0.01, 0.03 + h, u + w / 2 + 0.01, 0.03 + h, 0.02, trim);
  const st = out.layers.stone;
  const p = onWall(f, u, 0, 0);
  st.box(p[0] - w / 2 - 0.01, 0, p[2], p[0] + w / 2 + 0.01, 0.03, p[2] + 0.05, lin(STONE), { s: 6 });
  const g = onWall(f, u + w / 2 + 0.03, 0.03 + h * 0.75, 0.012);
  out.layers.glow.box(g[0] - 0.009, g[1] - 0.012, g[2] - 0.009, g[0] + 0.009, g[1] + 0.012, g[2] + 0.009, lin('#ffcf73'));
}

// A steep gable roof with overhanging eaves along x over block b, sitting at height y. The gable ends
// are plaster triangles with a little timber in them; the roof has visible thickness and a ridge beam.
function gableRoof(out, b, y, rise, { o = 0.06, layer = 'roof', col, wall, ends = true, ridge = true, endLayer = 'plaster', timbered = true }) {
  const R = out.layers[layer];
  const T = out.layers.timber;
  const zm = (b.z0 + b.z1) / 2;
  const half = (b.z1 - b.z0) / 2;
  const drop = (o * rise) / half;
  const yl = y - drop;
  const th = 0.025;
  const xa = b.x0 - o;
  const xb = b.x1 + o;
  const slope = Math.hypot(half + o, rise + drop);
  const s = layer === 'thatch' ? 4 : 5;
  const uvs = (flip) => [[xa * s * flip, 0], [xb * s * flip, 0], [xb * s * flip, slope * s], [xa * s * flip, slope * s]];
  const eave = mul(col, 0.82);
  R.quad([xa, yl, b.z1 + o], [xb, yl, b.z1 + o], [xb, y + rise, zm], [xa, y + rise, zm], col, uvs(1), [eave, eave, col, col]);
  R.quad([xb, yl, b.z0 - o], [xa, yl, b.z0 - o], [xa, y + rise, zm], [xb, y + rise, zm], col, uvs(-1), [eave, eave, col, col]);
  // Underside and edges, in dark timber.
  const dark = lin('#4a3326');
  T.quad([xb, yl - th, b.z1 + o], [xa, yl - th, b.z1 + o], [xa, y + rise - th, zm], [xb, y + rise - th, zm], dark);
  T.quad([xa, yl - th, b.z0 - o], [xb, yl - th, b.z0 - o], [xb, y + rise - th, zm], [xa, y + rise - th, zm], dark);
  T.quad([xa, yl - th, b.z1 + o], [xb, yl - th, b.z1 + o], [xb, yl, b.z1 + o], [xa, yl, b.z1 + o], dark);
  T.quad([xb, yl - th, b.z0 - o], [xa, yl - th, b.z0 - o], [xa, yl, b.z0 - o], [xb, yl, b.z0 - o], dark);
  for (const x of [xa, xb]) {
    const sgn = x === xa ? -1 : 1;
    const q = (p0, p1) => (sgn < 0 ? T.quad(p0[0], p0[1], p1[1], p1[0], dark) : T.quad(p0[1], p0[0], p1[0], p1[1], dark));
    q([[x, yl - th, b.z1 + o], [x, y + rise - th, zm]], [[x, yl, b.z1 + o], [x, y + rise, zm]]);
    q([[x, y + rise - th, zm], [x, yl - th, b.z0 - o]], [[x, y + rise, zm], [x, yl, b.z0 - o]]);
  }
  if (ridge) T.box(xa - 0.005, y + rise - 0.012, zm - 0.018, xb + 0.005, y + rise + 0.014, zm + 0.018, lin('#4a3326'), { s: 6 });
  if (!ends) return;
  const P = out.layers[endLayer];
  const k = endLayer === 'stone' ? 5 : 3;
  const wc = lin(wall);
  for (const [x, flip] of [[b.x1, 1], [b.x0, -1]]) {
    const pts = [[x, y, b.z1], [x, y, b.z0], [x, y + rise, zm]];
    if (flip > 0) P.tri(pts[0], pts[1], pts[2], wc, wc, wc, [-b.z1 * k, y * k], [-b.z0 * k, y * k], [-zm * k, (y + rise) * k]);
    else P.tri(pts[1], pts[0], pts[2], wc, wc, wc, [b.z0 * k, y * k], [b.z1 * k, y * k], [zm * k, (y + rise) * k]);
    if (!timbered) continue;
    // A king post and two braces in the gable.
    const f = wallFrame(b, flip > 0 ? 1 : 3);
    const um = f.w / 2;
    const tc = lin(TIMBER);
    beam(T, f, um, y, um, y + rise * 0.86, 0.016, tc);
    beam(T, f, um * 0.35, y, um, y + rise * 0.6, 0.013, tc);
    beam(T, f, f.w - um * 0.35, y, um, y + rise * 0.6, 0.013, tc);
    beam(T, f, 0, y, f.w, y, 0.02, tc);
  }
}

// Half-timbering on the walls of a storey: corner posts, a sill and a head beam, posts between
// windows and the odd diagonal brace.
function timbering(out, b, y0, y1, ctx, faces = [0, 1, 2, 3]) {
  const T = out.layers.timber;
  const tc = lin(TIMBER);
  for (const face of faces) {
    const f = wallFrame(b, face);
    beam(T, f, 0, y0 + 0.008, f.w, y0 + 0.008, 0.018, tc);
    beam(T, f, 0, y1 - 0.008, f.w, y1 - 0.008, 0.018, tc);
    beam(T, f, 0.008, y0, 0.008, y1, 0.018, tc);
    beam(T, f, f.w - 0.008, y0, f.w - 0.008, y1, 0.018, tc);
    if (rand(ctx.x, ctx.y, face + 40) < 0.7) {
      beam(T, f, 0.01, y0 + 0.01, f.w * 0.22, y1 - 0.01, 0.013, tc);
      beam(T, f, f.w - 0.01, y0 + 0.01, f.w * 0.78, y1 - 0.01, 0.013, tc);
    }
  }
}

// A stone chimney with a cap and a clay pot.
function chimney(out, x, z, yb, yt) {
  const S = out.layers.stone;
  if (out.winter) {
    const [wx, wz] = S.tx(x, z);
    out.smoke.push({ x: wx, y: yt + 0.06, z: wz, big: false });
  }
  S.box(x - 0.04, yb, z - 0.035, x + 0.04, yt, z + 0.035, lin('#b9a58c'), { s: 6 });
  S.box(x - 0.05, yt, z - 0.045, x + 0.05, yt + 0.02, z + 0.045, lin('#a8957d'), { s: 6 });
  out.layers.paint.cyl(x, z, 0.018, 0.015, yt + 0.02, yt + 0.05, 7, lin('#b06a45'));
}

// A garden around a house lot: a picket fence along the sides and back, a stepping-stone path to the
// lane, flower beds along the front and a bush or two.
function garden(out, ctx, b, { fence = true } = {}) {
  const W = out.layers.wood;
  const pc = lin('#efe6d6');
  if (fence) {
    const e = 0.46;
    const sides = [
      [[-e, -e], [e, -e]], // back
      [[e, -e], [e, e - 0.12]], // right
      [[-e, e - 0.12], [-e, -e]], // left
    ];
    for (const [[ax, az], [bx, bz]] of sides) {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(2, Math.round(len / 0.07));
      W.box(Math.min(ax, bx) - 0.004, 0.05, Math.min(az, bz) - 0.004, Math.max(ax, bx) + 0.004, 0.062, Math.max(az, bz) + 0.004, pc, { s: 10 });
      W.box(Math.min(ax, bx) - 0.004, 0.1, Math.min(az, bz) - 0.004, Math.max(ax, bx) + 0.004, 0.112, Math.max(az, bz) + 0.004, pc, { s: 10 });
      for (let i = 0; i <= n; i++) {
        const px = ax + ((bx - ax) * i) / n;
        const pz = az + ((bz - az) * i) / n;
        W.box(px - 0.009, 0, pz - 0.009, px + 0.009, 0.14, pz + 0.009, pc, { s: 10 });
      }
    }
  }
  // Stepping stones from the door to the lane.
  const S = out.layers.stone;
  for (let i = 0; i < 3; i++) {
    const z = b.z1 + 0.08 + i * 0.075;
    if (z > 0.5) break;
    const jx = (rand(ctx.x, ctx.y, 100 + i) - 0.5) * 0.03;
    S.box(-0.045 + jx, 0, z - 0.025, 0.045 + jx, 0.012, z + 0.025, mul(lin(STONE), 0.95 + rand(ctx.x, ctx.y, 110 + i) * 0.1), { s: 6 });
  }
  // Flower beds either side of the path and bushes at the corners.
  const tx = (x, z) => out.layers.wood.tx(x, z);
  for (const side of [-1, 1]) {
    const [wx, wz] = tx(side * 0.25, b.z1 + 0.09);
    flowerPatch(out, wx, wz, 0.08, 10, rand(ctx.x, ctx.y, side + 120));
    const [bx, bz] = tx(side * 0.36, -0.36);
    bushWorld(out, bx, bz, 0.065 + rand(ctx.x, ctx.y, side + 130) * 0.03, ctx.x * 13 + ctx.y * 7 + side + 3);
  }
  if (rand(ctx.x, ctx.y, 140) < 0.5) {
    const [wx, wz] = tx(rand(ctx.x, ctx.y, 141) < 0.5 ? -0.33 : 0.33, -0.12);
    storyTree(out, wx, wz, rand(ctx.x, ctx.y, 142) < 0.25 ? 3 : 0, 0.55, ctx.x * 17 + ctx.y);
  }
  for (let i = 0; i < 6; i++) {
    const [wx, wz] = tx((rand(ctx.x, ctx.y, 150 + i) - 0.5) * 0.9, (rand(ctx.x, ctx.y, 160 + i) - 0.5) * 0.9);
    out.tufts.push([wx, wz, 0.7, '#5f9a3e']);
  }
}

// ---- Buildings --------------------------------------------------------------------------------

const block = (w, d, z = 0) => ({ x0: -w / 2, x1: w / 2, z0: z - d / 2, z1: z + d / 2 });

// A house: a plaster cottage with a timber-framed upper half, a steep shingled roof, a chimney,
// shuttered windows with flower boxes and a garden. Grown families get a gabled porch or a wing.
function house(out, ctx) {
  const s = ctx.s;
  const stage = ctx.growth?.stage ?? 1;
  const b = block(0.52, 0.42, -0.03);
  const h = 0.3;
  const v = ctx.v;
  out.layers.stone.box(b.x0 - 0.015, 0, b.z0 - 0.015, b.x1 + 0.015, 0.035, b.z1 + 0.015, lin(STONE), { s: 6 });
  walls(out, b, 0.035, h, lin(v.wall));
  timbering(out, b, h * 0.55, h, ctx);
  gableRoof(out, b, h, 0.27, { col: lin(v.roof), wall: v.wall });
  const mid = (b.x1 - b.x0) / 2; // positions along a wall count from its left end
  doorAt(out, b, mid, 0.09, 0.15, ctx);
  windowAt(out, b, 0, mid - 0.16, 0.08, 0.08, 0.075, ctx, { box: true, shutters: true });
  windowAt(out, b, 0, mid + 0.16, 0.08, 0.08, 0.075, ctx, { box: true, shutters: true });
  windowAt(out, b, 0, mid - 0.14, 0.2, 0.065, 0.06, ctx);
  windowAt(out, b, 0, mid + 0.14, 0.2, 0.065, 0.06, ctx);
  for (const face of [1, 2, 3]) {
    const f = wallFrame(b, face);
    windowAt(out, b, face, f.w * 0.5, 0.09, 0.07, 0.07, ctx, { shutters: face === 2 });
  }
  const shape = s.shape || 0;
  chimney(out, shape >= 2 ? b.x0 + 0.1 : b.x1 - 0.1, -0.05, h + 0.08, h + 0.33);
  if (shape % 2 === 1) {
    // A gabled porch over the front door.
    const pb = { x0: -0.08, x1: 0.08, z0: b.z1 - 0.01, z1: b.z1 + 0.1 };
    const T = out.layers.timber;
    for (const x of [-0.07, 0.07]) T.box(x - 0.01, 0, pb.z1 - 0.02, x + 0.01, 0.2, pb.z1, lin(TIMBER), { s: 6 });
    out.layers.roof.nest(0, 0, 1, () => {
      out.layers.timber.nest(0, 0, 1, () => {
        out.layers.plaster.nest(0, 0, 1, () => {
          gableRoof(out, { x0: -pb.z1, x1: -pb.z0, z0: pb.x0, z1: pb.x1 }, 0.2, 0.09, { o: 0.02, col: lin(v.roof), wall: v.wall, ends: false });
        });
      });
    });
  }
  if (stage >= 2) {
    const side = shape >= 2 ? -1 : 1;
    const e = side > 0 ? { x0: b.x1, x1: b.x1 + 0.16, z0: b.z0 + 0.06, z1: b.z1 - 0.06 } : { x0: b.x0 - 0.16, x1: b.x0, z0: b.z0 + 0.06, z1: b.z1 - 0.06 };
    walls(out, e, 0.0, 0.2, lin(v.wall));
    gableRoof(out, e, 0.2, 0.12, { o: 0.03, col: lin(v.roof), wall: v.wall });
    windowAt(out, e, 0, (e.x1 - e.x0) / 2, 0.07, 0.06, 0.06, ctx, { box: true });
  }
  garden(out, ctx, b);
}

// A cottage: low stone walls under a deep golden thatch, with a round bush at the door.
function cottage(out, ctx) {
  const b = block(0.44, 0.36, -0.04);
  const h = 0.2;
  const v = ctx.v;
  walls(out, b, 0, h, lin('#d8ccb6'), 'stone');
  gableRoof(out, b, h, 0.25, { o: 0.07, layer: 'thatch', col: lin('#d2a85c'), wall: '#e8dcc3', ridge: false });
  // A plump thatch ridge.
  out.layers.thatch.box(b.x0 - 0.07, h + 0.22, -0.065, b.x1 + 0.07, h + 0.265, -0.015, lin('#b98d45'), { s: 4 });
  doorAt(out, b, (b.x1 - b.x0) / 2 - 0.05, 0.08, 0.13, ctx);
  windowAt(out, b, 0, (b.x1 - b.x0) / 2 + 0.12, 0.07, 0.07, 0.065, ctx, { box: true });
  for (const face of [1, 2, 3]) windowAt(out, b, face, wallFrame(b, face).w / 2, 0.07, 0.06, 0.06, ctx);
  chimney(out, b.x1 - 0.08, -0.04, h + 0.05, h + 0.3);
  garden(out, ctx, b, { fence: (ctx.s.shape || 0) % 2 === 0 });
}

// Apartments, towers and offices: a tall half-timbered townhouse. Each storey jetties out a touch over
// the one below, as in old market towns; a stone ground floor and dormers in the roof.
function townhouse(out, ctx) {
  const floors = Math.max(2, Math.min(8, ctx.growth?.floors || ctx.floors || (ctx.s.type === 'tower' ? 5 : ctx.s.type === 'office' ? 4 : 3)));
  const v = ctx.v;
  let b = block(0.64, 0.5, -0.04);
  const S = out.layers.stone;
  S.box(b.x0, 0, b.z0, b.x1, FLOOR, b.z1, lin('#cdbfa8'), { s: 5 });
  doorAt(out, b, (b.x1 - b.x0) / 2, 0.1, 0.16, ctx);
  for (const u of [0.1, 0.54]) windowAt(out, b, 0, u, 0.07, 0.08, 0.1, ctx, { box: true });
  for (const face of [1, 2, 3]) {
    const f = wallFrame(b, face);
    windowAt(out, b, face, f.w * 0.3, 0.08, 0.07, 0.09, ctx);
    windowAt(out, b, face, f.w * 0.7, 0.08, 0.07, 0.09, ctx);
  }
  let y = FLOOR;
  for (let i = 1; i < floors; i++) {
    const fb = { x0: b.x0 - (i < 4 ? 0.012 : 0), x1: b.x1 + (i < 4 ? 0.012 : 0), z0: b.z0 - (i < 4 ? 0.012 : 0), z1: b.z1 + (i < 4 ? 0.012 : 0) };
    // The jetty's underside.
    out.layers.timber.box(fb.x0, y - 0.012, fb.z0, fb.x1, y, fb.z1, lin('#4a3326'), { s: 6 });
    walls(out, fb, y, y + FLOOR, lin(i % 2 ? v.wall : shadeHex(v.wall, 0.96)));
    timbering(out, fb, y, y + FLOOR, ctx);
    for (let face = 0; face < 4; face++) {
      const f = wallFrame(fb, face);
      const n = face % 2 === 0 ? 3 : 2;
      for (let k = 0; k < n; k++) windowAt(out, fb, face, (f.w * (k + 0.5)) / n, y + 0.07, 0.075, 0.1, ctx, { box: face === 0 && (k + i) % 2 === 0, shutters: face === 0 });
    }
    b = fb;
    y += FLOOR;
  }
  gableRoof(out, b, y, 0.32, { col: lin(v.roof), wall: v.wall });
  // Two little dormers on the front slope.
  for (const dx of [-0.16, 0.16]) {
    const db = { x0: dx - 0.05, x1: dx + 0.05, z0: 0.0, z1: (b.z1 + b.z0) / 2 + 0.17 };
    out.layers.plaster.box(db.x0, y + 0.03, db.z1 - 0.05, db.x1, y + 0.14, db.z1, lin(v.wall), { s: 3 });
    windowAt(out, db, 0, 0.05, y + 0.055, 0.05, 0.06, ctx);
    out.layers.roof.quad([db.x0 - 0.015, y + 0.13, db.z1 + 0.01], [dx, y + 0.19, db.z1 + 0.01], [dx, y + 0.19, db.z1 - 0.1], [db.x0 - 0.015, y + 0.13, db.z1 - 0.1], lin(v.roof));
    out.layers.roof.quad([dx, y + 0.19, db.z1 + 0.01], [db.x1 + 0.015, y + 0.13, db.z1 + 0.01], [db.x1 + 0.015, y + 0.13, db.z1 - 0.1], [dx, y + 0.19, db.z1 - 0.1], lin(v.roof));
  }
  chimney(out, b.x1 - 0.1, b.z0 + 0.1, y + 0.1, y + 0.4);
  // Window boxes and a bush or two at the foot.
  const [wx, wz] = out.layers.wood.tx(-0.38, 0.3);
  bushWorld(out, wx, wz, 0.06, ctx.x * 11 + ctx.y);
}

function shadeHex(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => c(v).toString(16).padStart(2, '0')).join('')}`;
}

// A shop, café or bakery: a wide shop window under a striped awning, a hanging sign, a timber-framed
// upper floor and a steep roof. The café puts tables out front, the bakery a bench and bread crates.
function shopfront(out, ctx) {
  const type = ctx.s.type;
  const v = ctx.v;
  const b = block(0.6, 0.46, -0.05);
  const S = out.layers.stone;
  S.box(b.x0 - 0.01, 0, b.z0 - 0.01, b.x1 + 0.01, 0.03, b.z1 + 0.01, lin(STONE), { s: 6 });
  walls(out, b, 0.03, FLOOR, lin(v.wall));
  const f = wallFrame(b, 0);
  // A big shop window either side of the door.
  for (const [u0, u1] of [[0.04, 0.22], [0.38, 0.56]]) {
    wallRect(out.layers.glass, f, u0, u1, 0.06, 0.19, 0.004, lin('#ffd98f'));
    const T = out.layers.timber;
    const tc = lin(v.trim);
    beam(T, f, u0, 0.06, u1, 0.06, 0.02, tc);
    beam(T, f, u0, 0.19, u1, 0.19, 0.016, tc);
    for (let k = 0; k <= 3; k++) beam(T, f, u0 + ((u1 - u0) * k) / 3, 0.06, u0 + ((u1 - u0) * k) / 3, 0.19, 0.012, tc);
    wallRect(out.layers.wood, f, u0, u1, 0.03, 0.06, 0.008, lin(v.shutter), 8);
  }
  doorAt(out, b, 0.3, 0.09, 0.16, ctx);
  // A striped awning over the front.
  const P = out.layers.paint;
  const stripes = 9;
  const ay = 0.21;
  const colA = lin(type === 'cafe' ? '#c8463d' : type === 'bakery' ? '#3f6fa3' : '#4f8a4e');
  const colB = lin('#f6efe2');
  for (let k = 0; k < stripes; k++) {
    const xa = b.x0 + ((b.x1 - b.x0) * k) / stripes;
    const xb = b.x0 + ((b.x1 - b.x0) * (k + 1)) / stripes;
    const c = k % 2 ? colB : colA;
    P.quad([xa, ay - 0.05, b.z1 + 0.11], [xb, ay - 0.05, b.z1 + 0.11], [xb, ay, b.z1 + 0.002], [xa, ay, b.z1 + 0.002], c);
    P.quad([xa, ay - 0.075, b.z1 + 0.11], [xb, ay - 0.075, b.z1 + 0.11], [xb, ay - 0.05, b.z1 + 0.11], [xa, ay - 0.05, b.z1 + 0.11], mul(c, 0.9));
  }
  // The upper floor.
  walls(out, b, FLOOR, FLOOR * 2, lin(v.wall));
  timbering(out, b, FLOOR, FLOOR * 2, ctx);
  for (const u of [0.12, 0.3, 0.48]) windowAt(out, b, 0, u, FLOOR + 0.07, 0.07, 0.09, ctx, { box: true, shutters: true });
  for (const face of [1, 3]) windowAt(out, b, face, wallFrame(b, face).w / 2, FLOOR + 0.07, 0.07, 0.09, ctx);
  gableRoof(out, b, FLOOR * 2, 0.26, { col: lin(v.roof), wall: v.wall });
  chimney(out, b.x0 + 0.1, b.z0 + 0.1, FLOOR * 2 + 0.08, FLOOR * 2 + 0.34);
  // A hanging sign on an iron bracket.
  const T = out.layers.timber;
  T.box(b.x1 - 0.02, 0.27, b.z1, b.x1 - 0.01, 0.28, b.z1 + 0.12, lin('#2f2c30'));
  out.layers.wood.box(b.x1 - 0.022, 0.19, b.z1 + 0.05, b.x1 - 0.008, 0.26, b.z1 + 0.11, lin(type === 'cafe' ? '#d9a441' : '#b8693d'), { s: 8 });
  if (type === 'cafe') {
    for (const x of [-0.2, 0.2]) {
      const W = out.layers.wood;
      W.cyl(x, b.z1 + 0.2, 0.005, 0.005, 0, 0.07, 5, lin('#3a3438'));
      W.cyl(x, b.z1 + 0.2, 0.045, 0.045, 0.07, 0.078, 9, lin('#efe6d6'));
      P.cyl(x, b.z1 + 0.2, 0.004, 0.004, 0.078, 0.16, 4, lin('#efe6d6'));
      P.cyl(x, b.z1 + 0.2, 0.07, 0.0, 0.16, 0.2, 8, lin(k2(ctx)));
    }
  } else {
    out.layers.wood.box(-0.27, 0, b.z1 + 0.04, -0.17, 0.05, b.z1 + 0.1, lin('#8a5a3b'), { s: 8 });
    const [wx, wz] = out.layers.wood.tx(-0.22, b.z1 + 0.07);
    flowerPatch(out, wx, wz, 0.03, 6, rand(ctx.x, ctx.y, 7));
  }
  const [bx, bz] = out.layers.wood.tx(0.36, -0.34);
  bushWorld(out, bx, bz, 0.07, ctx.x * 5 + ctx.y * 3);
}
const k2 = (ctx) => (rand(ctx.x, ctx.y, 9) < 0.5 ? '#c8463d' : '#3f6fa3');

// A tree tile: one big tree or a small cluster, with bushes and flowers around their feet.
function treeTile(out, ctx) {
  const { x, y } = ctx;
  const shape = ctx.s.shape || 0;
  const kind = shape === 3 ? 3 : shape === 2 ? 2 : shape === 1 ? 1 : 0;
  const n = 1 + Math.floor(rand(x, y, 200) * 2.4);
  for (let i = 0; i < n; i++) {
    const ox = n === 1 ? 0 : (rand(x, y, 210 + i) - 0.5) * 0.5;
    const oz = n === 1 ? 0 : (rand(x, y, 220 + i) - 0.5) * 0.5;
    storyTree(out, x + 0.5 + ox, y + 0.5 + oz, i === 0 ? kind : Math.floor(rand(x, y, 230 + i) * 3), (n === 1 ? 1.15 : 0.85) + rand(x, y, 240 + i) * 0.3, x * 101 + y * 7 + i);
  }
  for (let i = 0; i < 2; i++) bushWorld(out, x + 0.15 + rand(x, y, 250 + i) * 0.7, y + 0.15 + rand(x, y, 260 + i) * 0.7, 0.05 + rand(x, y, 270 + i) * 0.04, x * 3 + y * 5 + i, 0);
  meadow(out, ctx);
}

// A park: a gravel path, flower beds, a bench, a lamp and trees.
function park(out, ctx) {
  const { x, y } = ctx;
  const D = out.layers.dirt;
  D.quad([-0.08, 0.005, 0.5], [0.08, 0.005, 0.5], [0.08, 0.005, -0.5], [-0.08, 0.005, -0.5], lin('#d8c6a0'), [[0, 0], [0.16, 0], [0.16, 1], [0, 1]]);
  const tx = (a, b) => D.tx(a, b);
  for (const side of [-1, 1]) {
    const [wx, wz] = tx(side * 0.28, 0.25);
    flowerPatch(out, wx, wz, 0.13, 16, rand(x, y, 300 + side));
    const [tx2, tz2] = tx(side * 0.3, -0.25);
    storyTree(out, tx2, tz2, side > 0 ? 0 : rand(x, y, 310) < 0.5 ? 3 : 1, 0.8, x * 13 + y + side);
  }
  // A bench beside the path.
  const W = out.layers.wood;
  W.box(0.1, 0.05, -0.06, 0.13, 0.06, 0.08, lin(WOOD), { s: 8 });
  W.box(0.13, 0.06, -0.06, 0.14, 0.1, 0.08, lin(WOOD), { s: 8 });
  for (const z of [-0.05, 0.07]) W.box(0.105, 0, z - 0.005, 0.135, 0.05, z + 0.005, lin('#3a3438'));
  const [lx, lz] = tx(-0.12, -0.02);
  lantern(out, lx, lz);
  meadow(out, ctx);
}

// ---- Civic -------------------------------------------------------------------------------------

// A village schoolhouse on the game's school footprint: brick walls with pale stone corners and sills,
// tall white-framed windows on two floors, a slate roof with a gabled entrance bay in the middle (double
// doors, stone steps, a name board), a bell cupola with a weathervane on the ridge, chimneys at both
// ends, and a gravel yard in front with a flagpole, a bench, flower beds and a fence round the sides.
const SCHOOL = { wall: '#b5654c', trim: '#f4ecdc', shutter: '#3f6b5a', roof: '#5b6478', stone: '#e4d8c2' };
function school(out, ctx) {
  const v = SCHOOL;
  const sctx = { ...ctx, v: { ...ctx.v, trim: v.trim, shutter: v.shutter } };
  const b = block(0.8, 0.5, -0.12);
  const h = 0.44;
  const S = out.layers.stone;
  const brick = lin(v.wall);
  const pale = lin(v.stone);
  S.box(b.x0 - 0.015, 0, b.z0 - 0.015, b.x1 + 0.015, 0.04, b.z1 + 0.015, pale, { s: 6 });
  walls(out, b, 0.04, h, brick, 'stone');
  // Pale stone quoins up the corners and a band between the floors.
  for (const [x, z] of [[b.x0, b.z0], [b.x1, b.z0], [b.x0, b.z1], [b.x1, b.z1]]) {
    // Stop below the eaves, so no stone pokes through the roof.
    for (let y = 0.04; y < h - 0.06; y += 0.06) {
      const w = Math.round(y / 0.06) % 2 ? 0.03 : 0.02;
      S.box(x - w, y, z - w, x + w, Math.min(h - 0.03, y + 0.05), z + w, pale, { s: 8 });
    }
  }
  S.box(b.x0 - 0.008, 0.215, b.z0 - 0.008, b.x1 + 0.008, 0.232, b.z1 + 0.008, pale, { s: 6 });
  // Tall windows: three each side of the entrance on both floors, and along the sides and back.
  for (const u of [0.07, 0.17, 0.27, 0.53, 0.63, 0.73]) {
    windowAt(out, b, 0, u, 0.075, 0.07, 0.12, sctx, { box: u === 0.17 || u === 0.63 });
    windowAt(out, b, 0, u, 0.26, 0.07, 0.11, sctx);
  }
  for (const face of [1, 3]) for (const u of [0.14, 0.36]) for (const y of [0.075, 0.26]) windowAt(out, b, face, u, y, 0.07, 0.11, sctx);
  for (const u of [0.12, 0.28, 0.52, 0.68]) for (const y of [0.075, 0.26]) windowAt(out, b, 2, u, y, 0.07, 0.11, sctx);
  gableRoof(out, b, h, 0.24, { o: 0.05, col: lin(v.roof), wall: v.wall, endLayer: 'stone', timbered: false });
  chimney(out, b.x0 + 0.08, b.z0 + 0.12, h + 0.1, h + 0.32);
  chimney(out, b.x1 - 0.08, b.z0 + 0.12, h + 0.1, h + 0.32);
  // The entrance bay: a little brick gable standing forward of the front, with a slate roof of its own.
  const e = { x0: -0.12, x1: 0.12, z0: b.z1 - 0.02, z1: b.z1 + 0.09 };
  walls(out, e, 0.04, 0.34, brick, 'stone');
  S.box(e.x0 - 0.015, 0, e.z0, e.x1 + 0.015, 0.04, e.z1 + 0.015, pale, { s: 6 });
  out.layers.roof.nest(0, 0, 1, () => out.layers.timber.nest(0, 0, 1, () => out.layers.stone.nest(0, 0, 1, () => {
    gableRoof(out, { x0: -e.z1, x1: -e.z0 + 0.1, z0: e.x0, z1: e.x1 }, 0.34, 0.14, { o: 0.03, col: lin(v.roof), wall: v.wall, endLayer: 'stone', timbered: false });
  })));
  // Double doors with a fanlight, a name board above, and three stone steps.
  const f = wallFrame(e, 0);
  const W = out.layers.wood;
  wallRect(W, f, 0.065, 0.118, 0.07, 0.24, 0.005, lin('#2f5a4a'), 10);
  wallRect(W, f, 0.122, 0.175, 0.07, 0.24, 0.005, lin('#2f5a4a'), 10);
  wallRect(out.layers.glass, f, 0.075, 0.165, 0.245, 0.275, 0.005, lin('#ffd98f'));
  const T = out.layers.timber;
  const trim = lin(v.trim);
  beam(T, f, 0.06, 0.07, 0.06, 0.28, 0.016, trim);
  beam(T, f, 0.18, 0.07, 0.18, 0.28, 0.016, trim);
  beam(T, f, 0.055, 0.28, 0.185, 0.28, 0.018, trim);
  beam(T, f, 0.12, 0.07, 0.12, 0.24, 0.008, trim);
  wallRect(W, f, 0.04, 0.2, 0.295, 0.33, 0.007, lin('#e9dfc6'), 10);
  out.layers.paint.box(0.065 - 0.12, 0.306, e.z1 + 0.007, 0.175 - 0.12, 0.318, e.z1 + 0.009, lin('#3b3036'));
  for (let i = 0; i < 3; i++) S.box(e.x0 + 0.02 - i * 0.012, 0, e.z1 + i * 0.03, e.x1 - 0.02 + i * 0.012, 0.04 - i * 0.013, e.z1 + 0.03 + i * 0.03, pale, { s: 6 });
  // The bell cupola on the ridge: four white posts round a bell, a pyramid cap and a weathervane.
  const cy = h + 0.24;
  const cz = (b.z0 + b.z1) / 2;
  W.box(-0.055, cy - 0.04, cz - 0.055, 0.055, cy + 0.02, cz + 0.055, trim, { s: 8 });
  for (const [x, z] of [[-0.045, -0.045], [0.045, -0.045], [-0.045, 0.045], [0.045, 0.045]]) W.box(x - 0.008, cy + 0.02, cz + z - 0.008, x + 0.008, cy + 0.11, cz + z + 0.008, trim, { s: 8 });
  out.layers.paint.cyl(0, cz, 0.012, 0.026, cy + 0.04, cy + 0.085, 8, lin('#c99a3a'));
  W.box(-0.062, cy + 0.11, cz - 0.062, 0.062, cy + 0.125, cz + 0.062, trim, { s: 8 });
  out.layers.roof.cyl(0, cz, 0.088, 0.001, cy + 0.125, cy + 0.2, 4, lin(v.roof), { a0: Math.PI / 4 });
  T.box(-0.003, cy + 0.2, cz - 0.003, 0.003, cy + 0.26, cz + 0.003, lin('#2f2c30'));
  T.box(-0.03, cy + 0.24, cz - 0.003, 0.03, cy + 0.246, cz + 0.003, lin('#2f2c30'));
  // The yard: gravel in front, a flagpole, a bench, flower beds under the windows, a fence and a tree.
  const D = out.layers.dirt;
  D.quad([-0.44, 0.006, 0.47], [0.44, 0.006, 0.47], [0.44, 0.006, b.z1 + 0.02], [-0.44, 0.006, b.z1 + 0.02], lin('#d6c4a0'), [[-0.44, -0.47], [0.44, -0.47], [0.44, -b.z1], [-0.44, -b.z1]]);
  T.box(0.33, 0, 0.3, 0.342, 0.46, 0.312, lin('#e9e4da'), { s: 6 });
  out.layers.paint.quad([0.342, 0.44, 0.306], [0.43, 0.43, 0.306], [0.43, 0.38, 0.306], [0.342, 0.39, 0.306], lin('#b5483d'));
  bench(out, -0.3, 0.36, 0);
  const P = out.layers.wood;
  for (const side of [-1, 1]) {
    const [wx, wz] = P.tx(side * 0.3, b.z1 + 0.04);
    flowerPatch(out, wx, wz, 0.06, 9, rand(ctx.x, ctx.y, side + 60));
  }
  const [bx, bz] = P.tx(0.4, -0.42);
  storyTree(out, bx, bz, 0, 0.6, ctx.x * 19 + ctx.y);
  const [ux, uz] = P.tx(-0.42, -0.4);
  bushWorld(out, ux, uz, 0.06, ctx.x * 7 + ctx.y * 3);
  schoolFence(out);
}

// A low picket fence along the back and sides of a lot.
function schoolFence(out) {
  const W = out.layers.wood;
  const pc = lin('#efe6d6');
  const e = 0.47;
  for (const [[ax, az], [bx, bz]] of [[[-e, -e], [e, -e]], [[e, -e], [e, 0.1]], [[-e, 0.1], [-e, -e]]]) {
    W.box(Math.min(ax, bx) - 0.004, 0.05, Math.min(az, bz) - 0.004, Math.max(ax, bx) + 0.004, 0.06, Math.max(az, bz) + 0.004, pc, { s: 10 });
    const n = Math.max(2, Math.round(Math.hypot(bx - ax, bz - az) / 0.08));
    for (let i = 0; i <= n; i++) {
      const px = ax + ((bx - ax) * i) / n;
      const pz = az + ((bz - az) * i) / n;
      W.box(px - 0.008, 0, pz - 0.008, px + 0.008, 0.11, pz + 0.008, pc, { s: 10 });
    }
  }
}

// A wooden park bench (in the building's frame), facing `r` quarter turns from +z.
function bench(out, x, z, r) {
  const W = out.layers.wood;
  W.nest(x, z, r, () => {
    const wood = lin('#9a6b44');
    const iron = lin('#2f2c30');
    W.box(-0.07, 0.045, -0.02, 0.07, 0.053, 0.02, wood, { s: 10 });
    W.box(-0.07, 0.06, -0.026, 0.07, 0.1, -0.019, wood, { s: 10 });
    for (const lx of [-0.06, 0.06]) {
      W.box(lx - 0.005, 0, -0.02, lx + 0.005, 0.045, -0.012, iron);
      W.box(lx - 0.005, 0, 0.012, lx + 0.005, 0.045, 0.02, iron);
      W.box(lx - 0.005, 0.045, -0.026, lx + 0.005, 0.1, -0.019, iron);
    }
  });
}

// A village playground: a wooden swing set with two swings, a slide tower with a little red roof, a
// ladder and a painted chute, a sandbox with a bucket, a seesaw, benches for the parents, a dirt path,
// flower beds and a shady tree. Still a lawn you can walk across, as in the game.
function playground(out, ctx) {
  const { x, y } = ctx;
  const W = out.layers.wood;
  const T = out.layers.timber;
  const Pt = out.layers.paint;
  const D = out.layers.dirt;
  const wood = lin('#a77b52');
  const dark = lin('#6e4b32');
  const rope = lin('#5a4a3a');
  // Worn earth under the equipment and a path in from the street.
  D.quad([-0.07, 0.004, 0.5], [0.07, 0.004, 0.5], [0.07, 0.004, -0.05], [-0.07, 0.004, -0.05], lin('#c7ab7c'), [[-0.07, -0.5], [0.07, -0.5], [0.07, 0.05], [-0.07, 0.05]]);
  D.quad([0.03, 0.005, -0.08], [0.44, 0.005, -0.08], [0.44, 0.005, -0.34], [0.03, 0.005, -0.34], lin('#c9ad80'), [[0.03, 0.08], [0.44, 0.08], [0.44, 0.34], [0.03, 0.34]]);
  // Swing set: two A-frames joined by a top beam, two swings on ropes.
  const sz = -0.21;
  const top = 0.27;
  for (const sx of [0.07, 0.41]) {
    W.rod([sx, 0, sz - 0.09], [sx, top, sz], 0.016, wood);
    W.rod([sx, 0, sz + 0.09], [sx, top, sz], 0.016, wood);
    W.rod([sx, 0.08, sz - 0.062], [sx, 0.08, sz + 0.062], 0.01, wood);
  }
  W.rod([0.06, top, sz], [0.42, top, sz], 0.02, wood);
  for (const [cx, swing] of [[0.17, 0.02], [0.31, -0.03]]) {
    for (const dx of [-0.025, 0.025]) T.rod([cx + dx, top - 0.01, sz], [cx + dx, 0.07, sz + swing], 0.004, rope);
    W.box(cx - 0.035, 0.06, sz + swing - 0.018, cx + 0.035, 0.07, sz + swing + 0.018, lin('#b5483d'), { s: 10 });
  }
  // Slide tower: four posts, a platform, a little roof, a ladder at the back and a chute to the front.
  const px = -0.28;
  const pz = -0.24;
  const ph = 0.16;
  for (const [ox, oz] of [[-0.06, -0.06], [0.06, -0.06], [-0.06, 0.06], [0.06, 0.06]]) W.box(px + ox - 0.008, 0, pz + oz - 0.008, px + ox + 0.008, ph + 0.13, pz + oz + 0.008, wood, { s: 8 });
  W.box(px - 0.07, ph - 0.012, pz - 0.07, px + 0.07, ph, pz + 0.07, lin('#9a6b44'), { s: 8 });
  for (const ox of [-0.06, 0.06]) W.rod([px + ox, ph + 0.06, pz - 0.06], [px + ox, ph + 0.06, pz + 0.06], 0.008, wood);
  gableRoof(out, { x0: px - 0.07, x1: px + 0.07, z0: pz - 0.07, z1: pz + 0.07 }, ph + 0.13, 0.07, { o: 0.015, col: lin('#a8464c'), wall: '#d9a87a', ends: false });
  for (const ox of [-0.035, 0.035]) W.rod([px + ox, 0, pz - 0.14], [px + ox, ph, pz - 0.07], 0.01, wood);
  for (let i = 1; i <= 4; i++) {
    const t = i / 5;
    W.rod([px - 0.035, ph * t, pz - 0.14 + 0.07 * t], [px + 0.035, ph * t, pz - 0.14 + 0.07 * t], 0.007, dark);
  }
  const chute = lin('#3f6fa3');
  const z0 = pz + 0.07;
  const z1 = pz + 0.36;
  Pt.quad([px - 0.035, ph, z0], [px - 0.035, 0.015, z1], [px + 0.035, 0.015, z1], [px + 0.035, ph, z0], chute);
  Pt.quad([px - 0.035, 0.015, z1], [px - 0.035, 0.005, z1 + 0.05], [px + 0.035, 0.005, z1 + 0.05], [px + 0.035, 0.015, z1], chute);
  for (const ox of [-0.04, 0.04]) Pt.rod([px + ox, ph + 0.025, z0], [px + ox, 0.035, z1], 0.01, mul(chute, 1.1));
  // Sandbox with a wooden frame, sand, a bucket and a spade.
  const bx = -0.26;
  const bz = 0.22;
  D.quad([bx - 0.11, 0.022, bz + 0.1], [bx + 0.11, 0.022, bz + 0.1], [bx + 0.11, 0.022, bz - 0.1], [bx - 0.11, 0.022, bz - 0.1], lin('#ecd9a6'), [[0, 0], [0.22, 0], [0.22, 0.2], [0, 0.2]]);
  for (const [ax, az, cx, cz] of [[bx - 0.12, bz - 0.11, bx + 0.12, bz - 0.09], [bx - 0.12, bz + 0.09, bx + 0.12, bz + 0.11], [bx - 0.12, bz - 0.09, bx - 0.1, bz + 0.09], [bx + 0.1, bz - 0.09, bx + 0.12, bz + 0.09]]) W.box(ax, 0, az, cx, 0.035, cz, wood, { s: 10 });
  Pt.cyl(bx + 0.04, bz - 0.02, 0.014, 0.018, 0.022, 0.05, 8, lin('#ffd166'));
  Pt.rod([bx - 0.05, 0.026, bz + 0.03], [bx - 0.01, 0.028, bz + 0.05], 0.008, lin('#ef476f'));
  // Seesaw on a little trestle.
  const qx = 0.24;
  const qz = 0.2;
  W.box(qx - 0.015, 0, qz - 0.03, qx + 0.015, 0.05, qz + 0.03, dark, { s: 8 });
  W.rod([qx - 0.17, 0.025, qz], [qx + 0.17, 0.085, qz], 0.03, lin('#d49a3a'));
  for (const [hx, hy] of [[qx - 0.14, 0.03], [qx + 0.14, 0.08]]) T.rod([hx, hy, qz - 0.012], [hx, hy + 0.04, qz - 0.012], 0.006, lin('#2f2c30'));
  // Benches, flowers, a bush and a tree.
  bench(out, 0.15, 0.43, 2);
  bench(out, -0.43, -0.02, 1);
  const tx = (a, b) => W.tx(a, b);
  for (const [fx, fz, seed] of [[0.4, 0.42, 1], [-0.42, 0.43, 2], [0.05, -0.43, 3]]) {
    const [wx, wz] = tx(fx, fz);
    flowerPatch(out, wx, wz, 0.07, 10, rand(x, y, 500 + seed));
  }
  const [rx, rz] = tx(-0.04, -0.4);
  storyTree(out, rx, rz, rand(x, y, 510) < 0.5 ? 3 : 0, 0.62, x * 23 + y);
  const [hx2, hz2] = tx(0.43, 0.02);
  bushWorld(out, hx2, hz2, 0.06, x * 5 + y * 11);
  for (let i = 0; i < 8; i++) {
    const [wx, wz] = tx((rand(x, y, 520 + i) - 0.5) * 0.9, (rand(x, y, 530 + i) - 0.5) * 0.9);
    out.tufts.push([wx, wz, 0.7, '#5f9a3e']);
  }
}

// ---- Civic and working buildings -------------------------------------------------------------------

// A pointed arch (a half disc) of colour on a wall, centred at u with its springing at height y.
function archAt(out, layer, b, face, u, y, r, col, e = 0.006) {
  const f = wallFrame(b, face);
  const m = out.layers[layer];
  const P = (a) => onWall(f, u + Math.cos(a) * r, y + Math.sin(a) * r, e);
  const c = onWall(f, u, y, e);
  for (let i = 0; i < 6; i++) m.tri(c, P((Math.PI * i) / 6), P((Math.PI * (i + 1)) / 6), col);
}

// A window with a pointed top, for the old stone halls.
function gothicAt(out, b, face, u, v, w, h, ctx) {
  windowAt(out, b, face, u, v, w, h, ctx);
  const f = wallFrame(b, face);
  const m = out.layers.glass;
  m.tri(onWall(f, u - w / 2, v + h, 0.004), onWall(f, u + w / 2, v + h, 0.004), onWall(f, u, v + h + w * 0.75, 0.004), lin('#ffd98f'));
  const T = out.layers.timber;
  const trim = lin(ctx.v.trim);
  beam(T, f, u - w / 2, v + h, u, v + h + w * 0.75, 0.013, trim);
  beam(T, f, u + w / 2, v + h, u, v + h + w * 0.75, 0.013, trim);
}

// A small gabled roof over a door or portico, standing forward of the front wall: posts, a gable roof.
function gablePorch(out, cx, w, z0, z1, y, rise, roofCol, postCol, o = 0.02) {
  const T = out.layers.timber;
  for (const x of [cx - w / 2 + 0.015, cx + w / 2 - 0.015]) T.box(x - 0.01, 0, z1 - 0.025, x + 0.01, y, z1 - 0.005, postCol, { s: 6 });
  out.layers.roof.nest(0, 0, 1, () => T.nest(0, 0, 1, () => {
    gableRoof(out, { x0: -z1, x1: -z0, z0: cx - w / 2, z1: cx + w / 2 }, y, rise, { o, col: roofCol, wall: '#ffffff', ends: false });
  }));
}

// Stone steps up to a door, n treads wide w centred on cx.
function steps(out, cx, w, z, n = 3, col = lin(STONE)) {
  const S = out.layers.stone;
  for (let i = 0; i < n; i++) S.box(cx - w / 2 - i * 0.01, 0, z + i * 0.028, cx + w / 2 + i * 0.01, 0.036 - i * 0.012, z + 0.028 + i * 0.028, col, { s: 6 });
}

// Two or three loose trees and bushes round a lot, in the building's frame.
function lotGreens(out, ctx, trees, bushes) {
  const P = out.layers.wood;
  trees.forEach(([x, z, k, sc], i) => {
    const [wx, wz] = P.tx(x, z);
    storyTree(out, wx, wz, k, sc, ctx.x * 19 + ctx.y * 5 + i);
  });
  bushes.forEach(([x, z, r], i) => {
    const [wx, wz] = P.tx(x, z);
    bushWorld(out, wx, wz, r, ctx.x * 7 + ctx.y * 3 + i * 5);
  });
  for (let i = 0; i < 6; i++) {
    const [wx, wz] = P.tx((rand(ctx.x, ctx.y, 250 + i) - 0.5) * 0.92, (rand(ctx.x, ctx.y, 260 + i) - 0.5) * 0.92);
    out.tufts.push([wx, wz, 0.7, '#5f9a3e']);
  }
}

// A hedge along the front of a lot between x0 and x1, with a gap for the path.
function hedge(out, ctx, x0, x1, z, r = 0.04) {
  const P = out.layers.wood;
  const n = Math.max(2, Math.round(Math.abs(x1 - x0) / (r * 1.7)));
  for (let i = 0; i < n; i++) {
    const [wx, wz] = P.tx(x0 + ((x1 - x0) * (i + 0.5)) / n, z);
    bushWorld(out, wx, wz, r, ctx.x * 5 + ctx.y * 11 + i, 0);
  }
}

// The clinic: a whitewashed cottage-hospital with a teal slate roof, a gabled porch, a red-cross board
// over the door, benches and a hedge.
const CLINIC = { wall: '#f6f1e6', roof: '#4f8f8c', trim: '#f4ecdc', shutter: '#5d8f86' };
function clinic(out, ctx) {
  const v = CLINIC;
  const cctx = { ...ctx, v: { ...ctx.v, ...v, trim: '#8a7a68' } };
  const b = block(0.64, 0.46, -0.05);
  const h = 0.28;
  const mid = (b.x1 - b.x0) / 2;
  out.layers.stone.box(b.x0 - 0.015, 0, b.z0 - 0.015, b.x1 + 0.015, 0.035, b.z1 + 0.015, lin(STONE), { s: 6 });
  walls(out, b, 0.035, h, lin(v.wall));
  gableRoof(out, b, h, 0.2, { o: 0.05, col: lin(v.roof), wall: v.wall, timbered: false });
  chimney(out, b.x1 - 0.1, -0.08, h + 0.05, h + 0.28);
  for (const du of [-0.22, -0.11, 0.11, 0.22]) {
    windowAt(out, b, 0, mid + du, 0.07, 0.065, 0.085, cctx, { shutters: Math.abs(du) > 0.15 });
    windowAt(out, b, 0, mid + du, 0.19, 0.06, 0.065, cctx);
  }
  for (const face of [1, 3]) for (const u of [0.12, 0.32]) {
    windowAt(out, b, face, u, 0.07, 0.065, 0.085, cctx);
    windowAt(out, b, face, u, 0.19, 0.06, 0.065, cctx);
  }
  for (const u of [0.14, 0.32, 0.5]) windowAt(out, b, 2, u, 0.09, 0.07, 0.08, cctx);
  // The door and its gabled porch.
  doorAt(out, b, mid, 0.1, 0.16, cctx);
  gablePorch(out, 0, 0.26, b.z1 - 0.01, b.z1 + 0.12, 0.2, 0.09, lin(v.roof), lin('#efe6d6'));
  steps(out, 0, 0.12, b.z1 + 0.05, 2);
  // A red-cross board over the porch.
  const f = wallFrame(b, 0);
  const P = out.layers.paint;
  wallRect(P, f, mid - 0.04, mid + 0.04, 0.215, 0.295, 0.008, lin('#fbf7ee'));
  wallRect(P, f, mid - 0.0135, mid + 0.0135, 0.222, 0.288, 0.0095, lin('#c8392f'));
  wallRect(P, f, mid - 0.032, mid + 0.032, 0.2475, 0.2625, 0.0095, lin('#c8392f'));
  // Benches by the door, a hedge along the front and a pair of trees.
  bench(out, -0.2, b.z1 + 0.1, 0);
  bench(out, 0.2, b.z1 + 0.1, 0);
  hedge(out, ctx, -0.4, -0.3, b.z1 + 0.03);
  hedge(out, ctx, 0.3, 0.4, b.z1 + 0.03);
  schoolFence(out);
  lotGreens(out, ctx, [[-0.4, -0.3, 0, 0.55], [0.4, -0.3, 3, 0.5]], [[0.4, 0.3, 0.06]]);
}

// The library: pale stone under a teal roof, a temple front of four columns and a pediment, tall arched
// windows, a book-motif plaque, steps, benches and shady trees.
const LIBRARY = { wall: '#e6dcc8', roof: '#4a7f86', trim: '#f7f1e3', shutter: '#4a7f86' };
function library(out, ctx) {
  const v = LIBRARY;
  const lctx = { ...ctx, v: { ...ctx.v, ...v, trim: '#f7f1e3' } };
  const b = block(0.7, 0.44, -0.1);
  const h = 0.3;
  const mid = (b.x1 - b.x0) / 2;
  const S = out.layers.stone;
  const pale = lin('#efe6d2');
  S.box(b.x0 - 0.015, 0, b.z0 - 0.015, b.x1 + 0.015, 0.04, b.z1 + 0.015, pale, { s: 6 });
  walls(out, b, 0.04, h, lin(v.wall), 'stone');
  S.box(b.x0 - 0.008, h - 0.02, b.z0 - 0.008, b.x1 + 0.008, h, b.z1 + 0.008, pale, { s: 6 });
  gableRoof(out, b, h, 0.16, { o: 0.05, col: lin(v.roof), wall: v.wall, endLayer: 'stone', timbered: false });
  // Tall windows either side of the portico, on the sides and back.
  for (const u of [0.08, 0.2, 0.5, 0.62]) windowAt(out, b, 0, u, 0.09, 0.07, 0.15, lctx);
  for (const face of [1, 3]) for (const u of [0.1, 0.22, 0.34]) windowAt(out, b, face, u, 0.09, 0.07, 0.15, lctx);
  for (const u of [0.12, 0.26, 0.44, 0.58]) windowAt(out, b, 2, u, 0.09, 0.07, 0.15, lctx);
  // The portico: four columns, a flat entablature, a pediment and a roof.
  const zf = b.z1 + 0.13;
  S.box(-0.2, 0, b.z1 - 0.01, 0.2, 0.03, zf + 0.015, pale, { s: 6 });
  S.box(-0.19, 0.03, b.z1 - 0.01, 0.19, 0.045, zf + 0.005, pale, { s: 6 });
  for (const x of [-0.165, -0.055, 0.055, 0.165]) {
    S.cyl(x, zf - 0.02, 0.022, 0.018, 0.045, 0.235, 8, pale, { s: 3 });
    S.box(x - 0.03, 0.045, zf - 0.05, x + 0.03, 0.058, zf + 0.01, pale, { s: 6 });
    S.box(x - 0.03, 0.235, zf - 0.05, x + 0.03, 0.25, zf + 0.01, pale, { s: 6 });
  }
  S.box(-0.2, 0.25, b.z1 - 0.01, 0.2, 0.275, zf + 0.015, pale, { s: 6 });
  const tc = lin(v.roof);
  out.layers.roof.nest(0, 0, 1, () => out.layers.timber.nest(0, 0, 1, () => {
    gableRoof(out, { x0: -zf - 0.015, x1: -b.z1 + 0.01, z0: -0.2, z1: 0.2 }, 0.275, 0.085, { o: 0.015, col: tc, wall: v.wall, ends: false });
  }));
  S.tri([-0.2, 0.275, zf + 0.015], [0.2, 0.275, zf + 0.015], [0, 0.36, zf + 0.015], pale, pale, pale, [-1, 0], [1, 0], [0, 0.4]);
  // Double doors behind the columns, a gold plaque with an open book above them.
  const f = wallFrame(b, 0);
  const W = out.layers.wood;
  wallRect(W, f, mid - 0.06, mid - 0.004, 0.045, 0.2, 0.005, lin('#2f5a4a'), 10);
  wallRect(W, f, mid + 0.004, mid + 0.06, 0.045, 0.2, 0.005, lin('#2f5a4a'), 10);
  archAt(out, 'wood', b, 0, mid, 0.2, 0.06, lin('#2f5a4a'));
  const P = out.layers.paint;
  wallRect(P, f, mid - 0.05, mid + 0.05, 0.262, 0.274, 0.006, lin('#c99a3a'));
  wallRect(P, f, mid - 0.034, mid - 0.003, 0.212, 0.248, 0.004, lin('#fbf7ee'));
  wallRect(P, f, mid + 0.003, mid + 0.034, 0.212, 0.248, 0.004, lin('#f1e8d2'));
  // Wide steps, benches, trees and a hedge.
  steps(out, 0, 0.36, zf + 0.015, 3, pale);
  bench(out, -0.3, b.z1 + 0.13, 0);
  bench(out, 0.3, b.z1 + 0.13, 0);
  hedge(out, ctx, -0.44, -0.36, b.z1 + 0.06);
  hedge(out, ctx, 0.36, 0.44, b.z1 + 0.06);
  schoolFence(out);
  lotGreens(out, ctx, [[-0.4, -0.38, 1, 0.55], [0.4, -0.38, 0, 0.55], [-0.42, 0.34, 3, 0.45]], [[0.4, 0.38, 0.06]]);
}

// The fire station: red brick with two arched garage doors, a hose tower with a bell and a pyramid
// roof, a little red engine out front and a lantern.
const FIRE = { wall: '#b5543f', roof: '#4b4f5e', trim: '#f4ecdc', shutter: '#3a3f4d' };
function firestation(out, ctx) {
  const v = FIRE;
  const fctx = { ...ctx, v: { ...ctx.v, ...v, trim: '#f4ecdc' } };
  const b = block(0.7, 0.4, -0.12);
  const h = 0.28;
  const S = out.layers.stone;
  const brick = lin(v.wall);
  const pale = lin('#e4d8c2');
  S.box(b.x0 - 0.015, 0, b.z0 - 0.015, b.x1 + 0.015, 0.035, b.z1 + 0.015, pale, { s: 6 });
  walls(out, b, 0.035, h, brick, 'stone');
  S.box(b.x0 - 0.008, 0.19, b.z0 - 0.008, b.x1 + 0.008, 0.2, b.z1 + 0.008, pale, { s: 6 });
  S.box(b.x0 - 0.008, h - 0.015, b.z0 - 0.008, b.x1 + 0.008, h, b.z1 + 0.008, pale, { s: 6 });
  gableRoof(out, b, h, 0.15, { o: 0.05, col: lin(v.roof), wall: v.wall, endLayer: 'stone', timbered: false });
  // Two arched engine doors with white frames and a window row above.
  const f = wallFrame(b, 0);
  const W = out.layers.wood;
  const door = lin('#a8362d');
  for (const u of [0.26, 0.5]) {
    wallRect(out.layers.paint, f, u - 0.088, u + 0.088, 0.035, 0.16, 0.004, lin('#f4ecdc'));
    archAt(out, 'paint', b, 0, u, 0.16, 0.088, lin('#f4ecdc'), 0.004);
    wallRect(W, f, u - 0.075, u + 0.075, 0.035, 0.16, 0.007, door, 10);
    archAt(out, 'wood', b, 0, u, 0.16, 0.075, door, 0.007);
    for (const k of [-0.035, 0, 0.035]) beam(out.layers.timber, f, u + k, 0.04, u + k, 0.2, 0.008, lin('#7d2a24'));
    windowAt(out, b, 0, u, 0.215, 0.07, 0.04, fctx);
  }
  doorAt(out, b, 0.12, 0.07, 0.13, fctx);
  windowAt(out, b, 0, 0.12, 0.2, 0.06, 0.05, fctx);
  for (const face of [1, 2, 3]) for (const u of face === 2 ? [0.14, 0.35, 0.56] : [0.12, 0.28]) windowAt(out, b, face, u, 0.1, 0.06, 0.08, fctx);
  // The gold shield over the doors.
  wallRect(out.layers.paint, f, 0.36, 0.4, 0.232, 0.268, 0.006, lin('#d9a93a'));
  // The hose tower at the back right: brick, an open belfry, a pyramid roof.
  const tw = 0.15;
  const tx0 = b.x1 - tw - 0.03;
  const tb = { x0: tx0, x1: tx0 + tw, z0: b.z0 + 0.02, z1: b.z0 + 0.02 + tw };
  walls(out, tb, 0.0, 0.5, brick, 'stone');
  S.box(tb.x0 - 0.01, 0.46, tb.z0 - 0.01, tb.x1 + 0.01, 0.5, tb.z1 + 0.01, pale, { s: 6 });
  for (const [x, z] of [[tb.x0, tb.z0], [tb.x1, tb.z0], [tb.x0, tb.z1], [tb.x1, tb.z1]]) S.box(x - 0.01, 0.5, z - 0.01, x + 0.01, 0.6, z + 0.01, pale, { s: 6 });
  S.box(tb.x0 - 0.01, 0.6, tb.z0 - 0.01, tb.x1 + 0.01, 0.62, tb.z1 + 0.01, pale, { s: 6 });
  const tcx = (tb.x0 + tb.x1) / 2;
  const tcz = (tb.z0 + tb.z1) / 2;
  out.layers.paint.cyl(tcx, tcz, 0.016, 0.028, 0.54, 0.585, 8, lin('#c99a3a'));
  out.layers.roof.cyl(tcx, tcz, 0.125, 0.002, 0.62, 0.74, 4, lin(v.roof), { a0: Math.PI / 4 });
  const T = out.layers.timber;
  T.box(tcx - 0.003, 0.74, tcz - 0.003, tcx + 0.003, 0.79, tcz + 0.003, lin('#2f2c30'));
  windowAt(out, tb, 0, tw / 2, 0.14, 0.04, 0.15, fctx);
  windowAt(out, tb, 0, tw / 2, 0.34, 0.04, 0.08, fctx);
  windowAt(out, tb, 1, tw / 2, 0.14, 0.04, 0.15, fctx);
  windowAt(out, tb, 3, tw / 2, 0.14, 0.04, 0.15, fctx);
  chimney(out, b.x0 + 0.1, b.z0 + 0.1, h + 0.04, h + 0.22);
  // A gravel apron and the engine parked on it.
  const D = out.layers.dirt;
  D.quad([-0.3, 0.006, 0.47], [0.44, 0.006, 0.47], [0.44, 0.006, b.z1 + 0.01], [-0.3, 0.006, b.z1 + 0.01], lin('#c9b997'), [[-0.3, -0.47], [0.44, -0.47], [0.44, -b.z1], [-0.3, -b.z1]]);
  const P = out.layers.paint;
  const red = lin('#c8392f');
  const ex = 0.31;
  const ez = b.z1 + 0.13;
  P.box(ex - 0.13, 0.03, ez - 0.045, ex + 0.05, 0.1, ez + 0.045, red, { s: 4 });
  P.box(ex + 0.05, 0.03, ez - 0.045, ex + 0.12, 0.13, ez + 0.045, red, { s: 4 });
  out.layers.glass.box(ex + 0.1, 0.09, ez - 0.04, ex + 0.121, 0.12, ez + 0.04, lin('#ffd98f'));
  P.box(ex - 0.13, 0.1, ez - 0.04, ex + 0.05, 0.105, ez + 0.04, lin('#d9d2c0'), { s: 4 });
  T.rod([ex - 0.12, 0.13, ez - 0.02], [ex + 0.04, 0.13, ez - 0.02], 0.012, lin('#e8e0cf'));
  T.rod([ex - 0.12, 0.13, ez + 0.02], [ex + 0.04, 0.13, ez + 0.02], 0.012, lin('#e8e0cf'));
  for (let i = 0; i < 6; i++) T.rod([ex - 0.11 + i * 0.03, 0.13, ez - 0.02], [ex - 0.11 + i * 0.03, 0.13, ez + 0.02], 0.007, lin('#e8e0cf'));
  for (const wx of [-0.09, 0.08]) for (const wz of [-0.05, 0.05]) T.box(ex + wx - 0.018, 0, ez + wz - 0.008, ex + wx + 0.018, 0.04, ez + wz + 0.008, lin('#2f2c30'));
  const [lx, lz] = P.tx(-0.44, b.z1 + 0.06);
  lantern(out, lx, lz);
  lotGreens(out, ctx, [[-0.4, -0.38, 0, 0.5]], [[-0.42, 0.4, 0.05]]);
  schoolFence(out);
}

// The university: a grand stone hall with two wings and a clock tower topped by a spire, pointed
// windows, a courtyard with a statue, trees and hedges.
const UNI = { wall: '#d9cdb7', roof: '#5b6a8c', trim: '#f4ecdc', shutter: '#5b6a8c' };
function university(out, ctx) {
  const v = UNI;
  const uctx = { ...ctx, v: { ...ctx.v, ...v, trim: '#f4ecdc' } };
  const b = block(0.86, 0.38, -0.2);
  const h = 0.3;
  const S = out.layers.stone;
  const wall = lin(v.wall);
  const pale = lin('#efe6d2');
  S.box(b.x0 - 0.015, 0, b.z0 - 0.015, b.x1 + 0.015, 0.04, b.z1 + 0.015, pale, { s: 6 });
  walls(out, b, 0.04, h, wall, 'stone');
  S.box(b.x0 - 0.008, h - 0.02, b.z0 - 0.008, b.x1 + 0.008, h, b.z1 + 0.008, pale, { s: 6 });
  S.box(b.x0 - 0.008, 0.16, b.z0 - 0.008, b.x1 + 0.008, 0.172, b.z1 + 0.008, pale, { s: 6 });
  gableRoof(out, b, h, 0.16, { o: 0.05, col: lin(v.roof), wall: v.wall, endLayer: 'stone', timbered: false });
  const mid = (b.x1 - b.x0) / 2;
  for (const du of [-0.32, -0.22, -0.12, 0.12, 0.22, 0.32]) {
    gothicAt(out, b, 0, mid + du, 0.06, 0.05, 0.075, uctx);
    gothicAt(out, b, 0, mid + du, 0.19, 0.05, 0.05, uctx);
  }
  for (const face of [1, 3]) for (const u of [0.1, 0.22, 0.34]) gothicAt(out, b, face, u, 0.1, 0.05, 0.1, uctx);
  for (const u of [0.1, 0.25, 0.4, 0.55, 0.7]) gothicAt(out, b, 2, u, 0.1, 0.05, 0.1, uctx);
  // The central tower: stone, an arched doorway, clock faces, a belfry and a slender spire.
  const tw = 0.24;
  const tb = { x0: -tw / 2, x1: tw / 2, z0: b.z1 - 0.06, z1: b.z1 + 0.1 };
  walls(out, tb, 0.04, 0.52, wall, 'stone');
  S.box(tb.x0 - 0.01, 0.0, tb.z0 - 0.01, tb.x1 + 0.01, 0.04, tb.z1 + 0.01, pale, { s: 6 });
  S.box(tb.x0 - 0.01, 0.5, tb.z0 - 0.01, tb.x1 + 0.01, 0.54, tb.z1 + 0.01, pale, { s: 6 });
  for (const [x, z] of [[tb.x0, tb.z0], [tb.x1, tb.z0], [tb.x0, tb.z1], [tb.x1, tb.z1]]) {
    for (let y = 0.04; y < 0.5; y += 0.06) S.box(x - 0.015, y, z - 0.015, x + 0.015, Math.min(0.5, y + 0.05), z + 0.015, pale, { s: 8 });
  }
  const f = wallFrame(tb, 0);
  const tmid = tw / 2;
  const door = lin('#4a3326');
  wallRect(out.layers.wood, f, tmid - 0.045, tmid + 0.045, 0.04, 0.15, 0.005, door, 10);
  archAt(out, 'wood', tb, 0, tmid, 0.15, 0.045, door, 0.005);
  gothicAt(out, tb, 0, tmid, 0.22, 0.05, 0.09, uctx);
  // Clock faces on all four sides.
  uniClock(out, tb);
  const tcx = 0;
  const tcz = (tb.z0 + tb.z1) / 2;
  out.layers.roof.cyl(tcx, tcz, 0.17, 0.002, 0.54, 0.84, 4, lin(v.roof), { a0: Math.PI / 4 });
  out.layers.timber.box(-0.003, 0.84, tcz - 0.003, 0.003, 0.9, tcz + 0.003, lin('#2f2c30'));
  out.layers.paint.box(-0.012, 0.87, tcz - 0.002, 0.012, 0.876, tcz + 0.002, lin('#c99a3a'));
  // Little corner turrets.
  for (const x of [b.x0 + 0.05, b.x1 - 0.05]) {
    S.cyl(x, b.z1 - 0.05, 0.045, 0.042, 0.04, h + 0.06, 8, wall, { s: 3 });
    out.layers.roof.cyl(x, b.z1 - 0.05, 0.058, 0.002, h + 0.06, h + 0.18, 8, lin(v.roof));
  }
  chimney(out, b.x0 + 0.2, b.z0 + 0.1, h + 0.05, h + 0.24);
  chimney(out, b.x1 - 0.2, b.z0 + 0.1, h + 0.05, h + 0.24);
  // Courtyard: flagstones, a statue on a plinth, hedges, benches and trees.
  const D = out.layers.dirt;
  D.quad([-0.38, 0.006, 0.47], [0.38, 0.006, 0.47], [0.38, 0.006, tb.z1 + 0.01], [-0.38, 0.006, tb.z1 + 0.01], lin('#d6c4a0'), [[-0.38, -0.47], [0.38, -0.47], [0.38, -tb.z1], [-0.38, -tb.z1]]);
  S.box(-0.035, 0, 0.3, 0.035, 0.05, 0.36, pale, { s: 6 });
  S.box(-0.022, 0.05, 0.312, 0.022, 0.11, 0.348, pale, { s: 6 });
  S.cyl(0, 0.33, 0.018, 0.012, 0.11, 0.17, 6, lin('#b9a98c'), { s: 3 });
  const [hx, hz] = out.layers.leaf.tx(0, 0.33);
  out.layers.leaf.blob(hx, 0.18, hz, 0.014, 0.014, 0.014, lin('#a89873'), lin('#c9bb9a'), 3, 0);
  bench(out, -0.24, 0.34, 0);
  bench(out, 0.24, 0.34, 0);
  hedge(out, ctx, -0.45, -0.38, 0.36, 0.035);
  hedge(out, ctx, 0.38, 0.45, 0.36, 0.035);
  lotGreens(out, ctx, [[-0.42, 0.18, 1, 0.5], [0.42, 0.18, 0, 0.5]], [[-0.4, 0.42, 0.05], [0.4, 0.42, 0.05]]);
}

// Clock faces, one on each side of the university tower.
function uniClock(out, tb) {
  const P = out.layers.paint;
  const T = out.layers.timber;
  for (let face = 0; face < 4; face++) {
    const f = wallFrame(tb, face);
    const u = f.w / 2;
    const cy = 0.4;
    const r = 0.05;
    const c = onWall(f, u, cy, 0.008);
    for (let i = 0; i < 10; i++) {
      const a0 = (i / 10) * Math.PI * 2;
      const a1 = ((i + 1) / 10) * Math.PI * 2;
      P.tri(c, onWall(f, u + Math.cos(a0) * r, cy + Math.sin(a0) * r, 0.008), onWall(f, u + Math.cos(a1) * r, cy + Math.sin(a1) * r, 0.008), lin('#fbf7ee'));
    }
    beam(T, f, u, cy, u, cy + r * 0.8, 0.007, lin('#2f2c30'));
    beam(T, f, u, cy, u + r * 0.55, cy - r * 0.2, 0.007, lin('#2f2c30'));
  }
}

// The factory: red brick sheds under a sawtooth roof of north-light glass, a tall banded chimney with
// smoke, a loading dock with crates, barrels and a water tank.
const FACTORY = { wall: '#b3624a', roof: '#6b6e7a', trim: '#f4ecdc', shutter: '#3a3f4d' };
function factory(out, ctx) {
  const v = FACTORY;
  const fctx = { ...ctx, v: { ...ctx.v, ...v, trim: '#e8dfce' } };
  const b = block(0.78, 0.6, -0.04);
  const h = 0.2;
  const S = out.layers.stone;
  const brick = lin(v.wall);
  const pale = lin('#d9ccb4');
  S.box(b.x0 - 0.012, 0, b.z0 - 0.012, b.x1 + 0.012, 0.03, b.z1 + 0.012, pale, { s: 6 });
  walls(out, b, 0.03, h, brick, 'stone');
  S.box(b.x0 - 0.006, h - 0.015, b.z0 - 0.006, b.x1 + 0.006, h, b.z1 + 0.006, pale, { s: 6 });
  // Sawtooth roof: four teeth sloping up toward +x with a glass face on the +x side.
  const n = 4;
  const tw = (b.x1 - b.x0) / n;
  const rise = 0.11;
  const R = out.layers.roof;
  const G = out.layers.glass;
  const dark = lin('#4a3326');
  const slate = lin(v.roof);
  for (let i = 0; i < n; i++) {
    const xa = b.x0 + i * tw;
    const xb = xa + tw;
    const za = b.z0 - 0.02;
    const zb = b.z1 + 0.02;
    const sl = Math.hypot(tw, rise);
    R.quad([xa, h, zb], [xb, h + rise, zb], [xb, h + rise, za], [xa, h, za], slate, [[za * 5, 0], [za * 5, sl * 5], [zb * 5, sl * 5], [zb * 5, 0]].map(([a, c]) => [c, a]), [mul(slate, 0.9), slate, slate, mul(slate, 0.9)]);
    G.quad([xb, h + rise, zb], [xb, h, zb], [xb, h, za], [xb, h + rise, za], lin('#86bccd'));
    // Gable fill on the front and back walls.
    S.tri([xa, h, b.z1], [xb, h, b.z1], [xb, h + rise, b.z1], brick, brick, brick, [xa * 5, h * 5], [xb * 5, h * 5], [xb * 5, (h + rise) * 5]);
    S.tri([xb, h, b.z0], [xa, h, b.z0], [xb, h + rise, b.z0], brick, brick, brick, [-xb * 5, h * 5], [-xa * 5, h * 5], [-xb * 5, (h + rise) * 5]);
    out.layers.timber.box(xb - 0.006, h + rise - 0.004, za, xb + 0.006, h + rise + 0.006, zb, dark, { s: 6 });
  }
  // Big roller doors and tall windows on the front, windows along the sides and back.
  const f = wallFrame(b, 0);
  for (const u of [0.2, 0.58]) {
    wallRect(out.layers.wood, f, u - 0.075, u + 0.075, 0.03, 0.15, 0.005, lin('#6a7a6e'), 12);
    for (let k = 1; k < 6; k++) beam(out.layers.timber, f, u - 0.075, 0.03 + k * 0.02, u + 0.075, 0.03 + k * 0.02, 0.005, lin('#55655a'));
    beam(out.layers.timber, f, u - 0.08, 0.03, u - 0.08, 0.155, 0.014, pale);
    beam(out.layers.timber, f, u + 0.08, 0.03, u + 0.08, 0.155, 0.014, pale);
    beam(out.layers.timber, f, u - 0.085, 0.155, u + 0.085, 0.155, 0.016, pale);
  }
  doorAt(out, b, 0.38, 0.06, 0.11, fctx);
  for (const u of [0.08, 0.68]) windowAt(out, b, 0, u, 0.06, 0.05, 0.09, fctx);
  for (const face of [1, 3]) for (const u of [0.1, 0.22, 0.34, 0.46]) windowAt(out, b, face, u, 0.06, 0.05, 0.09, fctx);
  for (const u of [0.1, 0.24, 0.38, 0.52, 0.66]) windowAt(out, b, 2, u, 0.06, 0.05, 0.09, fctx);
  // The chimney: tall brick with two pale bands, a rim, and smoke that never stops.
  const cx = b.x0 + 0.1;
  const cz = b.z0 - 0.07;
  S.cyl(cx, cz, 0.045, 0.028, 0, 0.58, 10, brick, { s: 3 });
  S.cyl(cx, cz, 0.046, 0.043, 0.2, 0.215, 10, pale);
  S.cyl(cx, cz, 0.036, 0.034, 0.4, 0.415, 10, pale);
  S.cyl(cx, cz, 0.034, 0.03, 0.57, 0.6, 10, pale);
  const [sx, sz] = S.tx(cx, cz);
  out.smoke.push({ x: sx, y: 0.64, z: sz, big: true });
  // The loading dock on the right: a raised platform with a canopy, crates and barrels.
  const W = out.layers.wood;
  S.box(b.x1, 0, b.z1 - 0.28, b.x1 + 0.1, 0.05, b.z1 - 0.02, lin('#b8ab94'), { s: 6 });
  W.box(b.x1 + 0.01, 0.05, b.z1 - 0.12, b.x1 + 0.06, 0.11, b.z1 - 0.06, lin('#b88a55'), { s: 8 });
  W.box(b.x1 + 0.065, 0.05, b.z1 - 0.2, b.x1 + 0.095, 0.095, b.z1 - 0.15, lin('#a87848'), { s: 8 });
  for (const [x, z] of [[0.28, b.z1 + 0.08], [0.36, b.z1 + 0.1]]) out.layers.paint.cyl(x, z, 0.028, 0.028, 0, 0.06, 8, lin('#7a5b3c'), { top: lin('#5d4730'), s: 2 });
  W.box(0.12, 0, b.z1 + 0.04, 0.2, 0.06, b.z1 + 0.11, lin('#b88a55'), { s: 8 });
  W.box(0.14, 0.06, b.z1 + 0.05, 0.19, 0.1, b.z1 + 0.1, lin('#c79a63'), { s: 8 });
  // A water tank on stilts at the back left.
  const T = out.layers.timber;
  const wx = b.x1 - 0.08;
  const wz = b.z0 - 0.05;
  for (const [dx, dz] of [[-0.03, -0.03], [0.03, -0.03], [-0.03, 0.03], [0.03, 0.03]]) T.box(wx + dx - 0.006, 0, wz + dz - 0.006, wx + dx + 0.006, 0.14, wz + dz + 0.006, lin('#4a3326'), { s: 6 });
  W.cyl(wx, wz, 0.045, 0.045, 0.14, 0.24, 10, lin('#a07a50'), { top: lin('#8a6a46'), s: 3 });
  out.layers.roof.cyl(wx, wz, 0.055, 0.003, 0.24, 0.3, 10, slate);
  // A little gravel yard and a tree or two.
  const D = out.layers.dirt;
  D.quad([-0.46, 0.006, 0.47], [0.46, 0.006, 0.47], [0.46, 0.006, b.z1 + 0.01], [-0.46, 0.006, b.z1 + 0.01], lin('#c3b08c'), [[-0.46, -0.47], [0.46, -0.47], [0.46, -b.z1], [-0.46, -b.z1]]);
  lotGreens(out, ctx, [[-0.42, 0.4, 2, 0.5]], [[0.42, 0.42, 0.05]]);
}

// The mall: a covered market hall — warm plaster, a glass lantern on the ridge, a front arcade under
// striped awnings, bunting and a few stalls out front.
const MALL = { wall: '#f1dcc0', roof: '#b9583f', trim: '#6b4630', shutter: '#5d8f86' };
const AWNING = ['#d94f4f', '#f8f4ec'];
function mall(out, ctx) {
  const v = MALL;
  const mctx = { ...ctx, v: { ...ctx.v, ...v } };
  const b = block(0.8, 0.52, -0.1);
  const h = 0.24;
  const S = out.layers.stone;
  S.box(b.x0 - 0.012, 0, b.z0 - 0.012, b.x1 + 0.012, 0.035, b.z1 + 0.012, lin(STONE), { s: 6 });
  walls(out, b, 0.035, h, lin(v.wall));
  timbering(out, b, 0.035, h, ctx, [1, 2, 3]);
  gableRoof(out, b, h, 0.16, { o: 0.05, col: lin(v.roof), wall: v.wall });
  // The glass lantern on the ridge.
  const zm = (b.z0 + b.z1) / 2;
  const ly = h + 0.16;
  out.layers.glass.box(-0.22, ly - 0.01, zm - 0.045, 0.22, ly + 0.05, zm + 0.045, lin('#86bccd'));
  const T = out.layers.timber;
  for (let i = 0; i <= 6; i++) T.box(-0.22 + i * 0.0733 - 0.004, ly - 0.01, zm - 0.047, -0.22 + i * 0.0733 + 0.004, ly + 0.05, zm + 0.047, lin(TIMBER));
  out.layers.roof.nest(0, 0, 1, () => T.nest(0, 0, 1, () => {
    gableRoof(out, { x0: -zm - 0.05, x1: -zm + 0.05, z0: -0.24, z1: 0.24 }, ly + 0.05, 0.05, { o: 0.015, col: lin(v.roof), wall: v.wall, ends: false });
  }));
  chimney(out, b.x0 + 0.1, b.z0 + 0.12, h + 0.04, h + 0.24);
  // The front arcade: six posts, awnings sloping down from the wall, and shop windows behind.
  const f = wallFrame(b, 0);
  const n = 6;
  const aw = (b.x1 - b.x0) / n;
  const zf = b.z1 + 0.1;
  const P = out.layers.paint;
  for (let i = 0; i < n; i++) {
    const xa = b.x0 + i * aw;
    const xb = xa + aw;
    const col = lin(AWNING[i % 2]);
    P.quad([xa, 0.16, b.z1], [xb, 0.16, b.z1], [xb, 0.115, zf], [xa, 0.115, zf], col, null, [mul(col, 0.9), mul(col, 0.9), col, col]);
    P.quad([xa, 0.115, zf], [xb, 0.115, zf], [xb, 0.1, zf], [xa, 0.1, zf], mul(col, 0.8));
    const u = (i + 0.5) * aw;
    windowAt(out, b, 0, u, 0.05, aw * 0.6, 0.09, mctx);
    windowAt(out, b, 0, u, 0.175, 0.05, 0.045, mctx);
  }
  for (let i = 0; i <= n; i++) T.box(b.x0 + i * aw - 0.007, 0, zf - 0.012, b.x0 + i * aw + 0.007, 0.115, zf + 0.002, lin('#efe6d6'), { s: 6 });
  // Entrance doors in the middle, a sign board above.
  doorAt(out, b, (b.x1 - b.x0) / 2, 0.07, 0.11, mctx);
  wallRect(out.layers.wood, f, 0.3, 0.5, 0.2, 0.225, 0.008, lin('#e9dfc6'), 10);
  wallRect(P, f, 0.31, 0.49, 0.205, 0.22, 0.01, lin('#b5483d'));
  for (const face of [1, 3]) for (const u of [0.1, 0.2, 0.3, 0.4]) windowAt(out, b, face, u, 0.07, 0.05, 0.08, mctx);
  for (const u of [0.12, 0.28, 0.44, 0.6, 0.72]) windowAt(out, b, 2, u, 0.07, 0.05, 0.08, mctx);
  // Bunting between the posts, and two market stalls out front.
  const bunt = ['#e0524d', '#f4c542', '#4f9ac4', '#f8f4ec', '#79b34e'];
  for (let i = 0; i < 12; i++) {
    const x = b.x0 + 0.03 + i * 0.062;
    const sag = Math.sin(((i + 0.5) / 12) * Math.PI) * 0.008;
    const c = lin(bunt[i % bunt.length]);
    P.tri([x, 0.125 - sag, zf + 0.012], [x + 0.03, 0.125 - sag, zf + 0.012], [x + 0.015, 0.1 - sag, zf + 0.012], c);
  }
  const W = out.layers.wood;
  for (const [sx, col] of [[-0.24, '#4f9ac4'], [0.1, '#79b34e']]) {
    const sz = zf + 0.12;
    W.box(sx - 0.07, 0, sz - 0.03, sx + 0.07, 0.045, sz + 0.03, lin('#a87848'), { s: 8 });
    for (const dx of [-0.065, 0.065]) T.box(sx + dx - 0.005, 0.045, sz - 0.03, sx + dx + 0.005, 0.12, sz - 0.02, lin('#efe6d6'));
    const c1 = lin(col);
    const c2 = lin('#f8f4ec');
    for (let k = 0; k < 4; k++) {
      const xa = sx - 0.075 + k * 0.0375;
      P.quad([xa, 0.12, sz - 0.03], [xa + 0.0375, 0.12, sz - 0.03], [xa + 0.0375, 0.09, sz + 0.045], [xa, 0.09, sz + 0.045], k % 2 ? c2 : c1);
    }
    const [fx, fz] = W.tx(sx, sz);
    for (let k = 0; k < 5; k++) out.flowers.push([fx - 0.05 + k * 0.025, 0.055, fz, 0.7, FLOWERS[(k + Math.round(sx * 10)) % FLOWERS.length]]);
  }
  const D = out.layers.dirt;
  D.quad([-0.46, 0.006, 0.47], [0.46, 0.006, 0.47], [0.46, 0.006, b.z1 + 0.01], [-0.46, 0.006, b.z1 + 0.01], lin('#d6c4a0'), [[-0.46, -0.47], [0.46, -0.47], [0.46, -b.z1], [-0.46, -b.z1]]);
  const [lx, lz] = P.tx(0.42, zf + 0.02);
  lantern(out, lx, lz);
  const [kx, kz] = P.tx(-0.42, zf + 0.02);
  lantern(out, kx, kz);
  lotGreens(out, ctx, [[-0.42, -0.4, 0, 0.5], [0.42, -0.4, 3, 0.5]], []);
}

// The sports field: mown stripes, white lines and a centre circle, goalposts, a small pavilion,
// bleachers, benches and a low fence.
function field(out, ctx) {
  const G = out.layers.grass;
  const L = 0.4;
  const A = lin('#8fc468');
  const B = lin('#7fb85c');
  const n = 8;
  for (let i = 0; i < n; i++) {
    const za = -L + (i * 2 * L) / n;
    const zb = za + (2 * L) / n;
    const c = i % 2 ? A : B;
    G.quad([-L, 0.004, zb], [L, 0.004, zb], [L, 0.004, za], [-L, 0.004, za], c, [[-L + ctx.x, -zb - ctx.y], [L + ctx.x, -zb - ctx.y], [L + ctx.x, -za - ctx.y], [-L + ctx.x, -za - ctx.y]]);
  }
  const P = out.layers.paint;
  const white = lin('#fbf7ee');
  const lw = 0.008;
  const y = 0.008;
  const strip = (x0, z0, x1, z1) => P.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], white);
  strip(-L, -L, L, -L + lw * 2);
  strip(-L, L - lw * 2, L, L);
  strip(-L, -L, -L + lw * 2, L);
  strip(L - lw * 2, -L, L, L);
  strip(-lw, -L, lw, L);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const a2 = ((i + 1) / 16) * Math.PI * 2;
    const r0 = 0.085;
    const r1 = 0.1;
    P.quad([c * r0, y, s * r0], [Math.cos(a2) * r0, y, Math.sin(a2) * r0], [Math.cos(a2) * r1, y, Math.sin(a2) * r1], [c * r1, y, s * r1], white);
  }
  // Goals at both ends: two posts and a crossbar, with a pale net behind.
  const T = out.layers.timber;
  for (const zz of [-L, L]) {
    const d = zz < 0 ? -1 : 1;
    for (const x of [-0.1, 0.1]) T.box(x - 0.01, 0, zz - 0.01, x + 0.01, 0.1, zz + 0.01, white);
    T.box(-0.107, 0.093, zz - 0.007, 0.107, 0.107, zz + 0.007, white);
    T.rod([-0.1, 0.1, zz], [-0.1, 0.004, zz + d * 0.05], 0.006, white);
    T.rod([0.1, 0.1, zz], [0.1, 0.004, zz + d * 0.05], 0.006, white);
    T.rod([-0.1, 0.004, zz + d * 0.05], [0.1, 0.004, zz + d * 0.05], 0.006, white);
  }
  // A pavilion at the right with a small porch, bleachers on the left.
  const hb = { x0: 0.19, x1: 0.35, z0: L + 0.02, z1: L + 0.11 };
  out.layers.plaster.box(hb.x0, 0, hb.z0, hb.x1, 0.07, hb.z1, lin('#f3dcbc'), { s: 3 });
  gableRoof(out, hb, 0.07, 0.05, { o: 0.015, col: lin('#b9583f'), wall: '#f3dcbc', timbered: false });
  windowAt(out, hb, 0, 0.04, 0.025, 0.035, 0.03, { ...ctx, v: { ...ctx.v, trim: '#6b4630', shutter: '#5d8f86' } });
  doorAt(out, hb, 0.12, 0.035, 0.055, { ...ctx, v: { ...ctx.v, trim: '#6b4630', shutter: '#5d8f86' } });
  const W = out.layers.wood;
  for (let i = 0; i < 3; i++) W.box(-0.34, i * 0.022, L + 0.03 + i * 0.022, -0.12, i * 0.022 + 0.016, L + 0.05 + i * 0.022, lin('#c79a63'), { s: 8 });
  for (const x of [-0.34, -0.12]) T.box(x - 0.006, 0, L + 0.03, x + 0.006, 0.06, L + 0.1, lin('#5b3d2b'));
  bench(out, -0.44, -0.1, 1);
  bench(out, -0.44, 0.1, 1);
  // A low fence behind the far goal and round the back.
  const pc = lin('#efe6d6');
  for (let i = 0; i <= 14; i++) {
    const x = -0.45 + (i * 0.9) / 14;
    W.box(x - 0.007, 0, -0.47, x + 0.007, 0.08, -0.457, pc, { s: 10 });
  }
  W.box(-0.46, 0.05, -0.472, 0.46, 0.06, -0.455, pc, { s: 10 });
  lotGreens(out, ctx, [[0.44, -0.3, 0, 0.5]], [[0.4, 0.3, 0.05]]);
}

// Rubble: what is left of a building — broken walls, tumbled stone, snapped beams, roof slates, a
// stump of chimney and weeds already pushing through.
function rubble(out, ctx) {
  const { x, y } = ctx;
  const S = out.layers.stone;
  const T = out.layers.timber;
  const R = out.layers.roof;
  const greys = ['#cfc5b6', '#b9ae9f', '#a89d8f', '#d8cfc0'];
  // A dusty patch of ground.
  const D = out.layers.dirt;
  D.quad([-0.38, 0.005, 0.38], [0.38, 0.005, 0.38], [0.38, 0.005, -0.38], [-0.38, 0.005, -0.38], lin('#a89880'), [[-0.38, -0.38], [0.38, -0.38], [0.38, 0.38], [-0.38, 0.38]]);
  // A broken stub of wall along the back, jagged on top.
  for (let i = 0; i < 6; i++) {
    const x0 = -0.3 + i * 0.1;
    const hh = 0.04 + rand(x, y, 300 + i) * 0.11;
    S.box(x0, 0, -0.32, x0 + 0.1, hh, -0.26, lin(greys[i % 4]), { s: 6 });
  }
  S.box(-0.3, 0, -0.32, -0.24, 0.12, 0.0, lin('#bdb2a2'), { s: 6 });
  // A leaning chimney stump.
  S.box(0.2, 0, -0.18, 0.28, 0.17, -0.1, lin('#b9a58c'), { s: 6 });
  S.box(0.21, 0.17, -0.17, 0.27, 0.2, -0.11, lin('#a8957d'), { s: 6 });
  // Tumbled blocks.
  for (let i = 0; i < 12; i++) {
    const cx = (rand(x, y, 310 + i) - 0.5) * 0.62;
    const cz = -0.1 + rand(x, y, 320 + i) * 0.48;
    const w = 0.03 + rand(x, y, 330 + i) * 0.05;
    const hh = 0.025 + rand(x, y, 340 + i) * 0.045;
    S.box(cx - w, 0, cz - w * 0.7, cx + w, hh, cz + w * 0.7, lin(greys[i % 4]), { s: 6 });
  }
  // Snapped beams and planks at all angles.
  for (let i = 0; i < 6; i++) {
    const cx = (rand(x, y, 350 + i) - 0.5) * 0.5;
    const cz = -0.05 + rand(x, y, 360 + i) * 0.4;
    const a = rand(x, y, 370 + i) * Math.PI;
    const l = 0.08 + rand(x, y, 380 + i) * 0.1;
    const lift = i % 2 ? 0.05 : 0.02;
    T.rod([cx - Math.cos(a) * l, 0.015, cz - Math.sin(a) * l], [cx + Math.cos(a) * l, lift + 0.02, cz + Math.sin(a) * l], 0.016, lin(i % 3 ? '#6b4a33' : '#8a6a46'));
  }
  // A few fallen roof slates.
  for (let i = 0; i < 5; i++) {
    const cx = (rand(x, y, 390 + i) - 0.5) * 0.5;
    const cz = 0.05 + rand(x, y, 400 + i) * 0.3;
    const a = rand(x, y, 410 + i) * Math.PI * 2;
    const w = 0.035;
    const ca = Math.cos(a) * w;
    const sa = Math.sin(a) * w;
    R.quad([cx - ca, 0.03, cz - sa], [cx + sa, 0.04, cz - ca], [cx + ca, 0.03, cz + sa], [cx - sa, 0.02, cz + ca], lin(i % 2 ? '#b9583f' : '#4f7f7a'));
  }
  // Weeds and a few brave flowers.
  for (let i = 0; i < 14; i++) {
    const [wx, wz] = S.tx((rand(x, y, 420 + i) - 0.5) * 0.8, (rand(x, y, 430 + i) - 0.5) * 0.8);
    out.tufts.push([wx, wz, 0.9, i % 2 ? '#6b8f3a' : '#8a9a4a']);
  }
  const [fx, fz] = S.tx(-0.15, 0.2);
  out.flowers.push([fx, 0.03, fz, 0.7, '#ffd166'], [fx + 0.04, 0.03, fz + 0.02, 0.7, '#f8f4ec']);
}

const MORE = buildersMore({ lin, mul, rand, block, walls, windowAt, doorAt, gableRoof, chimney, garden, bench, storyTree, bushWorld, flowerPatch, wallFrame, wallRect, beam, onWall, archAt, gablePorch, steps, lotGreens, hedge, schoolFence, lantern, timbering, STONE, TIMBER, FLOWERS });

const BUILDERS = {
  house,
  cottage,
  apartments: townhouse,
  tower: townhouse,
  office: townhouse,
  shop: shopfront,
  cafe: shopfront,
  bakery: shopfront,
  tree: treeTile,
  park,
  school,
  playground,
  clinic,
  library,
  firestation,
  university,
  factory,
  mall,
  field,
  rubble,
  ...MORE,
};
export const STORY_TYPES = Object.keys(BUILDERS);
