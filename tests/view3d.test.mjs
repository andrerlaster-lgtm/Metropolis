// Run with: node --test tests/
// The 3D view's geometry and camera: every kind of building has a model, all geometry is finite and
// faces outward, the ground covers every tile, and the camera behaves (no NaNs, no walking into
// buildings, transitions that finish).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CityState } from '../src/state.js';
import { generateTown } from '../src/generator.js';
import { Simulation } from '../src/simulation.js';
import { STRUCTURES, PALETTE, BUILDING_VARIANTS } from '../src/config.js';
import { hash2 } from '../src/utils.js';
import { crosswalkMask } from '../src/sidewalks.js';
import { MeshData } from '../src/view3d/mesh.js';
import { buildStructure, MODEL_TYPES } from '../src/view3d/models.js';
import { buildGround } from '../src/view3d/ground.js';
import { STORY_TYPES } from '../src/view3d/storybook.js';
import { CameraRig, EYE } from '../src/view3d/rig.js';

const sets = () => ({ ground: new MeshData(), water: new MeshData(), solid: new MeshData(), glass: new MeshData(), lit: new MeshData(), glow: new MeshData(), lamps: [] });
const ctxFor = (t) => ({
  era: 3,
  snow: 0,
  open: true,
  x: t.x,
  y: t.y,
  variant: (s, fb) => BUILDING_VARIANTS[s.variant] || BUILDING_VARIANTS[fb],
  roofHex: (h) => h,
  trees: () => ({ deep: PALETTE.leafDeep, mid: PALETTE.leaf, light: PALETTE.leafLight }),
  snowy: (h) => h,
  hash: hash2,
  growth: { stage: 2, floors: 4 },
  occupancy: 0.6,
});

function checkMesh(md, label) {
  const { position, normal, color } = md.arrays();
  assert.equal(position.length % 9, 0, `${label}: whole triangles`);
  for (const v of position) assert.ok(Number.isFinite(v), `${label}: finite positions`);
  for (let i = 0; i < normal.length; i += 3) {
    const l = Math.hypot(normal[i], normal[i + 1], normal[i + 2]);
    assert.ok(Math.abs(l - 1) < 1e-3, `${label}: unit normals`);
  }
  for (const c of color) assert.ok(c >= 0 && c <= 1.5, `${label}: colours in range`);
}

test('every kind of building, tree and park has a 3D model', () => {
  // The storybook look draws every type itself; models.js is only the safety net for older ones.
  const missing = Object.keys(STRUCTURES).filter((k) => k !== 'road' && !MODEL_TYPES.includes(k) && !STORY_TYPES.includes(k));
  assert.deepEqual(missing, [], 'add a model in src/view3d/storybook.js for new structure types');
});

test('models are finite and sit on their own tile, in every rotation', () => {
  for (const type of MODEL_TYPES) {
    for (let r = 0; r < 4; r++) {
      const o = sets();
      for (const md of [o.solid, o.glass, o.lit, o.glow]) md.place(10.5, 7.5, r);
      const t = { x: 10, y: 7, structure: { type, variant: 'peach', shape: r, floors: 5, residents: 3, damage: r === 3 ? 0.5 : 0 }, workersFilled: 3 };
      assert.ok(buildStructure(o, t, ctxFor(t)), type);
      assert.ok(o.solid.vertices > 0, `${type} has geometry`);
      for (const [name, md] of Object.entries(o)) {
        if (name === 'lamps' || !md.vertices) continue;
        checkMesh(md, `${type}/${name}/r${r}`);
        // Everything stays on (or very near) its own tile, and above ground.
        for (let i = 0; i < md.pos.length; i += 3) {
          assert.ok(md.pos[i] > 9.85 && md.pos[i] < 11.15, `${type}: x on its tile (${md.pos[i]})`);
          assert.ok(md.pos[i + 2] > 6.85 && md.pos[i + 2] < 8.15, `${type}: z on its tile (${md.pos[i + 2]})`);
          assert.ok(md.pos[i + 1] > -0.01, `${type}: above ground`);
        }
      }
    }
  }
});

test('the ground of a whole town is finite, with sidewalks, crossings and lamps', () => {
  const city = new CityState(32, 32);
  generateTown(city, 3);
  new Simulation(city).refresh();
  const o = sets();
  buildGround(o, city, 0, 0, 32, 32, {
    palette: PALETTE,
    snow: 0,
    era: 3,
    grass: (h) => h,
    hash: hash2,
    crossMask: (x, y) => crosswalkMask(city, x, y),
    lamp: (t) => (hash2(t.x, t.y, 7) > 0.5 || t.roadMask === 15 ? null : { gx: t.x + 0.5, gy: t.y + 0.135 }),
  });
  checkMesh(o.ground, 'ground');
  if (o.water.vertices) checkMesh(o.water, 'water');
  // At least one upward quad per land tile.
  assert.ok(o.ground.vertices >= 6 * city.tiles.length, 'covers every tile');
  assert.ok(o.lamps.length > 5, 'street lamps');
  // Raised sidewalks: some geometry sits at kerb height.
  let kerb = 0;
  for (let i = 1; i < o.ground.pos.length; i += 3) if (Math.abs(o.ground.pos[i] - 0.02) < 1e-6) kerb++;
  assert.ok(kerb > 100, 'raised sidewalks');
});

test('the camera never goes NaN, can’t walk into buildings and finishes its moves', () => {
  const rig = new CameraRig();
  rig.setBounds(20, 20);
  rig.lookFrom(NaN, undefined, NaN);
  for (const v of Object.values(rig.pose())) assert.ok(Number.isFinite(v));
  // A building fills tile (5, 5): the street camera stops at its edge.
  rig.blocked = (x, z) => Math.floor(x) === 5 && Math.floor(z) === 5 && x % 1 > 0.04 && x % 1 < 0.96 && z % 1 > 0.04 && z % 1 < 0.96;
  rig.setMode('street', { at: { x: 4.5, z: 5.5 }, yaw: 0 });
  for (let i = 0; i < 60; i++) {
    rig.walk(0.05, 0);
    rig.update(1 / 60);
  }
  assert.ok(!rig.blocked(rig.sg.x, rig.sg.z), 'stopped outside the building');
  assert.ok(rig.sg.x < 5.05, `stopped at the wall (${rig.sg.x})`);
  for (let i = 0; i < 70; i++) rig.update(1 / 60);
  assert.equal(rig.blend, 1, 'the move from orbit to street finished');
  assert.ok(Math.abs(rig.pose().py - EYE) < 1e-9, 'at eye height on the street');
  // Following someone, then back up to orbit.
  let p = { x: 3, z: 3, heading: 0 };
  rig.subject = () => p;
  rig.setMode('follow');
  for (let i = 0; i < 120; i++) {
    p = { x: 3 + i * 0.01, z: 3, heading: 0 };
    rig.update(1 / 60);
  }
  const f = rig.pose();
  assert.ok(f.px < p.x, 'trails behind the person');
  assert.ok(Math.abs(f.lx - p.x) < 0.3, 'looking at them');
  rig.setMode('orbit');
  for (let i = 0; i < 120; i++) rig.update(1 / 60);
  assert.ok(Math.abs(rig.focus().x - p.x) < 0.5, 'orbits where they were');
  for (const v of Object.values(rig.pose())) assert.ok(Number.isFinite(v));
});

test('boxes, prisms, blobs and roofs face outward, in every rotation', () => {
  for (let r = 0; r < 4; r++) {
    const shapes = [
      ['box', (m) => m.box(-0.2, 0, -0.1, 0.2, 0.3, 0.1, [0.5, 0.5, 0.5], { bottom: true }), [0, 0.15, 0]],
      ['prism', (m) => m.prism(0, 0, 0.2, 0.2, 0, 0.3, 8, [0.5, 0.5, 0.5]), [0, 0.15, 0]],
      ['cone', (m) => m.prism(0, 0, 0.2, 0, 0, 0.3, 8, [0.5, 0.5, 0.5]), [0, 0.1, 0]],
      ['blob', (m) => m.blob(0, 0.3, 0, 0.2, 0.15, [0.5, 0.5, 0.5]), [0, 0.3, 0]],
      ['hip', (m) => m.hip(-0.2, -0.1, 0.2, 0.1, 0.3, 0.1, [0.5, 0.5, 0.5], { o: 0 }), [0, 0.3, 0]],
    ];
    for (const [name, make, c] of shapes) {
      const m = new MeshData().place(5, 5, r);
      make(m);
      const ctr = m.tx(c[0], c[2]);
      for (let i = 0; i < m.pos.length; i += 9) {
        const cx = (m.pos[i] + m.pos[i + 3] + m.pos[i + 6]) / 3 - ctr[0];
        const cy = (m.pos[i + 1] + m.pos[i + 4] + m.pos[i + 7]) / 3 - c[1];
        const cz = (m.pos[i + 2] + m.pos[i + 5] + m.pos[i + 8]) / 3 - ctr[1];
        assert.ok(cx * m.nor[i] + cy * m.nor[i + 1] + cz * m.nor[i + 2] > 0, `${name} r${r}: triangle ${i / 9} faces in`);
      }
    }
    // A gable roof's slopes face up and out; its undersides face down.
    const g = new MeshData().place(5, 5, r);
    g.gable(-0.2, -0.15, 0.2, 0.15, 0.3, 0.2, [0.6, 0.3, 0.3], [0.9, 0.9, 0.9], { alongZ: r % 2 === 1 });
    let up = 0;
    let down = 0;
    for (let i = 1; i < g.nor.length; i += 9) (g.nor[i] > 0.1 ? up++ : g.nor[i] < -0.1 ? down++ : 0);
    assert.equal(up, 4, 'two slopes of two triangles');
    assert.equal(down, 4, 'and their undersides');
  }
});
