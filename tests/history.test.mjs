import test from 'node:test';
import assert from 'node:assert/strict';
import { CityState } from '../src/state.js';
import { History, lPath, tileLine } from '../src/history.js';
import { generateTown } from '../src/generator.js';

const types = (city) => city.tiles.map((t) => (t.terrain === 'water' ? '~' : t.structure?.type[0] || '.')).join('');

test('roads drag as an L along the longer axis first', () => {
  const p = lPath({ x: 2, y: 2 }, { x: 6, y: 4 });
  assert.deepEqual(p[0], { x: 2, y: 2 });
  assert.deepEqual(p[4], { x: 6, y: 2 });
  assert.deepEqual(p.at(-1), { x: 6, y: 4 });
  assert.equal(p.length, 7);
});

test('brush strokes cover every tile along a fast drag', () => {
  const line = tileLine({ x: 0, y: 0 }, { x: 5, y: 3 });
  assert.deepEqual(line[0], { x: 0, y: 0 });
  assert.deepEqual(line.at(-1), { x: 5, y: 3 });
  for (let i = 1; i < line.length; i++) {
    assert.ok(Math.abs(line[i].x - line[i - 1].x) <= 1 && Math.abs(line[i].y - line[i - 1].y) <= 1);
  }
});

test('a whole stroke undoes and redoes in one step', () => {
  const city = new CityState(10, 10);
  const history = new History(city);
  const before = types(city);
  const coords = lPath({ x: 1, y: 1 }, { x: 7, y: 4 });
  history.record('road', coords, () => city.applyMany('road', coords));
  const after = types(city);
  assert.notEqual(before, after);
  assert.equal(city.getTile(4, 1).roadMask, 2 | 8, 'road links are rebuilt');
  history.undo();
  assert.equal(types(city), before);
  assert.equal(city.getTile(4, 1).roadMask, 0);
  history.redo();
  assert.equal(types(city), after);
});

test('undo restores what a bulldozer removed, residents included', () => {
  const city = new CityState(6, 6);
  const history = new History(city);
  city.apply('road', 2, 3);
  city.apply('house', 2, 2);
  city.getTile(2, 2).structure.residents = 3;
  history.record('bulldozing', [{ x: 2, y: 2 }], () => city.apply('bulldoze', 2, 2));
  assert.equal(city.getTile(2, 2).structure, null);
  history.undo();
  assert.equal(city.getTile(2, 2).structure.type, 'house');
  assert.equal(city.getTile(2, 2).structure.residents, 3);
});

test('edits that change nothing are not recorded, and new edits clear redo', () => {
  const city = new CityState(6, 6);
  const history = new History(city);
  assert.equal(history.record('nothing', [{ x: 1, y: 1 }], () => city.apply('bulldoze', 1, 1)), false);
  assert.equal(history.canUndo, false);
  history.record('tree', [{ x: 1, y: 1 }], () => city.apply('tree', 1, 1));
  history.undo();
  assert.ok(history.canRedo);
  city.apply('road', 2, 3);
  history.record('house', [{ x: 2, y: 2 }], () => city.apply('house', 2, 2));
  assert.equal(history.canRedo, false);
});

test('Random Town can be undone', () => {
  const city = new CityState(16, 16);
  generateTown(city, 3);
  const history = new History(city);
  const before = types(city);
  history.record('Random Town', city.tiles.map((t) => ({ x: t.x, y: t.y })), () => (generateTown(city, 4), true));
  assert.notEqual(types(city), before);
  history.undo();
  assert.equal(types(city), before);
});
