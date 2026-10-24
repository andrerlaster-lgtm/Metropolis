// The world on screen: the World button, the World sheet (a map of every town with who runs it, its
// people, money and era, and what the computer built lately) and the banner shown while you watch a
// town you don't run.

import { STRUCTURES, MILESTONES } from './config.js';
import { ERAS } from './eras.js';
import { money } from './economy.js';
import { STANCE_LABEL } from './diplomacy.js';

export const OWNER = {
  player: { label: 'You', long: 'Run by you', color: '#8a6cc4' },
  cpu: { label: 'Computer', long: 'Run by the computer', color: '#e9846f' },
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const TILE_COLORS = { water: '#7ec8e3', road: '#b9b3bd', green: '#a8d5a2', park: '#8fcf95', home: '#f2a191', work: '#9cc4ea', service: '#cdb4db', rubble: '#b9ae9f' };

function tileColor(t) {
  if (t.terrain === 'water') return TILE_COLORS.water;
  const s = t.structure;
  if (!s) return null;
  if (s.type === 'road') return TILE_COLORS.road;
  if (s.type === 'rubble') return TILE_COLORS.rubble;
  const def = STRUCTURES[s.type];
  if (def.walkable) return TILE_COLORS.park;
  if (def.capacity) return TILE_COLORS.home;
  if (def.service) return TILE_COLORS.service;
  return TILE_COLORS.work;
}

// What one entry of the computer's build log says, in words.
export function describeBuild(city, b) {
  const name = (STRUCTURES[b.type]?.label || b.type).toLowerCase();
  const what = b.type === 'road' ? `${b.n > 1 ? `${b.n} tiles of ` : ''}road` : b.rebuilt ? `rebuilt a home as ${name === 'apartments' ? 'apartments' : `a ${name}`}` : `${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name}`;
  const t = city.getTile(b.x, b.y);
  const where = t?.address || (t?.street ? `on ${t.street}` : '');
  return `${b.rebuilt ? what[0].toUpperCase() + what.slice(1) : `Built ${what}`}${where ? ` · ${where}` : ''}`;
}

export function townSummary(c) {
  const city = c.city;
  const s = city.stats || {};
  let buildings = 0;
  for (const t of city.tiles) if (t.structure && t.structure.type !== 'road' && t.structure.type !== 'tree') buildings++;
  return {
    name: c.entry.name,
    owner: OWNER[c.owner] || OWNER.cpu,
    population: s.population || 0,
    happiness: s.homes ? s.happiness : null,
    money: c.sim.economy.money,
    sandbox: c.sim.economy.sandbox,
    era: ERAS[city.systems.era?.index ?? 0]?.label || '',
    tier: MILESTONES[c.sim.milestones.reached]?.label || '',
    buildings,
    log: city.systems.cpu?.log || [],
  };
}

export class WorldPanel {
  // world: World; h: { onView(id), on3D(id), viewing() → town, toast }
  constructor(world, h) {
    this.world = world;
    this.h = h;
    this.el = document.getElementById('world-sheet');
    this.btn = document.getElementById('btn-world');
    this.banner = document.getElementById('watch-banner');
    this.open = false;
    this._key = '';
    this.btn.addEventListener('click', () => this.toggle());
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.close != null) return this.toggle(false);
      if (b.dataset.view) {
        this.toggle(false);
        this.h.onView(b.dataset.view);
      } else if (b.dataset.view3d) {
        this.toggle(false);
        this.h.on3D(b.dataset.view3d);
      } else if (b.dataset.diplo) {
        this.toggle(false);
        this.h.onDiplomacy?.(b.dataset.diplo);
      }
    });
    this.banner.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b?.dataset.home != null) this.h.onView('home');
      else if (b?.dataset.world != null) this.toggle(true);
    });
  }

  toggle(force = !this.open) {
    this.open = force;
    this.el.hidden = !force;
    this.btn.setAttribute('aria-expanded', String(force));
    if (force) {
      this.h.onOpen?.();
      this._key = '';
      this.render();
    }
  }

  // Called a few times a second.
  tick() {
    const viewing = this.h.viewing();
    this.btn.querySelector('.pill-text').textContent = viewing.entry.name;
    this.btn.style.setProperty('--owner', (OWNER[viewing.owner] || OWNER.cpu).color);
    this.renderBanner(viewing);
    if (this.open) this.render();
  }

  renderBanner(c) {
    const watching = c.owner !== 'player';
    this.banner.hidden = !watching;
    if (!watching) return;
    const s = townSummary(c);
    const last = s.log[0];
    const home = this.world.cities[0].entry.name;
    const key = `${c.id}|${s.population}|${Math.round(s.money)}|${last ? last.day + last.type + last.x + last.y : ''}|${s.tier}`;
    if (key === this._bannerKey) return;
    this._bannerKey = key;
    this.banner.innerHTML = `
      <span class="wb-owner" style="--owner:${s.owner.color}">${esc(s.owner.label)}</span>
      <span class="wb-text"><b>${esc(s.name)}</b> · ${esc(s.owner.long)}${s.tier ? ` · ${esc(s.tier)}` : ''}<br>
        <small>${s.population.toLocaleString()} people · ${money(s.money)}${last ? ` · ${esc(describeBuild(c.city, last))}` : ''}</small></span>
      <button type="button" class="pill" data-world>World</button>
      <button type="button" class="pill wb-home" data-home>Back to ${esc(home)}</button>`;
  }

  render() {
    const towns = this.world.cities.map((c) => ({ c, s: townSummary(c) }));
    const viewing = this.h.viewing();
    const stance = (c) => (c.owner !== 'player' && this.h.stance ? this.h.stance(c.id) : null);
    const key = towns.map(({ c, s }) => `${c.id}${s.population}${Math.round(s.money)}${s.buildings}${s.log[0]?.day}${s.log.length}${stance(c)}`).join('|') + viewing.id;
    if (key === this._key) return;
    this._key = key;
    const cards = towns
      .map(
        ({ c, s }) => `
      <article class="wt-card${c === viewing ? ' is-here' : ''}" style="--owner:${s.owner.color}">
        <header><span class="wt-owner">${esc(s.owner.label)}</span><h3>${esc(s.name)}</h3>${stance(c) ? `<span class="wt-stance wt-${stance(c)}">${esc(STANCE_LABEL[stance(c)])}</span>` : ''}${c === viewing ? '<span class="wt-here">On screen</span>' : ''}</header>
        <p class="wt-stats">${s.population.toLocaleString()} people · ${s.buildings} buildings · ${s.happiness == null ? 'no one yet' : `${s.happiness}% happy`}<br>${esc(s.era)}${s.tier ? ` · ${esc(s.tier)}` : ''} · ${s.sandbox ? 'Sandbox' : money(s.money)}</p>
        ${c.owner !== 'player' && s.log.length ? `<ul class="wt-log">${s.log.slice(0, 3).map((b) => `<li>${esc(describeBuild(c.city, b))} <small>(day ${b.day})</small></li>`).join('')}</ul>` : ''}
        <div class="wt-actions">
          <button type="button" class="pill" data-view="${esc(c.id)}"${c === viewing ? ' disabled' : ''}>${c.owner === 'player' ? 'Go home' : 'Watch'}</button>
          <button type="button" class="pill" data-view3d="${esc(c.id)}">See in 3D</button>
          ${c.owner !== 'player' && this.h.onDiplomacy ? `<button type="button" class="pill" data-diplo="${esc(c.id)}">Diplomacy</button>` : ''}
        </div>
      </article>`
      )
      .join('');
    this.el.innerHTML = `
      <header><h2>The world</h2><button type="button" class="insp-close" data-close aria-label="Close">${CLOSE}</button></header>
      <p class="wt-intro">Each town has its own people, money and buildings. The computer runs its towns by the same rules as yours: it pays for what it builds, and only what its era and milestones allow.</p>
      <canvas class="wt-map" width="560" height="220" aria-label="Map of the world"></canvas>
      <div class="wt-cards">${cards}</div>`;
    this.drawMap(this.el.querySelector('canvas'), viewing);
  }

  // A little top-down map: every town's tiles, its border in its owner's colour, and its name.
  drawMap(canvas, viewing) {
    const g = canvas.getContext('2d');
    const lay = this.world.cities.map((c) => ({ c, x: c.entry.at.x, y: c.entry.at.y, w: c.city.width, h: c.city.height }));
    const x0 = Math.min(...lay.map((l) => l.x)) - 4;
    const y0 = Math.min(...lay.map((l) => l.y)) - 4;
    const x1 = Math.max(...lay.map((l) => l.x + l.w)) + 4;
    const y1 = Math.max(...lay.map((l) => l.y + l.h)) + 4;
    const k = Math.min(canvas.width / (x1 - x0), canvas.height / (y1 - y0));
    const ox = (canvas.width - (x1 - x0) * k) / 2;
    const oy = (canvas.height - (y1 - y0) * k) / 2;
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#cfe6c4';
    g.fillRect(ox, oy, (x1 - x0) * k, (y1 - y0) * k);
    for (const l of lay) {
      const px = ox + (l.x - x0) * k;
      const py = oy + (l.y - y0) * k;
      g.fillStyle = TILE_COLORS.green;
      g.fillRect(px, py, l.w * k, l.h * k);
      for (const t of l.c.city.tiles) {
        const col = tileColor(t);
        if (!col) continue;
        g.fillStyle = col;
        g.fillRect(px + t.x * k, py + t.y * k, Math.ceil(k), Math.ceil(k));
      }
      const owner = OWNER[l.c.owner] || OWNER.cpu;
      g.strokeStyle = owner.color;
      g.lineWidth = l.c === viewing ? 4 : 2;
      g.strokeRect(px, py, l.w * k, l.h * k);
      g.font = '800 13px Nunito, system-ui, sans-serif';
      const label = `${l.c.entry.name} · ${owner.label}`;
      const tw = g.measureText(label).width + 12;
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.fillRect(px + 4, py + 4, tw, 20);
      g.fillStyle = owner.color;
      g.fillText(label, px + 10, py + 18);
    }
  }
}
