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
