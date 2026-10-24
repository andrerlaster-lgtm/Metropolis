// The war room: every town's military, the computer's own recruiting, and the raids it sends
// against your base. A raid is planned on the computer's slow look at the world, announced a few
// hours ahead, and arrives as a battle you fight yourself or leave to your officers (auto-resolve).
// Its outcome is written back to both towns: soldiers lost and hurt on each side, damage to your
// base, money spent on artillery, and, if the raid wins, money carried off to the raider's budget.
//
// The computer plays by your rules: its troops come out of its own military budget (a share of its
// income, like yours), they train for the same time, and the same battle rules decide the fight.
// Time only passes while the game runs, so nothing is planned or fought while you're away.
//
// Saved in your town's city.systems.war = { v, count, raids: [{ id, from, fromName, seed, warnedAt,
// at, status: 'coming'|'arrived'|'fighting', waves: [{ at, units: [{ id, type, xp }] }] }] }; a
// battle in progress is in city.systems.military.battle (battle.js toJSON).

import { Military, titleOf } from './military.js';
import { DEFENCES, UNITS, RANKS, rankOf, INJURY_DAYS } from './militaryData.js';
import { Battle } from './battle.js';
import { addChronicle } from './chronicle.js';

export const WAR_VERSION = 1;
export const WARN_DAYS = 0.2; // how far ahead a raid is announced (a fifth of a day: about five hours)
const LOOK_DAYS = 0.25; // how often the computer looks at its army
const WAVE_GAP = 35; // seconds between waves
const CPU_SHARE = 0.35;
const CPU_FUNDS = 200;
const LOOT_MAX = 2500;
export const RAID_RULES = {
  gentle: { first: 3, cooldown: [4, 6], size: (n) => 3 + 2 * n, max: 14, protect: 3 },
  fierce: { first: 1.5, cooldown: [2, 3], size: (n) => 6 + 3 * n, max: 24, protect: 1.5 },
};

const nowOf = (city) => city.day + city.clock;

export class WarRoom {
  constructor(world, { rand = Math.random } = {}) {
    this.world = world;
    this.rand = rand;
    this.onWarn = null; // (raid) → a raid has been announced
    this.onArrive = null; // (raid) → a raid has reached your base
    this.look = 0;
    this.attach();
  }

  get home() {
    return this.world.cities[0];
  }
  get military() {
    return this.home.military;
  }

  get state() {
    const s = this.home.city.systems;
    if (!s.war || typeof s.war !== 'object' || s.war.v !== WAR_VERSION || !Array.isArray(s.war.raids)) s.war = { v: WAR_VERSION, count: 0, raids: [] };
    return s.war;
  }

  // Give every town its military (after the world loads a save, a new town or a visit).
  attach() {
    for (const c of this.world.cities) {
      if (c.military && c.military.city === c.city) continue;
      const fresh = !c.city.systems.military;
      c.military = new Military(c.city, { economy: c.sim.economy, rand: this.rand, starter: 3 });
      const st = c.military.state;
      if (fresh && c.owner !== 'player') {
        st.share = CPU_SHARE;
        st.funds = CPU_FUNDS;
      }
    }
    // A raid from a town that no longer exists is called off.
    const ids = new Set(this.world.cities.map((c) => c.id));
    this.state.raids = this.state.raids.filter((r) => ids.has(r.from));
  }

  byId(id) {
    return this.world.byId(id);
  }

  // The raid that needs your answer now (arrived, or a battle left half-way), if any.
  pending() {
    return this.state.raids.find((r) => r.status === 'arrived' || r.status === 'fighting') || null;
  }
  coming() {
    return this.state.raids.find((r) => r.status === 'coming') || null;
  }
  // True while the world should stand still: a raid at the gates or a battle being fought.
  get busy() {
    return !!this.pending();
  }

  // dayFraction: the part of a game day that just went by (0 while paused).
  update(dayFraction) {
    if (dayFraction <= 0 || this.busy) return;
    for (const c of this.world.cities) c.military?.update(dayFraction);
    this.look -= dayFraction;
    if (this.look <= 0) {
      this.look = LOOK_DAYS;
      for (const c of this.world.neighbours) {
        this.recruitFor(c);
        this.planRaid(c);
      }
    }
    const t = nowOf(this.home.city);
    for (const r of this.state.raids) {
      if (r.status === 'coming' && t >= r.at) {
        r.status = 'arrived';
        this.onArrive?.(r);
      }
    }
  }

  // ---- The computer's army ----------------------------------------------------------------

  // Train troops with what its military budget allows, leaning towards grenadiers when your base
  // bristles with defences (counters, the Ugh-Guys pattern) and keeping a medic or two.
  recruitFor(c) {
    const m = c.military;
    const st = m.state;
    const yours = this.military.state.structures.filter((s) => s.hp > 0 && DEFENCES[s.type].attack && s.type !== 'hq').length;
    for (let i = 0; i < 2; i++) {
      if (st.soldiers.length >= m.armyCap) return;
      const medics = st.soldiers.filter((s) => s.type === 'medic').length;
      const weights = { rifleman: 4, gunner: 2, grenadier: 1 + yours * 0.8, medic: medics < Math.floor(st.soldiers.length / 6) ? 1.5 : 0 };
      let total = 0;
      for (const k in weights) total += weights[k];
      let r = this.rand() * total;
      let type = 'rifleman';
      for (const k in weights) {
        r -= weights[k];
        if (r <= 0) {
          type = k;
          break;
        }
      }
      if (st.funds < UNITS[type].cost + 60) return;
      m.recruit(type);
    }
  }

  // Decide whether to raid you: only one raid at a time, never while your base is protected after a
  // battle, never in the first days of your base, and only with enough ready troops.
  planRaid(c) {
    const yours = this.military.state;
    const R = RAID_RULES[yours.raids];
    if (!R) return null;
    if (this.state.raids.length) return null;
    const t = nowOf(this.home.city);
    if (t < yours.since + R.first || t < (yours.protectedUntil || 0)) return null;
    const cm = c.military.state;
    if (t < (cm.nextRaidAt || 0)) return null;
    const ready = c.military.fit();
    const want = Math.min(R.max, R.size(this.state.count), Math.floor(ready.length * 0.85));
    if (want < 3) return null;
    return this.launch(c, ready.slice(0, want), R);
  }

  launch(c, party, R = RAID_RULES.gentle) {
    const t = nowOf(this.home.city);
    for (const s of party) s.status = 'raiding';
    const n = party.length;
    const count = n <= 10 ? 2 : 3;
    const per = Math.ceil(n / count);
    const waves = [];
    for (let i = 0; i < count; i++) {
      const units = party.slice(i * per, (i + 1) * per).map((s) => ({ id: s.id, type: s.type, xp: s.xp }));
      if (units.length) waves.push({ at: i * WAVE_GAP, units });
    }
    const raid = { id: `raid-${this.state.count + 1}`, from: c.id, fromName: c.entry.name, seed: Math.floor(this.rand() * 2 ** 31), warnedAt: t, at: t + WARN_DAYS, status: 'coming', waves, size: n };
    this.state.raids.push(raid);
    this.state.count++;
    c.military.state.nextRaidAt = t + R.cooldown[0] + this.rand() * (R.cooldown[1] - R.cooldown[0]);
    this.onWarn?.(raid);
    return raid;
  }

  // ---- Fighting it out ------------------------------------------------------------------------

  battleSpec(raid, { auto = false } = {}) {
    const m = this.military;
    const from = this.byId(raid.from);
    const fit = m.fit();
    return {
      seed: raid.seed,
      name: `${raid.fromName} raid`,
      auto,
      map: m.layout(),
      attacker: { name: raid.fromName, morale: 100 - (from?.military.unpaidPenalty() || 0), waves: raid.waves },
      defender: {
        name: this.home.entry.name,
        morale: 100 - m.unpaidPenalty(),
        budget: m.sandbox ? 1e9 : m.funds,
        garrison: fit.filter((s) => s.post).map((s) => ({ id: s.id, type: s.type, xp: s.xp, x: s.post.x, y: s.post.y })),
        reserve: fit.filter((s) => !s.post).map((s) => ({ id: s.id, type: s.type, xp: s.xp })),
      },
    };
  }

  // Start (or pick up again) the battle for a raid you're defending yourself.
  fight(raid) {
    const st = this.military.state;
    let battle = raid.status === 'fighting' && st.battle ? Battle.fromJSON(st.battle) : null;
    if (!battle) {
      battle = new Battle(this.battleSpec(raid));
      raid.status = 'fighting';
      st.battle = battle.toJSON();
    }
    return battle;
  }

  // Leave it to your officers: the whole battle (or the rest of one) is fought with nobody watching.
  autoResolve(raid, battle = null) {
    const b = battle || (raid.status === 'fighting' && this.military.state.battle ? Battle.fromJSON(this.military.state.battle) : null) || new Battle(this.battleSpec(raid, { auto: true }));
    b.resolve();
    return this.conclude(raid, b, { auto: true });
  }

  // Write the outcome back to both towns, and say what happened.
  conclude(raid, battle, { auto = false } = {}) {
    const res = battle.result;
    const home = this.home;
    const m = this.military;
    const mst = m.state;
    const from = this.byId(raid.from);
    const t = nowOf(home.city);
    const before = new Map(mst.structures.map((s) => [s.id, s.hp]));
    const ranks = new Map(mst.soldiers.map((s) => [s.id, rankOf(s.xp)]));
    const title = new Map(mst.soldiers.map((s) => [s.id, titleOf(s)]));
    const injuryDays = (r) => INJURY_DAYS[0] + r * (INJURY_DAYS[1] - INJURY_DAYS[0]);
    // Your side.
    m.pay(res.defender.spent);
    m.applyOutcome({ structures: res.defender.structures, soldiers: res.defender.soldiers, injuryDays }, { battleName: battle.name });
    // Theirs.
    if (from) {
      from.military.applyOutcome({ soldiers: res.attacker.soldiers, injuryDays }, { battleName: battle.name });
      for (const s of from.military.state.soldiers) if (s.status === 'raiding') s.status = 'ready';
    }
    // A raid that wins carries money off: up to half the military budget, the rest from the town's.
    let loot = 0;
    if (res.winner === 'att' && !m.sandbox) {
      const eco = home.sim.economy;
      loot = Math.min(LOOT_MAX, Math.round(mst.funds * 0.25 + eco.money * 0.03));
      const fromFunds = Math.min(mst.funds * 0.5, loot);
      mst.funds -= fromFunds;
      eco.state.money = Math.max(0, eco.state.money - (loot - fromFunds));
      eco.state.today.expenses += loot - fromFunds;
      if (from) from.sim.economy.state.money += loot;
    }
    const R = RAID_RULES[mst.raids] || RAID_RULES.gentle;
    mst.protectedUntil = t + R.protect;
    mst.battle = null;
    this.state.raids = this.state.raids.filter((r) => r !== raid);

    const byFate = (f) => res.defender.soldiers.filter((s) => s.fate === f).map((s) => s.id);
    const names = (ids) => ids.map((id) => title.get(id)).filter(Boolean);
    const promoted = mst.soldiers.filter((s) => ranks.has(s.id) && rankOf(s.xp) > ranks.get(s.id)).map((s) => `${s.name} to ${RANKS[rankOf(s.xp)].label}`);
    const damage = res.defender.structures
      .filter((s) => s.hp < (before.get(s.id) ?? s.hp))
      .map((s) => ({ id: s.id, label: DEFENCES[s.type].label, hp: s.hp, max: s.maxHp, wrecked: s.wrecked, lost: (before.get(s.id) ?? s.hp) - s.hp }));
    const outcome = res.winner === 'def' ? 'held' : res.reason === 'retreat' ? 'retreated' : 'lost';
    const report = {
      raid: raid.id,
      from: raid.fromName,
      outcome,
      reason: res.reason,
      auto,
      time: res.time,
      attackers: { total: res.attacker.total, lost: res.attacker.lost, unsent: res.attacker.unsent },
      you: {
        fought: res.defender.soldiers.length,
        killed: names(byFate('killed')),
        injured: names(byFate('injured')),
        hurt: names(byFate('hurt')),
        promoted,
        damage,
        spent: res.defender.spent,
        loot,
      },
    };
    const said = { held: 'The base held', retreated: 'You pulled your troops out', lost: 'The base fell' }[outcome];
    m.addLog({ kind: 'raid', ...report });
    from?.military.addLog({ kind: 'raided', target: home.entry.name, outcome: outcome === 'held' ? 'beaten' : 'won', lost: res.attacker.lost, loot });
    addChronicle(home.city, `${raid.fromName} raided the military base. ${said}: ${res.attacker.lost} of their ${res.attacker.total} soldiers fell${report.you.killed.length ? `, and ${report.you.killed.length} of ours` : ''}${loot ? `. They took ${'$' + loot.toLocaleString()}` : ''}.`);
    return report;
  }

  // The rest of the world, for the screens: your base's next danger and each neighbour's army.
  intel() {
    const t = nowOf(this.home.city);
    const st = this.military.state;
    const coming = this.coming();
    return {
      coming: coming ? { from: coming.fromName, in: Math.max(0, coming.at - t), size: coming.size, waves: coming.waves.length } : null,
      protectedFor: Math.max(0, (st.protectedUntil || 0) - t),
      raids: st.raids,
      neighbours: this.world.neighbours.map((c) => ({
        id: c.id,
        name: c.entry.name,
        soldiers: c.military.state.soldiers.length,
        ready: c.military.fit().length,
        strength: c.military.strength(),
      })),
    };
  }
}

