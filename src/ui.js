// Interface: toolbar, stats bubble, inspector, speed and view controls.
// Reads city state for display; changes only go through the callbacks main.js provides.

import { TOOL_GROUPS, TOOLS, VIEWS, STRUCTURES, SERVICES } from './config.js';
import { money } from './economy.js';
import { activityOf } from './townsfolk.js';
import { ERAS, yearOf } from './eras.js';
import { notableType } from './notables.js';
import { FACTORS } from './desirability.js';
import { formatClock } from './time.js';
import { workersIn } from './labor.js';
import { seasonFor, WEATHER_LABELS } from './weather.js';
import { typingTarget } from './input.js';

const svg = (body) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICONS = {
  inspect: svg('<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5.5 5.5"/><path d="M10.5 8v5M8 10.5h5"/>'),
  house: svg('<path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>'),
  tower: svg('<rect x="6.5" y="3" width="11" height="18" rx="1.5"/><path d="M10 7.5h.01M14 7.5h.01M10 11.5h.01M14 11.5h.01M10 15.5h.01M14 15.5h.01" stroke-width="2.6"/>'),
  shop: svg('<path d="M4 10v10h16V10"/><path d="M3 10h18l-1.5-5h-15z"/><path d="M7.5 10v0a2.25 2.25 0 0 0 4.5 0 2.25 2.25 0 0 0 4.5 0"/><path d="M10 20v-5h4v5"/>'),
  office: svg('<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M5 8h14M5 12.5h14M5 17h14"/>'),
  school: svg('<path d="M3 10 12 5l9 5-9 5z"/><path d="M7 12.2V17c2.8 2 7.2 2 10 0v-4.8"/><path d="M21 10v5"/>'),
  clinic: svg('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/>'),
  library: svg('<path d="M4 5.5c2.5-1 5.5-1 8 1 2.5-2 5.5-2 8-1V19c-2.5-1-5.5-1-8 1-2.5-2-5.5-2-8-1z"/><path d="M12 6.5V20"/>'),
  firestation: svg('<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 .3 2 1.2 3 2.5 3.5C12 9 11 6 12 3Z"/>'),
  university: svg('<path d="M3 9.5 12 4l9 5.5z"/><path d="M5 9.5V18M9.5 9.5V18M14.5 9.5V18M19 9.5V18"/><path d="M3 20.5h18"/>'),
  tree: svg('<circle cx="12" cy="9.5" r="6"/><path d="M12 15.5V21M9 21h6"/>'),
  park: svg('<path d="M4 13.5h16M5.5 13.5v5M18.5 13.5v5"/><path d="M4.5 9.5h15"/><path d="M7 9.5V6.5M17 9.5V6.5"/>'),
  road: svg('<path d="M8.5 3 5 21M15.5 3 19 21"/><path d="M12 4v2.5M12 10.5V13M12 17v3"/>'),
  water: svg('<path d="M12 3.5c3 4 5.5 7 5.5 10a5.5 5.5 0 0 1-11 0c0-3 2.5-6 5.5-10Z"/><path d="M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5"/>'),
  bulldoze: svg(
    '<rect x="2.5" y="10.5" width="10" height="5" rx="1.2"/><path d="M5 10.5V7h4.5l1.5 3.5"/><path d="M12.5 13h3.5"/><path d="M17 8.5c1.7 2.6 1.7 6.4 0 9h3.5"/><rect x="2.5" y="17" width="10" height="3.5" rx="1.75"/>'
  ),
  pause: svg('<path d="M9 5v14M15 5v14" stroke-width="2.6"/>'),
  play: svg('<path d="M7 4.5v15l12-7.5z"/>'),
  layers: svg('<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12.5 9 5 9-5"/><path d="m3 17 9 5 9-5"/>'),
  cottage: svg('<path d="M5 12 12 6l7 6"/><path d="M7 11v8h10v-8"/><path d="M11 19v-4h2v4"/><path d="M15.5 8V5.5h2V10"/>'),
  apartments: svg('<rect x="5" y="4" width="14" height="17" rx="1.5"/><path d="M8.5 8h2M13.5 8h2M8.5 12h2M13.5 12h2M8.5 16h2M13.5 16h2"/>'),
  bakery: svg('<path d="M4 15c0-4.5 3.6-8 8-8s8 3.5 8 8v2.5H4z"/><path d="M9 8.5 10 13M15 8.5 14 13M12 7v6"/>'),
  cafe: svg('<path d="M5 10h11v4a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3.5c0 1.5 1.5 1.5 1.5 3M12 3.5c0 1.5 1.5 1.5 1.5 3"/>'),
  mall: svg('<path d="M3 10h18v10H3z"/><path d="M5 10 7 5h10l2 5"/><path d="M10 20v-5h4v5"/><path d="M6 13h2M16 13h2"/>'),
  factory: svg('<path d="M3 20V11l5 3v-3l5 3v-3l5 3V4h3v16z"/><path d="M7 17h2M12 17h2"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  playground: svg('<path d="M4 20 7 6h3l3 14"/><path d="M5.5 13h6"/><path d="M14 8h6v12"/><path d="M14 8c0 5 2 8 6 9"/>'),
  field: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14"/><circle cx="12" cy="12" r="2.5"/><path d="M3 9.5h2.5v5H3M21 9.5h-2.5v5H21"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  soundOn: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  soundOff: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>'),
};

const MOUTHS = {
  happy: 'M8.5 14c1.9 2.2 5.1 2.2 7 0',
  okay: 'M9 15h6',
  sad: 'M8.5 16.5c1.9-2.2 5.1-2.2 7 0',
};

const LEGENDS = {
  desirability: ['Where people want to live', 'Low', 'High', 'ramp'],
  traffic: ['Commuters on each road', 'Clear', 'Jammed', 'ramp-rev'],
  services: ['School, clinic and fire cover (fainter when crowded)', 'None', 'Covered', 'service'],
};

const pct = (v) => `${Math.round(v * 100)}%`;

// Game speeds; the speed pill cycles through them, then pauses.
export const SPEEDS = [1, 3, 10];

export class Interface {
  constructor({ onTool, onRandom, onFit, onSpeed, onView, onCloseInspect, sound, locks, onShare, onBackHome, hasBackup, display, costOf, budget, growth, onSlots, extremeWeather }) {
    this.extremeWeather = extremeWeather; // { get(), set(level) }: off, gentle or wild
    this.growth = growth; // { get(), set(on) }: the town building itself
    this.onSlots = onSlots; // () → open the save slots sheet
    this.sound = sound;
    this.costOf = costOf || (() => 0); // tool → price in the current mode (0 in Sandbox)
    this.budget = budget; // () → { money, net, sandbox } for the stats bubble
    this.onShare = onShare;
    this.onBackHome = onBackHome;
    this.hasBackup = hasBackup || (() => false);
    this.display = display; // { get(key), set(key, value) } for minimap, colour-blind and large text
    this.locks = locks; // { isUnlocked(tool), unlockLabel(tool) }
    this.soundBtn = document.getElementById('btn-sound');
    this.toolbar = document.getElementById('toolbar');
    this.tray = document.getElementById('tray');
    this.popEl = document.getElementById('stat-pop');
    this.capEl = document.getElementById('stat-cap');
    this.happyEl = document.getElementById('stat-happy');
    this.moodEl = document.getElementById('mood-mouth');
    this.meterEl = document.getElementById('happy-meter');
    this.clockEl = document.getElementById('stat-clock');
    this.toastEl = document.getElementById('toast');
    this.inspectEl = document.getElementById('inspector');
    this.legendEl = document.getElementById('legend');
    this.speedBtn = document.getElementById('btn-speed');
    this.moreBtn = document.getElementById('btn-more');
    this.moreSheet = document.getElementById('more-sheet');
    this.onRandom = onRandom;
    this.onFit = onFit;
    this.viewBtn = document.getElementById('btn-view');
    this.onTool = onTool;
    this.onSpeed = onSpeed;
    this.onView = onView;
    this.tool = 'inspect';
    this.groupChoice = Object.fromEntries(TOOL_GROUPS.map((g) => [g.id, g.tools[0].id]));
    this.speed = 1;
    this.view = 'none';
    this._last = {};

    for (const g of TOOL_GROUPS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tool';
      b.id = `group-${g.id}`;
      b.dataset.group = g.id;
      b.setAttribute('aria-pressed', 'false');
      if (g.tools.length > 1) b.setAttribute('aria-haspopup', 'true');
      b.addEventListener('click', () => this.pressGroup(g.id));
      this.toolbar.appendChild(b);
    }
    document.getElementById('btn-random').addEventListener('click', onRandom);
    document.getElementById('btn-fit').addEventListener('click', onFit);
    // Cycles 1× → 3× → 10× → pause.
    this.speedBtn.addEventListener('click', () => this.setSpeed(this.speed === 0 ? this._resume || 1 : SPEEDS[SPEEDS.indexOf(this.speed) + 1] ?? 0));
    this.viewBtn.addEventListener('click', () => {
      const i = VIEWS.findIndex((v) => v.id === this.view);
      this.setView(VIEWS[(i + 1) % VIEWS.length].id);
    });
    this.inspectEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) onCloseInspect();
    });
    this.moreBtn.addEventListener('click', () => this.toggleMore());
    this.soundBtn.addEventListener('click', () => {
      this.sound.toggle();
      this.renderSound();
    });
    this.moreSheet.addEventListener('click', (e) => this.onMoreClick(e));
    document.addEventListener('pointerdown', (e) => {
      if (!this.tray.hidden && !e.target.closest('#tray') && !e.target.closest('.tool')) this.closeTray();
      if (!this.moreSheet.hidden && !e.target.closest('#more-sheet') && !e.target.closest('#btn-more')) this.toggleMore(false);
    });
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (typingTarget(e.target)) return; // typing a name: every key is text
      if (e.key === ' ') {
        e.preventDefault();
        this.speedBtn.click();
        return;
      }
      if (e.key === 'v') return this.viewBtn.click();
      if (e.key === 'm') return this.soundBtn.click();
      if (e.key === 'Escape') {
        this.toggleMore(false);
        return this.closeTray();
      }
      const t = TOOLS.find((tool) => tool.key === e.key.toLowerCase());
      if (t) this.setTool(t.id);
    });
    this.setTool(this.tool);
    this.renderSpeed();
    this.renderView();
    this.renderSound();
  }

  renderSound() {
    const muted = this.sound.muted();
    this.soundBtn.innerHTML = muted ? ICONS.soundOff : ICONS.soundOn;
    this.soundBtn.setAttribute('aria-label', muted ? 'Sound off. Turn sound on' : 'Sound on. Turn sound off');
    this.soundBtn.setAttribute('aria-pressed', String(!muted));
    this.renderMore();
  }

  groupOf(toolId) {
    return TOOL_GROUPS.find((g) => g.tools.some((t) => t.id === toolId));
  }

  locked(toolId) {
    return !!this.locks && !this.locks.isUnlocked(toolId);
  }

  pressGroup(groupId) {
    const g = TOOL_GROUPS.find((x) => x.id === groupId);
    if (g.tools.length > 1) {
      if (!this.tray.hidden && this.trayGroup === groupId) return this.closeTray();
      if (!this.locked(this.groupChoice[groupId])) this.setTool(this.groupChoice[groupId]);
      this.openTray(g);
      return;
    }
    this.closeTray();
    this.setTool(this.groupChoice[groupId]);
  }

  openTray(g) {
    this.trayGroup = g.id;
    this.tray.innerHTML = g.tools
      .map(
        (t) =>
          `<button type="button" class="tray-item${this.locked(t.id) ? ' locked' : ''}" data-tool="${t.id}" aria-pressed="${t.id === this.tool}"` +
          `${this.locked(t.id) ? ` aria-label="${t.label}, locked until ${this.locks.unlockLabel(t.id)}"` : ''}>` +
          `<span class="tool-icon tint-${t.id}">${ICONS[t.id]}</span><span>${t.label}</span>` +
          (this.costOf(t.id) ? `<small class="price">${money(this.costOf(t.id))}</small>` : `<kbd>${t.key.toUpperCase()}</kbd>`) +
          `${this.locked(t.id) ? `<span class="lock" aria-hidden="true">${ICONS.lock}</span>` : ''}</button>`
      )
      .join('');
    for (const b of this.tray.querySelectorAll('.tray-item')) {
      b.addEventListener('click', () => {
        if (!this.setTool(b.dataset.tool)) return;
        this.closeTray();
      });
    }
    const anchor = document.getElementById(`group-${g.id}`).getBoundingClientRect();
    this.toastEl.classList.remove('show');
    this.tray.hidden = false;
    const w = this.tray.offsetWidth;
    const left = Math.max(12, Math.min(window.innerWidth - w - 12, anchor.left + anchor.width / 2 - w / 2));
    this.tray.style.left = `${left}px`;
  }

  closeTray() {
    this.tray.hidden = true;
  }

  // Returns false (and explains why) when the tool is still locked.
  setTool(id) {
    if (this.locked(id)) {
      this.toast(`${TOOLS.find((t) => t.id === id).label} unlocks when your town becomes a ${this.locks.unlockLabel(id)}`);
      this.onLocked?.(id);
      return false;
    }
    this.tool = id;
    const group = this.groupOf(id);
    this.groupChoice[group.id] = id;
    for (const b of this.toolbar.querySelectorAll('.tool')) {
      const g = TOOL_GROUPS.find((x) => x.id === b.dataset.group);
      const choice = TOOLS.find((t) => t.id === this.groupChoice[g.id]);
      b.setAttribute('aria-pressed', String(g.id === group.id));
      const price = this.costOf(choice.id) ? ` · ${money(this.costOf(choice.id))}` : '';
      b.title = g.tools.length > 1 ? `${g.label}: ${choice.label} (${choice.key.toUpperCase()})${price}` : `${choice.label} (${choice.key.toUpperCase()})${price}`;
      b.innerHTML =
        `<span class="tool-icon tint-${choice.id}">${ICONS[choice.id]}</span>` +
        `<span class="tool-label">${g.tools.length > 1 ? choice.label : g.label}</span>` +
        (g.tools.length > 1 ? '<span class="more" aria-hidden="true"></span>' : '');
    }
    if (!this.tray.hidden) for (const b of this.tray.querySelectorAll('.tray-item')) b.setAttribute('aria-pressed', String(b.dataset.tool === id));
    this.renderLocks();
    this.onTool(id);
    return true;
  }

  // Lock badges on toolbar buttons whose shown tool still waits for a milestone.
  renderLocks() {
    for (const b of this.toolbar.querySelectorAll('.tool')) {
      const locked = this.locked(this.groupChoice[b.dataset.group]);
      b.classList.toggle('locked', locked);
      const lock = b.querySelector('.lock');
      if (locked && !lock) b.insertAdjacentHTML('beforeend', `<span class="lock" aria-hidden="true">${ICONS.lock}</span>`);
      else if (!locked && lock) lock.remove();
    }
  }

  // After a milestone: redraw badges and any open tray.
  refreshLocks() {
    this.renderLocks();
    if (!this.tray.hidden && this.trayGroup) this.openTray(TOOL_GROUPS.find((g) => g.id === this.trayGroup));
  }

  // ---- City controls sheet (phones and short screens) ------------------------

  toggleMore(force) {
    const open = force ?? this.moreSheet.hidden;
    this._confirmRandom = false;
    this.moreSheet.hidden = !open;
    this.moreBtn.setAttribute('aria-expanded', String(open));
    this.moreBtn.classList.toggle('is-on', open);
    if (open) {
      this.closeTray();
      this.onOpenMore?.();
      this.renderMore();
    }
  }

  renderMore() {
    if (this.moreSheet.hidden) return;
    const speeds = [[0, 'Pause'], ...SPEEDS.map((v) => [v, `${v}×`])];
    this.moreSheet.innerHTML =
      `<header><h2>Settings &amp; more</h2><button type="button" class="insp-close" data-more="close" aria-label="Close">${ICONS.close}</button></header>` +
      `<span class="sheet-label">Speed</span><div class="seg big">${speeds
        .map(([v, l]) => `<button type="button" data-speed="${v}" aria-pressed="${this.speed === v}">${l}</button>`)
        .join('')}</div>` +
      (this.growth
        ? `<span class="sheet-label">Town grows by itself</span><div class="seg big"><button type="button" data-growth="1" aria-pressed="${this.growth.get()}">On</button><button type="button" data-growth="0" aria-pressed="${!this.growth.get()}">Off</button></div>` +
          '<p class="sheet-hint">Homes, shops, streets and parks appear where your people need them. You can keep building too.</p>'
        : '') +
      (this.extremeWeather
        ? `<span class="sheet-label">Extreme weather</span><div class="seg big">${[
            ['off', 'Off'],
            ['gentle', 'Gentle'],
            ['wild', 'Wild'],
          ]
            .map(([v, l]) => `<button type="button" data-extreme="${v}" aria-pressed="${this.extremeWeather.get() === v}">${l}</button>`)
            .join('')}</div><p class="sheet-hint">Thunderstorms, heatwaves and blizzards, and now and then a flood, tornado or hurricane that can damage buildings and wash out roads.</p>`
        : '') +
      `<span class="sheet-label">Map view</span><div class="seg big views">${VIEWS.map(
        (v) => `<button type="button" data-view="${v.id}" aria-pressed="${this.view === v.id}">${v.label}</button>`
      ).join('')}</div>` +
      `<span class="sheet-label">Sound</span><div class="seg big"><button type="button" data-sound="on" aria-pressed="${!this.sound.muted()}">On</button><button type="button" data-sound="off" aria-pressed="${this.sound.muted()}">Off</button></div>` +
      (this.display
        ? [
            ['minimap', 'Minimap'],
            ['colorBlind', 'Colour-blind friendly colours'],
            ['largeText', 'Larger text'],
          ]
            .map(([k, label]) => {
              const on = !!this.display.get(k);
              return `<span class="sheet-label">${label}</span><div class="seg big"><button type="button" data-display="${k}" data-value="1" aria-pressed="${on}">On</button><button type="button" data-display="${k}" data-value="0" aria-pressed="${!on}">Off</button></div>`;
            })
            .join('') +
          `<span class="sheet-label">Scroll wheel / trackpad</span><div class="seg big">${[
            ['auto', 'Auto'],
            ['zoom', 'Always zoom'],
            ['pan', 'Always pan'],
          ]
            .map(([v, l]) => `<button type="button" data-scroll="${v}" aria-pressed="${(this.display.get('scroll') || 'auto') === v}">${l}</button>`)
            .join('')}</div><p class="sheet-hint">Auto: two-finger trackpad scrolling moves the map; pinching and mouse wheels zoom. Arrow keys or WASD move the map too.</p>`
        : '') +
      `<div class="sheet-actions"><button type="button" class="ghost-btn" data-more="share">Share town link</button>` +
      (this.hasBackup() ? '<button type="button" class="ghost-btn" data-more="home">Back to my town</button>' : '<span></span>') +
      '</div>' +
      `<div class="sheet-actions"><button type="button" class="ghost-btn" data-more="fit">Recenter</button>` +
      `<button type="button" class="ghost-btn" data-more="random">New town…</button></div>` +
      `<div class="sheet-actions"><button type="button" class="primary-btn" data-more="slots">Save slots…</button></div>`;
  }

  onMoreClick(e) {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.speed != null) this.setSpeed(Number(t.dataset.speed));
    else if (t.dataset.view) this.setView(t.dataset.view);
    else if (t.dataset.sound) {
      if ((t.dataset.sound === 'off') !== this.sound.muted()) this.sound.toggle();
      return this.renderSound();
    }
    else if (t.dataset.display) this.display.set(t.dataset.display, t.dataset.value === '1');
    else if (t.dataset.scroll) this.display.set('scroll', t.dataset.scroll);
    else if (t.dataset.growth) this.growth.set(t.dataset.growth === '1');
    else if (t.dataset.extreme) this.extremeWeather.set(t.dataset.extreme);
    else if (t.dataset.more === 'slots') {
      this.toggleMore(false);
      return this.onSlots?.();
    }
    else if (t.dataset.more === 'share') {
      this.onShare?.();
      return this.toggleMore(false);
    } else if (t.dataset.more === 'home') {
      this.onBackHome?.();
      return this.toggleMore(false);
    } else if (t.dataset.more === 'close') return this.toggleMore(false);
    else if (t.dataset.more === 'fit') {
      this.onFit();
      return this.toggleMore(false);
    } else if (t.dataset.more === 'random') {
      // The New town sheet is its own confirmation: nothing changes until Start building.
      this.toggleMore(false);
      return this.onRandom();
    }
    this.renderMore();
  }

  setSpeed(speed) {
    if (speed > 0) this._resume = speed;
    this.speed = speed;
    this.renderSpeed();
    this.onSpeed(speed);
  }

  renderSpeed() {
    const paused = this.speed === 0;
    this.speedBtn.innerHTML = `${paused ? ICONS.play : ICONS.pause}<span class="pill-text">${paused ? 'Paused' : `${this.speed}×`}</span>`;
    this.speedBtn.setAttribute('aria-label', paused ? 'Resume time' : `Speed ${this.speed}×, change speed`);
    this.speedBtn.classList.toggle('is-paused', paused);
    this.moreBtn?.classList.toggle('is-paused', paused);
  }

  setView(id) {
    this.view = id;
    this.renderView();
    this.onView(id);
  }

  renderView() {
    const v = VIEWS.find((x) => x.id === this.view);
    this.viewBtn.innerHTML = `${ICONS.layers}<span class="pill-text">${v.label}</span>`;
    this.viewBtn.setAttribute('aria-label', `Map view: ${v.label}. Switch view`);
    this.viewBtn.classList.toggle('is-on', this.view !== 'none');
    const legend = LEGENDS[this.view];
    this.legendEl.hidden = !legend;
    if (legend) {
      this.legendEl.innerHTML = `<span class="legend-title">${v.label}</span><span class="legend-sub">${legend[0]}</span><span class="legend-bar ${legend[3]}"></span><span class="legend-ends"><span>${legend[1]}</span><span>${legend[2]}</span></span>`;
    }
  }

  update(city) {
    const s = city.stats;
    const set = (key, el, value, prop = 'textContent') => {
      if (this._last[key] === value) return;
      this._last[key] = value;
      if (prop === 'd') el.setAttribute('d', value);
      else el[prop] = value;
    };
    set('pop', this.popEl, s.population.toLocaleString());
    set('cap', this.capEl, `/${s.capacity.toLocaleString()}`);
    set('happy', this.happyEl, s.homes ? `${s.happiness}%` : '–');
    set('mood', this.moodEl, MOUTHS[s.happiness >= 60 ? 'happy' : s.happiness >= 40 ? 'okay' : 'sad'], 'd');
    if (this._last.meterW !== s.happiness) {
      this._last.meterW = s.happiness;
      this.meterEl.style.width = `${s.homes ? s.happiness : 0}%`;
    }
    const work = s.jobs ? ` · ${pct(s.employment ?? 1)} employed` : '';
    const w = city.derived.weather;
    const sky = w && w.kind !== 'clear' ? ` · ${w.severe ? '⚠ ' : ''}${WEATHER_LABELS[w.kind]}` : '';
    if (this.budget) {
      const b = this.budget();
      set('money', document.getElementById('stat-money'), b.sandbox ? `${money(b.money)} · Sandbox` : money(b.money));
      const net = Math.round(b.net);
      const netEl = document.getElementById('stat-net');
      set('net', netEl, `${net >= 0 ? '▲' : '▼'} ${money(Math.abs(net))}/day`);
      netEl.classList.toggle('down', net < 0);
    }
    set('clock', this.clockEl, `${seasonFor(city.day).label} ${yearOf(city)} · ${ERAS[city.systems.era?.index ?? 0]?.label || ''} · ${formatClock(city.clock)}${sky}${work}`);
  }

  // Inspector: what is on a tile and why people do or don't want to live there.
  inspect(city, sel) {
    if (!sel) {
      this.inspectEl.hidden = true;
      this._inspectKey = null;
      return;
    }
    const t = city.getTile(sel.x, sel.y);
    if (!t) return;
    const s = t.structure;
    const def = s && STRUCTURES[s.type];
    let title = t.terrain === 'water' ? 'Water' : s ? def.label : 'Open land';
    const facts = [];
    if (def?.capacity) {
      facts.push(['Residents', `${s.residents} of ${def.capacity}`]);
      const workers = workersIn(t);
      if (workers) facts.push(['Working', `${Math.round(t.employment * workers)} of ${workers}`]);
    }
    if (def?.jobs) facts.push(['Jobs filled', `${t.workersFilled} of ${def.jobs}`]);
    if (def?.service) facts.push(['Covers', `${def.radius} tiles around it`]);
    const care = def?.serves && city.derived.serviceStats?.find((x) => x.tile === t);
    if (care) {
      facts.push(['Quality', `${pct(care.rating)}${care.rating < care.target - 0.02 ? ' (falling)' : care.rating > care.target + 0.02 ? ' (recovering)' : ''}`]);
      facts.push(['Looking after', `${Math.round(care.demand)} of ${care.serves} residents${care.load > 1 ? ': too many for one' : ''}`]);
    }
    for (const p of city.systems.notables?.people || []) {
      if (p.home && p.home.x === t.x && p.home.y === t.y) facts.push(['Home of', `${p.first} ${p.last}, ${notableType(p.type)?.title || ''}`]);
    }
    const folk = (city.systems.townsfolk?.people || []).filter((p) => p.home.x === t.x && p.home.y === t.y);
    if (folk.length) {
      const names = folk.slice(0, 3).map((p) => `${p.first} ${p.last} (${activityOf(p.doing).label.toLowerCase()})`);
      facts.push(['Townsfolk', names.join(', ') + (folk.length > 3 ? ` +${folk.length - 3}` : '')]);
    }
    const visitors = (city.systems.townsfolk?.people || []).filter((p) => p.at.x === t.x && p.at.y === t.y && !(p.home.x === t.x && p.home.y === t.y));
    if (visitors.length) facts.push(['Here now', visitors.slice(0, 3).map((p) => p.first).join(', ') + (visitors.length > 3 ? ` +${visitors.length - 3}` : '')]);
    if (s?.type === 'rubble') facts.push(['Condition', `Destroyed${s.was ? ` (was a ${(STRUCTURES[s.was]?.label || s.was).toLowerCase()})` : ''}. Crews will clear it, or bulldoze it`]);
    else if (s?.broken) facts.push(['Condition', 'Washed out: no traffic until it is repaired (or build a road over it)']);
    else if (s?.snowed) facts.push(['Condition', 'Snowed in until the blizzard passes']);
    else if ((s?.damage || 0) >= 0.15) facts.push(['Condition', `${s.damage >= 0.34 ? 'Badly damaged' : 'Damaged'} (${Math.round(s.damage * 100)}%)${s.damage >= 0.34 ? ': half its space is unusable' : ''}`]);
    if (t.earning) facts.push([t.earning > 0 ? 'Pays in taxes' : 'Upkeep', `${money(Math.abs(t.earning))}/day`]);
    if (s?.type === 'road') facts.push(['Traffic', t.congestion < 0.02 ? 'Clear' : `${pct(t.congestion)} busy`]);
    if (!city.accessRoad(t.x, t.y) && def && !def.walkable) facts.push(['Road access', 'None nearby']);
    const showFactors = t.terrain !== 'water' && s?.type !== 'road';
    const factors = showFactors
      ? FACTORS.filter((f) => f.enabled).map((f) => ({ label: f.label, v: t.factors[f.id] || 0 }))
      : [];
    const fire = t.coverage?.fire || 0;
    const coverage = SERVICES.map((sv) => `${sv.label.replace(/s$/, '')} ${pct(t.coverage?.[sv.id] || 0)}`)
      .concat(fire > 0 ? [`Fire station ${pct(fire)}`] : [])
      .join(' · ');
    const key = JSON.stringify([title, facts, factors.map((f) => f.v.toFixed(3)), t.desirability.toFixed(3), coverage]);
    if (key === this._inspectKey) return;
    this._inspectKey = key;
    this.inspectEl.hidden = false;
    this.inspectEl.innerHTML =
      `<header><div><span class="insp-kicker">${t.address || t.street || `Tile ${t.x}, ${t.y}`}</span><h2>${title}</h2></div>` +
      `<button type="button" class="insp-close" data-close aria-label="Close inspector">${ICONS.close}</button></header>` +
      (facts.length ? `<dl>${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>` : '') +
      (showFactors
        ? `<div class="insp-score"><span>Desirability</span><strong>${pct(t.desirability)}</strong></div>` +
          `<ul class="factors">${factors
            .map(
              (f) =>
                `<li><span>${f.label}</span><span class="fbar"><span class="${f.v < 0 ? 'neg' : 'pos'}" style="width:${Math.min(100, (Math.abs(f.v) / 0.35) * 100).toFixed(0)}%"></span></span><span class="fval">${f.v >= 0 ? '+' : '−'}${Math.round(Math.abs(f.v) * 100)}</span></li>`
            )
            .join('')}</ul><p class="insp-note">${coverage}</p>`
        : '');
  }

  toast(message, ms = 2600) {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }
}
