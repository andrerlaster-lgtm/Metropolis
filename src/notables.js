// Notable people: like great people in Civilization, a famous resident is born in (or moves to) the
// town when its buildings have earned enough "inspiration" of one kind. Schools inspire scientists,
// clinics doctors, businesses merchants, factories engineers, parks and cafés artists, sports fields
// athletes, and a growing population town planners. Each notable gives the whole town a bonus.
//
// Saved in city.systems.notables = { points: { type: n }, people: [...], nextId }.
// Data-driven: add a type to NOTABLE_TYPES with its sources, its bonus text and its effect.

import { STRUCTURES } from './config.js';
import { FIRST_NAMES, LAST_NAMES } from './lifeData.js';
import { addressOf } from './streets.js';
import { pick } from './utils.js';

const count = (city, types) => {
  const set = new Set(Array.isArray(types) ? types : [types]);
  let n = 0;
  for (const t of city.tiles) if (t.structure && set.has(t.structure.type)) n++;
  return n;
};

export const NOTABLE_TYPES = [
  {
    id: 'scientist',
    title: 'Great Scientist',
    color: '#9cc4ea',
    icon: '⚗',
    attract: 'Schools, libraries, universities and offices inspire scientists',
    bonus: 'Schools reach 2 tiles further',
    rate: (city) => 6 * count(city, 'school') + 3 * count(city, 'library') + 12 * count(city, 'university') + 1.5 * count(city, 'office'),
  },
  {
    id: 'doctor',
    title: 'Great Doctor',
    color: '#8fd0a5',
    icon: '✚',
    attract: 'Clinics inspire doctors',
    bonus: 'Clinics reach 2 tiles further',
    rate: (city) => 8 * count(city, 'clinic'),
  },
  {
    id: 'merchant',
    title: 'Great Merchant',
    color: '#ffd98f',
    icon: '$',
    attract: 'Shops, cafés, bakeries, malls and offices inspire merchants',
    bonus: 'Businesses pay 15% more tax',
    rate: (city) => 1.5 * count(city, ['shop', 'cafe', 'bakery']) + 4 * count(city, 'mall') + 1 * count(city, 'office'),
  },
  {
    id: 'engineer',
    title: 'Great Engineer',
    color: '#c9b8e8',
    icon: '⚙',
    attract: 'Factories and roads inspire engineers',
    bonus: 'Everything costs 15% less to build',
    rate: (city) => 6 * count(city, 'factory') + 0.08 * count(city, 'road'),
  },
  {
    id: 'artist',
    title: 'Great Artist',
    color: '#f5a3b5',
    icon: '✿',
    attract: 'Parks and cafés inspire artists',
    bonus: 'Homes near the artist are 8% more desirable',
    rate: (city) => 2.5 * count(city, 'park') + 2 * count(city, 'cafe'),
  },
  {
    id: 'athlete',
    title: 'Great Athlete',
    color: '#ff9f8f',
    icon: '★',
    attract: 'Sports fields and playgrounds inspire athletes',
    bonus: 'Playgrounds, fields and cafés reach 2 tiles further',
    rate: (city) => 7 * count(city, 'field') + 2.5 * count(city, 'playground'),
  },
  {
    id: 'planner',
    title: 'Great Town Planner',
    color: '#b8e0d2',
    icon: '⌂',
    attract: 'A growing population inspires town planners',
    bonus: 'Upkeep costs 15% less',
    rate: (city) => (city.stats.population || 0) / 60,
  },
];
export const notableType = (id) => NOTABLE_TYPES.find((t) => t.id === id);

// Inspiration needed for the next notable rises with every one the town already has.
export function threshold(people) {
  return 30 + 25 * people;
}

export class Notables {
  constructor(city, { rng = Math.random } = {}) {
    this.city = city;
    this.rng = rng;
  }

  get state() {
    const s = this.city.systems;
    if (!s.notables) s.notables = { points: {}, people: [], nextId: 1 };
    return s.notables;
  }

  get people() {
    return this.state.people;
  }

  countOf(type) {
    return this.people.filter((p) => p.type === type).length;
  }

  // Inspiration per day for each type, given what's built now.
  rates() {
    const out = {};
    for (const t of NOTABLE_TYPES) out[t.id] = t.rate(this.city);
    return out;
  }

  // Called with the fraction of a day that passed. Returns the newcomer, if one arrived.
  update(dayFraction, rates = this.rates()) {
    if (dayFraction <= 0) return null;
    const st = this.state;
    const need = threshold(st.people.length);
    let ready = null;
    for (const t of NOTABLE_TYPES) {
      st.points[t.id] = (st.points[t.id] || 0) + (rates[t.id] || 0) * dayFraction;
      if (st.points[t.id] >= need && (!ready || st.points[t.id] > st.points[ready.id])) ready = t;
    }
    if (!ready || !this.city.homes().length) return null;
    st.points[ready.id] = 0;
    return this.arrive(ready.id);
  }

  // A notable person is born into, or moves to, one of the town's homes.
  arrive(typeId, { born = null } = {}) {
    const st = this.state;
    const type = notableType(typeId);
    const homes = this.city
      .homes()
      .filter((h) => !st.people.some((p) => p.home && p.home.x === h.x && p.home.y === h.y))
      .sort((a, b) => b.desirability - a.desirability);
    const home = homes[0] || this.city.homes()[0] || null;
    const wasBorn = born ?? (home?.structure.residents > 0 && this.rng() < 0.5);
    const person = {
      id: st.nextId++,
      type: typeId,
      first: pick(FIRST_NAMES, this.rng),
      last: pick(LAST_NAMES, this.rng),
      home: home ? { x: home.x, y: home.y } : null,
      day: this.city.day,
      born: wasBorn,
    };
    st.people.push(person);
    this.city.emit('notable', { person, notable: type, address: home ? addressOf(home) : null });
    return person;
  }

  // A notable whose home is bulldozed moves to another home (they don't leave town).
  syncHomes() {
    for (const p of this.people) {
      const t = p.home && this.city.getTile(p.home.x, p.home.y);
      if (t?.structure && STRUCTURES[t.structure.type].capacity) continue;
      const next = this.city.homes().sort((a, b) => b.desirability - a.desirability)[0];
      p.home = next ? { x: next.x, y: next.y } : null;
    }
  }

  // Town-wide effects of everyone here. The first of a kind gives the most; more still help.
  effects() {
    const n = (id) => this.countOf(id);
    const steps = (k, first, more, cap) => Math.min(cap, k ? first + (k - 1) * more : 0);
    return {
      radius: { school: steps(n('scientist'), 2, 1, 4), health: steps(n('doctor'), 2, 1, 4), fun: steps(n('athlete'), 2, 1, 4) },
      businessTax: 1 + steps(n('merchant'), 0.15, 0.1, 0.45),
      buildCost: 1 - steps(n('engineer'), 0.15, 0.1, 0.45),
      upkeep: 1 - steps(n('planner'), 0.15, 0.1, 0.45),
      artists: this.people.filter((p) => p.type === 'artist' && p.home).map((p) => p.home),
    };
  }

  // Progress towards the next notable of each kind, best first.
  progress(rates = this.rates()) {
    const need = threshold(this.people.length);
    return NOTABLE_TYPES.map((t) => {
      const pts = this.state.points[t.id] || 0;
      const rate = rates[t.id] || 0;
      return { type: t, points: pts, need, fraction: Math.min(1, pts / need), rate, days: rate > 0 ? Math.max(0, (need - pts) / rate) : Infinity };
    }).sort((a, b) => a.days - b.days || b.fraction - a.fraction);
  }
}

export const fullName = (p) => `${p.first} ${p.last}`;
