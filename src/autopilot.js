// Auto mode for your two people. Each can be left to pick their own actions with a focus you set:
// your main person (the child) picks their Life Story activities through the year, and the mayor
// picks the day's duties. Off by default; you can still act by hand while it's on.
//
// Saved in city.systems.autopilot = { v, kid: { on, focus }, mayor: { on, focus } }. Pure rules,
// no screen: the Life panel and the Town hall show the switches.

import { energyFor } from './lifeActivities.js';

export const AUTOPILOT_VERSION = 1;

// What the child aims for. Weights per stat; `money` is per dollar, `social` per friendship made.
export const KID_FOCUS = [
  { id: 'balanced', label: 'Balanced', hint: 'Works on whatever is lowest' },
  { id: 'leader', label: 'Future leader', hint: 'Smarts, health, charm and friends: what makes a good mayor', weights: { smarts: 1, health: 0.7, happiness: 0.6, looks: 0.5, social: 0.8 } },
  { id: 'smarts', label: 'Smarts', hint: 'Study first', weights: { smarts: 1, happiness: 0.1 } },
  { id: 'health', label: 'Health', hint: 'Exercise and check-ups', weights: { health: 1, happiness: 0.1 } },
  { id: 'happiness', label: 'Happiness', hint: 'Fun, friends and rest', weights: { happiness: 1, social: 0.4 } },
  { id: 'money', label: 'Money', hint: 'Side jobs and overtime', weights: { money: 0.01, happiness: 0.05 } },
];

// What the mayor does first; later duties fill the rest of the day.
export const MAYOR_FOCUS = [
  { id: 'balanced', label: 'Balanced', hint: 'A bit of everything, in turn' },
  { id: 'money', label: 'Money', hint: 'Fundraisers, grants and trade first', tag: 'money' },
  { id: 'happiness', label: 'Happiness', hint: 'Speeches and festivals first', tag: 'happiness' },
  { id: 'growth', label: 'Growth', hint: 'Ribbons, trees and scholars first', tag: 'growth' },
  { id: 'military', label: 'Military', hint: 'The base first', tag: 'military' },
  { id: 'diplomacy', label: 'Diplomacy', hint: 'Neighbours first', tag: 'diplomacy' },
];

// What the child does when a life event asks a question while auto mode is on.
export const EVENT_POLICIES = [
  { id: 'ask', label: 'Ask me', hint: 'Life events wait for you' },
  { id: 'safe', label: 'Play it safe', hint: 'Avoid the worst that could happen' },
  { id: 'bold', label: 'Be bold', hint: 'Go for the best that could happen' },
  { id: 'focus', label: 'Follow the focus', hint: 'What helps the focus most on average' },
];

// Roughly what each activity gives (the real outcome is rolled when it's done). Activities that
// open an event card (job hunting, buying a home) are left to you.
export const ACTIVITY_GAINS = {
  study: { smarts: 4 },
  exercise: { health: 5, happiness: 2 },
  doctor: { health: 6 },
  rest: { happiness: 5 },
  makeover: { looks: 4, happiness: 2 },
  family: { happiness: 3, social: 0.5 },
  sibling: { happiness: 3, social: 0.5 },
  friend: { happiness: 4, social: 1 },
  meet: { happiness: 3, social: 1 },
  date: { happiness: 4, social: 0.5 },
  kids: { happiness: 5 },
  playground: { happiness: 5, health: 2 },
  park: { happiness: 5, health: 2 },
  shopping: { happiness: 4, looks: 2 },
  volunteer: { happiness: 5, smarts: 1, social: 0.5 },
  babysit: { money: 150 },
  overtime: { money: 400, happiness: -1, health: -3 },
  network: { happiness: 3, smarts: 1 },
  swim: { health: 6, happiness: 2 },
  yoga: { health: 4, happiness: 4 },
  library_visit: { smarts: 4, happiness: 2 },
  museum_trip: { smarts: 5, happiness: 3 },
  journal: { happiness: 4, smarts: 2 },
  cook: { health: 3, happiness: 5 },
  dinner_out: { happiness: 5, social: 1 },
  cinema_night: { happiness: 5, social: 0.5 },
  dinner_party: { happiness: 6, social: 1 },
  mentor: { smarts: 4, happiness: 3, social: 0.5 },
  street_bbq: { happiness: 5, social: 0.8 },
  fountain_wish: { happiness: 5 },
  garden_plot: { health: 4, happiness: 3 },
  market_stroll: { happiness: 5, health: 1 },
  match_day: { happiness: 6, social: 0.5 },
  picnic: { happiness: 6, health: 1, social: 0.5 },
  bike_ride: { health: 5, happiness: 3 },
  festival: { happiness: 7, social: 0.5 },
  paint: { happiness: 5, smarts: 1 },
  instrument: { smarts: 3, happiness: 3 },
  write_story: { smarts: 3, happiness: 4 },
  craft: { smarts: 3, happiness: 4, looks: 1 },
  photo_walk: { happiness: 5, smarts: 1 },
  choir: { happiness: 6, social: 0.5 },
  side_hustle: { money: 300, health: -1 },
  savings: { money: 150, smarts: 1 },
  hospital_volunteer: { happiness: 5, smarts: 2, social: 0.5 },
  diy: { happiness: 5, looks: 1 },
  read_kinder: { happiness: 6, smarts: 1 },
};
const STATS = ['happiness', 'health', 'smarts', 'looks'];

// How much an activity is worth to the child with this focus. Gains shrink near the top of a stat
// and when done again the same year, as they really do.
export function scoreActivity(offer, focusId, c) {
  const gains = ACTIVITY_GAINS[offer.id];
  if (!gains) return -Infinity;
  const f = KID_FOCUS.find((x) => x.id === focusId) || KID_FOCUS[0];
  const weights = f.weights || Object.fromEntries(STATS.map((k) => [k, (100 - (c.stats?.[k] ?? 50)) / 100]).concat([['social', 0.2]]));
  const repeats = c.yearActs?.[offer.id] || 0;
  let score = 0;
  for (const [k, v] of Object.entries(gains)) {
    const w = weights[k] || 0;
    const room = STATS.includes(k) && v > 0 ? Math.max(0, 1 - (c.stats?.[k] ?? 50) / 110) : 1;
    score += w * v * room;
  }
  score -= (offer.cost || 0) * 0.002;
  return score / (1 + repeats);
}

export class Autopilot {
  // deps: { life: () → LifeSystem, mayor: () → Mayor }
  constructor(city, deps = {}) {
    this.city = city;
    this.d = deps;
  }

  get state() {
    const s = this.city.systems;
    if (!s.autopilot || typeof s.autopilot !== 'object') s.autopilot = { v: AUTOPILOT_VERSION, kid: { on: false, focus: 'leader' }, mayor: { on: false, focus: 'balanced' } };
    const st = s.autopilot;
    for (const [who, list] of [['kid', KID_FOCUS], ['mayor', MAYOR_FOCUS]]) {
      if (!st[who]) st[who] = { on: false, focus: list[0].id };
      if (!list.some((f) => f.id === st[who].focus)) st[who].focus = list[0].id;
    }
    if (!EVENT_POLICIES.some((p) => p.id === st.kid.events)) st.kid.events = 'ask'; // older saves: events wait for you
    return st;
  }

  set(who, patch) {
    const st = this.state[who];
    if (!st) return;
    if (patch.on != null) st.on = !!patch.on;
    if (patch.focus) st.focus = patch.focus;
    if (patch.events) st.events = patch.events;
    this.state; // re-checks the focus
  }

  // The activity the child would pick now, or null.
  pickActivity() {
    const life = this.d.life?.();
    const c = life?.char;
    if (!c) return null;
    const money = c.money || 0;
    const offers = life.activities().filter((a) => !a.blocked && ACTIVITY_GAINS[a.id] && (a.cost || 0) <= money * 0.3);
    let best = null;
    let bestScore = 0;
    for (const a of offers) {
      const sc = scoreActivity(a, this.state.kid.focus, c);
      if (sc > bestScore) {
        best = a;
        bestScore = sc;
      }
    }
    return best;
  }

  // How the child values stats when answering events: the focus's weights (Balanced: the lowest stats).
  eventWeights() {
    const c = this.d.life?.()?.char;
    const f = KID_FOCUS.find((x) => x.id === this.state.kid.focus) || KID_FOCUS[0];
    if (f.weights) return { happiness: 0.2, health: 0.2, smarts: 0.2, looks: 0.1, ...f.weights };
    return Object.fromEntries(STATS.map((k) => [k, (100 - (c?.stats?.[k] ?? 50)) / 100]));
  }

  // The duty the mayor would pick now, or null.
  pickDuty() {
    const m = this.d.mayor?.();
    if (!m) return null;
    const f = MAYOR_FOCUS.find((x) => x.id === this.state.mayor.focus) || MAYOR_FOCUS[0];
    // What can be done now: the everyday duties and today's opportunities. The focus's own come first
    // (the everyday ones before the opportunities); Balanced takes them in turn, a different start each day.
    let list = m.offered().filter((d) => !m.dutyError(d.id));
    if (!list.length) return null;
    if (f.tag) {
      const mine = list.filter((d) => d.tags.includes(f.tag));
      list = mine.concat(list.filter((d) => !mine.includes(d)));
      return list[0].id;
    }
    const k = Math.floor(this.city.day) % list.length;
    return list[(k + (m.actionsPerDay() - m.state.actions)) % list.length].id;
  }

  // Call a few times a second. Actions are spread out: the mayor's through the day, the child's
  // through the year. Returns what was done, for messages: [{ who, text }].
  update() {
    const st = this.state;
    const done = [];
    const m = this.d.mayor?.();
    if (st.mayor.on && m) {
      m.update();
      const per = m.actionsPerDay(); // 3, or 4 with a Town council (skills.js)
      const used = per - m.state.actions;
      if (used < per && this.city.clock >= (used + 1) / (per + 1)) {
        const id = this.pickDuty();
        if (id) {
          const r = m.perform(id);
          if (r.text) done.push({ who: 'mayor', duty: id, text: r.text });
        }
      }
    }
    const life = this.d.life?.();
    const c = life?.char;
    // A life event waiting: answered by the chosen policy, unless it's left to you.
    if (st.kid.on && c?.alive && c.pending && st.kid.events !== 'ask') {
      const id = c.pending.id;
      const i = life.autoChoice(st.kid.events, this.eventWeights());
      if (i != null) {
        const r = life.choose(i);
        if (r?.text) done.push({ who: 'kid', event: id, text: r.text });
      }
    }
    if (st.kid.on && c?.alive && !c.pending) {
      const total = energyFor(c.age);
      const left = Math.max(0, c.energy ?? total);
      const used = total - left;
      if (left > 0 && c.yearProgress >= (used + 1) / (total + 1)) {
        const a = this.pickActivity();
        if (a) {
          const r = life.doActivity(a.id);
          if (r?.text) done.push({ who: 'kid', activity: a.id, text: r.text });
        }
      }
    }
    return done;
  }
}
