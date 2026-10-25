// Storybook visual sample page (storybook.html): a corner of your town, around Poppy Row, in the new
// painterly 3D style, with a Before / After switch to the game's current 3D view of the same spot.
//
// A prototype for judging the look. It only reads your save: it never writes to it (or to any save
// slot), and nothing in the game uses it. With no save, or with ?sample=1, it shows a generated town.
// ?slot=2 picks another save slot, ?street=Name another street.

import { STRUCTURES, PALETTE, SAVE_VERSION } from './config.js';
import { CityState } from './state.js';
import { Simulation } from './simulation.js';
import { Renderer, growthOf } from './renderer.js';
import { Camera } from './camera.js';
import { MIGRATIONS } from './persistence.js';
import { generateTown } from './generator.js';
import { lightingAt } from './lighting.js';
import { sunHeight, daylightAt } from './time.js';
import { crosswalkMask, footArms } from './sidewalks.js';
import { shortName } from './streets.js';
import { hash2 } from './utils.js';
import { mixHex } from './color.js';

const SAVE_KEY = 'pocket-metropolis:save';
const params = new URLSearchParams(location.search);
const touch = matchMedia('(pointer: coarse)').matches;
const $ = (id) => document.getElementById(id);

// Read a save slot without touching it: no recovery copies, no locks, nothing written.
function readOnly(slot) {
  try {
    const raw = localStorage.getItem(slot === 1 ? SAVE_KEY : `${SAVE_KEY}:${slot}`);
    if (!raw) return null;
    let save = JSON.parse(raw);
    let v = save.version | 0;
    if (v < 1 || v > SAVE_VERSION) return null;
    while (v < SAVE_VERSION) save = MIGRATIONS[v++](save);
    return CityState.fromJSON(save.city);
  } catch {
    return null;
  }
}

function activeSlotRead() {
  try {
    const n = Number(localStorage.getItem('pocket-metropolis:slot'));
    return n >= 1 && n <= 3 ? n : 1;
  } catch {
    return 1;
  }
}

function sampleTown() {
  const c = new CityState(32, 32);
  generateTown(c, 20240611);
  return c;
}

const slot = Number(params.get('slot')) || activeSlotRead();
let city = params.get('sample') ? null : readOnly(slot);
const source = city ? `Your town · save slot ${slot} · read only` : 'A sample town (no save found on this device)';
if (!city) city = sampleTown();
const sim = new Simulation(city);
sim.refresh();
// Both views show the same late-afternoon hour, whatever the time in your game. Only this page's
// copy of the town changes; the save is never written.
city.clock = 0.64;

const street = params.get('street') || 'Poppy Row';
const loading = $('sb-loading');
const status = (t) => (loading.textContent = t);

async function start() {
  status('Painting the village…');
  const sbm = await import('./view3d/storybook.js');
  const centre = sbm.pickCentre(city, street);
  const area = sbm.areaAround(city, centre.x, centre.y, 8);
  $('sb-where').textContent = centre.why === street ? street : centre.why === 'home' ? `${street} isn't in this town, so: your family's home` : `${street} isn't in this town, so: the town centre`;
  $('sb-source').textContent = source;
  const m = await import('./view3d/storybook3d.js');
  const canvas2d = document.createElement('canvas');
  const camera = new Camera();
  const renderer = new Renderer(canvas2d, city, camera, sim.agents);
  const stage = $('sb-stage');
  const after = m.createStorybook({ mount: (el) => stage.append(el), city, area, centre, renderer, growthOf, hash2, touch });
  if (!after) {
    status('This browser can’t show 3D (WebGL is off).');
    return;
  }
  loading.hidden = true;
  $('sb-stats').textContent = `${Math.round(after.vertices / 1000)}k vertices`;
  let before = null;
  let mode = 'after';
  let shown = after;

  async function makeBefore() {
    const v = await import('./view3d/view3d.js');
    return v.createView3D({
      world: { focus: { city, agents: sim.agents, renderer, home: true }, others: [] },
      STRUCTURES,
      PALETTE,
      growthOf,
      lightingAt,
      sunHeight,
      crosswalkMask,
      footArms,
      shortName,
      hash2,
      mixHex,
      lifeChar: () => sim.life.char,
      isPaused: () => false,
      nameOf: () => null,
      isTyping: () => false,
      toast: () => {},
      mount: (el) => stage.append(el),
      mountHud: (...els) => $('sb-before-hud').append(...els),
      onExit: () => setMode('after'),
      onPick: () => {},
    });
  }

  async function setMode(next) {
    if (next === mode) return;
    const view = shown === after ? after.view() : beforeView();
    if (next === 'before') {
      if (!before) {
        status('Loading the current 3D view…');
        loading.hidden = false;
        before = await makeBefore();
        loading.hidden = true;
        if (!before) return;
      }
      after.exit();
      before.enter({ x: view.x, z: view.z, dist: view.dist });
      for (const o of [before.rig.o, before.rig.og]) {
        o.yaw = view.yaw;
        o.pitch = view.pitch;
      }
      shown = before;
    } else {
      const v = beforeView();
      before?.exit();
      after.enter(v);
      shown = after;
    }
    mode = next;
    document.body.dataset.mode = mode;
    for (const b of document.querySelectorAll('[data-show]')) b.setAttribute('aria-pressed', String(b.dataset.show === mode));
  }
  function beforeView() {
    if (!before) return after.view();
    const o = before.rig.og;
    return { x: o.x, z: o.z, dist: o.dist, yaw: o.yaw, pitch: o.pitch };
  }

  for (const b of document.querySelectorAll('[data-show]')) b.addEventListener('click', () => setMode(b.dataset.show));
  $('sb-reset').addEventListener('click', () => {
    if (mode === 'before') setMode('after');
    after.resetView();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'b' || e.key === 'B') setMode(mode === 'after' ? 'before' : 'after');
  });

  after.enter();
  document.body.dataset.mode = 'after';
  let last = performance.now();
  const fps = $('sb-fps');
  let fpsT = 0;
  let frames = 0;
  const loop = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (shown === before && before) {
      try {
        sim.agents.update(dt, daylightAt(city.clock));
      } catch {
        // People still stand where they are.
      }
      before.frame(dt);
    } else after.frame(dt);
    fpsT += dt;
    frames++;
    if (fpsT >= 1) {
      fps.textContent = `${Math.round(frames / fpsT)} fps`;
      fpsT = 0;
      frames = 0;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

start().catch((err) => {
  console.error(err);
  status('Something went wrong loading the sample. ' + (err?.message || ''));
});
