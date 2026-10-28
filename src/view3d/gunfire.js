// Where a defence's gun is, and what its firing looks like in the 3D battle view: the muzzle flash, the
// kick of the gun, and the tracer. Pure maths (no Three.js), so it is tested in Node. The battle itself
// (battle.js) records for each armed defence `aim` (the way it faces, in the map's own angle: 0 is
// east, π/2 is south), `fired` (when it last fired) and an `addFx` shot effect for every shot.

export const FLASH_SECS = { mg: 0.1, default: 0.08 }; // how long a shot's flash stays up
export const RECOIL_SECS = 0.12;
export const MUZZLE_REACH = { mg: 0.25, mortar: 0.4, hq: 0.6, default: 0.45 }; // from the middle of the tile
export const GUN_Y = { mg: 0.39, mortar: 0.4, hq: 0.5, default: 0.32 }; // height of the barrel
export const FLASH_SCALE = { mg: 1.9, mortar: 2.2, hq: 1.3, default: 1.5 };
const TARGET_Y = 0.25; // chest height of whoever is being shot at

const pick = (table, type) => table[type] ?? table.default;

// The tip of the barrel, or null when the gun hasn't been aimed.
export function muzzleOf(st) {
  if (!st || !Number.isFinite(st.aim)) return null;
  const r = pick(MUZZLE_REACH, st.type);
  return { x: st.x + st.w / 2 + Math.cos(st.aim) * r, y: pick(GUN_Y, st.type), z: st.y + st.h / 2 + Math.sin(st.aim) * r };
}

// A muzzle flash while a shot is fresh: { x, y, z, scale }, or null.
export function flashOf(st, t) {
  if (!st || !(st.hp > 0) || !Number.isFinite(st.fired)) return null;
  const age = t - st.fired;
  if (age < 0 || age >= pick(FLASH_SECS, st.type)) return null;
  const p = muzzleOf(st);
  return p && { ...p, scale: pick(FLASH_SCALE, st.type) };
}

// How far the gun has been kicked back: 1 at the shot, 0 a moment later.
export function recoilOf(st, t) {
  if (!st || !Number.isFinite(st.fired)) return 0;
  const k = 1 - (t - st.fired) / RECOIL_SECS;
  return k <= 0 ? 0 : Math.min(1, k);
}

// A defence's shot effect (battle.js addFx { kind: 'shot', struct, x, y, x2, y2 }) as a line in the 3D
// view: from the muzzle, not the middle of the tile, to where the shot ended up.
export function tracerOf(fx, structs = []) {
  const st = structs.find((s) => s.id === fx.struct);
  const type = st?.type;
  const dx = fx.x2 - fx.x;
  const dz = fx.y2 - fx.y;
  const len = Math.hypot(dx, dz) || 1;
  const r = Math.min(pick(MUZZLE_REACH, type), len * 0.5);
  return { x0: fx.x + (dx / len) * r, y0: pick(GUN_Y, type), z0: fx.y + (dz / len) * r, x1: fx.x2, y1: TARGET_Y, z1: fx.y2 };
}
