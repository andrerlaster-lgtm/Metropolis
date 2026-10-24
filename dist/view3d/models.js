// 3D models for every kind of building, tree and park, made from simple shapes in the same pastel
// colours as the overhead view: pitched and hipped roofs, windows with frames (some lit at night),
// doors facing the street, awnings, chimneys, balconies, rooftop details. Built into the chunk's
// MeshData sets: `solid` (walls, roofs, props), `glass` (dark windows), `lit` (windows that glow at
// night) and `glow` (lamp heads, signs). Pure: no Three.js, so every type can be checked in Node.

import { linear, shade, mix } from './mesh.js';

const GLASS = '#93acc0';
const DOOR = '#8a6a55';
const STONE = '#e9e2d8';
const GRAVEL = '#d7d1ca';
const FLOOR = 0.24; // height of one storey

// Window and door quads on one wall of a block, laid out left to right as seen from outside.
// face: 0 front (+z), 1 right (+x), 2 back (-z), 3 left (-x). u0..u1 across the wall (0..1), v0..v1 up.
export function faceQuad(md, face, b, u0, u1, v0, v1, e, color) {
  const L = (a, c, u) => a + (c - a) * u;
  if (face === 0) {
    const z = b.z1 + e;
    const xa = L(b.x0, b.x1, u0);
    const xb = L(b.x0, b.x1, u1);
    md.quad([xa, v0, z], [xb, v0, z], [xb, v1, z], [xa, v1, z], color);
  } else if (face === 2) {
    const z = b.z0 - e;
    const xa = L(b.x1, b.x0, u0);
    const xb = L(b.x1, b.x0, u1);
    md.quad([xa, v0, z], [xb, v0, z], [xb, v1, z], [xa, v1, z], color);
  } else if (face === 1) {
    const x = b.x1 + e;
    const za = L(b.z1, b.z0, u0);
    const zb = L(b.z1, b.z0, u1);
    md.quad([x, v0, za], [x, v0, zb], [x, v1, zb], [x, v1, za], color);
  } else {
    const x = b.x0 - e;
    const za = L(b.z0, b.z1, u0);
    const zb = L(b.z0, b.z1, u1);
    md.quad([x, v0, za], [x, v0, zb], [x, v1, zb], [x, v1, za], color);
  }
}

const faceWidth = (b, face) => (face % 2 === 0 ? b.x1 - b.x0 : b.z1 - b.z0);

// Rows of framed windows on the given faces, one row per storey from y0. Some windows light up at
// night, more of them the fuller the building is.
function windows(o, b, faces, y0, floors, ctx, { floorH = FLOOR, spacing = 0.15, w = 0.5, h = 0.48, frame, skipDoor = false, seed = 0, band = false }) {
  const trim = linear(frame || '#ffffff');
  for (const face of faces) {
    const width = faceWidth(b, face);
    const cols = Math.max(1, Math.round(width / spacing));
    for (let f = 0; f < floors; f++) {
      const yb = y0 + f * floorH + floorH * (0.5 - h / 2);
      const yt = yb + floorH * h;
      if (band) {
        // One long strip of glass per storey (offices, shop fronts).
        faceQuad(o.solid, face, b, 0.04, 0.96, yb - 0.012, yt + 0.012, 0.002, trim);
        const litW = ctx.hash(seed + f, face, 3) < ctx.occupancy;
        faceQuad(litW ? o.lit : o.glass, face, b, 0.06, 0.94, yb, yt, 0.004, linear(GLASS));
        continue;
      }
      for (let c = 0; c < cols; c++) {
        if (skipDoor && face === 0 && f === 0 && cols > 2 && c === Math.floor(cols / 2)) continue;
        const cu = (c + 0.5) / cols;
        const hw = (w / cols) * 0.5;
        faceQuad(o.solid, face, b, cu - hw - 0.012 / width, cu + hw + 0.012 / width, yb - 0.012, yt + 0.012, 0.002, trim);
        const litW = ctx.hash(seed * 13 + c, f * 7 + face, 5) < ctx.occupancy;
        faceQuad(litW ? o.lit : o.glass, face, b, cu - hw, cu + hw, yb, yt, 0.004, linear(GLASS));
      }
    }
  }
}

// Where smoke rises from: a chimney top, in world coordinates.
function smokeFrom(o, x, y, z, big) {
  if (!o.smoke) return;
  const [wx, wz] = o.solid.tx(x, z);
  o.smoke.push({ x: wx, y, z: wz, big });
}

function door(o, b, u = 0.5, w = 0.14, hgt = 0.15, color = DOOR) {
  const width = b.x1 - b.x0;
  const hw = w / width / 2;
  faceQuad(o.solid, 0, b, u - hw - 0.02 / width, u + hw + 0.02 / width, 0, hgt + 0.02, 0.002, linear('#ffffff'));
  faceQuad(o.solid, 0, b, u - hw, u + hw, 0, hgt, 0.004, linear(color));
}

// A front path from the door to the sidewalk, and a low hedge along the front of the lot.
function frontPath(o, b, ctx, hedge = true) {
  o.solid.flat(-0.05, b.z1, 0.05, 0.5, 0.004, linear(STONE));
  if (hedge) {
    const g = linear(ctx.trees(ctx.x, ctx.y, false).deep);
    o.solid.box(-0.46, 0, 0.4, -0.09, 0.05, 0.46, g, { ao: 0.8 });
    o.solid.box(0.09, 0, 0.4, 0.46, 0.05, 0.46, g, { ao: 0.8 });
  }
}

function flatRoof(o, b, y, ctx, { parapet = 0.03, color = '#ffffff' } = {}) {
  const c = linear(color);
  const top = linear(ctx.roofHex(GRAVEL));
  o.solid.flat(b.x0, b.z0, b.x1, b.z1, y + 0.002, top);
  const p = 0.025;
  o.solid.box(b.x0, y, b.z1 - p, b.x1, y + parapet, b.z1, c, { ao: 1 });
  o.solid.box(b.x0, y, b.z0, b.x1, y + parapet, b.z0 + p, c, { ao: 1 });
  o.solid.box(b.x0, y, b.z0 + p, b.x0 + p, y + parapet, b.z1 - p, c, { ao: 1 });
  o.solid.box(b.x1 - p, y, b.z0 + p, b.x1, y + parapet, b.z1 - p, c, { ao: 1 });
}

// A striped awning over a shop front, sloping out toward the street.
function awning(o, b, y, depth, colA, colB, stripes = 6) {
  const a = linear(colA);
  const c = linear(colB);
  const z = b.z1;
  for (let i = 0; i < stripes; i++) {
    const x0 = b.x0 + 0.02 + ((b.x1 - b.x0 - 0.04) * i) / stripes;
    const x1 = b.x0 + 0.02 + ((b.x1 - b.x0 - 0.04) * (i + 1)) / stripes;
    const col = i % 2 ? c : a;
    o.solid.quad([x0, y - 0.06, z + depth], [x1, y - 0.06, z + depth], [x1, y, z + 0.004], [x0, y, z + 0.004], col);
    o.solid.quad([x1, y - 0.06, z + depth], [x0, y - 0.06, z + depth], [x0, y, z + 0.004], [x1, y, z + 0.004], shade(col, 0.6));
    o.solid.quad([x0, y - 0.085, z + depth], [x1, y - 0.085, z + depth], [x1, y - 0.06, z + depth], [x0, y - 0.06, z + depth], col);
  }
}

function sign(o, b, y, color, w = 0.5) {
  const width = b.x1 - b.x0;
  faceQuad(o.glow, 0, b, 0.5 - w / width / 2, 0.5 + w / width / 2, y, y + 0.06, 0.006, linear(color));
}

// The block a building stands on: a rectangle centred on the tile, front at +z.
const block = (w, d, dz = 0) => ({ x0: -w / 2, x1: w / 2, z0: -d / 2 + dz, z1: d / 2 + dz });

function body(o, b, y0, y1, color, opts) {
  o.solid.box(b.x0, y0, b.z0, b.x1, y1, b.z1, linear(color), opts);
}

// ---- Homes --------------------------------------------------------------------------

function house(o, t, s, ctx) {
  const v = ctx.variant(s, 'peach');
  const stage = ctx.growth?.stage ?? 1;
  const wall = v.wall;
  const roof = ctx.roofHex(v.roof);
  const b = block(stage === 0 ? 0.46 : 0.52, stage === 0 ? 0.4 : 0.44, -0.02);
  const h = stage === 0 ? 0.24 : 0.3;
  o.solid.box(b.x0 - 0.015, 0, b.z0 - 0.015, b.x1 + 0.015, 0.03, b.z1 + 0.015, linear(STONE));
  body(o, b, 0.03, h, wall);
  const alongZ = (s.shape || 0) % 2 === 1;
  o.solid.gable(b.x0, b.z0, b.x1, b.z1, h, alongZ ? 0.26 : 0.22, linear(roof), linear(wall), { alongZ });
  door(o, b, alongZ ? 0.5 : 0.5);
  windows(o, b, [0], 0.06, 1, ctx, { frame: v.trim, w: 0.55, spacing: 0.17, skipDoor: true, seed: 1 });
  windows(o, b, [1, 3], 0.06, 1, ctx, { frame: v.trim, w: 0.4, seed: 2 });
  windows(o, b, [2], 0.06, 1, ctx, { frame: v.trim, w: 0.5, seed: 3 });
  // A chimney on one side of the roof.
  const cx = (s.shape || 0) >= 2 ? b.x0 + 0.1 : b.x1 - 0.1;
  o.solid.box(cx - 0.035, h + 0.05, -0.08, cx + 0.035, h + 0.3, -0.01, linear('#c98e7a'));
  if (ctx.winter && stage > 0) smokeFrom(o, cx, h + 0.32, -0.045, false); // a fire's lit inside
  if (stage === 2) {
    // A grown family adds a side extension with its own little roof.
    const side = (s.shape || 0) >= 2 ? -1 : 1;
    const e = side > 0 ? { x0: b.x1, x1: b.x1 + 0.17, z0: b.z0 + 0.05, z1: b.z1 - 0.06 } : { x0: b.x0 - 0.17, x1: b.x0, z0: b.z0 + 0.05, z1: b.z1 - 0.06 };
    body(o, e, 0.03, 0.22, wall);
    o.solid.gable(e.x0, e.z0, e.x1, e.z1, 0.22, 0.12, linear(roof), linear(wall), { alongZ: true, o: 0.02 });
    windows(o, e, [0], 0.03, 1, ctx, { frame: v.trim, w: 0.5, seed: 4, floorH: 0.19 });
  }
  frontPath(o, b, ctx);
}

function cottage(o, t, s, ctx) {
  const v = ctx.variant(s, 'mint');
  const wall = v.wall;
  const thatch = ctx.era === 0 ? '#cfa45f' : v.roof;
  const b = block(0.42, 0.36, -0.03);
  body(o, b, 0, 0.2, wall);
  o.solid.gable(b.x0, b.z0, b.x1, b.z1, 0.2, 0.26, linear(ctx.roofHex(thatch)), linear(wall), { o: 0.05 });
  door(o, b, 0.35, 0.11, 0.13);
  windows(o, b, [0], 0.03, 1, ctx, { frame: v.trim, w: 0.3, spacing: 0.4, seed: 5, floorH: 0.18 });
  windows(o, b, [1, 3, 2], 0.03, 1, ctx, { frame: v.trim, w: 0.35, seed: 6, floorH: 0.18 });
  // A little wooden porch post and flower boxes.
  o.solid.box(0.04, 0, b.z1, 0.07, 0.2, b.z1 + 0.06, linear('#c9a27a'));
  frontPath(o, b, ctx);
}

function apartments(o, t, s, ctx) {
  const v = ctx.variant(s, 'blush');
  const floors = ctx.growth?.floors ?? s.floors ?? 3;
  const b = block(0.7, 0.62, -0.02);
  const top = 0.04 + floors * FLOOR;
  o.solid.box(b.x0 - 0.01, 0, b.z0 - 0.01, b.x1 + 0.01, 0.04, b.z1 + 0.01, linear(STONE));
  body(o, b, 0.04, top, v.wall);
  // A cornice line between storeys.
  for (let f = 1; f < floors; f++) {
    const y = 0.04 + f * FLOOR;
    o.solid.box(b.x0 - 0.008, y - 0.008, b.z0 - 0.008, b.x1 + 0.008, y + 0.008, b.z1 + 0.008, linear(v.trim), { ao: 1 });
  }
  windows(o, b, [0, 1, 2, 3], 0.04, floors, ctx, { frame: v.trim, w: 0.5, skipDoor: true, seed: 7 });
  door(o, b, 0.5, 0.16, 0.17);
  // Balconies on the upper floors at the front.
  for (let f = 1; f < floors; f++) {
    const y = 0.04 + f * FLOOR;
    for (const u of [-0.2, 0.2]) {
      o.solid.box(u - 0.08, y - 0.005, b.z1, u + 0.08, y + 0.012, b.z1 + 0.06, linear(v.trim));
      o.solid.box(u - 0.08, y + 0.012, b.z1 + 0.052, u + 0.08, y + 0.06, b.z1 + 0.06, linear(v.roof), { top: false });
    }
  }
  flatRoof(o, b, top, ctx, { color: v.trim });
  o.solid.box(-0.18, top, -0.12, 0.02, top + 0.1, 0.05, linear(v.wall));
  // Entrance canopy.
  o.solid.box(-0.12, 0.19, b.z1, 0.12, 0.21, b.z1 + 0.08, linear(v.roof));
}

function tower(o, t, s, ctx) {
  const v = ctx.variant(s, 'lavender');
  const floors = ctx.growth?.floors ?? s.floors ?? 5;
  const b = block(0.56, 0.56);
  const fh = 0.22;
  const top = 0.05 + floors * fh;
  o.solid.box(b.x0 - 0.04, 0, b.z0 - 0.04, b.x1 + 0.04, 0.05, b.z1 + 0.04, linear(STONE));
  body(o, b, 0.05, top, v.wall);
  windows(o, b, [0, 1, 2, 3], 0.05, floors, ctx, { frame: v.trim, w: 0.62, spacing: 0.12, skipDoor: true, seed: 8, floorH: fh });
  // Corner pilasters run the full height.
  const p = 0.03;
  for (const [x, z] of [
    [b.x0, b.z0],
    [b.x1 - p, b.z0],
    [b.x0, b.z1 - p],
    [b.x1 - p, b.z1 - p],
  ]) {
    o.solid.box(x - 0.005, 0.05, z - 0.005, x + p + 0.005, top + 0.02, z + p + 0.005, linear(v.trim), { ao: 1 });
  }
  door(o, b, 0.5, 0.18, 0.17, '#6d6890');
  // A stepped crown, a water tank and an aerial with a red light.
  flatRoof(o, b, top, ctx, { color: v.trim, parapet: 0.04 });
  const c = block(0.34, 0.34);
  o.solid.box(c.x0, top, c.z0, c.x1, top + 0.12, c.z1, linear(v.wall));
  o.solid.prism(0.12, 0.12, 0.06, 0.06, top, top + 0.1, 8, linear('#c9b8a6'));
  o.solid.box(-0.01, top + 0.12, -0.01, 0.01, top + 0.42, 0.01, linear('#9d97b6'));
  o.glow.box(-0.018, top + 0.42, -0.018, 0.018, top + 0.45, 0.018, linear('#ff8f8f'));
}

// ---- Shops and work -----------------------------------------------------------------

function shop(o, t, s, ctx) {
  const v = ctx.variant(s, 'mint');
  const b = block(0.68, 0.54, -0.04);
  const h = 0.32;
  body(o, b, 0, h, v.wall);
  // A big shop window on the ground floor, lit while the shop is open.
  faceQuad(o.solid, 0, b, 0.08, 0.92, 0.02, 0.2, 0.002, linear(v.trim));
  faceQuad(ctx.open ? o.lit : o.glass, 0, b, 0.12, 0.62, 0.04, 0.18, 0.004, linear(GLASS));
  faceQuad(o.solid, 0, b, 0.68, 0.86, 0, 0.17, 0.004, linear(DOOR));
  windows(o, b, [1, 2, 3], 0.02, 1, ctx, { frame: v.trim, w: 0.4, seed: 9, floorH: 0.28 });
  awning(o, b, 0.25, 0.12, v.roof, '#ffffff');
  sign(o, b, 0.26, v.roof, 0.3);
  flatRoof(o, b, h, ctx, { color: v.trim });
  o.solid.box(0.1, h, -0.15, 0.24, h + 0.06, -0.04, linear('#cfc8d8'));
}

function cafe(o, t, s, ctx) {
  const v = ctx.variant(s, 'peach');
  const b = block(0.56, 0.42, -0.1);
  const h = 0.27;
  body(o, b, 0, h, v.wall);
  faceQuad(o.solid, 0, b, 0.06, 0.94, 0.02, 0.19, 0.002, linear(v.trim));
  faceQuad(ctx.open ? o.lit : o.glass, 0, b, 0.1, 0.6, 0.04, 0.17, 0.004, linear(GLASS));
  faceQuad(o.solid, 0, b, 0.68, 0.86, 0, 0.16, 0.004, linear(DOOR));
  awning(o, b, 0.23, 0.13, v.roof, '#ffffff', 8);
  o.solid.hip(b.x0, b.z0, b.x1, b.z1, h, 0.12, linear(ctx.roofHex(v.roof)));
  // Tables with parasols out front.
  for (const x of [-0.18, 0.16]) {
    o.solid.prism(x, 0.3, 0.008, 0.008, 0, 0.08, 4, linear('#b0a8c4'));
    o.solid.prism(x, 0.3, 0.05, 0.05, 0.075, 0.085, 8, linear('#ffffff'));
    o.solid.prism(x, 0.3, 0.005, 0.005, 0.085, 0.17, 4, linear('#b0a8c4'));
    o.solid.prism(x, 0.3, 0.1, 0.0, 0.15, 0.2, 8, linear(x < 0 ? v.roof : '#ffffff'), { top: false });
  }
}

function bakery(o, t, s, ctx) {
  const b = block(0.56, 0.46, -0.05);
  const h = 0.26;
  const wall = '#fbe7c6';
  body(o, b, 0, h, wall);
  o.solid.gable(b.x0, b.z0, b.x1, b.z1, h, 0.2, linear(ctx.roofHex('#d49a6a')), linear(wall));
  faceQuad(o.solid, 0, b, 0.08, 0.6, 0.03, 0.19, 0.002, linear('#ffffff'));
  faceQuad(ctx.open ? o.lit : o.glass, 0, b, 0.11, 0.57, 0.05, 0.17, 0.004, linear(GLASS));
  faceQuad(o.solid, 0, b, 0.68, 0.88, 0, 0.17, 0.004, linear('#b9845c'));
  awning(o, b, 0.24, 0.1, '#e8b56a', '#ffffff', 6);
  windows(o, b, [1, 3], 0.02, 1, ctx, { frame: '#ffffff', w: 0.4, seed: 10, floorH: 0.24 });
  o.solid.box(b.x1 - 0.14, h + 0.04, -0.06, b.x1 - 0.07, h + 0.3, 0.0, linear('#e3b08f'));
  sign(o, b, 0.25, '#b9845c', 0.24);
}

function mall(o, t, s, ctx) {
  const v = ctx.variant(s, 'lavender');
  const b = block(0.88, 0.84, -0.02);
  const h = 0.42;
  body(o, b, 0, h, '#e8e4ee');
  // A tall glass entrance and a coloured band with the sign.
  faceQuad(o.solid, 0, b, 0.3, 0.7, 0, 0.32, 0.002, linear(v.trim));
  faceQuad(ctx.open ? o.lit : o.glass, 0, b, 0.33, 0.67, 0, 0.3, 0.004, linear(GLASS));
  o.solid.box(b.x0 - 0.005, 0.33, b.z0 - 0.005, b.x1 + 0.005, 0.4, b.z1 + 0.005, linear(v.wall), { ao: 1 });
  sign(o, b, 0.34, v.roof, 0.3);
  windows(o, b, [1, 2, 3], 0.02, 1, ctx, { band: true, floorH: 0.3, seed: 11 });
  flatRoof(o, b, h, ctx, { color: v.wall });
  o.solid.box(-0.2, h, -0.2, 0.2, h + 0.06, 0.12, linear(GLASS));
  for (const [x, z] of [
    [0.28, -0.28],
    [-0.3, -0.25],
    [0.3, 0.22],
  ])
    o.solid.box(x - 0.05, h, z - 0.04, x + 0.05, h + 0.06, z + 0.04, linear('#cfc8d8'));
  // Parking bays in front.
  for (let i = 0; i < 4; i++) o.solid.flat(-0.38 + i * 0.2, 0.43, -0.37 + i * 0.2 + 0.01, 0.5, 0.004, linear('#ffffff'));
}

function factory(o, t, s, ctx) {
  const b = block(0.84, 0.72, -0.04);
  const h = 0.32;
  const wall = '#f4f1f7';
  body(o, b, 0, h, wall);
  // A sawtooth roof: three steep glazed teeth.
  const teeth = 3;
  const roof = linear(ctx.roofHex('#b8aed0'));
  for (let i = 0; i < teeth; i++) {
    const z0 = b.z0 + ((b.z1 - b.z0) * i) / teeth;
    const z1 = b.z0 + ((b.z1 - b.z0) * (i + 1)) / teeth;
    const top = h + 0.14;
    o.solid.quad([b.x0, h, z1], [b.x1, h, z1], [b.x1, top, z0], [b.x0, top, z0], roof, shade(roof, 0.9));
    o.glass.quad([b.x1, h, z0], [b.x0, h, z0], [b.x0, top, z0], [b.x1, top, z0], linear(GLASS));
    o.solid.tri([b.x1, h, z1], [b.x1, h, z0], [b.x1, top, z0], linear(wall));
    o.solid.tri([b.x0, h, z0], [b.x0, h, z1], [b.x0, top, z0], linear(wall));
  }
  // Loading doors and a strip of high windows.
  faceQuad(o.solid, 0, b, 0.1, 0.35, 0, 0.22, 0.004, linear('#d9d2e3'));
  faceQuad(o.solid, 0, b, 0.42, 0.67, 0, 0.22, 0.004, linear('#d9d2e3'));
  windows(o, b, [1, 3], 0.1, 1, ctx, { band: true, floorH: 0.2, seed: 12 });
  // The chimney, red and white.
  const cx = b.x1 - 0.12;
  const cz = b.z0 + 0.12;
  for (let i = 0; i < 4; i++) {
    const y0 = h + i * 0.15;
    o.solid.prism(cx, cz, 0.06 - i * 0.004, 0.06 - (i + 1) * 0.004, y0, y0 + 0.15, 8, linear(i % 2 ? '#ffffff' : '#e9a89a'));
  }
  smokeFrom(o, cx, h + 0.62, cz, true);
  o.solid.prism(b.x0 + 0.13, b.z1 - 0.15, 0.09, 0.09, 0, 0.26, 10, linear('#d9d2e3'));
  o.solid.hip(b.x0 + 0.04, b.z1 - 0.24, b.x0 + 0.22, b.z1 - 0.06, 0.26, 0.04, linear('#a99fc2'), { o: 0 });
}

function office(o, t, s, ctx) {
  const v = ctx.variant(s, 'mint');
  const floors = ctx.growth?.floors ?? s.floors ?? 4;
  const b = block(0.6, 0.6);
  const fh = 0.25;
  const top = 0.05 + floors * fh;
  o.solid.box(b.x0 - 0.05, 0, b.z0 - 0.05, b.x1 + 0.05, 0.05, b.z1 + 0.05, linear(STONE));
  body(o, b, 0.05, top, v.wall);
  windows(o, b, [0, 1, 2, 3], 0.05, floors, ctx, { band: true, floorH: fh, h: 0.62, frame: v.trim, seed: 13 });
  // Glass lobby.
  faceQuad(o.solid, 0, b, 0.32, 0.68, 0.05, 0.22, 0.006, linear('#6d6890'));
  flatRoof(o, b, top, ctx, { color: v.trim });
  o.solid.box(-0.14, top, -0.14, 0.14, top + 0.08, 0.1, linear('#cfc8d8'));
  o.solid.box(0.16, top, 0.12, 0.22, top + 0.2, 0.18, linear('#9d97b6'));
}

// ---- Services -------------------------------------------------------------------------

function school(o, t, s, ctx) {
  const b = block(0.8, 0.5, -0.12);
  const h = 0.44;
  const wall = '#fffaf2';
  o.solid.box(b.x0 - 0.01, 0, b.z0 - 0.01, b.x1 + 0.01, 0.03, b.z1 + 0.01, linear(STONE));
  body(o, b, 0.03, h, wall);
  o.solid.box(b.x0 - 0.006, 0.2, b.z0 - 0.006, b.x1 + 0.006, 0.22, b.z1 + 0.006, linear('#ffb5a7'), { ao: 1 });
  windows(o, b, [0, 1, 2, 3], 0.03, 2, ctx, { frame: '#cdb4db', w: 0.55, seed: 14, floorH: 0.2, skipDoor: true });
  door(o, b, 0.5, 0.16, 0.16, '#cdb4db');
  o.solid.gable(b.x0, b.z0, b.x1, b.z1, h, 0.18, linear(ctx.roofHex('#e9968c')), linear(wall));
  // The bell tower with a clock face.
  o.solid.box(-0.07, h, -0.07 - 0.12, 0.07, h + 0.28, 0.07 - 0.12, linear(wall));
  o.solid.hip(-0.08, -0.2, 0.08, -0.04, h + 0.28, 0.12, linear(ctx.roofHex('#e9968c')), { o: 0.01 });
  o.solid.prism(0, -0.04 + 0.005, 0.035, 0.035, h + 0.16, h + 0.161, 10, linear('#ffffff'));
  // Playground marks and a flagpole in the yard.
  o.solid.flat(-0.38, 0.2, 0.38, 0.48, 0.003, linear('#f1e3c8'));
  o.solid.box(0.3, 0, 0.3, 0.31, 0.38, 0.31, linear('#9d97b6'));
  o.glow.box(0.31, 0.3, 0.3, 0.38, 0.36, 0.305, linear('#ffb5a7'));
}

function clinic(o, t, s, ctx) {
  const b = block(0.66, 0.56, -0.04);
  const h = 0.4;
  const wall = '#fff6f2';
  body(o, b, 0, h, wall);
  o.solid.box(b.x0 - 0.005, 0.18, b.z0 - 0.005, b.x1 + 0.005, 0.2, b.z1 + 0.005, linear('#b8e0d2'), { ao: 1 });
  windows(o, b, [0, 1, 2, 3], 0.0, 2, ctx, { frame: '#b8e0d2', w: 0.5, seed: 15, floorH: 0.2, skipDoor: true });
  faceQuad(o.solid, 0, b, 0.4, 0.6, 0, 0.17, 0.004, linear(GLASS));
  flatRoof(o, b, h, ctx, { color: '#b8e0d2' });
  // A red cross on the roof edge and an entrance canopy.
  const cz = b.z1 + 0.006;
  o.glow.quad([-0.05, h + 0.06, cz], [0.05, h + 0.06, cz], [0.05, h + 0.09, cz], [-0.05, h + 0.09, cz], linear('#ff9a9a'));
  o.glow.quad([-0.015, h + 0.025, cz], [0.015, h + 0.025, cz], [0.015, h + 0.125, cz], [-0.015, h + 0.125, cz], linear('#ff9a9a'));
  o.solid.box(-0.03, h, b.z1 - 0.02, 0.03, h + 0.15, b.z1, linear('#ffffff'));
  o.solid.box(-0.14, 0.19, b.z1, 0.14, 0.21, b.z1 + 0.1, linear('#b8e0d2'));
}

function library(o, t, s, ctx) {
  const b = block(0.7, 0.5, -0.08);
  const h = 0.34;
  const wall = '#f1ece4';
  o.solid.box(b.x0 - 0.03, 0, b.z0 - 0.03, b.x1 + 0.03, 0.05, b.z1 + 0.12, linear('#f3ecf6'));
  body(o, b, 0.05, h, wall);
  windows(o, b, [1, 2, 3], 0.05, 1, ctx, { frame: '#ffffff', w: 0.45, seed: 16, floorH: 0.28, h: 0.6 });
  door(o, b, 0.5, 0.14, 0.2, '#a98fbf');
  // A portico: columns under a pediment.
  for (let i = 0; i < 5; i++) {
    const x = b.x0 + 0.08 + ((b.x1 - b.x0 - 0.16) * i) / 4;
    o.solid.prism(x, b.z1 + 0.07, 0.022, 0.022, 0.05, h, 8, linear('#fffaf6'));
  }
  o.solid.box(b.x0, h, b.z0, b.x1, h + 0.04, b.z1 + 0.11, linear('#fffaf6'));
  o.solid.gable(b.x0, b.z0, b.x1, b.z1 + 0.11, h + 0.04, 0.12, linear(ctx.roofHex('#a98fbf')), linear('#fffaf6'), { alongZ: true, o: 0.01 });
}

function firestation(o, t, s, ctx) {
  const b = block(0.72, 0.6, -0.04);
  const h = 0.36;
  const wall = '#fff3ef';
  body(o, b, 0, h, wall);
  // Two red garage doors and a hose tower.
  faceQuad(o.solid, 0, b, 0.08, 0.38, 0, 0.22, 0.004, linear('#ff6b5e'));
  faceQuad(o.solid, 0, b, 0.44, 0.74, 0, 0.22, 0.004, linear('#ff6b5e'));
  for (let k = 0; k < 4; k++) {
    const y = 0.04 + k * 0.045;
    faceQuad(o.solid, 0, b, 0.08, 0.38, y, y + 0.006, 0.006, linear('#e0c8c2'));
    faceQuad(o.solid, 0, b, 0.44, 0.74, y, y + 0.006, 0.006, linear('#e0c8c2'));
  }
  windows(o, b, [1, 2, 3], 0.0, 1, ctx, { frame: '#ff6b5e', w: 0.45, seed: 17, floorH: 0.3 });
  o.solid.box(b.x0 - 0.005, 0.26, b.z0 - 0.005, b.x1 + 0.005, 0.29, b.z1 + 0.005, linear('#ff6b5e'), { ao: 1 });
  flatRoof(o, b, h, ctx, { color: '#ff6b5e' });
  const tx = b.x1 - 0.1;
  o.solid.box(tx - 0.08, 0, b.z0, tx + 0.08, 0.66, b.z0 + 0.16, linear(wall));
  o.solid.hip(tx - 0.09, b.z0 - 0.01, tx + 0.09, b.z0 + 0.17, 0.66, 0.08, linear(ctx.roofHex('#f4978e')));
  o.glow.box(tx - 0.02, 0.55, b.z0 + 0.16, tx + 0.02, 0.59, b.z0 + 0.165, linear('#ff6b5e'));
}

function university(o, t, s, ctx) {
  const b = block(0.86, 0.6, -0.1);
  const h = 0.46;
  const wall = '#fffaf2';
  o.solid.box(b.x0 - 0.03, 0, b.z0 - 0.03, b.x1 + 0.03, 0.04, b.z1 + 0.14, linear('#f3dcc8'));
  body(o, b, 0.04, h, wall);
  windows(o, b, [0, 1, 2, 3], 0.04, 2, ctx, { frame: '#b79ad0', w: 0.5, seed: 18, floorH: 0.21, skipDoor: true });
  door(o, b, 0.5, 0.16, 0.2, '#7d6a8f');
  for (let i = 0; i < 6; i++) {
    const x = -0.22 + (0.44 * i) / 5;
    o.solid.prism(x, b.z1 + 0.08, 0.02, 0.02, 0.04, 0.32, 8, linear('#ffffff'));
  }
  o.solid.box(-0.26, 0.32, b.z1, 0.26, 0.36, b.z1 + 0.12, linear('#ffffff'));
  o.solid.hip(b.x0, b.z0, b.x1, b.z1, h, 0.1, linear(ctx.roofHex('#b79ad0')));
  // The dome over the great hall.
  const dz = (b.z0 + b.z1) / 2;
  o.solid.prism(0, dz, 0.15, 0.15, h + 0.04, h + 0.16, 12, linear(wall));
  for (let k = 0; k < 4; k++) {
    const a0 = (k / 4) * (Math.PI / 2);
    const a1 = ((k + 1) / 4) * (Math.PI / 2);
    o.solid.prism(0, dz, 0.16 * Math.cos(a0), 0.16 * Math.cos(a1), h + 0.16 + 0.16 * Math.sin(a0), h + 0.16 + 0.16 * Math.sin(a1), 12, linear(ctx.roofHex('#a98fbf')), { top: k === 3 ? linear('#a98fbf') : false });
  }
  o.solid.box(-0.006, h + 0.32, dz - 0.006, 0.006, h + 0.42, dz + 0.006, linear('#7d6a8f'));
}

// ---- Nature and play --------------------------------------------------------------------

// A tree: shape 0 round, 1 tall and narrow, 2 a cone of a pine, 3 blossom.
export function tree(o, x, z, shape, scale, ctx, seed = 0) {
  const c = ctx.trees(ctx.x + x, ctx.y + z, shape === 3);
  const deep = linear(c.deep);
  const mid = linear(c.mid);
  const light = linear(c.light);
  const trunk = linear('#b99679');
  const k = scale;
  o.solid.prism(x, z, 0.022 * k, 0.016 * k, 0, 0.2 * k, 5, trunk, { top: false });
  if (shape === 2) {
    o.solid.prism(x, z, 0.16 * k, 0, 0.12 * k, 0.4 * k, 7, deep, { top: false });
    o.solid.prism(x, z, 0.12 * k, 0, 0.3 * k, 0.6 * k, 7, mid, { top: false });
    return;
  }
  if (shape === 1) {
    o.solid.blob(x, 0.36 * k, z, 0.1 * k, 0.24 * k, mid, light, seed);
    return;
  }
  o.solid.blob(x, 0.3 * k, z, 0.17 * k, 0.15 * k, deep, mid, seed);
  o.solid.blob(x + 0.04 * k, 0.42 * k, z - 0.03 * k, 0.12 * k, 0.11 * k, mid, light, seed + 1);
}

function treeTile(o, t, s, ctx) {
  const shape = (s.shape || 0) % 4;
  const jx = (ctx.hash(t.x, t.y, 21) - 0.5) * 0.16;
  const jz = (ctx.hash(t.x, t.y, 22) - 0.5) * 0.16;
  tree(o, jx, jz, shape, 1.05 + ctx.hash(t.x, t.y, 23) * 0.3, ctx, t.x * 3 + t.y);
}

function bench(o, x, z, along, color = '#c9a27a') {
  const c = linear(color);
  if (along) {
    o.solid.box(x - 0.07, 0.04, z - 0.02, x + 0.07, 0.05, z + 0.02, c);
    o.solid.box(x - 0.07, 0.05, z - 0.022, x + 0.07, 0.085, z - 0.014, c);
  } else {
    o.solid.box(x - 0.02, 0.04, z - 0.07, x + 0.02, 0.05, z + 0.07, c);
    o.solid.box(x - 0.022, 0.05, z - 0.07, x - 0.014, 0.085, z + 0.07, c);
  }
}

function park(o, t, s, ctx) {
  // Paths cross the park; trees, a bench and flower beds sit in the corners.
  const path = linear(ctx.snowy('#efe6d6'));
  o.solid.flat(-0.5, -0.06, 0.5, 0.06, 0.004, path);
  o.solid.flat(-0.06, -0.5, 0.06, 0.5, 0.004, path);
  const h = (k) => ctx.hash(t.x, t.y, k);
  const corners = [
    [-0.27, -0.27],
    [0.27, -0.27],
    [0.27, 0.27],
    [-0.27, 0.27],
  ];
  corners.forEach(([x, z], i) => {
    const r = h(30 + i);
    if (r < 0.45) tree(o, x, z, r < 0.12 ? 3 : r < 0.2 ? 2 : 0, 0.75 + h(40 + i) * 0.3, ctx, i + t.x);
    else if (r < 0.7) {
      const bed = linear(ctx.snowy(['#f7c6cf', '#ffd98f', '#cdb4db', '#fff4f7'][i]));
      o.solid.prism(x, z, 0.1, 0.1, 0, 0.03, 8, linear('#d2b89c'), { top: bed });
    } else o.solid.blob(x, 0.05, z, 0.09, 0.06, linear(ctx.trees(t.x, t.y, false).deep), linear(ctx.trees(t.x, t.y, false).mid), i);
  });
  if (h(50) < 0.5) bench(o, 0.14, -0.14, true);
  else bench(o, -0.14, 0.14, false);
  if (h(51) < 0.25) {
    // A fountain where the paths meet.
    o.solid.prism(0, 0, 0.1, 0.1, 0, 0.04, 10, linear('#f1ece4'), { top: linear('#7ec8e3') });
    o.solid.prism(0, 0, 0.015, 0.015, 0.04, 0.12, 6, linear('#f1ece4'));
    o.glow.prism(0, 0, 0.03, 0, 0.12, 0.16, 6, linear('#bfe6f2'), { top: false });
  }
}

function playground(o, t, s, ctx) {
  const c = (hex) => linear(hex);
  // A slide, a swing frame and a climbing dome on soft sand.
  o.solid.box(-0.3, 0, -0.3, -0.18, 0.18, -0.18, c('#ffb5a7'));
  o.solid.quad([-0.18, 0.18, -0.3], [-0.18, 0.18, -0.18], [0.06, 0.02, -0.18], [0.06, 0.02, -0.3], c('#ffd98f'));
  o.solid.quad([0.06, 0.02, -0.3], [0.06, 0.02, -0.18], [-0.18, 0.18, -0.18], [-0.18, 0.18, -0.3], c('#e8c27a'));
  for (const x of [0.12, 0.36]) {
    o.solid.box(x - 0.01, 0, 0.08, x + 0.01, 0.22, 0.1, c('#7c7396'));
    o.solid.box(x - 0.01, 0, 0.3, x + 0.01, 0.22, 0.32, c('#7c7396'));
  }
  o.solid.box(0.11, 0.21, 0.08, 0.37, 0.23, 0.32, c('#7c7396'));
  for (const x of [0.2, 0.28]) {
    o.solid.box(x - 0.003, 0.08, 0.2, x + 0.003, 0.21, 0.205, c('#b0a8c4'));
    o.solid.box(x - 0.025, 0.075, 0.19, x + 0.025, 0.085, 0.215, c('#cdb4db'));
  }
  o.solid.prism(-0.2, 0.22, 0.13, 0.04, 0, 0.14, 8, c('#b8e0d2'), { top: c('#cdb4db') });
}

function field(o, t, s, ctx) {
  const white = linear('#ffffff');
  const L = 0.4;
  o.solid.flat(-L, -L, L, -L + 0.012, 0.004, white);
  o.solid.flat(-L, L - 0.012, L, L, 0.004, white);
  o.solid.flat(-L, -L, -L + 0.012, L, 0.004, white);
  o.solid.flat(L - 0.012, -L, L, L, 0.004, white);
  o.solid.flat(-L, -0.006, L, 0.006, 0.004, white);
  o.solid.prism(0, 0, 0.08, 0.08, 0.003, 0.0045, 12, white, { top: false });
  for (const z of [-L, L]) {
    o.solid.box(-0.1, 0, z - 0.006, -0.09, 0.09, z + 0.006, white);
    o.solid.box(0.09, 0, z - 0.006, 0.1, 0.09, z + 0.006, white);
    o.solid.box(-0.1, 0.085, z - 0.006, 0.1, 0.095, z + 0.006, white);
  }
}

function rubble(o, t, s, ctx) {
  const cols = ['#cfc5b6', '#b9ae9f', '#e3a98f', '#d9d2e3'];
  for (let i = 0; i < 9; i++) {
    const x = (ctx.hash(t.x, t.y, 60 + i) - 0.5) * 0.6;
    const z = (ctx.hash(t.x, t.y, 70 + i) - 0.5) * 0.6;
    const w = 0.05 + ctx.hash(t.x, t.y, 80 + i) * 0.08;
    o.solid.box(x - w, 0, z - w * 0.7, x + w, w * 0.9, z + w * 0.7, linear(cols[i % 4]));
  }
}

const MODELS = {
  house,
  cottage,
  apartments,
  tower,
  shop,
  cafe,
  bakery,
  mall,
  factory,
  office,
  school,
  clinic,
  library,
  firestation,
  university,
  tree: treeTile,
  park,
  playground,
  field,
  rubble,
};

export const MODEL_TYPES = Object.keys(MODELS);

// Build the structure on tile t (not roads: the ground builder does those). ctx carries the tile's
// colours and state; see view3d.js.
export function buildStructure(o, t, ctx) {
  const s = t.structure;
  const make = MODELS[s.type];
  if (!make) return false;
  const damaged = s.damage > 0;
  const before = o.solid.vertices;
  make(o, t, s, ctx);
  if (damaged) {
    // Smoke-darkened and scorched: tint what was just built.
    const col = o.solid.col;
    const k = 1 - Math.min(0.5, s.damage * 0.6);
    for (let i = before * 3; i < col.length; i++) col[i] *= k;
  }
  return true;
}

export { mix };
