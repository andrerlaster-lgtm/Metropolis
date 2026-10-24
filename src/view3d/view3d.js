// The 3D view: the same town, drawn in 3D with Three.js (vendor/three.module.min.js, r169, MIT; the
// version Bellemorne uses). It is loaded only when the player opens it, and it only ever reads the
// game: the simulation, saves and the overhead builder carry on exactly as before underneath.
//
// The town is cut into chunks of CHUNK × CHUNK tiles; each chunk is a handful of merged meshes
// (ground, walls and roofs, windows, glowing bits, water) rebuilt only when something in it changes.
// People and cars are instanced. Lighting follows the game clock and weather, shadows follow the sun.

import * as THREE from './vendor/three.module.min.js';
import { MeshData, linear } from './mesh.js';
import { buildStructure } from './models.js';
import { buildGround, WATER_Y } from './ground.js';
import { CameraRig, DIST_MIN, DIST_MAX } from './rig.js';
import { People3D, Cars3D } from './agents3d.js';

const CHUNK = 8;
const QUALITY = {
  low: { ratio: 1, shadows: 0, lamps: 0, label: 'Low' },
  medium: { ratio: 1.5, shadows: 1024, lamps: 4, label: 'Medium' },
  high: { ratio: 2, shadows: 2048, lamps: 6, label: 'High' },
};
const PREFS_KEY = 'pocket-metropolis:view3d';
const TYPE_CODES = new Map();
const touchFirst = () => globalThis.matchMedia?.('(pointer: coarse)').matches;

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}
function writePrefs(p) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // Private windows can refuse storage; the setting just isn't remembered.
  }
}

// Returns the view, or null when this browser can't draw WebGL (the game stays in the overhead view).
export function createView3D(deps) {
  const canvas = document.createElement('canvas');
  canvas.id = 'city3d';
  canvas.setAttribute('aria-label', 'Your town in 3D. Drag to look around, scroll or pinch to zoom.');
  let gl;
  try {
    gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  return new View3D(canvas, gl, deps);
}

class View3D {
  constructor(canvas, gl, deps) {
    this.canvas = canvas;
    this.gl = gl;
    this.deps = deps;
    this.city = deps.city;
    this.active = false;
    this.time = 0;
    gl.shadowMap.type = THREE.PCFSoftShadowMap;
    canvas.hidden = true;
    deps.mount(canvas);

    const scene = (this.scene = new THREE.Scene());
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 400);
    scene.fog = new THREE.Fog(0xe5f5f1, 30, 120);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0xa8d5a2, 0.6);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.4);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.015;
    scene.add(this.hemi, this.sun, this.sun.target);
    this.sky = this.makeSky();
    scene.add(this.sky);
    this.lampLights = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffd99a, 0, 1.6, 1.4);
      scene.add(l);
      this.lampLights.push(l);
    }

    this.mats = {
      ground: new THREE.MeshLambertMaterial({ vertexColors: true }),
      solid: new THREE.MeshLambertMaterial({ vertexColors: true }),
      glass: new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 70, specular: 0x8899aa }),
      lit: new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 70, specular: 0x8899aa, emissive: 0xffd27a, emissiveIntensity: 0 }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
      water: new THREE.MeshPhongMaterial({ vertexColors: true, transparent: true, opacity: 0.86, shininess: 110, specular: 0xbfe6f2 }),
    };
    this.chunks = new Map();
    this.root = new THREE.Group();
    scene.add(this.root);
    this.people = new People3D(scene);
    this.cars = new Cars3D(scene);
    this.weather = this.makeWeather();

    this.rig = new CameraRig();
    this.rig.blocked = (x, z) => this.blocked(x, z);
    this.prefs = readPrefs();
    this.quality = this.prefs.quality || 'auto';
    this.level = this.quality === 'auto' ? (touchFirst() ? 'medium' : 'high') : this.quality;
    this.perf = { t: 0, frames: 0, slow: 0 };
    this.keys = new Set();
    this.pointers = new Map();
    this.raycaster = new THREE.Raycaster();
    this.subjectWalker = null;
    this.buildHud();
    this.bindInput();
    this.applyQuality();
    window.addEventListener('resize', () => this.resize());
  }

  // ---- entering and leaving ----------------------------------------------------------

  enter({ x, z, dist, follow = null }) {
    this.active = true;
    this.canvas.hidden = false;
    this.hud.hidden = false;
    this.rig.setBounds(this.city.width, this.city.height);
    this.rig.lookFrom(x, z, dist);
    this.resize();
    this.syncChunks(Infinity);
    if (follow === 'hero') this.followHero();
    this.updateHud();
    this.showHint();
  }

  exit() {
    this.active = false;
    this.canvas.hidden = true;
    this.hud.hidden = true;
    this.stick.hidden = true;
    this.keys.clear();
    this.pointers.clear();
    const f = this.rig.focus();
    return { x: f.x, z: f.z, dist: this.rig.span() };
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[this.level].ratio));
    this.gl.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  setQuality(q) {
    this.quality = q;
    this.prefs.quality = q;
    writePrefs(this.prefs);
    this.level = q === 'auto' ? (touchFirst() ? 'medium' : 'high') : q;
    this.perf = { t: 0, frames: 0, slow: 0 };
    this.applyQuality();
    this.updateHud();
  }

  applyQuality() {
    const Q = QUALITY[this.level];
    this.gl.shadowMap.enabled = Q.shadows > 0;
    this.sun.castShadow = Q.shadows > 0;
    if (Q.shadows) {
      this.sun.shadow.mapSize.set(Q.shadows, Q.shadows);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    for (const m of Object.values(this.mats)) m.needsUpdate = true;
    this.resize();
  }

  // ---- the town's meshes ----------------------------------------------------------

  // A fingerprint of everything a chunk's meshes depend on, so they're rebuilt only on change.
  chunkSig(x0, y0, x1, y1, g) {
    const city = this.city;
    const { growthOf, crosswalkMask, STRUCTURES } = this.deps;
    let h = 2166136261 ^ g;
    const mixIn = (v) => (h = Math.imul(h ^ v, 16777619));
    for (let y = y0 - 1; y <= y1; y++) {
      for (let x = x0 - 1; x <= x1; x++) {
        const t = city.getTile(x, y);
        if (!t) {
          mixIn(7);
          continue;
        }
        const inside = x >= x0 && x < x1 && y >= y0 && y < y1;
        const s = t.structure;
        mixIn(t.terrain === 'water' ? 1 : 2);
        if (!inside) continue;
        if (!s) {
          mixIn(3);
          continue;
        }
        let code = TYPE_CODES.get(s.type);
        if (code == null) TYPE_CODES.set(s.type, (code = TYPE_CODES.size + 10));
        mixIn(code);
        mixIn((s.variant ? s.variant.charCodeAt(0) : 0) + (s.shape || 0) * 256 + (s.floors || 0) * 4096);
        const gr = growthOf(t);
        if (gr) mixIn((gr.stage ?? 0) + (gr.floors ?? 0) * 8);
        mixIn(Math.round((s.damage || 0) * 4) + (s.broken ? 16 : 0) + (s.snowed ? 32 : 0));
        if (s.type === 'road') mixIn(t.roadMask + 16 * crosswalkMask(city, x, y));
        mixIn(Math.round(this.occupancy(t, STRUCTURES) * 3));
      }
    }
    return h >>> 0;
  }

  occupancy(t, STRUCTURES = this.deps.STRUCTURES) {
    const s = t.structure;
    const def = STRUCTURES[s.type];
    if (def.capacity) return s.residents / def.capacity;
    if (def.jobs) return Math.min(1, (t.workersFilled || 0) / def.jobs);
    return 0.5;
  }

  // Rebuild changed chunks, at most `budget` of them this frame.
  syncChunks(budget = 2) {
    const city = this.city;
    const r = this.deps.renderer;
    const w = city.derived.weather || {};
    const era = city.systems.era?.index ?? 3;
    const snow = Math.round((w.snowCover || 0) * 10) / 10;
    const season = w.season || 'spring';
    const open = city.clock > 0.29 && city.clock < 0.92;
    // The overhead renderer owns the season's colours; let it know what's current.
    r.era = era;
    r.season = season;
    r.snowCover = snow;
    const g = era * 1000 + Math.round(snow * 10) * 10 + ['spring', 'summer', 'autumn', 'winter'].indexOf(season) + (open ? 500000 : 0) + city.width * 7919;
    const cw = Math.ceil(city.width / CHUNK);
    const ch = Math.ceil(city.height / CHUNK);
    const live = new Set();
    let built = 0;
    for (let cz = 0; cz < ch; cz++) {
      for (let cx = 0; cx < cw; cx++) {
        const key = cz * 1000 + cx;
        live.add(key);
        const x0 = cx * CHUNK;
        const y0 = cz * CHUNK;
        const x1 = Math.min(city.width, x0 + CHUNK);
        const y1 = Math.min(city.height, y0 + CHUNK);
        const sig = this.chunkSig(x0, y0, x1, y1, g);
        const c = this.chunks.get(key);
        if (c && c.sig === sig) continue;
        if (built >= budget) continue;
        built++;
        this.buildChunk(key, x0, y0, x1, y1, sig, { era, snow, season, open });
      }
    }
    for (const [key, c] of this.chunks) if (!live.has(key)) this.dropChunk(key, c);
  }

  dropChunk(key, c) {
    for (const m of c.meshes) {
      this.root.remove(m);
      m.geometry.dispose();
    }
    this.chunks.delete(key);
  }

  buildChunk(key, x0, y0, x1, y1, sig, env) {
    const city = this.city;
    const d = this.deps;
    const r = d.renderer;
    const old = this.chunks.get(key);
    if (old) this.dropChunk(key, old);
    const out = { ground: new MeshData(), water: new MeshData(), solid: new MeshData(), glass: new MeshData(), lit: new MeshData(), glow: new MeshData(), lamps: [] };
    const snowHex = (hex, k = 0.8) => (env.snow ? d.mixHex(hex, '#f3f6f9', env.snow * k) : hex);
    buildGround(out, city, x0, y0, x1, y1, {
      palette: d.PALETTE,
      snow: env.snow,
      era: env.era,
      grass: (hex) => r.grassColor(hex),
      hash: d.hash2,
      crossMask: (x, y) => d.crosswalkMask(city, x, y),
      lamp: (t) => r.lampSpot(t),
    });
    const ctx = {
      era: env.era,
      snow: env.snow,
      open: env.open,
      variant: (s, fb) => r.variantOf(s, fb),
      roofHex: (hex) => r.roofColor(hex),
      trees: (x, y, blossom) => r.treeColors(x, y, blossom),
      snowy: snowHex,
      hash: d.hash2,
    };
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const t = city.getTile(x, y);
        if (!t.structure || t.structure.type === 'road' || t.terrain !== 'grass') continue;
        const rot = this.frontOf(t);
        for (const md of [out.solid, out.glass, out.lit, out.glow]) md.place(x + 0.5, y + 0.5, rot);
        ctx.x = x;
        ctx.y = y;
        ctx.growth = d.growthOf(t);
        ctx.occupancy = Math.max(0.2, Math.min(0.9, this.occupancy(t)));
        buildStructure(out, t, ctx);
      }
    }
    const meshes = [];
    const add = (md, mat, { cast = false, receive = true } = {}) => {
      if (!md.vertices) return;
      const a = md.arrays();
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(a.color, 3));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      mesh.userData.pick = mat === this.mats.solid || mat === this.mats.ground;
      this.root.add(mesh);
      meshes.push(mesh);
    };
    add(out.ground, this.mats.ground);
    add(out.solid, this.mats.solid, { cast: true });
    add(out.glass, this.mats.glass);
    add(out.lit, this.mats.lit);
    add(out.glow, this.mats.glow, { receive: false });
    add(out.water, this.mats.water);
    this.chunks.set(key, { sig, meshes, lamps: out.lamps });
  }

  // Buildings face their street: the side with a road, preferring the ones toward the camera.
  frontOf(t) {
    const city = this.city;
    const road = (x, y) => city.getTile(x, y)?.structure?.type === 'road';
    if (road(t.x, t.y + 1)) return 0;
    if (road(t.x + 1, t.y)) return 1;
    if (road(t.x - 1, t.y)) return 3;
    if (road(t.x, t.y - 1)) return 2;
    return ((t.structure.shape || 0) + t.x) % 2 ? 1 : 0;
  }

  // The street camera can't walk into buildings (it can cross parks, lawns and roads).
  blocked(x, z) {
    const t = this.city.getTile(Math.floor(x), Math.floor(z));
    if (!t || t.terrain === 'water') return true;
    const s = t.structure;
    if (!s || s.type === 'road' || this.deps.STRUCTURES[s.type].walkable || s.type === 'rubble') return false;
    // Allow the edge of a lot, so you can walk right up to a front door.
    const fx = x - t.x;
    const fz = z - t.y;
    return fx > 0.04 && fx < 0.96 && fz > 0.04 && fz < 0.96;
  }

  // Where to stand when stepping down to the street: the sidewalk nearest (x, z), facing along it.
  streetSpot(x, z) {
    const city = this.city;
    let best = null;
    let bestD = Infinity;
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        const t = city.getTile(cx + dx, cz + dy);
        if (t?.structure?.type !== 'road') continue;
        const m = t.roadMask;
        // Stand on a sidewalk edge (a side with no road arm), else at a corner of the junction.
        for (let s = 0; s < 4; s++) {
          if (m & (1 << s)) continue;
          const px = t.x + 0.5 + [0, 0.425, 0, -0.425][s];
          const pz = t.y + 0.5 + [-0.425, 0, 0.425, 0][s];
          const d = (px - x) ** 2 + (pz - z) ** 2;
          if (d < bestD) {
            bestD = d;
            // Face along the street: across the side's direction.
            best = { x: px, z: pz, yaw: s % 2 ? Math.PI / 2 : 0 };
          }
        }
      }
    }
    return best;
  }

  // ---- sky, light and weather -------------------------------------------------------

  makeSky() {
    const geo = new THREE.SphereGeometry(300, 24, 12);
    const colors = new Float32Array(geo.getAttribute('position').count * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -1;
    sky.userData.key = '';
    return sky;
  }

  paintSky(top, bottom) {
    const key = top + bottom;
    if (this.sky.userData.key === key) return;
    this.sky.userData.key = key;
    const pos = this.sky.geometry.getAttribute('position');
    const col = this.sky.geometry.getAttribute('color');
    const a = linear(bottom);
    const b = linear(top);
    for (let i = 0; i < pos.count; i++) {
      const t = Math.max(0, Math.min(1, pos.getY(i) / 300 + 0.08)) ** 0.6;
      col.setXYZ(i, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
    }
    col.needsUpdate = true;
  }

  makeWeather() {
    const n = 1400;
    const pos = new Float32Array(n * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xc8d8ec, transparent: true, opacity: 0.5 }));
    rain.frustumCulled = false;
    rain.visible = false;
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const snow = new THREE.Points(sgeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.035, transparent: true, opacity: 0.9 }));
    snow.frustumCulled = false;
    snow.visible = false;
    this.scene.add(rain, snow);
    const seeds = Array.from({ length: n }, () => [Math.random(), Math.random(), Math.random()]);
    return { rain, snow, seeds, n };
  }

  updateWeather(w, focus, span) {
    const W = this.weather;
    const rainy = (w.rain || 0) > 0.05;
    const snowy = (w.snow || 0) > 0.05;
    W.rain.visible = rainy;
    W.snow.visible = snowy;
    if (!rainy && !snowy) return;
    const box = Math.min(14, Math.max(4, span * 1.2));
    const hgt = Math.min(10, Math.max(2.5, span));
    const count = Math.floor(W.n * Math.min(1, (rainy ? w.rain : w.snow) + 0.2));
    const t = this.time;
    if (rainy) {
      const a = W.rain.geometry.getAttribute('position');
      for (let i = 0; i < W.n; i++) {
        const [u, v, k] = W.seeds[i];
        if (i >= count) {
          a.setXYZ(i * 2, 0, -99, 0);
          a.setXYZ(i * 2 + 1, 0, -99, 0);
          continue;
        }
        const x = focus.x + (u - 0.5) * box;
        const z = focus.z + (v - 0.5) * box;
        const y = hgt - ((t * 6 + k * hgt) % hgt);
        a.setXYZ(i * 2, x, y, z);
        a.setXYZ(i * 2 + 1, x + 0.02, y - 0.12, z + 0.01);
      }
      a.needsUpdate = true;
    }
    if (snowy) {
      const a = W.snow.geometry.getAttribute('position');
      for (let i = 0; i < W.n; i++) {
        const [u, v, k] = W.seeds[i];
        if (i >= count) {
          a.setXYZ(i, 0, -99, 0);
          continue;
        }
        const y = hgt - ((t * 0.5 + k * hgt) % hgt);
        a.setXYZ(i, focus.x + (u - 0.5) * box + Math.sin(t + k * 9) * 0.15, y, focus.z + (v - 0.5) * box + Math.cos(t * 0.7 + u * 9) * 0.15);
      }
      a.needsUpdate = true;
    }
  }

  light(focus, span) {
    const city = this.city;
    const d = this.deps;
    const w = city.derived.weather || { rain: 0, snow: 0, fog: 0, cloud: 0 };
    const L = d.renderer.weatherLight(d.lightingAt(city.clock), w);
    this.L = L;
    this.paintSky(L.skyTop, L.skyBottom);
    const amb = L.ambient;
    const day = L.daylight;
    const sunH = d.sunHeight(city.clock);
    // Sky light: bright and neutral by day, low and blue at night.
    this.hemi.color.setRGB(amb[0] * 0.92, amb[1] * 0.95, amb[2]);
    this.hemi.groundColor.setRGB(0.55 * amb[0], 0.62 * amb[1], 0.5 * amb[2]);
    this.hemi.intensity = 0.55 + 0.5 * day;
    // The sun swings from east-north-east in the morning to south-west in the evening; by night a
    // faint moon lights the town from high up.
    const up = sunH > 0.02;
    const phase = Math.max(0, Math.min(1, (city.clock - 0.22) / 0.6));
    const az = -0.5 + phase * 2.5;
    const elev = up ? Math.max(0.18, Math.asin(Math.min(1, sunH))) : 0.9;
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev));
    if (!up) dir.set(-0.3, 0.9, 0.3).normalize();
    const reach = Math.min(40, Math.max(6, span * 1.6));
    this.sun.position.set(focus.x + dir.x * 40, dir.y * 40, focus.z + dir.z * 40);
    this.sun.target.position.set(focus.x, 0, focus.z);
    this.sun.target.updateMatrixWorld();
    const warm = L.warm || 0;
    const cloud = 1 - 0.5 * (w.cloud || 0) - 0.3 * (w.rain || 0);
    if (up) {
      this.sun.color.setRGB(1, 0.97 - 0.12 * warm, 0.92 - 0.3 * warm);
      this.sun.intensity = (0.35 + 1.15 * day) * cloud;
    } else {
      this.sun.color.setRGB(0.62, 0.68, 0.95);
      this.sun.intensity = 0.32;
    }
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -reach;
    sc.right = sc.top = reach;
    sc.near = 1;
    sc.far = 90;
    sc.updateProjectionMatrix();
    this.mats.lit.emissiveIntensity = 0.95 * L.windowLit;
    // Fog closes in at street level and on foggy days.
    const fogK = 1 - 0.75 * (w.fog || 0);
    const fogNear = this.rig.mode === 'orbit' ? Math.max(8, span * 1.4) * fogK : 4 * fogK;
    const fogFar = this.rig.mode === 'orbit' ? Math.max(30, span * 4 + 20) * fogK : 26 * fogK;
    this.scene.fog.near = fogNear;
    this.scene.fog.far = fogFar;
    this.scene.fog.color.set(L.skyBottom);
    return { L, w };
  }

  // At night the street lamps nearest the camera cast real light (phones can't afford them all).
  lightLamps(focus, L) {
    const n = QUALITY[this.level].lamps;
    const on = L.lamps > 0.05 && n > 0;
    const near = [];
    if (on) {
      for (const c of this.chunks.values()) {
        for (const lp of c.lamps) {
          const d = (lp.x - focus.x) ** 2 + (lp.z - focus.z) ** 2;
          if (d < 64) near.push([d, lp]);
        }
      }
      near.sort((a, b) => a[0] - b[0]);
    }
    this.lampLights.forEach((l, i) => {
      const lp = on && i < n ? near[i]?.[1] : null;
      if (!lp) {
        l.intensity = 0;
        l.visible = false;
        return;
      }
      l.visible = true;
      l.position.set(lp.x, lp.y - 0.02, lp.z);
      l.intensity = 0.7 * L.lamps;
    });
  }

  // ---- the frame ------------------------------------------------------------------------

  frame(dt) {
    if (!this.active) return;
    this.time += dt;
    this.syncChunks(2);
    this.applyKeys(dt);
    this.applyStick(dt);
    this.rig.update(dt);
    const p = this.rig.pose();
    const cam = this.camera;
    cam.position.set(p.px, p.py, p.pz);
    cam.lookAt(p.lx, p.ly, p.lz);
    const span = Math.hypot(p.px - p.lx, p.py - p.ly, p.pz - p.lz);
    cam.near = Math.max(0.01, Math.min(0.25, span * 0.02));
    cam.far = Math.max(60, span * 8 + 60);
    cam.updateProjectionMatrix();
    this.sky.position.copy(cam.position);
    this.sky.scale.setScalar((cam.far * 0.9) / 300); // inside the far plane, or it isn't drawn
    const focus = this.rig.focus();
    const { L, w } = this.light(focus, span);
    this.lightLamps(focus, L);
    const agents = this.deps.agents;
    this.people.update(agents.walkers, this.time, { wet: Math.max(w.rain || 0, w.snow || 0), softShadows: !QUALITY[this.level].shadows });
    this.cars.update(agents, { night: L.lamps });
    for (const c of this.chunks.values()) for (const m of c.meshes) if (m.material === this.mats.water) m.position.y = Math.sin(this.time * 1.3) * 0.004;
    this.updateWeather(w, focus, span);
    this.gl.render(this.scene, cam);
    this.watchSpeed(dt);
    if (this.rig.mode === 'follow') this.checkSubject();
  }

  // Auto quality: if frames stay slow for a few seconds, step down a level.
  watchSpeed(dt) {
    if (this.quality !== 'auto') return;
    const p = this.perf;
    p.t += dt;
    p.frames++;
    if (p.t < 2) return;
    const ms = (p.t / p.frames) * 1000;
    p.t = 0;
    p.frames = 0;
    p.slow = ms > 30 ? p.slow + 1 : 0;
    if (p.slow >= 2 && this.level !== 'low') {
      this.level = this.level === 'high' ? 'medium' : 'low';
      p.slow = 0;
      this.applyQuality();
      this.updateHud();
    }
  }

  // ---- following someone ------------------------------------------------------------

  follow(w) {
    this.subjectWalker = w;
    this.rig.subject = () => this.subjectPos();
    this.rig.setMode('follow', { force: true });
    this.updateHud();
  }

  followHero() {
    const char = this.deps.lifeChar();
    if (!char?.alive) {
      // No Life character yet: follow someone out walking near the middle of the view.
      const f = this.rig.focus();
      let best = null;
      let bestD = Infinity;
      for (const w of this.deps.agents.walkers) {
        if (w.alpha < 0.5 || w.leaving) continue;
        const d = (w.gx - f.x) ** 2 + (w.gy - f.z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = w;
        }
      }
      if (!best) return this.deps.toast('Nobody is out walking right now');
      return this.follow(best);
    }
    this.subjectWalker = 'hero';
    this.rig.subject = () => this.subjectPos();
    this.rig.setMode('follow', { force: true });
    this.updateHud();
  }

  subjectPos() {
    if (this.subjectWalker === 'hero') {
      const h = this.deps.agents.hero;
      if (h && !h.dead && h.alpha > 0.2) {
        this.lastHero = { x: h.gx, z: h.gy, heading: h.heading || 0 };
        return this.lastHero;
      }
      const c = this.deps.lifeChar();
      if (this.lastHero) return this.lastHero;
      return c?.home ? { x: c.home.x + 0.5, z: c.home.y + 0.5, heading: 0 } : null;
    }
    const w = this.subjectWalker;
    if (!w) return null;
    return { x: w.gx, z: w.gy, heading: w.heading || 0 };
  }

  // A resident who has gone indoors or home: pick up someone else walking nearby.
  checkSubject() {
    const w = this.subjectWalker;
    if (!w || w === 'hero') return;
    if (!w.dead && w.alpha > 0.1) return;
    let best = null;
    let bestD = 9;
    for (const o of this.deps.agents.walkers) {
      if (o === w || o.alpha < 0.5 || o.leaving) continue;
      const d = (o.gx - w.gx) ** 2 + (o.gy - w.gy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    if (best) this.subjectWalker = best;
    else {
      this.rig.setMode('orbit');
      this.updateHud();
    }
  }

  // ---- input ---------------------------------------------------------------------------

  bindInput() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t0: performance.now(), button: e.button, shift: e.shiftKey || e.ctrlKey || e.metaKey });
      this.pinch = null;
    });
    c.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      const h = window.innerHeight || 1;
      if (this.pointers.size === 1) {
        if (p.button === 2 || p.shift) this.rig.pan((-dx / h) * 1.1, (dy / h) * 1.1);
        else if (this.rig.mode === 'street') this.rig.rotate(-dx * 0.005, dy * 0.004);
        else this.rig.rotate(-dx * 0.006, dy * 0.005);
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        if (this.pinch) {
          this.rig.zoom(this.pinch.dist / Math.max(10, dist));
          this.rig.pan((-(mid.x - this.pinch.mid.x) / h) * 1.1, ((mid.y - this.pinch.mid.y) / h) * 1.1);
          let da = ang - this.pinch.ang;
          da = Math.atan2(Math.sin(da), Math.cos(da));
          this.rig.rotate(da, 0);
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
      if (moved < 7 && performance.now() - p.t0 < 350 && e.type === 'pointerup') this.tap(e.clientX, e.clientY);
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const k = e.ctrlKey ? 0.012 : e.deltaMode === 1 ? 0.05 : 0.0015;
        this.rig.zoom(Math.exp(Math.max(-0.6, Math.min(0.6, e.deltaY * k))));
      },
      { passive: false }
    );
    // Keys are read in capture so the builder's own shortcuts (tools, panning) don't also fire.
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.active || this.deps.isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
        const k = e.code;
        if (k === 'Escape') {
          if (this.rig.mode !== 'orbit') {
            this.rig.setMode('orbit');
            this.updateHud();
          } else this.deps.onExit();
        } else if (k === 'KeyG') this.deps.onExit();
        else if (k === 'KeyF' && e.shiftKey) this.followHero();
        else if (k === 'Digit1') this.setMode('orbit');
        else if (k === 'Digit2') this.setMode('street');
        else if (k === 'Digit3') this.followHero();
        else if (MOVE_KEYS.has(k)) this.keys.add(k);
        else return;
        e.preventDefault();
        e.stopImmediatePropagation();
      },
      true
    );
    window.addEventListener(
      'keyup',
      (e) => {
        if (this.keys.delete(e.code)) e.stopImmediatePropagation();
      },
      true
    );
    window.addEventListener('blur', () => this.keys.clear());
  }

  setMode(mode) {
    if (mode === 'follow') return this.followHero();
    if (mode === 'street' && this.rig.mode === 'orbit') {
      const spot = this.streetSpot(this.rig.o.x, this.rig.o.z);
      if (spot) {
        // Face the way that's closest to where the orbit camera was looking.
        const look = this.rig.o.yaw + Math.PI;
        const a = spot.yaw;
        const b = spot.yaw + Math.PI;
        const diff = (u) => Math.abs(Math.atan2(Math.sin(u - look), Math.cos(u - look)));
        this.rig.setMode('street', { at: spot, yaw: diff(a) < diff(b) ? a : b });
        return this.updateHud();
      }
    }
    this.rig.setMode(mode);
    this.updateHud();
  }

  applyKeys(dt) {
    if (!this.keys.size) return;
    const K = this.keys;
    const has = (...c) => c.some((k) => K.has(k));
    const fast = has('ShiftLeft', 'ShiftRight') ? 2.2 : 1;
    const fwd = (has('KeyW', 'ArrowUp') ? 1 : 0) - (has('KeyS', 'ArrowDown') ? 1 : 0);
    const side = (has('KeyD') ? 1 : 0) - (has('KeyA') ? 1 : 0);
    const turn = (has('KeyE', 'ArrowRight') ? 1 : 0) - (has('KeyQ', 'ArrowLeft') ? 1 : 0);
    const tilt = (has('KeyR') ? 1 : 0) - (has('KeyF') ? 1 : 0);
    const zoom = (has('Equal', 'NumpadAdd') ? 1 : 0) - (has('Minus', 'NumpadSubtract') ? 1 : 0);
    const mode = this.rig.mode;
    if (mode === 'follow' && (fwd || side)) {
      // Take over: step off from the person you were following and walk yourself.
      this.rig.setMode('street');
      this.updateHud();
    }
    if (this.rig.mode === 'street') {
      this.rig.walk(fwd * 1.1 * fast * dt, side * 0.9 * fast * dt);
      if (turn) this.rig.rotate(-turn * 1.8 * dt, 0);
      if (tilt) this.rig.rotate(0, -tilt * 1.2 * dt);
    } else {
      if (fwd || side) this.rig.pan(side * 0.7 * fast * dt, fwd * 0.7 * fast * dt);
      if (turn) this.rig.rotate(turn * 1.6 * dt, 0);
      if (tilt) this.rig.rotate(0, tilt * 1.0 * dt);
    }
    if (zoom) this.rig.zoom(Math.exp(-zoom * 1.4 * dt));
  }

  // Tap someone to follow them; tap a building to see what it is.
  tap(sx, sy) {
    const v = new THREE.Vector3();
    let best = null;
    let bestD = touchFirst() ? 34 : 24;
    for (const w of this.people.list) {
      v.set(w.gx, 0.08, w.gy).project(this.camera);
      if (v.z > 1) continue;
      const px = ((v.x + 1) / 2) * window.innerWidth;
      const py = ((1 - v.y) / 2) * window.innerHeight;
      const d = Math.hypot(px - sx, py - sy);
      if (d < bestD) {
        bestD = d;
        best = w;
      }
    }
    if (best) {
      this.follow(best.hero ? best : best);
      if (best.hero) this.subjectWalker = 'hero';
      return;
    }
    const ndc = new THREE.Vector2((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const targets = [];
    for (const c of this.chunks.values()) for (const m of c.meshes) if (m.userData.pick) targets.push(m);
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    if (!hit) return;
    // Nudge into the face that was hit, so a wall picks its own building.
    const p = hit.point.clone().addScaledVector(hit.face?.normal || new THREE.Vector3(), -0.01);
    const tx = Math.floor(p.x);
    const ty = Math.floor(p.z);
    if (this.city.getTile(tx, ty)) this.deps.onPick(tx, ty);
  }

  // ---- on-screen controls --------------------------------------------------------------

  buildHud() {
    const hud = (this.hud = document.createElement('div'));
    hud.className = 'v3d-hud';
    hud.hidden = true;
    hud.innerHTML = `
      <button type="button" class="pill glass" data-act="exit" title="Back to the builder (G)">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        <span class="pill-text">Builder</span>
      </button>
      <div class="v3d-modes glass" role="group" aria-label="Camera">
        <button type="button" data-mode="orbit" title="Orbit the town (1)">Orbit</button>
        <button type="button" data-mode="street" title="Walk the streets (2)">Street</button>
        <button type="button" data-mode="follow" title="Follow your Life character, or someone nearby (3)">Follow</button>
      </div>
      <button type="button" class="pill glass" data-act="quality" title="Picture quality"></button>`;
    this.hint = document.createElement('div');
    this.hint.className = 'v3d-hint glass';
    this.hint.hidden = true;
    this.stick = document.createElement('div');
    this.stick.className = 'v3d-stick glass';
    this.stick.hidden = true;
    this.stick.innerHTML = '<span class="v3d-knob"></span>';
    this.deps.mountHud(hud, this.hint, this.stick);
    hud.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'exit') this.deps.onExit();
      else if (b.dataset.act === 'quality') {
        const order = ['auto', 'low', 'medium', 'high'];
        this.setQuality(order[(order.indexOf(this.quality) + 1) % order.length]);
        this.deps.toast(`3D quality: ${this.qualityLabel()}`, 1600);
      } else if (b.dataset.mode) this.setMode(b.dataset.mode);
    });
    // The joystick: drag to walk at street level on a touch screen.
    const knob = this.stick.firstElementChild;
    this.stickV = { x: 0, y: 0 };
    let sid = null;
    const move = (e) => {
      const r = this.stick.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      let x = (e.clientX - cx) / (r.width / 2);
      let y = (e.clientY - cy) / (r.height / 2);
      const l = Math.hypot(x, y);
      if (l > 1) {
        x /= l;
        y /= l;
      }
      this.stickV = { x, y };
      knob.style.transform = `translate(${x * 26}px, ${y * 26}px)`;
    };
    this.stick.addEventListener('pointerdown', (e) => {
      sid = e.pointerId;
      this.stick.setPointerCapture?.(e.pointerId);
      move(e);
    });
    this.stick.addEventListener('pointermove', (e) => e.pointerId === sid && move(e));
    const end = (e) => {
      if (e.pointerId !== sid) return;
      sid = null;
      this.stickV = { x: 0, y: 0 };
      knob.style.transform = '';
    };
    this.stick.addEventListener('pointerup', end);
    this.stick.addEventListener('pointercancel', end);
  }

  applyStick(dt) {
    const v = this.stickV;
    if (!v || (!v.x && !v.y)) return;
    if (this.rig.mode !== 'street') return;
    this.rig.walk(-v.y * 1.1 * dt, v.x * 0.9 * dt);
  }

  qualityLabel() {
    return this.quality === 'auto' ? `Auto (${QUALITY[this.level].label})` : QUALITY[this.quality].label;
  }

  updateHud() {
    for (const b of this.hud.querySelectorAll('[data-mode]')) b.classList.toggle('is-on', b.dataset.mode === this.rig.mode);
    this.hud.querySelector('[data-act="quality"]').textContent = `Quality: ${this.qualityLabel()}`;
    this.stick.hidden = !(this.active && this.rig.mode === 'street' && touchFirst());
    this.showHint();
  }

  showHint() {
    if (!this.active) return;
    const touch = touchFirst();
    const mode = this.rig.mode;
    const text =
      mode === 'street'
        ? touch
          ? 'Drag to look around · use the pad to walk'
          : 'Drag to look · W A S D to walk · Q E to turn · Esc to fly up'
        : mode === 'follow'
          ? touch
            ? 'Following · drag to look around · pinch to zoom'
            : 'Following · drag to look around · W A S D to walk yourself · Esc to fly up'
          : touch
            ? 'Drag to rotate · two fingers to move and zoom · tap someone to follow them'
            : 'Drag to rotate · right-drag or W A S D to move · scroll to zoom · tap someone to follow them';
    this.hint.textContent = text;
    this.hint.hidden = false;
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => (this.hint.hidden = true), 6000);
  }
}

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'ShiftLeft', 'ShiftRight', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract']);

export { DIST_MIN, DIST_MAX, WATER_Y };
