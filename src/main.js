// Wiring: creates each system, connects input to state, and runs the frame loop.

import { DEFAULT_MAP_SIZE, STRUCTURES, MILESTONES } from './config.js';
import { CityState } from './state.js';
import { Simulation } from './simulation.js';
import { Renderer } from './renderer.js';
import { Camera } from './camera.js';
import { InputController } from './input.js';
import { AutoSaver, readSlot, saveCity, activeSlot, setActiveSlot, deleteSlot, isLocked, firstEmptySlot, isVisiting, saveVisit, loadVisit, endVisit, rescueLegacyBackup } from './persistence.js';
import { SlotsSheet } from './slotsUI.js';
import { DecisionCard } from './decisionUI.js';
import { addChronicle } from './chronicle.js';
import { yearOf } from './eras.js';
import { encodeCity, decodeCity, shareUrl, codeFromHash } from './share.js';
import { Minimap } from './minimap.js';
import { settings, loadSettings, setSetting, onSettings } from './settings.js';
import { generateTown, generateLand, generateSeed } from './generator.js';
import { NewTownSheet } from './newTownUI.js';
import { Interface } from './ui.js';
import { LifeInterface } from './lifeUI.js';
import { summaryOf } from './life.js';
import { money } from './economy.js';
import { fullName } from './notables.js';
import { notableBadge } from './notablesUI.js';
import { addressOf } from './streets.js';
import { CityPanel } from './cityUI.js';
import { unlockTier } from './milestones.js';
import { computeCoverage } from './coverage.js';
import { recomputeDesirability } from './desirability.js';
import { worldToGrid, mapBounds, tileRectBounds, gridToWorld } from './iso.js';
import { History, lPath, tileLine } from './history.js';
import { Audio } from './audio.js';
import { daylightAt } from './time.js';

const MAX_STROKE = 160;

// What to tell the player about a save that couldn't be read. It is never written over by autosave.
function unreadableNote(n, newer) {
  return newer
    ? `Your town in save slot ${n} was saved by a newer version of Pocket Metropolis. Reload the page to update; the town is kept safe.`
    : `Your town in save slot ${n} couldn't be read, so it was set aside and kept safe.`;
}
const TOOL_SOUNDS = {
  house: 'pop',
  cottage: 'pop',
  apartments: 'popBig',
  cafe: 'pop',
  mall: 'popBig',
  factory: 'popBig',
  shop: 'pop',
  tower: 'popBig',
  office: 'popBig',
  school: 'popBig',
  clinic: 'popBig',
  bakery: 'pop',
  library: 'popBig',
  firestation: 'popBig',
  university: 'popBig',
  playground: 'pop',
  field: 'plant',
  tree: 'plant',
  park: 'plant',
  road: 'road',
};
const STROKE_LABELS = { road: 'road', water: 'water', bulldoze: 'bulldozing', tree: 'trees', park: 'parks', field: 'sports fields' };
const FEEDBACK_RADIUS = 7;

function start(hotData = {}) {
  loadSettings();
  const canvas = document.getElementById('city');
  let city = null;
  try {
    if (hotData.city) city = CityState.fromJSON(hotData.city);
  } catch {
    city = null;
  }
  const rescued = rescueLegacyBackup(); // a town backed up by an older version during a visit
  let visiting = !city && isVisiting();
  if (visiting) {
    city = loadVisit();
    if (!city) {
      endVisit();
      visiting = false;
    }
  }
  // A save that can't be read is left as it is (see persistence.js); the game starts in an empty slot.
  let startNote = null;
  if (!city) {
    const n = activeSlot();
    const r = readSlot(n);
    if (r.status === 'ok') city = r.city;
    else if (r.status === 'broken') {
      const free = firstEmptySlot();
      if (free) setActiveSlot(free);
      startNote = unreadableNote(n, r.newer) + (free ? ` This new town is in slot ${free}.` : ' Open Save slots to choose where this new town is saved.');
    }
  }
  const fresh = !city;
  if (!city) city = new CityState(DEFAULT_MAP_SIZE, DEFAULT_MAP_SIZE);

  const camera = new Camera();
  camera.smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const sim = new Simulation(city);
  const renderer = new Renderer(canvas, city, camera, sim.agents);
  const saver = new AutoSaver(city);
  const history = new History(city);
  const audio = new Audio();
  const minimap = new Minimap(document.getElementById('minimap'), city, camera);
  // Automatic minimap: on for roomy screens, off on phones, unless the player chose.
  const minimapOn = () => settings.minimap ?? (window.innerWidth >= 760 && window.innerHeight >= 560);

  let tool = 'house';
  let hover = null; // { x, y } tile under the mouse
  let selected = null; // { x, y } tile shown in the inspector
  let overlay = 'none';
  let fitted = false;
  let framing = 'town'; // what the recenter button framed last
  let stroke = null; // drag-to-build in progress: { start, last, tiles }
  let following = false; // the camera follows the main person
  let carryTimer = null; // the family story moves on to the next generation shortly after a death

  const tileAt = (sx, sy) => {
    const w = camera.screenToWorld(sx, sy);
    const g = worldToGrid(w.x, w.y);
    const x = Math.floor(g.gx);
    const y = Math.floor(g.gy);
    return city.inBounds(x, y) ? { x, y } : null;
  };

  const ui = new Interface({
    onTool: (id) => {
      tool = id;
      if (id !== 'inspect') selected = null;
    },
    onRandom: () => newTownSheet.toggle(true),
    // First press frames the town; pressing again shows the whole map.
    onFit: () => fitView(false, framing === 'town' ? 'map' : 'town'),
    onSpeed: (speed) => {
      sim.speed = speed;
    },
    onView: (id) => {
      overlay = id;
    },
    onCloseInspect: () => {
      selected = null;
    },
    locks: {
      isUnlocked: (id) => sim.milestones.isUnlocked(id),
      unlockLabel: (id) => MILESTONES[unlockTier(id)]?.label || '',
    },
    costOf: (tool) => sim.economy.costOf(tool),
    budget: () => ({ money: sim.economy.money, net: city.derived.economy?.net || 0, sandbox: sim.economy.sandbox }),
    onShare: () => shareTown(),
    onBackHome: () => backHome(),
    onSlots: () => slotsSheet.toggle(true),
    extremeWeather: {
      get: () => sim.disasters.level,
      set: (v) => {
        sim.disasters.level = v;
        ui.toast(v === 'off' ? 'Extreme weather is off for this town' : v === 'wild' ? 'Wild weather: storms and disasters come often' : 'Gentle weather: the odd storm, and a rare disaster', 3200);
      },
    },
    growth: {
      get: () => sim.growth.on,
      set: (on) => {
        sim.growth.on = on;
        ui.toast(on ? 'Your town will grow by itself. Keep building too, if you like' : 'Growth is off: only you build now', 3200);
      },
    },
    hasBackup: () => visiting,
    display: {
      get: (k) => (k === 'minimap' ? minimapOn() : settings[k]),
      set: (k, v) => setSetting(k, v),
    },
    sound: {
      muted: () => audio.muted,
      toggle: () => {
        audio.setMuted(!audio.muted);
        if (!audio.muted) {
          audio.ensure();
          audio.play('click');
        }
        return audio.muted;
      },
    },
  });

  // ---- Placement feedback ------------------------------------------------------
  // Edits run through here so nearby homes can show how much more (or less) appealing they became.
  const isHome = (t) => t?.structure && STRUCTURES[t.structure.type].capacity > 0;
  function withFeedback(coords, edit) {
    if (!coords.length) return edit();
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const c of coords) {
      x0 = Math.min(x0, c.x);
      y0 = Math.min(y0, c.y);
      x1 = Math.max(x1, c.x);
      y1 = Math.max(y1, c.y);
    }
    const before = new Map();
    for (let y = y0 - FEEDBACK_RADIUS; y <= y1 + FEEDBACK_RADIUS; y++) {
      for (let x = x0 - FEEDBACK_RADIUS; x <= x1 + FEEDBACK_RADIUS; x++) {
        const t = city.getTile(x, y);
        if (isHome(t)) before.set(t, { id: t.structure.id, d: t.desirability });
      }
    }
    const changed = edit();
    if (!changed) return changed;
    computeCoverage(city);
    recomputeDesirability(city);
    city.dirty = true; // let the simulation refresh jobs and traffic on its next tick
    const ups = [];
    const downs = [];
    for (const [t, b] of before) {
      if (!isHome(t) || t.structure.id !== b.id) continue;
      const delta = Math.round((t.desirability - b.d) * 100);
      if (delta >= 1) ups.push({ t, delta });
      else if (delta <= -1) downs.push({ t, delta });
    }
    ups.sort((a, b) => b.delta - a.delta);
    downs.sort((a, b) => a.delta - b.delta);
    [...ups.slice(0, 6), ...downs.slice(0, 4)].forEach(({ t, delta }, i) =>
      renderer.floatText(t.x, t.y, `${delta > 0 ? '+' : '−'}${Math.abs(delta)}%`, delta > 0 ? '#3f9a68' : '#d0605a', 0.25 + i * 0.06)
    );
    // A brand-new home shows how appealing its lot is.
    const placed = coords.map((c) => city.getTile(c.x, c.y)).filter((t) => isHome(t) && !before.has(t));
    placed.slice(0, 4).forEach((t, i) => renderer.floatText(t.x, t.y, `${Math.round(t.desirability * 100)}% appeal`, '#7a5fa8', 0.35 + i * 0.08, 40));
    return changed;
  }
  const build = (label, coords, edit) => history.record(label, coords, () => withFeedback(coords, edit));

  // Placing things costs money (Sandbox is free). A drag places as many as the budget allows.
  history.onMoney = (delta) => (delta > 0 ? sim.economy.refund(delta) : sim.economy.spend(-delta));
  function buyAndBuild(tool, coords, label) {
    const each = sim.economy.costOf(tool);
    let list = coords;
    if (each) {
      const n = sim.economy.affordable(tool, coords.length);
      const name = STRUCTURES[tool]?.label || (tool === 'water' ? 'Water' : tool);
      if (!n) {
        ui.toast(`Not enough money: ${name.toLowerCase()} costs ${money(each)} and the town has ${money(sim.economy.money)}`, 3200);
        return false;
      }
      if (n < coords.length) {
        list = coords.slice(0, n);
        ui.toast(`The money ran out after ${n} of ${coords.length}`, 2800);
      }
    }
    const cost = each * list.length;
    const ok = history.record(label(list.length), list, () => withFeedback(list, () => (list.length === 1 ? city.apply(tool, list[0].x, list[0].y) : city.applyMany(tool, list))), { cost });
    if (ok && cost) {
      sim.economy.spend(cost);
      const end = list[list.length - 1];
      renderer.floatText(end.x, end.y, `−${money(cost)}`, '#c0605a', 0.1, 46);
    }
    return ok;
  }

  // ---- Milestones -------------------------------------------------------------
  const cityPanel = new CityPanel({
    milestones: () => sim.milestones,
    economy: () => sim.economy,
    notables: () => sim.notables,
    townsfolk: () => sim.townsfolk,
    eras: () => sim.eras,
    growth: () => sim.growth,
    onShowTile: (x, y) => {
      focusTile(x, y);
      if (window.innerWidth < 560) cityPanel.toggle(false);
    },
    onRepair: () => repairAll(),
    onOpen: () => {
      lifeUI.toggle(false);
      ui.toggleMore(false);
      ui.closeTray();
    },
    onShow: (th) => {
      focusTile(th.x, th.y);
      if (window.innerWidth < 560) cityPanel.toggle(false);
    },
    // Build a suggested road in one go (one undo step), skipping anything built there since.
    onBuild: (th) => {
      const coords = th.plan.filter((c) => city.canApply('road', c.x, c.y) && city.getTile(c.x, c.y).terrain === 'grass' && (!city.getTile(c.x, c.y).structure || city.getTile(c.x, c.y).structure.type === 'tree'));
      if (!coords.length) return ui.toast('That spot has changed. A new suggestion will come along shortly', 3000);
      if (!buyAndBuild('road', coords, (n) => `${n} road${n > 1 ? 's' : ''}`)) return;
      cityPanel.focus(null);
      sim.refresh();
      ui.toast('New road built. Drivers will start using it right away', 3200);
    },
  });
  function focusTile(x, y) {
    const w = gridToWorld(x + 0.5, y + 0.5);
    camera.tx = w.x;
    camera.ty = w.y - 20;
    camera.tzoom = Math.max(camera.tzoom, 1.2);
    camera.clampTarget();
    renderer.ring(x, y, '#ffffff');
    // On phones the inspector would cover the highlighted area, so only open it on wider screens.
    if (window.innerWidth >= 560) {
      selected = { x, y };
      ui.inspect(city, selected);
    }
  }
  ui.onOpenMore = () => {
    cityPanel.toggle(false);
    lifeUI.toggle(false);
  };
  // A notable person arrived: a card with who they are, where they live and what they bring.
  function welcomeNotable({ person, notable: type, address }) {
    audio.play('fanfare');
    renderer.confetti();
    const card = cardEl();
    card.classList.add('notable-card');
    card.innerHTML =
      `${notableBadge(type, 44)}<span class="insp-kicker">${person.born ? 'Born in your town' : 'Moved to your town'}</span>` +
      `<h2>${fullName(person)}</h2><p><b>${type.title}</b>${address ? ` · ${address}` : ''}</p>` +
      `<p class="np-bonus">Bonus: ${type.bonus}</p>` +
      (person.home ? `<button type="button" class="primary-btn small" data-notable-show="${person.home.x},${person.home.y}">Show me</button>` : '');
    showCard(card, 7000);
    ui.toast(`${type.title} ${fullName(person)} ${person.born ? 'was born' : 'moved in'}${address ? ` at ${address}` : ''}`, 5000);
  }
  function cardEl() {
    let card = document.getElementById('milestone-card');
    if (!card) {
      card = document.createElement('section');
      card.id = 'milestone-card';
      card.className = 'milestone-card glass';
      card.setAttribute('role', 'status');
      document.getElementById('app').appendChild(card);
      card.addEventListener('click', (e) => {
        const b = e.target.closest('[data-notable-show]');
        if (b) {
          const [x, y] = b.dataset.notableShow.split(',').map(Number);
          focusTile(x, y);
        }
        if (e.target.closest('[data-repair-all]')) repairAll();
        card.hidden = true;
      });
    }
    card.classList.remove('notable-card');
    return card;
  }
  function showCard(card, ms) {
    card.hidden = false;
    clearTimeout(milestoneTimer);
    milestoneTimer = setTimeout(() => (card.hidden = true), ms);
  }
  let milestoneTimer = null;
  function celebrate(m) {
    audio.play('fanfare');
    renderer.confetti();
    ui.refreshLocks();
    const card = cardEl();
    const names = sim.milestones.sandbox ? [] : m.unlocks.map((u) => STRUCTURES[u]?.label || u);
    card.innerHTML =
      `<span class="insp-kicker">New milestone</span><h2>You're a ${m.label}!</h2>` +
      `<p>${m.pop.toLocaleString()} people now call your town home.</p>` +
      (names.length ? `<p class="tier-unlocks">Unlocked ${names.map((n) => `<span class="unlock-chip">${n}</span>`).join('')}</p>` : '');
    showCard(card, 5200);
  }

  // ---- Undo and redo --------------------------------------------------------
  const undoBtn = document.getElementById('btn-undo');
  const redoBtn = document.getElementById('btn-redo');
  const syncHistoryButtons = () => {
    undoBtn.hidden = !history.canUndo && !history.canRedo;
    redoBtn.hidden = !history.canRedo;
    undoBtn.disabled = !history.canUndo;
  };
  history.on(syncHistoryButtons);
  syncHistoryButtons();
  const doUndo = () => {
    const label = history.undo();
    if (label) ui.toast(`Undid ${label}`, 1600);
  };
  const doRedo = () => {
    const label = history.redo();
    if (label) ui.toast(`Redid ${label}`, 1600);
  };
  undoBtn.addEventListener('click', doUndo);
  redoBtn.addEventListener('click', doRedo);
  window.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.target.closest?.('input')) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) doUndo();
    else if ((k === 'z' && e.shiftKey) || k === 'y') doRedo();
    else return;
    e.preventDefault();
  });

  const labelFor = (t, n = 1) => {
    if (t === 'bulldoze') return n > 1 ? `bulldozing ${n} tiles` : 'bulldozing';
    const name = STROKE_LABELS[t] || STRUCTURES[t]?.label.toLowerCase() || t;
    return n > 1 ? `${n} ${name}${name.endsWith('s') || name === 'water' || name === 'road' ? '' : 's'}` : name;
  };
  renderer.onGrow = () => audio.play('grow', { gap: 0.25 });
  const nope = (x, y) => {
    renderer.nudge(x, y);
    audio.play('nope');
  };

  function uiInsets() {
    const narrow = window.innerWidth < 560;
    return { top: narrow ? 96 : 76, bottom: narrow ? 92 : 100, left: narrow ? 4 : 16, right: narrow ? 4 : 16 };
  }

  // The part of the map that is built up: homes, workplaces and services.
  function townBounds() {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const t of city.tiles) {
      const s = t.structure;
      if (!s || s.type === 'tree' || s.type === 'road') continue;
      x0 = Math.min(x0, t.x);
      y0 = Math.min(y0, t.y);
      x1 = Math.max(x1, t.x);
      y1 = Math.max(y1, t.y);
    }
    if (x0 === Infinity) return null;
    // Portrait phones are narrow; frame the town's core so buildings read at a comfortable size.
    if (window.innerWidth < 560) {
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const r = Math.max(3, Math.min(x1 - x0, y1 - y0) * 0.3);
      x0 = Math.round(cx - r);
      x1 = Math.round(cx + r);
      y0 = Math.round(cy - r);
      y1 = Math.round(cy + r);
    }
    const pad = 1;
    return tileRectBounds(Math.max(0, x0 - pad), Math.max(0, y0 - pad), Math.min(city.width - 1, x1 + pad), Math.min(city.height - 1, y1 + pad));
  }

  function fitView(immediate, target = 'town') {
    camera.setBounds(mapBounds(city.width, city.height));
    const rect = target === 'town' ? townBounds() : null;
    camera.fit(uiInsets(), immediate, rect || camera.bounds);
    framing = rect ? 'town' : 'map';
  }

  // ---- New town ----------------------------------------------------------------
  const newTownSheet = new NewTownSheet({
    onOpen: () => {
      document.getElementById('milestone-card')?.setAttribute('hidden', '');
      ui.toggleMore(false);
      cityPanel.toggle(false);
      lifeUI.toggle(false);
      ui.closeTray();
    },
    onStart: (opts) => newTown(opts),
    where: () => {
      if (!visiting && !isLocked(activeSlot())) return null;
      const free = firstEmptySlot();
      return free ? `Starts in empty save slot ${free}. Your other towns stay as they are.` : 'Your save slots are full: Start will ask you to pick one.';
    },
    family: () => {
      const c = sim.life.char;
      return c ? `${c.first}` : null;
    },
  });

  // ---- Save slots ----------------------------------------------------------------
  const hideCard = () => {
    const card = document.getElementById('milestone-card');
    if (card) card.hidden = true;
  };
  const slotsSheet = new SlotsSheet({
    onOpen: () => {
      hideCard();
      ui.toggleMore(false);
      cityPanel.toggle(false);
      lifeUI.toggle(false);
      ui.closeTray();
    },
    beforeOpen: () => saver.flush(),
    onPlay: (n) => {
      saver.flush();
      const r = readSlot(n);
      if (r.status !== 'ok') return ui.toast(r.status === 'broken' ? unreadableNote(n, r.newer) : 'That save slot is empty', 6000);
      const left = visiting;
      if (visiting) leaveVisit();
      setActiveSlot(n);
      swapCity(r.city);
      ui.refreshLocks();
      lifeUI.render();
      stopFollow();
      ui.toast(`Save slot ${n}: welcome back${left ? '. You left the shared town' : ''}`, 2400);
    },
    onHome: () => backHome(),
    onNew: (n) => newTownSheet.toggle(true, { slot: n }),
    // Saving a copy over a slot is the player's choice, so it may replace an unreadable save.
    onCopy: (n) => {
      if (saveCity(city, n, { force: true })) ui.toast(`This town was saved to slot ${n}. You're still playing ${visiting ? 'the shared town' : `slot ${activeSlot()}`}`, 3600);
      else ui.toast('There was no room to save. Delete a slot and try again', 3600);
    },
    onDelete: (n) => {
      deleteSlot(n);
      ui.toast(`Save slot ${n} is empty now`, 2400);
      const back = rescueLegacyBackup();
      if (back?.slot) ui.toast(`Your town from before a shared visit is back, in slot ${back.slot}`, 4200);
    },
  });

  // Build a fresh town of the chosen size and mode. The Life Story and achievements carry over;
  // a character whose home is gone moves into whatever the new town offers (or waits for one).
  // A town can start in another save slot (the current one is saved first) with a new main person.
  function newTown({ mode, size, start, grow = start === 'seed', person = 'new', slot = null }) {
    saver.flush();
    // With no slot chosen the new town replaces the one you're playing. A shared town you're visiting
    // isn't in a slot, and an unreadable slot is kept safe, so those start in an empty slot instead.
    const chosen = slot;
    if (!slot) slot = visiting || isLocked(activeSlot()) ? firstEmptySlot() : activeSlot();
    if (!slot) {
      ui.toast('Your save slots are full. Pick a slot for the new town, or delete one first', 4200);
      slotsSheet.toggle(true);
      return;
    }
    const previousSlot = activeSlot();
    if (visiting) leaveVisit();
    if (slot !== previousSlot) setActiveSlot(slot);
    const fresh = new CityState(size, size);
    if (start === 'town') generateTown(fresh);
    else if (start === 'seed') generateSeed(fresh);
    else generateLand(fresh);
    fresh.systems.mode = mode;
    const keep = person === 'keep' && city.systems.life;
    if (keep) fresh.systems.life = city.systems.life;
    else if (city.systems.life?.achievements) fresh.systems.life = { char: null, history: [], achievements: city.systems.life.achievements };
    swapCity(fresh);
    sim.economy.reset(start === 'town' ? 'town' : 'land');
    sim.economy.assess();
    if (start === 'town') sim.milestones.settleForCapacity();
    else sim.eras.found(); // a seed or open land starts in 1850
    sim.growth.on = grow;
    ui.refreshLocks();
    if (sim.life.char?.alive) sim.life.syncWithCity();
    stopFollow();
    lifeUI.render();
    saveCity(city, slot, { force: !!chosen }); // a slot picked in Save slots may hold an unreadable save
    audio.play('fanfare');
    const where = start === 'town' ? 'A fresh town' : start === 'seed' ? `A little crossroads, ${yearOf(city)}` : 'Open land';
    ui.toast(`${where}${chosen || slot !== previousSlot ? ` in save slot ${slot}` : ''}${grow ? '. It will grow by itself' : ''}`, 4200);
    if (!keep) askForMainPerson();
  }

  // A new town starts by choosing whose family to follow.
  function askForMainPerson() {
    setTimeout(() => {
      if (sim.life.char) return;
      lifeUI.toggle(true);
      ui.toast('Create your main person. You will follow them, then their children and grandchildren', 5200);
    }, 900);
  }

  // ---- Sharing -----------------------------------------------------------------
  async function shareTown() {
    try {
      const url = shareUrl(await encodeCity(city));
      const touch = window.matchMedia?.('(pointer: coarse)').matches;
      if (touch && navigator.share) {
        await navigator.share({ title: 'My Pocket Metropolis town', text: 'Come and see my little town!', url });
        return;
      }
      await navigator.clipboard.writeText(url);
      ui.toast('Link copied. Anyone who opens it gets a copy of your town to play with', 4200);
    } catch (err) {
      if (err?.name === 'AbortError') return; // closed the share sheet
      window.prompt('Copy this link to share your town:', shareUrl(await encodeCity(city)));
    }
  }

  // Swap in another town (shared or your own back), keeping every system attached to this city.
  function swapCity(other) {
    city.copyFrom(other);
    history.clear();
    sim.refresh();
    selected = null;
    city.emit('loaded');
    fitView(false);
  }

  async function visitShared(code) {
    let other;
    try {
      other = await decodeCity(code);
    } catch {
      ui.toast('That town link is broken or incomplete', 3600);
      return;
    }
    // Your own town stays in its save slot; the visit is saved under its own key. If there's no room
    // for that, don't visit at all, so nothing can end up saved over your town.
    saver.flush();
    if (!saveVisit(other)) {
      ui.toast("There's no room to open a shared town. Delete a save slot and try the link again", 5000);
      return;
    }
    visiting = true;
    swapCity(other);
    sim.economy.reset('town');
    sim.milestones.settleForCapacity();
    ui.refreshLocks();
    saveVisit(city);
    ui.toast(`Visiting a shared town. Your own town is safe in save slot ${activeSlot()}: ☰ → Back to my town`, 6000);
  }

  function leaveVisit() {
    endVisit();
    visiting = false;
  }

  // Your own town was never touched during the visit, so going back just loads it from its slot.
  function backHome() {
    if (!visiting) return;
    const n = activeSlot();
    const r = readSlot(n);
    if (r.status === 'broken') return ui.toast(unreadableNote(n, r.newer), 6000);
    leaveVisit();
    if (r.status === 'ok') {
      swapCity(r.city);
      ui.toast('Welcome back to your town', 2400);
    } else {
      // The slot was emptied while visiting: start afresh there rather than keep the shared town.
      newTown({ mode: 'milestones', size: 32, start: 'seed', slot: n });
      return;
    }
    ui.refreshLocks();
    lifeUI.render();
    stopFollow();
  }

  const sharedCode = codeFromHash(window.location.hash);
  if (sharedCode) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search); // a reload won't re-import
    queueMicrotask(() => visitShared(sharedCode));
  }
  window.addEventListener('hashchange', () => {
    const code = codeFromHash(window.location.hash);
    if (!code) return;
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    visitShared(code);
  });

  onSettings(() => {
    minimap.setVisible(minimapOn());
    renderer.textScale = settings.largeText ? 1.2 : 1;
    ui.renderMore();
  });

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.resize(w, h);
    camera.setViewport(w, h);
    camera.setBounds(mapBounds(city.width, city.height));
    if (!fitted) {
      fitView(true);
      fitted = true;
    }
  }
  window.addEventListener('resize', () => {
    resize();
    minimap.setVisible(minimapOn());
  });
  resize();
  minimap.setVisible(minimapOn());
  renderer.textScale = settings.largeText ? 1.2 : 1;

  const lifeUI = new LifeInterface({
    life: sim.life,
    onCreate: (draft) => {
      const c = sim.life.create(draft);
      const home = c.home && city.getTile(c.home.x, c.home.y);
      addChronicle(city, `${draft.first} ${draft.last} was born${home ? ` at ${addressOf(home)}` : ''}. The family story begins.`, c.home, 'family');
      ui.toast(`${draft.first} was born. Tap Follow to watch their life on the map.`, 3600);
    },
    onAgeUp: () => sim.life.ageUp(),
    onChoose: (i) => {
      const before = homeKey();
      const result = sim.life.choose(i);
      if (homeKey() !== before) showNewHome();
      if (result) {
        const score = result.changes.reduce((n, c) => n + Math.sign(c.delta), 0);
        audio.play(score >= 0 ? 'good' : 'bad');
      }
      return result;
    },
    onActivity: (id) => {
      const result = sim.life.doActivity(id);
      if (result?.text) {
        const score = result.changes.reduce((n, c) => n + Math.sign(c.delta), 0);
        audio.play(score >= 0 ? 'good' : 'bad');
      } else if (result?.launched) audio.play('chime');
      else audio.play('nope');
      return result;
    },
    onContinue: () => carryOn(),
    onFollow: () => (following ? stopFollow() : startFollow()),
    isFollowing: () => following,
    onNewLife: () => {
      const s = city.systems.life;
      if (s?.char) s.history = [...(s.history || []), summaryOf(s.char)];
      city.systems.life = s ? { char: null, history: s.history, achievements: s.achievements || {} } : null;
    },
    onOpen: () => {
      cityPanel.toggle(false);
      ui.toggleMore(false);
    },
    onFocus: () => {
      const home = sim.life.char?.home;
      if (!home) return;
      const w = gridToWorld(home.x + 0.5, home.y + 0.5);
      camera.tx = w.x;
      camera.ty = w.y - 20;
      camera.tzoom = Math.max(camera.tzoom, 1.1);
      camera.clampTarget();
      renderer.ring(home.x, home.y, '#ffffff');
    },
  });
  // ---- Following the main person ---------------------------------------------------
  // The camera stays with them: on the street when they're out, at home or work otherwise.
  // Moving the map by hand stops following.
  const followBtn = document.getElementById('btn-follow');
  const followChip = document.createElement('button');
  followChip.type = 'button';
  followChip.className = 'pill glass follow-chip';
  followChip.hidden = true;
  document.getElementById('app').appendChild(followChip);
  followChip.addEventListener('click', () => stopFollow());
  followBtn.addEventListener('click', () => (following ? stopFollow() : startFollow()));
  function startFollow() {
    const c = sim.life.char;
    if (!c?.alive) return ui.toast('Create your main person in Life first', 2600);
    following = true;
    camera.tzoom = Math.max(camera.tzoom, 1.6);
    syncFollowUI();
    lifeUI.render();
  }
  function stopFollow() {
    if (!following) return;
    following = false;
    syncFollowUI();
    lifeUI.render();
  }
  function syncFollowUI() {
    const c = sim.life.char;
    followBtn.hidden = !c?.alive;
    followBtn.setAttribute('aria-pressed', String(following));
    followBtn.classList.toggle('is-on', following);
    followChip.hidden = !following;
    if (following && c) followChip.innerHTML = `<span aria-hidden="true">●</span> Following ${c.first} · Stop`;
  }
  const panBy = camera.panBy.bind(camera);
  camera.panBy = (dx, dy) => {
    if (following && (dx || dy)) stopFollow();
    panBy(dx, dy);
  };
  function followTarget() {
    const c = sim.life.char;
    if (!c?.alive) return null;
    const h = sim.agents.hero;
    if (h && !h.dead && h.alpha > 0.3) return { gx: h.gx, gy: h.gy };
    const at = c.home;
    return at ? { gx: at.x + 0.5, gy: at.y + 0.5 } : null;
  }

  // ---- Generations -------------------------------------------------------------------
  // When the main person dies, the story moves on to their child (or a niece or nephew) by itself.
  function carryOn() {
    clearTimeout(carryTimer);
    carryTimer = null;
    const parent = sim.life.char;
    if (!parent || parent.alive) return null;
    const heir = sim.life.heir();
    const wasFollowing = following;
    const next = sim.life.continueAsChild();
    if (!next) return null;
    const rel = heir?.relation || 'child';
    addChronicle(city, `${parent.first} ${parent.last} passed away at ${parent.death?.age}. ${next.first}, their ${rel}, carries on the family story.`, next.home, 'family');
    ui.toast(`${next.first}, ${parent.first}'s ${rel}, carries on the family story`, 4600);
    audio.play('chime');
    if (wasFollowing) startFollow();
    lifeUI.render();
    return next;
  }
  function scheduleCarryOn() {
    if (carryTimer || !sim.life.char || sim.life.char.alive) return;
    carryTimer = setTimeout(carryOn, 9000);
  }

  // ---- Eras ----------------------------------------------------------------------------
  function newEra({ era, year }) {
    audio.play('fanfare');
    renderer.confetti();
    const card = cardEl();
    card.innerHTML = `<span class="insp-kicker">A new era · ${year}</span><h2>${era.label}</h2><p>${era.blurb}</p>`;
    showCard(card, 6500);
    addChronicle(city, `The town entered the ${era.label.toLowerCase()}. ${era.blurb}`, null, 'era');
  }

  // ---- Town decisions ------------------------------------------------------------------
  const decisionCard = new DecisionCard({
    decisions: () => sim.decisions,
    onChoose: (i) => {
      const r = sim.decisions.choose(i);
      decisionCard.hide();
      if (!r) return;
      const good = (r.choice.spirit?.[0] ?? 0) >= 0 && (r.choice.growth?.[0] ?? 1) >= 1;
      audio.play(good ? 'good' : 'bad');
      ui.toast(r.choice.result, 3600);
    },
    onOpen: () => ui.closeTray(),
  });

  // ---- Extreme weather ------------------------------------------------------------------------
  function repairAll() {
    const r = sim.disasters.repairAll();
    if (!r) return ui.toast(`Not enough money to repair everything (${money(sim.disasters.repairCost().total)}). Crews will keep working as money comes in`, 4200);
    if (!r.count) return ui.toast('Nothing needs repairing', 2000);
    sim.refresh();
    audio.play('fanfare', { gap: 1 });
    ui.toast(`Repaired ${r.count} place${r.count > 1 ? 's' : ''}${r.total ? ` for ${money(r.total)}` : ''}`, 3200);
  }
  function weatherReport({ kind, info, report: r }) {
    const lost = r.destroyed + r.damaged + r.roads;
    if (!lost && !r.trees) return ui.toast(`The ${info.label.toLowerCase()} has passed. No real damage`, 3200);
    const cost = sim.disasters.repairCost();
    const card = cardEl();
    card.classList.add('notable-card');
    const lines = [
      r.destroyed && `<b>${r.destroyed}</b> building${r.destroyed > 1 ? 's' : ''} destroyed`,
      r.damaged && `<b>${r.damaged}</b> damaged`,
      r.roads && `<b>${r.roads}</b> road${r.roads > 1 ? 's' : ''} washed out`,
      r.trees && `<b>${r.trees}</b> tree${r.trees > 1 ? 's' : ''} down`,
    ].filter(Boolean);
    const first = r.places[0];
    card.innerHTML =
      `<span class="insp-kicker">${info.icon} After the ${info.label.toLowerCase()}</span><h2>${lost ? 'Damage report' : 'Trees down'}</h2>` +
      `<p>${lines.join(' · ')}</p>` +
      (cost.count ? `<p class="np-bonus">Crews will repair things one by one as money allows.</p>` : '') +
      '<div class="decision-foot">' +
      (first ? `<button type="button" class="ghost-btn small" data-notable-show="${first.x},${first.y}">Show me</button>` : '<span></span>') +
      (cost.count ? `<button type="button" class="primary-btn small" data-repair-all>Repair everything · ${cost.total ? money(cost.total) : 'free'}</button>` : '') +
      '</div>';
    showCard(card, 12000);
    void kind;
  }

  // After a move, fly to the new home and say its address.
  const homeKey = () => {
    const h = sim.life.char?.home;
    return h ? `${h.x},${h.y}` : '';
  };
  function showNewHome() {
    const h = sim.life.char?.home;
    if (!h) return;
    sim.updateStreets();
    lifeUI.h.onFocus();
    ui.toast(`${sim.life.char.first}'s new home: ${addressOf(city.getTile(h.x, h.y))}`, 4200);
  }
  city.on((ev) => {
    // Sounds. Strokes fire many events; only the first few make a sound.
    const d = ev.delay || 0;
    if (ev.type === 'placed' && d < 0.5) audio.play(TOOL_SOUNDS[ev.structure.type] || 'pop', { delay: d, gap: 0.03 });
    else if (ev.type === 'removed' && d < 0.5) audio.play(ev.wasWater ? 'plant' : 'demolish', { delay: d, gap: 0.05 });
    else if (ev.type === 'watered' && d < 0.5) audio.play('water', { delay: d, gap: 0.05 });
    else if (ev.type === 'reset') audio.play('fanfare');
    else if (ev.type === 'restored') audio.play('undo');
    else if (ev.type === 'lifeEvent') audio.play('chime');
    if (ev.type === 'milestone') celebrate(ev.milestone);
    if (ev.type === 'era') newEra(ev);
    if (ev.type === 'weatherWarning') {
      audio.play('warning');
      ui.toast(`⚠ ${ev.info.label} warning! ${ev.info.warn} It will hit in a few hours`, 6000);
    }
    if (ev.type === 'extremeWeather' && ev.phase === 'start') {
      audio.play(ev.info.severity === 'extreme' ? 'warning' : 'thunder');
      const say = {
        storm: 'A thunderstorm is rolling in. Lightning may strike tall buildings',
        heatwave: 'A heatwave! Trees are wilting and fires can break out',
        blizzard: 'A blizzard! Some roads are snowed in until it passes',
        flood: 'The river has burst its banks!',
        tornado: 'A tornado is tearing across the map!',
        hurricane: 'The hurricane has arrived!',
      }[ev.kind];
      ui.toast(`${ev.info.icon} ${say}`, 5200);
    }
    if (ev.type === 'extremeWeather' && ev.phase === 'end') weatherReport(ev);
    if (ev.type === 'lightning') audio.play('thunder', { delay: 0.25, gap: 0.8 });
    if (ev.type === 'decision') {
      audio.play('chime');
      decisionCard.show({ auto: true });
    }
    if (ev.type === 'decided' && ev.lapsed) {
      decisionCard.hide();
      ui.toast(`${ev.choice.result} (No decision was made in time.)`, 3600);
    }
    if (ev.type === 'lifeChanged') {
      syncFollowUI();
      if (sim.life.char && !sim.life.char.alive) scheduleCarryOn();
    }
    if (ev.type === 'loaded' || ev.type === 'reset') {
      clearTimeout(carryTimer);
      carryTimer = null;
    }
    if (ev.type === 'notable') welcomeNotable(ev);
    if (ev.type === 'townNews') {
      // Big moments in townsfolk lives get a toast and a little heart over the spot.
      const n = ev.item;
      if (n.kind === 'wedding' || n.kind === 'love' || n.kind === 'left') ui.toast(n.text, 4200);
      if (n.kind === 'wedding') audio.play('chime', { gap: 2 });
      if (n.x != null && (n.kind === 'friends' || n.kind === 'love' || n.kind === 'wedding')) renderer.floatText(n.x, n.y, '♥', '#e8708a', 0, 40);
    }
    if (ev.type === 'achievement') {
      audio.play('fanfare', { gap: 1 });
      ui.toast(`★ Achievement: ${ev.achievement.label}. ${ev.achievement.desc}`, 3600);
    }

    if (ev.type === 'lifeEvent') lifeUI.eventArrived();
    else if (ev.type === 'lifeChanged') lifeUI.render();
    else if (['removed', 'watered', 'placed', 'reset', 'restored'].includes(ev.type)) {
      // A bulldozed home or workplace changes the character's life right away.
      if (sim.life.char?.alive) {
        sim.life.syncWithCity();
        lifeUI.render();
      }
    }
  });

  const input = new InputController(canvas, camera, {
    onTap: (sx, sy) => {
      const th = renderer.thoughtAt(sx, sy);
      if (th) {
        audio.play('click');
        cityPanel.focus(th.id);
        if (!cityPanel.open && window.innerWidth >= 560) cityPanel.toggle(true);
        return focusTile(th.x, th.y);
      }
      const t = tileAt(sx, sy);
      if (tool === 'inspect') {
        selected = t && !(selected && selected.x === t.x && selected.y === t.y) ? t : null;
        ui.inspect(city, selected);
        if (selected) audio.play('click');
        return;
      }
      if (!t) return;
      if (!sim.milestones.isUnlocked(tool)) return ui.setTool(tool);
      if (!buyAndBuild(tool, [t], () => labelFor(tool))) nope(t.x, t.y);
    },
    onBulldoze: (sx, sy) => {
      const t = tileAt(sx, sy);
      if (t && !build('bulldozing', [t], () => city.apply('bulldoze', t.x, t.y))) nope(t.x, t.y);
    },
    onHover: (sx, sy) => {
      hover = sx == null ? null : tileAt(sx, sy);
    },
    // Drag to build: roads follow an L from where the drag started; other tools paint as a brush.
    canPaint: () => tool !== 'inspect' && sim.milestones.isUnlocked(tool),
    onPaintStart: (sx, sy) => {
      const t = tileAt(sx, sy);
      stroke = t ? { tool, start: t, last: t, tiles: [t] } : null;
      hover = null;
    },
    onPaintMove: (sx, sy) => {
      const t = tileAt(sx, sy);
      if (!t) return;
      if (!stroke) {
        stroke = { tool, start: t, last: t, tiles: [t] };
        return;
      }
      if (t.x === stroke.last.x && t.y === stroke.last.y) return;
      if (stroke.tool === 'road') {
        stroke.tiles = lPath(stroke.start, t).slice(0, MAX_STROKE);
      } else {
        const seen = new Set(stroke.tiles.map((c) => c.y * city.width + c.x));
        for (const c of tileLine(stroke.last, t)) {
          if (stroke.tiles.length >= MAX_STROKE) break;
          const k = c.y * city.width + c.x;
          if (!seen.has(k)) {
            seen.add(k);
            stroke.tiles.push(c);
          }
        }
      }
      stroke.last = t;
    },
    onPaintEnd: (commit) => {
      const s = stroke;
      stroke = null;
      if (!commit || !s) return;
      const coords = s.tiles.filter((c) => city.canApply(s.tool, c.x, c.y));
      if (!coords.length) return nope(s.start.x, s.start.y);
      if (!buyAndBuild(s.tool, coords, (n) => labelFor(s.tool, n))) nope(s.start.x, s.start.y);
    },
  });

  if (fresh) {
    // A first visit starts from a seed that grows by itself, with a main person to follow.
    generateSeed(city);
    city.systems.mode = 'milestones';
    sim.economy.reset('land');
    sim.refresh();
    sim.eras.found();
    sim.growth.on = true;
    ui.refreshLocks();
    fitView(true);
    askForMainPerson();
    const touch = window.matchMedia?.('(pointer: coarse)').matches;
    ui.toast(
      touch ? 'Tap or drag to build · two fingers to move · long-press to bulldoze' : 'Click or drag to build · right-drag to move · right-click to bulldoze',
      6000
    );
  } else {
    sim.refresh();
    city.emit('loaded');
    ui.toast(visiting ? `You're visiting a shared town. Your own town is in save slot ${activeSlot()}: ☰ → Back to my town` : 'Welcome back to your town', visiting ? 5000 : 2400);
  }
  // Say what happened to a save that couldn't be opened, after the welcome toast has had its turn.
  const notes = [startNote, rescued?.slot ? `Your town from before a shared visit was kept, in save slot ${rescued.slot}.` : rescued ? 'A town saved before a shared visit is kept safe. Free up a save slot to get it back.' : null].filter(Boolean);
  if (notes.length) setTimeout(() => ui.toast(notes.join(' '), 9000), 6500);

  const hot = window.claude?.hot;
  hot?.snapshot?.(() => ({ city: city.toJSON() }));

  function viewState() {
    const plan = stroke ? { tool: stroke.tool, tiles: stroke.tiles.map((c) => ({ ...c, valid: city.canApply(stroke.tool, c.x, c.y) })) } : null;
    const issues = cityPanel.issues();
    if (!hover) return { overlay, selected, plan, issues };
    const t = city.getTile(hover.x, hover.y);
    const valid = tool === 'inspect' || city.canApply(tool, hover.x, hover.y);
    const ghost =
      valid && STRUCTURES[tool] && !t.structure && t.terrain === 'grass'
        ? { x: hover.x, y: hover.y, structure: { type: tool, variant: 'blush', floors: tool === 'office' ? 4 : 5, shape: 0, residents: 0 } }
        : null;
    return { hover: { ...hover, tool, valid }, ghost, overlay, selected, plan, issues };
  }

  let last = performance.now();
  let uiTimer = 0;
  function frame(now) {
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); // the first frame can be stamped before `last`
    last = now;
    sim.update(dt);
    input.edgeScroll(dt);
    if (following) {
      const f = followTarget();
      if (f) {
        const w = gridToWorld(f.gx, f.gy);
        camera.tx = w.x;
        camera.ty = w.y - 10;
        camera.clampTarget();
      }
    }
    camera.update(dt);
    audio.ambient(dt, { daylight: daylightAt(city.clock), rain: city.derived.weather?.rain || 0 });
    renderer.render(dt, viewState());
    minimap.render();
    saver.tick(dt);
    uiTimer -= dt;
    if (uiTimer <= 0) {
      ui.update(city);
      ui.inspect(city, selected);
      lifeUI.tick();
      cityPanel.update(city);
      decisionCard.tick();
      syncFollowUI();
      uiTimer = 0.2;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Handy for poking at the simulation from the console.
  window.pocketMetropolis = { city, sim, camera, renderer, history, audio, ui, cityPanel, decisionCard, slotsSheet, newTownSheet, lifeUI, startFollow, stopFollow, carryOn };
}

const hot = window.claude?.hot;
if (hot?.ready) hot.ready(start);
else start(hot?.data ?? {});
