// Persistence: versioned saves in localStorage. Add a migration whenever SAVE_VERSION goes up.
//
// Two rules keep towns from being lost:
//  - A slot whose save can't be read (damaged, or written by a newer version of the game) is never
//    written over by autosave. Its raw text is also copied to a recovery key. Only something the
//    player chooses for that slot (delete it, start a new town there, save a copy over it) replaces it.
//  - A shared town you're visiting lives in its own key, never in a save slot, so visiting one (and
//    switching slots while you do) can't touch your own towns.

import { SAVE_VERSION } from './config.js';
import { CityState } from './state.js';
import { ERAS, yearOf } from './eras.js';

const KEY = 'pocket-metropolis:save';
const ACTIVE_KEY = 'pocket-metropolis:slot';
export const SLOT_COUNT = 3;

// Three save slots. Slot 1 uses the original key, so towns saved before slots existed stay in it.
const slotKey = (n) => (n === 1 ? KEY : `${KEY}:${n}`);

export function activeSlot() {
  try {
    const n = Number(localStorage.getItem(ACTIVE_KEY));
    return n >= 1 && n <= SLOT_COUNT ? n : 1;
  } catch {
    return 1;
  }
}

export function setActiveSlot(n) {
  try {
    localStorage.setItem(ACTIVE_KEY, String(n));
  } catch {
    // Private mode: stay on the current slot for this visit.
  }
}

// A short description of a town for the save slots sheet.
export function metaOf(city) {
  const life = city.systems.life?.char;
  const era = ERAS[city.systems.era?.index ?? 0];
  let pop = 0;
  for (const t of city.tiles) pop += t.structure?.residents || 0;
  return {
    pop,
    year: yearOf(city),
    era: era?.label || '',
    day: city.day,
    person: life ? `${life.first} ${life.last}` : null,
    alive: life ? life.alive !== false : null,
    generation: life?.generation || null,
    width: city.width,
    mode: city.systems.mode || 'milestones',
  };
}

// Slots found unreadable this visit. Autosave leaves them alone.
const locked = new Set();

function getRaw(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// Keep the text of an unreadable save under a recovery key (once), so it can be rescued later.
function keepForRecovery(n, raw) {
  try {
    const key = `${slotKey(n)}:recovery`;
    if (localStorage.getItem(key) !== raw) localStorage.setItem(key, raw);
  } catch {
    // No room for a copy; the slot itself is still left untouched.
  }
}

function unreadable(n, raw, newer) {
  locked.add(n);
  keepForRecovery(n, raw);
  return { status: 'broken', newer };
}

// What's saved in a slot: { status: 'empty' }, { status: 'ok', city, save } or
// { status: 'broken', newer } (newer: written by a later version of the game).
export function readSlot(n) {
  const raw = getRaw(slotKey(n));
  if (!raw) return { status: 'empty' };
  let save;
  try {
    save = JSON.parse(raw);
  } catch {
    return unreadable(n, raw, false);
  }
  if ((save?.version | 0) > SAVE_VERSION) return unreadable(n, raw, true);
  try {
    return { status: 'ok', city: CityState.fromJSON(migrate(save).city), save };
  } catch {
    return unreadable(n, raw, false);
  }
}

// Is this slot's save unreadable (and so protected from autosave)?
export function isLocked(n) {
  return locked.has(n);
}

// What's in a slot, without loading it: null when empty.
export function slotInfo(n) {
  const raw = getRaw(slotKey(n));
  if (!raw) return null;
  try {
    const save = JSON.parse(raw);
    if ((save?.version | 0) > SAVE_VERSION) return { ...unreadable(n, raw, true), broken: true };
    if (save.meta) return { ...save.meta, savedAt: save.savedAt };
    const city = CityState.fromJSON(migrate(save).city);
    return { ...metaOf(city), savedAt: save.savedAt };
  } catch {
    return { ...unreadable(n, raw, false), broken: true };
  }
}

export function firstEmptySlot() {
  for (let n = 1; n <= SLOT_COUNT; n++) if (!getRaw(slotKey(n))) return n;
  return null;
}

// Deleting is the player's choice, so it also lifts the lock on an unreadable slot.
export function deleteSlot(n) {
  try {
    localStorage.removeItem(slotKey(n));
    locked.delete(n);
    return true;
  } catch {
    return false;
  }
}

// MIGRATIONS[n] upgrades a save from version n to n + 1.
export const MIGRATIONS = {
  // v1 → v2: maps grew from 12×12 to 32×32. Old towns keep every tile and move to the middle.
  1: (save) => {
    const c = save.city;
    const size = Math.max(32, c.width | 0, c.height | 0);
    const ox = Math.floor((size - c.width) / 2);
    const oy = Math.floor((size - c.height) / 2);
    const tiles = Array.from({ length: size * size }, () => ({ terrain: 'grass', structure: null }));
    c.tiles.forEach((t, i) => {
      const x = i % c.width;
      const y = Math.floor(i / c.width);
      tiles[(y + oy) * size + x + ox] = t;
    });
    save.city = { ...c, width: size, height: size, tiles };
    return save;
  },
};

function migrate(save) {
  let v = save.version | 0;
  if (v < 1 || v > SAVE_VERSION) throw new Error(`Unsupported save version ${save.version}`);
  while (v < SAVE_VERSION) {
    save = MIGRATIONS[v](save);
    v++;
    save.version = v;
  }
  return save;
}

// Save a town into a slot. An unreadable slot is only written when the player chose to (`force`).
export function saveCity(city, slot = activeSlot(), { force = false } = {}) {
  if (locked.has(slot) && !force) return false;
  try {
    const save = { version: SAVE_VERSION, savedAt: Date.now(), meta: metaOf(city), city: city.toJSON() };
    localStorage.setItem(slotKey(slot), JSON.stringify(save));
    locked.delete(slot);
    return true;
  } catch {
    return false;
  }
}

export function loadCity(slot = activeSlot()) {
  const r = readSlot(slot);
  return r.status === 'ok' ? r.city : null;
}

// ---- Town files ------------------------------------------------------------------------
// Export a slot as a file and import one back, so a town survives clearing the browser or moving
// to another device. A file is the save exactly as stored (an unreadable save exports as-is, so it
// can be rescued by a newer version of the game).
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const fileName = (bits) => `pocket-metropolis-${bits.join('-').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.json`;

// { name, text } for a slot's save, or null when the slot is empty.
export function exportSlot(n) {
  const text = getRaw(slotKey(n));
  if (!text) return null;
  const info = slotInfo(n);
  return { name: fileName(info && !info.broken ? [info.era, info.year, `${info.pop}-people`] : [`slot-${n}`, 'unreadable']), text };
}

// { name, text } for the town being played, straight from memory: up to date even when saving fails.
export function exportCity(city) {
  const meta = metaOf(city);
  const text = JSON.stringify({ version: SAVE_VERSION, savedAt: Date.now(), meta, city: city.toJSON() });
  return { name: fileName([meta.era, meta.year, `${meta.pop}-people`]), text };
}

// Check a file before it goes anywhere: { city, text } or { error: 'size' | 'newer' | 'invalid' }.
export function parseImport(text) {
  if (typeof text !== 'string' || text.length > MAX_IMPORT_BYTES) return { error: 'size' };
  let save;
  try {
    save = JSON.parse(text);
  } catch {
    return { error: 'invalid' };
  }
  const c = save?.city;
  if (!c || !Array.isArray(c.tiles) || !(save.version >= 1)) return { error: 'invalid' };
  if (save.version > SAVE_VERSION) return { error: 'newer' };
  try {
    const city = CityState.fromJSON(migrate(save).city);
    const ok = city.width >= 8 && city.width <= 64 && city.height >= 8 && city.height <= 64;
    return ok ? { city } : { error: 'invalid' };
  } catch {
    return { error: 'invalid' };
  }
}

// Put a checked town into a slot. Choosing the slot is the player's call, so it may replace anything.
export function importInto(n, parsed) {
  return !!parsed?.city && saveCity(parsed.city, n, { force: true });
}

// Ask the browser not to clear saves when space runs low. Resolves true, false, or null if unknown.
export async function keepSavesSafe() {
  try {
    const st = globalThis.navigator?.storage;
    if (!st?.persist) return null;
    return (await st.persisted?.()) || (await st.persist());
  } catch {
    return null;
  }
}

// ---- Visiting a shared town -------------------------------------------------------------
// The visit has its own key; your own town stays in its slot (activeSlot) the whole time.
const VISIT_KEY = `${KEY}:visit`;

export function isVisiting() {
  return !!getRaw(VISIT_KEY);
}

export function saveVisit(city) {
  try {
    localStorage.setItem(VISIT_KEY, JSON.stringify({ version: SAVE_VERSION, savedAt: Date.now(), city: city.toJSON() }));
    return true;
  } catch {
    return false;
  }
}

export function loadVisit() {
  try {
    const raw = localStorage.getItem(VISIT_KEY);
    return raw ? CityState.fromJSON(migrate(JSON.parse(raw)).city) : null;
  } catch {
    return null;
  }
}

export function endVisit() {
  try {
    localStorage.removeItem(VISIT_KEY);
  } catch {
    // Nothing to clear.
  }
}

// Save wherever the town being played belongs: the visit key while visiting, else its slot.
export function saveCurrent(city) {
  return isVisiting() ? saveVisit(city) : saveCity(city);
}

// Before visits had their own key, your own town was copied to a backup key and the shared town was
// saved over your slot. A backup left from then goes into an empty slot rather than over anything.
const LEGACY_BACKUP_KEY = `${KEY}:backup`;

export function rescueLegacyBackup() {
  const raw = getRaw(LEGACY_BACKUP_KEY);
  if (!raw) return null;
  const n = firstEmptySlot();
  if (!n) return { slot: null };
  try {
    const save = JSON.parse(raw);
    const city = CityState.fromJSON(migrate(save).city);
    if (!saveCity(city, n)) return { slot: null };
    localStorage.removeItem(LEGACY_BACKUP_KEY);
    return { slot: n };
  } catch {
    return { slot: null };
  }
}

// Why the town being played isn't saving: 'locked' (it has no slot it may write: every slot was taken
// when its own save couldn't be read) or 'storage' (the browser refused: full, or storage blocked).
function saveProblem() {
  return !isVisiting() && locked.has(activeSlot()) ? 'locked' : 'storage';
}

// How often a save problem is mentioned again while it lasts.
export const WARN_EVERY_MS = 2 * 60 * 1000;

// Saves shortly after each edit, every so often while the city lives, and when the page is hidden.
// When saving fails it says so through onFail(reason) (again every WARN_EVERY_MS while it lasts), and
// onRecover() once it works again.
export class AutoSaver {
  constructor(city, { delayMs = 800, intervalS = 15, now = () => Date.now() } = {}) {
    this.city = city;
    this.delayMs = delayMs;
    this.intervalS = intervalS;
    this.now = now;
    this.pending = -1;
    this.since = 0;
    this.enabled = true; // false in a tab that isn't the one playing (see tabGuard.js)
    this.problem = null; // 'locked' | 'storage' while saves are failing
    this.warnedAt = -Infinity;
    this.onFail = null;
    this.onRecover = null;
    city.on((ev) => {
      if (['placed', 'removed', 'watered', 'reset', 'lifeChanged', 'lifeEvent'].includes(ev.type)) {
        this.pending = this.delayMs;
      }
    });
    const flush = () => this.flush();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', flush);
  }

  tick(dt) {
    this.since += dt;
    if (this.pending >= 0) {
      this.pending -= dt * 1000;
      if (this.pending < 0) this.flush();
    }
    if (this.since > this.intervalS) this.flush();
  }

  flush() {
    if (!this.enabled) return true;
    const ok = saveCurrent(this.city);
    this.since = 0;
    this.pending = -1;
    if (ok) {
      if (this.problem) {
        this.problem = null;
        this.warnedAt = -Infinity;
        this.onRecover?.();
      }
      return true;
    }
    const reason = saveProblem();
    const t = this.now();
    if (reason !== this.problem || t - this.warnedAt >= WARN_EVERY_MS) {
      this.warnedAt = t;
      this.onFail?.(reason);
    }
    this.problem = reason;
    return false;
  }
}
