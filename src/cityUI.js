// City panel: the town's title, progress to the next milestone, what it unlocks, and what residents
// are wishing for. Opened from the stats bubble. Reads state only; actions go through handlers.

import { MILESTONES, STRUCTURES, TOOLS } from './config.js';
import { trendsHTML, bindTrendHover } from './trendsUI.js';
import { budgetHTML, budgetKey } from './budgetUI.js';
import { notablesHTML, notablesKey } from './notablesUI.js';
import { townsfolkHTML, townsfolkKey } from './townsfolkUI.js';
import { eraHTML, eraKey, chronicleHTML } from './eraUI.js';
import { upgradesLineHTML, upgradesLineKey } from './skillsUI.js';

const SEVERITY_LABEL = { bad: 'Needs fixing', caution: 'Worth a look', good: 'Going well' };

const labelOf = (id) => STRUCTURES[id]?.label || TOOLS.find((t) => t.id === id)?.label || id;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';

export class CityPanel {
  constructor({ milestones, onShow, onOpen, onBuild, economy, onShowTile, notables, townsfolk, eras, growth, onRepair, skills, onUpgrades }) {
    this.skills = skills; // () → Skills
    this.onUpgrades = onUpgrades; // () → open the Town upgrades sheet
    this.onRepair = onRepair; // () → repair all storm damage now
    this.eras = eras; // () → Eras
    this.growth = growth; // () → Growth
    this.townsfolk = townsfolk; // () → Townsfolk
    this._tfOpen = false;
    this.notables = notables; // () → Notables
    this.economy = economy; // () → Economy
    this.onShowTile = onShowTile; // (x, y) → fly there
    this.onBuild = onBuild; // (thought) → build its suggested road
    this.milestones = milestones; // () => Milestones
    this.onShow = onShow; // (thought) → move the camera there
    this.onOpen = onOpen; // () → close other panels
    this.panel = document.getElementById('city-panel');
    this.btn = document.getElementById('stats');
    this.badge = document.getElementById('tier-badge');
    this.tierEl = document.getElementById('tier-name');
    this.meterEl = document.getElementById('tier-meter');
    this.open = false;
    this._trendSlot = null;
    this.city = null;
    bindTrendHover(this.panel, () => this.city?.systems.trends);
    this.focusedId = null; // the thought being looked at: its tiles pulse on the map
    this.focusUntil = 0; // with the panel closed, the highlight fades after this time (ms)
    this._key = '';
    this.btn.addEventListener('click', () => this.toggle());
    this.btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.toggle();
      }
    });
    // Opening the townsfolk list fills it in; it is only built while open.
    this.panel.addEventListener(
      'toggle',
      (e) => {
        if (!e.target.classList?.contains('tf-people') || e.target.open === this._tfOpen) return;
        this._tfOpen = e.target.open;
        this._tfKey = '';
      },
      true,
    );
    this.panel.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.close != null) this.toggle(false);
      else if (b.dataset.showtile) {
        const [x, y] = b.dataset.showtile.split(',').map(Number);
        this.onShowTile?.(x, y);
      } else if (b.dataset.upgrades != null) {
        this.onUpgrades?.();
      } else if (b.dataset.repair != null) {
        this.onRepair?.();
      } else if (b.dataset.build != null) {
        const th = this.thoughts[Number(b.dataset.build)];
        if (th?.plan) this.onBuild?.(th);
      } else if (b.dataset.show != null) {
        const th = this.thoughts[Number(b.dataset.show)];
        if (th) {
          this.focus(th.id);
          this.onShow(th);
        }
      }
    });
  }

  focus(id) {
    this.focusedId = id;
    this.focusUntil = performance.now() + 10000;
    this._key = '';
  }

  // Issues to tint on the map: all of them while the panel is open, else the one just shown, briefly.
  issues() {
    const list = this.thoughts || [];
    const focused = this.focusedId && list.find((t) => t.id === this.focusedId);
    if (this.open) return list.filter((t) => t.tiles?.length).map((t) => ({ ...t, focused: t === focused }));
    if (focused && performance.now() < this.focusUntil) return [{ ...focused, focused: true }];
    return [];
  }

  toggle(force) {
    this.open = force ?? !this.open;
    if (this.open) this.onOpen?.();
    this.btn.setAttribute('aria-expanded', String(this.open));
    this._key = '';
    this.panel.hidden = !this.open;
    document.documentElement.classList.toggle('city-open', this.open);
  }

  // Called a few times a second: refreshes the stats-bubble tier line and, when open, the panel.
  update(city) {
    this.city = city;
    const m = this.milestones();
    const p = m.progress();
    this.thoughts = city.derived.thoughts || [];
    const wishes = this.thoughts.filter((t) => t.kind === 'wish').length;
    this.tierEl.textContent = m.sandbox ? `Sandbox · ${p.current.label}` : p.current.label;
    this.meterEl.style.width = `${Math.round((p.next ? p.fraction : 1) * 100)}%`;
    this.badge.hidden = !wishes || this.open;
    this.badge.classList.toggle('caution', !this.thoughts.some((t) => t.severity === 'bad'));
    this.btn.setAttribute('aria-label', `${p.current.label}. ${wishes ? `${wishes} resident wish${wishes > 1 ? 'es' : ''}. ` : ''}Open city panel`);
    if (!this.open) return;
    // Rebuild only when the content changes shape, so buttons stay put under a finger.
    const key = JSON.stringify([p.tier, m.sandbox, this.focusedId, this.thoughts.map((t) => [t.id, t.x, t.y, t.text, t.severity])]);
    if (key !== this._key) {
      this._key = key;
      this.panel.innerHTML = this.html(city, m, p);
      this._trendSlot = null;
    }
    // The budget redraws only when its numbers change.
    const budgetBox = this.panel.querySelector('.budget');
    if (budgetBox && this.economy) {
      const eco = this.economy();
      const bkey = budgetKey(city.derived.economy, eco.state, eco.sandbox);
      if (bkey !== this._budgetKey || this._budgetBox !== budgetBox) {
        this._budgetKey = bkey;
        this._budgetBox = budgetBox;
        const open = !!budgetBox.querySelector('details')?.open;
        budgetBox.innerHTML = budgetHTML(city.derived.economy, eco.state, eco.sandbox);
        if (open) budgetBox.querySelector('details')?.setAttribute('open', '');
      }
    }
    const upBox = this.panel.querySelector('.upgrades-box');
    if (upBox && this.skills) {
      const ukey = upgradesLineKey(this.skills());
      if (ukey !== this._upKey || this._upBox !== upBox) {
        this._upKey = ukey;
        this._upBox = upBox;
        upBox.innerHTML = upgradesLineHTML(this.skills());
      }
    }
    const npBox = this.panel.querySelector('.notable-people');
    if (npBox && this.notables) {
      const n = this.notables();
      const nkey = notablesKey(n);
      if (nkey !== this._npKey || this._npBox !== npBox) {
        this._npKey = nkey;
        this._npBox = npBox;
        npBox.innerHTML = notablesHTML(city, n);
      }
    }
    const eraBox = this.panel.querySelector('.era-box');
    if (eraBox && this.eras) {
      const ekey = eraKey(this.eras(), this.growth?.(), city);
      if (ekey !== this._eraKey || this._eraBox !== eraBox) {
        this._eraKey = ekey;
        this._eraBox = eraBox;
        eraBox.innerHTML = eraHTML(this.eras(), this.growth?.());
        const hist = this.panel.querySelector('.chronicle');
        const open = !!hist?.querySelector('details')?.open;
        if (hist) hist.innerHTML = chronicleHTML(city);
        if (open) hist.querySelector('details')?.setAttribute('open', '');
      }
    }
    const tfBox = this.panel.querySelector('.townsfolk');
    if (tfBox && this.townsfolk) {
      const tf = this.townsfolk();
      const tkey = townsfolkKey(tf, this._tfOpen);
      if (tkey !== this._tfKey || this._tfBox !== tfBox) {
        this._tfKey = tkey;
        this._tfBox = tfBox;
        const list = tfBox.querySelector('.tf-people ul');
        const scroll = list ? list.scrollTop : 0;
        tfBox.innerHTML = townsfolkHTML(city, tf, { open: this._tfOpen });
        const again = tfBox.querySelector('.tf-people ul');
        if (again) again.scrollTop = scroll;
      }
    }
    // Charts redraw only when a new sample arrives, so a hover isn't interrupted.
    const tr = city.systems.trends;
    const box = this.panel.querySelector('.trends');
    if (box && tr?.slot !== this._trendSlot) {
      this._trendSlot = tr?.slot;
      const table = box.querySelector('.trend-table');
      const wasOpen = !!table?.open;
      box.innerHTML = trendsHTML(tr);
      if (wasOpen) box.querySelector('.trend-table').open = true;
    }
    const bar = this.panel.querySelector('.tier-progress span');
    if (bar) bar.style.width = `${Math.round(p.fraction * 100)}%`;
    const pop = this.panel.querySelector('.tier-pop');
    if (pop) pop.textContent = city.stats.population.toLocaleString();
  }

  html(city, m, p) {
    const pop = city.stats.population;
    const next = m.sandbox
      ? `<p class="tier-done">Sandbox: everything is unlocked. Your town's title still grows with it${p.next ? ` (next: ${p.next.label} at ${p.next.pop.toLocaleString()} residents)` : ''}.</p>`
      : p.next
      ? `<div class="tier-next"><div class="tier-progress"><span style="width:${Math.round(p.fraction * 100)}%"></span></div>` +
        `<p><b class="tier-pop">${pop.toLocaleString()}</b> of <b>${p.next.pop.toLocaleString()}</b> residents to become a <b>${p.next.label}</b>.</p>` +
        (p.next.unlocks.length ? `<p class="tier-unlocks">Unlocks ${p.next.unlocks.map((u) => `<span class="unlock-chip">${esc(labelOf(u))}</span>`).join('')}</p>` : '') +
        '</div>'
      : '<p class="tier-done">Your town has become a Metropolis. Everything is unlocked.</p>';
    const thoughts = this.thoughts.length
      ? `<ul class="thoughts">${this.thoughts
          .map(
            (t, i) =>
              `<li class="sev-${t.severity}${t.id === this.focusedId ? ' focused' : ''}"><span class="th-icon" aria-hidden="true">${t.kind === 'happy' ? '♥' : '!'}</span>` +
              `<span class="th-text"><span class="sev-label">${SEVERITY_LABEL[t.severity]}</span><span>${esc(t.text)}</span><small>${esc(t.hint)}</small></span>` +
              `<span class="th-actions">` +
              (t.x != null ? `<button type="button" class="ghost-btn small" data-show="${i}">Show me</button>` : '') +
              (t.plan ? `<button type="button" class="primary-btn small" data-build="${i}">Build it</button>` : '') +
              (t.repair ? '<button type="button" class="primary-btn small" data-repair>Repair all</button>' : '') +
              '</span>' +
              '</li>'
          )
          .join('')}</ul>`
      : '<p class="insp-note">Build some homes and residents will tell you what they think.</p>';
    const ladder = `<ol class="ladder">${MILESTONES.map(
      (ms, i) =>
        `<li class="${i <= m.reached ? 'done' : ''}${i === p.tier ? ' now' : ''}"><span class="dot"></span><span>${ms.label}</span><small>${ms.pop ? `${ms.pop.toLocaleString()}+` : 'Start'}</small></li>`
    ).join('')}</ol>`;
    return (
      `<header><div><span class="insp-kicker">Your town</span><h2>${p.current.label}</h2></div>` +
      `<button type="button" class="insp-close" data-close aria-label="Close city panel">${CLOSE}</button></header>` +
      (this.skills ? `<h3>Town upgrades</h3><div class="upgrades-box"></div>` : '') +
      `<h3>Era</h3><div class="era-box"></div>` +
      `<h3>Town history</h3><div class="chronicle"></div>` +
      `<h3>Budget</h3><div class="budget"></div>` +
      `<h3>Notable people</h3><div class="notable-people"></div>` +
      `<h3>Townsfolk</h3><div class="townsfolk"></div>` +
      next +
      ladder +
      `<h3>Trends</h3><div class="trends"></div>` +
      `<h3>What residents are saying</h3>` +
      (this.thoughts.length
        ? '<p class="sev-legend"><span class="sev-dot bad"></span>Needs fixing <span class="sev-dot caution"></span>Worth a look <span class="sev-dot good"></span>Going well<br><small>The areas are tinted on the map. Tap Show me to fly there.</small></p>'
        : '') +
      thoughts
    );
  }
}
