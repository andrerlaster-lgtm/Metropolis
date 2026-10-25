// Legacy: what a family line remembers across generations. Life Story characters come and go (a new
// one each generation), but the family's memory stays with the town: the events it has lived
// through and when, consequences still waiting to come back, heirlooms handed down, and a few named
// memories (a rival family, a promise). Events use it to avoid repeating themselves and to return
// years, or generations, later.
//
// Saved in city.systems.legacy = { v, seen, recent, pending, memory, heirlooms }:
//   seen     { eventId: year }               the last year each event happened in this family
//   recent   [{ id, cat, year }]             the last few events, for variety
//   pending  [{ id, at, data, origin, family }] events due to come back (origin = who set them)
//   memory   { key: value }                  named things the family remembers
//   heirlooms [{ name, from, year }]
// Pure rules, no screen.

import { yearOf } from './eras.js';

export const LEGACY_VERSION = 1;
const RECENT_KEEP = 12;
const OVERDUE_YEARS = 25; // a consequence that can't happen for this long is forgotten

export class Legacy {
  constructor(city) {
    this.city = city;
  }

  get state() {
    const s = this.city.systems;
    if (!s.legacy || typeof s.legacy !== 'object') s.legacy = { v: LEGACY_VERSION, seen: {}, recent: [], pending: [], memory: {}, heirlooms: [] };
    const st = s.legacy;
    for (const [k, v] of [['seen', {}], ['recent', []], ['pending', []], ['memory', {}], ['heirlooms', []]]) if (!st[k] || typeof st[k] !== 'object') st[k] = v;
    return st;
  }

  year() {
    return yearOf(this.city);
  }

  remember(key, value = true) {
    this.state.memory[key] = value;
  }

  recall(key) {
    return this.state.memory[key];
  }

  forget(key) {
    delete this.state.memory[key];
  }

  addHeirloom(name, from) {
    this.state.heirlooms.push({ name, from, year: this.year() });
  }

  removeHeirloom(name) {
    const st = this.state;
    st.heirlooms = st.heirlooms.filter((h) => h.name !== name);
  }

  // An event that will come back: `years` is [min, max] from now. `origin` is who set it in motion,
  // and `family` the surname it belongs to, so a new, unrelated family never inherits it.
  schedule(id, years, { data = null, origin = null, family = null, rng = Math.random } = {}) {
    const [a, b] = Array.isArray(years) ? years : [years, years];
    const at = this.year() + a + Math.floor(rng() * (b - a + 1));
    this.state.pending.push({ id, at, data, origin, family });
    return at;
  }

  // Consequences that are due now for this family, oldest first. Long-overdue ones are dropped.
  due(family) {
    const st = this.state;
    const y = this.year();
    st.pending = st.pending.filter((p) => y - p.at <= OVERDUE_YEARS);
    return st.pending.filter((p) => p.at <= y && (!p.family || !family || p.family === family)).sort((a, b) => a.at - b.at);
  }

  take(entry) {
    const st = this.state;
    st.pending = st.pending.filter((p) => p !== entry);
  }

  // Remember that an event happened, for variety and for once-per-family events.
  note(ev) {
    const st = this.state;
    const y = this.year();
    st.seen[ev.id] = y;
    st.recent.unshift({ id: ev.id, cat: ev.category || null, year: y });
    if (st.recent.length > RECENT_KEEP) st.recent.length = RECENT_KEEP;
  }

  // How likely an event is, given what the family has lived through lately: an event seen recently
  // is rare, and a kind of event seen several times lately gives way to other kinds.
  weightFor(ev) {
    const st = this.state;
    let w = 1;
    const i = st.recent.findIndex((r) => r.id === ev.id);
    if (i >= 0) w *= i < 3 ? 0.02 : 0.1 + 0.05 * (i - 3); // just happened: very unlikely; then slowly back
    if (ev.category) {
      const same = st.recent.slice(0, 6).filter((r) => r.cat === ev.category).length;
      w /= 1 + 0.6 * same;
    }
    return w;
  }
}

// How the person who set a consequence in motion is related to the person living it now.
export function originWords(origin, char) {
  if (!origin) return 'someone in the family';
  const first = origin.name.split(' ')[0];
  if (origin.name === `${char.first} ${char.last}` && (origin.gen || 1) === (char.generation || 1)) return 'you';
  const diff = (char.generation || 1) - (origin.gen || 1);
  if (diff === 1) return `your parent ${first}`;
  if (diff === 2) return `your grandparent ${first}`;
  if (diff > 2) return `your ancestor ${origin.name}`;
  return origin.name;
}
