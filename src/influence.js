// Reach: what a building does to the homes around it, and how far. Used to preview a building's
// reach before you place it, to show where it's still needed, and to show an existing building's
// reach when you inspect it. The numbers follow the rules that really apply them: coverage.js for
// schools, clinics, play and fire cover, and desirability.js for parks and trees and factory smoke.

import { STRUCTURES } from './config.js';

const SERVICE_LABEL = { school: 'Schools', health: 'Clinics', fun: 'Play & fun', fire: 'Fire cover' };
const NEED = 0.15; // a home with less coverage than this counts as missing it

const isHome = (t) => !!t?.structure && STRUCTURES[t.structure.type]?.capacity > 0;

// The kinds of effect a building type has: [{ id, label, radius, good, reach(dx, dy) → 0..1, needs(tile) }].
export function influenceOf(type, city) {
  const def = STRUCTURES[type];
  if (!def) return [];
  const out = [];
  if (def.service) {
    const extra = (city?.derived?.notableEffects?.radius?.[def.service] || 0) + (city?.derived?.skills?.radius?.[def.service] || 0);
    const r = def.radius + extra;
    out.push({
      id: def.service,
      label: SERVICE_LABEL[def.service] || def.service,
      radius: r,
      good: true,
      // As in coverage.js: full strength at the door, fading towards the edge.
      reach: (dx, dy) => {
        const d = Math.hypot(dx, dy);
        return d > r ? 0 : 1 - (d / (r + 1)) ** 2;
      },
      needs: (t) => (t.coverage?.[def.service] || 0) < NEED,
    });
  }
  if (def.greenery > 0) {
    out.push({
      id: 'greenery',
      label: 'Parks & trees',
      radius: 3,
      good: true,
      // As in desirability.js: up to 3 tiles, fading with distance.
      reach: (dx, dy) => {
        const d = Math.hypot(dx, dy);
        return (dx || dy) && d <= 3.5 ? 1 - d / 4.5 : 0;
      },
      needs: (t) => (t.factors?.greenery || 0) < 0.05,
    });
  }
  if (def.pollution) {
    out.push({
      id: 'pollution',
      label: 'Factory smoke',
      radius: 4,
      good: false,
      // As in desirability.js: within 4 tiles each way, fading over about five.
      reach: (dx, dy) => (Math.abs(dx) <= 4 && Math.abs(dy) <= 4 ? Math.max(0, 1 - Math.hypot(dx, dy) / 5.5) : 0),
      needs: () => false,
    });
  }
  return out;
}

// Every tile one effect reaches from (x, y), with its strength.
export function reachTiles(city, x, y, effect) {
  const r = Math.ceil(effect.radius + 0.5);
  const tiles = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const s = effect.reach(dx, dy);
      if (s <= 0) continue;
      const t = city.getTile(x + dx, y + dy);
      if (t) tiles.push({ x: t.x, y: t.y, s });
    }
  }
  return tiles;
}

// What putting `type` at (x, y) would reach: per effect, its tiles, how many homes are inside, and
// how many of those are missing what it gives (or, for smoke, how many it would bother).
export function reachOf(city, x, y, type) {
  return influenceOf(type, city).map((e) => {
    const tiles = reachTiles(city, x, y, e);
    let homes = 0;
    let needing = 0;
    for (const c of tiles) {
      const t = city.getTile(c.x, c.y);
      if (!isHome(t)) continue;
      homes++;
      if (e.needs(t)) needing++;
    }
    return { id: e.id, label: e.label, radius: e.radius, good: e.good, tiles, homes, needing };
  });
}

// One line for the preview: "Schools · reaches 7 tiles · 12 homes, 5 without it yet".
export function reachText(effects) {
  return effects
    .map((e) => {
      const homes = `${e.homes} home${e.homes === 1 ? '' : 's'}`;
      if (!e.good) return `${e.label} · ${e.radius} tiles · bothers ${homes}`;
      return `${e.label} · ${e.radius} tiles · ${homes}${e.needing ? `, ${e.needing} need${e.needing === 1 ? 's' : ''} it` : ''}`;
    })
    .join('   ');
}

// Homes that are missing what a building type gives: where it would help most.
export function homesNeeding(city, type) {
  const effects = influenceOf(type, city).filter((e) => e.good);
  if (!effects.length) return [];
  return city.homes().filter((t) => t.structure.residents > 0 && effects.some((e) => e.needs(t))).map((t) => ({ x: t.x, y: t.y }));
}
