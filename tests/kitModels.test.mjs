import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { parseGlb, flatten, writeGlb } from '../src/view3d/glb.js';

const load = (path) => {
  const b = readFileSync(new URL(path, import.meta.url));
  return parseGlb(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
};

test('a written .glb reads back the same triangles', () => {
  const position = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
  const normal = new Float32Array(18).map((_, i) => (i % 3 === 2 ? 1 : 0));
  const color = new Float32Array(18).fill(0.5);
  const { bytes, vertices, triangles } = writeGlb({ position, normal, color });
  assert.equal(triangles, 2);
  assert.equal(vertices, 4); // the shared corners are stored once
  const back = flatten(parseGlb(bytes.buffer));
  assert.deepEqual(Array.from(back.position), Array.from(position));
  assert.ok(Math.abs(back.color[0] - 0.5) < 0.01);
});

test('the kit command post is one light mesh that fits its 2×2 footprint', () => {
  const prims = load('../src/view3d/models/hq.glb');
  assert.equal(prims.length, 1, 'one mesh, one draw call');
  const f = flatten(prims);
  assert.ok(f.position.length / 9 < 1500, 'stays under 1,500 triangles for phones');
  let minY = Infinity;
  for (let i = 0; i < f.position.length; i += 3) {
    assert.ok(Math.abs(f.position[i]) <= 1, 'within the footprint across');
    assert.ok(Math.abs(f.position[i + 2]) <= 1, 'within the footprint front to back');
    minY = Math.min(minY, f.position[i + 1]);
  }
  assert.ok(Math.abs(minY) < 1e-4, 'stands on the ground');
});

test('the kit machine-gun nest: an emplacement on the ground and a gun that turns about its middle', () => {
  const base = flatten(load('../src/view3d/models/mgBase.glb'));
  const gun = flatten(load('../src/view3d/models/mgGun.glb'));
  for (const f of [base, gun]) assert.ok(f.position.length / 9 < 1000, 'light enough for phones');
  let baseMin = Infinity;
  for (let i = 0; i < base.position.length; i += 3) {
    assert.ok(Math.hypot(base.position[i], base.position[i + 2]) <= 0.5, 'emplacement inside its tile');
    baseMin = Math.min(baseMin, base.position[i + 1]);
  }
  assert.ok(Math.abs(baseMin) < 1e-4, 'emplacement on the ground');
  let front = -Infinity;
  for (let i = 0; i < gun.position.length; i += 3) {
    assert.ok(Math.hypot(gun.position[i], gun.position[i + 2]) <= 0.5, 'the gun turns inside its tile');
    front = Math.max(front, gun.position[i + 2]);
  }
  assert.ok(front > 0.15, 'barrels point forward (+z)');
});

// ---- Asset checks: every model is built, used, light and made from pieces that exist ------------
const recipes = await import('../tools/kit/recipes.mjs');
const here = (p) => new URL(p, import.meta.url);
const files = (dir, ext) => readdirSync(here(dir)).filter((f) => f.endsWith(ext)).map((f) => f.slice(0, -ext.length));
const view3dSource = readdirSync(here('../src/view3d/'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => readFileSync(here(`../src/view3d/${f}`), 'utf8'))
  .join('\n');

test('every kit model has a recipe, and every recipe has its model', () => {
  const models = files('../src/view3d/models/', '.glb').sort();
  assert.deepEqual(models, Object.keys(recipes).sort(), 'run node tools/kit/build-kit.mjs, or remove the stale model');
});

test('every kit model is used by the game, and every one the game asks for exists', () => {
  const asked = new Set([...view3dSource.matchAll(/kitModel\('([^']+)'/g)].map((m) => m[1]));
  const models = new Set(files('../src/view3d/models/', '.glb'));
  for (const name of asked) assert.ok(models.has(name), `the game asks for ${name}.glb, which isn't built`);
  for (const name of models) assert.ok(asked.has(name), `${name}.glb is built but nothing draws it`);
});

test('every kit piece a recipe uses is in assets/kenney, and every piece kept there is used', () => {
  const used = new Set();
  for (const r of Object.values(recipes)) for (const p of r.pieces) used.add(`${p.kit}/${p.name}`);
  for (const key of used) {
    const [kit, name] = key.split('/');
    assert.ok(files(`../assets/kenney/${kit}/`, '.glb').includes(name), `missing kit piece ${key}.glb`);
  }
  for (const kit of readdirSync(here('../assets/kenney/'))) {
    for (const name of files(`../assets/kenney/${kit}/`, '.glb')) assert.ok(used.has(`${kit}/${name}`), `assets/kenney/${kit}/${name}.glb is not used by any recipe`);
  }
});

test('every kit model is one light mesh: under 1,500 triangles and 64 KB, with sound geometry', () => {
  for (const name of files('../src/view3d/models/', '.glb')) {
    const path = `../src/view3d/models/${name}.glb`;
    const prims = load(path);
    assert.equal(prims.length, 1, `${name}: one mesh, one draw call`);
    const f = flatten(prims);
    const tris = f.position.length / 9;
    assert.ok(tris > 0 && tris < 1500, `${name}: ${tris} triangles`);
    assert.ok(statSync(here(path)).size < 64 * 1024, `${name}: ${statSync(here(path)).size} bytes`);
    assert.ok(f.position.every(Number.isFinite) && f.normal.every(Number.isFinite), `${name}: finite`);
    if (!recipes[name].keepOrigin) {
      let minY = Infinity;
      for (let i = 1; i < f.position.length; i += 3) minY = Math.min(minY, f.position[i]);
      assert.ok(Math.abs(minY) < 1e-4, `${name}: stands on the ground`);
    }
  }
});
