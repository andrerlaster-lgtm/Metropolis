// Recipes for models built from the Kenney kits (assets/kenney/, CC0). Each piece is a kit model placed
// in kit units (one modular-building cell is 1 × 0.63 × 1, features on its +z face), turned `r`
// quarter turns about y (1: its +z face turns to +x) and stretched by `s`. The whole model is then
// scaled into game tiles. `remap` recolours baked palette colours (sRGB 0–255) toward the game's look.

const MB = 'modular-buildings';
const TD = 'tower-defense';
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

// The Tower Defense Kit's toy palette (lavender, orange, purple) recoloured as military kit:
// lavender greys → olive drab, orange and red → dark olive housing, light blues → gunmetal, dark → black.
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function military([r, g, b], { stone = false } = {}) {
  const lum = (r + g + b) / 3;
  const shade = (base, ref) => hex(base).map((c) => Math.min(255, (c * lum) / ref));
  if (r > 180 && g < 150) return stone ? shade('#8c7458', 170) : shade('#5f6b3e', 160); // orange, red
  if (b > r + 25 && r > 140 && g > 140) return stone ? shade('#a39e94', 200) : shade('#7d8a4f', 190); // lavender light
  if (b > r + 25 && r > 100) return stone ? shade('#8a857c', 160) : shade('#66713f', 150); // lavender mid
  if (b > r + 25) return shade('#4f5a34', 110); // purple, dark lavender
  if (g > r + 20) return shade('#3d4146', 180); // light blue, teal: gunmetal
  if (lum < 100) return shade('#2a2c2e', 90); // near black: barrels
  return shade('#55585c', 130);
}

// Machine-gun nest, in two parts so the gun can turn: a round concrete emplacement (the game rings it
// with sandbags) and the gun on its mount, made from the kit's turret, its barrels facing +z.
export const mgBase = {
  scale: 0.76,
  pieces: [{ kit: TD, name: 'tower-round-base', remap: (c) => military(c, { stone: true }) }],
};

export const mgGun = {
  scale: 0.85,
  keepOrigin: true,
  ao: { reach: 0.08, strength: 0.5 },
  pieces: [{ kit: TD, name: 'weapon-turret', at: [0, -0.24, -0.02], remap: (c) => military(c) }],
};
