// Townsfolk: a cast of named residents who live their own days. Ideas adapted from emergent-city
// (needs that run down, personalities, a utility AI that scores what to do, relationships and memories),
// kept gentle for a cozy town: no crime, just friendships, favourite cafés, weddings and the odd bad week.
//
// Every in-game hour each person:
//   1. gets a little hungrier, more tired, lonelier and more bored (their needs run down),
//   2. scores what they could do now (sleep, work, eat out, meet friends, play, shop, stay in) from their
//      needs, personality, quirk, the hour, the weather and which places are within reach, and does the best,
//   3. meets whoever else is at the same place, which builds friendships and makes the news.
// Needs nobody can meet (no café within reach, nowhere to play) are counted for the advisor.
//
// Saved in city.systems.townsfolk = { people, nextId, news, hour }. Read-only towards the rest of the city.

import { STRUCTURES } from './config.js';
import { FIRST_NAMES, LAST_NAMES, SKIN_TONES, HAIR_COLORS, OUTFIT_COLORS } from './lifeData.js';
import { addressOf, shortName } from './streets.js';
import { NOTABLE_TYPES } from './notables.js';
import { clamp, pick, pickWeighted } from './utils.js';

export const MAX_TOWNSFOLK = 40;
export const RESIDENTS_PER_TOWNSPERSON = 8;
const NEWS_KEEP = 30;
const MEMORY_KEEP = 6;
const FRIENDS_KEEP = 12;
const REACH = 12; // furthest a place can be (in tiles) and still be "nearby"
const MAX_CATCHUP_HOURS = 24;

export const NEEDS = ['energy', 'hunger', 'social', 'fun'];
export const NEED_LABELS = { energy: 'Rest', hunger: 'Food', social: 'Company', fun: 'Fun' };
// Per hour, before personality. Hunger runs down fastest; tiredness builds through the day.
const DECAY = { energy: 0.045, hunger: 0.07, social: 0.035, fun: 0.032 };

export const QUIRKS = [
  { id: 'earlyBird', label: 'Early bird', hint: 'Up with the sun, in bed early' },
  { id: 'nightOwl', label: 'Night owl', hint: 'Stays out late' },
  { id: 'foodie', label: 'Foodie', hint: 'Loves eating out' },
  { id: 'homebody', label: 'Homebody', hint: 'Happiest at home' },
  { id: 'sporty', label: 'Sporty', hint: 'Never misses a game at the field' },
  { id: 'greenThumb', label: 'Green thumb', hint: 'Spends hours in the park' },
  { id: 'shopper', label: 'Shopper', hint: 'Window shopping is a hobby' },
  { id: 'chatterbox', label: 'Chatterbox', hint: 'Knows everyone in town' },
];
export const quirkOf = (id) => QUIRKS.find((q) => q.id === id);

// Big Five, softened into friendly words for the panel.
const TRAIT_WORDS = {
  o: ['set in their ways', 'curious'],
  c: ['easygoing', 'hard-working'],
  e: ['quiet', 'outgoing'],
  a: ['blunt', 'kind'],
  n: ['calm', 'a worrier'],
};

// Where each kind of outing happens. Weights favour the most fitting place.
const VENUES = {
  eat: { cafe: 3, bakery: 2.5, restaurant: 3, mall: 2, market: 1.5, farm: 0.6, hotel: 1, shop: 1 },
  social: { cafe: 3, restaurant: 2, park: 2, fountain: 1.5, garden: 1.2, library: 1.5, museum: 1, cinema: 2, playground: 1.5, field: 1.5, mall: 1, hotel: 0.8 },
  play: { park: 2.5, playground: 2, field: 2.5, pool: 2.5, stadium: 3, cinema: 1.5, garden: 1, cafe: 0.8 },
  shop: { mall: 3, shop: 2, market: 2.5 },
};
const ACTIVITY = {
  sleep: { label: 'Asleep', verb: 'sleeping', icon: '☾' },
  work: { label: 'At work', verb: 'working', icon: '⚒' },
  eat: { label: 'Eating out', verb: 'having a bite', icon: '☕' },
  social: { label: 'With friends', verb: 'catching up with friends', icon: '☺' },
  play: { label: 'Out playing', verb: 'out enjoying themselves', icon: '✿' },
  shop: { label: 'Shopping', verb: 'shopping', icon: '◆' },
  home: { label: 'At home', verb: 'relaxing at home', icon: '⌂' },
};
export const activityOf = (id) => ACTIVITY[id] || ACTIVITY.home;

const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const same = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y;
const keyOf = (p) => `${p.x},${p.y}`;
export const fullName = (p) => `${p.first} ${p.last}`;
const round3 = (v) => Math.round(v * 1000) / 1000;

// How someone is feeling, 0..1: mostly their needs, nudged by how nice home is and their temperament.
export function moodOf(p, homeDesirability = 0.5) {
  const needs = NEEDS.reduce((s, k) => s + p.needs[k], 0) / NEEDS.length;
  const lowest = Math.min(...NEEDS.map((k) => p.needs[k]));
  return clamp(0.55 * needs + 0.2 * lowest + 0.2 * homeDesirability + 0.1 - 0.12 * p.traits.n, 0, 1);
}
export function moodWord(m) {
  return m >= 0.75 ? 'Cheerful' : m >= 0.55 ? 'Content' : m >= 0.35 ? 'So-so' : 'Unhappy';
}
export function traitWords(t) {
  return Object.keys(TRAIT_WORDS)
    .map((k) => ({ k, d: Math.abs(t[k] - 0.5) }))
    .sort((a, b) => b.d - a.d)
    .slice(0, 2)
    .map(({ k }) => TRAIT_WORDS[k][t[k] >= 0.5 ? 1 : 0]);
}

// What makes two people click: similar energy and interests, and kindness on both sides.
export function chemistry(a, b) {
  return clamp(1 - 0.6 * Math.abs(a.traits.e - b.traits.e) - 0.4 * Math.abs(a.traits.o - b.traits.o) + 0.4 * ((a.traits.a + b.traits.a) / 2 - 0.5), 0, 1);
}

export class Townsfolk {
  constructor(city, { rng = Math.random } = {}) {
    this.city = city;
    this.rng = rng;
  }

  get state() {
    const s = this.city.systems;
    if (!s.townsfolk) s.townsfolk = { people: [], nextId: 1, news: [], hour: null };
    return s.townsfolk;
  }

  get people() {
    return this.state.people;
  }

  byId(id) {
    return this.people.find((p) => p.id === id);
  }

  // How many named people the town has room for.
  target() {
    return Math.min(MAX_TOWNSFOLK, Math.ceil((this.city.stats?.population || 0) / RESIDENTS_PER_TOWNSPERSON));
  }

  // Called every frame; acts once per in-game hour (catching up if the game ran fast).
  update() {
    const st = this.state;
    const now = Math.floor((this.city.day + this.city.clock) * 24);
    if (st.hour == null || now < st.hour) st.hour = now - 1;
    let hours = Math.min(MAX_CATCHUP_HOURS, now - st.hour);
    st.hour = now;
    const trips = [];
    while (hours-- > 0) trips.push(...this.hourTick(now - hours));
    return trips;
  }

  // One hour of town life. Returns the trips people made, so walkers can show them.
  hourTick(hourIndex) {
    const city = this.city;
    this.sync();
    const hour = ((hourIndex % 24) + 24) % 24;
    const day = Math.floor(hourIndex / 24);
    const weekend = day % 7 >= 5;
    const w = city.derived.weather;
    const wet = Math.max(w?.rain || 0, w?.snow || 0);
    const venues = this.venues();
    const unmet = { eat: [], play: [], social: [] };
    const trips = [];
    for (const p of this.people) {
      for (const k of NEEDS) p.needs[k] = clamp(p.needs[k] - DECAY[k] * (k === 'social' ? 0.6 + p.traits.e * 0.8 : 1), 0, 1);
      const choice = this.choose(p, { hour, weekend, wet, venues, unmet });
      const from = p.at || p.home;
      this.act(p, choice);
      if (!same(from, p.at)) trips.push({ id: p.id, from: { ...from }, to: { ...p.at }, doing: p.doing });
      const home = city.getTile(p.home.x, p.home.y);
      p.mood = round3(moodOf(p, home?.desirability ?? 0.5));
      this.dayBook(p, hourIndex);
    }
    this.meetings(hourIndex);
    this.tidy();
    // Remember who couldn't find a place in the last day, so the advisor sees it day and night.
    this._unmet ||= { eat: new Map(), play: new Map(), social: new Map() };
    const out = {};
    for (const kind of Object.keys(this._unmet)) {
      const m = this._unmet[kind];
      for (const id of unmet[kind]) m.set(id, hourIndex);
      for (const [id, h] of m) if (hourIndex - h > 24 || !this.byId(id)) m.delete(id);
      out[kind] = [...m.keys()];
    }
    city.derived.townsfolkUnmet = out;
    return trips;
  }

  // Places people can go, by kind of outing.
  venues() {
    const out = { eat: [], social: [], play: [], shop: [] };
    for (const t of this.city.tiles) {
      const type = t.structure?.type;
      if (!type) continue;
      for (const kind of Object.keys(VENUES)) if (VENUES[kind][type]) out[kind].push(t);
    }
    return out;
  }

  // The nearest fitting place within reach, a little random so people don't all crowd one café.
  // Someone's favourite place pulls them back.
  pickVenue(p, list, kind) {
    const near = list.filter((t) => dist(t, p.home) <= REACH);
    return pickWeighted(near, (t) => {
      const fav = p.favorite && same(p.favorite, t) ? 2.5 : 1;
      return (VENUES[kind][t.structure.type] * fav) / (1 + dist(t, p.home)) ** 1.5;
    }, this.rng);
  }

  // Utility AI: every option gets a score from needs × personality × time of day; the best wins.
  choose(p, { hour, weekend, wet, venues, unmet }) {
    const { traits: t, needs: n, quirk } = p;
    const shift = quirk === 'earlyBird' ? -2 : quirk === 'nightOwl' ? 2 : 0;
    const h = (hour - shift + 24) % 24;
    const night = h >= 23 || h < 6;
    const late = h >= 21 || night;
    const ache = (v) => (1 - v) ** 2;
    const opts = [];
    const jitter = () => this.rng() * 0.25;

    opts.push({ act: 'sleep', at: p.home, score: 2.2 * ache(n.energy) + (night ? 2.2 : h >= 22 ? 1 : 0) + jitter() });
    opts.push({ act: 'home', at: p.home, score: 0.45 + (quirk === 'homebody' ? 0.5 : 0) + 0.3 * wet + (late ? 0.5 : 0) + jitter() });

    const job = p.job && this.city.getTile(p.job.x, p.job.y)?.structure ? p.job : null;
    if (job && !weekend && h >= 8 && h < 17) {
      opts.push({ act: 'work', at: job, score: 1.6 + 0.8 * t.c - 0.6 * ache(n.energy) - 0.5 * ache(n.hunger) + jitter() });
    }

    const out = (act, need, base) => {
      if (night) return;
      const v = this.pickVenue(p, venues[act], act);
      if (!v) {
        if (need != null && n[need] < 0.35) unmet[act]?.push(p.id);
        return;
      }
      const rain = STRUCTURES[v.structure.type].walkable ? 0.8 * wet : 0.2 * wet;
      opts.push({ act, at: { x: v.x, y: v.y }, score: base - rain + jitter() });
    };
    const meal = h === 12 || h === 13 || h === 18 || h === 19 ? 0.7 : 0;
    out('eat', 'hunger', 3 * ache(n.hunger) + meal + (quirk === 'foodie' ? 0.5 : 0) + 0.2 * t.e);
    out('social', 'social', 2.4 * ache(n.social) * (0.5 + t.e) + (h >= 17 && h < 22 ? 0.5 : 0) + (weekend ? 0.3 : 0) + (quirk === 'chatterbox' ? 0.5 : 0));
    out('play', 'fun', 2.2 * ache(n.fun) * (0.6 + t.o * 0.8) + (weekend ? 0.5 : 0) + (quirk === 'sporty' || quirk === 'greenThumb' ? 0.5 : 0) - (p.age < 13 ? 0 : 0.1));
    if (h >= 9 && h < 20) out('shop', null, 0.5 * ache(n.fun) + (quirk === 'shopper' ? 0.9 : 0) + (weekend ? 0.25 : 0));
    // Eating at home is always possible, just less fun.
    opts.push({ act: 'cook', at: p.home, score: 2.2 * ache(n.hunger) - 0.2 + jitter() });

    let best = opts[0];
    for (const o of opts) if (o.score > best.score) best = o;
    return best;
  }

  act(p, { act, at }) {
    const n = p.needs;
    const add = (k, v) => (n[k] = clamp(n[k] + v, 0, 1));
    p.doing = act === 'cook' ? 'home' : act;
    p.at = { x: at.x, y: at.y };
    switch (act) {
      case 'sleep':
        add('energy', 0.16);
        break;
      case 'home':
        add('energy', 0.05);
        add('fun', 0.03);
        break;
      case 'cook':
        add('hunger', 0.45);
        break;
      case 'work':
        add('energy', -0.03);
        add('social', 0.04);
        p.hoursWorked = (p.hoursWorked || 0) + 1;
        break;
      case 'eat':
        add('hunger', 0.6);
        add('fun', 0.08);
        add('social', 0.05);
        break;
      case 'social':
        add('social', 0.3);
        add('fun', 0.08);
        break;
      case 'play':
        add('fun', 0.32);
        add('energy', -0.03);
        break;
      case 'shop':
        add('fun', 0.2);
        break;
    }
    // Regulars: going back to the same café or park often makes it their favourite.
    if (act === 'eat' || act === 'social' || act === 'play' || act === 'shop') {
      const k = keyOf(at);
      p.visits ||= {};
      p.visits[k] = (p.visits[k] || 0) + 1;
      const keys = Object.keys(p.visits);
      if (keys.length > 8) delete p.visits[keys.sort((a, b) => p.visits[a] - p.visits[b])[0]];
      if (p.visits[k] >= 8 && !same(p.favorite, at) && (!p.favorite || p.visits[k] > (p.visits[keyOf(p.favorite)] || 0) + 3)) {
        const first = !p.favorite;
        p.favorite = { x: at.x, y: at.y };
        const place = this.placeName(at);
        this.remember(p, `Became a regular at ${place}`);
        // Only a first favourite makes the news, and only now and then, so friendships aren't drowned out.
        if (first && this.rng() < 0.35) this.news('regular', `${fullName(p)} is now a regular at ${place}.`, at, [p.id]);
      }
    }
  }

  // Low spirits that last bring a visit from a friend, or, after long enough, a move away.
  dayBook(p, hourIndex) {
    if (p.mood < 0.3) p.lowHours = (p.lowHours || 0) + 1;
    else p.lowHours = Math.max(0, (p.lowHours || 0) - 2);
    if (p.lowHours === 18) {
      const worst = NEEDS.slice().sort((a, b) => p.needs[a] - p.needs[b])[0];
      this.news('down', `${fullName(p)} is having a hard week and could use more ${NEED_LABELS[worst].toLowerCase()} nearby.`, p.home, [p.id], 'caution');
      const friend = this.closestFriend(p);
      if (friend && friend.mood > 0.5) {
        p.needs.social = clamp(p.needs.social + 0.4, 0, 1);
        p.lowHours = 6;
        this.remember(p, `${fullName(friend)} came round to cheer them up`);
        this.news('cheer', `${fullName(friend)} dropped by to cheer up ${fullName(p)}.`, p.home, [friend.id, p.id]);
      }
    }
    if (p.lowHours >= 48 && !p.notable) {
      this.news('left', `${fullName(p)} moved away from ${this.streetOf(p.home) || 'town'}, hoping for a happier place.`, p.home, [p.id], 'bad');
      this.remove(p);
    }
    void hourIndex;
  }

  // People in the same place at the same hour meet. Friendships, romances and the odd falling-out follow.
  meetings(hourIndex) {
    const groups = new Map();
    for (const p of this.people) {
      if (p.doing === 'sleep' || p.doing === 'home') continue;
      const k = keyOf(p.at);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const crowd = group.length > 6 ? group.slice().sort(() => this.rng() - 0.5).slice(0, 6) : group;
      for (let i = 0; i < crowd.length; i++) {
        for (let j = i + 1; j < crowd.length; j++) this.meet(crowd[i], crowd[j], hourIndex);
      }
    }
    // Star sightings: one story per star per day, naming everyone who met them.
    for (const { star, title, place, at, fans } of this._fans?.values() || []) {
      if (star.sightingDay === this.city.day) continue;
      star.sightingDay = this.city.day;
      const names = fans.map((f) => f.first);
      const who = names.length === 1 ? fullName(fans[0]) : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
      this.news('star', `${who} met ${title} ${fullName(star)} at ${place}${fans.length > 2 ? ' and asked for autographs' : ''}.`, at, [...fans.map((f) => f.id), star.id]);
    }
    this._fans?.clear();
  }

  rel(a, b) {
    a.rel ||= {};
    return (a.rel[b.id] ||= { f: 0, a: 0 });
  }

  meet(a, b, hourIndex) {
    const ra = this.rel(a, b);
    const rb = this.rel(b, a);
    const chem = chemistry(a, b);
    const atWork = a.doing === 'work' && b.doing === 'work';
    const warmth = (atWork ? 0.035 : 0.07) * (chem - 0.35) * 2 + (this.rng() - 0.5) * 0.04;
    const before = ra.a;
    for (const r of [ra, rb]) {
      r.f = round3(Math.min(1, r.f + (atWork ? 0.05 : 0.1)));
      r.a = round3(clamp(r.a + warmth, -1, 1));
    }
    a.needs.social = clamp(a.needs.social + 0.06, 0, 1);
    b.needs.social = clamp(b.needs.social + 0.06, 0, 1);
    const place = this.placeName(a.at);
    const both = `${fullName(a)} and ${fullName(b)}`;
    // Meeting someone famous makes anyone's day.
    for (const [fan, star] of [[a, b], [b, a]]) {
      if (star.notable && !fan.notable && !(fan.met || []).includes(star.id)) {
        fan.met = [...(fan.met || []), star.id].slice(-10);
        fan.needs.fun = clamp(fan.needs.fun + 0.3, 0, 1);
        const title = NOTABLE_TYPES.find((t) => t.id === star.notable)?.title || 'celebrity';
        this.remember(fan, `Met ${title} ${fullName(star)}`);
        const seen = (this._fans ||= new Map()).get(star.id) || { star, title, place, at: { ...a.at }, fans: [] };
        seen.fans.push(fan);
        this._fans.set(star.id, seen);
      }
    }
    if (before < 0.5 && ra.a >= 0.5) {
      this.remember(a, `Became friends with ${fullName(b)}`);
      this.remember(b, `Became friends with ${fullName(a)}`);
      this.news('friends', `${both} became friends ${atWork ? 'at work' : `at ${place}`}.`, a.at, [a.id, b.id], 'good');
    } else if (before > -0.3 && ra.a <= -0.3) {
      this.news('fallout', `${both} had a falling-out at ${place}.`, a.at, [a.id, b.id], 'caution');
    }
    // Close friends who are both single may fall in love; couples marry after a while.
    if (ra.a >= 0.8 && a.age >= 18 && b.age >= 18 && !a.partner && !b.partner && chem > 0.55 && this.rng() < 0.25) {
      a.partner = b.id;
      b.partner = a.id;
      a.since = b.since = hourIndex;
      this.remember(a, `Fell in love with ${fullName(b)}`);
      this.remember(b, `Fell in love with ${fullName(a)}`);
      this.news('love', `${both} fell in love at ${place}.`, a.at, [a.id, b.id], 'good');
    } else if (a.partner === b.id && !a.married && hourIndex - (a.since || 0) >= 72 && this.rng() < 0.2) {
      a.married = b.married = true;
      this.remember(a, `Married ${fullName(b)}`);
      this.remember(b, `Married ${fullName(a)}`);
      this.news('wedding', `${both} got married at ${place}! The whole street came to celebrate.`, a.at, [a.id, b.id], 'good');
    }
  }

  closestFriend(p) {
    let best = null;
    for (const [id, r] of Object.entries(p.rel || {})) {
      const o = this.byId(Number(id));
      if (o && r.a >= 0.5 && (!best || r.a > best.r.a)) best = { o, r };
    }
    return best?.o || null;
  }

  friendsOf(p) {
    return Object.entries(p.rel || {})
      .map(([id, r]) => ({ person: this.byId(Number(id)), ...r }))
      .filter((f) => f.person && f.a >= 0.5)
      .sort((x, y) => y.a - x.a);
  }

  placeName(at) {
    const t = this.city.getTile(at.x, at.y);
    if (!t?.structure) return 'home';
    const label = STRUCTURES[t.structure.type].label.toLowerCase();
    const street = this.streetOf(at);
    return street ? `the ${label} on ${street}` : `the ${label}`;
  }

  streetOf(at) {
    const t = this.city.getTile(at.x, at.y);
    const name = t?.street || t?.address?.replace(/^\d+\s+/, '');
    return name ? shortName(name) : null;
  }

  remember(p, text) {
    p.mem ||= [];
    p.mem.push({ day: this.city.day, text });
    if (p.mem.length > MEMORY_KEEP) p.mem.shift();
  }

  // Town news: the stories people tell. Newest last; a few are kept.
  news(kind, text, at, who, tone = 'good') {
    const st = this.state;
    const item = { id: (st.newsId = (st.newsId || 0) + 1), kind, text, tone, day: this.city.day, clock: round3(this.city.clock), x: at?.x ?? null, y: at?.y ?? null, who };
    st.news.push(item);
    if (st.news.length > NEWS_KEEP) st.news.shift();
    this.city.emit('townNews', { item });
    return item;
  }

  // ---- The cast follows the town: newcomers when it grows, moves when homes go -------------------

  sync() {
    const city = this.city;
    const st = this.state;
    const homes = city.homes().filter((h) => h.structure.residents > 0);
    const isHome = (at) => {
      const t = at && city.getTile(at.x, at.y);
      return !!t?.structure && STRUCTURES[t.structure.type].capacity > 0 && t.structure.residents > 0;
    };
    // Notable people are townsfolk too, living at their own address.
    for (const n of city.systems.notables?.people || []) {
      let p = st.people.find((q) => q.notable && q.notableId === n.id);
      if (!p && n.home) {
        p = this.create(n.home, { first: n.first, last: n.last, notable: n.type, notableId: n.id });
        if (p) st.people.push(p);
      } else if (p && n.home && !same(p.home, n.home)) p.home = { ...n.home };
    }
    for (const p of st.people.slice()) {
      if (isHome(p.home)) {
        if (p.job && !city.getTile(p.job.x, p.job.y)?.structure) p.job = this.findJob(p.home);
        continue;
      }
      // Their home was bulldozed or emptied: move to the most appealing home with residents, or leave.
      const next = homes.slice().sort((x, y) => y.desirability - x.desirability)[0];
      if (next && (p.notable || this.rng() < 0.5)) {
        p.home = { x: next.x, y: next.y };
        p.at = { ...p.home };
        p.job = this.findJob(p.home);
        this.remember(p, `Moved to ${addressOf(next)}`);
      } else this.remove(p);
    }
    const want = this.target();
    const regular = st.people.filter((p) => !p.notable);
    let room = want - st.people.length;
    const announce = room === 1 && regular.length > 0; // one at a time makes news; a boom doesn't flood it
    while (room > 0 && homes.length) {
      // Fill homes in proportion to how many live there.
      const counts = new Map();
      for (const p of st.people) counts.set(keyOf(p.home), (counts.get(keyOf(p.home)) || 0) + 1);
      const home = pickWeighted(homes, (h) => Math.max(0, h.structure.residents - (counts.get(keyOf(h)) || 0)), this.rng);
      if (!home) break;
      const p = this.create(home);
      st.people.push(p);
      if (announce) this.news('arrived', `${fullName(p)} moved in at ${addressOf(home)}.`, home, [p.id]);
      room--;
    }
    // A shrinking town loses its least-rooted people first (never notables).
    while (st.people.length > want && regular.length) {
      const leaving = st.people.filter((p) => !p.notable).sort((a, b) => Object.keys(a.rel || {}).length - Object.keys(b.rel || {}).length)[0];
      if (!leaving) break;
      this.remove(leaving);
    }
  }

  remove(p) {
    const st = this.state;
    st.people.splice(st.people.indexOf(p), 1);
    for (const o of st.people) {
      if (o.rel) delete o.rel[p.id];
      if (o.partner === p.id) {
        o.partner = null;
        o.married = false;
      }
    }
  }

  // A job at a workplace within reach, if there is one with room, favouring the closest.
  findJob(home) {
    const homeTile = this.city.getTile(home.x, home.y);
    if (homeTile && (homeTile.employment ?? 1) < this.rng()) return null;
    const work = this.city.workplaces().filter((w) => dist(w, home) <= REACH * 1.5 && w.workersFilled > 0);
    const w = pickWeighted(work, (t) => t.workersFilled / (1 + dist(t, home)) ** 1.5, this.rng);
    return w ? { x: w.x, y: w.y } : null;
  }

  create(home, extra = {}) {
    const st = this.state;
    const r = this.rng;
    const trait = () => round3(clamp(0.5 + (r() + r() + r() - 1.5) * 0.55, 0, 1));
    const age = extra.notable ? 25 + Math.floor(r() * 30) : r() < 0.15 ? 8 + Math.floor(r() * 9) : 18 + Math.floor(r() * 60);
    const p = {
      id: st.nextId++,
      first: extra.first || pick(FIRST_NAMES, r),
      last: extra.last || pick(LAST_NAMES, r),
      age,
      home: { x: home.x, y: home.y },
      at: { x: home.x, y: home.y },
      job: null,
      traits: { o: trait(), c: trait(), e: trait(), a: trait(), n: trait() },
      quirk: pick(QUIRKS, r).id,
      needs: { energy: round3(0.6 + r() * 0.4), hunger: round3(0.5 + r() * 0.5), social: round3(0.5 + r() * 0.5), fun: round3(0.5 + r() * 0.5) },
      mood: 0.6,
      doing: 'home',
      look: { shirt: pick(OUTFIT_COLORS, r), skin: pick(SKIN_TONES, r), hair: pick(HAIR_COLORS, r) },
      rel: {},
      mem: [],
      day: this.city.day,
    };
    if (extra.notable) Object.assign(p, { notable: extra.notable, notableId: extra.notableId });
    if (age >= 18 && age < 67) p.job = this.findJob(home);
    return p;
  }

  // Trim relationship books so saves stay small: keep the people they know best.
  tidy() {
    for (const p of this.people) {
      const ids = Object.keys(p.rel || {});
      if (ids.length <= FRIENDS_KEEP) continue;
      ids.sort((x, y) => p.rel[y].f + Math.abs(p.rel[y].a) - (p.rel[x].f + Math.abs(p.rel[x].a)));
      for (const id of ids.slice(FRIENDS_KEEP)) if (Number(id) !== p.partner) delete p.rel[id];
    }
  }

  // The town's mood at a glance, for the panel.
  summary() {
    const people = this.people;
    if (!people.length) return null;
    const avg = people.reduce((s, p) => s + p.mood, 0) / people.length;
    const doing = {};
    for (const p of people) doing[p.doing] = (doing[p.doing] || 0) + 1;
    const needs = {};
    for (const k of NEEDS) needs[k] = people.reduce((s, p) => s + p.needs[k], 0) / people.length;
    let friendships = 0;
    let couples = 0;
    for (const p of people) {
      for (const r of Object.values(p.rel || {})) if (r.a >= 0.5) friendships++;
      if (p.partner) couples++;
    }
    return { count: people.length, mood: avg, doing, needs, friendships: friendships / 2, couples: couples / 2 };
  }
}
