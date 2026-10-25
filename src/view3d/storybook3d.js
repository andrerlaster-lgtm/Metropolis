// Storybook visual sample: one corner of the town drawn in a painterly storybook style, to compare
// with the game's current 3D view. A prototype only: it reads the town, never changes or saves it,
// and the game doesn't use it. Geometry comes from storybook.js; this file adds the textures (painted
// on canvases here, nothing downloaded), warm lighting and soft shadows, villagers, a gentle breeze in
// the trees, and orbit controls for mouse, trackpad and touch.

import * as THREE from './vendor/three.module.min.js';
import { CameraRig } from './rig.js';
import { buildStorybook, surroundings, SBMesh, lin, rand } from './storybook.js';
import { buildStructure } from './models.js';
import { MeshData } from './mesh.js';

const DIST_NEAR = 1.2;
const DIST_FAR = 22;

export function createStorybook(opts) {
  const canvas = document.createElement('canvas');
  canvas.className = 'sb-canvas';
  let gl;
  try {
    gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  return new Storybook(canvas, gl, opts);
}

class Storybook {
  // opts: { mount, city, area, centre, renderer, growthOf, hash2, touch }
  constructor(canvas, gl, opts) {
    this.canvas = canvas;
    this.gl = gl;
    this.opts = opts;
    this.touch = !!opts.touch;
    this.active = false;
    this.time = 0;
    opts.mount(canvas);

    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.08;
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = (this.scene = new THREE.Scene());
    scene.background = skyTexture();
    scene.fog = new THREE.Fog(0xf1e2c6, 14, 46);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);

    // Late-afternoon light: a warm low sun, a blue sky above and green bounce from the grass below.
    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x8a9a52, 1.15);
    this.sun = new THREE.DirectionalLight(0xffdcaa, 2.7);
    this.sun.castShadow = true;
    const sm = this.touch ? 1024 : 2048;
    this.sun.shadow.mapSize.set(sm, sm);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 3;
    const sc = this.sun.shadow.camera;
    sc.left = -12;
    sc.right = 12;
    sc.top = 12;
    sc.bottom = -12;
    sc.near = 1;
    sc.far = 60;
    scene.add(this.hemi, this.sun, this.sun.target, new THREE.AmbientLight(0xffe9cc, 0.25));

    this.tex = makeTextures(gl);
    this.mats = makeMaterials(this.tex);
    this.build();

    this.rig = new CameraRig();
    const { area, centre, city } = opts;
    this.rig.setBounds(city.width, city.height);
    this.rig.area = { x0: area.x0 - 1, z0: area.y0 - 1, x1: area.x1 + 1, z1: area.y1 + 1 };
    this.home = { x: centre.x, z: centre.y, dist: 8 };
    this.rig.lookFrom(centre.x, centre.y, this.home.dist);
    this.pointers = new Map();
    this.keys = new Set();
    this.bindInput();
    this.perf = { t: 0, frames: 0, fps: 0 };
    window.addEventListener('resize', () => this.resize());
  }

  // ---- the scene ----------------------------------------------------------------------------

  build() {
    const { city, area, growthOf } = this.opts;
    const out = buildStorybook(city, area, { fallback: (o, t, rot) => this.fallback(o, t, rot), growthOf });
    surroundings(out, area);
    this.data = out;
    const root = (this.root = new THREE.Group());
    this.scene.add(root);
    this.vertices = 0;
    for (const [name, md] of Object.entries(out.layers)) {
      if (!md.vertices) continue;
      const a = md.arrays();
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(a.color, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(a.uv, 2));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, this.mats[name]);
      const flat = name === 'grass' || name === 'path' || name === 'dirt' || name === 'water';
      mesh.castShadow = !flat && name !== 'glow';
      mesh.receiveShadow = name !== 'glow';
      root.add(mesh);
      this.vertices += md.vertices;
    }
    // A meadow running out to the horizon under the sample.
    const meadow = new THREE.Mesh(new THREE.PlaneGeometry(160, 160).rotateX(-Math.PI / 2), this.mats.meadow);
    meadow.geometry.attributes.uv.array.forEach((v, i, arr) => (arr[i] = v * 160));
    meadow.position.set((area.x0 + area.x1) / 2, -0.004, (area.y0 + area.y1) / 2);
    meadow.receiveShadow = true;
    root.add(meadow);
    root.add(this.instances(out.flowers, flowerGeometry(), (f) => [f[0], f[1], f[2], f[3]], (f) => f[4], this.mats.flower));
    root.add(this.instances(out.tufts, tuftGeometry(), (t) => [t[0], 0, t[1], t[2]], (t) => t[3], this.mats.tuft, true));
    this.makeLanternLights();
    this.makeVillagers();
  }

  // Buildings with no storybook model yet (factories, schools, the mall, …) keep the game's own 3D
  // model, under the new light and with a paper grain.
  fallback(out, t, rot) {
    const { renderer: r, growthOf, hash2, city } = this.opts;
    const md = { solid: new MeshData(), glass: new MeshData(), lit: new MeshData(), glow: new MeshData(), lamps: [], smoke: [] };
    for (const m of [md.solid, md.glass, md.lit, md.glow]) m.place(t.x + 0.5, t.y + 0.5, rot);
    const ctx = {
      era: city.systems.era?.index ?? 3,
      snow: 0,
      open: true,
      variant: (s, fb) => r.variantOf(s, fb),
      roofHex: (hex) => r.roofColor(hex),
      trees: (x, y, blossom) => r.treeColors(x, y, blossom),
      snowy: (hex) => hex,
      hash: hash2,
      x: t.x,
      y: t.y,
      growth: growthOf(t),
      occupancy: 0.6,
      winter: false,
    };
    if (!buildStructure(md, t, ctx)) return false;
    const copy = (from, to) => {
      const a = from.arrays();
      for (let i = 0; i < a.position.length; i++) {
        to.p.push(a.position[i]);
        to.n.push(a.normal[i]);
        to.c.push(a.color[i]);
      }
      for (let i = 0; i < a.position.length / 3; i++) to.uv.push(0, 0);
    };
    copy(md.solid, out.layers.paint);
    copy(md.glass, out.layers.glass);
    copy(md.lit, out.layers.glass);
    copy(md.glow, out.layers.glow);
    return true;
  }

  // Many copies of one small shape (flowers, tufts), each with its own spot, size and colour.
  instances(list, geo, at, colour, mat, spin = false) {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    const mx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();
    list.forEach((it, i) => {
      const [x, y, z, s] = at(it);
      q.setFromAxisAngle(up, spin ? rand(i, 3, 1) * Math.PI * 2 : 0);
      mx.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s * (spin ? 0.8 + rand(i, 4, 1) * 0.6 : 1), s));
      m.setMatrixAt(i, mx);
      m.setColorAt(i, c.set(colour(it)));
    });
    m.count = list.length;
    m.castShadow = false;
    m.receiveShadow = true;
    return m;
  }

  // Warm point lights for the lanterns nearest the camera (a handful, so phones keep up).
  makeLanternLights() {
    this.lampLights = [];
    for (let i = 0; i < (this.touch ? 4 : 6); i++) {
      const l = new THREE.PointLight(0xffc56b, 0.5, 1.4, 1.6);
      this.scene.add(l);
      this.lampLights.push(l);
    }
  }

  placeLanternLights() {
    const f = this.rig.focus();
    const list = this.data.lanterns.map((p) => [p, (p[0] - f.x) ** 2 + (p[2] - f.z) ** 2]).sort((a, b) => a[1] - b[1]);
    this.lampLights.forEach((l, i) => {
      const p = list[i]?.[0];
      l.visible = !!p;
      if (p) l.position.set(p[0], p[1], p[2]);
    });
  }

  // Villagers in coats and hats, strolling along the lanes.
  makeVillagers() {
    const roads = this.data.roads;
    this.villagers = [];
    if (!roads.length) return;
    const on = new Set(roads.map(([x, y]) => `${x},${y}`));
    this.roadAt = (x, y) => on.has(`${x},${y}`);
    const n = Math.min(18, Math.max(4, Math.round(roads.length / 4)));
    const coats = ['#b5483d', '#3f6fa3', '#5e8a4a', '#d49a3a', '#7a5a8e', '#2f5d6b', '#a8644a', '#e2c7a0'];
    const skins = ['#f1c7a5', '#e0a982', '#c98f6a', '#8d5a3b'];
    const hats = ['#4a3326', '#2f2c30', '#d2a85c', '#8a3b3b', null];
    for (let i = 0; i < n; i++) {
      const md = new SBMesh();
      const coat = lin(coats[i % coats.length]);
      const skin = lin(skins[Math.floor(rand(i, 1, 2) * skins.length)]);
      const hat = hats[Math.floor(rand(i, 2, 3) * hats.length)];
      const dress = rand(i, 3, 4) < 0.45;
      md.cyl(-0.012, 0, 0.007, 0.007, 0, 0.045, 5, lin('#3b3036'));
      md.cyl(0.012, 0, 0.007, 0.007, 0, 0.045, 5, lin('#3b3036'));
      md.cyl(0, 0, dress ? 0.034 : 0.026, 0.02, dress ? 0.02 : 0.04, 0.1, 8, coat);
      md.cyl(-0.026, 0, 0.007, 0.006, 0.055, 0.098, 5, coat);
      md.cyl(0.026, 0, 0.007, 0.006, 0.055, 0.098, 5, coat);
      md.blob(0, 0.118, 0, 0.019, 0.021, 0.019, skin, skin, i, 1);
      if (hat) {
        md.cyl(0, 0, 0.028, 0.028, 0.13, 0.134, 10, lin(hat));
        md.cyl(0, 0, 0.016, 0.014, 0.134, 0.152, 8, lin(hat));
      } else md.blob(0, 0.126, -0.004, 0.02, 0.016, 0.02, lin(['#4a3326', '#c9a25a', '#2b2326', '#9a4b2e'][i % 4]), lin('#6b4a33'), i + 50, 1);
      const a = md.arrays();
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(a.color, 3));
      const mesh = new THREE.Mesh(geo, this.mats.villager);
      mesh.castShadow = true;
      mesh.scale.setScalar(1.15);
      const [rx, ry] = roads[Math.floor(rand(i, 5, 6) * roads.length)];
      const v = { mesh, at: [rx, ry], to: [rx, ry], t: 1, side: rand(i, 6, 7) < 0.5 ? -0.17 : 0.17, speed: 0.22 + rand(i, 7, 8) * 0.1, phase: rand(i, 8, 9) * 6, prev: null };
      this.villagers.push(v);
      this.scene.add(mesh);
    }
  }

  walk(dt) {
    for (const v of this.villagers) {
      v.t += (dt * v.speed) / 1;
      if (v.t >= 1) {
        v.t = 0;
        v.prev = v.at;
        v.at = v.to;
        const [x, y] = v.at;
        const next = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].filter(([a, b]) => this.roadAt(a, b));
        const ahead = next.filter(([a, b]) => !v.prev || a !== v.prev[0] || b !== v.prev[1]);
        const pool = ahead.length ? ahead : next;
        v.to = pool.length ? pool[Math.floor(Math.random() * pool.length)] : v.at;
      }
      const ax = v.at[0] + 0.5;
      const az = v.at[1] + 0.5;
      const bx = v.to[0] + 0.5;
      const bz = v.to[1] + 0.5;
      const dx = bx - ax;
      const dz = bz - az;
      const l = Math.hypot(dx, dz) || 1;
      // Keep to one side of the lane.
      const ox = (-dz / l) * v.side;
      const oz = (dx / l) * v.side;
      const x = ax + dx * v.t + (l > 0.01 ? ox : 0);
      const z = az + dz * v.t + (l > 0.01 ? oz : 0);
      const step = this.time * 9 + v.phase;
      v.mesh.position.set(x, Math.abs(Math.sin(step)) * 0.006 + 0.01, z);
      if (l > 0.01) v.mesh.rotation.y = Math.atan2(dx, dz);
      v.mesh.rotation.z = Math.sin(step) * 0.04;
    }
  }

  // ---- showing it ---------------------------------------------------------------------------------

  enter(view) {
    this.active = true;
    this.canvas.hidden = false;
    if (view) this.setView(view);
    this.resize();
  }

  exit() {
    this.active = false;
    this.canvas.hidden = true;
    this.pointers.clear();
    return this.view();
  }

  // Where the camera is (to hand to the other view, so both look at the same spot).
  view() {
    const o = this.rig.og;
    return { x: o.x, z: o.z, dist: o.dist, yaw: o.yaw, pitch: o.pitch };
  }

  setView({ x, z, dist, yaw, pitch }) {
    const r = this.rig;
    for (const o of [r.o, r.og]) {
      o.x = x;
      o.z = z;
      o.dist = clamp(dist, DIST_NEAR, DIST_FAR);
      if (Number.isFinite(yaw)) o.yaw = yaw;
      if (Number.isFinite(pitch)) o.pitch = pitch;
    }
  }

  resetView() {
    const r = this.rig.og;
    r.x = this.home.x;
    r.z = this.home.z;
    r.dist = this.home.dist;
    r.yaw = Math.PI / 4;
    r.pitch = 0.62;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.touch ? 1.6 : 2));
    this.gl.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  frame(dt) {
    if (!this.active) return;
    this.time += dt;
    this.keyMoves(dt);
    this.rig.update(dt);
    const p = this.rig.pose();
    this.camera.position.set(p.px, p.py, p.pz);
    this.camera.lookAt(p.lx, p.ly, p.lz);
    // The sun's shadows follow the camera's focus.
    const f = this.rig.focus();
    this.sun.position.set(f.x - 9, 13, f.z + 6);
    this.sun.target.position.set(f.x, 0, f.z);
    const d = this.rig.o.dist;
    this.scene.fog.near = Math.max(6, d * 1.6);
    this.scene.fog.far = Math.max(24, d * 4 + 16);
    this.mats.leaf.userData.time.value = this.time;
    if (Math.floor(this.time * 2) !== Math.floor((this.time - dt) * 2)) this.placeLanternLights();
    this.walk(dt);
    this.gl.render(this.scene, this.camera);
    const pf = this.perf;
    pf.t += dt;
    pf.frames++;
    if (pf.t >= 1) {
      pf.fps = Math.round(pf.frames / pf.t);
      pf.t = 0;
      pf.frames = 0;
    }
  }

  // ---- controls: drag to turn, pinch or scroll to zoom, two fingers or right-drag to move ----------

  bindInput() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey });
    });
    c.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (this.pointers.size === 1) {
        const h = window.innerHeight;
        if (p.button === 2 || p.shift || e.shiftKey) this.rig.pan(-dx / h, dy / h);
        else this.rig.rotate(dx * 0.006, dy * 0.004);
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.entries()];
        const other = a[0] === e.pointerId ? b[1] : a[1];
        const before = Math.hypot(p.x - other.x, p.y - other.y);
        const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
        if (before > 0 && after > 0) this.zoom(before / after);
        const h = window.innerHeight;
        this.rig.pan(-dx / 2 / h, dy / 2 / h);
      }
      p.x = e.clientX;
      p.y = e.clientY;
    });
    const up = (e) => this.pointers.delete(e.pointerId);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        // A trackpad pinch arrives as a wheel event with ctrlKey.
        if (e.ctrlKey) this.zoom(Math.exp(e.deltaY * 0.01));
        else if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5) this.rig.rotate(-e.deltaX * 0.003, 0);
        else this.zoom(Math.exp(e.deltaY * 0.0016));
      },
      { passive: false }
    );
    window.addEventListener('keydown', (e) => {
      if (!this.active || e.metaKey || e.ctrlKey) return;
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  zoom(f) {
    this.rig.zoom(f);
    this.rig.og.dist = clamp(this.rig.og.dist, DIST_NEAR, DIST_FAR);
  }

  keyMoves(dt) {
    const k = this.keys;
    if (!k.size) return;
    const s = dt * 0.6;
    if (k.has('w') || k.has('arrowup')) this.rig.pan(0, s);
    if (k.has('s') || k.has('arrowdown')) this.rig.pan(0, -s);
    if (k.has('a') || k.has('arrowleft')) this.rig.pan(-s, 0);
    if (k.has('d') || k.has('arrowright')) this.rig.pan(s, 0);
    if (k.has('q')) this.rig.rotate(-dt * 1.4, 0);
    if (k.has('e')) this.rig.rotate(dt * 1.4, 0);
    if (k.has('=') || k.has('+')) this.zoom(Math.exp(-dt * 1.5));
    if (k.has('-') || k.has('_')) this.zoom(Math.exp(dt * 1.5));
  }
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---- painted textures ---------------------------------------------------------------------------------
// Light, mostly neutral pictures (the vertex colours tint them), painted with soft strokes so surfaces
// read as brushwork up close: shingles, plaster, stone, cobbles, planks, thatch, bark, leaves and grass.

function paint(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  let seed = size * 7 + draw.length;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  draw(g, size, r);
  return c;
}

function tex(gl, canvas, { repeat = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
  return t;
}

// Draw something at (x, y) and again across the edges, so the picture tiles seamlessly.
function wrapDraw(size, x, y, r, fn) {
  for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) if (x + ox > -r && x + ox < size + r && y + oy > -r && y + oy < size + r) fn(x + ox, y + oy);
}

function makeTextures(gl) {
  const grey = (v, a = 1) => `rgba(${v},${v},${v},${a})`;
  const T = {};
  T.grass = tex(
    gl,
    paint(512, (g, s, r) => {
      g.fillStyle = grey(232);
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 90; i++) {
        const x = r() * s;
        const y = r() * s;
        const rad = 20 + r() * 50;
        wrapDraw(s, x, y, rad, (X, Y) => {
          const gr = g.createRadialGradient(X, Y, 0, X, Y, rad);
          gr.addColorStop(0, r() < 0.5 ? 'rgba(255,255,225,0.22)' : 'rgba(170,190,150,0.22)');
          gr.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = gr;
          g.fillRect(X - rad, Y - rad, rad * 2, rad * 2);
        });
      }
      g.lineCap = 'round';
      for (let i = 0; i < 4200; i++) {
        const x = r() * s;
        const y = r() * s;
        const len = 4 + r() * 9;
        const a = -Math.PI / 2 + (r() - 0.5) * 0.9;
        const v = r();
        g.strokeStyle = v < 0.5 ? `rgba(150,175,120,${0.25 + r() * 0.25})` : `rgba(255,255,230,${0.2 + r() * 0.25})`;
        g.lineWidth = 1 + r() * 1.6;
        wrapDraw(s, x, y, 14, (X, Y) => {
          g.beginPath();
          g.moveTo(X, Y);
          g.lineTo(X + Math.cos(a) * len, Y + Math.sin(a) * len);
          g.stroke();
        });
      }
    })
  );
  T.meadow = T.grass;
  T.cobble = tex(
    gl,
    paint(512, (g, s, r) => {
      g.fillStyle = grey(150);
      g.fillRect(0, 0, s, s);
      const n = 11;
      const cell = s / n;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const x = (i + (j % 2) * 0.5) * cell + (r() - 0.5) * cell * 0.15;
          const y = j * cell + cell / 2 + (r() - 0.5) * cell * 0.15;
          const w = cell * (0.4 + r() * 0.08);
          const h = cell * (0.38 + r() * 0.08);
          const v = 205 + r() * 45;
          wrapDraw(s, x, y, cell, (X, Y) => {
            const gr = g.createRadialGradient(X - w * 0.3, Y - h * 0.3, 1, X, Y, w * 1.1);
            gr.addColorStop(0, grey(Math.min(255, v + 25)));
            gr.addColorStop(1, grey(v - 35));
            g.fillStyle = gr;
            g.beginPath();
            g.ellipse(X, Y, w, h, r() * 0.6, 0, Math.PI * 2);
            g.fill();
          });
        }
      }
    })
  );
  T.dirt = tex(
    gl,
    paint(256, (g, s, r) => {
      g.fillStyle = grey(225);
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 1600; i++) {
        const v = r() < 0.5 ? 180 + r() * 40 : 240 + r() * 15;
        g.fillStyle = grey(Math.round(v), 0.5);
        const x = r() * s;
        const y = r() * s;
        const rr = 0.6 + r() * 2.4;
        wrapDraw(s, x, y, 3, (X, Y) => {
          g.beginPath();
          g.arc(X, Y, rr, 0, Math.PI * 2);
          g.fill();
        });
      }
    })
  );
  T.plaster = tex(
    gl,
    paint(256, (g, s, r) => {
      g.fillStyle = grey(240);
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 70; i++) {
        const x = r() * s;
        const y = r() * s;
        const rad = 10 + r() * 40;
        wrapDraw(s, x, y, rad, (X, Y) => {
          const gr = g.createRadialGradient(X, Y, 0, X, Y, rad);
          gr.addColorStop(0, r() < 0.55 ? 'rgba(255,250,240,0.35)' : 'rgba(190,175,160,0.22)');
          gr.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = gr;
          g.fillRect(X - rad, Y - rad, rad * 2, rad * 2);
        });
      }
      for (let i = 0; i < 900; i++) {
        g.fillStyle = grey(r() < 0.5 ? 205 : 255, 0.35);
        g.fillRect(r() * s, r() * s, 1.5, 1.5);
      }
    })
  );
  T.stone = tex(
    gl,
    paint(256, (g, s, r) => {
      g.fillStyle = grey(140);
      g.fillRect(0, 0, s, s);
      const rows = 6;
      const rh = s / rows;
      for (let j = 0; j < rows; j++) {
        let x = (j % 2) * rh * 0.6;
        while (x < s + rh) {
          const w = rh * (0.9 + r() * 0.9);
          const v = 200 + r() * 50;
          const X = x;
          const Y = j * rh;
          wrapDraw(s, X + w / 2, Y + rh / 2, rh * 2, (cx, cy) => {
            g.fillStyle = grey(Math.round(v));
            roundRect(g, cx - w / 2 + 2, cy - rh / 2 + 2, w - 4, rh - 4, 6);
            g.fill();
            g.fillStyle = 'rgba(255,255,255,0.18)';
            roundRect(g, cx - w / 2 + 4, cy - rh / 2 + 3, w - 10, rh * 0.35, 4);
            g.fill();
          });
          x += w;
        }
      }
    })
  );
  T.shingle = tex(
    gl,
    paint(256, (g, s, r) => {
      g.fillStyle = grey(120);
      g.fillRect(0, 0, s, s);
      const rows = 8;
      const rh = s / rows;
      const cols = 9;
      const cw = s / cols;
      // Rows from the eave (v = 0, the bottom of the canvas) up to the ridge; each overlaps the one below.
      for (let j = rows - 1; j >= -1; j--) {
        for (let i = -1; i <= cols; i++) {
          const x = (i + ((j + 8) % 2) * 0.5) * cw;
          const y = j * rh;
          const v = 195 + r() * 55;
          g.fillStyle = grey(Math.round(v));
          g.beginPath();
          g.moveTo(x + 1.5, y);
          g.lineTo(x + cw - 1.5, y);
          g.lineTo(x + cw - 1.5, y + rh * 0.78);
          g.quadraticCurveTo(x + cw / 2, y + rh * 1.12, x + 1.5, y + rh * 0.78);
          g.closePath();
          g.fill();
          g.fillStyle = 'rgba(255,255,255,0.16)';
          g.fillRect(x + 3, y + 2, cw - 6, rh * 0.25);
        }
      }
    })
  );
  T.thatch = tex(
    gl,
    paint(256, (g, s, r) => {
      g.fillStyle = grey(200);
      g.fillRect(0, 0, s, s);
      g.lineCap = 'round';
      for (let i = 0; i < 2600; i++) {
        const x = r() * s;
        const y = r() * s;
        const len = 10 + r() * 22;
        g.strokeStyle = r() < 0.5 ? `rgba(255,245,215,${0.35 + r() * 0.3})` : `rgba(120,95,60,${0.25 + r() * 0.25})`;
        g.lineWidth = 0.8 + r() * 1.2;
        wrapDraw(s, x, y, 34, (X, Y) => {
          g.beginPath();
          g.moveTo(X, Y);
          g.lineTo(X + (r() - 0.5) * 3, Y + len);
          g.stroke();
        });
      }
      for (let j = 0; j < 4; j++) {
        g.fillStyle = 'rgba(90,70,40,0.25)';
        g.fillRect(0, j * (s / 4), s, 3);
      }
    })
  );
  T.wood = tex(
    gl,
    paint(256, (g, s, r) => {
      g.fillStyle = grey(225);
      g.fillRect(0, 0, s, s);
      const planks = 4;
      for (let j = 0; j < planks; j++) {
        const y = (j * s) / planks;
        g.fillStyle = grey(Math.round(205 + r() * 45));
        g.fillRect(0, y + 1, s, s / planks - 2);
        for (let k = 0; k < 14; k++) {
          g.strokeStyle = `rgba(110,80,55,${0.12 + r() * 0.18})`;
          g.lineWidth = 0.8 + r();
          const yy = y + 3 + r() * (s / planks - 6);
          g.beginPath();
          g.moveTo(0, yy);
          g.bezierCurveTo(s / 3, yy + (r() - 0.5) * 6, (2 * s) / 3, yy + (r() - 0.5) * 6, s, yy);
          g.stroke();
        }
        g.fillStyle = 'rgba(60,40,25,0.5)';
        g.fillRect(0, y, s, 1.5);
      }
    })
  );
  T.timber = T.wood;
  T.bark = tex(
    gl,
    paint(128, (g, s, r) => {
      g.fillStyle = grey(200);
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 260; i++) {
        g.strokeStyle = r() < 0.5 ? 'rgba(90,70,50,0.35)' : 'rgba(255,240,220,0.25)';
        g.lineWidth = 1 + r() * 2;
        const x = r() * s;
        const y = r() * s;
        wrapDraw(s, x, y, 30, (X, Y) => {
          g.beginPath();
          g.moveTo(X, Y);
          g.lineTo(X + (r() - 0.5) * 4, Y + 8 + r() * 20);
          g.stroke();
        });
      }
    })
  );
  T.leaf = tex(
    gl,
    paint(256, (g, s, r) => {
      g.fillStyle = grey(205);
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 1300; i++) {
        const x = r() * s;
        const y = r() * s;
        const w = 4 + r() * 6;
        const h = 2.5 + r() * 3.5;
        const a = r() * Math.PI;
        const v = r();
        g.fillStyle = v < 0.4 ? `rgba(120,140,100,${0.35 + r() * 0.3})` : v < 0.8 ? `rgba(255,255,225,${0.3 + r() * 0.3})` : 'rgba(80,95,70,0.4)';
        wrapDraw(s, x, y, 12, (X, Y) => {
          g.beginPath();
          g.ellipse(X, Y, w, h, a, 0, Math.PI * 2);
          g.fill();
        });
      }
    })
  );
  T.paper = tex(
    gl,
    paint(128, (g, s, r) => {
      g.fillStyle = grey(240);
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 600; i++) {
        g.fillStyle = grey(r() < 0.5 ? 215 : 255, 0.4);
        g.fillRect(r() * s, r() * s, 2, 2);
      }
    })
  );
  return T;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#7fb6e0');
  gr.addColorStop(0.55, '#cfe2ec');
  gr.addColorStop(0.8, '#f6e6cc');
  gr.addColorStop(1, '#f1e2c6');
  g.fillStyle = gr;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeMaterials(T) {
  const std = (map, extra = {}) => new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide, ...extra });
  const M = {
    grass: std(T.grass, { side: THREE.FrontSide }),
    meadow: new THREE.MeshStandardMaterial({ map: T.meadow, color: 0x8fbf5a, roughness: 1 }),
    path: std(T.cobble, { side: THREE.FrontSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    dirt: std(T.dirt, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    plaster: std(T.plaster),
    timber: std(T.timber, { roughness: 0.85 }),
    roof: std(T.shingle, { roughness: 0.8 }),
    thatch: std(T.thatch, { roughness: 1 }),
    stone: std(T.stone),
    wood: std(T.wood),
    leaf: std(T.leaf, { roughness: 0.95 }),
    bark: std(T.bark),
    paint: std(T.paper, { roughness: 0.7 }),
    glass: std(null, { emissive: 0xffb54a, emissiveIntensity: 0.55, roughness: 0.25 }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    water: std(null, { transparent: true, opacity: 0.85, roughness: 0.12 }),
    flower: new THREE.MeshStandardMaterial({ roughness: 0.6, emissive: 0x221a10 }),
    tuft: new THREE.MeshStandardMaterial({ roughness: 1 }),
    villager: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }),
  };
  // A gentle breeze in the leaves: the crowns sway a little, more the higher they are.
  const time = { value: 0 };
  M.leaf.userData.time = time;
  M.leaf.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float sway = max(0.0, position.y - 0.05);
        transformed.x += sin(uTime * 1.3 + position.x * 2.1 + position.z * 1.7) * 0.012 * sway;
        transformed.z += cos(uTime * 1.1 + position.z * 2.3) * 0.008 * sway;`
      );
  };
  return M;
}

// A five-petal flower head, small enough to scatter by the thousand.
function flowerGeometry() {
  const g = new THREE.IcosahedronGeometry(0.011, 0);
  g.scale(1, 0.7, 1);
  return g;
}

// A grass tuft: three thin blades leaning apart.
function tuftGeometry() {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const c = new THREE.ConeGeometry(0.006, 0.045, 3, 1, true).toNonIndexed();
    c.translate(0, 0.022, 0);
    c.rotateZ((i - 1) * 0.35);
    c.rotateY(i * 2.1);
    parts.push(c);
  }
  const n = parts.reduce((k, p) => k + p.attributes.position.count, 0);
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array, o);
    nor.set(p.attributes.normal.array, o);
    o += p.attributes.position.array.length;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return geo;
}
