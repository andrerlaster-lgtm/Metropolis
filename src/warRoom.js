// The war room: every town's military, the computer's own recruiting and base building, the raids
// it sends against your base, and your attacks on its base. A raid is planned on the computer's slow
// look at the world, announced a few hours ahead, and arrives as a battle you fight yourself or leave
// to your officers (auto-resolve). An attack you launch from your base screen is fought at once on
// the computer's base. Either way the outcome is written back to both towns: soldiers lost and hurt
// on each side, damage to the base that was attacked, money spent on artillery, and, if the
// attacker wins, money carried off from the loser.
//
// The computer plays by your rules: its troops come out of its own military budget (a share of its
// income, like yours), they train for the same time, and the same battle rules decide the fight.
//
// TEMPORARY, until diplomacy exists (Phase 2): every computer town is hostile to you automatically.
// It raids your base, and you may attack it, without any declaration of war. Diplomacy will add
// stances (peace, declared war), treaties and peace terms, and raids and attacks will then need a
// declared war (planRaid and attackError are where that check goes).
// Time only passes while the game runs, so nothing is planned or fought while you're away.
//
// Saved in your town's city.systems.war = { v, count, raids: [...] } where each entry is a raid on
// you { id, from, fromName, seed, warnedAt, at, status: 'coming'|'arrived'|'fighting', waves: [{ at,
// units: [{ id, type, xp }] }] } or your attack { id, kind: 'attack', target, targetName, seed,
// status: 'fighting', party: [soldier ids] }; a battle in progress is in city.systems.military.battle
// (battle.js toJSON).

import { Military, titleOf } from './military.js';
import { DEFENCES, UNITS, RANKS, rankOf, INJURY_DAYS, BASE_W, BASE_H, ENTRY_ROWS } from './militaryData.js';
import { buildField, nextTile } from './flowfield.js';
import { Battle } from './battle.js';
import { addChronicle } from './chronicle.js';

export const WAR_VERSION = 1;
export const WARN_DAYS = 0.2; // how far ahead a raid is announced (a fifth of a day: about five hours)
const LOOK_DAYS = 0.25; // how often the computer looks at its army
const WAVE_GAP = 35; // seconds between waves
const CPU_SHARE = 0.5; // the most you can set for your own town too
const CPU_FUNDS = 200;
const LOOT_MAX = 2500;
const ATTACK_REST = 1; // days your troops rest between attacks
const CPU_KEEP = 120; // what the computer keeps back from defences for recruits
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
    this.state.raids = this.state.raids.filter((r) => ids.has(r.kind === 'attack' ? r.target : r.from));
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
        this.fortify(c);
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
    // Once it has a fair army for its defences, it saves for defences instead (see fortify).
    const armed = st.structures.filter((s) => s.type !== 'hq' && DEFENCES[s.type].attack).length;
    if (st.soldiers.length >= 6 + armed * 2 && armed < 8) return;
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

  // Build the computer's own base up with what's left after recruiting: machine-gun nests and bunkers
  // covering the way attackers would come, sandbags on it to make them walk further, mortars once
  // there's something to protect; and post soldiers on guard beside the defences.
  fortify(c) {
    const m = c.military;
    const st = m.state;
    this.postGuards(c);
    const built = st.structures.filter((s) => s.type !== 'hq');
    if (built.length >= Math.min(14, 3 + st.soldiers.length)) return;
    // It picks what to build next and saves up for it (a pair of sandbags for every armed defence).
    if (!DEFENCES[st.buildGoal]) {
      const armed = built.filter((s) => DEFENCES[s.type].attack);
      const bags = built.length - armed.length;
      const mgs = armed.filter((s) => s.type === 'mg').length;
      if (armed.length && bags < armed.length * 2 && this.rand() < 0.4) st.buildGoal = 'sandbags';
      else {
        const weights = { mg: 3, bunker: mgs >= 1 ? 1.5 : 0, mortar: mgs >= 2 ? 1 : 0 };
        let total = 0;
        for (const k in weights) total += weights[k];
        let r = this.rand() * total;
        st.buildGoal = 'mg';
        for (const k in weights) {
          r -= weights[k];
          if (r <= 0) {
            st.buildGoal = k;
            break;
          }
        }
      }
    }
    const type = st.buildGoal;
    if (st.funds < DEFENCES[type].cost + CPU_KEEP) return; // still saving
    const spot = this.defenceSpot(m, type);
    if (spot && !m.place(type, spot.x, spot.y).error) st.buildGoal = null;
  }

  // The tiles an attacker would walk from the middle of the top edge to the command post.
  route(m) {
    const hq = m.hq;
    const goals = [];
    for (let y = hq.y - 1; y <= hq.y + 2; y++) for (let x = hq.x - 1; x <= hq.x + 2; x++) goals.push({ x, y });
    const f = buildField(BASE_W, BASE_H, (x, y) => m.occupied(x, y), goals);
    const path = [];
    let at = { x: Math.floor(BASE_W / 2), y: 0 };
    for (let i = 0; i < BASE_W * BASE_H && at; i++) {
      path.push(at);
      at = nextTile(f, at.x, at.y);
    }
    return path;
  }

  defenceSpot(m, type) {
    const path = this.route(m);
    const hq = m.hq;
    let best = null;
    let bs = -Infinity;
    for (let y = ENTRY_ROWS + 2; y < hq.y; y++) {
      for (let x = 0; x < BASE_W; x++) {
        if (m.placeError(type, x, y)) continue;
        let near = Infinity;
        for (const p of path) near = Math.min(near, Math.hypot(p.x - x, p.y - y));
        let score = this.rand() * 0.5;
        if (type === 'sandbags') score += -near * 2 + y * 0.1; // on the way, to make them walk round
        else if (type === 'mortar') score += -Math.abs(near - 3) + y * 0.4; // further back, out of reach
        else score += -Math.abs(near - 1.5) * 1.5 + y * 0.25; // beside the way, closer to home
        if (score > bs) {
          bs = score;
          best = { x, y };
        }
      }
    }
    return best;
  }

  // A couple of guards, and one more for each armed defence; the rest stay free to raid.
  postGuards(c) {
    const m = c.military;
    const free = m.fit().filter((s) => !s.post);
    const armed = m.state.structures.filter((s) => s.type !== 'hq' && s.hp > 0 && DEFENCES[s.type].attack).length;
    const cap = Math.min(m.garrisonCap, 2 + armed);
    if (!free.length || m.garrison().length >= cap) return;
    const cover = m.state.structures.filter((s) => s.type !== 'hq' && s.hp > 0);
    const spots = [];
    for (const d of cover.length ? cover : [m.hq]) {
      for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1], [-1, 1], [1, 1]]) {
        const x = d.x + dx;
        const y = d.y + dy;
        if (!m.stationError(free[0], x, y)) spots.push({ x, y });
      }
    }
    for (const s of free) {
      if (m.garrison().length >= cap) return;
      const spot = spots.find((p) => !m.postAt(p.x, p.y) && !m.stationError(s, p.x, p.y));
      if (!spot) return;
      m.station(s.id, spot.x, spot.y);
    }
  }

  // ---- Your attacks ---------------------------------------------------------------------------

  // Who goes: your reserve, and the guards too if you choose.
  attackParty({ guards = false } = {}) {
    return this.military.fit().filter((s) => guards || !s.post);
  }

  attackError(c, opts = {}) {
    if (this.busy) return 'Finish the battle at hand first';
    if (!c || c.owner === 'player') return 'Pick a town to attack';
    const t = nowOf(this.home.city);
    const st = this.military.state;
    if (t < (st.attackReadyAt || 0)) return `Your troops are resting after the last attack: ready ${Math.max(1, Math.round((st.attackReadyAt - t) * 24))} h from now`;
    if (t < (c.military.state.protectedUntil || 0)) return `${c.entry.name} is still recovering from a battle: ${Math.max(1, Math.round((c.military.state.protectedUntil - t) * 24))} h to go`;
    if (this.attackParty(opts).length < 2) return 'Send at least two ready soldiers';
    return null;
  }

  // Launch an attack on a computer town's base. The battle starts at once (the world waits).
  launchAttack(c, opts = {}) {
    const err = this.attackError(c, opts);
    if (err) return { error: err };
    const party = this.attackParty(opts);
    const entry = { id: `attack-${this.state.count + 1}`, kind: 'attack', target: c.id, targetName: c.entry.name, seed: Math.floor(this.rand() * 2 ** 31), status: 'arrived', party: party.map((s) => s.id), size: party.length };
    this.state.raids.push(entry);
    this.state.count++;
    return { attack: entry };
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
    const ready = c.military.fit().filter((s) => !s.post); // its guards stay home
    const want = Math.min(R.max, R.size(this.state.count), Math.floor(ready.length * 0.85 + 0.5));
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
    if (raid.kind === 'attack') return this.attackSpec(raid, { auto });
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

  // Your attack: your party as squads from the enemy's edge, their base, guards and reserve.
  attackSpec(entry, { auto = false } = {}) {
    const m = this.military;
    const target = this.byId(entry.target);
    const tm = target.military;
    const party = entry.party.map((id) => m.state.soldiers.find((s) => s.id === id)).filter((s) => s && s.status === 'ready');
    const fit = tm.fit();
    return {
      seed: entry.seed,
      name: `Attack on ${entry.targetName}`,
      auto,
      player: 'att',
      map: tm.layout(),
      attacker: { name: this.home.entry.name, morale: 100 - m.unpaidPenalty(), budget: m.sandbox ? 1e9 : m.funds, reserve: party.map((s) => ({ id: s.id, type: s.type, xp: s.xp })) },
      defender: {
        name: entry.targetName,
        morale: 100 - tm.unpaidPenalty(),
        budget: tm.funds,
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
    if (raid.kind === 'attack') return this.concludeAttack(raid, battle, { auto });
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
      hqLost: res.hqLost,
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

  concludeAttack(entry, battle, { auto = false } = {}) {
    const res = battle.result;
    const home = this.home;
    const m = this.military;
    const mst = m.state;
    const target = this.byId(entry.target);
    const tm = target?.military;
    const t = nowOf(home.city);
    const ranks = new Map(mst.soldiers.map((s) => [s.id, rankOf(s.xp)]));
    const title = new Map(mst.soldiers.map((s) => [s.id, titleOf(s)]));
    const injuryDays = (r) => INJURY_DAYS[0] + r * (INJURY_DAYS[1] - INJURY_DAYS[0]);
    const before = new Map((tm?.state.structures || []).map((s) => [s.id, s.hp]));
    m.pay(res.attacker.spent);
    m.applyOutcome({ soldiers: res.attacker.soldiers, injuryDays }, { battleName: battle.name });
    let loot = 0;
    if (tm) {
      tm.pay(res.defender.spent);
      tm.applyOutcome({ structures: res.defender.structures, soldiers: res.defender.soldiers, injuryDays }, { battleName: battle.name });
      // Winning carries off part of their military budget (and a little of their town's money) into yours.
      if (res.winner === 'att') {
        const eco = target.sim.economy;
        loot = Math.min(LOOT_MAX, Math.round(tm.state.funds * 0.25 + eco.money * 0.03));
        const fromFunds = Math.min(tm.state.funds * 0.5, loot);
        tm.state.funds -= fromFunds;
        eco.state.money = Math.max(0, eco.state.money - (loot - fromFunds));
        mst.funds += loot;
      }
      const R = RAID_RULES[mst.raids] || RAID_RULES.gentle;
      tm.state.protectedUntil = t + R.protect;
      tm.state.nextRaidAt = Math.max(tm.state.nextRaidAt || 0, t + 1); // they lick their wounds before raiding
    }
    mst.attackReadyAt = t + ATTACK_REST;
    mst.battle = null;
    this.state.raids = this.state.raids.filter((r) => r !== entry);
    const byFate = (f) => res.attacker.soldiers.filter((s) => s.fate === f).map((s) => title.get(s.id)).filter(Boolean);
    const outcome = res.winner === 'att' ? 'won' : res.reason === 'retreat' ? 'retreated' : 'lost';
    const damage = res.defender.structures
      .filter((s) => s.hp < (before.get(s.id) ?? s.hp))
      .map((s) => ({ id: s.id, label: DEFENCES[s.type].label, hp: s.hp, max: s.maxHp, wrecked: s.wrecked }));
    const report = {
      kind: 'attack',
      raid: entry.id,
      target: entry.targetName,
      outcome,
      reason: res.reason,
      hqLost: res.hqLost,
      auto,
      time: res.time,
      them: { total: res.defender.total, lost: res.defender.lost, damage },
      you: {
        fought: res.attacker.soldiers.length,
        sent: res.attacker.total,
        killed: byFate('killed'),
        injured: byFate('injured'),
        hurt: byFate('hurt'),
        promoted: mst.soldiers.filter((s) => ranks.has(s.id) && rankOf(s.xp) > ranks.get(s.id)).map((s) => `${s.name} to ${RANKS[rankOf(s.xp)].label}`),
        spent: res.attacker.spent,
        loot,
      },
    };
    m.addLog({ kind: 'attack', ...report });
    tm?.addLog({ kind: 'attacked', by: home.entry.name, outcome: outcome === 'won' ? 'lost' : 'held', lost: res.defender.lost, loot });
    const said = { won: 'They won', retreated: 'They were pulled out', lost: 'They were beaten back' }[outcome];
    addChronicle(home.city, `Our troops attacked ${entry.targetName}'s military base. ${said}: ${res.defender.lost} of their ${res.defender.total} defenders fell${report.you.killed.length ? `, and ${report.you.killed.length} of ours` : ''}${loot ? `. They brought back ${'$' + loot.toLocaleString()}` : ''}.`);
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
      attackReadyIn: Math.max(0, (st.attackReadyAt || 0) - t),
      neighbours: this.world.neighbours.map((c) => ({
        id: c.id,
        name: c.entry.name,
        soldiers: c.military.state.soldiers.length,
        ready: c.military.fit().length,
        guards: c.military.garrison().length,
        defences: c.military.state.structures.filter((s) => s.type !== 'hq' && s.hp > 0).length,
        strength: c.military.strength(),
        recovering: Math.max(0, (c.military.state.protectedUntil || 0) - t),
      })),
    };
  }
}

