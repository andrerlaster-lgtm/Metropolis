// A battle at a military base: the attacker's troops arrive in waves along the top edge and fight
// their way to the command post; the defender's garrison holds its posts, defences fire, and the
// commander sends in reinforcement squads, gives them orders and calls in artillery. Pure rules, no
// screen (the 3D view reads the fields below), fixed steps and its own seeded random numbers, so
// the same start and the same orders give the same battle, it can be saved half-way and resumed,
// and it can be fought out with nobody watching (auto-resolve).
//
// Patterns from the battle-mode research (docs/references/battle-mode.md), in our own code: one
// flow field per goal for movement, defences that re-pick their target every step, damage
// multipliers by target tag minus armour, lobbed shells that land where they were aimed, and the
// computer's waves pulling back to regroup when they've lost most of their number.
//
// Who wins: the attacker by destroying the command post, or by defeating the defending army (every
// soldier down and no reserve left) or making it break and run. The defender by holding until every
// wave is beaten or has withdrawn (morale breaks, or the attack runs out of time and supplies).

import { DEFENCES, UNITS, ARTILLERY, SQUAD_SIZE, REINFORCE_COOLDOWN, rankBonus, levelDmg, SURVIVE, SURVIVE_MEDIC } from './militaryData.js';
import { buildField, nextTile, distanceAt } from './flowfield.js';

export const STEP = 0.05; // seconds per battle step
export const BATTLE_VERSION = 1;
export const TIME_LIMIT = 300; // after this the attack has run out of supplies and withdraws
const RETREAT_AT = 0.35; // a wave pulls back when fewer than this share of it is still standing
const WITHDRAW_MORALE = 20;
const ROUT_MORALE = 8;
const MASS_TIME = 2.5; // a fresh wave gathers this long before it advances
const SPACE = 0.42; // how close two soldiers stand at most
const LEASH = 2.5; // how far a guard leaves their post to fight
const FX_KEEP = 2.5; // seconds of effects kept for the screen
const ACCURACY = 0.8;
const COVER = 0.6; // damage taken next to sandbags, a nest or a bunker
const THINK = 0.5; // how often the computer commanders think, in seconds

const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;

export class Battle {
  // spec: { seed, name, attacker: { name, morale, waves: [{ at, units: [{ id, type, xp }] }] },
  //   defender: { name, morale, budget, garrison: [{ id, type, xp, x, y }], reserve: [{ id, type, xp }] },
  //   map: { w, h, entryRows, deployRows, rocks: [{ x, y }], structures: [{ id, type, x, y, level, hp, maxHp }] },
  //   auto: true when the computer commands the defenders too }
  constructor(spec, restore = null) {
    if (restore) return this.restore(restore);
    this.v = BATTLE_VERSION;
    this.name = spec.name || 'Battle';
    this.r = (spec.seed >>> 0) || 1;
    this.t = 0;
    this.over = false;
    this.result = null;
    this.paused = false;
    this.auto = !!spec.auto;
    this.acc = 0;
    this.nextId = 1;
    this.fxId = 0;
    this.fx = [];
    this.map = { w: spec.map.w, h: spec.map.h, entryRows: spec.map.entryRows || 2, deployRows: spec.map.deployRows || 2, rocks: spec.map.rocks.map((r) => ({ x: r.x, y: r.y })) };
    this.structs = spec.map.structures.map((s) => ({ id: s.id, type: s.type, x: s.x, y: s.y, w: DEFENCES[s.type].w, h: DEFENCES[s.type].h, level: s.level || 1, hp: s.hp, maxHp: s.maxHp, cd: 0, tgt: null }));
    this.units = [];
    this.shells = [];
    this.strikes = [];
    this.names = { att: spec.attacker.name || 'The enemy', def: spec.defender.name || 'You' };
    this.morale = { att: clampM(spec.attacker.morale ?? 100), def: clampM(spec.defender.morale ?? 100) };
    this.withdrawing = false;
    this.routing = false;
    this.budget = spec.defender.budget ?? 0;
    this.spent = 0;
    this.artilleryAt = 0; // when the next strike may be called
    this.reinforceAt = 0;
    this.waves = spec.attacker.waves.map((w, i) => ({ i, at: w.at, units: w.units.map((u) => ({ ...u })), spawned: false, launch: 0, pulled: false }));
    this.attTotal = this.waves.reduce((n, w) => n + w.units.length, 0);
    // Defenders: the garrison is on the field from the start; the reserve waits in squads.
    this.squads = [{ id: 'guard', name: 'Garrison', units: [], deployed: true, order: { kind: 'hold' } }];
    for (const g of spec.defender.garrison) {
      const u = this.addUnit('def', g, g.x, g.y);
      u.squad = 'guard';
      u.anchor = { x: g.x, y: g.y };
      this.squads[0].units.push(u.id);
    }
    const reserve = spec.defender.reserve.slice();
    for (let i = 0; i < reserve.length; i += SQUAD_SIZE) {
      const n = this.squads.length;
      this.squads.push({ id: `s${n}`, name: `Squad ${n}`, deployed: false, order: { kind: 'rally' }, members: reserve.slice(i, i + SQUAD_SIZE), units: [] });
    }
    this.defTotal = spec.defender.garrison.length + reserve.length;
    this.hadDefenders = this.defTotal > 0;
    this.medic = { att: this.waves.some((w) => w.units.some((u) => UNITS[u.type]?.heal)), def: [...spec.defender.garrison, ...reserve].some((u) => UNITS[u.type]?.heal) };
    this.lost = { att: 0, def: 0 };
    this.think = 0;
    this.fields = new Map();
    this.blockRev = 0;
    this.selected = null;
  }

  // ---- Random numbers (mulberry32, with the state kept so a saved battle resumes exactly) ----
  rand() {
    let t = (this.r = (this.r + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  addUnit(side, rec, x, y) {
    const def = UNITS[rec.type];
    const mult = rankBonus(rec.xp || 0);
    const u = {
      id: this.nextId++,
      side,
      type: rec.type,
      sid: rec.id,
      x,
      y,
      maxHp: Math.round(def.hp * mult),
      hp: Math.round(def.hp * mult),
      mult,
      cd: this.rand() * 0.6,
      tgt: null,
      mode: side === 'att' ? 'mass' : 'hold',
      dest: null,
      anchor: null,
      squad: null,
      wave: null,
      kills: 0,
      dealt: 0,
      alive: true,
      gone: false,
      fate: null,
      face: side === 'att' ? Math.PI / 2 : -Math.PI / 2,
      moving: false,
      fired: -9,
      until: 0,
    };
    this.units.push(u);
    return u;
  }

  // ---- The map ------------------------------------------------------------------------------

  structAt(x, y) {
    for (const s of this.structs) if (s.hp > 0 && x >= s.x && y >= s.y && x < s.x + s.w && y < s.y + s.h) return s;
    return null;
  }
  rockAt(x, y) {
    return this.map.rocks.some((r) => r.x === x && r.y === y);
  }
  blocked(x, y) {
    if (x < 0 || y < 0 || x >= this.map.w || y >= this.map.h) return true;
    return this.rockAt(x, y) || !!this.structAt(x, y);
  }
  get hq() {
    return this.structs.find((s) => s.type === 'hq');
  }

  // A flow field towards a goal, rebuilt only after a defence falls (its rubble can be crossed).
  field(key) {
    let f = this.fields.get(key);
    if (f && f.rev === this.blockRev) return f;
    const { w, h } = this.map;
    const blocked = (x, y) => this.blocked(x, y);
    let goals = [];
    if (key === 'hq') {
      const q = this.hq;
      if (q) for (let y = q.y - 1; y <= q.y + q.h; y++) for (let x = q.x - 1; x <= q.x + q.w; x++) goals.push({ x, y });
    } else if (key === 'north') for (let x = 0; x < w; x++) goals.push({ x, y: 0 });
    else if (key === 'south') for (let x = 0; x < w; x++) goals.push({ x, y: h - 1 });
    else {
      const [gx, gy] = key.slice(2).split(',').map(Number);
      goals = [this.openNear(gx, gy)];
    }
    f = buildField(w, h, blocked, goals);
    f.rev = this.blockRev;
    this.fields.set(key, f);
    return f;
  }

  openNear(x, y) {
    if (!this.blocked(x, y)) return { x, y };
    for (let r = 1; r < 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (!this.blocked(x + dx, y + dy)) return { x: x + dx, y: y + dy };
    return { x, y };
  }

  // ---- Commands -----------------------------------------------------------------------------

  squad(id) {
    return this.squads.find((s) => s.id === id) || null;
  }
  livingIn(sq) {
    return sq.units.map((id) => this.unit(id)).filter((u) => u && u.alive && !u.gone);
  }
  unit(id) {
    return this.units.find((u) => u.id === id) || null;
  }

  // Why a squad can't be sent in right now, or null.
  deployError(id) {
    if (this.over) return 'The battle is over';
    const sq = this.squad(id);
    if (!sq) return 'Pick a squad';
    if (sq.deployed) return 'Already in the fight';
    if (this.routing) return 'Your troops are falling back';
    const wait = this.reinforceAt - this.t;
    if (wait > 0) return `Next squad in ${Math.ceil(wait)} s`;
    return null;
  }

  // Send a reserve squad in from the reinforcement rows.
  deploy(id) {
    const err = this.deployError(id);
    if (err) return { error: err };
    const sq = this.squad(id);
    const { w, h } = this.map;
    const n = sq.members.length;
    const cx = (this.hq ? this.hq.x + this.hq.w / 2 : w / 2) + (this.squads.filter((s) => s.deployed).length % 2 ? 2.5 : -2.5);
    sq.members.forEach((m, i) => {
      const x = Math.max(0.5, Math.min(w - 0.5, cx + (i - (n - 1) / 2) * 0.7 + (this.rand() - 0.5) * 0.2));
      const y = h - 0.6 - (i % 2) * 0.5;
      const u = this.addUnit('def', m, x, y);
      u.squad = sq.id;
      sq.units.push(u.id);
    });
    sq.deployed = true;
    delete sq.members;
    this.reinforceAt = this.t + REINFORCE_COOLDOWN;
    this.setOrder(sq, sq.order);
    this.addFx({ kind: 'deploy', x: cx, y: h - 1 });
    return { ok: true };
  }

  // Squad orders: move (to a spot, firing on the way), hold (stand and fight where they are),
  // charge (go after the nearest enemy) and fallback (regroup by the command post). Orders given
  // while the battle is paused wait and are carried out when it resumes.
  order(id, order) {
    const sq = this.squad(id);
    if (!sq || this.over) return { error: 'Pick a squad' };
    if (!sq.deployed) return { error: 'Send the squad in first' };
    if (order.kind === 'move' && !(Number.isFinite(order.x) && Number.isFinite(order.y))) return { error: 'Pick a spot' };
    this.setOrder(sq, order);
    return { ok: true };
  }

  setOrder(sq, order) {
    sq.order = { kind: order.kind, x: order.x, y: order.y };
    const members = this.livingIn(sq);
    const n = members.length;
    members.forEach((u, i) => {
      if (order.kind === 'move') {
        // Spread out around the spot, in a short line across it.
        const off = (i - (n - 1) / 2) * 0.6;
        u.mode = 'move';
        u.dest = { x: clampTo(order.x + off, 0.4, this.map.w - 0.4), y: clampTo(order.y + (i % 2) * 0.4, 0.4, this.map.h - 0.4) };
      } else if (order.kind === 'hold') {
        u.mode = 'hold';
        u.anchor = { x: u.x, y: u.y };
      } else if (order.kind === 'rally') {
        // Fresh squads form a line in front of the command post and hold it.
        const q = this.hq;
        const k = this.squads.filter((s) => s.deployed).length;
        const cx = (q ? q.x + q.w / 2 : this.map.w / 2) + ((k % 3) - 1) * 3;
        u.mode = 'move';
        u.dest = { x: clampTo(cx + (i - (n - 1) / 2) * 0.7, 0.5, this.map.w - 0.5), y: (q ? q.y : this.map.h - 4) - 2 - (i % 2) * 0.5 };
        u.then = 'hold';
      } else if (order.kind === 'fallback') {
        const q = this.hq;
        const off = (i - (n - 1) / 2) * 0.6;
        u.mode = 'move';
        u.dest = { x: (q ? q.x + q.w / 2 : this.map.w / 2) + off, y: q ? q.y - 0.6 : this.map.h - 3 };
        u.then = 'hold';
      } else {
        u.mode = 'charge';
      }
    });
  }

  strikeError(x, y) {
    if (this.over) return 'The battle is over';
    if (!(Number.isFinite(x) && Number.isFinite(y))) return 'Pick a spot';
    const wait = this.artilleryAt - this.t;
    if (wait > 0) return `Artillery is reloading: ${Math.ceil(wait)} s`;
    if (this.budget - this.spent < ARTILLERY.cost) return `Needs ${ARTILLERY.cost} in the military budget`;
    return null;
  }

  // The commander calls in an artillery strike: a few shells land on the spot after a short delay.
  strike(x, y) {
    const err = this.strikeError(x, y);
    if (err) return { error: err };
    this.spent += ARTILLERY.cost;
    this.artilleryAt = this.t + ARTILLERY.cooldown;
    this.strikes.push({ x, y, at: this.t + ARTILLERY.delay, left: ARTILLERY.shells });
    this.addFx({ kind: 'mark', x, y, r: ARTILLERY.radius, life: ARTILLERY.delay + 0.6 });
    return { ok: true };
  }

  // The commander pulls everyone out. The battle is lost, but nobody else falls.
  retreat() {
    if (this.over) return;
    this.finish('att', 'retreat');
  }

  // ---- Time -------------------------------------------------------------------------------

  // Advance by real seconds × speed in fixed steps (nothing happens while paused).
  advance(seconds) {
    if (this.over || this.paused) return;
    this.acc += Math.min(seconds, 0.5);
    while (this.acc >= STEP && !this.over) {
      this.acc -= STEP;
      this.step();
    }
  }

  step() {
    const dt = STEP;
    this.t += dt;
    this.spawnWaves();
    this.think -= dt;
    if (this.think <= 0) {
      this.think = THINK;
      this.attackerMind();
      if (this.auto) this.defenderMind();
    }
    for (const u of this.units) if (u.alive && !u.gone) this.act(u, dt);
    this.separate();
    for (const s of this.structs) if (s.hp > 0 && DEFENCES[s.type].attack) this.turret(s, dt);
    this.flyShells(dt);
    this.landStrikes();
    this.fx = this.fx.filter((f) => this.t - f.t < (f.life || FX_KEEP));
    this.checkEnd();
  }

  spawnWaves() {
    const { w } = this.map;
    for (const wave of this.waves) {
      if (wave.spawned || this.t < wave.at || this.withdrawing) continue;
      wave.spawned = true;
      wave.launch = wave.units.length;
      const n = wave.units.length;
      wave.ids = [];
      wave.units.forEach((m, i) => {
        const x = clampTo(((i + 0.5) / n) * w + (this.rand() - 0.5) * 1.2, 0.5, w - 0.5);
        const y = 0.4 + this.rand() * 1.2;
        const u = this.addUnit('att', m, x, y);
        u.wave = wave.i;
        u.until = this.t + MASS_TIME;
        wave.ids.push(u.id);
      });
      this.addFx({ kind: 'wave', x: w / 2, y: 0, n: wave.i + 1 });
    }
  }

  // The attacking commander: waves that have lost most of their number pull back; a broken attack
  // (morale gone, or out of time) withdraws altogether.
  attackerMind() {
    if (!this.withdrawing && (this.morale.att <= WITHDRAW_MORALE || this.t >= TIME_LIMIT)) {
      this.withdrawing = true;
      this.addFx({ kind: 'withdraw', side: 'att' });
    }
    for (const wave of this.waves) {
      if (!wave.spawned || wave.pulled) continue;
      const alive = wave.ids.map((id) => this.unit(id)).filter((u) => u.alive && !u.gone);
      if (this.withdrawing || (wave.launch >= 3 && alive.length < wave.launch * RETREAT_AT)) {
        wave.pulled = true;
        for (const u of alive) u.mode = 'retreat';
      }
    }
  }

  // The computer commanding the defence (auto-resolve): send squads in as soon as there are
  // attackers to fight, and call artillery on a crowd.
  defenderMind() {
    const foes = this.units.filter((u) => u.side === 'att' && u.alive && !u.gone && u.mode !== 'mass');
    if (!foes.length) return;
    const next = this.squads.find((s) => !s.deployed);
    if (next && !this.deployError(next.id)) this.deploy(next.id);
    if (!this.strikeError(0, 0)) {
      let best = null;
      let most = 2;
      for (const f of foes) {
        const n = foes.filter((g) => dist2(f.x, f.y, g.x, g.y) <= ARTILLERY.radius ** 2).length;
        if (n > most) {
          most = n;
          best = f;
        }
      }
      if (best) this.strike(best.x, best.y);
    }
  }

  // ---- One soldier, one step ---------------------------------------------------------------------

  act(u, dt) {
    const def = UNITS[u.type];
    u.cd -= dt;
    u.moving = false;
    if (u.mode === 'mass') {
      if (this.t >= u.until) u.mode = 'advance';
      else return this.fight(u, def, false);
    }
    if (u.mode === 'retreat') {
      const out = u.side === 'att' ? u.y <= 0.35 : u.y >= this.map.h - 0.35;
      if (out) {
        u.gone = true;
        return;
      }
      this.walk(u, def.speed * 1.15, this.field(u.side === 'att' ? 'north' : 'south'), { x: u.x, y: u.side === 'att' ? 0 : this.map.h }, dt);
      return;
    }
    if (def.heal) this.heal(u, def, dt);
    const tgt = this.fight(u, def, u.mode === 'move');
    if (u.mode === 'advance') {
      if (!tgt) this.walk(u, def.speed, this.field('hq'), null, dt);
    } else if (u.mode === 'move') {
      const d = u.dest;
      if (dist2(u.x, u.y, d.x, d.y) < 0.04) {
        u.mode = u.then || 'hold';
        u.then = null;
        u.anchor = { x: d.x, y: d.y };
      } else this.walk(u, def.speed, this.field(`p:${Math.floor(d.x)},${Math.floor(d.y)}`), d, dt);
    } else if (u.mode === 'charge') {
      if (!tgt) {
        const foe = this.nearestFoe(u);
        if (foe) this.walk(u, def.speed, this.field(`p:${Math.floor(foe.x)},${Math.floor(foe.y)}`), foe, dt);
        else if (u.side === 'def') u.mode = 'hold';
      }
    } else if (u.mode === 'hold') {
      const a = u.anchor || (u.anchor = { x: u.x, y: u.y });
      if (!tgt) {
        // Guards step out to meet an enemy close to their post, then go back to it.
        const foe = this.nearestFoe(u);
        const reach = def.attack.range + LEASH;
        if (foe && dist2(foe.x, foe.y, a.x, a.y) < reach * reach && dist2(u.x, u.y, a.x, a.y) < LEASH * LEASH) this.walk(u, def.speed, this.field(`p:${Math.floor(foe.x)},${Math.floor(foe.y)}`), foe, dt);
        else if (dist2(u.x, u.y, a.x, a.y) > 0.05) this.walk(u, def.speed, this.field(`p:${Math.floor(a.x)},${Math.floor(a.y)}`), a, dt);
      }
    }
  }

  nearestFoe(u) {
    let best = null;
    let bd = Infinity;
    for (const o of this.units) {
      if (o.side === u.side || !o.alive || o.gone) continue;
      const d = dist2(u.x, u.y, o.x, o.y);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    if (!best && u.side === 'att') {
      const q = this.hq;
      if (q && q.hp > 0) return { x: q.x + q.w / 2, y: q.y + q.h / 2 };
    }
    return best;
  }

  // Walk along a flow field (or straight at `point` once on its tile).
  walk(u, speed, field, point, dt) {
    const tx = Math.floor(u.x);
    const ty = Math.floor(u.y);
    let gx;
    let gy;
    const next = nextTile(field, tx, ty);
    if (next) {
      gx = next.x + 0.5;
      gy = next.y + 0.5;
    } else if (point) {
      gx = point.x;
      gy = point.y;
    } else return;
    const dx = gx - u.x;
    const dy = gy - u.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-4) return;
    const step = Math.min(d, speed * dt);
    this.moveBy(u, (dx / d) * step, (dy / d) * step);
    u.face = Math.atan2(dy, dx);
    u.moving = true;
  }

  // Move, sliding along walls rather than stopping dead.
  moveBy(u, dx, dy) {
    const nx = u.x + dx;
    const ny = u.y + dy;
    const inside = (x, y) => this.blocked(Math.floor(x), Math.floor(y));
    if (!inside(nx, ny)) {
      u.x = nx;
      u.y = ny;
    } else if (!inside(nx, u.y)) u.x = nx;
    else if (!inside(u.x, ny)) u.y = ny;
    u.x = clampTo(u.x, 0.05, this.map.w - 0.05);
    u.y = clampTo(u.y, 0.05, this.map.h - 0.05);
  }

  // Soldiers keep a little space between them.
  separate() {
    const list = this.units.filter((u) => u.alive && !u.gone);
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= SPACE * SPACE) continue;
        const d = Math.sqrt(d2) || 0.01;
        const push = (SPACE - d) / 2;
        const ux = d2 ? dx / d : 1;
        const uy = d2 ? dy / d : 0;
        this.moveBy(a, -ux * push, -uy * push);
        this.moveBy(b, ux * push, uy * push);
      }
    }
  }

  // Pick the most worthwhile target in range and fire when ready (also on the move, less accurately).
  fight(u, def, onTheMove) {
    const a = def.attack;
    const t = this.pickTarget(u, a.range);
    u.tgt = t ? (t.isStruct ? `s${t.id}` : t.id) : null;
    if (!t) return null;
    const tx = t.isStruct ? t.x + t.w / 2 : t.x;
    const ty = t.isStruct ? t.y + t.h / 2 : t.y;
    if (!onTheMove) u.face = Math.atan2(ty - u.y, tx - u.x);
    if (u.cd <= 0) {
      u.cd = 1 / a.rate;
      u.fired = this.t;
      const base = a.dmg * u.mult;
      if (a.kind === 'bullet') this.shoot(u, t, base, a, onTheMove ? 0.6 : 1);
      else this.lob(u, tx, ty, base, a, 0.35);
    }
    return t;
  }

  // Score everything in range: close is good, the wounded and anything shooting back are better,
  // walls are a last resort (the target-choice pattern from Ugh-Guys, our own weights).
  pickTarget(u, range) {
    let best = null;
    let bs = -Infinity;
    const r2 = range * range;
    for (const o of this.units) {
      if (o.side === u.side || !o.alive || o.gone) continue;
      const d2 = dist2(u.x, u.y, o.x, o.y);
      if (d2 > r2) continue;
      const s = -Math.sqrt(d2) * 1.2 + (1 - o.hp / o.maxHp) * 4 + 3 + vsBonus(u, UNITS[o.type].tags) * 5;
      if (s > bs) {
        bs = s;
        best = o;
      }
    }
    if (u.side === 'att') {
      for (const st of this.structs) {
        if (st.hp <= 0) continue;
        const cx = clampTo(u.x, st.x, st.x + st.w);
        const cy = clampTo(u.y, st.y, st.y + st.h);
        const d2 = dist2(u.x, u.y, cx, cy);
        if (d2 > r2) continue;
        const d = DEFENCES[st.type];
        let s = -Math.sqrt(d2) * 1.2 + vsBonus(u, d.tags) * 5;
        s += d.attack ? 1.5 : -6;
        if (st.type === 'hq') s += 1;
        if (s > bs) {
          bs = s;
          best = { ...st, isStruct: true, ref: st };
        }
      }
    }
    return best;
  }

  shoot(u, t, base, a, steady) {
    const hit = this.rand() < ACCURACY * steady;
    const tx = t.isStruct ? t.x + t.w / 2 : t.x;
    const ty = t.isStruct ? t.y + t.h / 2 : t.y;
    this.addFx({ kind: 'shot', x: u.x, y: u.y, x2: tx + (hit ? 0 : (this.rand() - 0.5) * 0.8), y2: ty + (hit ? 0 : (this.rand() - 0.5) * 0.8), side: u.side, life: 0.12 });
    if (hit) this.damage(t.isStruct ? t.ref : t, base, a.vs, u);
  }

  // Throw or lob something that lands a little later, wherever it was aimed (plus a little scatter).
  lob(src, tx, ty, base, a, scatter) {
    const sx = src.x + (src.w ? src.w / 2 : 0);
    const sy = src.y + (src.h ? src.h / 2 : 0);
    const d = Math.hypot(tx - sx, ty - sy);
    const shell = a.kind === 'shell';
    this.shells.push({
      id: this.nextId++,
      kind: a.kind,
      side: src.side || 'def',
      from: src.isUnit === false ? null : src.id,
      x0: sx,
      y0: sy,
      x1: tx + (this.rand() - 0.5) * scatter * 2,
      y1: ty + (this.rand() - 0.5) * scatter * 2,
      t0: this.t,
      dur: shell ? 1 + d / 12 : 0.45 + d / 10,
      arc: shell ? 3 : 1.1,
      dmg: base,
      splash: a.splash || 0.6,
      vs: a.vs || null,
    });
  }

  flyShells() {
    for (const s of this.shells) {
      if (this.t - s.t0 < s.dur) continue;
      s.done = true;
      this.explode(s.x1, s.y1, s.splash, s.dmg, s.vs, s.side, this.unit(s.from));
    }
    this.shells = this.shells.filter((s) => !s.done);
  }

  landStrikes() {
    for (const k of this.strikes) {
      if (this.t < k.at || k.left <= 0) continue;
      k.left--;
      k.at = this.t + 0.35;
      const x = k.x + (this.rand() - 0.5) * ARTILLERY.spread * 2;
      const y = k.y + (this.rand() - 0.5) * ARTILLERY.spread * 2;
      this.explode(x, y, ARTILLERY.radius, ARTILLERY.dmg, { structure: 0.3 }, 'def', null, true);
    }
    this.strikes = this.strikes.filter((k) => k.left > 0);
  }

  // Splash: full damage in the middle, half at the edge, to the thrower's enemies only.
  explode(x, y, r, dmg, vs, side, by, big = false) {
    this.addFx({ kind: 'boom', x, y, r, big, life: 0.7 });
    for (const o of this.units) {
      if (o.side === side || !o.alive || o.gone) continue;
      const d = Math.sqrt(dist2(x, y, o.x, o.y));
      if (d <= r) this.damage(o, dmg * (1 - 0.5 * (d / r)), vs, by);
    }
    if (side === 'att') {
      for (const st of this.structs) {
        if (st.hp <= 0) continue;
        const cx = clampTo(x, st.x, st.x + st.w);
        const cy = clampTo(y, st.y, st.y + st.h);
        const d = Math.sqrt(dist2(x, y, cx, cy));
        if (d <= r) this.damage(st, dmg * (1 - 0.5 * (d / r)), vs, by);
      }
    }
  }

  // Damage after the target's tags and armour (never less than 1), and less for anyone in cover.
  damage(t, base, vs, by) {
    const isStruct = !!DEFENCES[t.type];
    const def = isStruct ? DEFENCES[t.type] : UNITS[t.type];
    let mult = 1;
    if (vs) for (const tag of def.tags) mult *= vs[tag] ?? 1;
    let d = Math.max(1, base * mult - (def.armor || 0));
    if (!isStruct && t.side === 'def' && (this.inCover(t) || this.dugIn(t))) d *= COVER;
    t.hp -= d;
    if (by) by.dealt += d;
    if (t.hp > 0) return;
    t.hp = 0;
    if (isStruct) return this.wreck(t);
    this.down(t, by);
  }

  inCover(u) {
    for (const s of this.structs) {
      if (s.hp <= 0 || !DEFENCES[s.type].cover) continue;
      const cx = clampTo(u.x, s.x, s.x + s.w);
      const cy = clampTo(u.y, s.y, s.y + s.h);
      if (dist2(u.x, u.y, cx, cy) < 0.81) return true;
    }
    return false;
  }

  // A guard holding their own post is dug in there (a foxhole), as good as cover.
  dugIn(u) {
    return u.squad === 'guard' && u.mode === 'hold' && !!u.anchor && dist2(u.x, u.y, u.anchor.x, u.anchor.y) < 0.3;
  }

  down(u, by) {
    u.alive = false;
    u.mode = 'down';
    this.lost[u.side]++;
    // Did they survive their wounds? More often with a medic in the battle.
    u.fate = this.rand() < (this.medic[u.side] ? SURVIVE_MEDIC : SURVIVE) ? 'injured' : 'killed';
    if (by) by.kills++;
    const total = u.side === 'att' ? this.attTotal : this.defTotal;
    const hit = u.side === 'att' ? 110 : 80;
    this.morale[u.side] = clampM(this.morale[u.side] - hit / Math.max(4, total));
    this.morale[u.side === 'att' ? 'def' : 'att'] = clampM(this.morale[u.side === 'att' ? 'def' : 'att'] + 1.5);
    this.addFx({ kind: 'down', x: u.x, y: u.y, side: u.side, life: 1.2 });
  }

  wreck(s) {
    this.blockRev++;
    this.morale.def = clampM(this.morale.def - (s.type === 'hq' ? 0 : 4));
    this.addFx({ kind: 'wreck', x: s.x + s.w / 2, y: s.y + s.h / 2, r: Math.max(s.w, s.h), life: 1.4 });
  }

  heal(u, def, dt) {
    if (this.t - u.fired < 0.4) return;
    let best = null;
    let need = 0;
    const r2 = def.heal.range ** 2;
    for (const o of this.units) {
      if (o.side !== u.side || !o.alive || o.gone || o === u) continue;
      if (dist2(u.x, u.y, o.x, o.y) > r2) continue;
      const n = o.maxHp - o.hp;
      if (n > need) {
        need = n;
        best = o;
      }
    }
    if (!best || need < 1) return;
    best.hp = Math.min(best.maxHp, best.hp + def.heal.rate * dt);
    u.healing = best.id;
    if (Math.floor(this.t * 2) !== Math.floor((this.t - dt) * 2)) this.addFx({ kind: 'heal', x: best.x, y: best.y, life: 0.6 });
  }

  // A defence picks the attacker closest to the command post ("first") and fires.
  turret(s, dt) {
    const a = DEFENCES[s.type].attack;
    s.cd -= dt;
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2;
    const reach = a.range + Math.max(s.w, s.h) / 2;
    const r2 = reach * reach;
    const min2 = (a.min || 0) ** 2;
    const f = this.field('hq');
    let best = null;
    let bd = Infinity;
    for (const o of this.units) {
      if (o.side !== 'att' || !o.alive || o.gone) continue;
      const d2 = dist2(cx, cy, o.x, o.y);
      if (d2 > r2 || d2 < min2) continue;
      const along = distanceAt(f, o.x, o.y);
      const score = Number.isFinite(along) ? along : 999 + d2;
      if (score < bd) {
        bd = score;
        best = o;
      }
    }
    s.tgt = best ? best.id : null;
    if (!best || s.cd > 0) return;
    s.cd = 1 / a.rate;
    s.fired = this.t;
    const base = a.dmg * levelDmg(s.level);
    if (a.kind === 'bullet') {
      const hit = this.rand() < ACCURACY;
      this.addFx({ kind: 'shot', x: cx, y: cy, x2: best.x, y2: best.y, side: 'def', life: 0.12, heavy: s.type !== 'mg' });
      if (hit) this.damage(best, base, a.vs, null);
    } else this.lob({ ...s, side: 'def', isUnit: false }, best.x, best.y, base, a, 0.6);
  }

  // ---- The end ---------------------------------------------------------------------------------

  checkEnd() {
    if (this.over) return;
    const q = this.hq;
    if (q && q.hp <= 0) return this.finish('att', 'hq');
    const defs = this.units.filter((u) => u.side === 'def' && u.alive && !u.gone);
    const waiting = this.squads.some((s) => !s.deployed);
    if (!this.routing && this.hadDefenders && this.morale.def <= ROUT_MORALE) {
      this.routing = true;
      for (const u of defs) u.mode = 'retreat';
      this.addFx({ kind: 'withdraw', side: 'def' });
    }
    // The defending army is beaten when no soldier is left, none wait in reserve, and every armed defence has fallen.
    const armed = this.structs.some((s) => s.hp > 0 && s.type !== 'hq' && DEFENCES[s.type].attack);
    if (this.hadDefenders && !defs.length && (this.routing || (!waiting && !armed))) return this.finish('att', this.routing ? 'routed' : 'army');
    const pending = this.waves.some((w) => !w.spawned) && !this.withdrawing;
    const atts = this.units.some((u) => u.side === 'att' && u.alive && !u.gone);
    if (!pending && !atts) return this.finish('def', this.withdrawing || this.units.some((u) => u.side === 'att' && u.gone) ? 'withdrew' : 'repelled');
  }

  finish(winner, reason) {
    this.over = true;
    this.paused = false;
    const sides = { att: [], def: [] };
    for (const u of this.units) {
      let fate = 'ok';
      if (!u.alive) fate = u.fate;
      else if (u.hp < u.maxHp * 0.5) fate = 'hurt';
      const won = u.side === winner;
      const xp = Math.round(u.kills * 12 + u.dealt / 25 + (u.alive ? 6 : 0) + (won ? 6 : 0));
      sides[u.side].push({ id: u.sid, type: u.type, fate, xp, kills: u.kills });
    }
    this.result = {
      winner,
      reason,
      time: Math.round(this.t),
      attacker: { soldiers: sides.att, lost: this.lost.att, total: this.attTotal, unsent: this.waves.filter((w) => !w.spawned).reduce((n, w) => n + w.units.length, 0) },
      defender: { soldiers: sides.def, lost: this.lost.def, total: this.defTotal, spent: this.spent, structures: this.structs.map((s) => ({ id: s.id, type: s.type, hp: Math.round(s.hp), maxHp: s.maxHp, wrecked: s.hp <= 0 })) },
    };
    this.addFx({ kind: 'end', winner });
  }

  // Fight the rest of the battle out with the computer commanding both sides.
  resolve(maxSeconds = TIME_LIMIT + 120) {
    this.auto = true;
    this.paused = false;
    const end = this.t + maxSeconds;
    while (!this.over && this.t < end) this.step();
    if (!this.over) this.finish('def', 'withdrew');
    return this.result;
  }

  addFx(f) {
    f.id = ++this.fxId;
    f.t = this.t;
    this.fx.push(f);
  }

  // ---- What the screen shows ---------------------------------------------------------------------

  status() {
    const spawned = this.waves.filter((w) => w.spawned).length;
    const nextWave = this.waves.find((w) => !w.spawned);
    return {
      t: this.t,
      wave: spawned,
      waves: this.waves.length,
      nextWaveIn: nextWave && !this.withdrawing ? Math.max(0, nextWave.at - this.t) : null,
      morale: { ...this.morale },
      attackers: this.units.filter((u) => u.side === 'att' && u.alive && !u.gone).length,
      defenders: this.units.filter((u) => u.side === 'def' && u.alive && !u.gone).length,
      reinforceIn: Math.max(0, this.reinforceAt - this.t),
      artilleryIn: Math.max(0, this.artilleryAt - this.t),
      budget: this.budget - this.spent,
      withdrawing: this.withdrawing,
      routing: this.routing,
      hq: this.hq ? this.hq.hp / this.hq.maxHp : 0,
    };
  }

  // ---- Saving a battle half-way --------------------------------------------------------------------

  toJSON() {
    const { fields, acc, selected, ...rest } = this;
    return JSON.parse(JSON.stringify(rest));
  }

  restore(data) {
    Object.assign(this, JSON.parse(JSON.stringify(data)));
    this.fields = new Map();
    this.acc = 0;
    this.paused = true; // a resumed battle waits for the commander
    this.selected = null;
    return this;
  }

  static fromJSON(data) {
    if (!data || data.v !== BATTLE_VERSION || !Array.isArray(data.units) || !Array.isArray(data.structs)) return null;
    return new Battle(null, data);
  }
}

function clampM(v) {
  return Math.max(0, Math.min(100, v));
}
function clampTo(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
function vsBonus(u, tags) {
  const vs = UNITS[u.type].attack.vs;
  if (!vs) return 0;
  let m = 1;
  for (const t of tags) m *= vs[t] ?? 1;
  return m - 1;
}
