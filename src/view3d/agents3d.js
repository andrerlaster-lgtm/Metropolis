// People and vehicles in 3D. They are the same walkers and cars the overhead view draws (agents.js),
// drawn here with instanced meshes: one draw call per body part for everyone in town. People swing
// their arms and legs as they walk, wear their own shirt, trousers, hair or hat, and carry umbrellas
// in the rain. Your Life character has a glowing ring at their feet.

import * as THREE from './vendor/three.module.min.js';
import { MeshData, linear } from './mesh.js';

const MAX_PEOPLE = 160;
const MAX_CARS = 90;
const WHITE = new THREE.Color(1, 1, 1);
const MOOD = { good: '#7fc4ad', caution: '#ffcf6e', bad: '#ff8f7e' };
const EYE = '#2b2430';
const BOOT = '#3b2a20';
// A steady pseudo-random number 0..1 for one walker and one purpose, so a person always looks the same.
const hv = (w, k) => {
  const x = Math.sin(((w.phase || 0) + k * 1.37) * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

// A rounded limb whose top is at the origin, so it hangs from a hip or shoulder and swings from there.
function hanging(w, h, d) {
  const g = new THREE.CylinderGeometry(w / 2, (w / 2) * 0.85, h, 6);
  g.translate(0, -h / 2, 0);
  g.scale(1, 1, d / w);
  return g;
}

// A torso: wider at the shoulders than the waist, flattened front to back (people face +x).
function torsoGeometry() {
  const g = new THREE.CylinderGeometry(0.024, 0.019, 0.05, 8);
  g.scale(0.68, 1, 1);
  return g;
}

export class People3D {
  constructor(scene) {
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const make = (geo) => {
      const m = new THREE.InstancedMesh(geo, mat, MAX_PEOPLE);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = true;
      m.setColorAt(0, WHITE); // colours must exist before the first draw, or the shader leaves them out
      m.count = 0;
      m.frustumCulled = false;
      scene.add(m);
      return m;
    };
    this.torso = make(torsoGeometry());
    this.head = make(new THREE.IcosahedronGeometry(0.02, 1));
    this.hair = make(new THREE.SphereGeometry(0.0215, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.55));
    this.hat = make(hatGeometry());
    this.legL = make(hanging(0.016, 0.052, 0.016));
    this.legR = make(hanging(0.016, 0.052, 0.016));
    this.armL = make(hanging(0.011, 0.044, 0.011));
    this.armR = make(hanging(0.011, 0.044, 0.011));
    // Period details: a long skirt on some, boots, hands, eyes and a bun of hair.
    this.skirt = make(new THREE.CylinderGeometry(0.02, 0.036, 0.052, 10).translate(0, -0.026, 0));
    this.bootL = make(new THREE.BoxGeometry(0.026, 0.014, 0.02).translate(0.004, -0.047, 0));
    this.bootR = make(new THREE.BoxGeometry(0.026, 0.014, 0.02).translate(0.004, -0.047, 0));
    this.handL = make(new THREE.IcosahedronGeometry(0.0072, 0).translate(0, -0.046, 0));
    this.handR = make(new THREE.IcosahedronGeometry(0.0072, 0).translate(0, -0.046, 0));
    this.eyes = make(eyesGeometry());
    this.bun = make(new THREE.IcosahedronGeometry(0.009, 1));
    this.umbrella = make(new THREE.ConeGeometry(0.06, 0.03, 8, 1, true).translate(0, 0.015, 0));
    this.umbrella.material = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    this.dot = make(new THREE.IcosahedronGeometry(0.008, 0));
    this.dot.castShadow = false;
    this.dot.material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    // Soft round shadows on the ground for when real shadows are off.
    const blobTex = blobTexture();
    this.blob = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.07, 0.07).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, color: 0x342c60, opacity: 0.35 }),
      MAX_PEOPLE
    );
    this.blob.count = 0;
    this.blob.frustumCulled = false;
    scene.add(this.blob);
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.006, 6, 24).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
    this.ring.visible = false;
    scene.add(this.ring);
    this.parts = [this.torso, this.head, this.hair, this.hat, this.legL, this.legR, this.armL, this.armR, this.skirt, this.bootL, this.bootR, this.handL, this.handR, this.eyes, this.bun, this.umbrella, this.dot];
    this.m = new THREE.Matrix4();
    this.base = new THREE.Matrix4();
    this.tmp = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3();
    this.c = new THREE.Color();
    this.e = new THREE.Euler();
    this.colors = new Map();
    this.list = []; // who is drawn, in instance order, for picking
  }

  color(hex) {
    let c = this.colors.get(hex);
    if (!c) {
      c = new THREE.Color(hex);
      this.colors.set(hex, c);
    }
    return c;
  }

  // Place a part: base × translate(x, y, z) × rotate about z (a swing, forward is +x) × scale.
  put(mesh, i, x, y, z, swing = 0, sx = 1, sy = 1, sz = 1) {
    this.e.set(0, 0, swing);
    this.q.setFromEuler(this.e);
    this.v.set(x, y, z);
    this.s.set(sx, sy, sz);
    this.tmp.compose(this.v, this.q, this.s);
    this.m.multiplyMatrices(this.base, this.tmp);
    mesh.setMatrixAt(i, this.m);
  }

  update(walkers, time, { wet = 0, lit = 1, softShadows = true, paused = false } = {}) {
    const counts = new Map(this.parts.map((p) => [p, 0]));
    const next = (mesh) => {
      const n = counts.get(mesh);
      counts.set(mesh, n + 1);
      return n;
    };
    let blobs = 0;
    this.list.length = 0;
    this.ring.visible = false;
    for (const w of walkers) {
      if (w.alpha < 0.35 || this.list.length >= MAX_PEOPLE) continue;
      const scale = (w.hero ? (w.child ? 0.95 : 1.2) : w.build || 1) * Math.min(1, 0.6 + w.alpha * 0.4);
      const moving = w.moving && !paused; // nobody walks on the spot while the game is paused
      const swing = moving ? Math.sin(time * 9 + w.phase) * 0.55 : 0;
      const bob = moving ? Math.abs(Math.sin(time * 9 + w.phase)) * 0.004 : 0;
      this.q.setFromAxisAngle(this.v.set(0, 1, 0), -(w.heading || 0));
      this.base.compose(this.v.set(w.gx, bob, w.gy), this.q, this.s.set(scale, scale, scale));
      const id = this.list.length;
      this.list.push(w);
      let i = next(this.torso);
      this.put(this.torso, i, 0, 0.077, 0);
      this.torso.setColorAt(i, this.color(w.shirt));
      i = next(this.head);
      this.put(this.head, i, 0, 0.123, 0);
      this.head.setColorAt(i, this.color(w.skin));
      i = next(this.eyes);
      this.put(this.eyes, i, 0, 0.125, 0);
      this.eyes.setColorAt(i, this.color(EYE));
      // A few adults wear a long skirt over the legs; some hair is pinned up in a bun.
      if (!w.child && hv(w, 1) < 0.42) {
        i = next(this.skirt);
        this.put(this.skirt, i, 0, 0.075, 0);
        this.skirt.setColorAt(i, this.color(w.pants || '#5b6a8f'));
      }
      if (!w.hat && w.hair && hv(w, 2) < 0.3) {
        i = next(this.bun);
        this.put(this.bun, i, -0.019, 0.137, 0);
        this.bun.setColorAt(i, this.color(w.hair));
      }
      if (w.hat) {
        i = next(this.hat);
        this.put(this.hat, i, 0, 0.133, 0);
        this.hat.setColorAt(i, this.color(w.hat));
      } else if (w.hair) {
        i = next(this.hair);
        this.put(this.hair, i, -0.002, 0.125, 0, -0.25);
        this.hair.setColorAt(i, this.color(w.hair));
      }
      for (const [mesh, side, sw] of [
        [this.legL, -0.009, swing],
        [this.legR, 0.009, -swing],
      ]) {
        i = next(mesh);
        this.put(mesh, i, 0, 0.053, side, sw);
        mesh.setColorAt(i, this.color(w.pants || '#5b6a8f'));
        const boot = mesh === this.legL ? this.bootL : this.bootR;
        i = next(boot);
        this.put(boot, i, 0, 0.053, side, sw);
        boot.setColorAt(i, this.color(BOOT));
      }
      for (const [mesh, side, sw] of [
        [this.armL, -0.028, -swing * 0.8],
        [this.armR, 0.028, swing * 0.8],
      ]) {
        i = next(mesh);
        this.put(mesh, i, 0, 0.1, side, sw);
        mesh.setColorAt(i, this.color(w.shirt));
        const hand = mesh === this.armL ? this.handL : this.handR;
        i = next(hand);
        this.put(hand, i, 0, 0.1, side, sw);
        hand.setColorAt(i, this.color(w.skin));
      }
      if (wet > 0.3) {
        i = next(this.umbrella);
        this.put(this.umbrella, i, 0, 0.165, 0.012);
        this.umbrella.setColorAt(i, this.color(w.umbrella || w.shirt));
      }
      if (w.townId && w.mood != null) {
        i = next(this.dot);
        this.put(this.dot, i, 0, 0.17, 0);
        this.dot.setColorAt(i, this.color(w.mood >= 0.55 ? MOOD.good : w.mood >= 0.35 ? MOOD.caution : MOOD.bad));
      }
      if (softShadows) {
        this.m.makeTranslation(w.gx, 0.004, w.gy);
        this.blob.setMatrixAt(blobs++, this.m);
      }
      if (w.hero) {
        this.ring.visible = true;
        this.ring.position.set(w.gx, 0.008, w.gy);
        this.ring.material.color.set(w.shirt);
        this.ring.material.opacity = 0.6 + 0.35 * Math.sin(time * 3);
        this.ring.scale.setScalar(1 + 0.12 * Math.sin(time * 3));
      }
      void id;
    }
    for (const p of this.parts) {
      p.count = counts.get(p);
      p.instanceMatrix.needsUpdate = true;
      if (p.instanceColor) p.instanceColor.needsUpdate = true;
    }
    this.blob.count = blobs;
    this.blob.instanceMatrix.needsUpdate = true;
    void lit;
  }
}

// Two small dark eyes on the face (people face +x).
function eyesGeometry() {
  const a = new THREE.IcosahedronGeometry(0.0034, 0).translate(0.0185, 0.003, -0.0072).toNonIndexed();
  const b = new THREE.IcosahedronGeometry(0.0034, 0).translate(0.0185, 0.003, 0.0072).toNonIndexed();
  return mergeGeos([a, b]);
}

// Join non-indexed geometries into one (positions and normals only).
function mergeGeos(list) {
  const g = new THREE.BufferGeometry();
  const names = list.every((x) => x.getAttribute('color')) ? ['position', 'normal', 'color'] : ['position', 'normal'];
  for (const name of names) {
    const arrays = list.map((x) => x.getAttribute(name).array);
    const out = new Float32Array(arrays.reduce((n, a) => n + a.length, 0));
    let at = 0;
    for (const a of arrays) {
      out.set(a, at);
      at += a.length;
    }
    g.setAttribute(name, new THREE.BufferAttribute(out, 3));
  }
  return g;
}

// A little hat: a crown with a brim.
function hatGeometry() {
  const crown = new THREE.CylinderGeometry(0.017, 0.019, 0.018, 8).translate(0, 0.009, 0).toNonIndexed();
  const brim = new THREE.CylinderGeometry(0.03, 0.03, 0.003, 10).toNonIndexed();
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal']) {
    const a = crown.getAttribute(name).array;
    const b = brim.getAttribute(name).array;
    const out = new Float32Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    g.setAttribute(name, new THREE.BufferAttribute(out, 3));
  }
  return g;
}

function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Turn MeshData into a geometry that instancing can tint (vertex colours × each car's colour).
function geometryOf(md) {
  const a = md.arrays();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(a.color, 3));
  return g;
}

// A slanted block: the four corners of its foot (lo) and of its top (hi), each [x, y, z], ordered
// front-left (+z, low x), front-right, back-right, back-left as the walls of MeshData.box are.
function slab(m, lo, hi, color) {
  m.quad(lo[0], lo[1], hi[1], hi[0], color);
  m.quad(lo[1], lo[2], hi[2], hi[1], color);
  m.quad(lo[2], lo[3], hi[3], hi[2], color);
  m.quad(lo[3], lo[0], hi[0], hi[3], color);
  m.quad(hi[3], hi[0], hi[1], hi[2], color);
  m.quad(lo[3], lo[2], lo[1], lo[0], color);
}

// Give a non-indexed geometry one flat colour (linear rgb) so pieces can be merged into one tintable mesh.
function paint(geo, rgb) {
  const n = geo.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set(rgb, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

// An early motor car facing +x (think Model T): a tub body and bonnet in the car's colour, a brass
// radiator and lamps, a cloth roof on thin posts, running boards, mudguards and a bench seat.
function carGeometry() {
  const m = new MeshData();
  const body = [1, 1, 1];
  const dark = linear('#2f2a2e');
  const brass = linear('#c79a3a');
  const cloth = linear('#7a6a55');
  const leather = linear('#6b4a33');
  const glass = linear('#9fb4c4');
  m.box(-0.115, 0.022, -0.04, 0.12, 0.032, 0.04, dark, { ao: 1 }); // chassis
  m.box(-0.105, 0.032, -0.05, 0.02, 0.064, 0.05, body, { ao: 0.9 }); // tub
  m.box(0.02, 0.036, -0.034, 0.112, 0.07, 0.034, body, { ao: 0.9 }); // bonnet
  m.box(0.112, 0.036, -0.028, 0.12, 0.068, 0.028, brass, { ao: 1 }); // radiator
  for (const z of [-0.036, 0.036]) m.box(0.098, 0.068, z - 0.006, 0.108, 0.078, z + 0.006, brass, { ao: 1 }); // lamps
  m.box(-0.098, 0.064, -0.04, -0.088, 0.094, 0.04, leather, { ao: 1 }); // seat back
  m.box(-0.088, 0.064, -0.04, -0.03, 0.074, 0.04, leather, { ao: 1 }); // seat
  for (const x of [-0.1, 0.015]) for (const z of [-0.046, 0.04]) m.box(x, 0.064, z, x + 0.006, 0.108, z + 0.006, dark, { ao: 1 }); // roof posts
  m.box(-0.112, 0.108, -0.054, 0.026, 0.115, 0.054, cloth, { ao: 1 }); // cloth roof
  m.quad([0.0185, 0.07, 0.04], [0.0185, 0.07, -0.04], [0.0185, 0.104, -0.04], [0.0185, 0.104, 0.04], glass); // windscreen
  for (const sz of [-1, 1]) {
    const z0 = sz > 0 ? 0.05 : -0.066;
    m.box(-0.05, 0.034, z0, 0.05, 0.04, z0 + 0.016, dark, { ao: 1 }); // running board
    for (const x of [-0.07, 0.07]) m.box(x - 0.03, 0.05, z0, x + 0.03, 0.055, z0 + 0.016, dark, { ao: 1 }); // mudguards
  }
  return geometryOf(m);
}

// A car tyre and hub, axle along z, centred on its own middle.
function carWheelGeometry() {
  const m = new MeshData();
  m.prism(0, 0, 0.024, 0.024, -0.006, 0.006, 12, linear('#26222a'), { ao: 1 });
  m.prism(0, 0, 0.012, 0.012, -0.0075, 0.0075, 10, linear('#d9cdb0'), { ao: 1 });
  return geometryOf(m).rotateX(Math.PI / 2);
}

// A farm cart facing +x (behind the horse): a slatted bed in the cart's colour, a bench seat, two sacks
// and a pair of shafts running forward to the horse.
function cartGeometry() {
  const m = new MeshData();
  const wood = [1, 1, 1];
  const plank = linear('#7a5a3a');
  const sack = linear('#e8d9a8');
  m.box(-0.13, 0.05, -0.05, 0.03, 0.058, 0.05, wood, { ao: 1 });
  for (const [y0, y1] of [[0.058, 0.07], [0.078, 0.09]]) {
    for (const z of [-0.05, 0.043]) m.box(-0.13, y0, z, 0.03, y1, z + 0.007, wood, { ao: 1 });
    m.box(-0.13, y0, -0.05, -0.123, y1, 0.05, wood, { ao: 1 });
  }
  for (const x of [-0.13, 0.024]) for (const z of [-0.052, 0.046]) m.box(x, 0.05, z, x + 0.006, 0.094, z + 0.006, plank, { ao: 1 }); // stakes
  m.box(-0.0, 0.058, -0.043, 0.03, 0.072, 0.043, plank, { ao: 1 }); // bench seat
  m.blob(-0.09, 0.07, -0.01, 0.026, 0.02, sack);
  m.blob(-0.05, 0.068, 0.02, 0.022, 0.017, sack);
  m.box(-0.064, 0.026, -0.058, -0.056, 0.034, 0.058, plank, { ao: 1 }); // axle
  for (const z of [-0.022, 0.016]) m.box(0.03, 0.062, z, 0.13, 0.068, z + 0.006, plank, { ao: 1 }); // shafts
  return geometryOf(m);
}

// A spoked cart wheel in the x-y plane: a rim, six spokes and a hub (white where the cart tints, so it
// takes the cart's colour like the bed does).
function cartWheelGeometry() {
  const wood = linear('#6b4a33');
  const parts = [];
  parts.push(paint(new THREE.TorusGeometry(0.03, 0.004, 5, 14).toNonIndexed(), wood));
  for (let i = 0; i < 3; i++) {
    parts.push(paint(new THREE.BoxGeometry(0.058, 0.004, 0.004).rotateZ((i * Math.PI) / 3).toNonIndexed(), wood));
  }
  parts.push(paint(new THREE.CylinderGeometry(0.007, 0.007, 0.012, 8).rotateX(Math.PI / 2).toNonIndexed(), linear('#3b2a20')));
  return mergeGeos(parts);
}

// A horse facing +x: barrel body, sheared neck and head, dark mane and tail (legs are separate so they can swing).
function horseGeometry() {
  const m = new MeshData();
  const c = [1, 1, 1];
  const hair = [0.22, 0.2, 0.2];
  m.box(0.075, 0.058, -0.02, 0.15, 0.102, 0.02, c, { ao: 0.9 }); // barrel
  m.box(0.14, 0.06, -0.022, 0.166, 0.104, 0.022, c, { ao: 0.9 }); // chest
  // Neck, leaning forward.
  slab(m, [[0.138, 0.09, 0.013], [0.166, 0.09, 0.013], [0.166, 0.09, -0.013], [0.138, 0.09, -0.013]], [[0.166, 0.148, 0.011], [0.19, 0.148, 0.011], [0.19, 0.148, -0.011], [0.166, 0.148, -0.011]], c);
  // Head, nose pointing down and forward.
  slab(m, [[0.2, 0.116, 0.008], [0.216, 0.116, 0.008], [0.216, 0.116, -0.008], [0.2, 0.116, -0.008]], [[0.182, 0.158, 0.011], [0.2, 0.158, 0.011], [0.2, 0.158, -0.011], [0.182, 0.158, -0.011]], c);
  for (const z of [-0.007, 0.007]) m.prism(0.188, z, 0.0045, 0.0015, 0.158, 0.172, 4, c, { ao: 1 }); // ears
  // Mane along the back of the neck.
  slab(m, [[0.13, 0.092, 0.004], [0.14, 0.092, 0.004], [0.14, 0.092, -0.004], [0.13, 0.092, -0.004]], [[0.16, 0.15, 0.004], [0.17, 0.15, 0.004], [0.17, 0.15, -0.004], [0.16, 0.15, -0.004]], hair);
  // Tail hanging off the rump.
  slab(m, [[0.052, 0.045, 0.004], [0.066, 0.045, 0.004], [0.066, 0.045, -0.004], [0.052, 0.045, -0.004]], [[0.07, 0.098, 0.005], [0.08, 0.098, 0.005], [0.08, 0.098, -0.005], [0.07, 0.098, -0.005]], hair);
  // Harness: a collar and a strap along the barrel.
  m.box(0.156, 0.08, -0.024, 0.162, 0.108, 0.024, linear('#4a3526'), { ao: 1 });
  m.box(0.1, 0.1, -0.021, 0.106, 0.104, 0.021, linear('#4a3526'), { ao: 1 });
  return geometryOf(m);
}

// One horse leg hanging from the hip (origin at the top), with a dark hoof.
function legGeometry() {
  const m = new MeshData();
  m.box(-0.0055, -0.056, -0.0055, 0.0055, 0, 0.0055, [1, 1, 1], { ao: 1 });
  m.box(-0.0062, -0.056, -0.0062, 0.0062, -0.047, 0.0062, linear('#2a2220'), { ao: 1 });
  return geometryOf(m);
}

// Cars, vintage cars and horse-drawn carts, on the right-hand lane, with headlights after dark.
export class Cars3D {
  constructor(scene) {
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    const make = (geo, material = mat, shadow = true, cap = MAX_CARS) => {
      const m = new THREE.InstancedMesh(geo, material, cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = shadow;
      m.setColorAt(0, WHITE);
      m.count = 0;
      m.frustumCulled = false;
      scene.add(m);
      return m;
    };
    this.body = make(carGeometry());
    this.cart = make(cartGeometry());
    this.horse = make(horseGeometry());
    this.carWheels = make(carWheelGeometry(), mat, true, MAX_CARS * 4);
    this.cartWheels = make(cartWheelGeometry(), mat, true, MAX_CARS * 2);
    this.legs = make(legGeometry(), mat, true, MAX_CARS * 4);
    this.lights = make(new THREE.BoxGeometry(0.006, 0.012, 0.08).translate(0.127, 0.05, 0), new THREE.MeshBasicMaterial({ color: 0xfff1c4 }), false);
    this.tail = make(new THREE.BoxGeometry(0.006, 0.01, 0.06).translate(-0.109, 0.05, 0), new THREE.MeshBasicMaterial({ color: 0xff7a6e }), false);
    this.all = [this.body, this.cart, this.horse, this.carWheels, this.cartWheels, this.legs, this.lights, this.tail];
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.q2 = new THREE.Quaternion();
    this.v = new THREE.Vector3();
    this.p = new THREE.Vector3();
    this.s = new THREE.Vector3(1, 1, 1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.zAxis = new THREE.Vector3(0, 0, 1);
    this.colors = new Map();
  }

  color(hex) {
    let c = this.colors.get(hex);
    if (!c) this.colors.set(hex, (c = new THREE.Color(hex)));
    return c;
  }

  // Put instance i of `mesh` at local offset (x, y, z) of the vehicle at p, turned by the vehicle's
  // heading plus `spin` about the vehicle's own sideways axis (wheels roll, legs swing).
  part(mesh, i, p, x, y, z, spin) {
    this.v.set(x, y, z).applyQuaternion(this.q).add(p);
    this.q2.setFromAxisAngle(this.zAxis, spin);
    this.q2.premultiply(this.q);
    this.m.compose(this.v, this.q2, this.s);
    mesh.setMatrixAt(i, this.m);
    mesh.setColorAt(i, WHITE);
  }

  update(agents, { night = 0 } = {}) {
    const n = { car: 0, cart: 0 };
    for (const c of agents.cars) {
      if (c.alpha < 0.3) continue;
      const p = agents.carPose(c);
      const heading = Math.atan2(p.dy, p.dx);
      this.q.setFromAxisAngle(this.up, -heading);
      this.p.set(p.gx, 0, p.gy);
      this.m.compose(this.p, this.q, this.s);
      // Distance driven along the heading: wheels roll and the horse's legs swing with it.
      const run = p.gx * Math.cos(heading) + p.gy * Math.sin(heading);
      if (c.kind === 'cart') {
        const i = n.cart++;
        if (i >= MAX_CARS) continue;
        this.cart.setMatrixAt(i, this.m);
        this.cart.setColorAt(i, this.color(c.cartColor || '#b88a5a'));
        this.horse.setMatrixAt(i, this.m);
        const coat = this.color(c.horse || '#8a5d3b');
        this.horse.setColorAt(i, coat);
        const roll = -run / 0.03;
        this.part(this.cartWheels, i * 2, this.p, -0.06, 0.03, -0.058, roll);
        this.part(this.cartWheels, i * 2 + 1, this.p, -0.06, 0.03, 0.058, roll);
        const swing = Math.sin(run * 38) * 0.5;
        const legs = [[0.155, 0.013, swing], [0.155, -0.013, -swing], [0.09, 0.013, -swing], [0.09, -0.013, swing]];
        legs.forEach(([x, z, a], k) => {
          this.part(this.legs, i * 4 + k, this.p, x, 0.058, z, a);
          this.legs.setColorAt(i * 4 + k, coat);
        });
        continue;
      }
      const i = n.car++;
      if (i >= MAX_CARS) continue;
      for (const mesh of [this.body, this.lights, this.tail]) mesh.setMatrixAt(i, this.m);
      this.body.setColorAt(i, this.color(c.color || '#ff9f8f'));
      const roll = -run / 0.024;
      let k = i * 4;
      for (const x of [-0.07, 0.07]) for (const z of [-0.057, 0.057]) this.part(this.carWheels, k++, this.p, x, 0.024, z, roll);
    }
    this.body.count = Math.min(MAX_CARS, n.car);
    this.carWheels.count = this.body.count * 4;
    this.lights.count = this.tail.count = night > 0.35 ? Math.min(MAX_CARS, n.car) : 0;
    this.cart.count = this.horse.count = Math.min(MAX_CARS, n.cart);
    this.cartWheels.count = this.cart.count * 2;
    this.legs.count = this.cart.count * 4;
    for (const mesh of this.all) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
