// Isometric projection shared by the renderer and input. Grid units in, world pixels out.

import { TILE_W, TILE_H } from './config.js';

export const HALF_W = TILE_W / 2;
export const HALF_H = TILE_H / 2;

// Height scale for whatever is being drawn right now (1 = full height). The renderer lowers it while a
// building pops up or stretches, so the building grows straight up from its footprint: its base never
// leaves the tile. Only ever changed around a single draw call, and always put back to 1.
export const ISO = { z: 1 };

export function gridToWorld(gx, gy, z = 0) {
  return { x: (gx - gy) * HALF_W, y: (gx + gy) * HALF_H - z * ISO.z };
}

export function worldToGrid(wx, wy) {
  const a = wx / HALF_W;
  const b = wy / HALF_H;
  return { gx: (b + a) / 2, gy: (b - a) / 2 };
}

// World-space bounds of a width×height board, with headroom for tall buildings and the base slab.
export function mapBounds(width, height) {
  return {
    left: gridToWorld(0, height).x,
    right: gridToWorld(width, 0).x,
    top: -70,
    bottom: gridToWorld(width, height).y + 22,
  };
}

// World-space bounds of a block of tiles, padded for building height.
export function tileRectBounds(x0, y0, x1, y1) {
  return {
    left: gridToWorld(x0, y1 + 1).x,
    right: gridToWorld(x1 + 1, y0).x,
    top: gridToWorld(x0, y0).y - 70,
    bottom: gridToWorld(x1 + 1, y1 + 1).y + 10,
  };
}
