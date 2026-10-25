// Minimap: the whole city as a small diamond, with the camera's view outlined. Tap or drag on it to
// jump there. The tiles are drawn once per map change; the view outline is redrawn every frame.

import { PALETTE } from './config.js';
import { HALF_W, HALF_H } from './iso.js';

const COLORS = {
  water: PALETTE.water,
  grass: PALETTE.grass,
  road: '#bdb6a8',
  house: PALETTE.peach,
  tower: '#b79ad0',
  shop: '#ffc98a',
  office: '#9fbfe6',
  school: '#ffab94',
  clinic: '#8fd8bd',
  bakery: '#f2c48d',
  library: '#c4a8de',
  firestation: '#ff8f84',
  university: '#e8b8a0',
  tree: '#7cbf84',
  park: '#8fd29a',
  playground: '#ffd99a',
  field: '#7fca86',
  bungalow: '#f6c9a8',
  rowhouse: '#e8b4a0',
  villa: '#f0b8c8',
  restaurant: '#ffb98a',
  market: '#f5d68a',
  bank: '#a9c0dd',
  hotel: '#c9b4e0',
  warehouse: '#b9b2c4',
  workshop: '#c8b8a0',
  powerplant: '#9a94a8',
  kindergarten: '#ffc4a8',
  museum: '#d4b8c8',
  pharmacy: '#a6e0cc',
  hospital: '#7fd0b4',
  firehut: '#ff9f94',
  fountain: '#9fd8e8',
  garden: '#9ed68a',
  pool: '#8fd0f0',
  cinema: '#c4a0d8',
  stadium: '#90c88a',
  farm: '#d8c76e',
  mill: '#cdb48a',
};

export class Minimap {
  constructor(wrap, city, camera) {
    this.wrap = wrap;
    this.canvas = wrap.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.city = city;
    this.camera = camera;
    this.cache = document.createElement('canvas');
    this.key = '';
    this.size = { w: 168, h: 84 };
    let dragging = false;
    const jump = (e) => {
      const r = this.canvas.getBoundingClientRect();
      const w = this.toWorld(e.clientX - r.left, e.clientY - r.top);
      camera.tx = w.x;
      camera.ty = w.y;
      camera.clampTarget();
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      jump(e);
    });
    this.canvas.addEventListener('pointermove', (e) => dragging && jump(e));
    const stop = () => (dragging = false);
    this.canvas.addEventListener('pointerup', stop);
    this.canvas.addEventListener('pointercancel', stop);
  }

  // Grid → minimap pixels. The diamond fills the canvas.
  get scale() {
    const c = this.city;
    return this.size.w / ((c.width + c.height) * HALF_W);
  }

  toMini(wx, wy) {
    const k = this.scale;
    return { x: (wx + this.city.height * HALF_W) * k, y: wy * k };
  }

  toWorld(mx, my) {
    const k = this.scale;
    return { x: mx / k - this.city.height * HALF_W, y: my / k };
  }

  setVisible(on) {
    this.wrap.hidden = !on;
  }

  redrawTiles(dpr, home) {
    const c = this.city;
    const { w, h } = this.size;
    this.cache.width = Math.round(w * dpr);
    this.cache.height = Math.round(h * dpr);
    const g = this.cache.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const k = this.scale;
    const hw = HALF_W * k;
    const hh = HALF_H * k;
    for (const t of c.tiles) {
      const s = t.structure;
      g.fillStyle = t.terrain === 'water' ? COLORS.water : s ? COLORS[s.type] || COLORS.grass : COLORS.grass;
      const p = this.toMini((t.x - t.y) * HALF_W, (t.x + t.y) * HALF_H);
      g.beginPath();
      g.moveTo(p.x, p.y);
      g.lineTo(p.x + hw + 0.3, p.y + hh);
      g.lineTo(p.x, p.y + 2 * hh + 0.3);
      g.lineTo(p.x - hw - 0.3, p.y + hh);
      g.closePath();
      g.fill();
    }
    if (home) {
      const p = this.toMini((home.x - home.y) * HALF_W, (home.x + home.y + 1) * HALF_H);
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(p.x, p.y, 3.4, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ff7a6b';
      g.beginPath();
      g.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
      g.fill();
    }
  }

  render() {
    if (this.wrap.hidden) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { w, h } = this.size;
    if (this.canvas.width !== Math.round(w * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.key = '';
    }
    const home = this.city.systems.life?.char?.alive ? this.city.systems.life.char.home : null;
    const key = `${this.city.revision}|${this.city.width}|${home ? `${home.x},${home.y}` : ''}`;
    if (key !== this.key) {
      this.key = key;
      this.redrawTiles(dpr, home);
    }
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.drawImage(this.cache, 0, 0);
    // The part of the city on screen.
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cam = this.camera;
    const halfW = cam.viewW / 2 / cam.zoom;
    const halfH = cam.viewH / 2 / cam.zoom;
    // Clamped to the minimap so the outline stays visible when the whole city is on screen.
    const clampX = (v) => Math.max(1.5, Math.min(w - 1.5, v));
    const clampY = (v) => Math.max(1.5, Math.min(h - 1.5, v));
    const a0 = this.toMini(cam.x - halfW, cam.y - halfH);
    const b0 = this.toMini(cam.x + halfW, cam.y + halfH);
    const a = { x: clampX(a0.x), y: clampY(a0.y) };
    const b = { x: clampX(b0.x), y: clampY(b0.y) };
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2.5;
    g.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    g.strokeStyle = '#5b4f86';
    g.lineWidth = 1.2;
    g.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  }
}
