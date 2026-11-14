// Camera: smooth pan and zoom. Holds a target the view eases toward; input moves the target.

import { clamp } from './utils.js';

export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.tx = 0;
    this.ty = 0;
    this.tzoom = 1;
    this.minZoom = 0.2;
    this.maxZoom = 3.5;
    this.viewW = 1;
    this.viewH = 1;
    this.bounds = null;
    this.smooth = true;
    this.anchor = null; // while a zoom eases: the world point that stays under the pointer
  }

  setViewport(w, h) {
    this.viewW = w;
    this.viewH = h;
  }

  setBounds(b) {
    this.bounds = b;
    this.clampTarget();
  }

  update(dt) {
    const k = this.smooth ? 1 - Math.exp(-dt * 12) : 1;
    this.zoom = Math.exp(Math.log(this.zoom) + (Math.log(this.tzoom) - Math.log(this.zoom)) * k);
    if (Math.abs(Math.log(this.tzoom / this.zoom)) < 0.0005) this.zoom = this.tzoom;
    const a = this.anchor;
    if (a && this.zoom !== this.tzoom) {
      // Zooming: the spot under the pointer stays exactly under it all the way in or out, instead of
      // the view sliding there on its own curve.
      this.x = a.wx - a.ox / this.zoom;
      this.y = a.wy - a.oy / this.zoom;
      return;
    }
    if (a) {
      // The zoom has arrived: land exactly where it was heading.
      this.x = this.tx;
      this.y = this.ty;
    }
    this.anchor = null;
    this.x += (this.tx - this.x) * k;
    this.y += (this.ty - this.y) * k;
    // Settle exactly on the target rather than creeping toward it for ever.
    const near = 0.05 / this.zoom;
    if (Math.abs(this.tx - this.x) < near) this.x = this.tx;
    if (Math.abs(this.ty - this.y) < near) this.y = this.ty;
  }

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.viewW / 2) / this.zoom + this.x,
      y: (sy - this.viewH / 2) / this.zoom + this.y,
    };
  }

  // Dragging moves the view exactly with the finger; the target follows so nothing snaps back.
  panBy(dx, dy) {
    this.anchor = null;
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.tx = this.x;
    this.ty = this.y;
    this.clampTarget();
  }

  fling(vx, vy) {
    this.anchor = null;
    this.tx -= (vx * 0.22) / this.zoom;
    this.ty -= (vy * 0.22) / this.zoom;
    this.clampTarget();
  }

  zoomAt(factor, sx, sy, immediate = false) {
    const nz = clamp(this.tzoom * factor, this.minZoom, this.maxZoom);
    const ox = sx - this.viewW / 2;
    const oy = sy - this.viewH / 2;
    const wx = ox / this.tzoom + this.tx;
    const wy = oy / this.tzoom + this.ty;
    this.tzoom = nz;
    this.tx = wx - ox / nz;
    this.ty = wy - oy / nz;
    const freeX = this.tx;
    const freeY = this.ty;
    this.clampTarget();
    // Hold the pointer's spot while the zoom eases, unless the edge of the map pushed the view aside.
    this.anchor = !immediate && this.tx === freeX && this.ty === freeY ? { ox, oy, wx, wy } : null;
    if (immediate) {
      this.x = this.tx;
      this.y = this.ty;
      this.zoom = this.tzoom;
    }
  }

  // Frame a world-space rectangle (the whole board by default) inside the area left free by the interface.
  fit(insets = { top: 0, right: 0, bottom: 0, left: 0 }, immediate = false, rect = this.bounds) {
    const b = rect;
    if (!b) return;
    this.anchor = null;
    const availW = Math.max(120, this.viewW - insets.left - insets.right);
    const availH = Math.max(120, this.viewH - insets.top - insets.bottom);
    const z = clamp(Math.min(availW / (b.right - b.left), availH / (b.bottom - b.top)) * 0.94, 0.15, 2.2);
    if (rect === this.bounds) this.minZoom = Math.min(0.4, z * 0.8);
    this.tzoom = z;
    this.tx = (b.left + b.right) / 2 - (insets.left - insets.right) / 2 / z;
    this.ty = (b.top + b.bottom) / 2 - (insets.top - insets.bottom) / 2 / z;
    if (immediate) {
      this.x = this.tx;
      this.y = this.ty;
      this.zoom = z;
    }
  }

  clampTarget() {
    const b = this.bounds;
    if (!b) return;
    this.tx = clamp(this.tx, b.left, b.right);
    this.ty = clamp(this.ty, b.top, b.bottom);
    this.x = clamp(this.x, b.left - 200, b.right + 200);
    this.y = clamp(this.y, b.top - 200, b.bottom + 200);
  }
}
