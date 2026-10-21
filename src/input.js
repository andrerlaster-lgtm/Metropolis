// Input: turns mouse, touch, pen, trackpad and keyboard input into camera moves and tile actions.
// Tap/click builds one tile; dragging with a build tool paints a stroke (roads draw as an L).
// Touch: two fingers pan and pinch; long-press bulldozes. Mouse: right or middle drag pans,
// right-click bulldozes, wheel zooms. With the Inspect tool, a one-finger or left drag pans.
// Trackpad: two-finger scrolling pans and pinching zooms (the scroll setting can make scrolling
// always zoom or always pan). Keyboard: arrow keys and WASD glide the camera.

const LONG_PRESS_MS = 480;

// Camera keys, by physical position (so French AZERTY keyboards get ZQSD), and the direction each moves.
const PAN_KEYS = {
  ArrowUp: [0, -1],
  KeyW: [0, -1],
  ArrowDown: [0, 1],
  KeyS: [0, 1],
  ArrowLeft: [-1, 0],
  KeyA: [-1, 0],
  ArrowRight: [1, 0],
  KeyD: [1, 0],
};
const KEY_PAN_SPEED = 720; // screen pixels per second at full speed
const KEY_PAN_EASE = 10; // how quickly the glide speeds up and slows down
const WHEEL_GESTURE_GAP_MS = 250; // wheel events closer than this belong to the same scroll

// Is the player typing? Then single keys are text, not game shortcuts.
export function typingTarget(el) {
  if (!el || !el.closest) return false;
  if (el.isContentEditable) return true;
  const field = el.closest('textarea, select, input');
  if (!field) return false;
  if (field.tagName !== 'INPUT') return true;
  return !['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset', 'image'].includes(field.type);
}

// Menus and panels keep their keys (scrolling a list, answering an event) while focus is inside them.
const PANELS = '.more-sheet, .life-panel, .life-card, .city-panel, .inspector, .decision-card, .tab-guard, [role="dialog"]';

export class InputController {
  constructor(canvas, camera, handlers) {
    this.canvas = canvas;
    this.camera = camera;
    this.handlers = handlers; // { onTap, onBulldoze, onHover, canPaint, onPaintStart, onPaintMove, onPaintEnd }
    this.pointers = new Map();
    this.gesture = null;
    this.longTimer = 0;
    this.last = null; // last pointer position, for edge scrolling while painting
    this.mouse = null; // where the mouse is resting over the map, for the hover preview while the camera moves
    this.keysDown = new Set(); // camera keys being held
    this.keyVel = { x: 0, y: 0 }; // current keyboard glide, screen pixels per second
    this.wheelGesture = null; // { last, trackpad }: how the current scroll was classified

    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onUp(e, true));
    canvas.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.mouse = null;
      if (e.pointerType === 'mouse' && !this.gesture) this.handlers.onHover(null);
    });
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.keysDown.delete(e.code));
    // A key released while the window was in the background never sends keyup: let go of everything.
    window.addEventListener('blur', () => this.keysDown.clear());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.keysDown.clear();
    });
  }

  onKeyDown(e) {
    if (!PAN_KEYS[e.code]) return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return; // browser shortcuts, or a control that used the key
    if (typingTarget(e.target) || e.target?.closest?.(PANELS)) return;
    if (this.handlers.canKeyPan && !this.handlers.canKeyPan()) return;
    e.preventDefault();
    this.keysDown.add(e.code);
  }

  // Glide the camera while camera keys are held, easing in and out. Called once a frame.
  keyPan(dt) {
    let dx = 0;
    let dy = 0;
    for (const code of this.keysDown) {
      dx += PAN_KEYS[code][0];
      dy += PAN_KEYS[code][1];
    }
    const len = Math.hypot(dx, dy);
    if (len) {
      dx /= len;
      dy /= len;
    }
    const v = this.keyVel;
    const k = this.camera.smooth ? 1 - Math.exp(-dt * KEY_PAN_EASE) : 1;
    v.x += (dx * KEY_PAN_SPEED - v.x) * k;
    v.y += (dy * KEY_PAN_SPEED - v.y) * k;
    if (!len && Math.abs(v.x) < 1 && Math.abs(v.y) < 1) {
      v.x = 0;
      v.y = 0;
      return false;
    }
    this.camera.panBy(-v.x * dt, -v.y * dt);
    this.afterCameraMove();
    return true;
  }

  // The map moved under a still pointer: keep a stroke or the hover preview on the tile beneath it.
  afterCameraMove() {
    if (this.painting && this.last) this.handlers.onPaintMove(this.last.x, this.last.y);
    else if (this.mouse && !this.gesture) this.handlers.onHover(this.mouse.x, this.mouse.y);
  }

  get painting() {
    return this.gesture?.mode === 'paint';
  }

  local(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  onDown(e) {
    const p = this.local(e);
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety */
    }
    this.pointers.set(e.pointerId, { x: p.x, y: p.y });
    if (this.pointers.size === 1) {
      const panButton = e.pointerType === 'mouse' && e.button !== 0;
      this.gesture = {
        button: e.button,
        type: e.pointerType,
        startX: p.x,
        startY: p.y,
        moved: false,
        mode: null, // 'pan' or 'paint' once the pointer has moved
        wantsPaint: !panButton && this.handlers.canPaint(),
        pinched: false,
        longPressed: false,
        vx: 0,
        vy: 0,
        lastT: performance.now(),
      };
      if (e.pointerType !== 'mouse') {
        clearTimeout(this.longTimer);
        this.longTimer = setTimeout(() => {
          const g = this.gesture;
          if (g && !g.moved && !g.pinched && this.pointers.size === 1) {
            g.longPressed = true;
            navigator.vibrate?.(12);
            this.handlers.onBulldoze(g.startX, g.startY);
          }
        }, LONG_PRESS_MS);
      }
    } else if (this.pointers.size === 2 && this.gesture) {
      clearTimeout(this.longTimer);
      // A second finger turns any stroke in progress into a pan/pinch; the stroke is dropped.
      if (this.gesture.mode === 'paint') this.handlers.onPaintEnd(false);
      this.gesture.mode = 'pan';
      this.gesture.pinched = true;
      this.gesture.moved = true;
      this.pinch = this.pinchState();
    }
  }

  pinchState() {
    const [a, b] = [...this.pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  onMove(e) {
    const p = this.local(e);
    if (e.pointerType === 'mouse') this.mouse = p;
    const ptr = this.pointers.get(e.pointerId);
    if (!ptr) {
      if (e.pointerType === 'mouse') this.handlers.onHover(p.x, p.y);
      return;
    }
    const dx = p.x - ptr.x;
    const dy = p.y - ptr.y;
    ptr.x = p.x;
    ptr.y = p.y;
    this.last = p;
    const g = this.gesture;
    if (!g) return;

    if (this.pointers.size === 1 && !g.pinched) {
      const threshold = g.type === 'mouse' ? 5 : 10;
      if (!g.moved && Math.hypot(p.x - g.startX, p.y - g.startY) > threshold) {
        g.moved = true;
        clearTimeout(this.longTimer);
        if (!g.longPressed) {
          g.mode = g.wantsPaint ? 'paint' : 'pan';
          if (g.mode === 'paint') this.handlers.onPaintStart(g.startX, g.startY);
        }
      }
      if (g.mode === 'paint') {
        this.handlers.onPaintMove(p.x, p.y);
      } else if (g.mode === 'pan') {
        this.camera.panBy(dx, dy);
        const now = performance.now();
        const dtm = Math.max(1, now - g.lastT) / 1000;
        g.vx = g.vx * 0.6 + (dx / dtm) * 0.4;
        g.vy = g.vy * 0.6 + (dy / dtm) * 0.4;
        g.lastT = now;
      }
      if (e.pointerType === 'mouse' && g.mode !== 'paint') this.handlers.onHover(g.moved ? null : p.x, p.y);
    } else if (this.pointers.size === 2 && this.pinch) {
      const next = this.pinchState();
      this.camera.zoomAt(next.dist / this.pinch.dist, next.mx, next.my, true);
      this.camera.panBy(next.mx - this.pinch.mx, next.my - this.pinch.my);
      this.pinch = next;
    }
  }

  onUp(e, cancelled = false) {
    const g = this.gesture;
    const p = this.local(e);
    this.pointers.delete(e.pointerId);
    clearTimeout(this.longTimer);
    if (this.pointers.size === 1) {
      this.pinch = null; // lifting one finger of a pinch never counts as a tap
      return;
    }
    if (this.pointers.size > 0 || !g) return;
    this.gesture = null;
    this.last = null;
    if (g.mode === 'paint') {
      this.handlers.onPaintEnd(!cancelled);
      return;
    }
    if (cancelled) return;
    if (!g.moved && !g.longPressed && !g.pinched) {
      if (g.button === 2) this.handlers.onBulldoze(p.x, p.y);
      else if (g.button === 0) this.handlers.onTap(p.x, p.y);
    } else if (g.mode === 'pan' && !g.pinched && performance.now() - g.lastT < 80) {
      this.camera.fling(g.vx, g.vy);
    }
  }

  onWheel(e) {
    e.preventDefault();
    const p = this.local(e);
    // A trackpad pinch arrives as a wheel event with ctrlKey set, and always zooms.
    const mode = this.handlers.scrollMode?.() || 'auto';
    if (!e.ctrlKey && (mode === 'pan' || (mode === 'auto' && this.isTrackpadScroll(e)))) {
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.canvas.clientHeight : 1;
      this.camera.panBy(-e.deltaX * unit, -e.deltaY * unit);
      this.afterCameraMove();
      return;
    }
    const scale = e.deltaMode === 1 ? 0.05 : e.ctrlKey ? 0.01 : 0.0015;
    this.camera.zoomAt(Math.exp(-e.deltaY * scale), p.x, p.y);
  }

  // Browsers don't say whether a scroll came from a trackpad or a mouse wheel. Each scroll gesture
  // is judged by its first event and keeps that answer, so one gesture never switches between
  // panning and zooming. Anything unsure counts as a mouse wheel, which zooms as it always has.
  isTrackpadScroll(e) {
    const g = this.wheelGesture;
    if (g && e.timeStamp - g.last < WHEEL_GESTURE_GAP_MS) {
      g.last = e.timeStamp;
      return g.trackpad;
    }
    let trackpad;
    if (e.deltaMode !== 0) trackpad = false; // scrolling by lines or pages: a mouse wheel
    else if (e.deltaX !== 0) trackpad = true; // sideways scrolling: a trackpad
    else if (typeof e.wheelDeltaY === 'number' && e.wheelDeltaY !== 0) trackpad = e.wheelDeltaY === -3 * e.deltaY; // Chrome and Safari: trackpads report exactly this
    else trackpad = !Number.isInteger(e.deltaY) && Math.abs(e.deltaY) < 50; // fine-grained steps: a trackpad
    this.wheelGesture = { last: e.timeStamp, trackpad };
    return trackpad;
  }

  // While painting near a screen edge, slide the map so long strokes can continue.
  edgeScroll(dt) {
    if (!this.painting || !this.last) return false;
    const r = this.canvas.getBoundingClientRect();
    const m = 48;
    const speed = 420 * dt;
    let dx = 0;
    let dy = 0;
    if (this.last.x < m) dx = speed * (1 - this.last.x / m);
    else if (this.last.x > r.width - m) dx = -speed * (1 - (r.width - this.last.x) / m);
    if (this.last.y < m) dy = speed * (1 - this.last.y / m);
    else if (this.last.y > r.height - m) dy = -speed * (1 - (r.height - this.last.y) / m);
    if (!dx && !dy) return false;
    this.camera.panBy(dx, dy);
    this.handlers.onPaintMove(this.last.x, this.last.y);
    return true;
  }
}
