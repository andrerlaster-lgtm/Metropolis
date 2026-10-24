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

export const MAYOR_VERSION = 1;
export const ACTIONS_PER_DAY = 3;
export const ADULT = 18;
const LOG_KEEP = 30;
const SKILL_GAIN = 2;

export const SKILL_LABELS = { charisma: 'Charisma', business: 'Business', command: 'Command', diplomacy: 'Diplomacy' };

// What each duty does; `skill` is the one that makes it work better and grows when it's used.
export const DUTIES = [
  { id: 'speech', skill: 'charisma', name: 'Give a speech', text: 'Homes all over town are happier for two days.' },
  { id: 'fundraiser', skill: 'business', name: 'Hold a fundraiser', text: 'Money for the town, more as it grows.' },
  { id: 'inspect', skill: 'command', name: 'Inspect the base', text: 'Soldiers gain experience and damaged defences get patched up.' },
  { id: 'envoy', skill: 'diplomacy', name: 'Meet a neighbour’s mayor', text: 'They trust you more and hold fewer grudges.' },
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
    const base = { v: MAYOR_VERSION, day: Math.floor(day(this.city)), actions: ACTIONS_PER_DAY, done: {}, log: [] };
    if (c && f?.alive) return { ...base, who: 'father', name: f.name, age: f.age, gen: c.generation || 1, skills: this.randomSkills() };
    if (c) return { ...base, ...this.successor(c) };
    return { ...base, who: 'founder', name: `${pick(FIRST_NAMES, this.rand)} Hale`, age: 45, gen: 0, skills: this.randomSkills() };
  }

  // Who leads next: your main person if they're an adult, or a relative standing in until they are.
  successor(c) {
    if (c?.alive && c.age >= ADULT) return { who: 'you', name: fullName(c), age: c.age, gen: c.generation || 1, skills: this.skillsOf(c) };
    const pronoun = this.rand() < 0.5 ? 'she' : 'he';
    return {
      who: 'regent',
      name: `${pick(FIRST_NAMES, this.rand)} ${c?.last || 'Hale'}`,
      relation: pronoun === 'she' ? 'aunt' : 'uncle',
      age: 40 + Math.floor(this.rand() * 15),
      gen: c?.generation || 1,
      skills: this.randomSkills(),
    };
  }

  // A new leader takes office; the day's actions start fresh.
  install(next, why) {
    const st = this.state;
    const before = st.name;
    const quiet = st.who === 'founder'; // a new town's first family taking office isn't news
    Object.assign(st, { relation: undefined, ...next, actions: ACTIONS_PER_DAY, done: {} });
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
      st.actions = ACTIONS_PER_DAY;
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
    if (st.done[id]) return 'Already done today';
    if (st.actions <= 0) return 'No actions left today. More tomorrow';
    if (id === 'inspect' && !this.d.war?.()?.military) return 'Your town has no base yet';
    if (id === 'envoy' && !this.neighbour()) return 'There’s no neighbouring town';
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
    return '';
  }

  speechAmount(f) {
    return 0.02 * f;
  }
  fundsAmount(f, pop) {
    return Math.round(((100 + 1.5 * pop) * f) / 10) * 10;
  }
  drillXp(f) {
    return Math.round(8 * f);
  }
  trustGain(f, n) {
    const atWar = this.d.war?.()?.diplomacy?.atWar(n.id);
    return 6 * f * (atWar ? 0.5 : 1);
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
      if (dec) dec.state.effects.push({ amount, until: now + 2, id: 'speech' });
      text = `${st.name} gave a rousing speech in the square. Homes are ${Math.round(amount * 100)}% happier for two days.`;
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
      let hp = Math.round(150 * f);
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
    st.actions -= 1;
    st.done[id] = true;
    st.skills[d.skill] = Math.min(100, st.skills[d.skill] + SKILL_GAIN);
    this.note(text);
    return { text };
  }

  note(text) {
    const st = this.state;
    st.log.unshift({ day: this.city.day, text });
    if (st.log.length > LOG_KEEP) st.log.length = LOG_KEEP;
  }
}
