// Disasters in 3D, read from the same state the overhead view draws: flood water over the flooded
// tiles, flames and dark smoke on burning buildings, and a spinning funnel for a tornado.

import * as THREE from './vendor/three.module.min.js';

const MAX_FLAMES = 120;

function radial(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 36, 2, 32, 32, 31);
  for (const [at, col] of stops) grad.addColorStop(at, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Effects3D {
  constructor(scene) {
    this.scene = scene;
    // Flood water: one translucent sheet per flooded tile.
    this.floodMat = new THREE.MeshPhongMaterial({ color: 0x7ec8e3, transparent: true, opacity: 0, shininess: 120, specular: 0xd8f0f8, depthWrite: false });
    this.flood = null;
    this.floodSrc = null;
    // Flames and smoke: camera-facing puffs.
    const flameTex = radial([
      [0, 'rgba(255,250,200,1)'],
      [0.35, 'rgba(255,170,70,0.9)'],
      [1, 'rgba(255,90,40,0)'],
    ]);
    const smokeTex = radial([
      [0, 'rgba(255,255,255,0.9)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    const quad = new THREE.PlaneGeometry(0.16, 0.2);
    this.flames = new THREE.InstancedMesh(quad, new THREE.MeshBasicMaterial({ map: flameTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), MAX_FLAMES);
    this.soot = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshBasicMaterial({ map: smokeTex, color: 0x5a5466, transparent: true, opacity: 0.6, depthWrite: false }), MAX_FLAMES);
    for (const m of [this.flames, this.soot]) {
      m.count = 0;
      m.frustumCulled = false;
      scene.add(m);
    }
    this.fireLight = new THREE.PointLight(0xff9a4a, 0, 2.2, 1.4);
    scene.add(this.fireLight);
    // The tornado: stacked rings that widen toward the sky and spin.
    this.twister = new THREE.Group();
    const ringMat = new THREE.MeshLambertMaterial({ color: 0xb9b4c8, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    for (let i = 0; i < 14; i++) {
      const r = 0.05 + i * i * 0.0035;
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.1, r, 0.16, 12, 1, true), ringMat);
      ring.position.y = 0.08 + i * 0.15;
      this.twister.add(ring);
    }
    this.twister.visible = false;
    scene.add(this.twister);
    this.m = new THREE.Matrix4();
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3();
  }

  update(city, view, camera, time) {
    const a = city.systems.disasters?.active;
    const nowDay = city.day + city.clock;
    this.updateFlood(city, a, nowDay, time);
    this.updateFire(city, view, camera, nowDay, time);
    this.updateTwister(a, time);
  }

  updateFlood(city, a, nowDay, time) {
    if (!a?.flooded?.length) {
      if (this.flood) this.flood.visible = false;
      return;
    }
    if (this.floodSrc !== a.flooded) {
      if (this.flood) {
        this.scene.remove(this.flood);
        this.flood.dispose();
      }
      const geo = new THREE.PlaneGeometry(0.98, 0.98).rotateX(-Math.PI / 2);
      this.flood = new THREE.InstancedMesh(geo, this.floodMat, a.flooded.length);
      a.flooded.forEach((k, i) => this.flood.setMatrixAt(i, this.m.makeTranslation((k % city.width) + 0.5, 0.035, Math.floor(k / city.width) + 0.5)));
      this.flood.frustumCulled = false;
      this.scene.add(this.flood);
      this.floodSrc = a.flooded;
    }
    // Rises, holds, then drains away, like the overhead view.
    const f = (nowDay - a.started) / Math.max(0.01, a.ends - a.started);
    const level = Math.max(0, Math.min(1, Math.min(f / 0.2, (1 - f) / 0.2, 1)));
    this.flood.visible = level > 0;
    this.floodMat.opacity = 0.7 * level;
    this.flood.position.y = (level - 1) * 0.03 + Math.sin(time * 1.4) * 0.003;
  }

  updateFire(city, view, camera, nowDay, time) {
    let n = 0;
    let lightAt = null;
    const q = camera.quaternion;
    for (const t of city.tiles) {
      const s = t.structure;
      if (!s?.burning || s.burning <= nowDay) continue;
      const top = view.heightAt(t.x + 0.5, t.y + 0.5) || 0.3;
      lightAt ||= { x: t.x + 0.5, y: top, z: t.y + 0.5 };
      for (let k = 0; k < 4 && n < MAX_FLAMES; k++) {
        const fl = 0.7 + 0.3 * Math.sin(time * 14 + k * 2 + t.x);
        const ox = ((k % 2) - 0.5) * 0.18;
        const oz = (Math.floor(k / 2) - 0.5) * 0.18;
        this.m.compose(this.v.set(t.x + 0.5 + ox, top + 0.05 + 0.04 * fl, t.y + 0.5 + oz), q, this.s.set(fl, fl * 1.2, fl));
        this.flames.setMatrixAt(n, this.m);
        const life = (time * 0.5 + k * 0.25 + t.x * 0.1) % 1;
        const sz = 0.8 + life * 2;
        this.m.compose(this.v.set(t.x + 0.5 + ox + life * 0.2, top + 0.15 + life * 0.9, t.y + 0.5 + oz), q, this.s.set(sz, sz, sz));
        this.soot.setMatrixAt(n, this.m);
        n++;
      }
    }
    this.flames.count = this.soot.count = n;
    this.flames.instanceMatrix.needsUpdate = this.soot.instanceMatrix.needsUpdate = true;
    this.fireLight.visible = !!lightAt;
    if (lightAt) {
      this.fireLight.position.set(lightAt.x, lightAt.y + 0.2, lightAt.z);
      this.fireLight.intensity = 1.2 + 0.4 * Math.sin(time * 17);
    }
  }

  updateTwister(a, time) {
    const pos = a?.kind === 'tornado' ? a.pos : null;
    this.twister.visible = !!pos;
    if (!pos) return;
    this.twister.position.set(pos.x, 0, pos.y);
    this.twister.children.forEach((ring, i) => {
      ring.rotation.y = time * (6 + i * 0.3);
      ring.position.x = Math.sin(time * 2 + i * 0.4) * 0.03 * i;
    });
  }
}
