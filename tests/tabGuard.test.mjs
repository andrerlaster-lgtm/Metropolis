// Run with: node --test tests/
// Only one tab plays at a time; another can take over safely.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TabGuard } from '../src/tabGuard.js';

// A small stand-in for navigator.locks with the options the guard uses: ifAvailable, steal, signal.
class FakeLocks {
  constructor() {
    this.holder = null;
    this.queue = [];
  }
  request(name, opts, cb) {
    return new Promise((resolve, reject) => {
      const entry = { name, cb, resolve, reject };
      if (opts.steal) {
        this.holder?.reject(new Error('AbortError'));
        return this.grant(entry);
      }
      if (!this.holder) return this.grant(entry);
      if (opts.ifAvailable) return Promise.resolve(cb(null)).then(resolve, reject);
      this.queue.push(entry);
      opts.signal?.addEventListener('abort', () => {
        const i = this.queue.indexOf(entry);
        if (i >= 0) {
          this.queue.splice(i, 1);
          reject(new Error('AbortError'));
        }
      });
    });
  }
  grant(entry) {
    this.holder = entry;
    Promise.resolve(entry.cb({ name: entry.name })).then((v) => {
      if (this.holder !== entry) return; // stolen meanwhile
      this.holder = null;
      entry.resolve(v);
      const next = this.queue.shift();
      if (next) this.grant(next);
    });
  }
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

test('the first tab plays; a second one opens read-only', async () => {
  const locks = new FakeLocks();
  const a = new TabGuard({ locks, name: 't1' });
  const b = new TabGuard({ locks, name: 't1' });
  assert.equal(await a.claim(), true);
  assert.equal(await b.claim(), false);
  assert.ok(a.active && !b.active);
  a.close();
  b.close();
});

test('taking over asks the playing tab to save and step aside first', async () => {
  const locks = new FakeLocks();
  const a = new TabGuard({ locks, name: 't2' });
  const b = new TabGuard({ locks, name: 't2', wait: 2000 });
  const log = [];
  a.beforeYield = () => log.push('a saved');
  a.onLost = () => log.push('a stepped aside');
  await a.claim();
  await b.claim();
  await b.takeOver();
  assert.deepEqual(log, ['a saved', 'a stepped aside']);
  assert.ok(b.active && !a.active);
  a.close();
  b.close();
});

test('a tab that does not answer (frozen in the background) loses the lock after a short wait', async () => {
  const locks = new FakeLocks();
  const a = new TabGuard({ locks, name: 't3', Channel: null }); // never hears the request
  const b = new TabGuard({ locks, name: 't3', wait: 30 });
  let lost = false;
  a.beforeYield = () => assert.fail('a frozen tab cannot save');
  a.onLost = () => (lost = true);
  await a.claim();
  await b.takeOver();
  await tick();
  assert.ok(b.active);
  assert.ok(lost && !a.active, 'the frozen tab stops saving when it wakes');
  b.close();
});

test('without Web Locks the game plays as before', async () => {
  const g = new TabGuard({ locks: null });
  assert.equal(await g.claim(), true);
  assert.equal(g.supported, false);
});
