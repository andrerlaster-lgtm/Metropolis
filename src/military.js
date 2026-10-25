// A town's military: its permanent base (a separate map with a command post, defences and rocks),
// its soldiers, and the military budget that pays for all of it. Pure rules, no screen: the base
// screen (militaryUI.js) and battles (battle.js, warRoom.js) go through these methods.
//
//   Budget: a share of the town's daily income moves into the military budget by itself (adjustable,
//   0–50%), and the mayor can move money over in an emergency. Building, upgrades, repairs, recruits
//   and soldiers' pay all come out of it.
//   Base: defences go anywhere outside the enemy's arrival rows and your reinforcement rows, as long
//   as a way stays open from the enemy's edge to the command post (protected routes). Damage stays
//   after a battle; repair crews fix it over time in the order you choose, or you pay to rush it.
//   Soldiers: trained over a few hours, recruited at once in an emergency for more, or hired ready
//   (specialists). Stationed soldiers stand guard at their post; the rest are the reserve you send in
//   as reinforcements. They gain experience, get hurt, recover, and some fall.
//
// Saved in city.systems.military (made the first time it's needed, so older saves just gain it):
//   { v, seed, since, funds, share, unpaid, rocks: [[x, y]], structures: [{ id, type, x, y, level, hp }],
//     soldiers: [{ id, type, name, xp, kills, battles, status, until, post }], fallen, repairOrder,
//     trainingUntil, nextId, log, battle, protectedUntil, raids }

import {
  BASE_W,
  BASE_H,
  ENTRY_ROWS,
  DEPLOY_ROWS,
  HQ_AT,
  DEFENCES,
  BUILDABLE,
  MAX_LEVEL,
  upgradeCost,
  maxHpOf,
  repairRate,
  REPAIR_HP_PER_DAY,
  RUSH_REPAIR,
  ARMY_CAP,
  GARRISON_CAP,
  UNITS,
  EMERGENCY,
  rankOf,
  RANKS,
  SURNAMES,
  INITIALS,
  LIGHT_INJURY_DAYS,
} from './militaryData.js';
import { buildField } from './flowfield.js';
import { mulberry32 } from './utils.js';
import { noEffects } from './skills.js';

const NO_SKILLS = noEffects();

export const MILITARY_VERSION = 1;
export const START_FUNDS = 500;
export const DEFAULT_SHARE = 0.2;
export const MAX_SHARE = 0.5;
const LOG_KEEP = 20;
const FALLEN_KEEP = 30;
const ROCKS = 7;
export const RAID_LEVELS = ['off', 'gentle', 'fierce'];

const now = (city) => city.day + city.clock;
const key = (x, y) => `${x},${y}`;

export function soldierName(rand) {
  return `${INITIALS[Math.floor(rand() * INITIALS.length)]}. ${SURNAMES[Math.floor(rand() * SURNAMES.length)]}`;
}
export function titleOf(s) {
  return `${RANKS[rankOf(s.xp)].short} ${s.name}`;
}

export class Military {
  // economy: the town's Economy (money moves between it and the military budget).
  constructor(city, { economy, rand = Math.random, starter = 3 } = {}) {
    this.city = city;
    this.economy = economy;
    this.rand = rand;
    this.starter = starter;
  }

  get state() {
    const sys = this.city.systems;
    if (!sys.military || typeof sys.military !== 'object' || sys.military.v !== MILITARY_VERSION) sys.military = this.fresh(sys.military);
    return sys.military;
  }

  // A new base: the command post, a few rocks, and a handful of riflemen standing guard.
  fresh(old) {
    if (old && typeof old === 'object' && old.v > MILITARY_VERSION) return old; // a newer version's data is kept as it is
    const seed = Math.floor(this.rand() * 2 ** 31);
    const st = {
      v: MILITARY_VERSION,
      seed,
      since: now(this.city),
      funds: START_FUNDS,
      share: DEFAULT_SHARE,
      unpaid: 0,
      rocks: [],
      structures: [{ id: 1, type: 'hq', x: HQ_AT.x, y: HQ_AT.y, level: 1, hp: maxHpOf('hq') }],
      soldiers: [],
      fallen: [],
      repairOrder: [],
      trainingUntil: 0,
      nextId: 2,
      log: [],
      battle: null,
      protectedUntil: 0,
      raids: 'gentle',
    };
    this.city.systems.military = st;
    const rand = mulberry32(seed);
    for (let i = 0, tries = 0; i < ROCKS && tries < 60; tries++) {
      const x = Math.floor(rand() * BASE_W);
      const y = 4 + Math.floor(rand() * 9);
      if (this.occupied(x, y) || Math.abs(x - HQ_AT.x - 0.5) < 3) continue;
      st.rocks.push([x, y]);
      if (!this.routeOpen()) st.rocks.pop();
      else i++;
    }
    const posts = [
      { x: HQ_AT.x - 0.5, y: HQ_AT.y - 1.5 },
      { x: HQ_AT.x + 2.5, y: HQ_AT.y - 1.5 },
      { x: HQ_AT.x + 1.5, y: HQ_AT.y - 2.5 },
    ];
    for (let i = 0; i < this.starter; i++) {
      const s = this.addSoldier('rifleman', rand);
      s.post = posts[i % posts.length];
    }
    return st;
  }

  get sandbox() {
    return !!this.economy?.sandbox;
  }
  get funds() {
    return this.state.funds;
  }
  // The town's Defence upgrades (skills.js), as the simulation last worked them out.
  get skills() {
    return this.city.derived?.skills || NO_SKILLS;
  }
  defenceCost(type) {
    return Math.round(DEFENCES[type].cost * this.skills.defenceCost);
  }
  upgradeCostOf(s) {
    return Math.round(upgradeCost(s.type, s.level) * this.skills.defenceCost);
  }
  get hq() {
    return this.state.structures.find((s) => s.type === 'hq');
  }
  get level() {
    return this.hq?.level || 1;
  }
  get armyCap() {
    return ARMY_CAP[this.level] + (this.skills.armyCap || 0); // Standing army, Citadel (skills.js)
  }
  get garrisonCap() {
    return GARRISON_CAP[this.level];
  }

  canPay(amount) {
    return this.sandbox || this.state.funds >= amount - 1e-6;
  }
  pay(amount) {
    if (!this.sandbox) this.state.funds = Math.max(0, this.state.funds - amount);
  }

  // ---- The military budget ----------------------------------------------------------------

  setShare(v) {
    this.state.share = Math.max(0, Math.min(MAX_SHARE, Math.round(v * 100) / 100));
  }

  // Move money from the town's budget into the military budget (an emergency transfer).
  transfer(amount) {
    const eco = this.economy;
    if (!eco) return 0;
    const n = Math.max(0, Math.min(amount, eco.money));
    if (!n) return 0;
    eco.state.money -= n;
    eco.state.today.expenses += n;
    this.state.funds += n;
    return n;
  }

  // What the soldiers are paid each day.
  upkeep() {
    return this.state.soldiers.reduce((sum, s) => sum + (UNITS[s.type]?.upkeep || 0), 0) * this.skills.pay;
  }

  // ---- The base map -------------------------------------------------------------------------

  structureAt(x, y) {
    for (const s of this.state.structures) {
      const d = DEFENCES[s.type];
      if (x >= s.x && y >= s.y && x < s.x + d.w && y < s.y + d.h) return s;
    }
    return null;
  }
  rockAt(x, y) {
    return this.state.rocks.some(([rx, ry]) => rx === x && ry === y);
  }
  occupied(x, y) {
    return this.rockAt(x, y) || !!this.structureAt(x, y);
  }
  postAt(x, y) {
    return this.state.soldiers.find((s) => s.post && Math.floor(s.post.x) === x && Math.floor(s.post.y) === y) || null;
  }

  // A way from the enemy's edge to the command post, with `extra` tiles counted as blocked.
  routeOpen(extra = null) {
    const blocked = (x, y) => this.occupied(x, y) || (extra && extra.has(key(x, y)));
    const hq = this.hq;
    if (!hq) return true;
    const goals = [];
    for (let y = hq.y - 1; y <= hq.y + 2; y++) for (let x = hq.x - 1; x <= hq.x + 2; x++) goals.push({ x, y });
    const f = buildField(BASE_W, BASE_H, blocked, goals);
    for (let x = 0; x < BASE_W; x++) if (f.dist[x] < Infinity) return true;
    return false;
  }

  // Why a defence can't go at (x, y), or null when it can (the same check drives the preview).
  placeError(type, x, y) {
    const d = DEFENCES[type];
    if (!d || !BUILDABLE.includes(type)) return 'Pick something to build';
    if (x < 0 || y < 0 || x + d.w > BASE_W || y + d.h > BASE_H) return 'Outside the base';
    if (y < ENTRY_ROWS) return 'Too close to the edge the enemy comes from';
    if (y + d.h > BASE_H - DEPLOY_ROWS) return 'Keep the reinforcement area clear';
    for (let yy = y; yy < y + d.h; yy++) for (let xx = x; xx < x + d.w; xx++) {
      if (this.rockAt(xx, yy)) return 'There’s rock in the way';
      if (this.structureAt(xx, yy)) return 'Something is already built here';
      if (this.postAt(xx, yy)) return 'A soldier stands guard here. Move them first';
    }
    const cost = this.defenceCost(type);
    if (!this.canPay(cost)) return `Needs ${cost} in the military budget`;
    const extra = new Set();
    for (let yy = y; yy < y + d.h; yy++) for (let xx = x; xx < x + d.w; xx++) extra.add(key(xx, yy));
    if (!this.routeOpen(extra)) return 'That would close the last way in. Attackers must have a route';
    return null;
  }

  place(type, x, y) {
    const err = this.placeError(type, x, y);
    if (err) return { error: err };
    const st = this.state;
    this.pay(this.defenceCost(type));
    const s = { id: st.nextId++, type, x, y, level: 1, hp: maxHpOf(type) };
    st.structures.push(s);
    return { structure: s };
  }

  // Money back for taking a defence down: half of what went into it, less for damage.
  refundOf(s) {
    let spent = this.defenceCost(s.type);
    for (let l = 1; l < s.level; l++) spent += Math.round(upgradeCost(s.type, l) * this.skills.defenceCost);
    return Math.round(spent * 0.5 * (s.hp / maxHpOf(s.type, s.level)));
  }

  remove(id) {
    const st = this.state;
    const s = st.structures.find((t) => t.id === id);
    if (!s || DEFENCES[s.type].fixed) return { error: 'This can’t be taken down' };
    const back = this.refundOf(s);
    st.structures = st.structures.filter((t) => t !== s);
    st.repairOrder = st.repairOrder.filter((r) => r !== id);
    if (!this.sandbox) st.funds += back;
    return { refund: back };
  }

  upgradeError(s) {
    if (!s) return 'Pick a defence';
    if (s.level >= MAX_LEVEL) return 'Fully upgraded';
    if (s.hp <= 0) return 'Repair it first';
    const c = this.upgradeCostOf(s);
    if (!this.canPay(c)) return `Needs ${c} in the military budget`;
    return null;
  }

  upgrade(id) {
    const s = this.state.structures.find((t) => t.id === id);
    const err = this.upgradeError(s);
    if (err) return { error: err };
    this.pay(this.upgradeCostOf(s));
    const before = maxHpOf(s.type, s.level);
    s.level++;
    s.hp = Math.min(maxHpOf(s.type, s.level), s.hp + maxHpOf(s.type, s.level) - before);
    return { structure: s };
  }

  // ---- Repairs ------------------------------------------------------------------------------

  damaged() {
    const st = this.state;
    const list = st.structures.filter((s) => s.hp < maxHpOf(s.type, s.level));
    // The order the crews work in: your chosen order first, then the most damaged.
    const rank = (s) => {
      const i = st.repairOrder.indexOf(s.id);
      return i < 0 ? 1000 + s.hp / maxHpOf(s.type, s.level) : i;
    };
    return list.sort((a, b) => rank(a) - rank(b));
  }

  repairCost(s, rush = false) {
    return Math.ceil((maxHpOf(s.type, s.level) - s.hp) * repairRate(s.type) * (rush ? RUSH_REPAIR : 1));
  }

  // Move a damaged defence up (−1) or down (+1) the crews' list, or to the top (−Infinity).
  prioritize(id, dir) {
    const st = this.state;
    const order = this.damaged().map((s) => s.id);
    const i = order.indexOf(id);
    if (i < 0) return;
    order.splice(i, 1);
    const j = dir === -Infinity ? 0 : Math.max(0, Math.min(order.length, i + dir));
    order.splice(j, 0, id);
    st.repairOrder = order;
  }

  repairNow(id) {
    const s = this.state.structures.find((t) => t.id === id);
    if (!s) return { error: 'Pick a defence' };
    const c = this.repairCost(s, true);
    if (!c) return { error: 'Not damaged' };
    if (!this.canPay(c)) return { error: `Needs ${c} in the military budget` };
    this.pay(c);
    s.hp = maxHpOf(s.type, s.level);
    return { cost: c };
  }

  // ---- Soldiers -----------------------------------------------------------------------------

  addSoldier(type, rand = this.rand) {
    const st = this.state;
    const s = { id: st.nextId++, type, name: soldierName(rand), xp: this.skills.veteranXp, kills: 0, battles: 0, status: 'ready', until: 0, post: null };
    st.soldiers.push(s);
    return s;
  }

  recruitError(type, { emergency = false } = {}) {
    const u = UNITS[type];
    if (!u) return 'Pick who to recruit';
    if (this.state.soldiers.length >= this.armyCap) return `The base holds ${this.armyCap} soldiers. Upgrade the command post for more`;
    const limit = this.limit?.(); // a treaty's cap on this army (diplomacy.js), if any
    if (limit && this.state.soldiers.length >= limit.soldiers) return `The treaty with ${limit.with} keeps your army to ${limit.soldiers} soldiers for now`;
    const c = this.recruitCost(type, { emergency });
    if (!this.canPay(c)) return `Needs ${c} in the military budget`;
    return null;
  }

  recruitCost(type, { emergency = false } = {}) {
    const u = UNITS[type];
    return Math.round(u.cost * (emergency && u.train ? EMERGENCY : 1) * (this.skills.recruitCost ?? 1)); // Citizen militia (skills.js)
  }

  // Regular training takes time (one recruit after another); emergency recruits and specialists are ready now.
  recruit(type, { emergency = false } = {}) {
    const err = this.recruitError(type, { emergency });
    if (err) return { error: err };
    const st = this.state;
    this.pay(this.recruitCost(type, { emergency }));
    const s = this.addSoldier(type);
    const u = UNITS[type];
    if (u.train && !emergency) {
      const start = Math.max(now(this.city), st.trainingUntil || 0);
      s.status = 'training';
      s.until = start + u.train * this.skills.train;
      st.trainingUntil = s.until;
    }
    return { soldier: s };
  }

  dismiss(id) {
    const st = this.state;
    st.soldiers = st.soldiers.filter((s) => s.id !== id);
  }

  garrison() {
    return this.state.soldiers.filter((s) => s.post);
  }

  stationError(s, x, y) {
    if (!s) return 'Pick a soldier';
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= BASE_W || ty >= BASE_H) return 'Outside the base';
    if (ty < ENTRY_ROWS) return 'Too close to the enemy’s edge';
    if (this.occupied(tx, ty)) return 'Something is in the way';
    const other = this.postAt(tx, ty);
    if (other && other !== s) return 'Someone already stands guard here';
    if (!s.post && this.garrison().length >= this.garrisonCap) return `${this.garrisonCap} soldiers can stand guard. Upgrade the command post for more`;
    return null;
  }

  station(id, x, y) {
    const s = this.state.soldiers.find((t) => t.id === id);
    const err = this.stationError(s, x, y);
    if (err) return { error: err };
    s.post = { x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5 };
    return { soldier: s };
  }

  unstation(id) {
    const s = this.state.soldiers.find((t) => t.id === id);
    if (s) s.post = null;
  }

  // Who can fight right now: those standing guard, and the reserve.
  fit() {
    return this.state.soldiers.filter((s) => s.status === 'ready');
  }

  // A rough measure of fighting power, for the computer's decisions and the world panel.
  strength() {
    let p = 0;
    for (const s of this.fit()) p += UNITS[s.type].cost * (1 + 0.08 * rankOf(s.xp));
    for (const s of this.state.structures) if (s.type !== 'hq' && s.hp > 0) p += DEFENCES[s.type].cost * 0.5 * (1 + 0.3 * (s.level - 1)) * (s.hp / maxHpOf(s.type, s.level));
    return Math.round(p);
  }

  // ---- Time passing ------------------------------------------------------------------------

  // dayFraction: the part of a game day that just went by.
  update(dayFraction) {
    if (dayFraction <= 0) return;
    const st = this.state;
    const t = now(this.city);
    const eco = this.economy;
    // The automatic share of the town's income.
    const net = this.city.derived.economy?.net || 0;
    if (eco && !this.sandbox && net > 0 && st.share > 0) {
      const n = Math.min(eco.money, net * st.share * dayFraction);
      if (n > 0) {
        eco.state.money -= n;
        eco.state.today.expenses += n;
        st.funds += n;
      }
    }
    // Pay. When the budget runs dry, the troops go unpaid, and their morale suffers in battle.
    const pay = this.upkeep() * dayFraction;
    if (!this.sandbox) {
      if (st.funds >= pay) {
        st.funds -= pay;
        st.unpaid = Math.max(0, st.unpaid - dayFraction);
      } else {
        st.funds = 0;
        st.unpaid = Math.min(10, st.unpaid + dayFraction);
      }
    }
    // Training finishes and the wounded recover.
    for (const s of st.soldiers) {
      if ((s.status === 'training' || s.status === 'injured') && t >= s.until) {
        s.status = 'ready';
        s.until = 0;
      }
    }
    // Repair crews work down the list, as far as the day and the budget allow.
    let hp = REPAIR_HP_PER_DAY * this.skills.repair * dayFraction;
    for (const s of this.damaged()) {
      if (hp <= 0) break;
      const max = maxHpOf(s.type, s.level);
      const rate = repairRate(s.type);
      const afford = this.sandbox ? Infinity : st.funds / rate;
      const n = Math.min(hp, max - s.hp, afford);
      if (n <= 0) break;
      s.hp = Math.min(max, s.hp + n);
      if (s.hp > max - 0.5) s.hp = max;
      this.pay(n * rate);
      hp -= n;
    }
    st.repairOrder = st.repairOrder.filter((id) => st.structures.some((s) => s.id === id && s.hp < maxHpOf(s.type, s.level)));
  }

  // Morale lost to unpaid wages (0–30 points).
  unpaidPenalty() {
    return Math.min(30, Math.round(this.state.unpaid * 6));
  }

  // ---- After a battle --------------------------------------------------------------------------

  // Write a battle's outcome back: health of every defence (when this town's base was the
  // battlefield), and what happened to each soldier who took part.
  // outcome: { structures?: [{ id, hp }], soldiers: [{ id, fate: 'ok'|'hurt'|'injured'|'killed', xp, kills }], days? }
  applyOutcome(outcome, { battleName = 'a battle' } = {}) {
    const st = this.state;
    const t = now(this.city);
    const injuryDays = outcome.injuryDays || ((r) => 2 + r * 2);
    for (const r of outcome.structures || []) {
      const s = st.structures.find((x) => x.id === r.id);
      if (s) s.hp = Math.max(0, Math.min(maxHpOf(s.type, s.level), Math.round(r.hp)));
    }
    const lost = [];
    for (const r of outcome.soldiers || []) {
      const s = st.soldiers.find((x) => x.id === r.id);
      if (!s) continue;
      s.xp += r.xp || 0;
      s.kills += r.kills || 0;
      s.battles++;
      if (r.fate === 'killed') {
        lost.push(s);
        st.fallen.unshift({ name: titleOf(s), type: s.type, day: this.city.day, battle: battleName });
      } else if (r.fate === 'injured') {
        s.status = 'injured';
        s.until = t + injuryDays(this.rand()) * this.skills.recovery;
      } else if (r.fate === 'hurt') {
        s.status = 'injured';
        s.until = t + LIGHT_INJURY_DAYS * this.skills.recovery;
      }
    }
    if (lost.length) st.soldiers = st.soldiers.filter((s) => !lost.includes(s));
    if (st.fallen.length > FALLEN_KEEP) st.fallen.length = FALLEN_KEEP;
  }

  addLog(entry) {
    const st = this.state;
    st.log.unshift({ day: this.city.day, ...entry });
    if (st.log.length > LOG_KEEP) st.log.length = LOG_KEEP;
  }

  // The base as the screens and the battle need it.
  layout() {
    const st = this.state;
    return {
      w: BASE_W,
      h: BASE_H,
      entryRows: ENTRY_ROWS,
      deployRows: DEPLOY_ROWS,
      rocks: st.rocks.map(([x, y]) => ({ x, y })),
      structures: st.structures.map((s) => ({ ...s, w: DEFENCES[s.type].w, h: DEFENCES[s.type].h, maxHp: maxHpOf(s.type, s.level) })),
    };
  }
}
