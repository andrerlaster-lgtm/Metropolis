// Life event engine: decides which events can happen, fills in their text, rolls outcomes and
// applies their effects. Events themselves are data in lifeEvents.js.

import { stageFor } from './lifeData.js';
import { pickWeighted } from './utils.js';

export const STAT_KEYS = ['happiness', 'health', 'smarts', 'looks'];
export const STAT_LABELS = { happiness: 'Happiness', health: 'Health', smarts: 'Smarts', looks: 'Looks', money: 'Money' };
const DEFAULT_COOLDOWN = 4; // years before a repeatable event can return

// Extra rules events can use (legacyEvents.js), all optional:
//   eras: ['railway', …]    only in these historical eras (eras.js ids)
//   leader: 'you' | 'family' | 'any'   you are mayor / a relative is mayor / either
//   once: 'family'          once per family line, across generations
//   scheduled: true         never at random: only as a consequence coming back (legacy.js)
//   category                personal, family, political, economic, military or social, for variety
export function isEligible(ev, ctx, { allowScheduled = false } = {}) {
  const c = ctx.char;
  if (ev.manual) return false; // opened by an activity, never at random
  if (ev.scheduled && !allowScheduled) return false;
  if (ev.eras && !ev.eras.includes(ctx.era?.id)) return false;
  if (ev.leader === 'you' && ctx.leader !== 'you') return false;
  if (ev.leader === 'family' && ctx.leader !== 'family') return false;
  if (ev.leader === 'any' && !ctx.leader) return false;
  if (ev.once === 'family' && ctx.legacy?.state.seen[ev.id] != null) return false;
  if (ev.stages && !ev.stages.includes(stageFor(c.age).id)) return false;
  if (ev.minAge != null && c.age < ev.minAge) return false;
  if (ev.maxAge != null && c.age > ev.maxAge) return false;
  const last = c.seen[ev.id];
  if (last != null) {
    if (ev.once) return false;
    if (c.age - last < (ev.cooldown ?? DEFAULT_COOLDOWN)) return false;
  }
  if (ev.when && !ev.when(ctx)) return false;
  if (ev.choices && typeof ev.choices === 'function' && !ev.choices(ctx).length) return false;
  return true;
}

// `weightMod(ev)` scales each event's chance (the family's recent events, legacy.js).
export function pickEvent(events, ctx, rng = Math.random, weightMod = null) {
  const pool = events.filter((ev) => isEligible(ev, ctx));
  return pickWeighted(pool, (ev) => (typeof ev.weight === 'function' ? ev.weight(ctx) : ev.weight ?? 1) * (weightMod ? weightMod(ev) : 1), rng);
}

// Replace {name}, {they}, {friend}… with values; {They} capitalises.
export function fill(text, vars) {
  return text.replace(/\{(\w+)\}/g, (m, key) => {
    const lower = key[0].toLowerCase() + key.slice(1);
    const v = vars[key] ?? vars[lower];
    if (v == null) return m;
    return key[0] === key[0].toUpperCase() && key !== lower ? String(v)[0].toUpperCase() + String(v).slice(1) : String(v);
  });
}

export function choicesFor(ev, ctx) {
  const list = typeof ev.choices === 'function' ? ev.choices(ctx) : ev.choices;
  return list.map((ch, i) => ({ label: ch.label, data: ch.data ?? null, index: i }));
}

// Pick an outcome for a choice. Outcome weights may depend on traits and stats.
export function rollOutcome(ev, choiceIndex, data, ctx, rng = Math.random) {
  if (ev.outcome) return ev.outcome(ctx, data, rng);
  const choice = ev.choices[choiceIndex];
  return pickWeighted(choice.outcomes, (o) => (typeof o.weight === 'function' ? o.weight(ctx) : o.weight ?? 1), rng);
}

function clampStat(v) {
  return Math.max(0, Math.min(100, Math.round(v)));
}

// Apply an outcome's effects. Returns the visible changes for the outcome card.
export function applyEffects(effects = {}, ctx) {
  const c = ctx.char;
  const changes = [];
  for (const k of STAT_KEYS) {
    if (!effects[k]) continue;
    const before = c.stats[k];
    c.stats[k] = clampStat(before + effects[k]);
    if (c.stats[k] !== before) changes.push({ key: k, delta: c.stats[k] - before });
  }
  if (effects.money) {
    const before = c.money;
    c.money = Math.max(0, Math.round(c.money + effects.money));
    if (c.money !== before) changes.push({ key: 'money', delta: c.money - before });
  }
  if (effects.rel) {
    for (const [who, d] of Object.entries(effects.rel)) {
      const person = ctx.person(who);
      if (!person) continue;
      person.closeness = clampStat(person.closeness + d);
      changes.push({ key: 'rel', who: person.name, delta: d });
    }
  }
  for (const f of effects.set || []) c.flags[f] = true;
  for (const f of effects.unset || []) delete c.flags[f];
  // Effects on the whole town (money, spirit, trust, soldiers), applied by the life system.
  if (effects.town && ctx.townEffect) changes.push(...ctx.townEffect(effects.town));
  return changes;
}

// ---- Choosing for the player (auto mode) -------------------------------------------------

// The possible outcomes of a choice with their weights, or null when the event decides in code.
export function outcomesOf(ev, choiceIndex, ctx) {
  if (ev.outcome || typeof ev.choices === 'function') return null;
  const ch = ev.choices[choiceIndex];
  if (!ch?.outcomes) return null;
  return ch.outcomes.map((o) => ({ weight: Math.max(0, typeof o.weight === 'function' ? o.weight(ctx) : o.weight ?? 1), effects: o.effects || {} }));
}

// One number for how good an outcome's effects are: `weights` per stat (money per dollar).
export function scoreEffects(effects = {}, weights = {}) {
  let s = 0;
  for (const k of STAT_KEYS) s += (effects[k] || 0) * (weights[k] ?? 0.5);
  s += (effects.money || 0) * (weights.money ?? 0.004);
  for (const v of Object.values(effects.rel || {})) s += v * 0.1;
  const t = effects.town;
  if (t) s += (t.money || 0) / 300 + (t.spirit ? t.spirit[0] * 100 : 0) + (t.trust || 0) * 0.2 + (t.soldierXp || 0) * 0.05;
  return s;
}

// Pick a choice by a policy: 'safe' avoids the worst outcome, 'bold' chases the best one, 'focus'
// goes for the best on average with the given weights. Events decided in code take the first choice.
export function chooseByPolicy(ev, nChoices, ctx, policy, weights = {}) {
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < nChoices; i++) {
    const outs = outcomesOf(ev, i, ctx);
    if (!outs) return 0;
    const live = outs.filter((o) => o.weight > 0);
    if (!live.length) continue;
    const scores = live.map((o) => scoreEffects(o.effects, weights));
    const total = live.reduce((a, o) => a + o.weight, 0);
    const score = policy === 'safe' ? Math.min(...scores) : policy === 'bold' ? Math.max(...scores) : live.reduce((a, o, k) => a + (o.weight / total) * scores[k], 0);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}
