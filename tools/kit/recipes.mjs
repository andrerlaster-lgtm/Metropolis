// Recipes for models built from the Kenney kits (assets/kenney/, CC0). Each piece is a kit model placed
// in kit units (one modular-building cell is 1 × 0.63 × 1, features on its +z face), turned `r`
// quarter turns about y (1: its +z face turns to +x) and stretched by `s`. The whole model is then
// scaled into game tiles. `remap` recolours baked palette colours (sRGB 0–255) toward the game's look.

const MB = 'modular-buildings';
const STOREY = 0.63;

// The military command post: a two-storey stone headquarters, three bays wide and two deep, with a
// balcony over the door, round-topped upper windows and a slate roof with a gabled bay. The game adds
// the plinth, steps, chimney, flag and sandbags around it (view3d/battle3d.js). Built to sit on its 2×2-tile footprint (about 1.75 × 1.2 tiles, 1.1 tiles tall).
export const hq = {
  scale: 0.58,
  pieces: [
    // Ground floor: windows either side of the door; plain windows at the back.
    { kit: MB, name: 'building-window-sill', at: [-1, 0, 0.5] },
    { kit: MB, name: 'building-door-window', at: [0, 0, 0.5] },
    { kit: MB, name: 'building-window-sill', at: [1, 0, 0.5] },
    ...[-1, 0, 1].map((x) => ({ kit: MB, name: 'building-windows', at: [x, 0, -0.5], r: 2 })),
    // Upper floor: round-topped windows, a balcony over the door.
    { kit: MB, name: 'building-windows-round', at: [-1, STOREY, 0.5] },
    { kit: MB, name: 'building-window-balcony', at: [0, STOREY, 0.5] },
    { kit: MB, name: 'building-windows-round', at: [1, STOREY, 0.5] },
    ...[-1, 0, 1].map((x) => ({ kit: MB, name: 'building-windows', at: [x, STOREY, -0.5], r: 2 })),
    // Roof: one long slate gable, its ridge running the length of the building, over a gabled bay
    // above the balcony.
    ...[-1, 0, 1].map((x) => ({ kit: MB, name: 'roof-gable', at: [x, STOREY * 2, 0], r: 1, s: [2, 1, 1] })),
    { kit: MB, name: 'roof-gable', at: [0, STOREY * 2, 0.62], s: [0.9, 1.1, 0.8] },
  ],
  remap([r, g, b]) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    // Dark greys (the roof) become slate blue; the light sandstone walls stay, a touch cooler.
    if (max < 90 && max - min < 18) {
      const k = (r + g + b) / 3 / 60;
      return [86 * k + 10, 99 * k + 10, 126 * k + 12];
    }
    return [r, g, b];
  },
};
