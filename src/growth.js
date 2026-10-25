// Let it grow: the town builds itself from what its people need, like a seed becoming a plant.
//
// Every few in-game minutes the town looks at its demand and makes one change:
//   - homes when the houses it has are filling up (or when jobs outnumber workers),
//   - shops, cafés, factories and offices when people need work,
//   - a café, park or playground where townsfolk have nowhere nearby to eat, play or meet,
//   - a school or clinic where families have none,
//   - a new street when it runs out of lots beside its roads,
//   - and now and then a tree.
// What it builds follows the era: cottages and shops in pioneer days, apartments and factories in the
// railway age, offices and malls once there are cars, towers in modern times.
//
// Homes and businesses are built by residents (free); roads, services, parks and trees are paid
// from the town's budget, and are skipped when it can't afford them. The player can keep building too.
// A computer-run town (cpuPlanner.js) sets `payAll`: then everything is paid for at the player's prices,
// and a `reserve` of money is kept back for upkeep.
//
// Saved in city.systems.growth = { on, timer, boosts: [{ mult, until, label }], built }.

import { STRUCTURES, SERVICE_RATING, REPUTATION } from './config.js';
import { DIRS } from './state.js';
import { buildsFor } from './eras.js';
import { clamp, pickWeighted } from './utils.js';
import { addChronicle } from './chronicle.js';

export const GROWTH_INTERVAL = 45; // seconds of game time between changes at normal pace (about 6 a day)
// One more of each per this many residents (homes, roads and trees have no cap).
const CAPS = { shop: 35, cafe: 60, bakery: 70, mall: 450, factory: 220, office: 120, school: 260, clinic: 360, library: 300, firestation: 280, university: 900, park: 70, playground: 110, field: 320 };
const BLOCK = 5; // a side street can branch every this many tiles
const PUBLIC = new Set(['road', 'school', 'clinic', 'library', 'firestation', 'university', 'park', 'playground', 'field', 'tree']);
const FIRSTS = {
  shop: 'The first shop opened its doors',
  cafe: 'The first café poured its first cup',
  bakery: 'The first bakery pulled its first loaves from the oven',
  school: 'The town opened its first school',
  clinic: 'A clinic opened, the first doctor in town',
  library: 'The town opened its first library',
  firestation: 'The first fire station rolled out its engine',
  university: 'A university opened its doors to its first students',
  factory: 'The first factory chimney went up',
  apartments: 'The first block of flats was built',
  office: 'The first office building opened',
  mall: 'A shopping mall opened',
  tower: 'The first tower rose over downtown',
  park: 'The town laid out its first park',
  playground: 'Children got their first playground',
  field: 'A sports field opened',
};

export class Growth {
  constructor(city, { eras, economy, milestones, rng = Math.random } = {}) {
    this.city = city;
    this.eras = eras;
    this.economy = economy;
    this.milestones = milestones;
    this.rng = rng;
    this.payAll = false; // pay for homes and businesses too (computer-run towns)
    this.reserve = 0; // with payAll: money kept back, never spent on building
    this.onBuilt = null; // (what) → called after each change the town makes
  }

  get state() {
    const s = this.city.systems;
    if (!s.growth) s.growth = { on: false, timer: GROWTH_INTERVAL, boosts: [], built: 0 };
    return s.growth;
  }

  get on() {
    return !!this.state.on;
  }

  set on(v) {
    this.state.on = !!v;
  }

  // How fast the town grows: decisions can speed it up or slow it down for a while.
  // A happy town draws more newcomers: growth runs from half speed (miserable) to 1.5× (delighted).
  rate() {
    const now = this.city.day + this.city.clock;
    const st = this.state;
    st.boosts = (st.boosts || []).filter((b) => b.until > now);
    const happy = this.city.stats?.homes ? (this.city.stats.happiness || 0) / 100 : 0.6;
    const sprout = this.city.homes().length < 12 ? 2 : 1; // a seed sprouts quickly at first
    // A well-thought-of town draws newcomers too: up to 15% faster or slower (see reputation.js).
    const name = 1 + ((this.city.derived.reputation?.value ?? 0.5) - 0.5) * REPUTATION.growth;
    const plan = this.city.derived.skills?.growth ?? 1; // Land office, Boom town (skills.js)
    return st.boosts.reduce((r, b) => r * b.mult, 1) * clamp(0.5 + (happy - 0.4) * 2.5, 0.5, 1.5) * sprout * name * plan;
  }

  boost(mult, days, label) {
    const until = this.city.day + this.city.clock + days;
    this.state.boosts.push({ mult, until, label });
  }

  // Called with game seconds that passed. Returns what was built, if anything.
  update(dt) {
    const st = this.state;
    if (!st.on || dt <= 0) return null;
    st.timer -= dt * this.rate();
    if (st.timer > 0) return null;
    st.timer += GROWTH_INTERVAL * (0.7 + this.rng() * 0.6);
    return this.grow();
  }

  allowed(type) {
    const era = this.eras ? this.eras.index : 4;
    return buildsFor(era).includes(type) && (!this.milestones || this.milestones.isUnlocked(type)) && this.underCap(type);
  }

  // A town only needs so many of each kind of building for its size.
  underCap(type) {
    const per = CAPS[type];
    if (!per) return true;
    const pop = this.city.stats?.population || 0;
    return this.count([type]) < 1 + Math.floor(pop / per);
  }

  paid(type) {
    return !!this.economy && (this.payAll || PUBLIC.has(type));
  }

  canPay(type, n = 1) {
    if (!this.paid(type)) return true;
    return this.economy.canAfford(this.economy.costOf(type) * n + (this.payAll ? this.reserve : 0));
  }

  // ---- Demand ------------------------------------------------------------------------------

  demand() {
    const city = this.city;
    const s = city.stats || {};
    const homes = city.homes();
    const lived = homes.filter((h) => h.structure.residents > 0);
    const labor = city.derived.labor || { employed: 0, unemployed: 0, jobs: 0 };
    const workers = labor.employed + labor.unemployed;
    const unmet = city.derived.townsfolkUnmet || {};
    const lots = this.lots().filter((t) => !t.structure).length;
    const d = {};
    // Homes fill as far as their appeal allows; once they're about that full, newcomers need new homes.
    let target = 0;
    for (const h of homes) target += h.housingTarget ?? 0;
    const settled = target ? (s.population || 0) / target : 1;
    d.home = (homes.length < 4 ? 3 : 0) + clamp((settled - 0.75) * 8, 0, 2.5) + (labor.jobs > workers * 1.1 ? 1 : 0);
    d.work = workers >= 4 ? clamp((labor.unemployed / workers - 0.06) * 12, 0, 2.5) : homes.length >= 3 && !labor.jobs ? 2 : 0;
    d.food = clamp((unmet.eat?.length || 0) * 0.5, 0, 2);
    d.play = clamp(((unmet.play?.length || 0) + (unmet.social?.length || 0)) * 0.35, 0, 2) + (lived.length >= 6 && !this.count(['park', 'playground', 'field']) ? 1 : 0);
    const noSchool = lived.filter((h) => (h.coverage?.school || 0) < 0.1).length;
    const noClinic = lived.filter((h) => (h.coverage?.health || 0) < 0.1).length;
    // A crowded service (quality below SERVICE_RATING.strained) also calls for another one.
    d.school = this.allowed('school') ? (noSchool >= 5 ? 1.2 : this.strained('school').length ? 0.9 : 0) : 0;
    d.clinic = this.allowed('clinic') ? (noClinic >= 6 ? 0.9 : this.strained('health').length ? 0.7 : 0) : 0;
    // Fire stations only matter when extreme weather is on; libraries and universities come with size.
    const noFire = lived.filter((h) => (h.coverage?.fire || 0) < 0.1).length;
    const disastersOn = (city.systems.disasters?.level ?? 'gentle') !== 'off';
    d.fire = disastersOn && this.allowed('firestation') ? (noFire >= 8 ? 0.7 : this.strained('fire').length ? 0.5 : 0) : 0;
    d.library = lived.length >= 12 && this.allowed('library') ? 0.4 : 0;
    d.university = (s.population || 0) >= 500 && this.allowed('university') ? 0.5 : 0;
    let roads = 0;
    let buildings = 0;
    for (const t of city.tiles) {
      if (t.structure?.type === 'road') roads++;
      else if (t.structure && t.structure.type !== 'tree') buildings++;
    }
    d.road = roads > buildings * 1.6 + 20 ? 0 : lots < 4 ? 3 : lots < 8 ? 0.6 : 0;
    d.tree = lived.some((h) => (h.factors?.greenery || 0) < 0.03) ? 0.35 : 0.1;
    return d;
  }

  count(types) {
    const set = new Set(types);
    let n = 0;
    for (const t of this.city.tiles) if (t.structure && set.has(t.structure.type)) n++;
    return n;
  }

  grow() {
    const d = this.demand();
    const order = Object.entries(d).filter(([, v]) => v > 0);
    for (let attempt = 0; attempt < 3 && order.length; attempt++) {
      const pickd = pickWeighted(order, ([, v]) => v, this.rng);
      const done = this.act(pickd[0]);
      if (done) {
        this.state.built = (this.state.built || 0) + 1;
        this.onBuilt?.(done);
        return done;
      }
      order.splice(order.indexOf(pickd), 1);
    }
    return null;
  }

  act(kind) {
    switch (kind) {
      case 'home':
        return this.buildHome() || this.densify();
      case 'work':
        return this.buildWork();
      case 'food':
        return this.buildNear(this.unmetHomes('eat'), this.rng() < 0.5 ? ['bakery', 'cafe', 'shop'] : ['cafe', 'bakery', 'shop']);
      case 'play':
        return this.buildNear(this.unmetHomes('play', 'social'), ['park', 'playground', 'cafe', 'field']);
      case 'school':
        return this.buildNear(this.needing('school'), ['school']);
      case 'clinic':
        return this.buildNear(this.needing('health'), ['clinic']);
      case 'fire':
        return this.buildNear(this.needing('fire'), ['firestation']);
      case 'library':
        return this.buildNear(this.city.homes().filter((h) => h.structure.residents > 0), ['library']);
      case 'university':
        return this.buildNear(this.city.homes().filter((h) => h.structure.residents > 0), ['university']);
      case 'road':
        return this.buildRoad();
      case 'tree':
        return this.plantTree();
    }
    return null;
  }

  // ---- Where things go ---------------------------------------------------------------------

  // The middle of town: the average position of its buildings (or the map centre).
  center() {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const t of this.city.tiles) {
      const ty = t.structure?.type;
      if (!ty || ty === 'road' || ty === 'tree') continue;
      sx += t.x;
      sy += t.y;
      n++;
    }
    return n ? { x: sx / n, y: sy / n } : { x: this.city.width / 2, y: this.city.height / 2 };
  }

  // Empty grass (or a tree that can be cleared) beside a road: places a building can go. Spots kept
  // for future streets are left free.
  lots() {
    const city = this.city;
    return city.tiles.filter((t) => t.terrain === 'grass' && (!t.structure || t.structure.type === 'tree') && city.accessRoad(t.x, t.y) && !this.reserved(t));
  }

  // Keep room to grow: the tile past a dead end, and a gap every few tiles along a straight street
  // where a side street can branch off. Towns grow in tidy blocks this way.
  reserved(t) {
    const city = this.city;
    for (const d of DIRS) {
      const r = city.getTile(t.x - d.dx, t.y - d.dy); // the road this tile would face
      if (r?.structure?.type !== 'road') continue;
      const nbrs = city.roadNeighbors(r.x, r.y);
      if (nbrs.length === 1 && nbrs[0].x === r.x - d.dx && nbrs[0].y === r.y - d.dy) return true; // the way on from a dead end
      if (nbrs.length === 2 && nbrs[0].x !== nbrs[1].x && nbrs[0].y !== nbrs[1].y) continue; // a corner
      const along = nbrs.length === 2 ? (nbrs[0].y === nbrs[1].y ? 'h' : 'v') : null;
      if (along === 'h' && d.dx === 0 && r.x % BLOCK === 0) return true;
      if (along === 'v' && d.dy === 0 && r.y % BLOCK === 0) return true;
    }
    return false;
  }

  place(type, t) {
    if (!t || !this.allowed(type) || !this.canPay(type)) return null;
    if (t.structure?.type === 'tree') this.city.apply('bulldoze', t.x, t.y, { delay: 0.6 });
    if (!this.city.apply(type, t.x, t.y, { delay: 0.6 })) return null;
    if (this.paid(type)) this.economy.spend(this.economy.costOf(type));
    this.city.dirty = true;
    if (FIRSTS[type] && this.count([type]) === 1) addChronicle(this.city, `${FIRSTS[type]}.`, t, 'first');
    this.city.emit('grew', { type, x: t.x, y: t.y });
    return { type, x: t.x, y: t.y };
  }

  buildHome() {
    const lots = this.lots();
    if (!lots.length) return null;
    const c = this.center();
    const era = this.eras ? this.eras.index : 4;
    const spread = Math.max(4, Math.sqrt(this.city.homes().length) * 1.6);
    const lot = pickWeighted(
      lots,
      (t) => {
        const dist = Math.hypot(t.x - c.x, t.y - c.y);
        return (0.2 + (t.desirability || 0.3)) ** 2 * (1 / (1 + (dist / spread) ** 2)) * (t.factors?.pollution ? 0.3 : 1) * (t.structure ? 0.4 : 1);
      },
      this.rng,
    );
    if (!lot) return null;
    const dist = Math.hypot(lot.x - c.x, lot.y - c.y);
    const core = dist < spread * 0.6;
    let type = era === 0 ? (this.rng() < 0.5 ? 'cottage' : 'house') : 'house';
    if (core && this.allowed('tower') && this.rng() < 0.35) type = 'tower';
    else if (core && this.allowed('apartments') && this.rng() < 0.45) type = 'apartments';
    else if (era >= 1 && this.rng() < 0.15) type = 'cottage';
    return this.place(type, lot) || this.place('house', lot);
  }

  // No room left: an older home near the middle is rebuilt bigger. Cottages become houses, houses
  // become flats, flats become towers, as the era allows. The people living there stay.
  densify() {
    const c = this.center();
    const UP = { cottage: 'house', house: 'apartments', apartments: 'tower' };
    const options = this.city.homes().filter((h) => UP[h.structure.type] && this.allowed(UP[h.structure.type]));
    const h = pickWeighted(options, (t) => 1 / (1 + Math.hypot(t.x - c.x, t.y - c.y)) ** 2 * (t.structure.type === 'cottage' ? 3 : 1), this.rng);
    if (!h) return null;
    const residents = h.structure.residents;
    const variant = h.structure.variant;
    const type = UP[h.structure.type];
    if (this.payAll && !this.canPay(type)) return null;
    if (!this.city.apply(type, h.x, h.y, { delay: 0.6 })) return null;
    if (this.payAll) this.economy.spend(this.economy.costOf(type));
    h.structure.residents = Math.min(residents, STRUCTURES[type].capacity);
    if (variant) h.structure.variant = variant;
    this.city.dirty = true;
    if (FIRSTS[type] && this.count([type]) === 1) addChronicle(this.city, `${FIRSTS[type]}.`, h, 'first');
    this.city.emit('grew', { type, x: h.x, y: h.y, rebuilt: true });
    return { type, x: h.x, y: h.y, rebuilt: true };
  }

  buildWork() {
    const lots = this.lots();
    if (!lots.length) return null;
    const c = this.center();
    const pop = this.city.stats?.population || 0;
    const options = [
      ['shop', 3],
      ['cafe', 1.2],
      ['bakery', 1],
      ['factory', this.count(['factory']) < 1 + pop / 250 ? 1.5 : 0.3],
      ['office', 2],
      ['mall', pop > 250 && this.count(['mall']) < pop / 400 ? 1 : 0],
    ].filter(([ty, w]) => w > 0 && this.allowed(ty));
    const pickd = pickWeighted(options, ([, w]) => w, this.rng);
    if (!pickd) return null;
    const type = pickd[0];
    const lot = pickWeighted(
      lots,
      (t) => {
        const dist = Math.hypot(t.x - c.x, t.y - c.y);
        // Factories go to the edge of town; everything else near the middle.
        return type === 'factory' ? dist ** 2 + 0.1 : 1 / (1 + dist * dist * 0.15);
      },
      this.rng,
    );
    return this.place(type, lot);
  }

  unmetHomes(...kinds) {
    const folk = this.city.systems.townsfolk?.people || [];
    const ids = new Set(kinds.flatMap((k) => this.city.derived.townsfolkUnmet?.[k] || []));
    return folk.filter((p) => ids.has(p.id)).map((p) => this.city.getTile(p.home.x, p.home.y)).filter(Boolean);
  }

  uncovered(service) {
    return this.city.homes().filter((h) => h.structure.residents > 0 && (h.coverage?.[service] || 0) < 0.1);
  }

  // Service buildings of one kind that have more residents than they can look after.
  strained(service) {
    return (this.city.derived.serviceStats || []).filter((st) => st.service === service && st.rating < SERVICE_RATING.strained && st.demand > 0);
  }

  // Homes that need a service: those with none within reach, else those leaning on a crowded building.
  needing(service) {
    const bare = this.uncovered(service);
    if (bare.length) return bare;
    const out = new Set();
    for (const st of this.strained(service)) {
      const r = STRUCTURES[st.type].radius;
      for (const h of this.city.homes()) if (h.structure.residents > 0 && Math.hypot(h.x - st.tile.x, h.y - st.tile.y) <= r) out.add(h);
    }
    return [...out];
  }

  // A building close to the homes that need it.
  buildNear(homes, types) {
    if (!homes.length) return null;
    const type = types.find((ty) => this.allowed(ty) && this.canPay(ty));
    if (!type) return null;
    const cx = homes.reduce((s, h) => s + h.x, 0) / homes.length;
    const cy = homes.reduce((s, h) => s + h.y, 0) / homes.length;
    const walkable = !!STRUCTURES[type].walkable;
    const lots = this.lots();
    // Parks and playgrounds don't need a road, so any open grass near the homes will do.
    if (walkable) {
      for (const t of this.city.tiles) if (t.terrain === 'grass' && (!t.structure || t.structure.type === 'tree') && !this.city.accessRoad(t.x, t.y) && Math.hypot(t.x - cx, t.y - cy) < 6) lots.push(t);
    }
    let best = null;
    let bestD = Infinity;
    for (const t of lots) {
      const dd = Math.hypot(t.x - cx, t.y - cy) + this.rng() * 0.8;
      if (dd < bestD) {
        bestD = dd;
        best = t;
      }
    }
    return this.place(type, best);
  }

  plantTree() {
    const city = this.city;
    const homes = city.homes().filter((h) => (h.factors?.greenery || 0) < 0.05);
    if (!homes.length || !this.canPay('tree')) return null;
    const h = homes[Math.floor(this.rng() * homes.length)];
    for (const dir of [...DIRS].sort(() => this.rng() - 0.5)) {
      const t = city.getTile(h.x + dir.dx, h.y + dir.dy);
      if (t && t.terrain === 'grass' && !t.structure) return this.place('tree', t);
    }
    return null;
  }

  // A building a decision asked for: near the middle, at the edge, or close to homes that lack it.
  // Gifts are free; era and caps don't apply.
  buildType(type, { where = 'center', free = false } = {}) {
    const lots = this.lots().filter((t) => !t.structure || STRUCTURES[type].walkable);
    if (!lots.length) return null;
    const c = this.center();
    const lot = pickWeighted(lots, (t) => {
      const dist = Math.hypot(t.x - c.x, t.y - c.y);
      return where === 'edge' ? dist ** 2 + 0.1 : 1 / (1 + dist * dist * 0.2);
    }, this.rng);
    if (!lot) return null;
    if (lot.structure?.type === 'tree') this.city.apply('bulldoze', lot.x, lot.y, { delay: 0.3 });
    if (!this.city.apply(type, lot.x, lot.y, { delay: 0.3 })) return null;
    if (!free && this.paid(type)) this.economy.spend(this.economy.costOf(type));
    this.city.dirty = true;
    if (FIRSTS[type] && this.count([type]) === 1) addChronicle(this.city, `${FIRSTS[type]}.`, lot, 'first');
    this.city.emit('grew', { type, x: lot.x, y: lot.y });
    return { type, x: lot.x, y: lot.y };
  }

  // Clear some woodland around town (for a decision to make room for farms and homes).
  clearTrees(n) {
    const c = this.center();
    const trees = this.city.tiles
      .filter((t) => t.structure?.type === 'tree')
      .sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))
      .slice(0, n);
    trees.forEach((t, i) => this.city.apply('bulldoze', t.x, t.y, { delay: 0.3 + i * 0.05 }));
    if (trees.length) this.city.dirty = true;
    return trees.length;
  }

  // Plant trees on open ground near town (for decisions about gardens and greenery).
  plantTrees(n) {
    const c = this.center();
    const open = this.city.tiles
      .filter((t) => t.terrain === 'grass' && !t.structure && !this.city.accessRoad(t.x, t.y))
      .sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))
      .slice(0, n);
    open.forEach((t, i) => this.city.apply('tree', t.x, t.y, { delay: 0.3 + i * 0.06 }));
    if (open.length) this.city.dirty = true;
    return open.length;
  }

  // ---- Streets -----------------------------------------------------------------------------

  // A new street: extend a dead end, or branch off a straight stretch, through open land.
  buildRoad() {
    const city = this.city;
    const roads = city.tiles.filter((t) => t.structure?.type === 'road');
    if (!roads.length) return null;
    const c = this.center();
    const candidates = [];
    for (const r of roads) {
      const nbrs = city.roadNeighbors(r.x, r.y);
      const near = 1 / (1 + Math.hypot(r.x - c.x, r.y - c.y) * 0.12);
      if (nbrs.length === 1) {
        // Dead end: keep going the same way.
        const n = nbrs[0];
        candidates.push({ from: r, dx: r.x - n.x, dy: r.y - n.y, w: 3 * near });
      } else if (nbrs.length === 2 && nbrs[0].x !== nbrs[1].x && nbrs[0].y !== nbrs[1].y) {
        continue; // a corner
      } else if (nbrs.length === 2) {
        // Straight stretch: branch off either side at the kept gaps.
        const along = nbrs[0].x === nbrs[1].x ? 'v' : 'h';
        const gap = (along === 'h' ? r.x : r.y) % BLOCK === 0;
        for (const s of [-1, 1]) candidates.push({ from: r, dx: along === 'v' ? s : 0, dy: along === 'h' ? s : 0, w: near * (gap ? 2 : 0.15) });
      }
    }
    for (let tries = 0; tries < 12 && candidates.length; tries++) {
      const cand = pickWeighted(candidates, (k) => k.w, this.rng);
      candidates.splice(candidates.indexOf(cand), 1);
      const path = this.trace(cand.from, cand.dx, cand.dy, 3 + Math.floor(this.rng() * 4));
      if (!path) continue;
      if (this.economy && !this.canPay('road', path.length)) return null;
      let built = 0;
      for (const t of path) {
        if (t.structure?.type === 'tree') city.apply('bulldoze', t.x, t.y, { delay: 0.6 });
        if (city.apply('road', t.x, t.y, { delay: 0.6 + built * 0.08 })) {
          built++;
          if (this.economy) this.economy.spend(this.economy.costOf('road'));
        }
      }
      if (!built) continue;
      city.dirty = true;
      city.emit('grew', { type: 'road', x: path[0].x, y: path[0].y, n: built });
      return { type: 'road', x: path[0].x, y: path[0].y, n: built };
    }
    return null;
  }

  // Tiles for a straight new street, stopping before water, buildings, the map edge, or running
  // alongside another road (which would make a double street).
  trace(from, dx, dy, len) {
    const city = this.city;
    const out = [];
    let x = from.x;
    let y = from.y;
    for (let i = 0; i < len; i++) {
      x += dx;
      y += dy;
      const t = city.getTile(x, y);
      if (!t || x <= 0 || y <= 0 || x >= city.width - 1 || y >= city.height - 1) break;
      if (t.terrain !== 'grass' || (t.structure && t.structure.type !== 'tree')) break;
      const side = [city.getTile(x + dy, y + dx), city.getTile(x - dy, y - dx)];
      if (i > 0 && side.some((s) => s?.structure?.type === 'road')) break;
      const ahead = city.getTile(x + dx, y + dy);
      out.push(t);
      if (ahead?.structure?.type === 'road') break; // joined another street
    }
    return out.length >= 2 ? out : null;
  }
}
