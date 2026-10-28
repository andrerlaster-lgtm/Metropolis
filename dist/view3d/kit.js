// Models built from the Kenney kits (tools/kit/, src/view3d/models/*.glb): one mesh with baked vertex
// colours each. They load in the background the first time they're asked for; until then the caller
// draws its own simpler stand-in, and `onReady` lets it redraw once the model is in.

import * as THREE from './vendor/three.module.min.js';
import { parseGlb } from './glb.js';

const models = new Map(); // name → { geometry | null, promise }

export function kitModel(name, onReady) {
  let m = models.get(name);
  if (!m) {
    m = { geometry: null, failed: false, waiting: [] };
    models.set(name, m);
    fetch(new URL(`./models/${name}.glb`, import.meta.url))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
      .then((buf) => {
        const [p] = parseGlb(buf);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(p.position, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(p.normal, 3));
        g.setAttribute('color', new THREE.BufferAttribute(p.color, p.colorSize));
        if (p.index) g.setIndex(new THREE.BufferAttribute(p.index, 1));
        g.computeBoundingSphere();
        m.geometry = g;
        for (const f of m.waiting.splice(0)) f();
      })
      .catch(() => {
        m.failed = true; // keep the stand-in
      });
  }
  if (!m.geometry && onReady && !m.failed) m.waiting.push(onReady);
  return m.geometry;
}
