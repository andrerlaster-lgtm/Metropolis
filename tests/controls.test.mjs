// Run with: node --test tests/
// Keyboard controls: tool shortcuts leave W, A, S and D to the camera, and typing in a text field is
// never mistaken for shortcuts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../src/config.js';
import { typingTarget } from '../src/input.js';

test('tool shortcuts are unique and leave WASD free for moving the camera', () => {
  const keys = TOOLS.map((t) => t.key);
  assert.equal(new Set(keys).size, keys.length, 'no two tools share a key');
  for (const k of ['w', 'a', 's', 'd']) assert.ok(!keys.includes(k), `${k} is a camera key`);
  assert.equal(TOOLS.find((t) => t.id === 'apartments').key, 'o');
});

// Just enough of an element for typingTarget: a tag, a type, and closest() for its own selector.
const el = (tag, type, editable = false) => ({
  tagName: tag,
  type,
  isContentEditable: editable,
  closest(sel) {
    return sel.split(',').map((s) => s.trim().toUpperCase()).includes(tag) ? this : null;
  },
});

test('text fields count as typing; buttons, checkboxes and the map do not', () => {
  for (const t of ['text', 'search', 'email', 'number', 'password', '']) assert.equal(typingTarget(el('INPUT', t)), true, `input ${t || '(no type)'}`);
  assert.equal(typingTarget(el('TEXTAREA')), true);
  assert.equal(typingTarget(el('SELECT')), true);
  assert.equal(typingTarget(el('DIV', undefined, true)), true, 'contenteditable');
  for (const t of ['button', 'checkbox', 'radio', 'range', 'file']) assert.equal(typingTarget(el('INPUT', t)), false, `input ${t}`);
  assert.equal(typingTarget(el('BUTTON')), false);
  assert.equal(typingTarget(el('CANVAS')), false);
  assert.equal(typingTarget(null), false);
});
