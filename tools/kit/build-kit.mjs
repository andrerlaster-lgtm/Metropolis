// Build the game's 3D models from the Kenney kits: node tools/kit/build-kit.mjs
// For each recipe (recipes.mjs) the pieces are read from assets/kenney/<kit>/<name>.glb, placed, their
// palette colours baked into vertex colours, recoloured, joined into one mesh, shaded with ambient
// occlusion traced against the model itself and the ground, and written to src/view3d/models/<recipe>.glb.
// One mesh and one material per model: one draw call, no textures to load.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGlb, flatten, writeGlb } from '../../src/view3d/glb.js';
import { readPng } from './png.mjs';
import * as recipes from './recipes.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const kitDir = (kit) => join(root, 'assets', 'kenney', kit);
const palettes = {};
const palette = (kit) => (palettes[kit] ||= readPng(readFileSync(join(kitDir(kit), 'colormap.png'))));
const toLinear = (c) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

function piece(p, remap) {
  const file = join(kitDir(p.kit), `${p.name}.glb`);
  if (!existsSync(file)) throw new Error(`Missing kit model: ${file}`);
  const b = readFileSync(file);
  const f = flatten(parseGlb(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)));
  const pal = palette(p.kit);
  const th = ((p.r || 0) * Math.PI) / 2;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const [sx, sy, sz] = p.s || [1, 1, 1];
  const [ax, ay, az] = p.at || [0, 0, 0];
  const n = f.position.length / 3;
  const out = { position: new Float32Array(n * 3), normal: new Float32Array(n * 3), color: new Float32Array(n * 3) };
  for (let i = 0; i < n; i++) {
    const x = f.position[i * 3] * sx;
    const y = f.position[i * 3 + 1] * sy;
    const z = f.position[i * 3 + 2] * sz;
    out.position.set([x * cos + z * sin + ax, y + ay, -x * sin + z * cos + az], i * 3);
    // Normals: undo the stretch, then turn.
    let nx = f.normal[i * 3] / sx;
    let ny = f.normal[i * 3 + 1] / sy;
    let nz = f.normal[i * 3 + 2] / sz;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    out.normal.set([nx * cos + nz * sin, ny, -nx * sin + nz * cos], i * 3);
    // Palette colour at the texture coordinate (nearest texel).
    const u = Math.min(pal.width - 1, Math.max(0, Math.floor(f.uv[i * 2] * pal.width)));
    const v = Math.min(pal.height - 1, Math.max(0, Math.floor(f.uv[i * 2 + 1] * pal.height)));
    const k = (v * pal.width + u) * 4;
    const fix = p.remap || remap;
    const rgb = fix ? fix([pal.data[k], pal.data[k + 1], pal.data[k + 2]]) : [pal.data[k], pal.data[k + 1], pal.data[k + 2]];
    out.color.set(rgb.map(toLinear), i * 3);
  }
  return out;
}

// Ambient occlusion: from every vertex, rays over the hemisphere it faces; the share that hits the
// model itself (or the ground, for models that stand on it) within `reach` darkens it. Baked once here,
// so it costs nothing in the game. Corners, the feet of walls, window reveals and the undersides of
// ledges come out darker; open roofs and faces stay bright.
const RAYS = (() => {
  const out = [];
  const n = 24;
  for (let i = 0; i < n; i++) {
    const z = Math.sqrt((i + 0.5) / n); // cosine-weighted
    const r = Math.sqrt(1 - z * z);
    const a = i * 2.399963;
    out.push([r * Math.cos(a), r * Math.sin(a), z]);
  }
  return out;
})();

function occlude(m, { reach = 0.22, strength = 0.65, ground = true } = {}) {
  const P = m.position;
  const tris = P.length / 9;
  // Triangle bounding boxes, to skip most of them quickly.
  const box = new Float32Array(tris * 6);
  for (let t = 0; t < tris; t++) {
    for (let c = 0; c < 3; c++) {
      const a = P[t * 9 + c], b = P[t * 9 + 3 + c], d = P[t * 9 + 6 + c];
      box[t * 6 + c] = Math.min(a, b, d);
      box[t * 6 + 3 + c] = Math.max(a, b, d);
    }
  }
  const hit = (ox, oy, oz, dx, dy, dz) => {
    if (ground && dy < 0 && -oy / dy < reach) return true;
    const ex = ox + dx * reach, ey = oy + dy * reach, ez = oz + dz * reach;
    const lx = Math.min(ox, ex), ly = Math.min(oy, ey), lz = Math.min(oz, ez);
    const hx = Math.max(ox, ex), hy = Math.max(oy, ey), hz = Math.max(oz, ez);
    for (let t = 0; t < tris; t++) {
      const b = t * 6;
      if (box[b + 3] < lx || box[b] > hx || box[b + 4] < ly || box[b + 1] > hy || box[b + 5] < lz || box[b + 2] > hz) continue;
      const i = t * 9;
      const e1x = P[i + 3] - P[i], e1y = P[i + 4] - P[i + 1], e1z = P[i + 5] - P[i + 2];
      const e2x = P[i + 6] - P[i], e2y = P[i + 7] - P[i + 1], e2z = P[i + 8] - P[i + 2];
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-9) continue;
      const inv = 1 / det;
      const tx = ox - P[i], ty = oy - P[i + 1], tz = oz - P[i + 2];
      const u = (tx * px + ty * py + tz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (dist > 1e-4 && dist < reach) return true;
    }
    return false;
  };
  const cache = new Map();
  const stat = { n: 0, occ: 0 };
  for (let i = 0; i < P.length / 3; i++) {
    const ox = P[i * 3], oy = P[i * 3 + 1], oz = P[i * 3 + 2];
    const nx = m.normal[i * 3], ny = m.normal[i * 3 + 1], nz = m.normal[i * 3 + 2];
    const key = [ox, oy, oz, nx, ny, nz].map((v) => Math.round(v * 1e4)).join(',');
    let occ = cache.get(key);
    if (occ == null) {
      // A frame around the normal.
      const ax = Math.abs(nx) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      let tx = ny * ax[2] - nz * ax[1], ty = nz * ax[0] - nx * ax[2], tz = nx * ax[1] - ny * ax[0];
      const tl = Math.hypot(tx, ty, tz);
      tx /= tl; ty /= tl; tz /= tl;
      const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
      let hits = 0;
      for (const [rx, ry, rz] of RAYS) {
        const dx = tx * rx + bx * ry + nx * rz, dy = ty * rx + by * ry + ny * rz, dz = tz * rx + bz * ry + nz * rz;
        if (hit(ox + nx * 0.002, oy + ny * 0.002, oz + nz * 0.002, dx, dy, dz)) hits++;
      }
      occ = hits / RAYS.length;
      cache.set(key, occ);
    }
    stat.n++; stat.occ += occ;
    const k = 1 - strength * occ;
    for (let c = 0; c < 3; c++) m.color[i * 3 + c] *= k;
  }
  return stat.occ / stat.n;
}

function join3(list) {
  const total = list.reduce((s, m) => s + m.position.length, 0);
  const out = { position: new Float32Array(total), normal: new Float32Array(total), color: new Float32Array(total) };
  let at = 0;
  for (const m of list) {
    out.position.set(m.position, at);
    out.normal.set(m.normal, at);
    out.color.set(m.color, at);
    at += m.position.length;
  }
  return out;
}

for (const [name, recipe] of Object.entries(recipes)) {
  const parts = recipe.pieces.filter((p) => !p.skip).map((p) => piece(p, recipe.remap));
  const m = join3(parts);
  // Into game tiles, standing on y = 0 and centred.
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 1; i < m.position.length; i += 3) {
    minY = Math.min(minY, m.position[i]);
    maxY = Math.max(maxY, m.position[i]);
  }
  const lift = recipe.keepOrigin ? 0 : minY;
  for (let i = 0; i < m.position.length; i++) m.position[i] = (m.position[i] - (i % 3 === 1 ? lift : 0)) * recipe.scale;
  const occ = occlude(m, { ground: !recipe.keepOrigin, ...recipe.ao });
  const { bytes, vertices, triangles } = writeGlb(m);
  const out = join(root, 'src', 'view3d', 'models', `${name}.glb`);
  writeFileSync(out, bytes);
  console.log(`${name}: ${triangles} triangles, ${vertices} vertices, ${(bytes.length / 1024).toFixed(1)} KB, mean occlusion ${(occ * 100).toFixed(0)}% → ${out.replace(root + '/', '')}`);
}
