// The storybook look for the 3D view: textures painted on canvases when the view opens (shingles,
// plaster, stone, cobbles, planks, thatch, bark, leaves, grass; nothing is downloaded), one material per
// surface kind in storybook.js, a breeze in the leaves, and the small shapes scattered by the thousand
// (flower heads, grass tufts). Also the bridge to the game's own models for buildings that have no
// storybook model yet.

import * as THREE from './vendor/three.module.min.js';
import { buildStructure } from './models.js';
import { MeshData } from './mesh.js';

// Draw structure t with the game's own model into storybook layers (walls and roofs into `paint`).
// ctx is the model context view3d.js builds for the tile. Returns false if there is no model.
export function gameModel(out, t, rot, ctx) {
  const md = { solid: new MeshData(), glass: new MeshData(), lit: new MeshData(), glow: new MeshData(), lamps: out.lamps, smoke: out.smoke };
  for (const m of [md.solid, md.glass, md.lit, md.glow]) m.place(t.x + 0.5, t.y + 0.5, rot);
  if (!buildStructure(md, t, ctx)) return false;
  const copy = (from, to) => {
    const a = from.arrays();
    to.raw(a.position, a.normal, a.color);
  };
  copy(md.solid, out.layers.paint);
  copy(md.glass, out.layers.glass);
  copy(md.lit, out.layers.glass);
  copy(md.glow, out.layers.glow);
  return true;
}

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

export function makeTextures(gl) {
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

export function makeMaterials(T) {
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
export function flowerGeometry() {
  const g = new THREE.IcosahedronGeometry(0.011, 0);
  g.scale(1, 0.7, 1);
  return g;
}

// A grass tuft: three thin blades leaning apart.
export function tuftGeometry() {
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
