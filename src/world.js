// The world: your town and its neighbours. Each town is a whole town of its own (its own map, people,
// budget, era and simulation), placed side by side in one world with countryside between them.
// Your town is run by you; neighbours are run by the computer (cpuPlanner.js). They share the calendar
// and the clock, so day, night and the seasons are the same everywhere, and they never touch each
// other's tiles, people or money.
//
// Saved inside your town, in city.systems.world:
//   { version, home: { name, at: { x, y } },
//     cities: [{ id, name, owner: 'cpu', at: { x, y }, seed, data: <the town, as CityState.toJSON> }] }
// `at` is where a town's top-left corner sits in world tiles. A save from before the world existed
// gets a neighbour the first time it's opened; older versions of the game keep the data untouched.
// More neighbours can be added with addNeighbour(). `rivals: false` in the saved world turns the computer's
// towns off for this town: they aren't run or shown (their saved data is kept, so switching back on
// restores them), no raids come and there is no diplomacy. Missing means on, so older saves are unchanged.

import { CityState } from './state.js';
import { Simulation } from './simulation.js';
import { generateSeed } from './generator.js';
import { CpuPlanner } from './cpuPlanner.js';

export const WORLD_VERSION = 1;
export const NEIGHBOUR_SIZE = 32;
const GAP = 8; // countryside between towns, in tiles
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

  get neighbours() {
    return this.cities.filter((c) => c.owner !== 'player');
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
    for (const e of st.rivals === false ? [] : st.cities) {
      if (!e || typeof e !== 'object' || e.owner !== 'cpu') continue; // kinds a later version may add are kept, not run
      this.cities.push(this.open(e));
    }
    if (st.rivals !== false && !this.neighbours.length) this.addNeighbour();
  }

  // A computer-run town from its saved entry, or founded fresh if it has none (or it's unreadable).
  open(e) {
    if (typeof e.id !== 'string') e.id = `cpu-${this.cities.length}`;
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
    sim.city.day = this.home.day;
    sim.city.clock = this.home.clock;
    sim.agentsActive = false; // walkers and cars only while someone is looking
    sim.refreshEvery = 2.5; // jobs, traffic and appeal are refreshed every 2.5 game seconds, not every one
    sim.refresh();
    const planner = new CpuPlanner(sim);
    // The saved entry always holds the town as it is now (read when the save is written).
    Object.defineProperty(e, 'data', {
      get: () => sim.city.toJSON(),
      set: (v) => Object.defineProperty(e, 'data', { value: v, writable: true, enumerable: true, configurable: true }),
      enumerable: true,
      configurable: true,
    });
    return { id: e.id, owner: 'cpu', entry: e, city: sim.city, sim, planner };
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
    const h = this.home;
    const taken = this.cities.filter((c) => c.owner !== 'player').map((c) => c.entry.at);
    for (let ring = 1; ring < 8; ring++) {
      const d = ring * GAP + (ring - 1) * size;
      const spots = [
        { x: h.width + d, y: Math.round((h.height - size) / 2) },
        { x: Math.round((h.width - size) / 2), y: h.height + d },
        { x: -size - d, y: Math.round((h.height - size) / 2) },
        { x: Math.round((h.width - size) / 2), y: -size - d },
      ];
      const free = spots.find((p) => !taken.some((t) => t && Math.abs(t.x - p.x) < size && Math.abs(t.y - p.y) < size));
      if (free) return free;
    }
    return { x: h.width + GAP, y: 0 };
  }

  // Run every neighbour for the same time as your town, then keep the shared clock in step.
  update(dt, speed) {
    for (const c of this.cities) {
      if (!c.planner) continue;
      c.sim.speed = speed;
      c.sim.update(dt);
      c.city.day = this.home.day;
      c.city.clock = this.home.clock;
      c.planner.update(Math.min(dt, 0.25) * speed);
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
