// Save slots sheet: three towns side by side. Play one, start a new town (with a new main person) in
// an empty slot, save a copy of the current town into another slot, or delete one you're done with.
// Deleting asks twice. The slot you're playing is saved automatically.

import { SLOT_COUNT, activeSlot, slotInfo, isVisiting } from './persistence.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';

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
  constructor({ onPlay, onHome, onNew, onCopy, onDelete, onOpen, beforeOpen }) {
    this.h = { onPlay, onHome, onNew, onCopy, onDelete, onOpen, beforeOpen };
    this.el = document.getElementById('slots-sheet');
    this.confirm = null; // slot waiting for a second tap to delete
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const n = Number(b.dataset.slot);
      const act = b.dataset.act;
      if (b.dataset.close != null) return this.toggle(false);
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

  toggle(force) {
    const open = force ?? this.el.hidden;
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
          `<p>${info.pop.toLocaleString()} residents · ${info.width}×${info.width}${info.mode === 'sandbox' ? ' · Sandbox' : ''}</p>` +
          (info.person ? `<p>${info.alive === false ? 'Was following' : 'Following'} <b>${esc(info.person)}</b>${info.generation > 1 ? ` · generation ${info.generation}` : ''}</p>` : '<p>No main person yet</p>') +
          `<p class="slot-when">Saved ${ago(info.savedAt)}</p>`;
      const actions = playing
        ? '<span class="slot-badge">Playing now</span>'
        : n === active
        ? `<span class="slot-badge">Your town</span>${info && !info.broken ? '<button type="button" class="primary-btn small" data-act="home">Back to my town</button>' : ''}`
        : (info && !info.broken ? `<button type="button" class="primary-btn small" data-act="play" data-slot="${n}">Play</button>` : '') +
          `<button type="button" class="ghost-btn small" data-act="new" data-slot="${n}">${info ? 'New town here' : 'Start a new town'}</button>` +
          `<button type="button" class="ghost-btn small" data-act="copy" data-slot="${n}"${info?.broken ? ' data-broken' : ''}>${!info ? 'Save a copy here' : this.confirm === `copy${n}` ? 'Tap again to overwrite' : 'Overwrite with this town'}</button>` +
          (info ? `<button type="button" class="ghost-btn small danger" data-act="delete" data-slot="${n}">${this.confirm === n ? 'Tap again to delete' : 'Delete'}</button>` : '');
      cards.push(`<li class="slot${playing ? ' playing' : ''}"><span class="slot-num">${n}</span><div class="slot-body">${body}<div class="slot-actions">${actions}</div></div></li>`);
    }
    this.el.innerHTML =
      `<header><h2>Save slots</h2><button type="button" class="insp-close" data-close aria-label="Close">${CLOSE}</button></header>` +
      (visiting
        ? `<p class="sheet-hint">You're visiting a shared town. It isn't in a save slot: save a copy into an empty slot to keep it. Your own town is safe in slot ${active}.</p>`
        : '<p class="sheet-hint">Keep up to three towns. The one you are playing saves itself as you go.</p>') +
      `<ul class="slots">${cards.join('')}</ul>`;
  }
}
