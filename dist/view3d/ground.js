// The ground of one chunk of the town in 3D: grass, park lawns, sand, sports fields, river beds and
// banks, the diorama's earthy sides at the map edge, and the streets: asphalt (or a dirt lane or
// cobbles in older eras), raised sidewalks with kerbs on the same edges the overhead view draws them,
// lane markings, the zebra crossings people use (sidewalks.js) and street lamps at the kerb.
// Pure: no Three.js, so it can be tested in Node.

import { linear, shade, mix } from './mesh.js';

export const WATER_Y = -0.05;
const BED_Y = -0.16;
const SLAB = 0.55; // how deep the diorama's sides go
const KERB = 0.02; // sidewalk height
const SIDE = [
  // For each side N, E, S, W: the edge's two corners (as tile fractions) and the inward normal.
  { a: [0, 0], b: [1, 0], n: [0, 1] },
  { a: [1, 0], b: [1, 1], n: [-1, 0] },
  { a: [1, 1], b: [0, 1], n: [0, -1] },
  { a: [0, 1], b: [0, 0], n: [1, 0] },
];
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

// A point on side s of tile (x, y): u along the edge (0..1), v inward from it.
function at(x, y, s, u, v) {
  const e = SIDE[s];
  return [x + e.a[0] + (e.b[0] - e.a[0]) * u + e.n[0] * v, y + e.a[1] + (e.b[1] - e.a[1]) * u + e.n[1] * v];
}

// A flat strip along side s from u0..u1, v0..v1 at height y, facing up.
function strip(md, x, y, s, u0, u1, v0, v1, h, color) {
  const p = [at(x, y, s, u0, v0), at(x, y, s, u1, v0), at(x, y, s, u1, v1), at(x, y, s, u0, v1)];
  // Make it face up whatever the side's winding.
  const cross = (p[1][0] - p[0][0]) * (p[3][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[3][0] - p[0][0]);
  const q = p.map(([px, pz]) => [px, h, pz]);
  if (cross > 0) md.quad(q[0], q[3], q[2], q[1], color);
  else md.quad(q[0], q[1], q[2], q[3], color);
}

// A raised slab (sidewalk) along side s, with its kerb face toward the road.
function slab(md, x, y, s, u0, u1, v1, top, kerb) {
  strip(md, x, y, s, u0, u1, 0, v1, KERB, top);
  const a = at(x, y, s, u0, v1);
  const b = at(x, y, s, u1, v1);
  // The kerb faces inward (toward the road), i.e. along the side's normal.
  const n = SIDE[s].n;
  const fx = b[0] - a[0];
  const fz = b[1] - a[1];
  // Pick the winding whose normal matches n.
  const nx = -fz;
  const nz = fx;
  const p0 = [a[0], 0, a[1]];
  const p1 = [b[0], 0, b[1]];
  const p2 = [b[0], KERB, b[1]];
  const p3 = [a[0], KERB, a[1]];
  if (nx * n[0] + nz * n[1] > 0) md.quad(p0, p1, p2, p3, kerb);
  else md.quad(p1, p0, p3, p2, kerb);
}

// ctx: grass(hex), snow (0..1), era, roadMask/crossMask per tile, lamp(t), hash(x, y, k), palette.
export function buildGround(out, city, x0, y0, x1, y1, ctx) {
  const g = out.ground;
  const P = ctx.palette;
  const snow = ctx.snow;
  const snowy = (hex, k = 0.8) => (snow ? mix(linear(hex), linear('#f3f6f9'), snow * k) : linear(hex));
  const earth = linear('#d2b89c');
  const earthDark = linear('#b09379');
  const W = city.width;
  const H = city.height;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const t = city.getTile(x, y);
      const s = t.structure;
      const n = (k) => ctx.hash(x, y, k);
      if (t.terrain === 'water') {
        g.flat(x, y, x + 1, y + 1, BED_Y, linear('#6fb3cc'));
        out.water.flat(x, y, x + 1, y + 1, WATER_Y, linear(P.water));
      } else if (s?.type === 'road') {
        road(out, city, t, ctx, snowy);
      } else {
        let c;
        const type = s?.type;
        if (type === 'park') c = linear(ctx.grass(P.parkGrass));
        else if (type === 'playground') c = snowy('#f3e3c3');
        else if (type === 'field') c = linear(ctx.grass('#9fd39a'));
        else c = linear(ctx.grass(P.grass));
        c = shade(c, 0.97 + n(2) * 0.05);
        if (type === 'field') {
          // Mown stripes.
          for (let i = 0; i < 4; i++) g.flat(x, y + i / 4, x + 1, y + (i + 1) / 4, 0, shade(c, i % 2 ? 0.95 : 1.03));
        } else g.flat(x, y, x + 1, y + 1, 0, c);
        // Wild flowers on open meadow.
        if (!s && !snow && n(9) < 0.3) {
          const flowers = ['#fff4f7', '#ffd3df', '#fff0b3', '#e2d3f5'];
          for (let i = 0; i < 5; i++) {
            const fx = x + 0.1 + n(10 + i) * 0.8;
            const fz = y + 0.1 + n(20 + i) * 0.8;
            g.flat(fx - 0.012, fz - 0.012, fx + 0.012, fz + 0.012, 0.003, linear(flowers[i % 4]));
          }
        }
      }
      // River banks and the diorama's sides.
      if (t.terrain !== 'water') {
        for (let sd = 0; sd < 4; sd++) {
          const nx = x + DX[sd];
          const ny = y + DY[sd];
          const nb = city.getTile(nx, ny);
          if (nb && nb.terrain === 'water') bank(g, x, y, sd, 0, BED_Y, earth);
          else if (!nb) bank(g, x, y, sd, 0, -SLAB, earthDark, true);
        }
      } else {
        for (let sd = 0; sd < 4; sd++) if (!city.getTile(x + DX[sd], y + DY[sd])) bank(g, x, y, sd, BED_Y, -SLAB, earthDark, true);
      }
    }
  }
  return W && H;
}

// A vertical face on side s of tile (x, y), from height top down to bottom, facing out of the tile.
function bank(md, x, y, s, top, bottom, color, edge = false) {
  const e = SIDE[s];
  const a = [x + e.a[0], y + e.a[1]];
  const b = [x + e.b[0], y + e.b[1]];
  const lo = shade(color, 0.85);
  // Outward normal is -n.
  const p0 = [a[0], bottom, a[1]];
  const p1 = [b[0], bottom, b[1]];
  const p2 = [b[0], top, b[1]];
  const p3 = [a[0], top, a[1]];
  const fx = b[0] - a[0];
  const fz = b[1] - a[1];
  const nx = -fz;
  const nz = fx;
  const out = nx * -e.n[0] + nz * -e.n[1] > 0;
  if (out) md.quad(p0, p1, p2, p3, color, lo);
  else md.quad(p1, p0, p3, p2, color, lo);
  if (edge && top === 0) {
    // A strip of grass lip and a darker band of soil, like the overhead view's slab.
    const lip = shade(color, 1.18);
    const q0 = [a[0], -0.05, a[1]];
    const q1 = [b[0], -0.05, b[1]];
    const q2 = [b[0], -0.001, b[1]];
    const q3 = [a[0], -0.001, a[1]];
    const offset = (p) => [p[0] - e.n[0] * 0.002, p[1], p[2] - e.n[1] * 0.002];
    if (out) md.quad(offset(q0), offset(q1), offset(q2), offset(q3), lip);
    else md.quad(offset(q1), offset(q0), offset(q3), offset(q2), lip);
  }
}

function road(out, city, t, ctx, snowy) {
  const g = out.ground;
  const { x, y } = t;
  const m = t.roadMask;
  const era = ctx.era;
  const P = ctx.palette;
  const dirt = era === 0;
  const old = era < 2;
  const asphalt = snowy(dirt ? '#dcc59e' : old ? '#cfc5b6' : '#b7b2b9', t.structure.snowed ? 0.95 : 0.35);
  g.flat(x, y, x + 1, y + 1, 0, shade(asphalt, 0.985 + ctx.hash(x, y, 2) * 0.03));
  const walkW = dirt ? 0.13 : old ? 0.12 : 0.15;
  const top = dirt ? linear(ctx.grass(P.grass)) : snowy(P.sidewalk, 0.6);
  const kerb = dirt ? shade(top, 0.9) : snowy('#d9d1c4', 0.5);
  for (let s = 0; s < 4; s++) {
    if (m & (1 << s)) continue;
    if (dirt) strip(g, x, y, s, 0, 1, 0, walkW, 0.002, top);
    else slab(g, x, y, s, 0, 1, walkW, top, kerb);
  }
  // Where two arms meet, the sidewalks join in a square at the corner.
  for (let c = 0; c < 4; c++) {
    const a = 1 << c;
    const b = 1 << ((c + 3) % 4);
    if (!(m & a) || !(m & b)) continue;
    const cx = c === 1 || c === 2 ? x + 1 - walkW : x;
    const cz = c >= 2 ? y + 1 - walkW : y;
    if (dirt) g.flat(cx, cz, cx + walkW, cz + walkW, 0.002, top);
    else {
      g.box(cx, 0, cz, cx + walkW, KERB, cz + walkW, kerb, { top, ao: 1 });
    }
  }
  if (!old && !t.structure.snowed) {
    // Dashed centre lines along the connections, and zebra crossings.
    const mark = linear(P.marking);
    const cx = x + 0.5;
    const cz = y + 0.5;
    const dash = (ax, az, bx, bz) => {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(len / 0.22));
      for (let i = 0; i < n; i++) {
        const t0 = (i + 0.25) / n;
        const t1 = (i + 0.75) / n;
        const px0 = ax + (bx - ax) * t0;
        const pz0 = az + (bz - az) * t0;
        const px1 = ax + (bx - ax) * t1;
        const pz1 = az + (bz - az) * t1;
        const hx = Math.abs(px1 - px0) > 1e-6 ? 0 : 0.012;
        const hz = hx ? 0 : 0.012;
        g.flat(Math.min(px0, px1) - hx, Math.min(pz0, pz1) - hz, Math.max(px0, px1) + hx, Math.max(pz0, pz1) + hz, 0.003, mark);
      }
    };
    const mids = [
      [cx, y],
      [x + 1, cz],
      [cx, y + 1],
      [x, cz],
    ];
    if (m === 5) dash(cx, y, cx, y + 1);
    else if (m === 10) dash(x, cz, x + 1, cz);
    else for (let s = 0; s < 4; s++) if (m & (1 << s)) dash(cx, cz, mids[s][0], mids[s][1]);
    const zebra = ctx.crossMask(x, y) & m;
    for (let s = 0; s < 4; s++) {
      if (!(zebra & (1 << s))) continue;
      for (let k = 0; k < 6; k++) {
        const u0 = 0.19 + k * 0.11;
        strip(g, x, y, s, u0, u0 + 0.06, 0.02, 0.14, 0.004, mark);
      }
    }
  }
  if (t.structure.broken) {
    // Washed out: a muddy hole with water in it.
    g.flat(x + 0.25, y + 0.3, x + 0.75, y + 0.7, 0.002, linear('#9a8a78'));
    out.water.flat(x + 0.32, y + 0.36, x + 0.68, y + 0.64, 0.006, linear(P.water));
  }
  // A street lamp at the kerb (the same ones the overhead view draws).
  const lamp = ctx.lamp(t);
  if (lamp) {
    const pole = linear(old ? '#4e4a5e' : P.pole);
    const h = old ? 0.24 : 0.32;
    out.solid.place(0, 0, 0);
    out.solid.box(lamp.gx - 0.008, 0, lamp.gy - 0.008, lamp.gx + 0.008, h, lamp.gy + 0.008, pole);
    out.glow.place(0, 0, 0);
    if (old) out.glow.box(lamp.gx - 0.02, h, lamp.gy - 0.02, lamp.gx + 0.02, h + 0.045, lamp.gy + 0.02, linear(P.lampOn));
    else {
      out.solid.box(lamp.gx - 0.03, h - 0.005, lamp.gy - 0.012, lamp.gx + 0.03, h + 0.012, lamp.gy + 0.012, pole);
      out.glow.box(lamp.gx - 0.026, h - 0.016, lamp.gy - 0.01, lamp.gx + 0.026, h - 0.005, lamp.gy + 0.01, linear(P.lampOn));
    }
    out.lamps.push({ x: lamp.gx, y: h, z: lamp.gy });
  }
}
