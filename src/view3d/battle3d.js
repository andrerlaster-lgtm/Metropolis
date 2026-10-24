// The military base and its battles in 3D. It only draws: the base screen (militaryUI.js) hands it
// a model each frame (the map, defences, soldiers, shells and effects from battle.js or the base),
// and it reports taps and hovers on the ground back. Two cameras: the classic angled view looking
// up the field from behind your lines, and a free camera you can turn. Everything is built from
// simple shapes in code; soldiers, shells, flashes and health bars are instanced (one draw call per
// part for everyone).

import * as THREE from './vendor/three.module.min.js';
import { CameraRig } from './rig.js';

const MAX_UNITS = 140;
const MAX_TRACERS = 240;
const MAX_PUFFS = 220;
const MAX_SHELLS = 60;
const SIDE = {
  def: { body: 0x8a6cc4, dark: 0x51407c, ring: 0x8a6cc4 },
  att: { body: 0xe9846f, dark: 0x8f4a3b, ring: 0xe9846f },
};
const SKIN = [0xf1c9a5, 0xd9a47e, 0xa8714f, 0x7a4e35, 0xe8b894];
const ANGLED = { yaw: Math.PI / 2, pitch: 0.92 };
const DOWN_SHOW = 6; // seconds a fallen soldier stays on the field
const CAMERA_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyQ', 'KeyE'];

export function createBattleView(opts) {
  const canvas = document.createElement('canvas');
  canvas.className = 'mil-canvas';
  canvas.setAttribute('aria-label', 'The military base. Drag to move the view, scroll or pinch to zoom, tap to act.');
  let gl;
  try {
    gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  return new BattleView(canvas, gl, opts);
}

const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

class BattleView {
  constructor(canvas, gl, opts) {
    this.canvas = canvas;
    this.gl = gl;
    this.opts = opts;
    this.model = null;
    this.camMode = 'angled';
    this.insets = { top: 0, right: 0, bottom: 0, left: 0 };
    this.maxDist = 40;
    this.time = 0;
    this.ghost = null;
    this.selected = new Set();
    this.downAt = new Map();
    this.skin = new Map();
    opts.mount(canvas);
    gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFSoftShadowMap;
    gl.setClearColor(0xcfe6ee);

    const scene = (this.scene = new THREE.Scene());
    scene.fog = new THREE.Fog(0xcfe6ee, 40, 90);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x9cc98a, 0.75);
    const sun = (this.sun = new THREE.DirectionalLight(0xfff4e0, 1.35));
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
    scene.add(hemi, sun, sun.target);

    this.statics = new THREE.Group();
    scene.add(this.statics);
    this.heads = new Map(); // structure id → the part that turns to aim
    this.staticKey = '';

    this.rig = new CameraRig();
    this.raycaster = new THREE.Raycaster();
    this.pointers = new Map();
    this.keys = new Set();
    this.makeInstances();
    this.makeGhost();
    this.bindInput();
    this.resize();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  // ---- What to draw -------------------------------------------------------------------------

  // getModel() → the current model (called every frame). frame: where to point the camera first.
  setModel(getModel, { w, h } = {}) {
    this.getModel = getModel;
    const m = getModel();
    this.rig.setBounds(m.map.w, m.map.h);
    this.rig.area = { x0: -2, z0: -2, x1: m.map.w + 2, z1: m.map.h + 2 };
    if (w || !this.framed) {
      this.framed = true;
      this.frameAll(m.map);
    }
    this.staticKey = '';
  }

  // Look at the whole field from behind your lines, as close as the free part of the screen allows
  // (the panels and bars around it are the insets).
  frameAll(map, { snap = true } = {}) {
    const r = this.rig;
    const W = this.canvas.clientWidth || window.innerWidth;
    const H = this.canvas.clientHeight || window.innerHeight;
    const i = this.insets;
    const freeW = Math.max(120, W - i.left - i.right);
    const freeH = Math.max(120, H - i.top - i.bottom);
    const fullH = H + Math.abs(i.top - i.bottom);
    const k = 2 * Math.tan((this.camera.fov * Math.PI) / 360);
    const depth = map.h * Math.sin(ANGLED.pitch) + 1.5;
    const across = map.w + 1.5;
    const dist = Math.max((depth * fullH) / (freeH * k), (across * fullH) / (freeW * k)) * 1.04;
    const yaw = this.camMode === 'free' ? r.og.yaw : ANGLED.yaw;
    const pitch = this.camMode === 'free' ? r.og.pitch : ANGLED.pitch;
    r.lookFrom(map.w / 2, map.h * 0.5, dist);
    r.og.yaw = yaw;
    r.og.pitch = pitch;
    r.og.dist = dist;
    if (snap) {
      r.o.yaw = yaw;
      r.o.pitch = pitch;
      r.o.dist = dist;
    }
    this.maxDist = Math.max(40, dist * 1.4);
  }

  // Screen space taken by panels: { top, right, bottom, left } in CSS pixels. The camera's centre
  // moves to the middle of what's left.
  setInsets(insets) {
    this.insets = { top: 0, right: 0, bottom: 0, left: 0, ...insets };
    this.applyOffset();
  }

  fit() {
    if (this.getModel) this.frameAll(this.getModel().map);
  }

  applyOffset() {
    const W = this.canvas.clientWidth || window.innerWidth;
    const H = this.canvas.clientHeight || window.innerHeight;
    const i = this.insets;
    const cx = i.left + (W - i.left - i.right) / 2;
    const cy = i.top + (H - i.top - i.bottom) / 2;
    const fullW = W + Math.abs(W / 2 - cx) * 2;
    const fullH = H + Math.abs(H / 2 - cy) * 2;
    if (fullW === W && fullH === H) this.camera.clearViewOffset();
    else this.camera.setViewOffset(fullW, fullH, fullW / 2 - cx, fullH / 2 - cy, W, H);
    this.camera.updateProjectionMatrix();
  }

  setCamera(mode) {
    this.camMode = mode === 'free' ? 'free' : 'angled';
    if (this.camMode === 'angled') {
      this.rig.og.yaw = ANGLED.yaw;
      this.rig.og.pitch = ANGLED.pitch;
    }
  }

  // { x, y, w, h, valid, range } in tiles, or null.
  setGhost(g) {
    this.ghost = g;
  }

  setSelected(ids) {
    this.selected = new Set(ids || []);
  }

  show() {
    this.canvas.hidden = false;
    this.resize();
  }
  hide() {
    this.canvas.hidden = true;
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.applyOffset();
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.keys.clear();
    this.gl.dispose();
    this.canvas.remove();
  }

  // ---- The scene that doesn't move: ground, rocks, trees and the defences --------------------

  rebuildStatics(m) {
    const g = this.statics;
    for (const c of [...g.children]) {
      g.remove(c);
      c.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
    }
    this.heads.clear();
    this.fires = [];
    const { w, h } = m.map;
    g.add(this.makeGround(m.map));
    const rockMat = mat(0x8f8a86, { flatShading: true });
    for (const r of m.map.rocks) {
      const k = 0.36 + ((r.x * 7 + r.y * 13) % 5) * 0.03;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(k, 0), rockMat);
      rock.position.set(r.x + 0.5, k * 0.55, r.y + 0.5);
      rock.rotation.set(r.x, r.y, 0);
      rock.scale.y = 0.75;
      rock.castShadow = rock.receiveShadow = true;
      g.add(rock);
    }
    // Trees around the outside, so the base sits in the countryside.
    const trunk = mat(0x8a6a4a);
    const leaf = mat(0x6fae6a, { flatShading: true });
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) {
      const side = i % 3;
      const x = side === 0 ? -1.5 - rnd() * 6 : side === 1 ? w + 1.5 + rnd() * 6 : rnd() * (w + 12) - 6;
      const z = side === 2 ? h + 1.5 + rnd() * 5 : rnd() * (h + 6) - 3;
      const t = new THREE.Group();
      const s = 0.7 + rnd() * 0.6;
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.4, 5), trunk);
      tr.position.y = 0.2;
      const top = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.95, 6), leaf);
      top.position.y = 0.8;
      top.castShadow = true;
      t.add(tr, top);
      t.scale.setScalar(s);
      t.position.set(x, 0, z);
      g.add(t);
    }
    for (const s of m.structs) g.add(this.makeStructure(s));
  }

  makeGround(map) {
    const { w, h, entryRows = 2, deployRows = 2 } = map;
    const pad = 14;
    const px = 24;
    const cv = document.createElement('canvas');
    cv.width = (w + pad * 2) * px;
    cv.height = (h + pad * 2) * px;
    const c = cv.getContext('2d');
    c.fillStyle = '#93c07f';
    c.fillRect(0, 0, cv.width, cv.height);
    const ox = pad * px;
    const oy = pad * px;
    c.fillStyle = '#a7cf8f';
    c.fillRect(ox, oy, w * px, h * px);
    c.fillStyle = 'rgba(233, 132, 111, 0.28)';
    c.fillRect(ox, oy, w * px, entryRows * px);
    c.fillStyle = 'rgba(138, 108, 196, 0.25)';
    c.fillRect(ox, oy + (h - deployRows) * px, w * px, deployRows * px);
    c.strokeStyle = 'rgba(60, 80, 50, 0.12)';
    c.lineWidth = 1;
    for (let x = 0; x <= w; x++) {
      c.beginPath();
      c.moveTo(ox + x * px + 0.5, oy);
      c.lineTo(ox + x * px + 0.5, oy + h * px);
      c.stroke();
    }
    for (let y = 0; y <= h; y++) {
      c.beginPath();
      c.moveTo(ox, oy + y * px + 0.5);
      c.lineTo(ox + w * px, oy + y * px + 0.5);
      c.stroke();
    }
    c.strokeStyle = 'rgba(80, 64, 120, 0.45)';
    c.lineWidth = 3;
    c.strokeRect(ox + 1.5, oy + 1.5, w * px - 3, h * px - 3);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w + pad * 2, h + pad * 2), new THREE.MeshLambertMaterial({ map: tex }));
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(w / 2, 0, h / 2);
    plane.receiveShadow = true;
    return plane;
  }

  // One defence, built from boxes and cylinders; damage shows as soot, a lean, fire and rubble.
  makeStructure(s) {
    const g = new THREE.Group();
    const cx = s.x + s.w / 2;
    const cz = s.y + s.h / 2;
    g.position.set(cx, 0, cz);
    const frac = s.maxHp ? s.hp / s.maxHp : 1;
    const wrecked = s.hp <= 0;
    const soot = frac < 0.66 ? (frac < 0.34 ? 0.55 : 0.78) : 1;
    const tint = (hex) => new THREE.Color(hex).multiplyScalar(soot);
    const m = (hex, extra) => mat(tint(hex), extra);
    const sand = m(0xd8c08e);
    const concrete = m(0xbdb6ad);
    const dark = m(0x3e3a40);
    const add = (geo, material, x, y, z, ry = 0) => {
      const o = new THREE.Mesh(geo, material);
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.castShadow = o.receiveShadow = true;
      g.add(o);
      return o;
    };
    if (wrecked) {
      // Rubble: a low heap of broken pieces.
      const rub = m(s.type === 'sandbags' || s.type === 'mg' || s.type === 'mortar' ? 0xb49e74 : 0x8f8a84, { flatShading: true });
      for (let i = 0; i < 5 + s.w * 3; i++) {
        const a = (i * 2.4) % (Math.PI * 2);
        const r = ((i * 37) % 10) / 10 * 0.35 * s.w;
        add(new THREE.DodecahedronGeometry(0.1 + ((i * 13) % 5) * 0.03, 0), rub, Math.cos(a) * r, 0.06, Math.sin(a) * r, a);
      }
      return g;
    }
    const sandbagRing = (r, n, y = 0.09) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        add(new THREE.CapsuleGeometry(0.06, 0.12, 2, 6), sand, Math.cos(a) * r, y, Math.sin(a) * r, -a).rotation.z = Math.PI / 2;
      }
    };
    if (s.type === 'hq') {
      add(box(1.7, 0.75, 1.5), concrete, 0, 0.375, 0.05);
      add(box(1.85, 0.08, 1.65), m(0x8b8579), 0, 0.79, 0.05);
      add(box(0.36, 0.4, 0.05), dark, 0, 0.2, 0.81);
      for (const x of [-0.55, 0.55]) add(box(0.28, 0.16, 0.05), m(0x6b8db5), x, 0.5, 0.81);
      const pole = add(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 6), m(0xdddddd), 0.6, 1.2, -0.4);
      void pole;
      add(box(0.36, 0.22, 0.02), mat(SIDE.def.body), 0.79, 1.5, -0.4);
      add(new THREE.CylinderGeometry(0.012, 0.012, 0.6, 4), dark, -0.6, 1.1, -0.45);
    } else if (s.type === 'sandbags') {
      for (let row = 0; row < 2; row++) for (let i = 0; i < 3; i++) add(new THREE.CapsuleGeometry(0.075, 0.16, 2, 6), sand, -0.3 + i * 0.3 + (row ? 0.15 : 0), 0.08 + row * 0.13, 0, 0).rotation.z = Math.PI / 2;
    } else if (s.type === 'mg') {
      sandbagRing(0.36, 9);
      sandbagRing(0.33, 8, 0.21);
      const head = new THREE.Group();
      head.position.y = 0.3;
      const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), dark);
      gun.rotation.x = Math.PI / 2;
      gun.position.z = 0.18;
      const body = new THREE.Mesh(box(0.14, 0.1, 0.22), dark);
      gun.castShadow = body.castShadow = true;
      head.add(gun, body);
      g.add(head);
      this.heads.set(s.id, head);
    } else if (s.type === 'bunker') {
      add(box(0.92, 0.5, 0.92), concrete, 0, 0.25, 0);
      add(box(0.98, 0.1, 0.98), m(0x9d978e), 0, 0.53, 0);
      add(box(0.6, 0.07, 0.04), dark, 0, 0.36, -0.47);
      add(box(0.04, 0.07, 0.5), dark, 0.47, 0.36, 0);
      add(box(0.04, 0.07, 0.5), dark, -0.47, 0.36, 0);
    } else if (s.type === 'mortar') {
      sandbagRing(0.38, 10);
      const head = new THREE.Group();
      head.position.y = 0.12;
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.5, 8), dark);
      tube.rotation.x = -0.75;
      tube.position.set(0, 0.15, 0.08);
      tube.castShadow = true;
      head.add(tube);
      g.add(head);
      this.heads.set(s.id, head);
    }
    // Upgrade levels: a gold band per level.
    for (let l = 1; l < (s.level || 1); l++) {
      const pip = new THREE.Mesh(box(0.12, 0.04, 0.04), mat(0xf2c14e));
      pip.position.set(-s.w / 2 + 0.15 + l * 0.15, 0.04, s.h / 2 - 0.05);
      g.add(pip);
    }
    if (frac < 0.66) g.rotation.z = frac < 0.34 ? 0.05 : 0.02;
    if (frac < 0.34) this.fires.push({ x: cx, z: cz, r: Math.max(s.w, s.h) * 0.3, y: s.type === 'hq' ? 0.8 : 0.35 });
    return g;
  }

  // ---- Things that move: instanced soldiers, shells, tracers, flashes, smoke ---------------------

  makeInstances() {
    const scene = this.scene;
    const white = (extra) => new THREE.MeshLambertMaterial({ color: 0xffffff, ...extra });
    const inst = (geo, material, n, shadow = true) => {
      const im = new THREE.InstancedMesh(geo, material, n);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.count = 0;
      im.castShadow = shadow;
      im.frustumCulled = false;
      scene.add(im);
      return im;
    };
    const legs = box(0.13, 0.16, 0.08).translate(0, 0.08, 0);
    const torso = box(0.17, 0.16, 0.1).translate(0, 0.24, 0);
    const head = new THREE.SphereGeometry(0.055, 8, 6).translate(0, 0.37, 0);
    const helmet = new THREE.SphereGeometry(0.068, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.385, 0);
    const gun = box(0.03, 0.03, 0.24).translate(0.07, 0.25, 0.09);
    this.parts = {
      legs: inst(legs, white(), MAX_UNITS),
      torso: inst(torso, white(), MAX_UNITS),
      head: inst(head, white(), MAX_UNITS),
      helmet: inst(helmet, white(), MAX_UNITS),
      gun: inst(gun, new THREE.MeshLambertMaterial({ color: 0x2f2b33 }), MAX_UNITS),
    };
    const ring = new THREE.RingGeometry(0.17, 0.23, 20).rotateX(-Math.PI / 2).translate(0, 0.02, 0);
    this.rings = inst(ring, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }), MAX_UNITS, false);
    const bar = new THREE.PlaneGeometry(1, 1);
    this.barBack = inst(bar, new THREE.MeshBasicMaterial({ color: 0x2b2440, transparent: true, opacity: 0.55, depthWrite: false, fog: false }), MAX_UNITS + 40, false);
    this.barFill = inst(bar.clone(), new THREE.MeshBasicMaterial({ color: 0xffffff, depthWrite: false, fog: false }), MAX_UNITS + 40, false);
    this.barFill.renderOrder = 2;
    this.flashes = inst(new THREE.SphereGeometry(0.05, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffe28a }), MAX_UNITS + 40, false);
    this.shellMesh = inst(new THREE.SphereGeometry(0.06, 6, 4), new THREE.MeshLambertMaterial({ color: 0x3a3632 }), MAX_SHELLS, true);
    this.puffs = inst(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false }), MAX_PUFFS, false);
    this.marks = inst(new THREE.RingGeometry(0.85, 1, 32).rotateX(-Math.PI / 2).translate(0, 0.03, 0), new THREE.MeshBasicMaterial({ color: 0xff4d3d, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }), 8, false);
    const tg = new THREE.BufferGeometry();
    this.tracerPos = new Float32Array(MAX_TRACERS * 6);
    this.tracerCol = new Float32Array(MAX_TRACERS * 6);
    tg.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('color', new THREE.BufferAttribute(this.tracerCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracers = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }));
    this.tracers.frustumCulled = false;
    scene.add(this.tracers);
    this.m4 = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3();
    this.e = new THREE.Euler();
    this.col = new THREE.Color();
  }

  makeGhost() {
    this.ghostBox = new THREE.Mesh(box(1, 0.5, 1).translate(0, 0.25, 0), new THREE.MeshBasicMaterial({ color: 0x5cbf88, transparent: true, opacity: 0.45, depthWrite: false }));
    this.ghostRange = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 48).rotateX(-Math.PI / 2).translate(0, 0.03, 0), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
    this.ghostBox.visible = this.ghostRange.visible = false;
    this.scene.add(this.ghostBox, this.ghostRange);
  }

  // ---- Every frame ------------------------------------------------------------------------------

  frame(dt) {
    if (!this.getModel || this.canvas.hidden) return;
    this.time += dt;
    const m = this.getModel();
    const key = `${m.map.w}x${m.map.h}|${m.map.rocks.length}|` + m.structs.map((s) => `${s.id}:${s.type}:${s.level}:${stage(s)}`).join(',');
    if (key !== this.staticKey) {
      this.staticKey = key;
      this.rebuildStatics(m);
    }
    this.keyCamera(dt);
    this.rig.update(dt);
    const p = this.rig.pose();
    this.camera.position.set(p.px, p.py, p.pz);
    this.camera.lookAt(p.lx, p.ly, p.lz);
    // Haze starts beyond the field whatever the zoom (phones look from farther away).
    const d = this.rig.o.dist;
    this.scene.fog.near = d * 1.1;
    this.scene.fog.far = d * 3;
    const f = this.rig.focus();
    this.sun.position.set(f.x - 8, 16, f.z + 6);
    this.sun.target.position.set(f.x, 0, f.z);
    const sc = this.sun.shadow.camera;
    const span = Math.max(m.map.w, m.map.h) * 0.75;
    if (sc.right !== span) {
      sc.left = -span;
      sc.right = span;
      sc.top = span;
      sc.bottom = -span;
      sc.near = 1;
      sc.far = 60;
      sc.updateProjectionMatrix();
    }
    for (const s of m.structs) {
      const head = this.heads.get(s.id);
      if (head && Number.isFinite(s.aim)) {
        const want = Math.atan2(Math.cos(s.aim), Math.sin(s.aim));
        let d = want - head.rotation.y;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        head.rotation.y += d * Math.min(1, dt * 10);
      }
    }
    this.drawUnits(m);
    this.drawEffects(m);
    this.drawGhost();
    this.gl.render(this.scene, this.camera);
  }

  drawUnits(m) {
    const P = this.parts;
    const { m4, q, v, s, e, col } = this;
    const camQ = this.camera.quaternion;
    let n = 0;
    let r = 0;
    let b = 0;
    let fl = 0;
    const t = m.t;
    const seen = new Set();
    const bar = (x, y, z, frac, width, color) => {
      if (b >= MAX_UNITS + 40) return;
      v.set(x, y, z);
      s.set(width, 0.045, 1);
      m4.compose(v, camQ, s);
      this.barBack.setMatrixAt(b, m4);
      // The filled part, shifted left so it shrinks from the right.
      const off = new THREE.Vector3(-(width * (1 - frac)) / 2, 0, 0.001).applyQuaternion(camQ);
      v.set(x + off.x, y + off.y, z + off.z);
      s.set(Math.max(0.001, width * frac), 0.045, 1);
      m4.compose(v, camQ, s);
      this.barFill.setMatrixAt(b, m4);
      this.barFill.setColorAt(b, col.set(color));
      b++;
    };
    for (const u of m.units) {
      if (u.gone || n >= MAX_UNITS) continue;
      seen.add(u.id);
      let lying = 0;
      if (!u.alive) {
        if (!this.downAt.has(u.id)) this.downAt.set(u.id, this.time);
        const since = this.time - this.downAt.get(u.id);
        if (since > DOWN_SHOW) continue;
        lying = Math.min(1, since * 4);
      }
      const side = SIDE[u.side] || SIDE.def;
      const bob = u.moving && u.alive ? Math.abs(Math.sin(this.time * 11 + u.id)) * 0.025 : 0;
      const yaw = Math.atan2(Math.cos(u.face), Math.sin(u.face));
      e.set(-lying * Math.PI / 2, yaw, 0, 'YXZ');
      q.setFromEuler(e);
      v.set(u.x, bob, u.y);
      s.set(1.15, 1.15, 1.15);
      m4.compose(v, q, s);
      for (const k of ['legs', 'torso', 'head', 'helmet', 'gun']) P[k].setMatrixAt(n, m4);
      const dim = u.alive ? 1 : 0.55;
      P.legs.setColorAt(n, col.set(side.dark).multiplyScalar(dim));
      P.torso.setColorAt(n, col.set(side.body).multiplyScalar(dim));
      P.helmet.setColorAt(n, col.set(side.dark).multiplyScalar(0.85 * dim));
      if (!this.skin.has(u.id)) this.skin.set(u.id, SKIN[(u.id * 7) % SKIN.length]);
      P.head.setColorAt(n, col.set(this.skin.get(u.id)).multiplyScalar(dim));
      n++;
      if (!u.alive) continue;
      if (this.selected.has(u.id) && r < MAX_UNITS) {
        v.set(u.x, 0, u.y);
        q.identity();
        s.set(1, 1, 1);
        m4.compose(v, q, s);
        this.rings.setMatrixAt(r, m4);
        this.rings.setColorAt(r, col.set(0xffffff));
        r++;
      }
      if (u.hp < u.maxHp) bar(u.x, 0.62, u.y, Math.max(0, u.hp / u.maxHp), 0.36, u.hp / u.maxHp > 0.5 ? 0x5cbf88 : u.hp / u.maxHp > 0.25 ? 0xf2b230 : 0xef6461);
      if (t - (u.fired ?? -9) < 0.07 && fl < MAX_UNITS + 40) {
        const dx = Math.cos(u.face);
        const dz = Math.sin(u.face);
        v.set(u.x + dx * 0.36 - dz * 0.08, 0.29, u.y + dz * 0.36 + dx * 0.08);
        q.identity();
        s.setScalar(0.8 + Math.random() * 0.6);
        m4.compose(v, q, s);
        this.flashes.setMatrixAt(fl++, m4);
      }
    }
    for (const id of this.downAt.keys()) if (!seen.has(id)) this.downAt.delete(id);
    for (const st of m.structs) {
      if (st.hp > 0 && st.hp < st.maxHp) bar(st.x + st.w / 2, st.type === 'hq' ? 1.15 : 0.8, st.y + st.h / 2, st.hp / st.maxHp, 0.5 + st.w * 0.25, st.hp / st.maxHp > 0.5 ? 0x5cbf88 : st.hp / st.maxHp > 0.25 ? 0xf2b230 : 0xef6461);
      if (st.hp > 0 && t - (st.fired ?? -9) < 0.07 && Number.isFinite(st.aim) && fl < MAX_UNITS + 40) {
        v.set(st.x + st.w / 2 + Math.cos(st.aim) * 0.45, st.type === 'hq' ? 0.5 : 0.32, st.y + st.h / 2 + Math.sin(st.aim) * 0.45);
        q.identity();
        s.setScalar(1.2);
        m4.compose(v, q, s);
        this.flashes.setMatrixAt(fl++, m4);
      }
    }
    for (const k in P) {
      P[k].count = n;
      P[k].instanceMatrix.needsUpdate = true;
      if (P[k].instanceColor) P[k].instanceColor.needsUpdate = true;
    }
    this.rings.count = r;
    this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
    this.barBack.count = this.barFill.count = b;
    this.barBack.instanceMatrix.needsUpdate = this.barFill.instanceMatrix.needsUpdate = true;
    if (this.barFill.instanceColor) this.barFill.instanceColor.needsUpdate = true;
    this.flashes.count = fl;
    this.flashes.instanceMatrix.needsUpdate = true;
  }

  drawEffects(m) {
    const { m4, q, v, s, col } = this;
    const t = m.t;
    // Tracers.
    let tr = 0;
    const pos = this.tracerPos;
    const cl = this.tracerCol;
    for (const f of m.fx) {
      if (f.kind !== 'shot' || tr >= MAX_TRACERS) continue;
      const age = t - f.t;
      if (age > (f.life || 0.12)) continue;
      const k = Math.min(1, age / 0.1);
      const x0 = f.x + (f.x2 - f.x) * Math.max(0, k - 0.45);
      const y0 = f.y + (f.y2 - f.y) * Math.max(0, k - 0.45);
      const x1 = f.x + (f.x2 - f.x) * k;
      const y1 = f.y + (f.y2 - f.y) * k;
      pos.set([x0, 0.27, y0, x1, 0.27, y1], tr * 6);
      col.set(f.side === 'att' ? 0xffb38a : 0xfff0a0);
      cl.set([col.r, col.g, col.b, col.r, col.g, col.b], tr * 6);
      tr++;
    }
    this.tracers.geometry.setDrawRange(0, tr * 2);
    this.tracers.geometry.attributes.position.needsUpdate = true;
    this.tracers.geometry.attributes.color.needsUpdate = true;
    // Shells in flight.
    let sh = 0;
    for (const p of m.shells) {
      if (sh >= MAX_SHELLS) break;
      const k = Math.max(0, Math.min(1, (t - p.t0) / p.dur));
      v.set(p.x0 + (p.x1 - p.x0) * k, 0.3 + Math.sin(Math.PI * k) * p.arc, p.y0 + (p.y1 - p.y0) * k);
      q.identity();
      s.setScalar(p.kind === 'shell' ? 1.3 : 1);
      m4.compose(v, q, s);
      this.shellMesh.setMatrixAt(sh++, m4);
    }
    this.shellMesh.count = sh;
    this.shellMesh.instanceMatrix.needsUpdate = true;
    // Explosions, smoke, healing sparkles and burning defences.
    let pf = 0;
    const puff = (x, y, z, r, color) => {
      if (pf >= MAX_PUFFS) return;
      v.set(x, y, z);
      q.identity();
      s.setScalar(Math.max(0.001, r));
      m4.compose(v, q, s);
      this.puffs.setMatrixAt(pf, m4);
      this.puffs.setColorAt(pf, col.set(color));
      pf++;
    };
    let mk = 0;
    for (const f of m.fx) {
      const age = t - f.t;
      if (f.kind === 'boom' || f.kind === 'wreck') {
        const life = f.life || 0.7;
        if (age > life) continue;
        const k = age / life;
        const r = (f.r || 0.6) * (f.big ? 1.1 : 0.8);
        puff(f.x, 0.15 + k * 0.2, f.y, r * (0.35 + k * 0.7) * (1 - k * 0.6), k < 0.35 ? 0xffc35a : 0xff8a4a);
        for (let i = 0; i < 3; i++) {
          const a = f.id * 1.7 + i * 2.1;
          puff(f.x + Math.cos(a) * r * 0.4 * k, 0.2 + k * 0.8, f.y + Math.sin(a) * r * 0.4 * k, r * 0.35 * (0.4 + k), 0x6f6a72);
        }
      } else if (f.kind === 'heal') {
        if (age > 0.6) continue;
        puff(f.x, 0.45 + age * 0.6, f.y, 0.05 * (1 - age), 0x7fe0a0);
      } else if (f.kind === 'mark') {
        if (age > (f.life || 2.5) || mk >= 8) continue;
        const pulse = 1 + Math.sin(this.time * 12) * 0.06;
        v.set(f.x, 0, f.y);
        q.identity();
        s.set(f.r * pulse, 1, f.r * pulse);
        m4.compose(v, q, s);
        this.marks.setMatrixAt(mk++, m4);
      }
    }
    for (const fire of this.fires || []) {
      for (let i = 0; i < 3; i++) {
        const ph = this.time * 9 + i * 2.2 + fire.x;
        puff(fire.x + Math.cos(i * 2.1) * fire.r * 0.5, fire.y + Math.abs(Math.sin(ph)) * 0.12, fire.z + Math.sin(i * 2.1) * fire.r * 0.5, 0.09 + Math.abs(Math.sin(ph * 1.3)) * 0.05, i === 1 ? 0xffd166 : 0xff7a3d);
      }
      const k = (this.time * 0.6 + fire.x) % 1;
      puff(fire.x, fire.y + 0.2 + k * 1.2, fire.z, 0.12 + k * 0.25, 0x58535c);
    }
    this.puffs.count = pf;
    this.puffs.instanceMatrix.needsUpdate = true;
    if (this.puffs.instanceColor) this.puffs.instanceColor.needsUpdate = true;
    this.marks.count = mk;
    this.marks.instanceMatrix.needsUpdate = true;
  }

  drawGhost() {
    const g = this.ghost;
    this.ghostBox.visible = !!g;
    this.ghostRange.visible = !!g?.range;
    if (!g) return;
    this.ghostBox.scale.set(g.w || 1, g.tall || 1, g.h || 1);
    this.ghostBox.position.set(g.x + (g.w || 1) / 2, 0, g.y + (g.h || 1) / 2);
    this.ghostBox.material.color.set(g.valid ? 0x5cbf88 : 0xef6461);
    if (g.range) {
      this.ghostRange.scale.set(g.range, 1, g.range);
      this.ghostRange.position.set(g.x + (g.w || 1) / 2, 0, g.y + (g.h || 1) / 2);
      this.ghostRange.material.color.set(g.valid ? 0xffffff : 0xffb0a8);
    }
  }

  // ---- Input: drag to move the view, scroll/pinch to zoom, turn in the free camera, tap to act ----

  groundAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const { origin, direction } = this.raycaster.ray;
    if (Math.abs(direction.y) < 1e-6) return null;
    const k = -origin.y / direction.y;
    if (k < 0) return null;
    return { x: origin.x + direction.x * k, y: origin.z + direction.z * k };
  }

  zoomBy(f) {
    const r = this.rig;
    r.og.dist = Math.max(4, Math.min(this.maxDist, r.og.dist * f));
  }

  bindInput() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('webglcontextlost', (e) => e.preventDefault());
    c.addEventListener('webglcontextrestored', () => (this.staticKey = ''));
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t0: performance.now(), button: e.button });
      this.pinch = null;
    });
    c.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) {
        if (e.pointerType === 'mouse') {
          const g = this.groundAt(e.clientX, e.clientY);
          if (g) this.opts.onHover?.(g.x, g.y);
        }
        return;
      }
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      const h = window.innerHeight || 1;
      if (this.pointers.size === 1) {
        if (p.button === 2 && this.camMode === 'free') this.rig.rotate(-dx * 0.006, dy * 0.005);
        else this.rig.pan((-dx / h) * 1.05, (dy / h) * 1.05);
        if (e.pointerType === 'mouse') {
          const g = this.groundAt(e.clientX, e.clientY);
          if (g) this.opts.onHover?.(g.x, g.y);
        }
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        if (this.pinch) {
          this.zoomBy(this.pinch.dist / Math.max(10, dist));
          this.rig.pan((-(mid.x - this.pinch.mid.x) / h) * 1.05, ((mid.y - this.pinch.mid.y) / h) * 1.05);
          if (this.camMode === 'free') {
            let da = ang - this.pinch.ang;
            da = Math.atan2(Math.sin(da), Math.cos(da));
            this.rig.rotate(da, 0);
          }
        }
        this.pinch = { dist, mid, ang };
      }
    });
    const up = (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      this.pointers.delete(e.pointerId);
      this.pinch = null;
      const moved = Math.hypot(e.clientX - p.sx, e.clientY - p.sy);
      if (moved < 8 && performance.now() - p.t0 < 450 && e.type === 'pointerup' && this.pointers.size === 0) {
        const g = this.groundAt(e.clientX, e.clientY);
        if (g) this.opts.onTap?.(g.x, g.y, { button: p.button });
      }
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (this.camMode === 'free' && !e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return this.rig.rotate(-e.deltaX * 0.004, 0);
        const k = e.ctrlKey ? 0.012 : e.deltaMode === 1 ? 0.05 : 0.0015;
        this.zoomBy(Math.exp(Math.max(-0.6, Math.min(0.6, e.deltaY * k))));
      },
      { passive: false }
    );
    window.addEventListener('blur', () => this.keys.clear());
  }

  // Camera keys, passed on by the base screen (it owns the keyboard while it's open).
  key(code, down) {
    if (!CAMERA_KEYS.includes(code)) return false;
    if (down) this.keys.add(code);
    else this.keys.delete(code);
    return true;
  }

  keyCamera(dt) {
    if (!this.keys.size) return;
    const k = this.keys;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    if (f || r) this.rig.pan(r * dt * 0.9, f * dt * 0.9);
    if (this.camMode === 'free') {
      const turn = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
      if (turn) this.rig.rotate(turn * dt * 1.6, 0);
    }
  }
}

function stage(s) {
  if (s.hp <= 0) return 3;
  const f = s.maxHp ? s.hp / s.maxHp : 1;
  return f < 0.34 ? 2 : f < 0.66 ? 1 : 0;
}
