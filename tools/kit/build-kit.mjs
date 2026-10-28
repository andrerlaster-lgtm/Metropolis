// Build the game's 3D models from the Kenney kits: node tools/kit/build-kit.mjs
// For each recipe (recipes.mjs) the pieces are read from assets/kenney/<kit>/<name>.glb, placed, their
// palette colours baked into vertex colours (with a little ambient occlusion toward the ground and
// under ledges), recoloured, joined into one mesh and written to src/view3d/models/<recipe>.glb.
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
    const rgb = remap ? remap([pal.data[k], pal.data[k + 1], pal.data[k + 2]]) : [pal.data[k], pal.data[k + 1], pal.data[k + 2]];
    out.color.set(rgb.map(toLinear), i * 3);
  }
  return out;
}

// Soft darkening near the ground and on faces that look down: cheap baked ambient occlusion.
function occlude(m, height) {
  for (let i = 0; i < m.position.length / 3; i++) {
    const y = m.position[i * 3 + 1];
    const ny = m.normal[i * 3 + 1];
    let k = 0.7 + 0.3 * Math.min(1, y / (height * 0.35));
    if (ny < -0.5) k *= 0.7;
    for (let c = 0; c < 3; c++) m.color[i * 3 + c] *= k;
  }
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
  for (let i = 0; i < m.position.length; i++) m.position[i] = (m.position[i] - (i % 3 === 1 ? minY : 0)) * recipe.scale;
  occlude(m, (maxY - minY) * recipe.scale);
  const { bytes, vertices, triangles } = writeGlb(m);
  const out = join(root, 'src', 'view3d', 'models', `${name}.glb`);
  writeFileSync(out, bytes);
  console.log(`${name}: ${triangles} triangles, ${vertices} vertices, ${(bytes.length / 1024).toFixed(1)} KB → ${out.replace(root + '/', '')}`);
}
