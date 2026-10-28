// Join geometries into one (positions and normals, plus colours when every piece has them), so a
// detailed model stays one mesh and one draw call. Pieces are made non-indexed first.

import * as THREE from './vendor/three.module.min.js';

export function mergeGeos(list) {
  const parts = list.map((p) => (p.index ? p.toNonIndexed() : p));
  const names = parts.every((x) => x.getAttribute('color')) ? ['position', 'normal', 'color'] : ['position', 'normal'];
  const g = new THREE.BufferGeometry();
  for (const name of names) {
    const arrays = parts.map((x) => x.getAttribute(name).array);
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

// A box between two points (a limb, a strut): `thick` square, as long as the gap.
export function strut(a, b, thick) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const geo = new THREE.BoxGeometry(thick, thick, len);
  const o = new THREE.Object3D();
  o.position.copy(A).lerp(B, 0.5);
  o.lookAt(B);
  o.updateMatrix();
  return geo.applyMatrix4(o.matrix);
}

// Fold a group of static meshes into one mesh per material (instanced meshes are kept as they are), so
// scenery made of hundreds of pieces draws in a handful of calls. A merged mesh casts (or takes) shadows if any of its pieces did.
export function mergeStatic(group) {
  group.updateMatrixWorld(true);
  const buckets = new Map();
  const out = new THREE.Group();
  group.traverse((o) => {
    if (o.isInstancedMesh) {
      out.add(o.clone());
      return;
    }
    if (!o.isMesh) return;
    const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
    let b = buckets.get(o.material);
    if (!b) buckets.set(o.material, (b = { list: [], shadow: false, receive: false }));
    b.list.push(geo);
    b.shadow ||= o.castShadow;
    b.receive ||= o.receiveShadow;
  });
  for (const [material, b] of buckets) {
    const mesh = new THREE.Mesh(mergeGeos(b.list), material);
    mesh.castShadow = b.shadow;
    mesh.receiveShadow = b.receive;
    out.add(mesh);
  }
  return out;
}
