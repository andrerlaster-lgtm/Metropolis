import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
