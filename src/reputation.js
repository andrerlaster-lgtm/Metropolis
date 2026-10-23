// Town reputation: how well the town is thought of, from 0 to 1. It builds slowly from how green and
// well kept the town is (trees and parks near homes, few damaged or ruined buildings, schools and clinics
// that cover the homes), so planting trees helps and clearing them hurts, but it takes days to move.
//
// A good name draws newcomers: it nudges how appealing homes are (Town reputation in the inspector) and
// how fast a town that grows by itself grows. Saved in city.systems.reputation = { value, title }.
// The score parts and the reasons are derived (city.derived.reputation) and never saved.

import { STRUCTURES, REPUTATION } from './config.js';
import { addChronicle } from './chronicle.js';
import { clamp } from './utils.js';

// Lowest value for each title. A title only changes once the value is 0.02 past its edge.
export const TITLES = [
  { min: 0, label: 'Run-down', up: '', down: 'The town has a run-down name now.' },
  { min: 0.25, label: 'Plain', up: 'Visitors call the town plain, but fair.', down: 'People say the town has lost its charm.' },
  { min: 0.45, label: 'Pleasant', up: 'The town is thought of as a pleasant place to live.', down: 'The town is only thought pleasant now.' },
  { min: 0.65, label: 'Lovely', up: 'Word has spread that the town is lovely.', down: 'The town is not quite as lovely as it was.' },
  { min: 0.85, label: 'Beloved', up: 'The town is beloved far and wide.', down: '' },
];
const HYSTERESIS = 0.02;

export const titleIndex = (value, from = 0) => {
  let i = from;
  while (i < TITLES.length - 1 && value >= TITLES[i + 1].min + HYSTERESIS) i++;
  while (i > 0 && value < TITLES[i].min - HYSTERESIS) i--;
  return i;
};

// Score the town now. `unlocked(tool)` says whether a service can be built yet, so a young town isn't
// marked down for a clinic it can't build. Returns null with no residents (nothing to judge yet).
export function assessReputation(city, unlocked = () => true) {
  const lived = city.homes().filter((h) => h.structure.residents > 0);
  if (!lived.length) return null;

  // Green: how much park and tree there is around the homes people live in.
  let green = 0;
  for (const h of lived) green += clamp((h.factors?.greenery || 0) / 0.22, 0, 1);
  green /= lived.length;

  // Well kept: damaged or ruined buildings and washed-out roads count against the town.
  let buildings = 0;
  let neglected = 0;
  for (const t of city.tiles) {
    const s = t.structure;
    if (!s) continue;
    if (s.broken) neglected++;
    if (s.type === 'road' || s.type === 'tree') continue;
    if (s.type === 'rubble' || (!STRUCTURES[s.type].walkable && (s.damage || 0) >= 0.34)) neglected++;
    if (!STRUCTURES[s.type].walkable && s.type !== 'rubble') buildings++;
  }
  const care = clamp(1 - (5 * neglected) / Math.max(buildings, 10), 0, 1);

  // Looked after: schools and clinics (at their current quality) reach the homes.
  const kinds = [];
  if (unlocked('school')) kinds.push('school');
  if (unlocked('clinic')) kinds.push('health');
  let services = null;
  if (kinds.length) {
    services = 0;
    for (const h of lived) for (const k of kinds) services += clamp((h.coverage?.[k] || 0) / 0.5, 0, 1) / kinds.length;
    services /= lived.length;
  }

  const w = REPUTATION.weights;
  const parts = { green, care, services };
  let sum = w.green + w.care;
  let target = w.green * green + w.care * care;
  if (services != null) {
    sum += w.services;
    target += w.services * services;
  }
  return { target: target / sum, parts, neglected };
}

export class Reputation {
  constructor(city, { unlocked } = {}) {
    this.city = city;
    this.unlocked = unlocked;
  }

  get state() {
    return (this.city.systems.reputation ||= { value: null, title: 0 });
  }

  // `days`: in-game days since the last call. Moves toward the town's current score by at most
  // REPUTATION.perDay a day. A town with no reputation yet (new, or saved before this existed) starts at its
  // score, quietly.
  update(days = 0) {
    const city = this.city;
    const st = this.state;
    const a = assessReputation(city, this.unlocked);
    if (a) {
      if (st.value == null) {
        st.value = a.target;
        st.title = titleIndex(st.value);
      } else {
        const step = REPUTATION.perDay * days;
        st.value = clamp(st.value + clamp(a.target - st.value, -step, step), 0, 1);
        const was = st.title;
        st.title = titleIndex(st.value, was);
        if (st.title !== was) {
          const text = st.title > was ? TITLES[st.title].up : TITLES[was].down;
          if (text) addChronicle(city, text, null, 'note');
        }
      }
    }
    const value = st.value ?? 0.5;
    city.derived.reputation = { value, title: TITLES[st.title || 0], target: a?.target ?? value, parts: a?.parts || null, neglected: a?.neglected || 0 };
  }
}
