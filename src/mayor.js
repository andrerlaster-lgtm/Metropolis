// The mayor: your town's leader, a second person you control. At first it's your main person's
// father; when he dies, your main person takes over once they're an adult, and until then a
// relative stands in as acting mayor. The mayor has four skills and three actions a day for duties
// with real effects: a speech lifts the town's spirit (decisions.js effects, so homes are happier
// for a while), a fundraiser brings in money, inspecting the base trains the soldiers and patches
// the defences (military.js), and meeting a neighbour's mayor builds trust (diplomacy.js). Each
// duty can be done once a day, works better with its skill, and the skill grows with use.
//
// Saved in city.systems.mayor = { v, who, name, age, gen, skills, day, actions, done, log } where
// who is 'father' (your main person's father), 'you' (your main person), 'regent' (a relative
// standing in) or 'founder' (no main person yet). Pure rules, no screen (mayorUI.js).

import { FIRST_NAMES } from './lifeData.js';
import { pick, clamp } from './utils.js';
import { maxHpOf } from './militaryData.js';
import { pickRotation } from './lifeActivities.js';

export const MAYOR_VERSION = 2;
// Besides the four everyday duties, each day brings this many opportunities, chosen from the rest.
export const OPPORTUNITIES = 5;
export const ACTIONS_PER_DAY = 3;
export const ADULT = 18;
const LOG_KEEP = 30;
const SKILL_GAIN = 2;

export const SKILL_LABELS = { charisma: 'Charisma', business: 'Business', command: 'Command', diplomacy: 'Diplomacy' };

// What each duty does; `skill` is the one that makes it work better and grows when it's used.
export const DUTIES = [
  { id: 'speech', skill: 'charisma', core: true, tags: ['happiness'], name: 'Give a speech', text: 'Homes all over town are happier for a few days.' },
  { id: 'fundraiser', skill: 'business', core: true, tags: ['money'], name: 'Hold a fundraiser', text: 'Money for the town, more as it grows.' },
  { id: 'inspect', skill: 'command', core: true, tags: ['military'], name: 'Inspect the base', text: 'Soldiers gain experience and damaged defences get patched up.' },
  { id: 'envoy', skill: 'diplomacy', core: true, tags: ['diplomacy'], name: 'Meet a neighbour’s mayor', text: 'They trust you more and hold fewer grudges.' },
  // Opportunities: a few of these come up each day (Mayor.offered), and some need something in town.
  { id: 'festival', skill: 'charisma', tags: ['happiness'], name: 'Throw a festival', text: 'Costs money; homes are much happier for three days.' },
  { id: 'tour', skill: 'charisma', tags: ['happiness'], name: 'Tour the streets', text: 'Shake hands door to door: homes a little happier for four days.' },
  { id: 'ribbon', skill: 'charisma', tags: ['growth'], name: 'Cut a ribbon', text: 'Newcomers hear the good news: the town grows faster for a few days.' },
  { id: 'greening', skill: 'charisma', tags: ['growth', 'happiness'], name: 'Plant trees with schoolchildren', text: 'A few trees go up near homes that need them.' },
  { id: 'grant', skill: 'business', tags: ['money'], name: 'Apply for a grant', text: 'A bigger payout than a fundraiser, if the application lands.' },
  { id: 'trade', skill: 'business', tags: ['money', 'diplomacy'], name: 'Open trade talks', text: 'A neighbour pays for goods and trusts you a little more.' },
  { id: 'market_day', skill: 'business', tags: ['money', 'happiness'], name: 'Hold a market day', text: 'Needs a shop or market. Sales tax for the town and a lift for spirits.' },
  { id: 'scholars', skill: 'business', tags: ['growth'], name: 'Invite scholars and engineers', text: 'Costs money; the next era comes a year sooner.' },
  { id: 'parade', skill: 'command', tags: ['military', 'happiness'], name: 'Hold a parade', text: 'Needs a base. Soldiers gain experience and the town cheers.' },
  { id: 'supply', skill: 'command', tags: ['military'], name: 'Resupply the defences', text: 'Needs a base. Costs money; badly damaged defences are mended in full.' },
  { id: 'summit', skill: 'diplomacy', tags: ['diplomacy'], name: 'Host a summit', text: 'Every neighbour trusts you a little more.' },
  { id: 'gift', skill: 'diplomacy', tags: ['diplomacy'], name: 'Send a gift to a neighbour', text: 'Costs money; a lot more trust and fewer grudges.' },
];
export const DUTY = Object.fromEntries(DUTIES.map((d) => [d.id, d]));

const day = (city) => city.day + city.clock;
const fullName = (c) => `${c.first} ${c.last}`;

// How strong a duty is: 0.5 with no skill, 1.5 at the top.
export const skillFactor = (skill) => 0.5 + clamp(skill, 0, 100) / 100;

export class Mayor {
  // deps: { life: () → LifeSystem, economy: () → Economy, decisions: () → Decisions, war: () → WarRoom | null, rand }
  constructor(city, deps = {}) {
    this.city = city;
    this.d = deps;
    this.rand = deps.rand || Math.random;
  }

  get char() {
    return this.d.life?.()?.char || null;
  }

  get state() {
    const s = this.city.systems;
    if (!s.mayor || typeof s.mayor !== 'object' || !s.mayor.skills) s.mayor = this.fresh();
    return s.mayor;
  }

  randomSkills() {
    const r = () => 30 + Math.round(this.rand() * 25);
    return { charisma: r(), business: r(), command: r(), diplomacy: r() };
  }

  // The town's Leadership & Legacy upgrades (skills.js), as the simulation last worked them out.
  get up() {
    return this.city.derived?.skills || {};
  }

  // Duties a day: 3, or 4 with a Town council.
  // The day's opportunities: the everyday duties are always there; of the rest, a few come up each
  // day, favouring ones that weren't on offer yesterday. Saved in state.offered = { day, ids }.
  offered() {
    const st = this.state;
    const today = Math.floor(day(this.city));
    if (!st.offered || st.offered.day !== today || !Array.isArray(st.offered.ids)) {
      const extras = DUTIES.filter((d) => !d.core && !this.needsError(d.id));
      st.offered = { day: today, ids: pickRotation(extras, st.offered?.ids || [], OPPORTUNITIES, this.rand) };
    }
    return DUTIES.filter((d) => d.core || st.offered.ids.includes(d.id));
  }

  // What it costs, in money, to do a duty now (Sandbox towns pay nothing).
  costOf(id) {
    if (this.d.economy?.()?.sandbox) return 0;
    const pop = this.city.stats?.population || 0;
    if (id === 'festival') return Math.round((150 + 0.6 * pop) / 10) * 10;
    if (id === 'gift') return Math.round((200 + 0.5 * pop) / 10) * 10;
    if (id === 'supply') return Math.round((100 + 0.3 * pop) / 10) * 10;
    if (id === 'scholars') return Math.round((400 + 1.5 * pop) / 10) * 10;
    return 0;
  }

  // Duties of a day-long chance: why one can't be offered at all right now (what it needs in town).
  needsError(id) {
    const war = this.d.war?.();
    const types = new Set(this.city.tiles.map((t) => t.structure?.type));
    if (['parade', 'supply'].includes(id) && !war?.military) return 'Your town has no base yet';
    if (id === 'supply' && !war?.military?.damaged?.().length) return 'Nothing needs mending';
    if (['trade', 'summit', 'gift'].includes(id) && !this.neighbour()) return 'There’s no neighbouring town';
    if (id === 'market_day' && !types.has('market') && !types.has('shop')) return 'The town needs a shop or a market';
    if (id === 'scholars' && (this.d.eras?.()?.index ?? 0) >= 4) return 'The town is in its last era';
    return null;
  }

  actionsPerDay() {
    return ACTIONS_PER_DAY + (this.up.actions || 0);
  }

  // Lift every skill to at least `floor`.
  floored(skills, floor) {
    if (!floor) return skills;
    const out = { ...skills };
    for (const k of Object.keys(out)) out[k] = Math.max(out[k], floor);
    return out;
  }

  // Your main person's skills as mayor come from how they grew up: looks, happiness and friends make
  // charisma; smarts, their career and savings make business sense; health makes command; smarts,
  // a settled mood and a partner make a diplomat. Their traits add a little. From 10 to 100.
  skillsOf(c) {
    const s = c.stats || {};
    const has = (t) => (c.traits || []).includes(t);
    const friends = Math.min(5, (c.friends || []).length);
    const level = c.job ? (c.job.level || 0) + 1 : 0;
    const k = (v) => clamp(Math.round(v), 10, 100);
    return {
      charisma: k(10 + 0.4 * (s.looks ?? 50) + 0.3 * (s.happiness ?? 50) + 4 * friends + (has('outgoing') ? 8 : 0) + (has('creative') ? 4 : 0)),
      business: k(10 + 0.55 * (s.smarts ?? 50) + 6 * level + Math.min(10, (c.money || 0) / 5000) + (has('thrifty') ? 6 : 0)),
      command: k(10 + 0.45 * (s.health ?? 50) + 0.2 * (s.smarts ?? 50) + (has('sporty') ? 8 : 0)),
      diplomacy: k(10 + 0.45 * (s.smarts ?? 50) + 0.25 * (s.happiness ?? 50) + (c.partner ? 4 : 0) + (has('calm') ? 8 : 0)),
    };
  }

  // The skills your main person would bring if they led today, while someone else does.
  prospects() {
    const c = this.char;
    if (!c?.alive || this.state.who === 'you') return null;
    return this.skillsOf(c);
  }

  fresh() {
    const c = this.char;
    const f = c?.family?.father;
    const base = { v: MAYOR_VERSION, day: Math.floor(day(this.city)), actions: this.actionsPerDay(), done: {}, log: [] };
    if (c && f?.alive) return { ...base, who: 'father', name: f.name, age: f.age, gen: c.generation || 1, skills: this.randomSkills() };
    if (c) return { ...base, ...this.successor(c) };
    return { ...base, who: 'founder', name: `${pick(FIRST_NAMES, this.rand)} Hale`, age: 45, gen: 0, skills: this.randomSkills() };
  }

  // Who leads next: your main person if they're an adult, or a relative standing in until they are.
  successor(c) {
    if (c?.alive && c.age >= ADULT) {
      // Family tutors (skills.js): your heir comes to office better prepared.
      const bonus = this.up.heirBonus || 0;
      const skills = this.skillsOf(c);
      if (bonus) for (const k of Object.keys(skills)) skills[k] = clamp(skills[k] + bonus, 10, 100);
      return { who: 'you', name: fullName(c), age: c.age, gen: c.generation || 1, skills };
    }
    const pronoun = this.rand() < 0.5 ? 'she' : 'he';
    return {
      who: 'regent',
      name: `${pick(FIRST_NAMES, this.rand)} ${c?.last || 'Hale'}`,
      relation: pronoun === 'she' ? 'aunt' : 'uncle',
      age: 40 + Math.floor(this.rand() * 15),
      gen: c?.generation || 1,
      skills: this.floored(this.randomSkills(), this.up.regentFloor || 0), // Trusted regents (skills.js)
    };
  }

  // A new leader takes office; the day's actions start fresh.
  install(next, why) {
    const st = this.state;
    const before = st.name;
    const quiet = st.who === 'founder'; // a new town's first family taking office isn't news
    // Dynasty (skills.js): no new leader starts weak.
    if (next.skills) next = { ...next, skills: this.floored(next.skills, this.up.leaderFloor || 0) };
    Object.assign(st, { relation: undefined, ...next, actions: this.actionsPerDay(), done: {} });
    this.note(why ? `${why} ${this.title()} ${st.name} took office.` : `${st.name} took office as ${this.title().toLowerCase()}.`);
    this.city.emit('mayorChanged', { before, after: st.name, who: st.who, quiet });
  }

  // Keep the mayor in step with your main person's family and with the calendar.
  update() {
    const st = this.state;
    const c = this.char;
    const today = Math.floor(day(this.city));
    if (today > st.day) {
      if (st.who === 'regent' || st.who === 'founder') st.age += today - st.day;
      st.day = today;
      st.actions = this.actionsPerDay();
      st.done = {};
    }
    if (!c) return;
    const f = c.family?.father;
    if (st.who === 'founder') return this.install(f?.alive ? { who: 'father', name: f.name, age: f.age, gen: c.generation || 1, skills: this.randomSkills() } : this.successor(c));
    if (st.who === 'father') {
      if (f && f.name === st.name && (c.generation || 1) === st.gen) {
        st.age = f.age;
        if (!f.alive) this.install(this.successor(c), `Mayor ${st.name} died.`);
        return;
      }
      // The family story went on to the next generation: the old mayor steps down for the heir.
      if (c.heirOf) return this.install(this.successor(c), `${st.name} stepped down.`);
      // A new life in a different family: its father leads now.
      if (f?.alive) return this.install({ who: 'father', name: f.name, age: f.age, gen: c.generation || 1, skills: this.randomSkills() });
      return this.install(this.successor(c), `${st.name} stepped down.`);
    }
    if (st.who === 'you') {
      const same = fullName(c) === st.name && (c.generation || 1) === st.gen;
      if (same && c.alive) {
        st.age = c.age;
        return;
      }
      if (same && !c.alive) return; // waiting for the family story to go on
      return this.install(this.successor(c), `Mayor ${st.name} died.`);
    }
    if (st.who === 'regent' && c.alive && c.age >= ADULT) this.install(this.successor(c), `${c.first} came of age.`);
  }

  title() {
    const st = this.state;
    return st.who === 'regent' ? 'Acting mayor' : 'Mayor';
  }

  // How the mayor is related to your main person, in words.
  relation() {
    const st = this.state;
    const c = this.char;
    if (st.who === 'you') return 'You';
    if (st.who === 'father') return c ? `${c.first}’s father` : 'Your father';
    if (st.who === 'regent') return c ? `${c.first}’s ${st.relation || 'relative'}, until ${c.first} turns ${ADULT}` : 'A relative';
    return 'The town’s founder';
  }

  // Who takes over next, in words.
  nextInLine() {
    const st = this.state;
    const c = this.char;
    if (!c) return null;
    if (st.who === 'you') return 'Your heir takes over, or a relative until they are grown up.';
    if (!c.alive) return null;
    return c.age >= ADULT ? `${c.first} takes over.` : `${c.first} takes over at ${ADULT}; a relative stands in until then.`;
  }

  // ---- Duties ---------------------------------------------------------------------------------

  dutyError(id) {
    const st = this.state;
    const d = DUTY[id];
    if (!d) return 'No such duty';
    if (!d.core && !this.offered().some((x) => x.id === id)) return 'Not on offer today';
    if (st.done[id]) return 'Already done today';
    if (st.actions <= 0) return 'No actions left today. More tomorrow';
    if (id === 'inspect' && !this.d.war?.()?.military) return 'Your town has no base yet';
    if (id === 'envoy' && !this.neighbour()) return 'There’s no neighbouring town';
    if (!d.core) {
      const need = this.needsError(id);
      if (need) return need;
      const cost = this.costOf(id);
      if (cost && !this.d.economy?.()?.canAfford(cost)) return `Needs $${cost.toLocaleString()}`;
    }
    return null;
  }

  // The neighbour a meeting goes to: the one that trusts you least.
  neighbour() {
    const war = this.d.war?.();
    const dip = war?.diplomacy;
    const list = war?.world?.neighbours || [];
    if (!dip || !list.length) return null;
    return list.slice().sort((a, b) => dip.rel(a.id).trust - dip.rel(b.id).trust)[0];
  }

  // A rough idea of what a duty would do now, for the button.
  preview(id) {
    const st = this.state;
    const f = skillFactor(st.skills[DUTY[id].skill]);
    const pop = this.city.stats?.population || 0;
    if (id === 'speech') return `+${Math.round(this.speechAmount(f) * 100)}% happiness`;
    if (id === 'fundraiser') return `about $${this.fundsAmount(f, pop).toLocaleString()}`;
    if (id === 'inspect') return `+${this.drillXp(f)} experience each`;
    if (id === 'envoy') {
      const n = this.neighbour();
      return n ? `+${Math.round(this.trustGain(f, n))} trust with ${n.entry.name}` : '';
    }
    const cost = this.costOf(id);
    const paid = cost ? `costs $${cost.toLocaleString()}` : '';
    const join = (a) => [paid, a].filter(Boolean).join(', ');
    if (id === 'festival') return join(`+${Math.round(this.festivalAmount(f) * 100)}% happiness`);
    if (id === 'tour') return `+${Math.round(0.012 * f * (this.up.speech ?? 1) * 100)}% happiness`;
    if (id === 'ribbon') return `growth ×${(1 + 0.25 * f).toFixed(2)} for 3 days`;
    if (id === 'greening') return `up to ${this.treesCount(f)} trees`;
    if (id === 'grant') return `$${this.grantAmount(f, pop, 1).toLocaleString()} if it lands`;
    if (id === 'trade') return `about $${this.tradeAmount(f, pop).toLocaleString()}`;
    if (id === 'market_day') return `about $${this.marketAmount(f).toLocaleString()}`;
    if (id === 'scholars') return join('next era 1 year sooner');
    if (id === 'parade') return `+${Math.round(this.drillXp(f) / 2)} experience each`;
    if (id === 'supply') return join('mends the worst-hit defences');
    if (id === 'summit') {
      const n = this.neighbour();
      return n ? `+${Math.round(this.trustGain(f, n) / 2)} trust with each` : '';
    }
    if (id === 'gift') return join('+trust, fewer grudges');
    return '';
  }

  // Upgrades (skills.js) make each duty stronger: Oratory lessons, Town mint, Citadel, Envoy service…
  speechAmount(f) {
    return 0.02 * f * (this.up.speech ?? 1);
  }
  speechDays() {
    return 2 * (this.up.speechDays ?? 1);
  }
  fundsAmount(f, pop) {
    return Math.round(((100 + 1.5 * pop) * f * (this.up.fundraiser ?? 1)) / 10) * 10;
  }
  drillXp(f) {
    return Math.round(8 * f * (this.up.inspect ?? 1));
  }
  trustGain(f, n) {
    const atWar = this.d.war?.()?.diplomacy?.atWar(n.id);
    return 6 * f * (atWar ? 0.5 : 1) * (this.up.envoy ?? 1);
  }

  festivalAmount(f) {
    return 0.045 * f * (this.up.speech ?? 1);
  }
  treesCount(f) {
    return Math.max(2, Math.round(4 * f));
  }
  grantAmount(f, pop, luck) {
    return Math.round(((250 + 3 * pop) * f * luck * (this.up.fundraiser ?? 1)) / 10) * 10;
  }
  tradeAmount(f, pop) {
    return Math.round(((60 + 0.8 * pop) * f) / 10) * 10;
  }
  marketAmount(f) {
    const shops = this.city.tiles.filter((t) => ['shop', 'market', 'mall', 'bakery', 'cafe'].includes(t.structure?.type)).length;
    return Math.round((40 + 22 * Math.min(shops, 14)) * f / 10) * 10;
  }
  // Add money to the town's books (a fundraiser's way).
  earn(n) {
    const eco = this.d.economy?.();
    if (!eco || !n) return;
    eco.state.money += n;
    eco.state.today.income += n;
  }
  // Pay for a duty out of the town's money.
  pay(n) {
    if (n) this.d.economy?.()?.spend(n);
  }

  // Do a duty. Returns { text } or { error }.
  perform(id) {
    const err = this.dutyError(id);
    if (err) return { error: err };
    const st = this.state;
    const d = DUTY[id];
    const f = skillFactor(st.skills[d.skill]) * (0.9 + this.rand() * 0.2);
    const now = day(this.city);
    let text = '';
    if (id === 'speech') {
      const amount = this.speechAmount(f);
      const dec = this.d.decisions?.();
      const days = this.speechDays();
      if (dec) dec.state.effects.push({ amount, until: now + days, id: 'speech' });
      text = `${st.name} gave a rousing speech in the square. Homes are ${Math.round(amount * 100)}% happier for ${days === 2 ? 'two' : days === 4 ? 'four' : days} days.`;
    } else if (id === 'fundraiser') {
      const n = this.fundsAmount(f, this.city.stats?.population || 0);
      const eco = this.d.economy?.();
      if (eco) {
        eco.state.money += n;
        eco.state.today.income += n;
      }
      text = `${st.name}’s fundraiser brought in $${n.toLocaleString()}.`;
    } else if (id === 'inspect') {
      const m = this.d.war().military;
      const xp = this.drillXp(f);
      const fit = m.fit();
      for (const s of fit) s.xp += xp;
      let patched = 0;
      let hp = Math.round(150 * f * (this.up.inspect ?? 1));
      for (const s of m.damaged()) {
        if (hp <= 0) break;
        const max = maxHpOf(s.type, s.level);
        const n = Math.min(hp, Math.max(0, max - s.hp));
        s.hp += n;
        hp -= n;
        if (n > 0) patched++;
      }
      text = `${st.name} inspected the base: ${fit.length} soldier${fit.length === 1 ? '' : 's'} drilled (+${xp} experience)${patched ? `, ${patched} defence${patched === 1 ? '' : 's'} patched up` : ''}.`;
    } else if (id === 'envoy') {
      const n = this.neighbour();
      const dip = this.d.war().diplomacy;
      const r = dip.rel(n.id);
      const gain = this.trustGain(f, n);
      r.trust = clamp(r.trust + gain, -100, 100);
      r.grievance = Math.max(0, (r.grievance || 0) - 5 * f);
      dip.note?.(n.id, `Mayor ${st.name} visited ${n.entry.name} for talks.`);
      text = `${st.name} met the mayor of ${n.entry.name}. Their trust in you rose by ${Math.round(gain)}.`;
    }
    else text = this.performMore(id, f, now);
    st.actions -= 1;
    st.done[id] = true;
    st.skills[d.skill] = Math.min(100, st.skills[d.skill] + SKILL_GAIN * (this.up.mayorGain ?? 1)); // Town clerks (skills.js)
    this.note(text);
    return { text };
  }

  // The opportunities. Each uses the systems the everyday duties use: decisions (spirit), growth,
  // eras, the economy, the base and diplomacy.
  performMore(id, f, now) {
    const st = this.state;
    const pop = this.city.stats?.population || 0;
    const war = this.d.war?.();
    const dec = this.d.decisions?.();
    const cost = this.costOf(id);
    if (id === 'festival') {
      this.pay(cost);
      const amount = this.festivalAmount(f);
      dec?.state.effects.push({ amount, until: now + 3, id: 'festival' });
      return `${st.name} threw a festival in the square. Homes are ${Math.round(amount * 100)}% happier for three days.`;
    }
    if (id === 'tour') {
      const amount = 0.012 * f * (this.up.speech ?? 1);
      dec?.state.effects.push({ amount, until: now + 4, id: 'tour' });
      return `${st.name} toured the streets, shaking hands. Spirits are up a little for four days.`;
    }
    if (id === 'ribbon') {
      const mult = 1 + 0.25 * f;
      this.d.growth?.()?.boost(mult, 3, 'Ribbon cutting');
      return `${st.name} cut the ribbon on the town's newest corner. Word got round: growth ×${mult.toFixed(2)} for three days.`;
    }
    if (id === 'greening') {
      const g = this.d.growth?.();
      let n = 0;
      for (let i = 0; i < this.treesCount(f) && g; i++) if (g.plantTree()) n++;
      return n ? `${st.name} planted ${n} tree${n === 1 ? '' : 's'} with the schoolchildren.` : `${st.name} led the schoolchildren out with spades, but there was nowhere left to plant.`;
    }
    if (id === 'grant') {
      const lands = this.rand() < 0.55 + 0.4 * (st.skills.business / 100);
      const n = lands ? this.grantAmount(f, pop, 1) : this.grantAmount(f, pop, 0.15);
      this.earn(n);
      return lands ? `${st.name}’s grant application landed: $${n.toLocaleString()} for the town.` : `The grant mostly fell through. ${st.name} brought back $${n.toLocaleString()} for the effort.`;
    }
    if (id === 'trade') {
      const n = this.neighbour();
      const dip = war.diplomacy;
      const r = dip.rel(n.id);
      r.trust = clamp(r.trust + this.trustGain(f, n) / 2, -100, 100);
      const money = this.tradeAmount(f, pop);
      this.earn(money);
      dip.note?.(n.id, `Mayor ${st.name} opened trade talks with ${n.entry.name}.`);
      return `${st.name} opened trade talks with ${n.entry.name}: $${money.toLocaleString()} in the first deals, and a little more trust.`;
    }
    if (id === 'market_day') {
      const n = this.marketAmount(f);
      this.earn(n);
      dec?.state.effects.push({ amount: 0.015 * f, until: now + 2, id: 'market_day' });
      return `${st.name} opened a market day. The town took $${n.toLocaleString()} in sales tax and everyone enjoyed the bustle.`;
    }
    if (id === 'scholars') {
      this.pay(cost);
      this.d.eras?.()?.hurry(1);
      return `${st.name} invited scholars and engineers to town. The next era is a year closer.`;
    }
    if (id === 'parade') {
      const m = war.military;
      const xp = Math.round(this.drillXp(f) / 2);
      const fit = m.fit();
      for (const s of fit) s.xp += xp;
      dec?.state.effects.push({ amount: 0.015 * f, until: now + 2, id: 'parade' });
      return `${st.name} held a parade: ${fit.length} soldier${fit.length === 1 ? '' : 's'} marched (+${xp} experience) and the town cheered.`;
    }
    if (id === 'supply') {
      this.pay(cost);
      const m = war.military;
      let patched = 0;
      let hp = Math.round(300 * f * (this.up.inspect ?? 1));
      for (const s of m.damaged().sort((a, b) => a.hp / maxHpOf(a.type, a.level) - b.hp / maxHpOf(b.type, b.level))) {
        if (hp <= 0) break;
        const n = Math.min(hp, Math.max(0, maxHpOf(s.type, s.level) - s.hp));
        s.hp += n;
        hp -= n;
        if (n > 0) patched++;
      }
      return `${st.name} resupplied the defences: ${patched} mended.`;
    }
    if (id === 'summit') {
      const dip = war.diplomacy;
      const list = war.world.neighbours;
      for (const n of list) {
        const r = dip.rel(n.id);
        r.trust = clamp(r.trust + this.trustGain(f, n) / 2, -100, 100);
        dip.note?.(n.id, `Mayor ${st.name} hosted a summit.`);
      }
      return `${st.name} hosted a summit. ${list.length === 1 ? list[0].entry.name : 'The neighbouring towns'} trust${list.length === 1 ? 's' : ''} you a little more.`;
    }
    if (id === 'gift') {
      this.pay(cost);
      const n = this.neighbour();
      const dip = war.diplomacy;
      const r = dip.rel(n.id);
      const gain = this.trustGain(f, n) * 1.6;
      r.trust = clamp(r.trust + gain, -100, 100);
      r.grievance = Math.max(0, (r.grievance || 0) - 10 * f);
      dip.note?.(n.id, `Mayor ${st.name} sent ${n.entry.name} a gift.`);
      return `${st.name} sent a gift to ${n.entry.name}. Their trust in you rose by ${Math.round(gain)}.`;
    }
    return '';
  }

  note(text) {
    const st = this.state;
    st.log.unshift({ day: this.city.day, text });
    if (st.log.length > LOG_KEEP) st.log.length = LOG_KEEP;
  }
}
