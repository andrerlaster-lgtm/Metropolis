// Extreme weather: from a passing thunderstorm to a tornado that flattens a street.
//
//   severe  thunderstorm  lightning strikes tall buildings and trees
//           heatwave      trees wither, the odd building catches fire, everyone is grumpy
//           blizzard      roads are snowed in (no driving) until it ends; weak roofs give way
//   extreme flood         land near water floods: roads wash out, buildings are damaged
//           tornado       a twister crosses the map and flattens what it touches
//           hurricane     wind and rain over the whole town, plus flooding by the water
//
// Extreme events come with a warning a few hours ahead and a choice to prepare (which halves the
// damage). Damage is stored on the structure: `damage` 0..1 (a third or more halves what the building
// can hold), roads `broken` (washed out) or `snowed` (snowed in), and a building at full damage turns
// into rubble. Crews then repair things one at a time, paid from the town budget, or the player pays
// to repair everything at once, or builds over the damage. Fire stations nearby soften the blow.
//
// How often it happens is a per-town setting: off, gentle (default) or wild.
// Saved in city.systems.disasters = { level, next, active, pending, prepared, resilience, levee, log }.

import { STRUCTURES, COSTS } from './config.js';
import { seasonFor } from './weather.js';
import { addChronicle } from './chronicle.js';
import { yearOf } from './eras.js';
import { clamp, pickWeighted } from './utils.js';

export const LEVELS = { off: 0, gentle: 1, wild: 2.6 };

export const KINDS = {
  storm: { label: 'Thunderstorm', severity: 'severe', days: 0.12, icon: '⚡' },
  heatwave: { label: 'Heatwave', severity: 'severe', days: 0.5, icon: '☀' },
  blizzard: { label: 'Blizzard', severity: 'severe', days: 0.3, icon: '❄' },
  flood: { label: 'Flood', severity: 'extreme', days: 0.3, icon: '≋', warn: 'The river is rising fast.' },
  tornado: { label: 'Tornado', severity: 'extreme', days: 0.08, icon: '🌪', warn: 'A funnel cloud has been spotted.' },
  hurricane: { label: 'Hurricane', severity: 'extreme', days: 0.25, icon: '🌀', warn: 'A hurricane is heading for the coast.' },
};

// Chance per check (two checks a day) at the gentle level, by season.
const ODDS = {
  spring: { storm: 0.06, flood: 0.03, tornado: 0.02 },
  summer: { storm: 0.08, heatwave: 0.05, tornado: 0.015, hurricane: 0.01 },
  autumn: { storm: 0.04, flood: 0.02, hurricane: 0.02 },
  winter: { blizzard: 0.07 },
};

const WARNING_DAYS = 0.12; // about three in-game hours of warning before an extreme event
const CHECK_DAYS = 0.5;
const COOLDOWN_DAYS = 4; // a breather after an extreme event
const REPAIR_EVERY_DAYS = 0.03; // crews fix one thing roughly every in-game 45 minutes

// How much of a damaged structure still works: homes hold, and workplaces employ, this share.
export function soundness(s) {
  if (!s) return 0;
  if (s.type === 'rubble') return 0;
  const d = s.damage || 0;
  return d < 0.34 ? 1 : d < 1 ? 0.5 : 0;
}

const now = (city) => city.day + city.clock;

// A nearby fire station puts out fires and lightning blazes before they spread (up to 70% less damage)
// and helps with everything else (up to 30% less).
export function fireCover(tile, cause) {
  const c = tile.coverage?.fire || 0;
  return 1 - c * (cause === 'fire' || cause === 'lightning' ? 0.7 : 0.3);
}
const isBuilding = (s) => !!s && s.type !== 'road' && s.type !== 'rubble' && !STRUCTURES[s.type].walkable;

export class Disasters {
  constructor(city, { economy, decisions, eras, rng = Math.random } = {}) {
    this.city = city;
    this.economy = economy;
    this.decisions = decisions;
    this.eras = eras;
    this.rng = rng;
    this._repairTimer = 0;
  }

  get state() {
    const s = this.city.systems;
    if (!s.disasters) s.disasters = { level: 'gentle', next: now(this.city) + 1, active: null, pending: null, prepared: false, resilience: 1, levee: false, log: [] };
    return s.disasters;
  }

  get level() {
    return this.state.level || 'gentle';
  }

  set level(v) {
    this.state.level = LEVELS[v] != null ? v : 'gentle';
    if (v === 'off') this.state.pending = null;
  }

  get active() {
    return this.state.active;
  }

  // The town's upgrades (skills.js), as the simulation last worked them out.
  get skills() {
    return this.city.derived?.skills || {};
  }

  // ---- Deciding what comes ---------------------------------------------------------------

  // Called every simulation tick with the game seconds that passed.
  update(dt) {
    const st = this.state;
    const t = now(this.city);
    if (st.active) {
      this.run(st.active, dt);
      if (t >= st.active.ends) this.finish();
      return;
    }
    if (st.pending && t >= st.pending.at) {
      this.start(st.pending.kind);
      return;
    }
    this._repairTimer -= dt / 300; // dt is game seconds; a day is 300
    if (this._repairTimer <= 0) {
      this._repairTimer = REPAIR_EVERY_DAYS / (this.skills.repairSpeed || 1); // Public works (skills.js)
      this.repairOne();
    }
    if (st.pending || t < st.next) return;
    st.next = t + CHECK_DAYS;
    const kind = this.roll();
    if (!kind) return;
    if (KINDS[kind].severity === 'extreme') this.warn(kind);
    else this.start(kind);
  }

  // Which event (if any) this check brings, from the season, the setting and the town's size.
  roll() {
    const mult = LEVELS[this.level] || 0;
    if (!mult) return null;
    const st = this.state;
    const pop = this.city.stats?.population || 0;
    if (pop < 10) return null;
    const t = now(this.city);
    const founded = this.city.systems.era?.foundedDay ?? 0;
    const canExtreme = pop >= 25 && t - founded >= 3 && t >= (st.cooldownUntil || 0);
    const hasWater = this.city.tiles.some((x) => x.terrain === 'water');
    const odds = ODDS[seasonFor(this.city.day).id] || {};
    for (const [kind, p] of Object.entries(odds)) {
      if (KINDS[kind].severity === 'extreme' && !canExtreme) continue;
      if ((kind === 'flood' || kind === 'hurricane') && !hasWater) continue;
      if (this.rng() < p * mult) return kind;
    }
    return null;
  }

  // A warning a few hours ahead, with the choice to prepare.
  warn(kind) {
    const st = this.state;
    st.pending = { kind, at: now(this.city) + WARNING_DAYS * (this.skills.warning || 1) }; // Weather watchers (skills.js)
    st.prepared = false;
    this.city.emit('weatherWarning', { kind, info: KINDS[kind] });
    if (this.decisions && !this.decisions.state.pending) this.decisions.ask(`prepare-${kind}`);
  }

  prepare() {
    this.state.prepared = true;
  }

  // ---- During the event ------------------------------------------------------------------

  start(kind) {
    const st = this.state;
    const info = KINDS[kind];
    const t = now(this.city);
    // An unanswered "prepare?" question is settled as "ride it out" once the weather arrives.
    const q = this.decisions?.state.pending;
    if (q && q.id === `prepare-${kind}`) this.decisions.choose(1, { lapsed: true });
    st.pending = null;
    const a = { kind, started: t, ends: t + info.days * (0.8 + this.rng() * 0.4), timer: 0, report: { damaged: 0, destroyed: 0, roads: 0, trees: 0, places: [] } };
    if (kind === 'flood' || kind === 'hurricane') a.flooded = this.floodZone(kind === 'flood' ? 2 : 1);
    if (kind === 'tornado') a.path = this.tornadoPath();
    if (kind === 'blizzard') {
      for (const tile of this.city.tiles) {
        const s = tile.structure;
        if (s?.type === 'road' && this.rng() < 0.25) {
          s.snowed = true;
          this.city._changed(tile.x, tile.y);
        }
      }
    }
    st.active = a;
    this.city.systems.weather = { kind, ends: a.ends, severe: true };
    // Bad weather dents how people feel about the town while it lasts.
    const dent = { storm: -0.02, heatwave: -0.05, blizzard: -0.04, flood: -0.06, tornado: -0.05, hurricane: -0.08 }[kind];
    this.decisions?.state.effects.push({ amount: dent, until: a.ends + 0.3, id: `weather-${kind}` });
    this.city.emit('extremeWeather', { kind, info, phase: 'start' });
  }

  run(a, dt) {
    const kind = a.kind;
    a.timer -= dt;
    if (kind === 'storm') {
      if (a.timer <= 0) {
        a.timer = 4 + this.rng() * 7;
        this.lightning(a);
      }
    } else if (kind === 'heatwave') {
      if (a.timer <= 0) {
        a.timer = 15 + this.rng() * 10;
        const trees = this.city.tiles.filter((t) => t.structure?.type === 'tree');
        if (trees.length && this.rng() < 0.4) this.hit(trees[Math.floor(this.rng() * trees.length)], 1, a, 'withered');
        if (this.rng() < 0.18) {
          const b = this.pickBuilding();
          if (b) {
            b.structure.burning = now(this.city) + 0.06;
            this.hit(b, 0.5 + this.rng() * 0.6, a, 'fire');
            this.city.emit('disasterHit', { kind: 'fire', x: b.x, y: b.y });
          }
        }
      }
    } else if (kind === 'blizzard') {
      if (a.timer <= 0) {
        a.timer = 20 + this.rng() * 15;
        const weak = this.city.tiles.filter((t) => t.structure?.type === 'cottage' || t.structure?.type === 'house');
        if (weak.length && this.rng() < 0.5) this.hit(weak[Math.floor(this.rng() * weak.length)], 0.2 + this.rng() * 0.25, a, 'roof');
      }
    } else if (kind === 'flood' || kind === 'hurricane') {
      if (a.timer <= 0) {
        a.timer = kind === 'flood' ? 1.2 + this.rng() * 1.3 : 2 + this.rng() * 2;
        const zone = (a.flooded || []).map((i) => this.city.tiles[i]).filter((t) => t.structure && t.structure.type !== 'rubble' && t.structure.type !== 'tree');
        if (zone.length) {
          const tile = zone[Math.floor(this.rng() * zone.length)];
          const levee = this.state.levee ? 0.3 : 1;
          if (tile.structure?.type === 'road') this.hit(tile, 0.6 * levee, a, 'washed');
          else this.hit(tile, (0.25 + this.rng() * 0.3) * levee, a, 'flood');
        }
        if (kind === 'hurricane') {
          const b = this.pickBuilding(true);
          if (b) this.hit(b, 0.3 + this.rng() * 0.4, a, 'wind');
          if (this.rng() < 0.5) {
            const trees = this.city.tiles.filter((t) => t.structure?.type === 'tree');
            if (trees.length) this.hit(trees[Math.floor(this.rng() * trees.length)], 1, a, 'wind');
          }
        }
      }
    } else if (kind === 'tornado') {
      this.twister(a);
    }
  }

  lightning(a) {
    const city = this.city;
    const tall = city.tiles.filter((t) => t.structure && (STRUCTURES[t.structure.type].height || 0) >= 20 && t.structure.type !== 'rubble');
    const target = pickWeighted(tall, (t) => (STRUCTURES[t.structure.type].height || 0) + (t.structure.floors || 0) * 8, this.rng);
    if (!target) return;
    city.emit('lightning', { x: target.x, y: target.y });
    if (this.rng() < 0.55) this.hit(target, target.structure.type === 'tree' ? 1 : 0.3 + this.rng() * 0.35, a, 'lightning');
  }

  // A twister sweeps across the map along a path through town, flattening what it touches.
  tornadoPath() {
    const city = this.city;
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const t of city.tiles) {
      if (isBuilding(t.structure)) {
        sx += t.x;
        sy += t.y;
        n++;
      }
    }
    const cx = n ? sx / n : city.width / 2;
    const cy = n ? sy / n : city.height / 2;
    const angle = this.rng() * Math.PI * 2;
    const reach = Math.max(city.width, city.height) * 0.75;
    const off = (this.rng() - 0.5) * 6; // not always straight through the middle
    const px = Math.cos(angle + Math.PI / 2) * off;
    const py = Math.sin(angle + Math.PI / 2) * off;
    return { x0: cx + px - Math.cos(angle) * reach, y0: cy + py - Math.sin(angle) * reach, x1: cx + px + Math.cos(angle) * reach, y1: cy + py + Math.sin(angle) * reach, wobble: this.rng() * 10, hit: [] };
  }

  tornadoPos(a) {
    const p = a.path;
    const f = clamp((now(this.city) - a.started) / (a.ends - a.started), 0, 1);
    const wob = Math.sin(f * 9 + p.wobble) * 1.4;
    const dx = p.x1 - p.x0;
    const dy = p.y1 - p.y0;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x0 + dx * f + (-dy / len) * wob, y: p.y0 + dy * f + (dx / len) * wob, f };
  }

  // The edge of the funnel damages what it passes; the core, a little later, flattens it.
  twister(a) {
    const pos = this.tornadoPos(a);
    a.pos = pos;
    const W = this.city.width;
    const edge = new Set(a.path.hit);
    const core = new Set(a.path.core || (a.path.core = []));
    const r = 1.4;
    for (let y = Math.floor(pos.y - r); y <= Math.ceil(pos.y + r); y++) {
      for (let x = Math.floor(pos.x - r); x <= Math.ceil(pos.x + r); x++) {
        const tile = this.city.getTile(x, y);
        if (!tile) continue;
        const k = tile.y * W + tile.x;
        const d = Math.hypot(x + 0.5 - pos.x, y + 0.5 - pos.y);
        if (d <= 0.85 && !core.has(k)) {
          core.add(k);
          a.path.core.push(k);
          if (tile.structure) this.hit(tile, 0.75 + this.rng() * 0.35, a, 'tornado');
        } else if (d <= r && !edge.has(k)) {
          edge.add(k);
          a.path.hit.push(k);
          if (tile.structure) this.hit(tile, 0.3 + this.rng() * 0.2, a, 'tornado');
        }
      }
    }
  }

  floodZone(dist) {
    const city = this.city;
    const out = [];
    for (const t of city.tiles) {
      if (t.terrain === 'water') continue;
      let near = false;
      for (let dy = -dist; dy <= dist && !near; dy++) for (let dx = -dist; dx <= dist && !near; dx++) if (Math.abs(dx) + Math.abs(dy) <= dist && city.getTile(t.x + dx, t.y + dy)?.terrain === 'water') near = true;
      if (near) out.push(t.y * city.width + t.x);
    }
    return out;
  }

  pickBuilding(anyKind = false) {
    const list = this.city.tiles.filter((t) => isBuilding(t.structure) && (anyKind || STRUCTURES[t.structure.type].capacity || STRUCTURES[t.structure.type].jobs));
    return list.length ? list[Math.floor(this.rng() * list.length)] : null;
  }

  // ---- Damage ----------------------------------------------------------------------------

  // Damage one tile. Trees fall, roads wash out, buildings crack and at full damage become rubble.
  hit(tile, amount, a, cause) {
    const city = this.city;
    const s = tile.structure;
    if (!s || s.type === 'rubble') return;
    const def = STRUCTURES[s.type];
    const st = this.state;
    const report = a?.report;
    const name = tile.address || tile.street || null;
    if (s.type === 'tree') {
      if (amount >= 0.3) {
        city.apply('bulldoze', tile.x, tile.y, { delay: 0.6 });
        if (report) report.trees++;
      }
      return;
    }
    // Upgrades (skills.js): Storm shutters, Flood banks, Firebreaks, Resilient town.
    const sk = this.skills;
    const flood = cause === 'flood' || cause === 'washed';
    const burn = cause === 'fire' || cause === 'lightning';
    amount *= flood ? sk.flood ?? 1 : burn ? sk.fire ?? 1 : sk.damage ?? 1;
    if (s.type === 'road') {
      s.damage = clamp((s.damage || 0) + amount, 0, 1);
      if (s.damage >= 0.5 && !s.broken) {
        s.broken = true;
        city._changed(tile.x, tile.y);
        if (report) report.roads++;
        city.emit('disasterHit', { kind: cause, x: tile.x, y: tile.y, road: true });
      }
      return;
    }
    if (def.walkable) return; // parks, playgrounds and fields shrug it off
    const scale = (st.prepared && a?.kind && KINDS[a.kind].severity === 'extreme' ? 0.5 : 1) * (st.resilience ?? 1) * fireCover(tile, cause);
    const before = s.damage || 0;
    s.damage = clamp(before + amount * scale, 0, 1);
    if (s.damage >= 1) {
      const previous = s;
      tile.structure = { id: city.nextId++, type: 'rubble', residents: 0, was: previous.type };
      city._changed(tile.x, tile.y);
      city.emit('removed', { x: tile.x, y: tile.y, previous, delay: 0.6, disaster: true });
      if (report) {
        report.destroyed++;
        if (report.places.length < 8) report.places.push({ x: tile.x, y: tile.y, name, destroyed: true, type: previous.type });
      }
      city.emit('disasterHit', { kind: cause, x: tile.x, y: tile.y, destroyed: true });
    } else {
      // A home that lost half its rooms loses some residents straight away.
      if (s.damage >= 0.34 && before < 0.34 && def.capacity) s.residents = Math.min(s.residents, Math.floor(def.capacity * 0.5));
      city.dirty = true;
      if (report && before < 0.15 && s.damage >= 0.15) {
        report.damaged++;
        if (report.places.length < 8) report.places.push({ x: tile.x, y: tile.y, name, type: s.type });
      }
      city.emit('disasterHit', { kind: cause, x: tile.x, y: tile.y });
    }
  }

  finish() {
    const st = this.state;
    const a = st.active;
    if (!a) return;
    st.active = null;
    st.prepared = false;
    for (const tile of this.city.tiles) {
      if (tile.structure?.snowed) {
        delete tile.structure.snowed;
        this.city._changed(tile.x, tile.y);
      }
      if (tile.structure?.burning) delete tile.structure.burning;
    }
    const info = KINDS[a.kind];
    if (info.severity === 'extreme') st.cooldownUntil = now(this.city) + COOLDOWN_DAYS;
    this.city.systems.weather = { kind: a.kind === 'blizzard' ? 'snow' : a.kind === 'heatwave' ? 'clear' : 'cloudy', ends: now(this.city) + 0.1 };
    const r = a.report;
    const total = r.damaged + r.destroyed + r.roads;
    const entry = { kind: a.kind, year: yearOf(this.city), day: this.city.day, ...r, cost: this.repairCost().total };
    st.log = [...(st.log || []), entry].slice(-20);
    if (info.severity === 'extreme' || total >= 3) {
      const bits = [];
      if (r.destroyed) bits.push(`${r.destroyed} building${r.destroyed > 1 ? 's' : ''} destroyed`);
      if (r.damaged) bits.push(`${r.damaged} damaged`);
      if (r.roads) bits.push(`${r.roads} road${r.roads > 1 ? 's' : ''} washed out`);
      if (r.trees) bits.push(`${r.trees} tree${r.trees > 1 ? 's' : ''} down`);
      const place = r.places.find((p) => p.name)?.name;
      addChronicle(this.city, `A ${info.label.toLowerCase()} hit the town${place ? ` around ${place.replace(/^\d+\s+/, '')}` : ''}: ${bits.length ? bits.join(', ') : 'luckily, little damage'}.`, r.places[0] || null, 'disaster');
    }
    this.city.emit('extremeWeather', { kind: a.kind, info, phase: 'end', report: r });
  }

  // ---- Repairs ----------------------------------------------------------------------------

  // Everything that needs fixing, with what it costs. Roads first, then homes, then the rest.
  repairList() {
    const out = [];
    for (const t of this.city.tiles) {
      const s = t.structure;
      if (!s) continue;
      if (s.type === 'road' && (s.broken || (s.damage || 0) > 0)) out.push({ t, cost: Math.round((COSTS.road || 20) * 1.5), order: 0 });
      else if (s.type === 'rubble') out.push({ t, cost: 40, order: 3 });
      else if ((s.damage || 0) >= 0.15) out.push({ t, cost: Math.max(20, Math.round((COSTS[s.type] || 200) * 0.3 * s.damage)), order: STRUCTURES[s.type].capacity ? 1 : 2 });
    }
    const k = this.skills.repairCost ?? 1; // Public works (skills.js)
    if (k !== 1) for (const x of out) x.cost = Math.max(1, Math.round(x.cost * k));
    return out.sort((a, b) => a.order - b.order);
  }

  repairCost() {
    const list = this.repairList();
    const free = this.economy?.sandbox;
    return { count: list.length, total: free ? 0 : list.reduce((s, x) => s + x.cost, 0) };
  }

  fix(item) {
    const { t } = item;
    const s = t.structure;
    if (s.type === 'rubble') {
      t.structure = null;
    } else {
      delete s.damage;
      delete s.broken;
      delete s.burning;
    }
    this.city._changed(t.x, t.y);
    this.city.emit('repaired', { x: t.x, y: t.y });
  }

  // Crews fix one thing at a time while the weather is calm and the budget allows.
  repairOne() {
    if (this.state.active) return null;
    const item = this.repairList()[0];
    if (!item) return null;
    const eco = this.economy;
    if (eco && !eco.sandbox) {
      if (!eco.canAfford(item.cost)) return null;
      eco.spend(item.cost);
    }
    this.fix(item);
    return item;
  }

  // Pay to repair everything now. Returns what was done, or null if the town can't afford it.
  repairAll() {
    const list = this.repairList();
    if (!list.length) return { count: 0, total: 0 };
    const { total } = this.repairCost();
    const eco = this.economy;
    if (eco && !eco.sandbox) {
      if (!eco.canAfford(total)) return null;
      eco.spend(total);
    }
    for (const item of list) this.fix(item);
    return { count: list.length, total };
  }

  // ---- Testing and the inspector -----------------------------------------------------------

  // Start an event right away (skipping the warning), e.g. from tests.
  trigger(kind) {
    this.state.pending = null;
    this.start(kind);
  }

  // Tiles that are flooded right now (for the renderer).
  floodedTiles() {
    const a = this.state.active;
    return a?.flooded || null;
  }
}
