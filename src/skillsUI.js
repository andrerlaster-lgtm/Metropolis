// Town upgrades sheet: the skill tree from skills.js, four branches side by side (stacked on
// phones). Tap an upgrade to take it, tap it again to give the point back; Reset all gives every
// point back. Also keeps the ★ chip on the town card up to date, and gives the City panel its
// Town upgrades line. Reads and changes skills only; the simulation picks the changes up.

import { BRANCHES, SKILLS, SKILL, costOf, RESIDENTS_PER_POINT } from './skills.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The short line the City panel shows, with a button that opens the sheet.
export function upgradesLineHTML(sk) {
  const n = sk.available();
  return `<p class="sk-line">${n ? `<b>★ ${plural(n, 'point')} to spend.</b> ` : ''}${plural(sk.learned.length, 'upgrade')} taken. The next point comes in ${plural(sk.toNextPoint(), 'more resident')}, or with a new town title.</p><button type="button" class="ghost-btn small" data-upgrades>Town upgrades</button>`;
}
export const upgradesLineKey = (sk) => JSON.stringify([sk.available(), sk.learned.length, sk.toNextPoint()]);

export class SkillsSheet {
  // deps: { skills: () → Skills, onChange(), toast(msg, ms), sound(name), onOpen() }
  constructor(deps) {
    this.d = deps;
    this.el = document.getElementById('skills-sheet');
    this.chip = document.getElementById('skill-chip');
    this.open = false;
    this._key = '';
    this.el.addEventListener('click', (e) => this.onClick(e));
    // The chip sits on the town card, which opens the City panel: a tap here opens the upgrades instead.
    const fromChip = (e) => {
      e.stopPropagation();
      this.toggle(true);
    };
    this.chip.addEventListener('click', fromChip);
    this.chip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fromChip(e);
      }
    });
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape' || !this.open || e.target?.closest?.('input, textarea, select, [contenteditable]')) return;
        this.toggle(false);
        e.preventDefault();
        e.stopImmediatePropagation();
      },
      true
    );
  }

  get sk() {
    return this.d.skills();
  }

  toggle(force = !this.open) {
    this.open = force;
    this.el.hidden = !force;
    if (force) {
      this.d.onOpen?.();
      this.render(true);
    }
  }

  // A few times a second: the chip, and the sheet while it's open.
  tick() {
    const n = this.sk.available();
    this.chip.hidden = !n;
    if (n) {
      this.chip.textContent = `★ ${n}`;
      this.chip.setAttribute('aria-label', `${plural(n, 'upgrade point')} to spend. Open town upgrades`);
    }
    if (this.open) this.render(false);
  }

  render(force) {
    const sk = this.sk;
    const key = JSON.stringify([sk.learned, sk.available(), sk.toNextPoint()]);
    if (!force && key === this._key) return;
    this._key = key;
    const n = sk.available();
    this.el.innerHTML = `
      <header><h2>Town upgrades</h2><button type="button" class="insp-close" data-close aria-label="Close">${CLOSE}</button></header>
      <div class="sk-top">
        <p class="sk-points"><b>★ ${plural(n, 'point')}</b> to spend</p>
        <button type="button" class="ghost-btn small" data-reset ${sk.learned.length ? '' : 'disabled'}>Reset all</button>
      </div>
      <p class="sk-intro">Your town earns a point for every ${RESIDENTS_PER_POINT} residents at its biggest (${sk.toNextPoint()} more for the next) and one for each new town title. Tap an upgrade to take it; tap it again to get the point back. Changing your mind is free.</p>
      <div class="sk-branches">${BRANCHES.map((b) => this.branchHTML(b)).join('')}</div>`;
  }

  branchHTML(b) {
    const nodes = SKILLS.filter((s) => s.branch === b.id);
    const tiers = [...new Set(nodes.map((s) => s.tier))].sort((x, y) => x - y);
    return `<section class="sk-branch sk-${b.id}"><h3>${esc(b.label)}</h3><p class="sk-blurb">${esc(b.blurb)}</p>${tiers
      .map((t) => `<div class="sk-tier">${nodes.filter((s) => s.tier === t).map((s) => this.nodeHTML(s)).join('')}</div>`)
      .join('<span class="sk-link" aria-hidden="true"></span>')}</section>`;
  }

  nodeHTML(s) {
    const sk = this.sk;
    const have = sk.has(s.id);
    const err = have ? null : sk.learnError(s.id);
    const state = have ? 'have' : err ? (s.needs && !s.needs.some((n) => sk.has(n)) ? 'locked' : 'short') : 'ready';
    const c = costOf(s.id);
    const why = have ? 'Taken. Tap to give the point back' : err || `Take it for ${plural(c, 'point')}`;
    return `<button type="button" class="sk-node is-${state}" data-skill="${s.id}" aria-pressed="${have}" title="${esc(why)}">
      <span class="sk-name">${have ? '✓ ' : ''}${esc(s.name)}<span class="sk-cost">${c > 1 ? `★${c}` : '★'}</span></span>
      <span class="sk-text">${esc(s.text)}</span>
      ${state === 'locked' ? `<span class="sk-needs">Needs ${s.needs.map((n) => esc(SKILL[n].name)).join(' or ')}</span>` : ''}
    </button>`;
  }

  onClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.close != null) return this.toggle(false);
    const sk = this.sk;
    if (b.dataset.reset != null) {
      const n = sk.reset();
      if (n) {
        this.d.onChange?.();
        this.d.sound?.('undo');
        this.d.toast?.(`All ${plural(n, 'upgrade')} given back. Spend the points again however you like`, 3600);
      }
      return this.render(true);
    }
    const id = b.dataset.skill;
    if (!id) return;
    const r = sk.has(id) ? sk.forget(id) : sk.learn(id);
    if (r.error) {
      this.d.sound?.('nope');
      this.d.toast?.(r.error, 2600);
    } else {
      this.d.onChange?.();
      this.d.sound?.(r.learned ? 'chime' : 'undo');
      if (r.learned) this.d.toast?.(`${SKILL[id].name}: ${SKILL[id].text}`, 3200);
    }
    this.render(true);
  }
}
