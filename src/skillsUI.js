// Town upgrades sheet: the skill tree from skills.js. Eight branches down the side (a row of tabs on
// narrower screens); the chosen branch's tiers from first to last; and a panel with the selected
// upgrade: what it does, what it needs (each requirement ticked off) and a button to take it or give
// it back. Reset all gives every point back. Also keeps the ★ chip on the town card up to date, and
// gives the City panel its Town upgrades line. Reads and changes skills only; the simulation picks the
// changes up.

import { BRANCHES, SKILLS, SKILL, costOf, TIER_TITLE, MILESTONE_GEN, GEN_POINTS_MAX } from './skills.js';
import { MILESTONES } from './config.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const BRANCH_KEY = 'pocket-metropolis:upgrades-branch';

// The short line the City panel shows, with a button that opens the sheet.
export function upgradesLineHTML(sk) {
  const n = sk.available();
  return `<p class="sk-line">${n ? `<b>★ ${plural(n, 'point')} to spend.</b> ` : ''}${plural(sk.learned.length, 'upgrade')} of ${SKILLS.length} taken. The next point comes in ${plural(sk.toNextPoint(), 'more resident')}, with a new town title, a new era or a new generation.</p><button type="button" class="ghost-btn small" data-upgrades>Town upgrades</button>`;
}
export const upgradesLineKey = (sk) => JSON.stringify([sk.available(), sk.learned.length, sk.toNextPoint()]);

function readBranch() {
  try {
    const id = localStorage.getItem(BRANCH_KEY);
    return BRANCHES.some((b) => b.id === id) ? id : BRANCHES[0].id;
  } catch {
    return BRANCHES[0].id;
  }
}

export class SkillsSheet {
  // deps: { skills: () → Skills, onChange(), toast(msg, ms), sound(name), onOpen() }
  constructor(deps) {
    this.d = deps;
    this.el = document.getElementById('skills-sheet');
    this.chip = document.getElementById('skill-chip');
    this.open = false;
    this._key = '';
    this.branch = readBranch();
    this.selected = null;
    this.showSources = false;
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('keydown', (e) => this.onKey(e));
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
      // Open on a branch with something to take, if the remembered one has nothing.
      const sk = this.sk;
      if (sk.available() && !this.readyIn(this.branch)) this.branch = BRANCHES.find((b) => this.readyIn(b.id))?.id || this.branch;
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

  // How many upgrades in a branch could be taken right now.
  readyIn(branch) {
    const sk = this.sk;
    return SKILLS.filter((s) => s.branch === branch && !sk.has(s.id) && !sk.learnError(s.id)).length;
  }

  stateOf(s) {
    const sk = this.sk;
    if (sk.has(s.id)) return 'have';
    const err = sk.learnError(s.id);
    if (!err) return 'ready';
    if ((s.excludes || []).some((x) => sk.has(x))) return 'other';
    if (s.needs && !s.needs.some((n) => sk.has(n))) return 'locked';
    if (sk.gateError(s.id)) return 'gated';
    return 'short';
  }

  render(force) {
    const sk = this.sk;
    const key = JSON.stringify([sk.learned, sk.available(), sk.earned(), sk.toNextPoint(), sk.title(), sk.generation(), this.branch, this.selected, this.showSources]);
    if (!force && key === this._key) return;
    this._key = key;
    const n = sk.available();
    const spent = sk.spent();
    const b = BRANCHES.find((x) => x.id === this.branch);
    const sel = this.selected && SKILL[this.selected]?.branch === this.branch ? SKILL[this.selected] : null;
    // Keep the tree's scroll while on the same branch; a new branch starts at its first tier.
    const scrollTree = this._shown === this.branch ? this.el.querySelector('.sk-tree')?.scrollTop || 0 : 0;
    this._shown = this.branch;
    this.el.innerHTML = `
      <header><h2>Town upgrades</h2><button type="button" class="insp-close" data-close aria-label="Close">${CLOSE}</button></header>
      <div class="sk-top">
        <p class="sk-points"><b>★ ${plural(n, 'point')}</b> to spend</p>
        <div class="sk-progress" title="${sk.learned.length} of ${SKILLS.length} upgrades taken">
          <span class="sk-bar"><span style="width:${Math.round((100 * sk.learned.length) / SKILLS.length)}%"></span></span>
          <small>${sk.learned.length}/${SKILLS.length} upgrades · ${spent} of ${sk.earned()} points spent</small>
        </div>
        <button type="button" class="ghost-btn small" data-sources aria-expanded="${this.showSources}">Where points come from</button>
        <button type="button" class="ghost-btn small" data-reset ${sk.learned.length ? '' : 'disabled'}>Reset all</button>
      </div>
      ${this.showSources ? this.sourcesHTML() : ''}
      <div class="sk-layout">
        <nav class="sk-rail" role="tablist" aria-label="Branches">${BRANCHES.map((x) => this.tabHTML(x)).join('')}</nav>
        <section class="sk-tree sk-${b.id}" aria-label="${esc(b.label)}">
          <div class="sk-tree-head"><h3>${esc(b.label)}</h3><p class="sk-blurb">${esc(b.blurb)}</p></div>
          ${this.tiersHTML(b)}
        </section>
        <aside class="sk-detail sk-${b.id}" aria-live="polite">${sel ? this.detailHTML(sel) : this.hintHTML()}</aside>
      </div>`;
    const tree = this.el.querySelector('.sk-tree');
    if (tree) tree.scrollTop = scrollTree;
  }

  sourcesHTML() {
    const sk = this.sk;
    const s = sk.sources();
    const row = (label, v, note) => `<li><span>${label}</span><b>${v}</b>${note ? `<small>${note}</small>` : ''}</li>`;
    return `<ul class="sk-sources">
      ${row('To start', s.start)}
      ${row('Town titles', s.titles, `${MILESTONES[sk.title()].label} now`)}
      ${row(`Residents (one per ${sk.residentsPerPoint()})`, s.residents, `${sk.toNextPoint()} more for the next`)}
      ${row('New eras', s.eras)}
      ${row('Generations of your family', s.generations, `up to ${GEN_POINTS_MAX}`)}
      ${s.founders ? row('Founding families', s.founders) : ''}
      ${s.boom ? row('Boom town', s.boom) : ''}
    </ul>`;
  }

  tabHTML(b) {
    const sk = this.sk;
    const nodes = SKILLS.filter((s) => s.branch === b.id);
    const have = nodes.filter((s) => sk.has(s.id)).length;
    const ready = this.readyIn(b.id);
    const on = b.id === this.branch;
    return `<button type="button" role="tab" class="sk-tab sk-${b.id}${on ? ' is-on' : ''}" data-branch="${b.id}" aria-selected="${on}" tabindex="${on ? 0 : -1}">
      <span class="sk-tab-icon" aria-hidden="true">${b.icon}</span>
      <span class="sk-tab-label">${esc(b.label)}</span>
      <span class="sk-tab-count">${have}/${nodes.length}</span>
      ${ready && sk.available() ? `<span class="sk-dot" title="${plural(ready, 'upgrade')} ready to take"></span>` : ''}
    </button>`;
  }

  tiersHTML(b) {
    const sk = this.sk;
    const nodes = SKILLS.filter((s) => s.branch === b.id);
    const tiers = [...new Set(nodes.map((s) => s.tier))].sort((x, y) => x - y);
    return tiers
      .map((t) => {
        const row = nodes.filter((s) => s.tier === t);
        const fork = row.some((s) => s.excludes?.length);
        const top = row.some((s) => s.milestone);
        const title = TIER_TITLE[t] || 0;
        const open = top ? sk.title() >= title || sk.generation() >= MILESTONE_GEN : sk.title() >= title;
        const need = title ? (top ? `${MILESTONES[title].label} title or 3rd generation` : `${MILESTONES[title].label} title`) : '';
        return `<div class="sk-tier-row${fork ? ' is-fork' : ''}${top ? ' is-top' : ''}">
          <div class="sk-tier-label"><b>${top ? 'Milestone' : `Tier ${t}`}</b>${fork ? '<span class="sk-fork">Choose one</span>' : ''}${need ? `<small class="${open ? 'is-met' : ''}">${open ? '✓ ' : ''}${esc(need)}</small>` : ''}</div>
          <div class="sk-tier">${row.map((s, i) => (i && fork ? '<span class="sk-or" aria-hidden="true">or</span>' : '') + this.nodeHTML(s)).join('')}</div>
        </div>`;
      })
      .join('<span class="sk-link" aria-hidden="true"></span>');
  }

  nodeHTML(s) {
    const state = this.stateOf(s);
    const c = costOf(s.id);
    const on = this.selected === s.id;
    const label = { have: 'Taken', ready: 'Ready to take', short: 'Not enough points', locked: 'Needs an earlier upgrade', gated: 'The town needs to grow first', other: 'You chose the other one' }[state];
    return `<button type="button" class="sk-node is-${state}${on ? ' is-sel' : ''}" data-skill="${s.id}" aria-pressed="${on}" aria-label="${esc(`${s.name}. ${label}. ${plural(c, 'point')}.`)}">
      <span class="sk-name">${state === 'have' ? '✓ ' : ''}${esc(s.name)}<span class="sk-cost">★${c}</span></span>
      <span class="sk-text">${esc(s.text)}</span>
    </button>`;
  }

  hintHTML() {
    return `<p class="sk-hint">Tap an upgrade to see what it does and what it needs. Later tiers need the one before them and a bigger town; the last tier of each branch is a milestone. At each fork you choose one of two. Changing your mind is free: give points back any time.</p>`;
  }

  // The selected upgrade: what it does, each requirement with a tick or a cross, and the button.
  detailHTML(s) {
    const sk = this.sk;
    const have = sk.has(s.id);
    const c = costOf(s.id);
    const reqs = [];
    if (s.needs) reqs.push({ ok: s.needs.some((n) => sk.has(n)), text: `${s.needs.map((n) => SKILL[n].name).join(' or ')}` });
    const title = TIER_TITLE[s.tier] || 0;
    if (title) {
      const ok = sk.title() >= title || (s.milestone && sk.generation() >= MILESTONE_GEN);
      reqs.push({ ok, text: s.milestone ? `${MILESTONES[title].label} title, or your family’s third generation` : `${MILESTONES[title].label} title` });
    }
    if (s.gate?.gen) reqs.push({ ok: sk.generation() >= s.gate.gen, text: `Your family’s generation ${s.gate.gen} (now ${sk.generation()})` });
    if (s.excludes?.length) reqs.push({ ok: !s.excludes.some((x) => sk.has(x)), text: `Not with ${s.excludes.map((x) => SKILL[x].name).join(' or ')}` });
    reqs.push({ ok: have || sk.available() >= c, text: `${plural(c, 'point')} (you have ${sk.available()})` });
    const err = have ? sk.forgetError(s.id) : sk.learnError(s.id);
    const leadsTo = SKILLS.filter((x) => x.needs?.includes(s.id));
    return `<span class="insp-kicker">${s.milestone ? 'Milestone' : `Tier ${s.tier}`} · ★${c}</span>
      <h4>${have ? '✓ ' : ''}${esc(s.name)}</h4>
      <p class="sk-effect">${esc(s.text)}</p>
      <ul class="sk-reqs">${reqs.map((r) => `<li class="${r.ok ? 'is-ok' : 'is-no'}"><span aria-hidden="true">${r.ok ? '✓' : '✕'}</span> ${esc(r.text)}</li>`).join('')}</ul>
      ${leadsTo.length ? `<p class="sk-leads">Opens ${leadsTo.map((x) => `<b>${esc(x.name)}</b>`).join(' and ')}</p>` : ''}
      <button type="button" class="${have ? 'ghost-btn' : 'primary-btn'} sk-act" data-act="${s.id}" ${err ? 'disabled' : ''}>${have ? 'Give the points back' : `Take it for ★${c}`}</button>
      ${err ? `<p class="sk-why">${esc(err)}</p>` : ''}`;
  }

  setBranch(id) {
    this.branch = id;
    this.selected = null;
    try {
      localStorage.setItem(BRANCH_KEY, id);
    } catch {
      // Not remembered in a private window.
    }
    this.render(true);
    this.el.querySelector(`[data-branch="${id}"]`)?.focus();
  }

  onKey(e) {
    const tab = e.target.closest?.('[data-branch]');
    if (!tab || !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const i = BRANCHES.findIndex((b) => b.id === tab.dataset.branch);
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
    this.setBranch(BRANCHES[(i + step + BRANCHES.length) % BRANCHES.length].id);
  }

  onClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.close != null) return this.toggle(false);
    const sk = this.sk;
    if (b.dataset.branch) return this.setBranch(b.dataset.branch);
    if (b.dataset.sources != null) {
      this.showSources = !this.showSources;
      return this.render(true);
    }
    if (b.dataset.reset != null) {
      const n = sk.reset();
      if (n) {
        this.d.onChange?.();
        this.d.sound?.('undo');
        this.d.toast?.(`All ${plural(n, 'upgrade')} given back. Spend the points again however you like`, 3600);
      }
      return this.render(true);
    }
    if (b.dataset.skill) {
      this.selected = b.dataset.skill;
      this.d.sound?.('click');
      return this.render(true);
    }
    const id = b.dataset.act;
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
