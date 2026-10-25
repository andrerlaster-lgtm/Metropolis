// Life Story: one resident's life, played through text events. The character's state is saved in
// city.systems.life; their home and job are real tiles in the city, so building choices shape the
// events, schooling and careers they get.

import { STRUCTURES, DAY_LENGTH_SECONDS } from './config.js';
import { hasEntrance } from './labor.js';
import { FIRST_NAMES, LAST_NAMES, PRONOUNS, CAREERS, stageFor } from './lifeData.js';
import { pickEvent, isEligible, fill, choicesFor, rollOutcome, applyEffects, chooseByPolicy, STAT_KEYS } from './lifeEngine.js';
import { LIFE_EVENTS } from './lifeEvents.js';
import { ACTIVITIES, energyFor, pickRotation, ROTATION_SIZE } from './lifeActivities.js';
import { ACHIEVEMENTS, ribbonFor } from './lifeAchievements.js';
import { pick, hash2 } from './utils.js';
import { addressOf } from './streets.js';
import { Legacy, originWords } from './legacy.js';
import { ERAS, yearOf } from './eras.js';

// One year of life passes per in-game day; Age up skips ahead.
export const YEAR_SECONDS = DAY_LENGTH_SECONDS;
const MAX_LOG = 200;
// Big life choices auto mode never makes for you: which job to take, which home to buy.
const PLAYER_ONLY = new Set(['job_hunt', 'buy_home']);
const FALLBACKS = new Set(['job', 'work', 'a classmate', 'someone special', 'the little one', 'the baby']);
const CITY_TIER = 3; // the "City" milestone, for the Watched it grow achievement

// Home prices follow desirability; towers are flats, so cheaper.
export function homePrice(tile) {
  const base = tile.structure.type === 'tower' ? 26000 : 38000;
  return Math.round((base * (0.6 + tile.desirability)) / 500) * 500;
}

// Each lived-in home is home to the same family every time: names come from its position.
export function familyAt(tile) {
  const last = LAST_NAMES[Math.floor(hash2(tile.x, tile.y, 77) * LAST_NAMES.length)];
  const first = FIRST_NAMES[Math.floor(hash2(tile.x, tile.y, 78) * FIRST_NAMES.length)];
  return { family: `the ${last} family`, person: `${first} ${last}`, x: tile.x, y: tile.y, address: addressOf(tile) };
}

export class LifeSystem {
  constructor(city, { rng = Math.random, events = LIFE_EVENTS } = {}) {
    this.city = city;
    this.rng = rng;
    this.events = events;
    this.legacy = new Legacy(city); // the family line's memory across generations
    // Set by the game (main.js) so events can reach the town: { mayor, economy, decisions, war }, each () → system.
    this.hooks = {};
  }

  get state() {
    return this.city.systems.life || null;
  }

  get char() {
    return this.state?.char || null;
  }

  // ---- Creating a life ---------------------------------------------------

  randomName() {
    return { first: pick(FIRST_NAMES, this.rng), last: pick(LAST_NAMES, this.rng) };
  }

  // Born as a baby into a family living in one of the city's homes.
  create({ first, last, pronouns = 'they', look, traits = [] }, parentsOverride = null) {
    const rng = this.rng;
    const r = (a, b) => a + Math.floor(rng() * (b - a + 1));
    const home = this.bestHome({ occupiedOk: true, preferOccupied: true });
    const parentName = () => `${pick(FIRST_NAMES, rng)} ${last}`;
    const prev = this.state;
    const char = {
      first,
      last,
      pronouns: PRONOUNS[pronouns] ? pronouns : 'they',
      look,
      traits: traits.slice(0, 2),
      age: 0,
      yearProgress: 0,
      stats: { happiness: r(70, 85), health: r(70, 90), smarts: r(35, 60), looks: r(40, 75) },
      money: 0,
      home: home ? { x: home.x, y: home.y } : null,
      livesWithParents: true,
      family: parentsOverride || {
        mother: { name: parentName(), closeness: r(65, 90), age: r(24, 36), alive: true },
        father: { name: parentName(), closeness: r(60, 90), age: r(25, 38), alive: true },
      },
      siblings: [],
      friends: [],
      partner: null,
      children: [],
      job: null,
      flags: { townTier: this.city.systems.milestones?.reached ?? 0 },
      seen: {},
      energy: 0,
      activityCount: 0,
      log: [],
      plan: [],
      pending: null,
      alive: true,
      death: null,
      generation: (prev?.char?.generation || 0) + 1,
    };
    this.city.systems.life = { char, history: prev?.history || [], achievements: prev?.achievements || {} };
    const where = home ? `a ${STRUCTURES[home.structure.type].label.toLowerCase()} at ${addressOf(home)}` : 'a city with no homes yet';
    this.log(`${first} ${last} was born in ${where}.`);
    this.planYear();
    this.checkAchievements();
    this.city.emit('lifeChanged');
    return char;
  }

  // Who carries the family story on: the oldest living child, or else a niece or nephew.
  heir() {
    const parent = this.char;
    if (!parent) return null;
    const kid = parent.children?.find((c) => c.alive !== false);
    if (kid) return { ...kid, relation: { she: 'daughter', he: 'son' }[kid.pronouns] || 'child' };
    const pronouns = pick(['she', 'he', 'they'], this.rng);
    return {
      name: `${pick(FIRST_NAMES, this.rng)} ${parent.last}`,
      age: 18 + Math.floor(this.rng() * 8),
      pronouns,
      look: parent.look,
      relation: { she: 'niece', he: 'nephew' }[pronouns] || 'young relative',
      relative: true,
    };
  }

  // Keep playing as your oldest child after a life ends, or a niece or nephew if there are no children,
  // so the family's story goes on generation after generation.
  continueAsChild() {
    const s = this.state;
    const parent = s?.char;
    if (!parent || parent.alive) return null;
    const kid = this.heir();
    if (!kid) return null;
    s.history.push(summaryOf(parent));
    const otherParent = parent.partner ? { name: parent.partner.name, closeness: 70, age: parent.age, alive: true } : null;
    const family = {
      mother: { name: `${parent.first} ${parent.last}`, closeness: 80, age: parent.age, alive: false },
      father: otherParent || { name: `${pick(FIRST_NAMES, this.rng)} ${parent.last}`, closeness: 50, age: parent.age, alive: false },
    };
    const char = this.create({ first: kid.name.split(' ')[0], last: parent.last, pronouns: kid.pronouns, look: kid.look || parent.look, traits: parent.traits }, family);
    char.age = kid.age;
    char.livesWithParents = kid.age < 18;
    char.money = Math.round(parent.money * 0.6);
    char.home = parent.home;
    char.energy = energyFor(char.age);
    if (parent.flags.ownsHome) char.flags.ownsHome = true; // the family home is inherited
    char.log = [];
    if (kid.relative) char.livesWithParents = false;
    char.heirOf = { name: `${parent.first} ${parent.last}`, relation: kid.relation };
    this.log(`${char.first}, ${parent.first}'s ${kid.relation}, carries on the ${parent.last} family story, inheriting $${char.money.toLocaleString()}.`);
    this.planYear();
    this.city.emit('lifeChanged');
    return char;
  }

  // ---- Time --------------------------------------------------------------

  // Background aging. Life time stops while an event waits for an answer.
  update(dt) {
    const c = this.char;
    if (!c || !c.alive || c.pending) return;
    if (c.flags.townTier == null) c.flags.townTier = this.city.systems.milestones?.reached ?? 0; // older saves
    c.yearProgress += dt / YEAR_SECONDS;
    while (c.plan.length && c.yearProgress >= c.plan[0] && !c.pending) {
      c.plan.shift();
      this.fireEvent();
    }
    if (!c.pending && c.yearProgress >= 1) this.birthday();
  }

  // Skip to the next birthday; the new year's first event shows straight away.
  ageUp() {
    const c = this.char;
    if (!c || !c.alive || c.pending) return false;
    this.birthday();
    if (c.alive && c.plan.length) {
      c.plan.shift();
      this.fireEvent();
    }
    return true;
  }

  birthday() {
    const c = this.char;
    c.age += 1;
    c.yearProgress = 0;
    c.energy = energyFor(c.age);
    c.yearActs = {};
    this.rotate(true);
    this.yearly();
    if (c.alive) {
      this.planYear();
      this.checkAchievements();
    }
    this.city.emit('lifeChanged');
  }

  planYear() {
    const c = this.char;
    const n = c.age < 3 ? (this.rng() < 0.7 ? 1 : 0) : 1 + (this.rng() < 0.5 ? 1 : 0);
    c.plan = Array.from({ length: n }, () => 0.15 + this.rng() * 0.75).sort((a, b) => a - b);
  }

  // Yearly drift: school, health, money, family, and keeping home and job in sync with the city.
  yearly() {
    const c = this.char;
    const f = this.facts();
    const has = (t) => c.traits.includes(t);
    for (const k of c.children) k.age += 1;
    for (const s of c.siblings || []) s.age += 1;
    for (const p of [c.family.mother, c.family.father]) {
      if (!p?.alive) continue;
      p.age += 1;
      if (p.age > 72 && this.rng() < ((p.age - 72) / 30) ** 2) {
        p.alive = false;
        c.stats.happiness = Math.max(0, c.stats.happiness - 12);
        this.log(`${p.name} passed away at ${p.age}.`);
      }
    }

    if (c.age >= 6 && c.age <= 17) c.stats.smarts += (f.schoolCoverage > 0.25 ? 3 : 1) + (has('curious') ? 1 : 0);
    let dHealth = 0;
    if (c.age >= 50) dHealth -= 1 + Math.floor((c.age - 50) / 12);
    if (f.clinicCoverage > 0.25) dHealth += 1;
    if (f.greenery > 0.15) dHealth += 1;
    if (has('sporty')) dHealth += 1;
    c.stats.health += dHealth;
    if (c.age > 55) c.stats.looks -= 1;
    const target = 35 + f.desirability * 40 + (c.job ? 6 : 0) + (c.partner ? 6 : 0) + Math.min(10, c.friends.length * 3);
    const pull = has('calm') ? 0.25 : 0.15;
    c.stats.happiness += (target - c.stats.happiness) * pull;
    for (const k of ['happiness', 'health', 'smarts', 'looks']) c.stats[k] = Math.max(0, Math.min(100, Math.round(c.stats[k])));
    for (const fr of c.friends) fr.closeness = Math.max(0, fr.closeness - 2);

    // Money: savings from work, minus rent once living alone.
    if (c.job) {
      const career = CAREERS[c.job.type];
      const pay = career.pay[c.job.level] || career.pay[0];
      c.money += Math.round(pay * (has('thrifty') ? 0.25 : 0.15));
      c.job.years += 1;
    } else if (c.flags.partTime && c.age < 18) c.money += 1500;
    if (!c.livesWithParents && !c.job) c.money = Math.max(0, c.money - 3000);

    // Family: grown-ups tend to meet someone and have children, so the story can pass down the line.
    if (!c.partner && c.age >= 20 && c.age <= 45 && this.rng() < (c.traits.includes('outgoing') ? 0.24 : 0.16)) {
      c.partner = { name: `${pick(FIRST_NAMES, this.rng)} ${pick(LAST_NAMES, this.rng)}`, closeness: 70, married: false };
      this.log(`${c.first} fell in love with ${c.partner.name}.`);
    } else if (c.partner && !c.partner.married && c.age >= 22 && this.rng() < 0.3) {
      c.partner.married = true;
      this.log(`${c.first} married ${c.partner.name}.`);
    } else if (c.partner && c.age >= 22 && c.age <= 44 && c.children.length < 3 && this.rng() < (c.children.length ? 0.14 : 0.28)) {
      const pronouns = pick(['she', 'he', 'they'], this.rng);
      const kid = { name: `${pick(FIRST_NAMES, this.rng)} ${c.last}`, age: 0, pronouns, alive: true, look: c.look };
      c.children.push(kid);
      this.log(`${c.first} and ${c.partner.name.split(' ')[0]} welcomed a baby, ${kid.name.split(' ')[0]}.`);
    }

    this.syncWithCity();

    // Old age.
    const risk = c.age >= 65 ? ((c.age - 65) / 35) ** 3 * (1.3 - c.stats.health / 100) : 0;
    if (c.stats.health <= 0 || this.rng() < risk) this.die(c.stats.health <= 0 ? 'ill health' : 'old age');
  }

  // The city can change under a life: bulldozed homes and workplaces. Called yearly and after edits.
  syncWithCity() {
    const c = this.char;
    if (!c?.alive) return;
    if (c.job) {
      const t = this.city.getTile(c.job.x, c.job.y);
      if (t?.structure?.type !== c.job.type) {
        this.log(`The ${c.job.type} where ${c.first} worked closed down.`);
        c.stats.happiness = Math.max(0, c.stats.happiness - 8);
        c.job = null;
      }
    }
    const home = c.home && this.city.getTile(c.home.x, c.home.y);
    if (!home?.structure || !STRUCTURES[home.structure.type].capacity) {
      const next = this.bestHome({ occupiedOk: c.livesWithParents });
      if (next) {
        c.home = { x: next.x, y: next.y };
        this.log(`${c.first}'s home was demolished. ${c.livesWithParents ? 'The family' : c.first} moved to ${addressOf(next)}.`);
      } else {
        c.home = null;
        this.log(`${c.first}'s home was demolished and there was nowhere free to move.`);
      }
      c.stats.happiness = Math.max(0, c.stats.happiness - 6);
    }
  }

  die(cause) {
    const c = this.char;
    this.checkAchievements();
    const ribbon = ribbonFor(c);
    c.ribbon = { id: ribbon.id, label: ribbon.label, color: ribbon.color };
    c.alive = false;
    c.death = { age: c.age, cause };
    c.plan = [];
    c.pending = null;
    this.log(`${c.first} ${c.last} died of ${cause} at ${c.age}.`);
    this.city.emit('lifeChanged');
  }

  // ---- Events ------------------------------------------------------------

  // The next event: a consequence that has come due for this family comes first (legacy.js), then
  // one picked at random, less likely the more recently the family lived through it or its kind.
  fireEvent(forceId = null, echo = null) {
    const c = this.char;
    const ctx = this.ctx();
    let ev = forceId ? this.events.find((e) => e.id === forceId) : null;
    if (!ev && !forceId) {
      for (const entry of this.legacy.due(c.last)) {
        const due = this.events.find((e) => e.id === entry.id);
        if (!due) {
          this.legacy.take(entry);
          continue;
        }
        ctx.echo = entry;
        if (!isEligible(due, ctx, { allowScheduled: true })) continue;
        this.legacy.take(entry);
        ev = due;
        echo = entry;
        break;
      }
      ctx.echo = echo;
      if (!ev) ev = pickEvent(this.events, ctx, this.rng, (e) => this.legacy.weightFor(e));
    }
    if (!ev) return null;
    ctx.echo = echo;
    c.seen[ev.id] = c.age;
    this.legacy.note(ev);
    c.pending = { id: ev.id, age: c.age, choices: choicesFor(ev, ctx), ...(echo ? { echo } : {}) };
    this.city.emit('lifeEvent', { id: ev.id });
    return c.pending;
  }

  // Answer the waiting event by a policy ('safe', 'bold' or 'focus' with stat weights), for auto mode.
  // Events opened by an activity (job hunting, buying a home) are left to the player.
  autoChoice(policy, weights = {}) {
    const p = this.char?.pending;
    if (!p) return null;
    const ev = this.events.find((e) => e.id === p.id);
    if (!ev || ev.manual || PLAYER_ONLY.has(ev.id)) return null;
    return chooseByPolicy(ev, p.choices.length, this.ctx(), policy, weights);
  }

  // What the event card shows for the waiting event.
  current() {
    const c = this.char;
    if (!c?.pending) return null;
    const ev = this.events.find((e) => e.id === c.pending.id);
    if (!ev) {
      c.pending = null;
      return null;
    }
    const vars = this.vars();
    const ctx = this.ctx();
    const textOf = (v) => fill(typeof v === 'function' ? v(ctx) : v, vars);
    return {
      id: ev.id,
      title: ev.title ? textOf(ev.title) : null,
      text: textOf(ev.text),
      choices: c.pending.choices.map((ch) => fill(ch.label, vars)),
      category: ev.category || null,
      echo: c.pending.echo ? { from: originWords(c.pending.echo.origin, c), year: c.pending.echo.origin?.year ?? null } : null,
    };
  }

  choose(index) {
    const c = this.char;
    const p = c?.pending;
    if (!p || !p.choices[index]) return null;
    const ev = this.events.find((e) => e.id === p.id);
    const ctx = this.ctx();
    const choice = p.choices[index];
    const outcome = rollOutcome(ev, choice.index, choice.data, ctx, this.rng) || { text: 'Life goes on.' };
    const before = this.vars();
    const changes = applyEffects(outcome.effects, ctx);
    if (outcome.do) outcome.do(ctx, choice.data);
    const text = fill(outcome.text, mergeVars(before, this.vars()));
    this.log(text);
    // Consequences that come back years (or generations) later.
    for (const l of [].concat(outcome.later || [])) {
      this.legacy.schedule(l.event, l.years, { data: l.data ?? null, origin: { name: `${c.first} ${c.last}`, gen: c.generation || 1, year: yearOf(this.city) }, family: c.last, rng: this.rng });
    }
    c.pending = null;
    if (outcome.next) this.fireEvent(outcome.next);
    this.checkAchievements();
    this.city.emit('lifeChanged');
    return { text, changes };
  }

  // ---- Activities ----------------------------------------------------------------

  // This year's rotating activities, saved on the character (c.offered = { age, ids }). Chosen from
  // the ones that suit their age and town now, favouring any they weren't offered last year. A save
  // from before this existed gets its first rotation the first time it's asked.
  rotate(force = false) {
    const c = this.char;
    if (!c?.alive) return [];
    if (!force && c.offered?.age === c.age && Array.isArray(c.offered.ids)) return c.offered.ids;
    const ctx = this.ctx();
    const fits = ACTIVITIES.filter((a) => !a.essential && c.age >= (a.minAge ?? 0) && c.age <= (a.maxAge ?? 200) && (!a.when || a.when(ctx)));
    c.offered = { age: c.age, ids: pickRotation(fits, c.offered?.ids || [], ROTATION_SIZE, this.rng) };
    return c.offered.ids;
  }

  // What the character could do right now, with labels filled in and a reason when blocked.
  activities() {
    const c = this.char;
    if (!c?.alive) return [];
    const ctx = this.ctx();
    const offered = this.rotate();
    const vars = this.vars();
    const energy = c.energy ?? energyFor(c.age);
    return ACTIVITIES.filter((a) => c.age >= (a.minAge ?? 0) && c.age <= (a.maxAge ?? 200) && (a.essential || offered.includes(a.id)) && (!a.when || a.when(ctx))).map((a) => {
      const cost = a.cost ? a.cost(ctx) : 0;
      let blocked = null;
      if (c.pending) blocked = 'An event is waiting';
      else if (energy <= 0) blocked = 'No energy left this year';
      else if (cost > c.money) blocked = `Needs $${cost.toLocaleString()}`;
      return { id: a.id, group: a.group, label: fill(a.label(ctx), vars), hint: a.hint ? fill(a.hint(ctx), vars) : '', cost, blocked };
    });
  }

  // Run an activity. Returns { text, changes } for the outcome card, { launched } when it opened an
  // event card instead, or null if it can't be done.
  doActivity(id) {
    const c = this.char;
    const a = ACTIVITIES.find((x) => x.id === id);
    const offer = this.activities().find((x) => x.id === id);
    if (!a || !offer || offer.blocked) return null;
    const ctx = this.ctx();
    const result = a.run(ctx, this.rng);
    c.energy = (c.energy ?? energyFor(c.age)) - 1;
    c.activityCount = (c.activityCount || 0) + 1;
    c.yearActs = c.yearActs || {};
    const repeats = c.yearActs[id] || 0;
    c.yearActs[id] = repeats + 1;
    if (result.launch) {
      if (offer.cost) c.money = Math.max(0, c.money - offer.cost);
      this.fireEvent(result.launch);
      this.city.emit('lifeChanged');
      return { launched: result.launch };
    }
    const before = this.vars();
    // Diminishing returns: gains shrink as a stat gets high, and doing the same thing twice in a
    // year helps less, so a life can't be maxed out by repeating one activity.
    const effects = { ...result.effects, money: (result.effects?.money || 0) - offer.cost };
    for (const k of STAT_KEYS) {
      if (!(effects[k] > 0)) continue;
      effects[k] = Math.round((effects[k] * Math.max(0, 1 - c.stats[k] / 110)) / (1 + repeats));
    }
    const changes = applyEffects(effects, ctx);
    if (result.do) result.do(ctx);
    const text = fill(result.text, mergeVars(before, this.vars()));
    this.log(text);
    this.checkAchievements();
    this.city.emit('lifeChanged');
    return { text, changes };
  }

  // ---- Achievements ----------------------------------------------------------------

  // Achievements are kept across lives in city.systems.life.achievements. Returns the new ones.
  checkAchievements() {
    const s = this.state;
    const c = s?.char;
    if (!c) return [];
    s.achievements = s.achievements || {};
    const f = this.facts();
    const earned = [];
    for (const a of ACHIEVEMENTS) {
      if (s.achievements[a.id] || !a.test(c, f)) continue;
      s.achievements[a.id] = { by: `${c.first} ${c.last}`, age: c.age };
      earned.push(a);
      this.city.emit('achievement', { achievement: a });
    }
    return earned;
  }

  // ---- Helpers events use --------------------------------------------------

  log(text) {
    const c = this.char;
    c.log.unshift({ age: c.age, text });
    if (c.log.length > MAX_LOG) c.log.length = MAX_LOG;
  }

  vars() {
    const c = this.char;
    const pr = PRONOUNS[c.pronouns];
    const friend = [...c.friends].sort((a, b) => b.closeness - a.closeness)[0];
    return {
      name: c.first,
      fullname: `${c.first} ${c.last}`,
      last: c.last,
      age: c.age,
      they: pr.they,
      them: pr.them,
      their: pr.their,
      mother: c.family.mother?.name.split(' ')[0] || 'Mum',
      father: c.family.father?.name.split(' ')[0] || 'Dad',
      friend: friend?.name.split(' ')[0] || 'a classmate',
      partner: c.partner?.name.split(' ')[0] || 'someone special',
      child: c.children[0]?.name.split(' ')[0] || 'the little one',
      sibling: c.siblings?.[0]?.name.split(' ')[0] || 'the baby',
      money: `$${c.money.toLocaleString()}`,
      neighbour: this.neighbour()?.family || 'the neighbours',
      neighbourperson: this.neighbour()?.person || 'a neighbour',
      nspot: this.neighbour()?.address || 'next door',
      address: c.home ? addressOf(this.city.getTile(c.home.x, c.home.y)) : 'no fixed address',
      job: c.job ? CAREERS[c.job.type].titles[c.job.level].toLowerCase() : 'job',
      workplace: c.job ? STRUCTURES[c.job.type].label.toLowerCase() : 'work',
      year: yearOf(this.city),
      era: this.era().label.toLowerCase(),
      town: this.city.systems.world?.home?.name || 'town',
      who: originWords(c.pending?.echo?.origin, c),
      heirloom: this.legacy.state.heirlooms.at(-1)?.name || 'the old family keepsake',
      rival: this.legacy.recall('rival') || 'the rival family',
      neighbourtown: this.hooks.war?.()?.world?.neighbours?.[0]?.entry.name || 'the next town',
    };
  }

  // City facts for the character's home and job.
  facts() {
    const c = this.char;
    const home = c?.home && this.city.getTile(c.home.x, c.home.y);
    const jam = (t) => {
      if (!t) return 0;
      let worst = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) worst = Math.max(worst, this.city.getTile(t.x + dx, t.y + dy)?.congestion || 0);
      return worst;
    };
    const work = c?.job && this.city.getTile(c.job.x, c.job.y);
    return {
      home,
      schoolCoverage: home?.coverage?.school || 0,
      clinicCoverage: home?.coverage?.health || 0,
      greenery: home?.factors?.greenery || 0,
      desirability: home?.desirability ?? 0.4,
      commuteJam: Math.max(jam(home), jam(work)),
      cityHappiness: (this.city.stats.happiness || 50) / 100,
    };
  }

  // Workplaces with free positions, nearest first.
  openJobs() {
    const c = this.char;
    const from = c.home || { x: this.city.width / 2, y: this.city.height / 2 };
    return this.city
      .workplaces()
      .filter((w) => CAREERS[w.structure.type] && hasEntrance(this.city, w) && w.workersFilled < STRUCTURES[w.structure.type].jobs) // a road isn't needed: people walk
      .filter((w) => !(c.job && c.job.x === w.x && c.job.y === w.y))
      .sort((a, b) => Math.abs(a.x - from.x) + Math.abs(a.y - from.y) - (Math.abs(b.x - from.x) + Math.abs(b.y - from.y)));
  }

  // Homes with room, most desirable first.
  openHomes() {
    const c = this.char;
    return this.city
      .homes()
      .filter((h) => h.structure.residents < STRUCTURES[h.structure.type].capacity)
      .filter((h) => !(c?.home && c.home.x === h.x && c.home.y === h.y))
      .sort((a, b) => b.desirability - a.desirability);
  }

  // The nearest lived-in home to the character's own, as a named family.
  neighbour() {
    const c = this.char;
    if (!c?.home) return null;
    let best = null;
    let bestD = Infinity;
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        if (!dx && !dy) continue;
        const t = this.city.getTile(c.home.x + dx, c.home.y + dy);
        if (!t?.structure || !STRUCTURES[t.structure.type].capacity || t.structure.residents <= 0) continue;
        const d = Math.abs(dx) + Math.abs(dy);
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
    }
    return best ? familyAt(best) : null;
  }

  // The nearest structure of the given type(s) to home, within `max` tiles (straight-line).
  nearest(types, max = 8) {
    const c = this.char;
    const from = c?.home || { x: this.city.width / 2, y: this.city.height / 2 };
    const want = Array.isArray(types) ? types : [types];
    let best = null;
    let bestD = Infinity;
    for (const t of this.city.tiles) {
      if (!t.structure || !want.includes(t.structure.type)) continue;
      const d = Math.hypot(t.x - from.x, t.y - from.y);
      if (d <= max && d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  // Homes with room that the character could buy, cheapest first, with prices.
  homesForSale() {
    return this.openHomes()
      .map((tile) => ({ tile, price: homePrice(tile) }))
      .sort((a, b) => a.price - b.price);
  }

  bestHome({ occupiedOk = false, preferOccupied = false } = {}) {
    const homes = this.city.homes().sort((a, b) => b.desirability - a.desirability);
    if (preferOccupied) {
      const lived = homes.find((h) => h.structure.residents > 0);
      if (lived) return lived;
    }
    return this.openHomes()[0] || (occupiedOk ? homes[0] : null) || null;
  }

  era() {
    return ERAS[Math.min(ERAS.length - 1, Math.max(0, this.city.systems.era?.index ?? 0))];
  }

  // Who leads the town, as seen from the character: 'you', 'family' (a parent or relative stands in) or null.
  leader() {
    const st = this.hooks.mayor?.()?.state;
    if (!st || !this.char) return null;
    if (st.who === 'you') return 'you';
    if (st.who === 'father' || st.who === 'regent') return 'family';
    return null;
  }

  // The town as events see it.
  townFacts() {
    const war = this.hooks.war?.();
    const s = this.city.stats || {};
    const n = war?.world?.neighbours || [];
    const atWar = !!war?.diplomacy && n.some((t) => war.diplomacy.atWar(t.id));
    if (atWar) this.legacy.remember('sawWar'); // for the peace parade when it ends
    return {
      population: s.population || 0,
      happiness: s.happiness ?? 50,
      employment: s.employment ?? 1,
      money: this.hooks.economy?.()?.money ?? this.city.systems.economy?.money ?? 0,
      atWar,
      hasBase: !!war?.military,
      has: (type) => this.city.tiles.some((t) => t.structure?.type === type),
    };
  }

  // Effects on the whole town from a life event: { money, spirit: [amount, days], trust, soldierXp }.
  // Returns the changes to show on the outcome card. Anything the game hasn't connected is skipped.
  townEffect(t) {
    const out = [];
    const eco = this.hooks.economy?.();
    if (t.money && eco) {
      const st = eco.state;
      const n = t.money < 0 ? -Math.min(st.money, -t.money) : t.money;
      st.money += n;
      if (n > 0) st.today.income += n;
      else st.today.expenses -= n;
      if (n) out.push({ key: 'town', label: 'Town money', delta: n, money: true });
    }
    const dec = this.hooks.decisions?.();
    if (t.spirit && dec) {
      dec.state.effects.push({ amount: t.spirit[0], until: this.city.day + this.city.clock + t.spirit[1], id: 'life' });
      out.push({ key: 'town', label: 'Town happiness', delta: Math.round(t.spirit[0] * 100), pct: true });
    }
    const war = this.hooks.war?.();
    const nb = war?.world?.neighbours?.[0];
    if (t.trust && war?.diplomacy && nb) {
      const r = war.diplomacy.rel(nb.id);
      r.trust = Math.max(-100, Math.min(100, r.trust + t.trust));
      out.push({ key: 'town', label: `Trust with ${nb.entry.name}`, delta: t.trust });
    }
    if (t.soldierXp && war?.military) {
      for (const s of war.military.fit()) s.xp += t.soldierXp;
      out.push({ key: 'town', label: 'Soldier experience', delta: t.soldierXp });
    }
    return out;
  }

  ctx() {
    const c = this.char;
    const life = this;
    return {
      char: c,
      city: this.city,
      rng: this.rng,
      facts: this.facts(),
      era: this.era(),
      year: yearOf(this.city),
      leader: this.leader(),
      town: this.townFacts(),
      legacy: this.legacy,
      echo: c?.pending?.echo || null,
      townEffect: (t) => life.townEffect(t),
      has: (t) => c.traits.includes(t),
      person(who) {
        if (who === 'mother' || who === 'father') return c.family[who]?.alive ? c.family[who] : null;
        if (who === 'partner') return c.partner;
        if (who === 'friend') return [...c.friends].sort((a, b) => b.closeness - a.closeness)[0] || null;
        if (who === 'child') return c.children[0] || null;
        if (who === 'sibling') return c.siblings?.[0] || null;
        return null;
      },
      addFriend(closeness = 55, known = null) {
        const name = known || `${pick(FIRST_NAMES, life.rng)} ${pick(LAST_NAMES, life.rng)}`;
        const existing = c.friends.find((f) => f.name === name);
        if (existing) {
          existing.closeness = Math.min(100, existing.closeness + 10);
          return name;
        }
        c.friends.push({ name, closeness });
        if (c.friends.length > 6) c.friends.sort((a, b) => b.closeness - a.closeness).length = 6;
        return name;
      },
      setPartner(closeness = 60) {
        c.partner = { name: `${pick(FIRST_NAMES, life.rng)} ${pick(LAST_NAMES, life.rng)}`, closeness, married: false };
        return c.partner.name;
      },
      addChild() {
        const pronouns = pick(['she', 'he', 'they'], life.rng);
        const kid = { name: `${pick(FIRST_NAMES, life.rng)} ${c.last}`, age: 0, pronouns, alive: true, look: c.look };
        c.children.push(kid);
        return kid.name;
      },
      addSibling(pronouns = pick(['she', 'he', 'they'], life.rng)) {
        c.siblings = c.siblings || [];
        const sib = { name: `${pick(FIRST_NAMES, life.rng)} ${c.last}`, age: 0, pronouns, closeness: 70, alive: true };
        c.siblings.push(sib);
        return sib.name;
      },
      markTownTier() {
        const tier = life.city.systems.milestones?.reached ?? 0;
        c.flags.townTier = tier;
        if (tier >= CITY_TIER) c.flags.sawCity = true;
      },
      neighbour: () => life.neighbour(),
      nearest: (types, max) => life.nearest(types, max),
      nearestWater(r = 6) {
        const h = c.home;
        if (!h) return null;
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (life.city.getTile(h.x + dx, h.y + dy)?.terrain === 'water') return { x: h.x + dx, y: h.y + dy };
        return null;
      },
      homesForSale: () => life.homesForSale(),
      moveTo(tile) {
        c.home = { x: tile.x, y: tile.y };
        c.livesWithParents = false;
      },
      takeJob(tile) {
        c.job = { type: tile.structure.type, x: tile.x, y: tile.y, level: 0, years: 0 };
      },
      loseJob() {
        c.job = null;
      },
      openJobs: () => life.openJobs(),
      openHomes: () => life.openHomes(),
    };
  }
}

// Name things as they were before a choice (the job just left), plus anything new (a baby's name).
function mergeVars(before, after) {
  const vars = { ...after };
  for (const k of Object.keys(before)) if (FALLBACKS.has(after[k]) && !FALLBACKS.has(before[k])) vars[k] = before[k];
  return vars;
}

export function summaryOf(c) {
  return {
    name: `${c.first} ${c.last}`,
    age: c.death?.age ?? c.age,
    job: c.job ? CAREERS[c.job.type].titles[c.job.level] : null,
    money: c.money,
    children: c.children.length,
    generation: c.generation,
    ribbon: c.ribbon || null,
  };
}

export function lifeStage(c) {
  return stageFor(c.age);
}
