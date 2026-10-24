// People and vehicles in 3D. They are the same walkers and cars the overhead view draws (agents.js),
// drawn here with instanced meshes: one draw call per body part for everyone in town. People swing
// their arms and legs as they walk, wear their own shirt, trousers, hair or hat, and carry umbrellas
// in the rain. Your Life character has a glowing ring at their feet.

import * as THREE from './vendor/three.module.min.js';

const MAX_PEOPLE = 160;
const MAX_CARS = 90;
const WHITE = new THREE.Color(1, 1, 1);
const MOOD = { good: '#7fc4ad', caution: '#ffcf6e', bad: '#ff8f7e' };

// A unit box whose top is at the origin, so it hangs from a hip or shoulder and swings from there.
function hanging(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, -h / 2, 0);
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
    this.torso = make(new THREE.BoxGeometry(0.03, 0.05, 0.044));
    this.head = make(new THREE.IcosahedronGeometry(0.02, 1));
    this.hair = make(new THREE.SphereGeometry(0.0215, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.55));
    this.hat = make(hatGeometry());
    this.legL = make(hanging(0.016, 0.052, 0.016));
    this.legR = make(hanging(0.016, 0.052, 0.016));
    this.armL = make(hanging(0.011, 0.044, 0.011));
    this.armR = make(hanging(0.011, 0.044, 0.011));
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
    this.parts = [this.torso, this.head, this.hair, this.hat, this.legL, this.legR, this.armL, this.armR, this.umbrella, this.dot];
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

  update(walkers, time, { wet = 0, lit = 1, softShadows = true } = {}) {
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
      const swing = w.moving ? Math.sin(time * 9 + w.phase) * 0.55 : 0;
      const bob = w.moving ? Math.abs(Math.sin(time * 9 + w.phase)) * 0.004 : 0;
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
      }
      for (const [mesh, side, sw] of [
        [this.armL, -0.028, -swing * 0.8],
        [this.armR, 0.028, swing * 0.8],
      ]) {
        i = next(mesh);
        this.put(mesh, i, 0, 0.1, side, sw);
        mesh.setColorAt(i, this.color(w.shirt));
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

// Cars, vintage cars and horse-drawn carts, on the right-hand lane, with headlights after dark.
export class Cars3D {
  constructor(scene) {
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const make = (geo, material = mat, shadow = true) => {
      const m = new THREE.InstancedMesh(geo, material, MAX_CARS);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = shadow;
      m.setColorAt(0, WHITE);
      m.count = 0;
      m.frustumCulled = false;
      scene.add(m);
      return m;
    };
    this.body = make(new THREE.BoxGeometry(0.24, 0.05, 0.118).translate(0, 0.045, 0));
    this.cabin = make(new THREE.BoxGeometry(0.13, 0.042, 0.104).translate(-0.015, 0.091, 0));
    this.glass = make(new THREE.BoxGeometry(0.134, 0.026, 0.108).translate(-0.015, 0.09, 0), new THREE.MeshPhongMaterial({ color: 0x6b7f99, shininess: 80 }), false);
    this.wheels = make(new THREE.BoxGeometry(0.2, 0.04, 0.124).translate(0, 0.02, 0), new THREE.MeshLambertMaterial({ color: 0x3a3646 }), false);
    this.cart = make(new THREE.BoxGeometry(0.16, 0.05, 0.1).translate(-0.04, 0.06, 0));
    this.horse = make(new THREE.BoxGeometry(0.1, 0.05, 0.04).translate(0.1, 0.08, 0));
    this.lights = make(new THREE.BoxGeometry(0.01, 0.014, 0.09).translate(0.121, 0.05, 0), new THREE.MeshBasicMaterial({ color: 0xfff1c4 }), false);
    this.tail = make(new THREE.BoxGeometry(0.01, 0.012, 0.09).translate(-0.121, 0.052, 0), new THREE.MeshBasicMaterial({ color: 0xff7a6e }), false);
    this.all = [this.body, this.cabin, this.glass, this.wheels, this.cart, this.horse, this.lights, this.tail];
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3(1, 1, 1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.colors = new Map();
  }

  color(hex) {
    let c = this.colors.get(hex);
    if (!c) this.colors.set(hex, (c = new THREE.Color(hex)));
    return c;
  }

  update(agents, { night = 0 } = {}) {
    const n = { car: 0, cart: 0 };
    for (const c of agents.cars) {
      if (c.alpha < 0.3) continue;
      const p = agents.carPose(c);
      const heading = Math.atan2(p.dy, p.dx);
      this.q.setFromAxisAngle(this.up, -heading);
      this.m.compose(this.v.set(p.gx, 0, p.gy), this.q, this.s);
      if (c.kind === 'cart') {
        const i = n.cart++;
        if (i >= MAX_CARS) continue;
        this.cart.setMatrixAt(i, this.m);
        this.cart.setColorAt(i, this.color(c.cartColor || '#b88a5a'));
        this.horse.setMatrixAt(i, this.m);
        this.horse.setColorAt(i, this.color(c.horse || '#8a5d3b'));
        continue;
      }
      const i = n.car++;
      if (i >= MAX_CARS) continue;
      for (const mesh of [this.body, this.cabin, this.glass, this.wheels, this.lights, this.tail]) mesh.setMatrixAt(i, this.m);
      const col = this.color(c.color || '#ff9f8f');
      this.body.setColorAt(i, col);
      this.cabin.setColorAt(i, col);
    }
    for (const mesh of [this.body, this.cabin, this.glass, this.wheels]) mesh.count = Math.min(MAX_CARS, n.car);
    this.lights.count = this.tail.count = night > 0.35 ? Math.min(MAX_CARS, n.car) : 0;
    this.cart.count = this.horse.count = Math.min(MAX_CARS, n.cart);
    for (const mesh of this.all) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
