// Street-name signs at junctions in 3D: a post on a corner with one plate for each street, named as
// the overhead view names them (streets.js keeps the names in city.systems.streets). All the names
// share one texture, and every plate in town is one mesh.

import * as THREE from './vendor/three.module.min.js';
import { MeshData, linear } from './mesh.js';

const COLS = 4;
const CELL_W = 256;
const CELL_H = 40;
const PLATE_W = 0.17;
const PLATE_H = PLATE_W * (CELL_H / CELL_W);

export class Signs3D {
  constructor(scene) {
    this.scene = scene;
    this.key = '';
    this.meshes = [];
    this.postMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  }

  clear() {
    for (const m of this.meshes) {
      this.scene.remove(m);
      m.geometry.dispose();
      if (m.material !== this.postMat) {
        m.material.map?.dispose();
        m.material.dispose();
      }
    }
    this.meshes = [];
  }

  // Rebuild when the junctions or their names change. footArms(tile) → N/E/S/W bits; shortName(name).
  sync(city, { footArms, shortName, era }) {
    const names = city.systems.streets;
    if (!names) return;
    const W = city.width;
    const spots = [];
    for (const t of city.tiles) {
      if (t.structure?.type !== 'road') continue;
      const m = footArms(t);
      if ((m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1) < 3) continue;
      const k = t.y * W + t.x;
      const h = names.h?.[k];
      const v = names.v?.[k];
      if (!h || !v || h === v) continue;
      // A corner where two arms meet (it has a sidewalk patch), preferring the one toward the camera.
      const corner = [2, 1, 3, 0].find((c) => m & (1 << c) && m & (1 << ((c + 3) % 4)));
      if (corner == null) continue;
      spots.push({ x: t.x, y: t.y, corner, h: shortName(h), v: shortName(v) });
    }
    const key = era + '|' + spots.map((s) => `${s.x},${s.y},${s.corner},${s.h},${s.v}`).join(';');
    if (key === this.key) return;
    this.key = key;
    this.clear();
    if (!spots.length) return;
    const old = era < 2;
    const labels = [...new Set(spots.flatMap((s) => [s.h, s.v]))];
    const tex = this.atlas(labels, old);
    const cell = new Map(labels.map((l, i) => [l, i]));
    const rows = Math.ceil(labels.length / COLS);
    const pos = [];
    const uv = [];
    const posts = new MeshData();
    const pole = linear(old ? '#6b4a33' : '#9d97b6');
    for (const s of spots) {
      const cx = s.x + (s.corner === 1 || s.corner === 2 ? 0.975 : 0.025);
      const cz = s.y + (s.corner >= 2 ? 0.975 : 0.025);
      posts.box(cx - 0.006, 0, cz - 0.006, cx + 0.006, 0.26, cz + 0.006, pole);
      // The east-west street's plate runs along x, the north-south one along z, one above the other.
      // Each plate hangs from the post's top and reaches into the junction, like a real street sign.
      const sx = s.corner === 1 || s.corner === 2 ? -1 : 1;
      const sz = s.corner >= 2 ? -1 : 1;
      this.plate(pos, uv, cx + sx * (PLATE_W / 2 + 0.006), 0.235, cz, 'x', cell.get(s.h), rows);
      this.plate(pos, uv, cx, 0.205, cz + sz * (PLATE_W / 2 + 0.006), 'z', cell.get(s.v), rows);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const plates = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, side: THREE.FrontSide }));
    const a = posts.arrays();
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
    pg.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(a.color, 3));
    const postMesh = new THREE.Mesh(pg, this.postMat);
    postMesh.castShadow = true;
    for (const m of [plates, postMesh]) {
      this.scene.add(m);
      this.meshes.push(m);
    }
  }

  // One plate, readable from both sides: two quads back to back, each with the text the right way round.
  plate(pos, uv, cx, y, cz, along, index, rows) {
    const col = index % COLS;
    const row = Math.floor(index / COLS);
    const u0 = col / COLS;
    const u1 = (col + 1) / COLS;
    const v1 = 1 - row / rows;
    const v0 = 1 - (row + 1) / rows;
    const hw = PLATE_W / 2;
    const y0 = y - PLATE_H / 2;
    const y1 = y + PLATE_H / 2;
    const off = 0.004;
    const quad = (a, b, c, d) => {
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
      uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    };
    if (along === 'x') {
      quad([cx - hw, y0, cz + off], [cx + hw, y0, cz + off], [cx + hw, y1, cz + off], [cx - hw, y1, cz + off]);
      quad([cx + hw, y0, cz - off], [cx - hw, y0, cz - off], [cx - hw, y1, cz - off], [cx + hw, y1, cz - off]);
    } else {
      quad([cx + off, y0, cz + hw], [cx + off, y0, cz - hw], [cx + off, y1, cz - hw], [cx + off, y1, cz + hw]);
      quad([cx - off, y0, cz - hw], [cx - off, y0, cz + hw], [cx - off, y1, cz + hw], [cx - off, y1, cz - hw]);
    }
  }

  atlas(labels, old) {
    const rows = Math.ceil(labels.length / COLS);
    const c = document.createElement('canvas');
    c.width = COLS * CELL_W;
    c.height = rows * CELL_H;
    const g = c.getContext('2d');
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    labels.forEach((text, i) => {
      const x = (i % COLS) * CELL_W;
      const y = Math.floor(i / COLS) * CELL_H;
      g.fillStyle = old ? '#8a5d3b' : '#6d6890';
      g.fillRect(x, y, CELL_W, CELL_H);
      g.strokeStyle = old ? '#e8dccb' : '#ffffff';
      g.lineWidth = 3;
      g.strokeRect(x + 3, y + 3, CELL_W - 6, CELL_H - 6);
      g.fillStyle = '#ffffff';
      let size = 24;
      do g.font = `800 ${size}px Nunito, system-ui, sans-serif`;
      while (g.measureText(text).width > CELL_W - 24 && --size > 10);
      g.fillText(text, x + CELL_W / 2, y + CELL_H / 2 + 1);
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }
}
