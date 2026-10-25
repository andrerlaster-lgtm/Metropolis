// City State: the single source of truth. Tiles own their world state; no drawing or timing logic lives here.

import { STRUCTURES, VARIANT_KEYS, DEFAULT_MAP_SIZE } from './config.js';

// Structures that come in the four pastel colourways.
export const VARIANT_TYPES = new Set(['house', 'cottage', 'apartments', 'tower', 'shop', 'cafe', 'office', 'mall', 'bungalow', 'villa']);

// Neighbour directions with the road-connection bit each one sets: N, E, S, W.
export const DIRS = [
  { dx: 0, dy: -1, bit: 1 },
  { dx: 1, dy: 0, bit: 2 },
  { dx: 0, dy: 1, bit: 4 },
  { dx: -1, dy: 0, bit: 8 },
];

function createTile(x, y) {
  return {
    x,
    y,
    terrain: 'grass', // 'grass' | 'water'
    structure: null, // { id, type, residents, variant?, floors?, shape? }
    roadMask: 0, // derived: which neighbours are connected road
    desirability: 0, // derived by the simulation
    factors: {}, // derived: per-factor desirability breakdown
    housingTarget: 0, // derived: how many residents this home can attract right now
    employment: 0, // derived: share of this home's workers who have a job (0..1)
    workersFilled: 0, // derived: jobs filled at this workplace
    congestion: 0, // derived: road load (0..1)
    coverage: {}, // derived: service id → coverage (0..1)
  };
}

export class CityState {
  constructor(width = DEFAULT_MAP_SIZE, height = DEFAULT_MAP_SIZE) {
    this.width = width;
    this.height = height;
    this.tiles = [];
    this.clock = 0.3;
    this.day = 1;
    this.nextId = 1;
    this.stats = { population: 0, capacity: 0, occupancy: 0, happiness: 0, homes: 0 };
    this.systems = {}; // saved per-system data for future modules (economy, utilities…)
    this.derived = {}; // recomputed every few ticks and never saved (labor market, flows…)
    this.dirty = true; // derived data needs recomputing
    this.revision = 0; // bumps on every tile change, so caches know when to redraw
    this._listeners = new Set();
    this._buildTiles();
  }

  _buildTiles() {
    this.tiles = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) this.tiles.push(createTile(x, y));
    }
  }

  on(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  emit(type, data = {}) {
    const ev = { type, ...data };
    for (const fn of this._listeners) fn(ev);
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  getTile(x, y) {
    return this.inBounds(x, y) ? this.tiles[y * this.width + x] : null;
  }

  // A usable road: washed-out and snowed-in roads can't be driven until they are cleared.
  isRoad(x, y) {
    const s = this.getTile(x, y)?.structure;
    return !!s && s.type === 'road' && !s.broken && !s.snowed;
  }

  roadNeighbors(x, y) {
    const out = [];
    for (const d of DIRS) if (this.isRoad(x + d.dx, y + d.dy)) out.push({ x: x + d.dx, y: y + d.dy });
    return out;
  }

  isWalkable(x, y) {
    const t = this.getTile(x, y);
    if (!t || t.terrain !== 'grass') return false;
    return !t.structure || !!STRUCTURES[t.structure.type].walkable;
  }

  homes() {
    return this.tiles.filter((t) => t.structure && STRUCTURES[t.structure.type].capacity > 0);
  }

  workplaces() {
    return this.tiles.filter((t) => t.structure && STRUCTURES[t.structure.type].jobs > 0);
  }

  // The road tile a building uses to reach the network: an adjacent road, if any.
  accessRoad(x, y) {
    for (const d of DIRS) if (this.isRoad(x + d.dx, y + d.dy)) return this.getTile(x + d.dx, y + d.dy);
    return null;
  }

  // Why a building can't go here, or null when it can. Homes (anything that holds residents) need a
  // road beside them; everything else (shops, offices, services, parks…) can stand anywhere and is
  // reached on foot. A home that is already there can be replaced or rebuilt without a road, so towns
  // saved before this rule keep their roadless homes (advisor.js flags them).
  placeError(tool, x, y) {
    const t = this.getTile(x, y);
    if (!t) return 'Off the map';
    if (!STRUCTURES[tool]?.capacity) return null;
    const s = t.structure;
    const holdsPeople = (type) => !!STRUCTURES[type]?.capacity;
    if (s && (holdsPeople(s.type) || (s.type === 'rubble' && holdsPeople(s.was)))) return null;
    return this.accessRoad(x, y) ? null : 'Homes need a road beside them';
  }

  canApply(tool, x, y) {
    const t = this.getTile(x, y);
    if (!t) return false;
    if (tool === 'bulldoze') return !!t.structure || t.terrain === 'water';
    if (tool === 'water') return t.terrain !== 'water' || !!t.structure;
    if (!STRUCTURES[tool]) return false;
    if (this.placeError(tool, x, y)) return false;
    // Building the same thing again over storm damage rebuilds it.
    const s = t.structure;
    return s?.type !== tool || !!s.broken || !!s.snowed || (s.damage || 0) >= 0.34;
  }

  // The one entry point for player edits. Returns true when the city changed.
  // `delay` (seconds) lets a batch of edits animate one after another.
  apply(tool, x, y, { delay = 0 } = {}) {
    if (!this.canApply(tool, x, y)) return false;
    const t = this.getTile(x, y);
    const previous = t.structure;
    if (tool === 'bulldoze') {
      if (t.structure) t.structure = null;
      else t.terrain = 'grass';
      this._changed(x, y);
      this.emit('removed', { x, y, previous, wasWater: !previous, delay });
      return true;
    }
    if (tool === 'water') {
      t.structure = null;
      t.terrain = 'water';
      this._changed(x, y);
      this.emit('watered', { x, y, previous, delay });
      return true;
    }
    t.terrain = 'grass';
    t.structure = this.createStructure(tool);
    this._changed(x, y);
    this.emit('placed', { x, y, structure: t.structure, previous, delay });
    return true;
  }

  // Apply one tool along a stroke of tiles. Returns how many tiles changed.
  applyMany(tool, coords) {
    let n = 0;
    this.emit('batchStart', { tool, count: coords.length });
    for (const { x, y } of coords) if (this.apply(tool, x, y, { delay: n * 0.035 })) n++;
    this.emit('batchEnd', { tool, count: n });
    return n;
  }

  // Copy of the given tiles' saved state, for undo.
  snapshot(coords) {
    return coords
      .map(({ x, y }) => this.getTile(x, y))
      .filter(Boolean)
      .map((t) => ({ x: t.x, y: t.y, terrain: t.terrain, structure: t.structure ? { ...t.structure } : null }));
  }

  restore(snap) {
    for (const s of snap) {
      const t = this.getTile(s.x, s.y);
      if (!t) continue;
      t.terrain = s.terrain;
      t.structure = s.structure ? { ...s.structure } : null;
      this._changed(s.x, s.y);
    }
    this.emit('restored', { tiles: snap.map(({ x, y }) => ({ x, y })) });
  }

  createStructure(type, rand = Math.random) {
    const s = { id: this.nextId++, type, residents: 0 };
    if (VARIANT_TYPES.has(type)) s.variant = VARIANT_KEYS[Math.floor(rand() * VARIANT_KEYS.length)];
    if (type === 'tower') s.floors = 4 + Math.floor(rand() * 3);
    if (type === 'apartments') s.floors = 3 + Math.floor(rand() * 2);
    if (type === 'office') s.floors = 3 + Math.floor(rand() * 3);
    if (type === 'tree') s.shape = Math.floor(rand() * 4);
    return s;
  }

  _changed(x, y) {
    this.dirty = true;
    this.revision++;
    this.updateRoadMask(x, y);
    for (const d of DIRS) this.updateRoadMask(x + d.dx, y + d.dy);
  }

  updateRoadMask(x, y) {
    const t = this.getTile(x, y);
    if (!t) return;
    let m = 0;
    if (t.structure?.type === 'road') for (const d of DIRS) if (this.isRoad(x + d.dx, y + d.dy)) m |= d.bit;
    t.roadMask = m;
  }

  refreshAllRoadMasks() {
    this.revision++;
    for (const t of this.tiles) this.updateRoadMask(t.x, t.y);
  }

  // Wipe every tile but keep time of day.
  reset() {
    this._buildTiles();
    delete this.systems.streets; // a new town gets new street names
    delete this.systems.trends;
    this.dirty = true;
    this.revision++;
  }

  // Grow or shrink the map. Existing tiles move by (offsetX, offsetY), so a town can be re-centred.
  resize(width, height, offsetX = 0, offsetY = 0) {
    const tiles = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const old = this.getTile(x - offsetX, y - offsetY);
        tiles.push(old ? Object.assign(old, { x, y }) : createTile(x, y));
      }
    }
    this.width = width;
    this.height = height;
    this.tiles = tiles;
    this.refreshAllRoadMasks();
    this.dirty = true;
    this.emit('resized', { width, height });
  }

  // Become a copy of another city (a shared town, or your own town coming back), keeping this object
  // so every system that holds it carries on.
  copyFrom(other) {
    this.width = other.width;
    this.height = other.height;
    this._buildTiles();
    other.tiles.forEach((t, i) => {
      this.tiles[i].terrain = t.terrain;
      this.tiles[i].structure = t.structure ? { ...t.structure } : null;
    });
    this.clock = other.clock;
    this.day = other.day;
    this.nextId = Math.max(other.nextId, 1);
    this.systems = JSON.parse(JSON.stringify(other.systems || {}));
    this.refreshAllRoadMasks();
    this.dirty = true;
    this.revision++;
  }

  toJSON() {
    return {
      width: this.width,
      height: this.height,
      clock: this.clock,
      day: this.day,
      nextId: this.nextId,
      systems: this.systems,
      tiles: this.tiles.map((t) => ({ terrain: t.terrain, structure: t.structure ? { ...t.structure } : null })),
    };
  }

  static fromJSON(d) {
    const city = new CityState(d.width | 0 || DEFAULT_MAP_SIZE, d.height | 0 || DEFAULT_MAP_SIZE);
    city.clock = Number.isFinite(d.clock) ? d.clock : 0.3;
    city.day = d.day | 0 || 1;
    city.nextId = d.nextId | 0 || 1;
    city.systems = d.systems && typeof d.systems === 'object' ? d.systems : {};
    (d.tiles || []).forEach((src, i) => {
      const t = city.tiles[i];
      if (!t || !src) return;
      t.terrain = src.terrain === 'water' ? 'water' : 'grass';
      const s = src.structure;
      if (s && STRUCTURES[s.type]) {
        const cap = STRUCTURES[s.type].capacity;
        t.structure = { ...s, id: s.id || city.nextId++, residents: Math.max(0, Math.min(cap, s.residents | 0)) };
      }
    });
    city.refreshAllRoadMasks();
    return city;
  }
}
