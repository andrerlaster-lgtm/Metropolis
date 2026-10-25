// Viewer settings: comfort options that belong to this device, not to the city, so they live in
// localStorage apart from the save. Changing one notifies listeners (renderer, UI).

import { SEVERITY_COLORS } from './config.js';

const KEY = 'pocket-metropolis:settings';
// minimap null = automatic; scroll 'auto' = trackpad scrolling pans and mouse wheels zoom ('zoom' or 'pan' always)
const DEFAULTS = { colorBlind: false, largeText: false, minimap: null, scroll: 'auto', rivals: true };

// Okabe–Ito colours: told apart with every common type of colour blindness.
const CB_SEVERITY = { bad: '#d55e00', caution: '#e69f00', good: '#0072b2' };
const NORMAL_SEVERITY = { ...SEVERITY_COLORS };

export const settings = { ...DEFAULTS };
const listeners = new Set();

export function loadSettings() {
  try {
    Object.assign(settings, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}'));
  } catch {
    // Storage blocked or corrupt: keep the defaults.
  }
  apply();
  return settings;
}

export function setSetting(key, value) {
  settings[key] = value;
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Not saved, but still applied for this visit.
  }
  apply();
  for (const fn of listeners) fn(key, value);
}

export function onSettings(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Severity colours are shared by the map, the bubbles and the panel, so swap them in place.
function apply() {
  Object.assign(SEVERITY_COLORS, settings.colorBlind ? CB_SEVERITY : NORMAL_SEVERITY);
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('cb', !!settings.colorBlind);
  root.classList.toggle('large-text', !!settings.largeText);
}

// Desirability and traffic ramps: red → yellow → green normally; dark blue → yellow when colour-blind
// friendly (a single light-to-dark run reads for everyone).
export function rampStops() {
  return settings.colorBlind
    ? [
        [0, [68, 70, 140]],
        [0.5, [60, 160, 160]],
        [1, [240, 220, 90]],
      ]
    : [
        [0, [246, 140, 140]],
        [0.5, [255, 214, 120]],
        [1, [110, 200, 150]],
      ];
}
