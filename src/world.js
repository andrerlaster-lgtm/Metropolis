// The world: your town and its neighbours. Each town is a whole town of its own (its own map, people,
// budget, era and simulation), placed side by side in one world with countryside between them.
// Your town is run by you; neighbours are run by the computer (cpuPlanner.js). Once your town is big
// enough you can found settlements of your own (owner 'colony'): small towns on free sites nearby, with
// their own map, people and money, that grow by themselves and share your town's era and unlocked
// buildings. Every town shares the calendar and the clock, so day, night and the seasons are the same
// everywhere, and no town touches another's tiles or people; money moves between your own towns only
// when you send it.
//
// Saved inside your town, in city.systems.world:
//   { version, home: { name, at: { x, y } },
//     cities: [{ id, name, owner: 'cpu' | 'colony', at: { x, y }, seed, data: <the town, as CityState.toJSON> }],
//     sites: [{ id, name, at: { x, y }, seed, land }],   (free places a settlement can be founded)
//     landSeed }   (lays out the land of the whole world, land.js: chosen once, so the map never changes)
// Each site stands on a land type (river valley, coast, forest, plains, rocky uplands) with its own pluses
// and minuses, and a settlement's ground is shaped to it. A site further from your town costs more to found.
// `at` is where a town's top-left corner sits in world tiles. A save from before the world existed
// gets a neighbour the first time it's opened; older versions of the game keep the data untouched.
// More neighbours can be added with addNeighbour(). `rivals: false` in the saved world turns the computer's
// towns off for this town: they aren't run or shown (their saved data is kept, so switching back on
// restores them), no raids come and there is no diplomacy. Missing means on, so older saves are unchanged.
// Settlements are yours, so they stay whether rivals are on or off. A version of the game from before
// settlements keeps their entries in the save untouched (it only runs 'cpu' entries).

import { CityState } from './state.js';
import { Simulation } from './simulation.js';
import { generateSeed } from './generator.js';
import { CpuPlanner } from './cpuPlanner.js';
import { mulberry32 } from './utils.js';
import { landAt, landOf, shapeLand, LANDS } from './land.js';

export const WORLD_VERSION = 1;
export const NEIGHBOUR_SIZE = 32;
const GAP = 8; // countryside between towns, in tiles
// Founding a settlement: your town needs this many people, pays the charter (which becomes the new
// town's starting money), and can have this many settlements at once. Sites on offer at a time: SITES.
export const SETTLE = { population: 150, charter: 3000, max: 2, perTile: 25 };
const NEAREST = NEIGHBOUR_SIZE / 2 + GAP + NEIGHBOUR_SIZE / 2; // centre to centre, the closest a site can be
const SITES = 3;
const MIN_SIZE = 8;
const MAX_SIZE = 128;

const FIRST = ['Maple', 'Willow', 'River', 'Clover', 'Hazel', 'Stone', 'Brook', 'Elder', 'Fern', 'Linden', 'Ash', 'Oak', 'Meadow', 'Sparrow', 'Juniper', 'Cedar', 'Amber', 'Bramble', 'Thistle', 'Heather'];
const LAST = ['field', 'ford', 'bury', 'ton', 'wick', 'dale', 'mere', 'brook', 'haven', 'stead', 'worth', 'vale', 'gate', 'well'];

export function townName(rand = Math.random, avoid = []) {
  for (let i = 0; i < 20; i++) {
    const name = FIRST[Math.floor(rand() * FIRST.length)] + LAST[Math.floor(rand() * LAST.length)];
    if (!avoid.includes(name)) return name;
  }
  return `New Town ${avoid.length + 1}`;
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const validAt = (at) => !!at && finite(at.x) && finite(at.y);

function validWorld(st) {
  return !!st && typeof st === 'object' && Array.isArray(st.cities) && !!st.home && typeof st.home.name === 'string' && validAt(st.home.at);
}

export class World {
  // home: your town's CityState; homeSim: its Simulation.
  constructor(home, homeSim, { rand = Math.random } = {}) {
    this.home = home;
    this.homeSim = homeSim;
    this.rand = rand;
    this.cities = [];
    this.load();
  }

  get state() {
    return this.home.systems.world;
  }

  // Are the computer's towns part of this game?
  get rivals() {
    return this.state?.rivals !== false;
  }

  // Turn the rival towns on or off for this town, and rebuild the world to match.
  setRivals(on) {
    this.state.rivals = !!on;
    this.load();
  }

  // The computer's towns.
  get neighbours() {
    return this.cities.filter((c) => c.owner === 'cpu');
  }

  // Your settlements (not counting your first town).
  get settlements() {
    return this.cities.filter((c) => c.owner === 'colony');
  }

  // Is this one of your towns (your first town or a settlement)?
  isYours(c) {
    return !!c && (c.owner === 'player' || c.owner === 'colony');
  }

  byId(id) {
    return this.cities.find((c) => c.id === id) || null;
  }

  // (Re)build the world from your town's saved data: after loading a save, a new town or a visit.
  load() {
    this.dispose();
    const home = this.home;
    if (!validWorld(home.systems.world)) home.systems.world = { version: WORLD_VERSION, home: { name: townName(this.rand), at: { x: 0, y: 0 } }, cities: [] };
    const st = home.systems.world;
    st.version = WORLD_VERSION;
    this.cities = [{ id: 'home', owner: 'player', entry: st.home, city: home, sim: this.homeSim, planner: null }];
    for (const e of st.cities) {
      if (!e || typeof e !== 'object') continue;
      // Kinds a later version may add are kept in the save, not run.
      if (e.owner === 'cpu' && st.rivals !== false) this.cities.push(this.open(e));
      else if (e.owner === 'colony') this.cities.push(this.open(e, 'colony'));
    }
    if (st.rivals !== false && !this.neighbours.length) this.addNeighbour();
  }

  // A town from its saved entry, or founded fresh if it has none (or it's unreadable): run by the
  // computer ('cpu'), or one of your settlements ('colony').
  open(e, owner = 'cpu') {
    if (typeof e.id !== 'string') e.id = `${owner}-${this.cities.length}`;
    if (typeof e.name !== 'string' || !e.name) e.name = townName(this.rand, this.cities.map((c) => c.entry.name));
    if (!validAt(e.at)) e.at = this.freeSpot(NEIGHBOUR_SIZE);
    if (!finite(e.seed)) e.seed = Math.floor(this.rand() * 2 ** 31);
    let city = null;
    const d = e.data;
    if (d && typeof d === 'object' && finite(d.width) && finite(d.height) && d.width >= MIN_SIZE && d.height >= MIN_SIZE && d.width <= MAX_SIZE && d.height <= MAX_SIZE) {
      try {
        city = CityState.fromJSON(d);
      } catch {
        city = null;
      }
    }
    const sim = new Simulation(city || new CityState(NEIGHBOUR_SIZE, NEIGHBOUR_SIZE));
    if (!city) this.found(sim, e);
    if (!city && owner === 'colony') this.settle(sim, e);
    sim.city.day = this.home.day;
    sim.city.clock = this.home.clock;
    sim.agentsActive = false; // walkers and cars only while someone is looking
    sim.refreshEvery = 2.5; // jobs, traffic and appeal are refreshed every 2.5 game seconds, not every one
    sim.refresh();
    const planner = owner === 'cpu' ? new CpuPlanner(sim) : null;
    // The saved entry always holds the town as it is now (read when the save is written).
    Object.defineProperty(e, 'data', {
      get: () => sim.city.toJSON(),
      set: (v) => Object.defineProperty(e, 'data', { value: v, writable: true, enumerable: true, configurable: true }),
      enumerable: true,
      configurable: true,
    });
    return { id: e.id, owner, entry: e, city: sim.city, sim, planner };
  }

  // A new settlement of yours: it builds in your town's mode (Sandbox or Milestones), grows by itself,
  // starts with the charter as its money, and knows what your town knows.
  settle(sim, e) {
    const city = sim.city;
    const land = LANDS[e.land] ? e.land : this.landAtSpot(e.at);
    e.land = land;
    shapeLand(city, land, e.seed >>> 0);
    city.systems.mode = this.home.systems.mode === 'sandbox' ? 'sandbox' : 'milestones';
    sim.economy.state.money = finite(e.charter) ? e.charter : SETTLE.charter;
    sim.growth.on = true;
    sim.milestones.settle(this.homeSim.milestones.reached);
  }

  // A small settlement: a crossroads with a few homes, the land's starting budget, and the same
  // calendar and know-how (era) as the rest of the world.
  found(sim, e) {
    const city = sim.city;
    generateSeed(city, e.seed >>> 0);
    city.systems.mode = 'milestones';
    city.day = this.home.day;
    city.clock = this.home.clock;
    sim.economy.reset('land');
    sim.refresh();
    sim.eras.found();
    const era = this.home.systems.era; // read only: the world never writes to your town
    if (era && finite(era.startYear) && finite(era.index)) {
      const st = city.systems.era;
      st.startYear = era.startYear;
      st.index = era.index;
      st.history = [{ index: era.index, year: sim.eras.year }];
    }
  }

  // Add one more computer-run town in the next free spot around yours. Returns it.
  addNeighbour({ name, size = NEIGHBOUR_SIZE } = {}) {
    const st = this.state;
    const e = {
      id: `cpu-${st.cities.length + 1}`,
      name: name || townName(this.rand, this.cities.map((c) => c.entry.name)),
      owner: 'cpu',
      at: this.freeSpot(size),
      seed: Math.floor(this.rand() * 2 ** 31),
    };
    while (this.byId(e.id)) e.id += '+';
    e.data = null;
    st.cities.push(e);
    const c = this.open(e);
    this.cities.push(c);
    return c;
  }

  // Beside your town: east, south, west, north, then further out.
  freeSpot(size) {
    return this.freeSpots(size, 1)[0] || { x: this.home.width + GAP, y: 0 };
  }

  // Up to `n` places a town of `size` fits without overlapping another town (or `besides`, more places).
  freeSpots(size, n, besides = []) {
    const h = this.home;
    const taken = [...this.cities.filter((c) => c.owner !== 'player').map((c) => c.entry.at), ...besides];
    const out = [];
    for (let ring = 1; ring < 8 && out.length < n; ring++) {
      const d = ring * GAP + (ring - 1) * size;
      const spots = [
        { x: h.width + d, y: Math.round((h.height - size) / 2) },
        { x: Math.round((h.width - size) / 2), y: h.height + d },
        { x: -size - d, y: Math.round((h.height - size) / 2) },
        { x: Math.round((h.width - size) / 2), y: -size - d },
      ];
      for (const p of spots) {
        if (out.length >= n) break;
        if (![...taken, ...out].some((t) => t && Math.abs(t.x - p.x) < size && Math.abs(t.y - p.y) < size)) out.push(p);
      }
    }
    return out;
  }

  // ---- Settlements ----------------------------------------------------------------------------

  // The seed that lays out the world's land (land.js), chosen the first time it's needed and saved.
  get landSeed() {
    const st = this.state;
    if (!finite(st.landSeed)) st.landSeed = Math.floor(this.rand() * 2 ** 31);
    return st.landSeed;
  }

  // The land type under a town-sized spot (its middle), and the land of a town that stands somewhere.
  landAtSpot(at, size = NEIGHBOUR_SIZE) {
    return landAt(this.landSeed, at.x + size / 2, at.y + size / 2);
  }

  landOf(c) {
    return landOf(c.city);
  }

  // The charter for a site: $3,000 beside your town, $25 more for every tile further out.
  charterFor(at, size = NEIGHBOUR_SIZE) {
    const h = this.home;
    const d = Math.hypot(at.x + size / 2 - h.width / 2, at.y + size / 2 - h.height / 2);
    return Math.round((SETTLE.charter + SETTLE.perTile * Math.max(0, d - NEAREST)) / 100) * 100;
  }

  // The free sites on offer, kept in the save so they stay the same until one is used or built over.
  // As many different kinds of land as the country nearby has, nearest first. Each comes with its
  // land type and charter.
  sites() {
    const st = this.state;
    const towns = this.cities.filter((c) => c.owner !== 'player').map((c) => c.entry.at);
    const clash = (a, b) => Math.abs(a.x - b.x) < NEIGHBOUR_SIZE && Math.abs(a.y - b.y) < NEIGHBOUR_SIZE;
    st.sites = (Array.isArray(st.sites) ? st.sites : []).filter((x) => x && typeof x.id === 'string' && typeof x.name === 'string' && validAt(x.at) && finite(x.seed) && !towns.some((t) => clash(t, x.at)));
    for (const x of st.sites) if (!LANDS[x.land]) x.land = this.landAtSpot(x.at);
    const names = () => [...this.cities.map((c) => c.entry.name), ...st.sites.map((x) => x.name)];
    const want = SITES - st.sites.length;
    if (want > 0) {
      const spots = this.freeSpots(NEIGHBOUR_SIZE, 16, st.sites.map((x) => x.at)).map((at) => ({ at, land: this.landAtSpot(at) }));
      const picked = [];
      const free = (p) => ![...st.sites.map((x) => x.at), ...picked.map((k) => k.at)].some((t) => clash(t, p.at));
      // First the nearest spot of each kind of land not on offer yet, then the nearest of the rest.
      const seen = new Set(st.sites.map((x) => x.land));
      for (const p of spots) {
        if (picked.length < want && !seen.has(p.land) && free(p)) {
          seen.add(p.land);
          picked.push(p);
        }
      }
      for (const p of spots) if (picked.length < want && !picked.includes(p) && free(p)) picked.push(p);
      // Each new site's name and seed follow from the world's land seed and its number, so the same
      // world always offers the same sites, saved or not.
      for (const p of picked) {
        const n = (st.siteCount = (st.siteCount || 0) + 1);
        let id = `site-${n}`;
        while (st.sites.some((x) => x.id === id)) id += '+';
        const rand = mulberry32((this.landSeed + Math.imul(n, 0x9e3779b1)) >>> 0);
        st.sites.push({ id, name: townName(rand, names()), at: p.at, seed: Math.floor(rand() * 2 ** 31), land: p.land });
      }
    }
    return st.sites
      .map((x) => ({ ...x, at: { ...x.at }, charter: this.charterFor(x.at) }))
      .sort((a, b) => a.charter - b.charter || a.id.localeCompare(b.id));
  }

  // Can your town found a settlement now (on this site, or on the cheapest one on offer)?
  // { ok, reason } (reason says what's missing, in plain words).
  canFound(siteId = null) {
    const pop = this.home.stats.population || 0;
    const sandbox = this.home.systems.mode === 'sandbox';
    if (this.settlements.length >= SETTLE.max) return { ok: false, reason: `You have ${SETTLE.max} settlements already, the most for now` };
    if (pop < SETTLE.population) return { ok: false, reason: `Your town needs ${SETTLE.population} people to found a settlement (it has ${pop})` };
    const sites = this.sites();
    const site = siteId ? sites.find((x) => x.id === siteId) : sites[0];
    if (!site) return { ok: false, reason: siteId ? 'That site is no longer free' : 'There is no free land nearby' };
    const money = this.homeSim.economy.money;
    if (!sandbox && money < site.charter) return { ok: false, reason: `A settlement's charter ${siteId ? 'here ' : ''}costs $${site.charter.toLocaleString('en-US')}; your town has $${Math.floor(money).toLocaleString('en-US')}` };
    return { ok: true, reason: '' };
  }

  // Found a settlement on one of the sites(): your town pays the charter and the new town starts with it.
  // Returns the new town, or null if it can't be done (see canFound()) or the site isn't on offer.
  foundSettlement(siteId, { name } = {}) {
    if (!this.canFound(siteId).ok) return null;
    const st = this.state;
    const site = this.sites().find((x) => x.id === siteId);
    if (!site) return null;
    const n = (st.colonyCount = (st.colonyCount || 0) + 1);
    let id = `colony-${n}`;
    while (this.byId(id) || st.cities.some((e) => e?.id === id)) id += '+';
    const e = { id, name: (typeof name === 'string' && name.trim().slice(0, 40)) || site.name, owner: 'colony', at: site.at, seed: site.seed, land: site.land, charter: site.charter, founded: this.home.day };
    e.data = null;
    if (this.home.systems.mode !== 'sandbox') this.homeSim.economy.state.money -= site.charter;
    st.sites = st.sites.filter((x) => x.id !== siteId);
    st.cities.push(e);
    const c = this.open(e, 'colony');
    this.cities.push(c);
    this.sites(); // another site takes this one's place straight away
    this.home.dirty = true;
    return c;
  }

  // Send money from one of your towns to another. Returns the amount sent (0 if it can't be).
  transfer(fromId, toId, amount) {
    const from = this.byId(fromId);
    const to = this.byId(toId);
    if (!this.isYours(from) || !this.isYours(to) || from === to || from.sim.economy.sandbox) return 0;
    const sum = Math.floor(Math.min(Number(amount) || 0, from.sim.economy.money));
    if (!(sum > 0)) return 0;
    from.sim.economy.state.money -= sum;
    to.sim.economy.state.money += sum;
    this.home.dirty = true;
    return sum;
  }

  // Run every other town for the same time as yours, then keep the shared clock in step.
  update(dt, speed) {
    for (const c of this.cities) {
      if (c.owner === 'player') continue;
      c.sim.speed = speed;
      c.sim.update(dt);
      c.city.day = this.home.day;
      c.city.clock = this.home.clock;
      if (c.planner) c.planner.update(Math.min(dt, 0.25) * speed);
      // A settlement can build whatever your town has unlocked.
      else c.sim.milestones.settle(this.homeSim.milestones.reached);
    }
  }

  // Each town's place in the world, for the world map and the 3D view.
  layout() {
    return this.cities.map((c) => ({ id: c.id, name: c.entry.name, owner: c.owner, x: c.entry.at.x, y: c.entry.at.y, w: c.city.width, h: c.city.height }));
  }

  dispose() {
    for (const c of this.cities) c.planner?.dispose();
    this.cities = [];
  }
}
