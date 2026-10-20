// New town sheet: choose Sandbox or Milestones, a map size, how to start (a seed that grows, empty
// land, or a ready-made starter town), whether it grows by itself, and who your main person is.
// Opened from a save slot, the new town goes into that slot.

export const MAP_SIZES = [
  { id: 'small', label: 'Small', size: 16, hint: '16 × 16' },
  { id: 'medium', label: 'Medium', size: 32, hint: '32 × 32' },
  { id: 'large', label: 'Large', size: 48, hint: '48 × 48' },
];
const MODES = [
  { id: 'sandbox', label: 'Sandbox', hint: 'Everything unlocked. Build whatever you like.' },
  { id: 'milestones', label: 'Milestones', hint: 'Unlock buildings as your town grows.' },
];
const STARTS = [
  { id: 'seed', label: 'A seed', hint: 'A crossroads and a few cottages in 1850. Watch it grow into a city.' },
  { id: 'land', label: 'Empty land', hint: 'Grass, a river and woods. Start from scratch.' },
  { id: 'town', label: 'Starter town', hint: 'A little town that is already up and running.' },
];

const GROWTH = [
  { id: 'on', label: 'Grows by itself', hint: 'Homes, shops, streets and parks appear where people need them. You can still build.' },
  { id: 'off', label: 'I build it', hint: 'Nothing is built unless you build it.' },
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';

export class NewTownSheet {
  constructor({ onStart, onOpen, family, where }) {
    this.onStart = onStart; // ({ mode, size, start, grow, person, slot }) → build the new town
    this.onOpen = onOpen;
    this.where = where; // () → where a town with no slot chosen will go, if not the current slot
    this.family = family; // () → the main person's name, if there is one
    this.el = document.getElementById('newtown-sheet');
    this.choice = { mode: 'milestones', size: 'medium', start: 'seed', grow: 'on', person: 'new' };
    this.slot = null; // the save slot the town goes into (null: replace the current one)
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.close != null) return this.toggle(false);
      if (b.dataset.pick) {
        const [key, value] = b.dataset.pick.split(':');
        this.choice[key] = value;
        return this.render();
      }
      if (b.dataset.go != null) {
        const size = MAP_SIZES.find((m) => m.id === this.choice.size).size;
        this.toggle(false);
        this.onStart({ mode: this.choice.mode, size, start: this.choice.start, grow: this.choice.grow === 'on', person: this.choice.person, slot: this.slot });
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.el.hidden) this.toggle(false);
    });
  }

  get open() {
    return !this.el.hidden;
  }

  toggle(force, { slot = null } = {}) {
    const open = force ?? this.el.hidden;
    if (open) this.slot = slot;
    if (open) this.onOpen?.();
    this.el.hidden = !open;
    if (open) this.render();
  }

  render() {
    const name = this.family?.() || null;
    if (!name) this.choice.person = 'new';
    const group = (key, label, items) => {
      const current = items.find((i) => i.id === this.choice[key]);
      return (
        `<span class="sheet-label">${label}</span>` +
        `<div class="seg big" role="radiogroup" aria-label="${label}">${items
          .map((i) => `<button type="button" role="radio" data-pick="${key}:${i.id}" aria-checked="${i.id === this.choice[key]}" aria-pressed="${i.id === this.choice[key]}">${esc(i.label)}</button>`)
          .join('')}</div>` +
        `<p class="sheet-hint">${esc(current.hint)}</p>`
      );
    };
    this.el.innerHTML =
      `<header><h2>New town</h2><button type="button" class="insp-close" data-close aria-label="Close">${CLOSE}</button></header>` +
      group('mode', 'Mode', MODES) +
      group('size', 'Map size', MAP_SIZES) +
      group('start', 'Start with', STARTS) +
      group('grow', 'Growth', GROWTH) +
      (name
        ? group('person', 'Main person', [
            { id: 'new', label: 'Someone new', hint: 'Create a new main person to follow, then their children and grandchildren.' },
            { id: 'keep', label: `Keep ${name}`, hint: `${name} and the family move to the new town.` },
          ])
        : '') +
      '<button type="button" class="primary-btn" data-go>Start</button>' +
      `<p class="sheet-hint center">${this.slot ? `Starts in save slot ${this.slot}.` : esc(this.where?.() || 'This replaces the town in your current save slot. Use Save slots to keep it.')}</p>`;
  }
}
