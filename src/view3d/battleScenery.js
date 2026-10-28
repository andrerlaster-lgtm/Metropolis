// The countryside around the military base (view3d/battle3d.js): a wooden fence with lanterns, corner
// watch towers, a camp of tents, trucks and crates on the flanks, and woods of pines and round trees.
// It is only decoration outside the field, so nothing here touches the rules or the tiles.

import * as THREE from './vendor/three.module.min.js';
import { mergeStatic } from './mergeGeo.js';

const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// A tent: a triangular prism with a dark doorway, pointing along z.
function tent(canvasMat, doorMat) {
  const shape = new THREE.Shape();
  shape.moveTo(-0.95, 0);
  shape.lineTo(0.95, 0);
  shape.lineTo(0, 1.05);
  shape.closePath();
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 2.2, bevelEnabled: false }).translate(0, 0, -1.1), canvasMat);
  body.castShadow = true;
  const door = new THREE.Mesh(box(0.5, 0.55, 0.04), doorMat);
  door.position.set(0, 0.28, 1.12);
  g.add(body, door);
  return g;
}

function truck(olive, dark, glass) {
  const g = new THREE.Group();
  const bed = new THREE.Mesh(box(1.1, 0.42, 0.7), olive);
  bed.position.set(-0.2, 0.42, 0);
  const cab = new THREE.Mesh(box(0.45, 0.5, 0.68), olive);
  cab.position.set(0.55, 0.46, 0);
  const win = new THREE.Mesh(box(0.04, 0.22, 0.5), glass);
  win.position.set(0.78, 0.55, 0);
  const cover = new THREE.Mesh(box(1.0, 0.3, 0.64), mat(0xb9b58a));
  cover.position.set(-0.2, 0.78, 0);
  g.add(bed, cab, win, cover);
  for (const x of [-0.5, 0.5]) for (const z of [-0.38, 0.38]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.12, 10).rotateX(Math.PI / 2), dark);
    w.position.set(x, 0.17, z);
    g.add(w);
  }
  g.children.forEach((c) => (c.castShadow = true));
  return g;
}

function watchTower(wood, roof, plank) {
  const g = new THREE.Group();
  for (const x of [-0.32, 0.32]) for (const z of [-0.32, 0.32]) {
    const leg = new THREE.Mesh(box(0.09, 1.7, 0.09), wood);
    leg.position.set(x, 0.85, z);
    leg.castShadow = true;
    g.add(leg);
  }
  const brace = new THREE.Mesh(box(0.7, 0.05, 0.05), wood);
  brace.position.set(0, 0.7, 0.32);
  brace.rotation.z = 0.7;
  g.add(brace);
  const deck = new THREE.Mesh(box(0.95, 0.1, 0.95), plank);
  deck.position.y = 1.72;
  const cabin = new THREE.Mesh(box(0.8, 0.5, 0.8), plank);
  cabin.position.y = 2.02;
  const slit = new THREE.Mesh(box(0.84, 0.14, 0.84), mat(0xffe29a));
  slit.position.y = 2.06;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.72, 0.5, 4).rotateY(Math.PI / 4), roof);
  cap.position.y = 2.52;
  for (const m of [deck, cabin, cap]) m.castShadow = true;
  g.add(deck, slit, cabin, cap);
  return g;
}

export function buildScenery(w, h) {
  const g = new THREE.Group();
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const wood = mat(0x8a6a4a);
  const woodDark = mat(0x6a4f36);
  const plank = mat(0xa88458);
  const roofMat = mat(0x5f6b45);
  const olive = mat(0x7d8a4f, { side: THREE.DoubleSide });
  const dark = mat(0x2f3034);

  // Fence: posts with two rails, all round the field except a gate in the bottom edge.
  const posts = [];
  const rails = [];
  const run = (x0, z0, x1, z1) => {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0)));
    for (let i = 0; i <= n; i++) posts.push([x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n]);
    rails.push([x0, z0, x1, z1]);
  };
  const o = 0.45;
  run(-o, -o, w + o, -o);
  run(-o, -o, -o, h + o);
  run(w + o, -o, w + o, h + o);
  const gate = w / 2;
  run(-o, h + o, gate - 1.4, h + o);
  run(gate + 1.4, h + o, w + o, h + o);
  const postMesh = new THREE.InstancedMesh(box(0.1, 0.62, 0.1), woodDark, posts.length);
  const m4 = new THREE.Matrix4();
  posts.forEach(([x, z], i) => postMesh.setMatrixAt(i, m4.makeTranslation(x, 0.31, z)));
  postMesh.castShadow = true;
  g.add(postMesh);
  for (const [x0, z0, x1, z1] of rails) {
    for (const y of [0.24, 0.46]) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const r = new THREE.Mesh(box(len, 0.05, 0.04), wood);
      r.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
      r.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
      g.add(r);
    }
  }
  // Gateposts and lanterns along the fence.
  const glow = new THREE.MeshBasicMaterial({ color: 0xffd98a });
  const lamps = [
    [-o, h * 0.3], [-o, h * 0.7], [w + o, h * 0.3], [w + o, h * 0.7], [gate - 1.4, h + o], [gate + 1.4, h + o],
  ];
  for (const [x, z] of lamps) {
    const pole = new THREE.Mesh(box(0.07, 1.25, 0.07), dark);
    pole.position.set(x, 0.62, z);
    const head = new THREE.Mesh(box(0.2, 0.22, 0.2), glow);
    head.position.set(x, 1.3, z);
    const cap = new THREE.Mesh(box(0.28, 0.06, 0.28), dark);
    cap.position.set(x, 1.45, z);
    g.add(pole, head, cap);
  }
  // Corner watch towers.
  for (const [x, z, ry] of [[-1.2, -1.2, 0.5], [w + 1.2, -1.2, -0.5], [-1.2, h + 1.2, -0.5], [w + 1.2, h + 1.2, 0.5]]) {
    const t = watchTower(wood, roofMat, plank);
    t.position.set(x, 0, z);
    t.rotation.y = ry;
    t.scale.setScalar(1.15);
    g.add(t);
  }
  // A camp on each side: tents, trucks and crates.
  const doorMat = mat(0x2d2a22);
  const glass = mat(0x7f9fb0);
  const crateMat = mat(0xb89560);
  const bagMat = mat(0xd9c488);
  for (const side of [-1, 1]) {
    const cx = side < 0 ? -4.4 : w + 4.4;
    for (let i = 0; i < 3; i++) {
      const t = tent(olive, doorMat);
      t.position.set(cx + (rnd() - 0.5) * 0.8, 0, 3 + i * 5.4 + rnd());
      t.rotation.y = (side < 0 ? Math.PI / 2 : -Math.PI / 2) + (rnd() - 0.5) * 0.3;
      t.scale.setScalar(1.05 + rnd() * 0.25);
      g.add(t);
    }
    const tr = truck(mat(0x6f7c45), dark, glass);
    tr.position.set(cx + side * 0.2, 0, h - 3.2);
    tr.rotation.y = side < 0 ? 0.4 : Math.PI - 0.4;
    g.add(tr);
    for (let i = 0; i < 5; i++) {
      const c = new THREE.Mesh(box(0.34, 0.3, 0.34), crateMat);
      c.position.set(cx + (rnd() - 0.5) * 2.5, 0.15, 1.2 + rnd() * (h - 3));
      c.rotation.y = rnd() * 3;
      c.castShadow = true;
      g.add(c);
    }
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(box(0.42, 0.16, 0.24), bagMat);
      b.position.set(cx + side * 1.8 + (rnd() - 0.5) * 0.5, 0.08 + (i % 2) * 0.16, 1.5 + i * 0.26);
      g.add(b);
    }
  }
  // Woods: pines and round trees, a few turning autumn orange, and bushes at their feet.
  const trunk = mat(0x7a5a3a);
  const pineA = mat(0x3f7d45, { flatShading: true });
  const pineB = mat(0x4f9150, { flatShading: true });
  const rounds = [mat(0x6fae5a, { flatShading: true }), mat(0x86bd5c, { flatShading: true }), mat(0x5a9a52, { flatShading: true }), mat(0xd98a3a, { flatShading: true })];
  const bush = mat(0x5a9a4a, { flatShading: true });
  const rockMat = mat(0xa6a29a, { flatShading: true });
  for (let i = 0; i < 90; i++) {
    const side = i % 4;
    let x;
    let z;
    if (side === 0) { x = -7.5 - rnd() * 7; z = rnd() * (h + 14) - 7; }
    else if (side === 1) { x = w + 7.5 + rnd() * 7; z = rnd() * (h + 14) - 7; }
    else if (side === 2) { x = rnd() * (w + 28) - 14; z = -3 - rnd() * 8; }
    else { x = rnd() * (w + 28) - 14; z = h + 3 + rnd() * 8; }
    if (side > 1 && x > -7 && x < w + 7 && z > -2 && z < h + 2) continue;
    const t = new THREE.Group();
    const s = 0.9 + rnd() * 0.8;
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.5, 5), trunk);
    tr.position.y = 0.25;
    t.add(tr);
    if (rnd() < 0.55) {
      for (let k = 0; k < 3; k++) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.62 - k * 0.16, 0.8, 7), k % 2 ? pineB : pineA);
        cone.position.y = 0.7 + k * 0.5;
        cone.castShadow = k === 0;
        t.add(cone);
      }
    } else {
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.72, 1), rounds[rnd() < 0.12 ? 3 : Math.floor(rnd() * 3)]);
      crown.position.y = 1.05;
      crown.scale.y = 0.9;
      crown.castShadow = true;
      t.add(crown);
    }
    t.scale.setScalar(s);
    t.rotation.y = rnd() * 6;
    t.position.set(x, 0, z);
    g.add(t);
    if (rnd() < 0.5) {
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3 + rnd() * 0.15, 0), bush);
      b.position.set(x + (rnd() - 0.5) * 1.4, 0.2, z + (rnd() - 0.5) * 1.4);
      g.add(b);
    }
  }
  for (let i = 0; i < 14; i++) {
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3 + rnd() * 0.3, 0), rockMat);
    const onX = i % 2 === 0;
    r.position.set(onX ? (rnd() < 0.5 ? -2 - rnd() * 14 : w + 2 + rnd() * 14) : rnd() * (w + 10) - 5, 0.15, onX ? rnd() * h : (rnd() < 0.5 ? -2 - rnd() * 6 : h + 2 + rnd() * 6));
    r.scale.y = 0.7;
    r.rotation.set(rnd() * 3, rnd() * 3, 0);
    g.add(r);
  }
  return mergeStatic(g);
}
