// Save slots sheet: three towns side by side. Play one, start a new town (with a new main person) in
// an empty slot, save a copy of the current town into another slot, or delete one you're done with.
// Deleting asks twice. The slot you're playing is saved automatically. Any town can be exported as a
// file, and a file imported back into a slot you choose (replacing a town asks twice).

import { SLOT_COUNT, MAX_IMPORT_BYTES, activeSlot, slotInfo, isVisiting, exportSlot, parseImport, importInto, keepSavesSafe } from './persistence.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';

const IMPORT_ERRORS = {
  size: "That file is too big to be a Pocket Metropolis town.",
  newer: 'That town was saved by a newer version of Pocket Metropolis. Reload the page to update, then try again.',
  invalid: "That file isn't a Pocket Metropolis town, or it's damaged.",
};

// Save a text file through the browser's download.
function download({ name, text }) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const residents = (n) => `${n.toLocaleString()} resident${n === 1 ? '' : 's'}`;

function ago(ms) {
  if (!ms) return '';
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export class SlotsSheet {
  constructor({ onPlay, onHome, onNew, onCopy, onDelete, onOpen, beforeOpen, onImported, toast }) {
    this.h = { onPlay, onHome, onNew, onCopy, onDelete, onOpen, beforeOpen, onImported, toast };
    this.el = document.getElementById('slots-sheet');
    this.confirm = null; // slot waiting for a second tap to delete
    this.importing = null; // a checked town file waiting for the player to pick its slot
    this.safe = undefined; // whether the browser promised to keep saves (null: can't tell)
    this.file = document.createElement('input');
    this.file.type = 'file';
    this.file.accept = '.json,application/json';
    this.file.hidden = true;
    document.body.appendChild(this.file);
    this.file.addEventListener('change', () => this.readFile(this.file.files?.[0]));
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const n = Number(b.dataset.slot);
      const act = b.dataset.act;
      if (b.dataset.close != null) return this.toggle(false);
      if (b.dataset.import != null) {
        this.file.value = '';
        return this.file.click();
      }
      if (b.dataset.cancelImport != null) {
        this.importing = null;
        this.confirm = null;
        return this.render();
      }
      if (act === 'export') {
        this.h.beforeOpen?.(); // save the town you're playing first, so the file is up to date
        const file = exportSlot(n);
        if (file) {
          download(file);
          this.h.toast?.(`Exported slot ${n} as ${file.name}`, 3600);
        }
        return;
      }
      if (act === 'put') {
        if (slotInfo(n) && this.confirm !== `put${n}`) {
          this.confirm = `put${n}`;
          return this.render();
        }
        this.confirm = null;
        if (!importInto(n, this.importing)) return this.h.toast?.('There was no room to save it. Delete a slot and try again', 4200);
        this.importing = null;
        this.toggle(false);
        return this.h.onImported(n);
      }
      if (act === 'play') {
        this.toggle(false);
        return this.h.onPlay(n);
      }
      if (act === 'home') {
        this.toggle(false);
        return this.h.onHome();
      }
      if (act === 'new') {
        this.toggle(false);
        return this.h.onNew(n);
      }
      if (act === 'copy') {
        // Writing over an unreadable save (maybe a town from a newer version) asks twice, like Delete.
        if (b.dataset.broken != null && this.confirm !== `copy${n}`) {
          this.confirm = `copy${n}`;
          return this.render();
        }
        this.confirm = null;
        this.h.onCopy(n);
        return this.render();
      }
      if (act === 'delete') {
        if (this.confirm !== n) {
          this.confirm = n;
          return this.render();
        }
        this.confirm = null;
        this.h.onDelete(n);
        return this.render();
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.el.hidden) this.toggle(false);
    });
  }

  get open() {
    return !this.el.hidden;
  }

  // Check a picked file; a good one waits for the player to choose its slot.
  readFile(f) {
    if (!f) return;
    if (f.size > MAX_IMPORT_BYTES) return this.h.toast?.(IMPORT_ERRORS.size, 4200);
    f.text().then(
      (text) => {
        const parsed = parseImport(text);
        if (parsed.error) return this.h.toast?.(IMPORT_ERRORS[parsed.error], 5200);
        this.importing = parsed;
        this.confirm = null;
        if (this.el.hidden) this.toggle(true);
        else this.render();
      },
      () => this.h.toast?.("That file couldn't be read.", 4200)
    );
  }

  toggle(force) {
    const open = force ?? this.el.hidden;
    if (!open) this.importing = null;
    if (open && this.safe === undefined) {
      // Asked here rather than at start, since some browsers show a prompt for it.
      this.safe = null;
      keepSavesSafe().then((ok) => {
        this.safe = ok;
        if (!this.el.hidden) this.render();
      });
    }
    if (open) {
      this.h.onOpen?.();
      this.h.beforeOpen?.(); // save the current town first so its card is up to date
    }
    this.confirm = null;
    this.el.hidden = !open;
    if (open) this.render();
  }

  render() {
    const active = activeSlot();
    const visiting = isVisiting(); // your own town waits in the active slot while you visit
    const cards = [];
    for (let n = 1; n <= SLOT_COUNT; n++) {
      const info = slotInfo(n);
      const playing = n === active && !visiting;
      let body;
      if (!info) body = '<p class="slot-empty">Empty</p>';
      else if (info.broken)
        body = info.newer
          ? '<p class="slot-empty">Saved by a newer version of the game. Reload the page to update. The town is kept safe.</p>'
          : '<p class="slot-empty">This save could not be read. It is kept safe until you delete it or start a new town here.</p>';
      else
        body =
          `<p class="slot-title"><b>${esc(info.era || 'Town')}</b> · ${info.year}</p>` +
          `<p>${residents(info.pop)} · ${info.width}×${info.width}${info.mode === 'sandbox' ? ' · Sandbox' : ''}</p>` +
          (info.person ? `<p>${info.alive === false ? 'Was following' : 'Following'} <b>${esc(info.person)}</b>${info.generation > 1 ? ` · generation ${info.generation}` : ''}</p>` : '<p>No main person yet</p>') +
          `<p class="slot-when">Saved ${ago(info.savedAt)}</p>`;
      const exportBtn = info ? `<button type="button" class="ghost-btn small" data-act="export" data-slot="${n}">Export</button>` : '';
      const actions = this.importing
        ? `<button type="button" class="primary-btn small" data-act="put" data-slot="${n}">${!info ? 'Put it here' : this.confirm === `put${n}` ? 'Tap again to replace' : 'Replace this town'}</button>`
        : playing
        ? `<span class="slot-badge">Playing now</span>${exportBtn}`
        : n === active
        ? `<span class="slot-badge">Your town</span>${info && !info.broken ? '<button type="button" class="primary-btn small" data-act="home">Back to my town</button>' : ''}${exportBtn}`
        : (info && !info.broken ? `<button type="button" class="primary-btn small" data-act="play" data-slot="${n}">Play</button>` : '') +
          exportBtn +
          `<button type="button" class="ghost-btn small" data-act="new" data-slot="${n}">${info ? 'New town here' : 'Start a new town'}</button>` +
          `<button type="button" class="ghost-btn small" data-act="copy" data-slot="${n}"${info?.broken ? ' data-broken' : ''}>${!info ? 'Save a copy here' : this.confirm === `copy${n}` ? 'Tap again to overwrite' : 'Overwrite with this town'}</button>` +
          (info ? `<button type="button" class="ghost-btn small danger" data-act="delete" data-slot="${n}">${this.confirm === n ? 'Tap again to delete' : 'Delete'}</button>` : '');
      cards.push(`<li class="slot${playing ? ' playing' : ''}"><span class="slot-num">${n}</span><div class="slot-body">${body}<div class="slot-actions">${actions}</div></div></li>`);
    }
    const imp = this.importing?.city;
    const people = imp ? imp.tiles.reduce((sum, t) => sum + (t.structure?.residents || 0), 0) : 0;
    const hint = imp
      ? `<p class="sheet-hint"><b>Choose a slot for the imported town</b> (${imp.width}×${imp.height}, ${residents(people)}). It opens once it's in.</p>`
      : visiting
      ? `<p class="sheet-hint">You're visiting a shared town. It isn't in a save slot: save a copy into an empty slot to keep it. Your own town is safe in slot ${active}.</p>`
      : '<p class="sheet-hint">Keep up to three towns. The one you are playing saves itself as you go.</p>';
    const safety =
      this.safe === true
        ? 'Your browser has agreed to keep these saves. Export a town to keep a copy elsewhere, or to move it to another device.'
        : 'Saves live in this browser and go if its site data is cleared. Export a town to keep a copy, or to move it to another device.';
    this.el.innerHTML =
      `<header><h2>Save slots</h2><button type="button" class="insp-close" data-close aria-label="Close">${CLOSE}</button></header>` +
      hint +
      `<ul class="slots">${cards.join('')}</ul>` +
      (imp
        ? '<div class="sheet-actions"><button type="button" class="ghost-btn" data-cancel-import>Cancel import</button><span></span></div>'
        : `<div class="sheet-actions"><button type="button" class="ghost-btn" data-import>Import a town file…</button><span></span></div><p class="sheet-hint">${safety}</p>`);
  }
}
