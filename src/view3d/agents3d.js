// People and vehicles in 3D. They are the same walkers and cars the overhead view draws (agents.js),
// drawn here with instanced meshes: one draw call per body part for everyone in town. People are
// rounded storybook figures with big heads (bigger still on children); they swing their arms and legs,
// bounce and lean as they walk, breathe and look about when standing, wear their own shirt, trousers or
// skirt, hair or hat, and carry umbrellas in the rain. Your Life character has a glowing ring at their feet.

import * as THREE from './vendor/three.module.min.js';
import { MeshData, linear } from './mesh.js';
import { mergeGeos } from './mergeGeo.js';

const MAX_PEOPLE = 160;
const MAX_CARS = 90;
const WHITE = new THREE.Color(1, 1, 1);
const MOOD = { good: '#7fc4ad', caution: '#ffcf6e', bad: '#ff8f7e' };
const EYE = '#2b2430';
const BOOT = '#3b2a20';
const CHEEK = '#f08f86';
const SOCK = '#f2ead8';
// A steady pseudo-random number 0..1 for one walker and one purpose, so a person always looks the same.
const hv = (w, k) => {
  const x = Math.sin(((w.phase || 0) + k * 1.37) * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

// ---- Townsfolk ----------------------------------------------------------------------------------
// Little storybook people: a big round head, a soft rounded body, capsule arms and legs with round
// hands and shoes, a hair cap (or a hat), and trousers or a bell skirt. People face +x; heights are in
// tiles, ground at 0. Every part is smooth-shaded and lit like the buildings.
const HIP_Y = 0.042;
const SHOULDER_Y = 0.086;
const HEAD_Y = 0.122;
const HEAD_R = 0.0255;
const lathe = (pts, n = 9, sx = 0.8) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), n).scale(sx, 1, 1);
// A capsule hanging from the origin (a limb that swings from its top).
const limb = (r, len) => new THREE.CapsuleGeometry(r, len, 1, 6).translate(0, -(len / 2 + r), 0);

function peopleGeometry() {
  return {
    torso: lathe([[0, 0.046], [0.0155, 0.0465], [0.0188, 0.055], [0.0198, 0.067], [0.0193, 0.077], [0.0172, 0.0855], [0.0115, 0.0925], [0.0055, 0.0962], [0, 0.097]]),
    hips: lathe([[0, 0.034], [0.0125, 0.0345], [0.0172, 0.0395], [0.0184, 0.047], [0.0178, 0.054], [0, 0.0545]]),
    skirt: lathe([[0, 0.0095], [0.0262, 0.0095], [0.0298, 0.0125], [0.029, 0.0185], [0.0245, 0.036], [0.0205, 0.052], [0.0172, 0.0615], [0, 0.062]], 11, 0.86),
    leg: limb(0.0066, 0.0245),
    shoe: new THREE.SphereGeometry(1, 6, 4).scale(0.0108, 0.0066, 0.0082).translate(0.0035, -0.0368, 0),
    arm: limb(0.0054, 0.021),
    hand: new THREE.SphereGeometry(0.0068, 6, 4).translate(0.001, -0.0335, 0),
    // The head is drawn around its own centre so a child's can be bigger: a round face, a button nose
    // and ears.
    head: mergeGeos([
      new THREE.SphereGeometry(HEAD_R, 11, 7).scale(0.96, 1, 1),
      new THREE.SphereGeometry(0.0036, 5, 3).translate(HEAD_R * 0.96, -0.003, 0),
      new THREE.SphereGeometry(0.0055, 5, 3).scale(0.6, 1, 1).translate(-0.001, -0.001, HEAD_R * 0.98),
      new THREE.SphereGeometry(0.0055, 5, 3).scale(0.6, 1, 1).translate(-0.001, -0.001, -HEAD_R * 0.98),
    ]),
    // Hair: a cap over the top and back of the head with a soft fringe, and a bun for some.
    hair: mergeGeos([
      // The cap tips back (its front edge rises above the eyes, the back falls to the nape); the fringe
      // is a short band over the forehead (+x is the face).
      new THREE.SphereGeometry(HEAD_R * 1.08, 11, 4, 0, Math.PI * 2, 0, Math.PI * 0.5).rotateZ(0.3),
      new THREE.SphereGeometry(HEAD_R * 1.12, 8, 2, Math.PI * 0.62, Math.PI * 0.76, Math.PI * 0.22, Math.PI * 0.2),
    ]),
    bun: new THREE.SphereGeometry(0.0112, 7, 5).translate(-0.024, 0.012, 0),
    hat: mergeGeos([
      new THREE.CylinderGeometry(0.0185, 0.0215, 0.018, 10).translate(0, HEAD_R * 0.72 + 0.009, 0),
      new THREE.SphereGeometry(0.0185, 10, 2, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1, 0.35, 1).translate(0, HEAD_R * 0.72 + 0.018, 0),
      new THREE.CylinderGeometry(0.036, 0.036, 0.0032, 12).translate(0, HEAD_R * 0.72, 0),
    ]),
    eyes: mergeGeos([
      new THREE.SphereGeometry(0.0043, 5, 4).scale(0.6, 1.15, 1).translate(HEAD_R * 0.9, 0.002, -0.0092),
      new THREE.SphereGeometry(0.0043, 5, 4).scale(0.6, 1.15, 1).translate(HEAD_R * 0.9, 0.002, 0.0092),
    ]),
    cheeks: mergeGeos([
      new THREE.SphereGeometry(0.0042, 5, 3).scale(0.4, 0.7, 1).translate(HEAD_R * 0.86, -0.0065, -0.0145),
      new THREE.SphereGeometry(0.0042, 5, 3).scale(0.4, 0.7, 1).translate(HEAD_R * 0.86, -0.0065, 0.0145),
    ]),
  };
}

export class People3D {
  constructor(scene) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0 });
    this.materials = [mat]; // the 3D view gives these its soft environment light (view3d.js)
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
    const G = peopleGeometry();
    this.torso = make(G.torso);
    this.hips = make(G.hips);
    this.head = make(G.head);
    this.hair = make(G.hair);
    this.hat = make(G.hat);
    this.legL = make(G.leg);
    this.legR = make(G.leg);
    this.armL = make(G.arm);
    this.armR = make(G.arm);
    this.skirt = make(G.skirt);
    this.bootL = make(G.shoe);
    this.bootR = make(G.shoe);
    this.handL = make(G.hand);
    this.handR = make(G.hand);
    this.eyes = make(G.eyes);
    this.cheeks = make(G.cheeks);
    this.cheeks.castShadow = false;
    this.eyes.castShadow = false;
    this.bun = make(G.bun);
    this.umbrella = make(new THREE.ConeGeometry(0.06, 0.03, 8, 1, true).translate(0, 0.015, 0));
    this.umbrella.material = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.6 });
    this.materials.push(this.umbrella.material);
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
    this.parts = [this.torso, this.hips, this.head, this.hair, this.hat, this.legL, this.legR, this.armL, this.armR, this.skirt, this.bootL, this.bootR, this.handL, this.handR, this.eyes, this.cheeks, this.bun, this.umbrella, this.dot];
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

  // Place a part: base × translate(x, y, z) × rotate (turn about y, then swing about z: forward is +x)
  // × scale.
  put(mesh, i, x, y, z, swing = 0, sx = 1, sy = 1, sz = sx, turn = 0) {
    this.e.set(0, turn, swing, 'YXZ');
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
      const step = time * 9 + w.phase;
      const swing = moving ? Math.sin(step) * 0.6 : 0;
      // A little bounce and forward lean while walking; at rest a slow breath and a look around.
      const bob = moving ? Math.abs(Math.sin(step)) * 0.006 : 0;
      const lean = moving ? 0.09 : 0;
      const breath = paused ? 0 : moving ? 0 : Math.sin(time * 2.2 + w.phase * 3) * 0.012;
      const look = moving || paused ? 0 : Math.sin(time * 0.6 + w.phase * 5) * 0.35;
      const nod = moving ? Math.sin(step * 2) * 0.05 : 0;
      this.q.setFromAxisAngle(this.v.set(0, 1, 0), -(w.heading || 0));
      this.q2 = this.q2 || new THREE.Quaternion();
      this.q2.setFromAxisAngle(this.v.set(0, 0, 1), -lean);
      this.q.multiply(this.q2);
      this.base.compose(this.v.set(w.gx, bob, w.gy), this.q, this.s.set(scale, scale, scale));
      const id = this.list.length;
      this.list.push(w);
      // Children have bigger heads for their size, as in picture books.
      const hk = w.child ? 1.22 : 1;
      const skirt = !w.child && hv(w, 1) < 0.42;
      let i = next(this.torso);
      this.put(this.torso, i, 0, 0, 0, 0, 1, 1 + breath, 1);
      this.torso.setColorAt(i, this.color(w.shirt));
      if (!skirt) {
        i = next(this.hips);
        this.put(this.hips, i, 0, 0, 0);
        this.hips.setColorAt(i, this.color(w.pants || '#5b6a8f'));
      }
      i = next(this.head);
      this.put(this.head, i, 0, HEAD_Y, 0, nod, hk, hk, hk, look);
      this.head.setColorAt(i, this.color(w.skin));
      i = next(this.eyes);
      this.put(this.eyes, i, 0, HEAD_Y, 0, nod, hk, hk, hk, look);
      this.eyes.setColorAt(i, this.color(EYE));
      i = next(this.cheeks);
      this.put(this.cheeks, i, 0, HEAD_Y, 0, nod, hk, hk, hk, look);
      this.cheeks.setColorAt(i, this.color(CHEEK));
      // A few adults wear a long skirt over the legs; some hair is pinned up in a bun.
      if (skirt) {
        i = next(this.skirt);
        this.put(this.skirt, i, 0, 0, 0, 0, 1, 1, 1);
        this.skirt.setColorAt(i, this.color(w.pants || '#5b6a8f'));
      }
      if (!w.hat && w.hair && hv(w, 2) < 0.3) {
        i = next(this.bun);
        this.put(this.bun, i, 0, HEAD_Y, 0, nod, hk, hk, hk, look);
        this.bun.setColorAt(i, this.color(w.hair));
      }
      if (w.hat) {
        i = next(this.hat);
        this.put(this.hat, i, 0, HEAD_Y, 0, nod, hk, hk, hk, look);
        this.hat.setColorAt(i, this.color(w.hat));
      } else if (w.hair) {
        i = next(this.hair);
        this.put(this.hair, i, 0, HEAD_Y, 0, nod, hk, hk, hk, look);
        this.hair.setColorAt(i, this.color(w.hair));
      }
      // Under a skirt the legs swing less, as in a shorter step.
      const legSwing = skirt ? swing * 0.6 : swing;
      for (const [mesh, side, sw] of [
        [this.legL, -0.0088, legSwing],
        [this.legR, 0.0088, -legSwing],
      ]) {
        i = next(mesh);
        this.put(mesh, i, 0, HIP_Y, side, sw);
        mesh.setColorAt(i, this.color(skirt ? SOCK : w.pants || '#5b6a8f'));
        const boot = mesh === this.legL ? this.bootL : this.bootR;
        i = next(boot);
        this.put(boot, i, 0, HIP_Y, side, sw);
        boot.setColorAt(i, this.color(BOOT));
      }
      for (const [mesh, side, sw] of [
        [this.armL, -0.0215, -swing * 0.75],
        [this.armR, 0.0215, swing * 0.75],
      ]) {
        i = next(mesh);
        // Arms hang a touch out from the body.
        this.put(mesh, i, 0, SHOULDER_Y, side, sw + lean * 0.5);
        mesh.setColorAt(i, this.color(w.shirt));
        const hand = mesh === this.armL ? this.handL : this.handR;
        i = next(hand);
        this.put(hand, i, 0, SHOULDER_Y, side, sw + lean * 0.5);
        hand.setColorAt(i, this.color(w.skin));
      }
      if (wet > 0.3) {
        i = next(this.umbrella);
        this.put(this.umbrella, i, 0, 0.175, 0.012);
        this.umbrella.setColorAt(i, this.color(w.umbrella || w.shirt));
      }
      if (w.townId && w.mood != null) {
        i = next(this.dot);
        this.put(this.dot, i, 0, 0.18, 0);
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

// ---- Horse and cart ------------------------------------------------------------------------------
// Built from smooth rounded shapes, merged into one mesh each with colours baked in (white parts take
// the cart's or the horse's own colour). Both face +x; the horse stands in front of the cart.
const colored = (geo, rgb) => paint(geo.index ? geo.toNonIndexed() : geo, rgb);
// A tapered tube from point a to point b (radius r0 at a, r1 at b).
function tube(a, b, r0, r1, seg = 6) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const g = new THREE.CylinderGeometry(r1, r0, A.distanceTo(B), seg, 1).rotateX(Math.PI / 2);
  const o = new THREE.Object3D();
  o.position.copy(A).lerp(B, 0.5);
  o.lookAt(B);
  o.updateMatrix();
  return g.applyMatrix4(o.matrix);
}
const ball = (r, x, y, z, sx = 1, sy = 1, sz = 1, seg = 8) => new THREE.SphereGeometry(r, seg, Math.max(3, seg - 3)).scale(sx, sy, sz).translate(x, y, z);

// A farm cart: a planked bed in the cart's colour with a rounded top rail, corner posts, a cushioned
// bench, two soft sacks and a crate, an axle and shafts running forward to the horse's collar.
function cartGeometry() {
  const tint = [1, 1, 1];
  const plank = linear('#7a5a3a');
  const dark = linear('#4a3326');
  const sack = linear('#efe2b8');
  const cushion = linear('#c25a45');
  const parts = [];
  const box = (w, h, d, x, y, z, c) => parts.push(colored(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c));
  box(0.16, 0.008, 0.1, -0.05, 0.054, 0, tint); // floor
  for (const z of [-0.047, 0.047]) {
    for (const y of [0.064, 0.078]) box(0.16, 0.011, 0.006, -0.05, y, z, tint);
    parts.push(colored(new THREE.CapsuleGeometry(0.0042, 0.16, 1, 5).rotateZ(Math.PI / 2).translate(-0.05, 0.088, z), plank));
  }
  for (const x of [-0.128, 0.028]) for (const y of [0.064, 0.078]) box(0.006, 0.011, 0.094, x, y, 0, tint);
  for (const x of [-0.128, 0.028]) for (const z of [-0.047, 0.047]) {
    parts.push(colored(new THREE.CylinderGeometry(0.004, 0.0045, 0.042, 5).translate(x, 0.07, z), plank));
    parts.push(colored(ball(0.005, x, 0.092, z, 1, 1, 1, 5), plank));
  }
  box(0.03, 0.008, 0.088, 0.012, 0.08, 0, plank); // bench
  parts.push(colored(new THREE.CapsuleGeometry(0.0062, 0.07, 1, 6).rotateX(Math.PI / 2).translate(0.012, 0.089, 0), cushion));
  parts.push(colored(ball(0.022, -0.09, 0.072, -0.013, 1.25, 0.75, 1), sack));
  parts.push(colored(ball(0.004, -0.09, 0.089, -0.013, 1, 1, 1, 6), linear('#a88a58')));
  parts.push(colored(ball(0.018, -0.056, 0.07, 0.02, 1.2, 0.8, 1), sack));
  box(0.028, 0.026, 0.028, -0.03, 0.071, -0.022, plank); // crate
  parts.push(colored(new THREE.CylinderGeometry(0.003, 0.003, 0.118, 6).rotateX(Math.PI / 2).translate(-0.06, 0.03, 0), dark)); // axle
  for (const z of [-0.022, 0.022]) parts.push(colored(tube([0.028, 0.064, z], [0.155, 0.096, z * 1.05], 0.0032, 0.0026, 6), plank)); // shafts
  return mergeGeos(parts);
}

// A spoked cart wheel in the x-y plane: a wooden rim with an iron tyre, six tapered spokes and a hub.
function cartWheelGeometry() {
  const wood = linear('#7a5236');
  const iron = linear('#3a3438');
  const parts = [
    colored(new THREE.TorusGeometry(0.028, 0.0042, 4, 16), wood),
    colored(new THREE.TorusGeometry(0.031, 0.0022, 3, 16), iron),
    colored(new THREE.CylinderGeometry(0.0075, 0.0075, 0.014, 8).rotateX(Math.PI / 2), linear('#5a3d28')),
    colored(ball(0.004, 0, 0, 0.007, 1, 1, 0.6, 6), iron),
  ];
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    parts.push(colored(tube([Math.cos(a) * 0.006, Math.sin(a) * 0.006, 0], [Math.cos(a) * 0.026, Math.sin(a) * 0.026, 0], 0.0026, 0.0018, 4), wood));
  }
  return mergeGeos(parts);
}

// A horse: a rounded barrel with chest and rump, a tapered arched neck, a head with a muzzle, ears and
// eyes, a soft mane and a flowing tail, and a leather collar and belly band. White parts take the horse's
// coat colour; the mane and tail are a darker shade of it. Legs are separate so they can swing.
function horseGeometry() {
  const coat = [1, 1, 1];
  const hair = [0.28, 0.23, 0.21];
  const muzzle = [0.82, 0.78, 0.76];
  const leather = linear('#4a3022');
  const parts = [
    colored(new THREE.CapsuleGeometry(0.025, 0.052, 3, 10).rotateZ(Math.PI / 2).scale(1, 1, 0.82).translate(0.114, 0.083, 0), coat),
    colored(ball(0.026, 0.147, 0.087, 0, 1, 1, 0.84, 10), coat),
    colored(ball(0.027, 0.083, 0.088, 0, 1, 0.95, 0.86, 10), coat),
    colored(tube([0.148, 0.094, 0], [0.176, 0.142, 0], 0.017, 0.0115, 8), coat),
    colored(ball(0.0122, 0.176, 0.148, 0, 1, 1, 0.9), coat),
    colored(tube([0.176, 0.146, 0], [0.204, 0.125, 0], 0.0112, 0.0088, 8), coat),
    colored(ball(0.0098, 0.206, 0.121, 0, 1.1, 0.9, 0.95), muzzle),
  ];
  for (const z of [-0.0062, 0.0062]) {
    parts.push(colored(new THREE.ConeGeometry(0.0036, 0.012, 6).rotateZ(0.35).translate(0.172, 0.163, z), coat));
    parts.push(colored(ball(0.0022, 0.188, 0.143, z * 1.75, 1, 1, 1, 6), [0.05, 0.04, 0.04]));
  }
  // Mane along the top of the neck, and a forelock.
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    parts.push(colored(ball(0.0068, 0.142 + t * 0.03, 0.108 + t * 0.048, 0, 1.25, 1, 0.42, 6), hair));
  }
  parts.push(colored(ball(0.005, 0.182, 0.158, 0, 1, 0.8, 0.7, 6), hair));
  // Tail: out from the rump, then falling.
  parts.push(colored(tube([0.06, 0.098, 0], [0.05, 0.072, 0], 0.0055, 0.0048, 7), hair));
  parts.push(colored(tube([0.05, 0.072, 0], [0.051, 0.044, 0], 0.0048, 0.0068, 7), hair));
  parts.push(colored(ball(0.0068, 0.051, 0.044, 0, 1, 0.7, 1, 7), hair));
  // Harness.
  parts.push(colored(new THREE.TorusGeometry(0.0168, 0.0036, 4, 12).rotateY(Math.PI / 2).rotateZ(1.05).translate(0.153, 0.104, 0), leather));
  parts.push(colored(new THREE.TorusGeometry(0.026, 0.0026, 3, 14).rotateY(Math.PI / 2).scale(1, 1, 0.84).translate(0.122, 0.083, 0), leather));
  return mergeGeos(parts);
}

const LEG_TOP = 0.068;
// One horse leg hanging from the hip (origin at the top): a muscled upper leg, a slim cannon, a
// fetlock and a dark hoof.
function legGeometry() {
  const coat = [1, 1, 1];
  return mergeGeos([
    colored(tube([0, 0, 0], [0, -0.03, 0], 0.0078, 0.0052, 6), coat),
    colored(tube([0, -0.03, 0], [0, -0.056, 0], 0.0046, 0.0042, 6), coat),
    colored(ball(0.0053, 0, -0.056, 0, 1, 1, 1, 6), coat),
    colored(new THREE.CylinderGeometry(0.0056, 0.0064, 0.008, 6).translate(0, -0.064, 0), [0.12, 0.1, 0.09]),
  ]);
}

// Cars, vintage cars and horse-drawn carts, on the right-hand lane, with headlights after dark.
export class Cars3D {
  constructor(scene) {
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    // Horses and carts are lit like the town's buildings and people (the view adds its soft light).
    const soft = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.75, metalness: 0 });
    this.materials = [soft];
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
    this.cart = make(cartGeometry(), soft);
    this.horse = make(horseGeometry(), soft);
    this.carWheels = make(carWheelGeometry(), mat, true, MAX_CARS * 4);
    this.cartWheels = make(cartWheelGeometry(), soft, true, MAX_CARS * 2);
    this.legs = make(legGeometry(), soft, true, MAX_CARS * 4);
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
        // A trot: the horse bobs a little with each stride (the cart rolls smoothly behind).
        const bob = Math.abs(Math.sin(run * 38)) * 0.003;
        this.v.set(p.gx, bob, p.gy);
        this.m.compose(this.v, this.q, this.s);
        this.horse.setMatrixAt(i, this.m);
        const coat = this.color(c.horse || '#8a5d3b');
        this.horse.setColorAt(i, coat);
        const roll = -run / 0.03;
        this.part(this.cartWheels, i * 2, this.p, -0.06, 0.03, -0.058, roll);
        this.part(this.cartWheels, i * 2 + 1, this.p, -0.06, 0.03, 0.058, roll);
        const swing = Math.sin(run * 38) * 0.5;
        const legs = [[0.148, 0.0125, swing], [0.148, -0.0125, -swing], [0.086, 0.0125, -swing], [0.086, -0.0125, swing]];
        legs.forEach(([x, z, a], k) => {
          this.part(this.legs, i * 4 + k, this.p, x, LEG_TOP + bob, z, a);
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
