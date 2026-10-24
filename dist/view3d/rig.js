// The 3D camera: three ways of looking at the town and smooth moves between them.
//  orbit  – circle a point on the ground: rotate, tilt, zoom and slide around the map.
//  street – stand at eye height on the street and walk about, looking around freely.
//  follow – ride along just behind someone as they walk (a resident or your Life character).
// Values ease toward their targets each frame, and switching modes glides from the old view to the
// new one (an ease-in-out tween, the Godot-style camera smoothing from the Studio notes).
// Pure maths, no Three.js: pose() gives the camera position and the point it looks at.

export const EYE = 0.13; // eye height on the street (a person is about 0.14 tall)
const PITCH_MIN = 0.1;
const PITCH_MAX = 1.48;
export const DIST_MIN = 0.6;
export const DIST_MAX = 70;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const damp = (dt, rate = 10) => 1 - Math.exp(-dt * rate);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class CameraRig {
  constructor() {
    this.mode = 'orbit';
    this.w = 32;
    this.h = 32;
    // orbit (current and goal)
    this.o = { x: 16, z: 16, yaw: Math.PI / 4, pitch: 0.62, dist: 14 };
    this.og = { ...this.o };
    // street
    this.s = { x: 16, z: 16, yaw: 0, pitch: 0.05 };
    this.sg = { ...this.s };
    // follow
    this.subject = null; // () → { x, z, heading } or null
    this.f = { yaw: 0, dist: 0.7, pitch: 0.62, x: 0, y: 0, z: 0, lx: 0, ly: 0, lz: 0, ready: false };
    this.fg = { yaw: 0, dist: 0.7, pitch: 0.62 };
    this.blocked = () => false; // (x, z) → true when the street camera may not stand there
    this.from = null;
    this.blend = 1;
  }

  setBounds(w, h) {
    this.w = w;
    this.h = h;
  }

  // Start orbiting from where the overhead camera was looking.
  lookFrom(x, z, dist) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      x = this.w / 2;
      z = this.h / 2;
    }
    if (!Number.isFinite(dist)) dist = 14;
    x = clamp(x, 0, this.w);
    z = clamp(z, 0, this.h);
    this.og.x = this.o.x = x;
    this.og.z = this.o.z = z;
    this.og.dist = this.o.dist = clamp(dist, DIST_MIN, DIST_MAX);
    this.og.yaw = this.o.yaw = Math.PI / 4;
    this.og.pitch = this.o.pitch = 0.62;
    this.mode = 'orbit';
    this.blend = 1;
  }

  setMode(mode, opts = {}) {
    if (mode === this.mode && !opts.force) return;
    this.from = this.pose();
    this.blend = 0;
    const prev = this.mode;
    this.mode = mode;
    if (mode === 'street') {
      // Step down onto the street where the orbit camera was looking, facing the same way.
      const at = opts.at || (prev === 'follow' && this.subject?.()) || { x: this.o.x, z: this.o.z };
      const spot = this.freeSpot(at.x, at.z);
      const yaw = opts.yaw ?? (prev === 'follow' && this.subject?.() ? this.subject().heading : this.o.yaw + Math.PI);
      this.s = { x: spot.x, z: spot.z, yaw, pitch: 0.04 };
      this.sg = { ...this.s };
    } else if (mode === 'orbit') {
      const at = prev === 'street' ? { x: this.s.x, z: this.s.z } : prev === 'follow' && this.subject?.() ? this.subject() : null;
      if (at) {
        this.og.x = at.x;
        this.og.z = at.z;
        this.og.dist = Math.max(this.og.dist > 6 ? 6 : this.og.dist, 3);
        if (prev === 'street') this.og.yaw = this.s.yaw + Math.PI;
      }
    } else if (mode === 'follow') {
      this.f.ready = false;
      this.fg.yaw = 0;
    }
  }

  // The nearest spot the street camera may stand on (not inside a building).
  freeSpot(x, z) {
    if (!this.blocked(x, z)) return { x, z };
    for (let r = 1; r <= 6; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const px = Math.floor(x) + dx + 0.5;
          const pz = Math.floor(z) + dz + 0.5;
          if (!this.blocked(px, pz)) return { x: px, z: pz };
        }
      }
    }
    return { x, z };
  }

  // ---- input -------------------------------------------------------------------------

  rotate(dyaw, dpitch) {
    if (this.mode === 'orbit') {
      this.og.yaw += dyaw;
      this.og.pitch = clamp(this.og.pitch + dpitch, PITCH_MIN, PITCH_MAX);
    } else if (this.mode === 'street') {
      this.sg.yaw -= dyaw;
      this.sg.pitch = clamp(this.sg.pitch - dpitch, -0.7, 0.85);
    } else {
      this.fg.yaw += dyaw;
      this.fg.pitch = clamp(this.fg.pitch + dpitch, 0.05, 1.2);
    }
  }

  zoom(factor) {
    if (this.mode === 'orbit') this.og.dist = clamp(this.og.dist * factor, DIST_MIN, DIST_MAX);
    else if (this.mode === 'follow') this.fg.dist = clamp(this.fg.dist * factor, 0.3, 3);
    else this.walk(factor < 1 ? 0.25 : -0.25, 0);
  }

  // Slide the orbit point by (right, forward) in screen terms, scaled to how far out the camera is.
  pan(right, forward) {
    if (this.mode !== 'orbit') return this.walk(forward * 0.6, right * 0.6);
    const k = this.og.dist;
    const yaw = this.og.yaw;
    const fx = -Math.cos(yaw);
    const fz = -Math.sin(yaw);
    const rx = Math.sin(yaw);
    const rz = -Math.cos(yaw);
    this.og.x = clamp(this.og.x + (rx * right + fx * forward) * k, -2, this.w + 2);
    this.og.z = clamp(this.og.z + (rz * right + fz * forward) * k, -2, this.h + 2);
  }

  // Walk the street camera (forward and right in grid units), sliding along walls.
  walk(forward, right) {
    if (this.mode === 'orbit') return this.pan(right / Math.max(1, this.og.dist), forward / Math.max(1, this.og.dist));
    if (this.mode !== 'street') return;
    const yaw = this.sg.yaw;
    const dx = Math.cos(yaw) * forward - Math.sin(yaw) * right;
    const dz = Math.sin(yaw) * forward + Math.cos(yaw) * right;
    const nx = clamp(this.sg.x + dx, 0.05, this.w - 0.05);
    const nz = clamp(this.sg.z + dz, 0.05, this.h - 0.05);
    if (!this.blocked(nx, nz)) {
      this.sg.x = nx;
      this.sg.z = nz;
    } else if (!this.blocked(nx, this.sg.z)) this.sg.x = nx;
    else if (!this.blocked(this.sg.x, nz)) this.sg.z = nz;
  }

  // ---- per frame ----------------------------------------------------------------------

  update(dt) {
    const k = damp(dt, 9);
    for (const key of ['x', 'z', 'pitch', 'dist']) this.o[key] += (this.og[key] - this.o[key]) * k;
    this.o.yaw += wrap(this.og.yaw - this.o.yaw) * k;
    const ks = damp(dt, 14);
    this.s.x += (this.sg.x - this.s.x) * ks;
    this.s.z += (this.sg.z - this.s.z) * ks;
    this.s.yaw += wrap(this.sg.yaw - this.s.yaw) * ks;
    this.s.pitch += (this.sg.pitch - this.s.pitch) * ks;
    const kf = damp(dt, 6);
    this.f.yaw += wrap(this.fg.yaw - this.f.yaw) * kf;
    this.f.dist += (this.fg.dist - this.f.dist) * kf;
    this.f.pitch += (this.fg.pitch - this.f.pitch) * kf;
    if (this.mode === 'follow') {
      const p = this.subject?.();
      if (p) {
        // Trail behind the person, a little above their head, looking just ahead of them.
        const yaw = p.heading + Math.PI + this.f.yaw;
        const d = this.f.dist;
        const want = {
          x: p.x + Math.cos(yaw) * Math.cos(this.f.pitch) * d,
          y: 0.06 + Math.sin(this.f.pitch) * d,
          z: p.z + Math.sin(yaw) * Math.cos(this.f.pitch) * d,
          lx: p.x + Math.cos(p.heading) * 0.12,
          ly: 0.08,
          lz: p.z + Math.sin(p.heading) * 0.12,
        };
        const kk = this.f.ready ? damp(dt, 4) : 1;
        for (const key of ['x', 'y', 'z', 'lx', 'ly', 'lz']) this.f[key] += (want[key] - this.f[key]) * kk;
        this.f.ready = true;
      }
    }
    if (this.blend < 1) this.blend = Math.min(1, this.blend + dt / 0.9);
  }

  modePose() {
    if (this.mode === 'street') {
      const { x, z, yaw, pitch } = this.s;
      return {
        px: x,
        py: EYE,
        pz: z,
        lx: x + Math.cos(yaw) * Math.cos(pitch),
        ly: EYE + Math.sin(pitch),
        lz: z + Math.sin(yaw) * Math.cos(pitch),
      };
    }
    if (this.mode === 'follow' && this.f.ready) {
      const f = this.f;
      return { px: f.x, py: f.y, pz: f.z, lx: f.lx, ly: f.ly, lz: f.lz };
    }
    const { x, z, yaw, pitch, dist } = this.o;
    return {
      px: x + Math.cos(pitch) * Math.cos(yaw) * dist,
      py: Math.sin(pitch) * dist,
      pz: z + Math.cos(pitch) * Math.sin(yaw) * dist,
      lx: x,
      ly: 0,
      lz: z,
    };
  }

  pose() {
    const p = this.modePose();
    if (this.blend >= 1 || !this.from) return p;
    const t = ease(this.blend);
    const out = {};
    for (const key of ['px', 'py', 'pz', 'lx', 'ly', 'lz']) out[key] = this.from[key] + (p[key] - this.from[key]) * t;
    return out;
  }

  // Where on the ground the camera is looking (for the overhead view on the way back, and for
  // centring shadows and lamp lights).
  focus() {
    if (this.mode === 'street') return { x: this.s.x, z: this.s.z };
    if (this.mode === 'follow' && this.subject?.()) return this.subject();
    return { x: this.o.x, z: this.o.z };
  }

  // How far the camera is from what it looks at (used for the overhead zoom on the way back).
  span() {
    return this.mode === 'orbit' ? this.o.dist : 2.5;
  }
}
