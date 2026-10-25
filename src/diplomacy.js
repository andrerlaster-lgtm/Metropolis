// Diplomacy: how your town and each computer town stand with one another, and the leaders who
// decide it. War is no longer automatic: raids and attacks need a declared war (warRoom.js checks).
//
//   Stances: at war, no treaty, at peace (the protection after a peace treaty), a non-aggression
//   pact, or allies. Declaring war while a pact, an alliance or a peace's protection holds is a
//   betrayal: every leader trusts you less and your reputation suffers.
//   Leaders: each computer town has a mayor with a personality (aggression, greed, honour,
//   caution) that changes with what happens: battles won and lost, betrayals, gifts, long wars and
//   long peace. Personality, trust in you and your reputation decide how they answer you.
//   Negotiation: you propose a treaty with terms (money now, daily tribute, an army limit for a
//   while, how long it lasts). They accept, counter with what it would take, or refuse; their
//   patience runs out after a few rounds. They make their own proposals too: peace when the war
//   wears them down, a surrender demand when they're winning, a pact or an alliance when they trust
//   you. Peace ends the war, calls off raids on the way and protects both bases for a few days.
//
// Saved in your town's city.systems.diplomacy = { v, reputation, count, relations: { [townId]:
// { trust, war, weariness, grievance, treaties, patience, closedUntil, offer, counter, nextOffer,
// log } } }; each computer town's leader in its own city.systems.leader.

import { addChronicle } from './chronicle.js';
import { mulberry32 } from './utils.js';

export const DIPLOMACY_VERSION = 1;
export const STANCE_LABEL = { war: 'At war', neutral: 'No treaty', peace: 'At peace', pact: 'Non-aggression pact', alliance: 'Allies' };
export const KIND_LABEL = { peace: 'Peace treaty', pact: 'Non-aggression pact', alliance: 'Alliance' };
export const DEFAULT_DAYS = { peace: 4, pact: 7 };
const LOOK_DAYS = 0.25;
const OFFER_GAP = 1.5; // days between the computer's own proposals
const OFFER_LIFE = 1; // days one of their proposals waits for your answer
const PATIENCE = 3; // proposals they'll hear before they stop talking for a day
const LOG_KEEP = 16;
const FIRST_DAYS = 3; // nobody declares war on you in your base's first days
const CALM_DAYS = 12; // after a peace, the urge to fight again comes back slowly over this many days
const REFUSED_GAP = 3; // days before they repeat a demand you turned down

const FIRST_NAMES = ['Odette', 'Tomasz', 'Amara', 'Hugo', 'Ines', 'Kwame', 'Lena', 'Rafael', 'Saoirse', 'Yusuf', 'Mei', 'Bruno', 'Aurelie', 'Dario', 'Freya', 'Idris', 'Noor', 'Matteo', 'Ingrid', 'Tariq', 'Zofia', 'Emeka', 'Clara', 'Joaquin'];
const LAST_NAMES = ['Varga', 'Lindqvist', 'Okafor', 'Moreau', 'Castillo', 'Haddad', 'Novak', 'Brennan', 'Sato', 'Mensah', 'Ferreira', 'Kowalski', 'Andersen', 'Delgado', 'Rossi', 'Quinn'];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const round50 = (n) => Math.ceil(n / 50) * 50;
const nowOf = (city) => city.day + city.clock;

// A new mayor with a personality between 0.2 and 0.8 on each trait.
export function makeLeader(seed) {
  const rand = mulberry32(seed >>> 0 || 1);
  const trait = () => Math.round((0.2 + rand() * 0.6) * 100) / 100;
  const traits = { aggression: trait(), greed: trait(), honour: trait(), caution: trait() };
  return { v: 1, title: 'Mayor', name: `${FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)]} ${LAST_NAMES[Math.floor(rand() * LAST_NAMES.length)]}`, traits, born: { ...traits } };
}

// The personality in words, the strongest traits first.
export function traitWords(t) {
  const words = [];
  const add = (v, hi, lo) => {
    if (v >= 0.62) words.push([v, hi]);
    else if (v <= 0.34) words.push([1 - v, lo]);
  };
  add(t.aggression, 'warlike', 'peaceable');
  add(t.greed, 'greedy', 'generous');
  add(t.honour, 'honourable', 'two-faced');
  add(t.caution, 'cautious', 'bold');
  return words.sort((a, b) => b[0] - a[0]).map((w) => w[1]);
}

export class Diplomacy {
  // world: World; war: WarRoom (strength, raids, bases).
  constructor(world, war, { rand = Math.random } = {}) {
    this.world = world;
    this.war = war;
    this.rand = rand;
    this.onEvent = null; // ({ kind: 'war'|'offer'|'signed'|'expired'|'closed', id, ... }) → the screens
    this.look = 0;
  }

  get home() {
    return this.world.cities[0];
  }
  now() {
    return nowOf(this.home.city);
  }
  town(id) {
    return this.world.byId(id);
  }

  get state() {
    const s = this.home.city.systems;
    if (!s.diplomacy || typeof s.diplomacy !== 'object' || s.diplomacy.v !== DIPLOMACY_VERSION || !s.diplomacy.relations) s.diplomacy = { v: DIPLOMACY_VERSION, reputation: 60, count: 0, relations: {} };
    return s.diplomacy;
  }

  get reputation() {
    return this.state.reputation;
  }

  leader(c) {
    const sys = c.city.systems;
    if (!sys.leader || !sys.leader.traits) sys.leader = makeLeader(c.entry.seed ^ 0x1eade5);
    return sys.leader;
  }

  // How you stand with a town. A save from before diplomacy starts at war with a town that was
  // already raiding or fighting you (that's how the game played then), and with no treaty otherwise.
  rel(id) {
    const st = this.state;
    if (!st.relations[id]) {
      const c = this.town(id);
      const fought = this.war.state.raids.some((r) => r.from === id || r.target === id) || (this.war.military.state.log || []).some((l) => l.from === c?.entry.name || l.target === c?.entry.name);
      st.relations[id] = { trust: fought ? -20 : 0, war: null, weariness: 0, grievance: 0, treaties: [], patience: PATIENCE, closedUntil: 0, offer: null, counter: null, nextOffer: this.now() + 1, log: [] };
      if (fought) st.relations[id].war = this.newWar('them');
    }
    return st.relations[id];
  }

  newWar(by) {
    return { since: this.now(), by, battles: { you: 0, them: 0 }, lost: { you: 0, them: 0 }, loot: { you: 0, them: 0 } };
  }

  attach() {
    for (const c of this.world.neighbours) {
      this.rel(c.id);
      this.leader(c);
    }
  }

  // ---- Where things stand ---------------------------------------------------------------------

  treaties(id) {
    const t = this.now();
    return this.rel(id).treaties.filter((x) => x.until == null || x.until > t);
  }

  stance(id) {
    const r = this.rel(id);
    if (r.war) return 'war';
    const kinds = this.treaties(id).map((x) => x.kind);
    if (kinds.includes('alliance')) return 'alliance';
    if (kinds.includes('pact')) return 'pact';
    if (kinds.includes('peace')) return 'peace';
    return 'neutral';
  }

  atWar(id) {
    return !!this.rel(id).war;
  }

  // The treaty that declaring war would break, if any.
  betrayalIn(id) {
    return this.treaties(id).find((x) => x.kind === 'alliance' || x.kind === 'pact' || x.kind === 'peace') || null;
  }

  // The army limit a treaty puts on a town ('home' for yours), the tightest one if several.
  armyLimit(id) {
    const t = this.now();
    let best = null;
    for (const c of this.world.neighbours) {
      for (const x of this.rel(c.id).treaties) {
        const l = x.limit;
        if (!l || l.until <= t) continue;
        const on = l.on === 'you' ? 'home' : c.id;
        if (on !== id) continue;
        if (!best || l.soldiers < best.soldiers) best = { soldiers: l.soldiers, until: l.until, with: c.entry.name };
      }
    }
    return best;
  }

  // How the war is going: points for battles won, enemies downed and money carried off.
  score(id) {
    const w = this.rel(id).war;
    if (!w) return { you: 0, them: 0 };
    return { you: w.battles.you * 10 + w.lost.them * 2 + w.loot.you / 100, them: w.battles.them * 10 + w.lost.you * 2 + w.loot.them / 100 };
  }

  // From their side: −1 (they're losing badly) to 1 (winning easily).
  advantage(id) {
    const s = this.score(id);
    return (s.them - s.you) / (s.them + s.you + 20);
  }

  // ---- Declaring war ----------------------------------------------------------------------------

  warError(id) {
    if (this.war.busy) return 'Finish the battle at hand first';
    if (this.atWar(id)) return 'You are already at war';
    return null;
  }

  declareWar(id, by = 'you') {
    const r = this.rel(id);
    if (r.war) return { error: 'Already at war' };
    const c = this.town(id);
    const L = this.leader(c).traits;
    const broken = this.betrayalIn(id);
    r.war = this.newWar(by);
    r.weariness = 0;
    r.treaties = [];
    r.offer = null;
    r.counter = null;
    const t = this.now();
    if (by === 'you') {
      r.trust = clamp(r.trust - (broken ? 60 : 25), -100, 100);
      r.grievance += broken ? 40 : 15;
      L.aggression = clamp(L.aggression + 0.05, 0.05, 0.95);
      L.caution = clamp(L.caution + (broken ? 0.1 : 0.03), 0.05, 0.95);
      if (broken) {
        // Every leader hears of it.
        this.state.reputation = clamp(this.state.reputation - 25, 0, 100);
        for (const o of this.world.neighbours) if (o.id !== id) this.rel(o.id).trust = clamp(this.rel(o.id).trust - 15, -100, 100);
      }
      // They answer soon.
      c.military.state.nextRaidAt = Math.min(c.military.state.nextRaidAt || Infinity, t + 0.3);
    } else {
      // Your base gets half a day before their first raid.
      c.military.state.nextRaidAt = Math.max(c.military.state.nextRaidAt || 0, t + 0.5);
      if (broken) L.honour = clamp(L.honour - 0.05, 0.05, 0.95);
    }
    const who = by === 'you' ? `You declared war on ${c.entry.name}` : `${c.entry.name} declared war on you`;
    this.note(id, `${who}${broken ? `, breaking the ${KIND_LABEL[broken.kind].toLowerCase()}` : ''}.`);
    addChronicle(this.home.city, `${who}${broken ? `, breaking the ${KIND_LABEL[broken.kind].toLowerCase()}` : ''}.`);
    this.onEvent?.({ kind: 'war', id, by, broken: !!broken });
    return { ok: true, broken: !!broken };
  }

  // A battle between you and them (warRoom.js calls this after every raid or attack).
  recordBattle(id, { winner, lost, loot, by }) {
    const r = this.rel(id);
    if (!r.war) return;
    const L = this.leader(this.town(id)).traits;
    r.war.battles[winner]++;
    r.war.lost.you += lost.you;
    r.war.lost.them += lost.them;
    r.war.loot.you += loot.you || 0;
    r.war.loot.them += loot.them || 0;
    r.weariness = clamp(r.weariness + lost.them * 6 + (winner === 'you' ? 12 : -8), 0, 100);
    if (winner === 'them') {
      L.aggression = clamp(L.aggression + 0.03, 0.05, 0.95);
      L.caution = clamp(L.caution - 0.01, 0.05, 0.95);
    } else {
      L.caution = clamp(L.caution + 0.04, 0.05, 0.95);
      L.aggression = clamp(L.aggression - 0.02, 0.05, 0.95);
    }
    if (by === 'you') r.trust = clamp(r.trust - 5, -100, 100);
  }

  // ---- What a proposal is worth to them, in dollars --------------------------------------------

  // offer: { kind: 'peace'|'pact'|'alliance', pay (+ you pay them, − they pay you), tribute: { perDay
  // (+ you pay them), days } | null, limit: { on: 'you'|'them', soldiers, days } | null, days }
  value(id, offer) {
    const c = this.town(id);
    const r = this.rel(id);
    const L = this.leader(c).traits;
    const rep = this.state.reputation;
    let base;
    if (offer.kind === 'peace') base = r.war ? 40 * r.weariness - 1500 * L.aggression - 1200 * this.advantage(id) + 10 * r.trust - 10 * r.grievance : -Infinity;
    else if (offer.kind === 'pact') base = r.war ? -Infinity : 300 + 20 * r.trust + 600 * L.caution - 800 * L.aggression - 10 * r.grievance;
    else if (offer.kind === 'alliance') base = r.war || r.trust < 40 ? -Infinity : 200 + 30 * (r.trust - 50) + 400 * L.caution - 600 * L.aggression - 10 * r.grievance;
    else base = -Infinity;
    if (offer.kind !== 'peace' && rep < 50) base -= (50 - rep) * 30; // they doubt you'll keep your word
    const inMult = 0.7 + 0.6 * L.greed;
    const outMult = 1 + 0.4 * L.greed;
    const money = (n) => (n >= 0 ? n * inMult : n * outMult);
    let terms = money(offer.pay || 0);
    if (offer.tribute) terms += money(offer.tribute.perDay * offer.tribute.days) * 0.9;
    if (offer.limit) {
      const l = offer.limit;
      if (l.on === 'them') terms -= l.days * 80 * (0.5 + L.aggression) + Math.max(0, c.military.state.soldiers.length - l.soldiers) * 40;
      else terms += l.days * 40 * (0.3 + L.aggression) + Math.max(0, this.war.military.state.soldiers.length - l.soldiers) * 15;
    }
    const days = offer.days ?? DEFAULT_DAYS[offer.kind] ?? 0;
    if (offer.kind === 'pact') terms += days * 10 * (L.caution - L.aggression);
    if (offer.kind === 'peace') terms += days * (10 * L.caution - 20 * L.aggression);
    return { base, terms, total: base + terms, inMult, outMult };
  }

  // Why an offer can't be made at all (wrong for the stance, or money nobody has).
  offerError(id, offer) {
    const r = this.rel(id);
    if (!['peace', 'pact', 'alliance'].includes(offer.kind)) return 'Pick a kind of treaty';
    if (offer.kind === 'peace' && !r.war) return 'You are not at war';
    if (offer.kind !== 'peace' && r.war) return 'Make peace first';
    if (offer.kind === 'alliance' && this.stance(id) === 'alliance') return 'You are already allies';
    const yours = this.home.sim.economy.money;
    const theirs = this.town(id).sim.economy.money;
    if ((offer.pay || 0) > yours) return 'Your town can’t pay that much';
    if ((offer.pay || 0) < 0 && -offer.pay > theirs) return `${this.town(id).entry.name} doesn’t have that much`;
    return null;
  }

  // You propose; they accept, counter or refuse.
  propose(id, offer) {
    const r = this.rel(id);
    const c = this.town(id);
    const t = this.now();
    if (this.war.busy) return { outcome: 'closed', line: 'Not while the guns are firing.' };
    if (t < r.closedUntil) return { outcome: 'closed', line: this.say(c, 'closed') };
    const err = this.offerError(id, offer);
    if (err) return { outcome: 'invalid', line: err };
    const v = this.value(id, offer);
    if (v.total >= 0) {
      this.sign(id, offer, 'you');
      return { outcome: 'accepted', line: this.say(c, 'yes') };
    }
    r.patience -= 1;
    if (r.patience <= 0) {
      r.patience = PATIENCE;
      r.closedUntil = t + 1;
      r.counter = null;
      this.onEvent?.({ kind: 'closed', id });
      return { outcome: 'closed', line: this.say(c, 'enough') };
    }
    const counter = Number.isFinite(v.total) ? this.counterOffer(id, offer, -v.total, v) : null;
    r.counter = counter;
    if (counter) return { outcome: 'countered', counter, line: this.say(c, 'counter') };
    return { outcome: 'rejected', line: this.say(c, offer.kind === 'alliance' && r.trust < 40 ? 'distrust' : 'no') };
  }

  // What it would take: drop a limit on them, then ask for less of their money, then for some of yours.
  counterOffer(id, offer, deficit, v) {
    const c = this.town(id);
    const L = this.leader(c).traits;
    const r = this.rel(id);
    const stretch = 1500 + 30 * r.weariness + 1500 * L.greed;
    if (deficit > stretch) return null;
    const out = { ...offer, tribute: offer.tribute ? { ...offer.tribute } : null, limit: offer.limit ? { ...offer.limit } : null, pay: offer.pay || 0 };
    let need = deficit;
    if (out.limit?.on === 'them') {
      const back = this.value(id, { ...out, limit: null }).total - this.value(id, out).total;
      out.limit = null;
      need -= back;
    }
    if (need > 0 && out.tribute && out.tribute.perDay < 0) {
      const back = -out.tribute.perDay * out.tribute.days * v.outMult * 0.9;
      out.tribute = null;
      need -= back;
    }
    if (need > 0 && out.pay < 0) {
      const back = Math.min(-out.pay, need / v.outMult);
      out.pay = Math.min(0, out.pay + round50(back));
      need -= back * v.outMult;
    }
    if (need > 0) out.pay = Math.max(0, out.pay) + round50(need / v.inMult);
    if (out.pay > this.home.sim.economy.money) return null;
    out.fromThem = true;
    return out;
  }

  acceptCounter(id) {
    const r = this.rel(id);
    const c = r.counter;
    if (!c) return { error: 'There is no counteroffer' };
    const err = this.offerError(id, c);
    if (err) return { error: err };
    r.counter = null;
    this.sign(id, c, 'them');
    return { ok: true };
  }

  // Your answer to one of their proposals.
  respond(id, yes) {
    const r = this.rel(id);
    const o = r.offer;
    if (!o) return { error: 'Nothing to answer' };
    r.offer = null;
    if (!yes) {
      r.trust = clamp(r.trust - (o.kind === 'alliance' ? 4 : 2), -100, 100);
      if (o.surrender) r.grievance += 5;
      r.nextOffer = Math.max(r.nextOffer, this.now() + REFUSED_GAP);
      this.note(id, `You turned down their ${o.surrender ? 'surrender demand' : KIND_LABEL[o.kind].toLowerCase()}.`);
      return { ok: true };
    }
    const err = this.offerError(id, o);
    if (err) return { error: err };
    this.sign(id, o, 'them');
    return { ok: true };
  }

  // Make it so: money changes hands, the treaty starts, and peace ends the war.
  sign(id, offer, by) {
    const st = this.state;
    const r = this.rel(id);
    const c = this.town(id);
    const t = this.now();
    const days = offer.days ?? DEFAULT_DAYS[offer.kind];
    this.transfer(c, offer.pay || 0);
    const treaty = { id: `t${++st.count}`, kind: offer.kind, since: t, until: offer.kind === 'alliance' ? null : t + days, by, surrender: !!offer.surrender, terms: { pay: offer.pay || 0 } };
    if (offer.tribute && offer.tribute.perDay && offer.tribute.days > 0) treaty.tribute = { perDay: offer.tribute.perDay, until: t + offer.tribute.days };
    if (offer.limit && offer.limit.days > 0) treaty.limit = { on: offer.limit.on, soldiers: Math.max(0, Math.round(offer.limit.soldiers)), until: t + offer.limit.days };
    // A treaty that runs for a while but whose tribute or limit runs longer stays until those end.
    const lasts = Math.max(treaty.until ?? 0, treaty.tribute?.until ?? 0, treaty.limit?.until ?? 0);
    if (treaty.until != null) treaty.until = lasts;
    if (offer.kind === 'peace') {
      // A war they were losing teaches them caution.
      if (this.advantage(id) < 0) {
        const L = this.leader(c).traits;
        L.caution = clamp(L.caution + 0.08, 0.05, 0.95);
        L.aggression = clamp(L.aggression - 0.05, 0.05, 0.95);
      }
      r.war = null;
      r.weariness = 0;
      r.lastPeace = t;
      this.war.cancelRaids(id);
      // Both bases recover in peace for the protection days.
      for (const m of [this.war.military, c.military]) m.state.protectedUntil = Math.max(m.state.protectedUntil || 0, t + days);
    }
    r.treaties = r.treaties.filter((x) => x.kind !== offer.kind && !(offer.kind === 'alliance' && x.kind === 'pact'));
    r.treaties.push(treaty);
    r.trust = clamp(r.trust + { peace: 3, pact: 5, alliance: 10 }[offer.kind], -100, 100);
    r.offer = null;
    r.counter = null;
    const what = offer.surrender ? 'You accepted their surrender terms' : `${KIND_LABEL[offer.kind]} signed with ${c.entry.name}`;
    this.note(id, `${what}${this.termsText(offer, c.entry.name) ? `: ${this.termsText(offer, c.entry.name)}` : ''}.`);
    addChronicle(this.home.city, `${what}.`);
    this.onEvent?.({ kind: 'signed', id, treaty });
    return treaty;
  }

  // Money between your town's budget and theirs (+ from you to them).
  transfer(c, amount) {
    if (!amount) return 0;
    const yours = this.home.sim.economy.state;
    const theirs = c.sim.economy.state;
    const from = amount > 0 ? yours : theirs;
    const to = amount > 0 ? theirs : yours;
    const n = Math.min(Math.abs(amount), Math.max(0, from.money));
    from.money -= n;
    from.today.expenses += n;
    to.money += n;
    to.today.income += n;
    return n;
  }

  // A gift of money from your town's budget.
  gift(id, amount) {
    const c = this.town(id);
    const r = this.rel(id);
    const L = this.leader(c).traits;
    const n = this.transfer(c, Math.min(amount, this.home.sim.economy.money));
    if (!n) return { error: 'Your town has no money to give' };
    const gain = Math.min(25, (n / 50) * (0.6 + 0.8 * L.greed));
    r.trust = clamp(r.trust + gain, -100, 100);
    r.grievance = Math.max(0, r.grievance - n / 100);
    r.patience = PATIENCE;
    L.greed = clamp(L.greed + 0.01 * (n / 1000), 0.05, 0.95);
    this.note(id, `You sent ${c.entry.name} a gift of $${Math.round(n).toLocaleString()}.`);
    return { ok: true, trust: gain };
  }

  // Leave an alliance without a war (no betrayal, but they're disappointed).
  endAlliance(id) {
    const r = this.rel(id);
    const before = r.treaties.length;
    r.treaties = r.treaties.filter((x) => x.kind !== 'alliance');
    if (r.treaties.length === before) return { error: 'You are not allies' };
    r.trust = clamp(r.trust - 10, -100, 100);
    this.note(id, 'You ended the alliance.');
    return { ok: true };
  }

  // ---- Time passing ----------------------------------------------------------------------------

  update(dayFraction) {
    if (dayFraction <= 0) return;
    const t = this.now();
    for (const c of this.world.neighbours) {
      const r = this.rel(c.id);
      const L = this.leader(c).traits;
      const stance = this.stance(c.id);
      // Tribute flows a little at a time.
      for (const x of r.treaties) {
        if (!x.tribute || x.tribute.until <= t) continue;
        const want = x.tribute.perDay * dayFraction;
        const paid = this.transfer(c, want);
        if (paid < Math.abs(want) - 1e-6) r.trust = clamp(r.trust + (want > 0 ? -1 : 0) * dayFraction, -100, 100);
      }
      // Trust drifts with how things stand; grievances fade.
      const drift = { war: -0.5, neutral: r.trust > 0 ? -0.5 : 0.5, peace: 0.8, pact: 0.8, alliance: 1.2 }[stance];
      r.trust = clamp(r.trust + drift * dayFraction, stance === 'war' ? -80 : -100, stance === 'neutral' && r.trust <= 0 ? 0 : 100);
      r.grievance = Math.max(0, r.grievance - 3 * dayFraction * (this.home?.city?.derived?.skills?.grievanceFade ?? 1)); // Envoy service (skills.js)
      r.weariness = stance === 'war' ? clamp(r.weariness + 8 * dayFraction, 0, 100) : Math.max(0, r.weariness - 10 * dayFraction);
      // Long wars make leaders harder; long peace softens them.
      L.aggression = clamp(L.aggression + (stance === 'war' ? 0.006 : -0.004) * dayFraction, 0.05, 0.95);
      r.patience = Math.min(PATIENCE, r.patience + dayFraction);
      // Treaties that have run their course.
      const ended = r.treaties.filter((x) => x.until != null && x.until <= t);
      if (ended.length) {
        r.treaties = r.treaties.filter((x) => !ended.includes(x));
        for (const x of ended) {
          this.note(c.id, `The ${KIND_LABEL[x.kind].toLowerCase()} came to an end.`);
          this.onEvent?.({ kind: 'expired', id: c.id, treaty: x });
        }
      }
      if (r.offer && t > r.offer.until) {
        this.note(c.id, `Their ${r.offer.surrender ? 'surrender demand' : KIND_LABEL[r.offer.kind].toLowerCase()} lapsed unanswered.`);
        if (r.offer.surrender) r.grievance += 5;
        r.nextOffer = Math.max(r.nextOffer, t + REFUSED_GAP);
        r.offer = null;
      }
    }
    this.look -= dayFraction;
    if (this.look <= 0) {
      this.look = LOOK_DAYS;
      for (const c of this.world.neighbours) this.think(c);
    }
  }

  // A leader's slow look at how things stand: declare war, sue for peace, demand surrender, or
  // offer friendship.
  think(c) {
    const id = c.id;
    const r = this.rel(id);
    const L = this.leader(c).traits;
    const t = this.now();
    const ms = this.war.military.state;
    const peaceful = ms.raids === 'off' || t < (ms.since || 0) + FIRST_DAYS;
    if (!r.war) {
      if (!peaceful && !this.war.busy) {
        const yours = Math.max(1, this.war.military.strength());
        const theirs = c.military.strength();
        const wealth = Math.min(2, this.home.sim.economy.money / Math.max(1000, c.sim.economy.money));
        const calm = r.lastPeace != null ? 40 * Math.max(0, 1 - (t - r.lastPeace) / CALM_DAYS) : 0;
        const hostility = 60 * L.aggression + 20 * L.greed * wealth - 0.5 * r.trust - 30 * L.caution * Math.min(3, yours / Math.max(1, theirs)) + r.grievance - calm;
        const broken = this.betrayalIn(id);
        const threshold = broken ? 70 + 60 * L.honour : 40;
        if (hostility > threshold && theirs >= 0.6 * yours && this.rand() < 0.15) return this.declareWar(id, 'them');
      }
      if (r.offer || t < r.nextOffer) return;
      const stance = this.stance(id);
      if (stance === 'neutral' && r.trust >= 20 && this.value(id, { kind: 'pact', days: 7 }).total >= 300) return this.offer(id, { kind: 'pact', days: 7 });
      if ((stance === 'pact' || stance === 'peace') && r.trust >= 60 && this.value(id, { kind: 'alliance' }).total >= 0) return this.offer(id, { kind: 'alliance' });
      return;
    }
    if (r.offer || t < r.nextOffer || this.war.busy) return;
    const a = this.advantage(id);
    // Winning (two battles or more) and greedy: they demand you give in.
    if (r.war.battles.them >= 2 && a > 0.4 && L.greed > 0.45 && r.weariness < 70) {
      const soldiers = this.war.military.state.soldiers.length;
      const pay = round50(Math.min(3000, Math.max(250, this.home.sim.economy.money * 0.1)));
      return this.offer(id, { kind: 'peace', surrender: true, pay, limit: { on: 'you', soldiers: Math.max(3, soldiers - 3), days: 5 }, days: 4 });
    }
    const v = this.value(id, { kind: 'peace', days: 4 });
    if (v.total >= 0) {
      // Worn down: they ask for peace, and pay for it when they're the ones losing.
      const pay = a < 0 ? -Math.min(round50(v.total * 0.4), Math.floor(c.sim.economy.money * 0.25 / 50) * 50) : 0;
      return this.offer(id, { kind: 'peace', pay, days: 4 });
    }
  }

  offer(id, o) {
    const r = this.rel(id);
    const t = this.now();
    if (this.offerError(id, { ...o, pay: Math.min(o.pay || 0, this.home.sim.economy.money) })) return null;
    r.offer = { ...o, pay: Math.min(o.pay || 0, Math.floor(this.home.sim.economy.money / 50) * 50), by: 'them', at: t, until: t + OFFER_LIFE };
    r.nextOffer = t + OFFER_GAP;
    this.note(id, `${this.town(id).entry.name} proposed ${o.surrender ? 'that you surrender' : `a ${KIND_LABEL[o.kind].toLowerCase()}`}.`);
    this.onEvent?.({ kind: 'offer', id, offer: r.offer });
    return r.offer;
  }

  // ---- Words ----------------------------------------------------------------------------------

  termsText(o, name) {
    const parts = [];
    if (o.pay > 0) parts.push(`you pay $${o.pay.toLocaleString()}`);
    if (o.pay < 0) parts.push(`${name} pays you $${(-o.pay).toLocaleString()}`);
    if (o.tribute?.perDay > 0) parts.push(`you pay $${o.tribute.perDay} a day for ${o.tribute.days} days`);
    if (o.tribute?.perDay < 0) parts.push(`${name} pays you $${-o.tribute.perDay} a day for ${o.tribute.days} days`);
    if (o.limit) parts.push(`${o.limit.on === 'you' ? 'your' : `${name}'s`} army is kept to ${o.limit.soldiers} soldiers for ${o.limit.days} days`);
    const days = o.days ?? DEFAULT_DAYS[o.kind];
    if (o.kind === 'peace') parts.push(`neither side may start a war for ${days} days`);
    if (o.kind === 'pact') parts.push(`for ${days} days`);
    return parts.join('; ');
  }

  say(c, what) {
    const L = this.leader(c).traits;
    const blunt = L.aggression > 0.55;
    return (
      {
        yes: blunt ? 'Fine. We have a deal.' : 'Agreed. May it hold.',
        counter: L.greed > 0.55 ? 'Not for that. Here is what it would take.' : 'Almost. We could agree to this.',
        no: blunt ? 'You waste my time.' : 'We cannot accept that.',
        distrust: 'We don’t know you well enough for that.',
        enough: blunt ? 'Enough talk. Come back tomorrow.' : 'Let us leave it for today.',
        closed: 'They won’t talk again until tomorrow.',
      }[what] || ''
    );
  }

  note(id, text) {
    const r = this.rel(id);
    r.log.unshift({ day: this.home.city.day, text });
    if (r.log.length > LOG_KEEP) r.log.length = LOG_KEEP;
  }

  // Everything the diplomacy screen shows about one town.
  view(id) {
    const c = this.town(id);
    const r = this.rel(id);
    const L = this.leader(c);
    const t = this.now();
    return {
      id,
      town: c.entry.name,
      leader: L,
      words: traitWords(L.traits),
      stance: this.stance(id),
      trust: Math.round(r.trust),
      reputation: Math.round(this.state.reputation),
      war: r.war ? { ...r.war, days: t - r.war.since, score: this.score(id) } : null,
      treaties: this.treaties(id).map((x) => ({ ...x, left: x.until == null ? null : x.until - t })),
      offer: r.offer,
      counter: r.counter,
      closedFor: Math.max(0, r.closedUntil - t),
      patience: Math.floor(r.patience),
      betrayal: this.betrayalIn(id),
      log: r.log,
    };
  }
}
