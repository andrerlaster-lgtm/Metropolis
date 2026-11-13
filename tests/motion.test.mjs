// Motion polish: the camera keeps the spot under the pointer fixed while a zoom eases and settles
// exactly on its target; cars round a corner without a sideways hop; and heights drawn through the
// isometric projection can be scaled (how a building pops up from its footprint) without moving
// anything on the ground.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from '../src/camera.js';
import { AgentSystem } from '../src/agents.js';
import { gridToWorld, ISO } from '../src/iso.js';

const camera = () => {
  const c = new Camera();
  c.setViewport(1000, 700);
  c.setBounds({ left: -2000, right: 2000, top: -200, bottom: 2200 });
  c.x = c.tx = 100;
  c.y = c.ty = 900;
  return c;
};

test('zooming keeps the spot under the pointer where it is, frame by frame', () => {
  const c = camera();
  const sx = 720;
  const sy = 210;
  const under = c.screenToWorld(sx, sy);
  c.zoomAt(2.2, sx, sy);
  c.zoomAt(1.3, sx, sy); // a second notch of the wheel while the first is still easing
  let frames = 0;
  while (c.zoom !== c.tzoom && frames++ < 600) {
    c.update(1 / 60);
    const now = c.screenToWorld(sx, sy);
    assert.ok(Math.abs(now.x - under.x) < 0.01 && Math.abs(now.y - under.y) < 0.01, `frame ${frames}: drifted to ${now.x},${now.y}`);
  }
  assert.ok(frames < 600, 'the zoom finishes');
  c.update(1 / 60);
  assert.equal(c.x, c.tx);
  assert.equal(c.y, c.ty);
  assert.ok(Math.abs(c.zoom - 2.2 * 1.3) < 1e-9);
});

test('a pan eases to its target and comes to rest exactly on it', () => {
  const c = camera();
  c.fling(900, -400);
  assert.notEqual(c.x, c.tx);
  let last = Infinity;
  for (let i = 0; i < 400 && (c.x !== c.tx || c.y !== c.ty); i++) {
    c.update(1 / 60);
    const left = Math.hypot(c.tx - c.x, c.ty - c.y);
    assert.ok(left <= last, 'it only ever gets closer: no overshoot, no jitter');
    last = left;
  }
  assert.equal(c.x, c.tx);
  assert.equal(c.y, c.ty);
});

test('dragging after a zoom takes over at once', () => {
  const c = camera();
  c.zoomAt(2, 500, 350);
  c.update(1 / 60);
  const before = c.x;
  c.panBy(40, 0);
  assert.equal(c.anchor, null);
  assert.ok(Math.abs(c.x - (before - 40 / c.zoom)) < 1e-9, 'the view moves with the drag');
});

test('a car rounds a corner without hopping sideways', () => {
  const pose = (c) => AgentSystem.prototype.carPose.call(null, c);
  // Driving east along y = 5, then turning south at (6, 5).
  const before = pose({ px: 4, py: 5, x: 5, y: 5, nx: 6, ny: 5, t: 0.999 });
  const after = pose({ px: 5, py: 5, x: 6, y: 5, nx: 6, ny: 6, t: 0.001 });
  assert.ok(Math.hypot(after.gx - before.gx, after.gy - before.gy) < 0.01, 'no jump as it enters the turn');
  let prev = after;
  for (let t = 0.01; t <= 1; t += 0.01) {
    const p = pose({ px: 5, py: 5, x: 6, y: 5, nx: 6, ny: 6, t });
    assert.ok(Math.hypot(p.gx - prev.gx, p.gy - prev.gy) < 0.03, `smooth at t=${t.toFixed(2)}`);
    prev = p;
  }
  // Out of the turn it is back in the right-hand lane of the new street, facing along it.
  const out = pose({ px: 5, py: 5, x: 6, y: 5, nx: 6, ny: 6, t: 0.9 });
  assert.ok(Math.abs(out.gx - (6.5 - 0.16)) < 1e-9);
  assert.deepEqual([out.dx, out.dy], [0, 1]);
  // On a straight street nothing changes.
  const straight = pose({ px: 4, py: 5, x: 5, y: 5, nx: 6, ny: 5, t: 0.25 });
  assert.deepEqual([straight.gx, straight.gy, straight.dx, straight.dy], [5.75, 5.66, 1, 0]);
});

test('scaling heights never moves the ground: a building grows straight up from its footprint', () => {
  const ground = gridToWorld(3.2, 7.8);
  const roof = gridToWorld(3.2, 7.8, 20);
  try {
    ISO.z = 0.4;
    assert.deepEqual(gridToWorld(3.2, 7.8), ground, 'the footprint is where it was');
    assert.ok(Math.abs(gridToWorld(3.2, 7.8, 20).y - (ground.y - 8)) < 1e-9, 'the roof is at 40% height');
  } finally {
    ISO.z = 1;
  }
  assert.deepEqual(gridToWorld(3.2, 7.8, 20), roof);
});
