// Geometry for the 3D view, built straight into flat arrays (positions, normals, colours) so a whole
// chunk of the town becomes one mesh and one draw call. Shapes are placed in a building's own frame
// (its front facing +z) and turned to face the street. No Three.js in here, so it runs in Node tests.
//
// Axes: x is the map's x, z is the map's y, y is up. One map tile is one unit.

const LIN = new Map();
// A '#rrggbb' colour as linear-light [r, g, b] (what Three.js expects in vertex colours).
export function linear(hex) {
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

export const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
export const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export class MeshData {
  constructor() {
    // Growable typed arrays: positions, normals and colours, 3 floats per vertex; `n` floats in use.
    this._p = new Float32Array(3 * 2048);
    this._q = new Float32Array(3 * 2048);
    this._c = new Float32Array(3 * 2048);
    this.n = 0;
    this.place(0, 0, 0);
  }

  get vertices() {
    return this.n / 3;
  }

  // Views of what has been built so far (valid until more is added).
  get pos() {
    return this._p.subarray(0, this.n);
  }
  get nor() {
    return this._q.subarray(0, this.n);
  }
  get col() {
    return this._c.subarray(0, this.n);
  }

  // Put the next shapes at tile-centre (cx, cz), turned `r` quarter turns (0: front faces +z/south,
  // 1: east, 2: north, 3: west).
  place(cx, cz, r = 0) {
    this.cx = cx;
    this.cz = cz;
    this.r = r & 3;
    return this;
  }

  tx(x, z) {
    switch (this.r) {
      case 1:
        return [this.cx + z, this.cz - x];
      case 2:
        return [this.cx - x, this.cz - z];
      case 3:
        return [this.cx - z, this.cz + x];
      default:
        return [this.cx + x, this.cz + z];
    }
  }

  grow() {
    const size = this._p.length * 2;
    for (const k of ['_p', '_q', '_c']) {
      const a = new Float32Array(size);
      a.set(this[k]);
      this[k] = a;
    }
  }

  // One triangle with a flat normal; colours per corner (ca, cb, cc) or one for all.
  tri(a, b, c, ca, cb = ca, cc = ca) {
    const r = this.r;
    const ox = this.cx;
    const oz = this.cz;
    // Turn and place the three corners (inline: this runs a few hundred thousand times per town).
    const X = (x, z) => (r === 0 ? ox + x : r === 1 ? ox + z : r === 2 ? ox - x : ox - z);
    const Z = (x, z) => (r === 0 ? oz + z : r === 1 ? oz - x : r === 2 ? oz - z : oz + x);
    const ax = X(a[0], a[2]);
    const az = Z(a[0], a[2]);
    const bx = X(b[0], b[2]);
    const bz = Z(b[0], b[2]);
    const qx = X(c[0], c[2]);
    const qz = Z(c[0], c[2]);
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
    if (l < 1e-12) return; // no area (e.g. where a hip roof's ridge shrinks to a point)
    nx /= l;
    ny /= l;
    nz /= l;
    if (this.n + 9 > this._p.length) this.grow();
    const i = this.n;
    const P = this._p;
    const Q = this._q;
    const C = this._c;
    P[i] = ax;
    P[i + 1] = a[1];
    P[i + 2] = az;
    P[i + 3] = bx;
    P[i + 4] = b[1];
    P[i + 5] = bz;
    P[i + 6] = qx;
    P[i + 7] = c[1];
    P[i + 8] = qz;
    for (let k = 0; k < 9; k += 3) {
      Q[i + k] = nx;
      Q[i + k + 1] = ny;
      Q[i + k + 2] = nz;
    }
    C[i] = ca[0];
    C[i + 1] = ca[1];
    C[i + 2] = ca[2];
    C[i + 3] = cb[0];
    C[i + 4] = cb[1];
    C[i + 5] = cb[2];
    C[i + 6] = cc[0];
    C[i + 7] = cc[1];
    C[i + 8] = cc[2];
    this.n = i + 9;
  }

  // A quad a-b-c-d, counter-clockwise seen from the front. `lo` colours a and b (the bottom edge of a
  // wall), so walls darken a little toward the ground.
  quad(a, b, c, d, color, lo = color) {
    this.tri(a, b, c, lo, lo, color);
    this.tri(a, c, d, lo, color, color);
  }

  // An axis-aligned box. opts: top (colour or false), bottom (bool), ao (how dark the foot of the walls is),
  // sides: which walls to draw ([+z, +x, -z, -x]).
  box(x0, y0, z0, x1, y1, z1, color, { top = color, bottom = false, ao = 0.84, sides = null } = {}) {
    const lo = ao === 1 ? color : shade(color, ao);
    const s = sides || [true, true, true, true];
    if (s[0]) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], color, lo);
    if (s[1]) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], color, lo);
    if (s[2]) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], color, lo);
    if (s[3]) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], color, lo);
    if (top) this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], top);
    if (bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], color);
    return this;
  }

  // A flat rectangle facing up at height y.
  flat(x0, z0, x1, z1, y, color) {
    this.quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], color);
    return this;
  }

  // A gable roof over x0..x1 × z0..z1 from eave height y, rising `rise`, overhanging by `o`.
  // The ridge runs along x (along z when alongZ). Gable ends are filled with `wall`.
  gable(x0, z0, x1, z1, y, rise, roof, wall, { o = 0.04, alongZ = false } = {}) {
    if (alongZ) {
      // Same roof turned a quarter: build it in a swapped frame.
      const r = this.r;
      this.r = (r + 1) & 3;
      this.gable(-z1, x0, -z0, x1, y, rise, roof, wall, { o });
      this.r = r;
      return this;
    }
    const zm = (z0 + z1) / 2;
    const top = y + rise;
    const under = shade(roof, 0.55);
    const roofLo = shade(roof, 0.9);
    // South and north slopes, each with an underside so the eaves look solid from the street.
    this.quad([x0 - o, y, z1 + o], [x1 + o, y, z1 + o], [x1 + o, top, zm], [x0 - o, top, zm], roof, roofLo);
    this.quad([x1 + o, y, z0 - o], [x0 - o, y, z0 - o], [x0 - o, top, zm], [x1 + o, top, zm], roof, roofLo);
    this.quad([x0 - o, top, zm], [x1 + o, top, zm], [x1 + o, y, z1 + o], [x0 - o, y, z1 + o], under);
    this.quad([x1 + o, top, zm], [x0 - o, top, zm], [x0 - o, y, z0 - o], [x1 + o, y, z0 - o], under);
    this.tri([x1, y, z1], [x1, y, z0], [x1, top, zm], wall);
    this.tri([x0, y, z0], [x0, y, z1], [x0, top, zm], wall);
    return this;
  }

  // A hipped roof: four slopes up to a short ridge (a pyramid when the footprint is square).
  hip(x0, z0, x1, z1, y, rise, roof, { o = 0.04 } = {}) {
    const top = y + rise;
    const w = x1 - x0;
    const d = z1 - z0;
    const inset = Math.min(w, d) / 2;
    const rx0 = x0 + inset;
    const rx1 = x1 - inset;
    const rz0 = z0 + (d > w ? inset : d / 2);
    const rz1 = z1 - (d > w ? inset : d / 2);
    const lo = shade(roof, 0.9);
    const A = [x0 - o, y, z1 + o];
    const B = [x1 + o, y, z1 + o];
    const C = [x1 + o, y, z0 - o];
    const D = [x0 - o, y, z0 - o];
    const p = [rx0, top, rz1];
    const q = [rx1, top, rz1];
    const r = [rx1, top, rz0];
    const s = [rx0, top, rz0];
    this.quad(A, B, q, p, roof, lo);
    this.quad(B, C, r, q, shade(roof, 0.96), shade(lo, 0.96));
    this.quad(C, D, s, r, roof, lo);
    this.quad(D, A, p, s, shade(roof, 0.96), shade(lo, 0.96));
    return this;
  }

  // An upright prism (cylinder or cone) with `n` sides, centred on (x, z).
  prism(x, z, r0, r1, y0, y1, n, color, { top = color, ao = 0.85 } = {}) {
    const lo = shade(color, ao);
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      const p0 = [x + Math.cos(a0) * r0, y0, z + Math.sin(a0) * r0];
      const p1 = [x + Math.cos(a1) * r0, y0, z + Math.sin(a1) * r0];
      const q1 = [x + Math.cos(a1) * r1, y1, z + Math.sin(a1) * r1];
      const q0 = [x + Math.cos(a0) * r1, y1, z + Math.sin(a0) * r1];
      if (r1 > 1e-4) this.quad(p1, p0, q0, q1, color, lo);
      else this.tri(p1, p0, q0, lo, lo, color);
      if (top && r1 > 1e-4) this.tri([x, y1, z], q1, q0, top);
    }
    return this;
  }

  // A rough ball of leaves: a squashed octahedron-based blob with `seed` jitter.
  blob(x, y, z, rx, ry, color, light = color, seed = 0) {
    const pts = [];
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + seed;
      const j = 0.85 + 0.3 * fract(Math.sin(seed * 12.9 + i * 78.2) * 43758.5);
      pts.push([x + Math.cos(a) * rx * j, y, z + Math.sin(a) * rx * j]);
    }
    const topP = [x, y + ry, z];
    const botP = [x, y - ry * 0.75, z];
    const up = [x, y + ry * 0.45, z];
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const ma = [(a[0] + up[0]) / 2 + (a[0] - x) * 0.25, up[1], (a[2] + up[2]) / 2 + (a[2] - z) * 0.25];
      const mb = [(b[0] + up[0]) / 2 + (b[0] - x) * 0.25, up[1], (b[2] + up[2]) / 2 + (b[2] - z) * 0.25];
      this.quad(b, a, ma, mb, color, shade(color, 0.92));
      this.tri(mb, ma, topP, light);
      this.tri(a, b, botP, shade(color, 0.75));
    }
    return this;
  }

  arrays() {
    return {
      position: this._p.slice(0, this.n),
      normal: this._q.slice(0, this.n),
      color: this._c.slice(0, this.n),
    };
  }
}

function fract(v) {
  return v - Math.floor(v);
}
