// Run with: node --test tests/
// Saves are never lost: unreadable slots are left alone, and visiting a shared town never touches a slot.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { CityState } = await import('../src/state.js');
const { generateSeed } = await import('../src/generator.js');
const { SAVE_VERSION } = await import('../src/config.js');
const P = await import('../src/persistence.js');

const KEY = 'pocket-metropolis:save';
const town = (size = 16, seed = 1) => {
  const c = new CityState(size, size);
  generateSeed(c, seed);
  return c;
};

test('a damaged save is kept: autosave refuses to write over it and a recovery copy is made', () => {
  store.clear();
  store.set(KEY, '{"version":2,"city":{"tiles":[');
  assert.deepEqual(P.readSlot(1), { status: 'broken', newer: false });
  assert.ok(P.isLocked(1));
  assert.equal(store.get(`${KEY}:recovery`), '{"version":2,"city":{"tiles":[');
  assert.equal(P.saveCity(town(), 1), false, 'autosave leaves it alone');
  assert.equal(P.saveCurrent(town()), false);
  assert.equal(store.get(KEY), '{"version":2,"city":{"tiles":[');
  assert.equal(P.loadCity(1), null);
  // The player choosing to save over it is allowed, and lifts the lock.
  assert.ok(P.saveCity(town(), 1, { force: true }));
  assert.equal(P.isLocked(1), false);
  assert.equal(P.readSlot(1).status, 'ok');
});

test('a save from a newer version of the game is kept for that version', () => {
  store.clear();
  const save = { version: SAVE_VERSION + 1, savedAt: 1, meta: { pop: 9 }, city: town().toJSON() };
  store.set(`${KEY}:2`, JSON.stringify(save));
  assert.deepEqual(P.readSlot(2), { status: 'broken', newer: true });
  const info = P.slotInfo(2);
  assert.ok(info.broken && info.newer);
  assert.equal(P.saveCity(town(), 2), false);
  assert.equal(JSON.parse(store.get(`${KEY}:2`)).version, SAVE_VERSION + 1);
  assert.equal(P.firstEmptySlot(), 1);
  assert.ok(P.deleteSlot(2), 'deleting is the way to reuse it');
  assert.ok(P.saveCity(town(), 2));
});

test('visiting a shared town saves the visit under its own key and never into a slot', () => {
  store.clear();
  const own = town(16, 1);
  P.setActiveSlot(1);
  assert.ok(P.saveCity(own));
  const before = store.get(KEY);
  assert.equal(P.isVisiting(), false);

  const shared = town(32, 7);
  assert.ok(P.saveVisit(shared));
  assert.ok(P.isVisiting());
  assert.ok(P.saveCurrent(shared), 'autosave while visiting');
  assert.equal(store.get(KEY), before, 'your own town is untouched');
  assert.equal(P.loadVisit().width, 32);

  // Switching slots while visiting still leaves every slot alone.
  P.setActiveSlot(2);
  P.saveCurrent(shared);
  assert.equal(store.get(`${KEY}:2`), undefined);

  P.endVisit();
  assert.equal(P.isVisiting(), false);
  assert.equal(P.loadVisit(), null);
  assert.equal(P.loadCity(1).width, 16);
});

test('a backup left by an older version goes into an empty slot, never over a town', () => {
  store.clear();
  for (const n of [1, 2, 3]) P.saveCity(town(16, n), n);
  const legacy = JSON.stringify({ version: SAVE_VERSION, savedAt: 1, city: town(48, 9).toJSON() });
  store.set(`${KEY}:backup`, legacy);
  assert.deepEqual(P.rescueLegacyBackup(), { slot: null }, 'slots full: kept where it is');
  assert.equal(store.get(`${KEY}:backup`), legacy);
  for (const n of [1, 2, 3]) assert.equal(P.loadCity(n).width, 16);

  P.deleteSlot(2);
  assert.deepEqual(P.rescueLegacyBackup(), { slot: 2 });
  assert.equal(P.loadCity(2).width, 48);
  assert.equal(store.get(`${KEY}:backup`), undefined);
  assert.equal(P.rescueLegacyBackup(), null);
});
