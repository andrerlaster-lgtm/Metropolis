// Advisor: turns the city's state into a few short resident "thoughts". Each one is a wish (something
// residents would like) or a happy note, with a tile to point the camera at. Read-only: nothing is changed.

import { STRUCTURES, SERVICE_RATING } from './config.js';
import { roadPlanFor } from './roadPlanner.js';
import { WALK_LONG } from './labor.js';

const MAX_THOUGHTS = 5;
const MAX_TILES = 240;
// How urgent a thought is: 'bad' (red, fix soon), 'caution' (yellow, worth a look) or 'good' (green).
export const SEVERITY_RANK = { bad: 0, caution: 1, good: 2 };

const spot = (t) => ({ x: t.x, y: t.y });

function isHome(t) {
  return !!t.structure && STRUCTURES[t.structure.type].capacity > 0;
}

// The occupied home that best stands for a problem: the most residents, ties broken by position.
function worstOf(tiles) {
  let best = null;
  for (const t of tiles) if (!best || t.structure.residents > best.structure.residents) best = t;
  return best;
}

function hasWaterNear(city, tile, r = 2) {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) if (city.getTile(tile.x + dx, tile.y + dy)?.terrain === 'water') return true;
  }
  return false;
}

export function computeThoughts(city, milestones) {
  const out = [];
  // `tile` is where the camera goes; `area` lists every tile the thought is about, for highlighting.
  const add = (id, severity, priority, text, hint, tile, area = tile ? [tile] : [], extra = {}) =>
    out.push({
      ...extra,
      id,
      kind: severity === 'good' ? 'happy' : 'wish',
      severity,
      priority,
      text,
      hint,
      x: tile ? tile.x : null,
      y: tile ? tile.y : null,
      tiles: area.slice(0, MAX_TILES).map(spot),
    });
  const unlocked = (tool) => !milestones || milestones.isUnlocked(tool);

  const homes = city.tiles.filter(isHome);
  const lived = homes.filter((h) => h.structure.residents > 0);

  // Damage from extreme weather that still needs fixing.
  const broken = city.tiles.filter((t) => t.structure && (t.structure.type === 'rubble' || t.structure.broken || (t.structure.damage || 0) >= 0.15));
  if (broken.length) {
    const roads = broken.filter((t) => t.structure.broken).length;
    const rubble = broken.filter((t) => t.structure.type === 'rubble').length;
    const what = [rubble && `${rubble} wrecked`, roads && `${roads} road${roads > 1 ? 's' : ''} washed out`, broken.length - roads - rubble && `${broken.length - roads - rubble} damaged`].filter(Boolean).join(', ');
    add('repairs', rubble || roads >= 2 ? 'bad' : 'caution', 5.5, `Storm damage needs fixing: ${what}.`, 'Crews repair one thing at a time while there is money. Repair all fixes everything now', broken[0], broken, { repair: true });
  }

  // Homes now need a road when they're built, but older towns can still have some without. Their
  // people walk everywhere (labor.js), so it's a caution, not an emergency.
  const cutOff = homes.filter((h) => !city.accessRoad(h.x, h.y));
  if (cutOff.length) {
    add('no-road', 'caution', 4.5, cutOff.length === 1 ? 'A home has no road. Its people walk everywhere.' : `${cutOff.length} homes have no road. Their people walk everywhere.`, 'A road beside them would make getting to work and around town easier', cutOff[0], cutOff);
  }

  // A long walk to work: people can walk to any job, but not happily for ever.
  const farWalk = lived.filter((h) => (h.commuteWalk || 0) > WALK_LONG && h.employment > 0);
  if (farWalk.length) {
    add('long-walk', 'caution', 3.5, farWalk.length === 1 ? 'Someone has a long walk to work.' : `${farWalk.length} homes have a long walk to work.`, 'Build a road, or jobs closer to home', worstOf(farWalk), farWalk);
  }

  const labor = city.derived.labor;
  const workers = labor ? labor.employed + labor.unemployed : 0;
  if (workers >= 6 && labor.unemployed / workers > 0.15) {
    const jobless = lived.filter((h) => h.employment < 0.5);
    const share = labor.unemployed / workers;
    add('jobs', share > 0.3 ? 'bad' : 'caution', 4, `We need jobs! ${labor.unemployed} people are looking for work.`, 'Build shops or offices near homes', worstOf(jobless) || worstOf(lived), jobless);
  }

  if (unlocked('school')) {
    const far = lived.filter((h) => (h.coverage.school || 0) < 0.1);
    if (far.length) add('school', 'caution', 3, 'Our kids have no school nearby.', 'Build a school', worstOf(far), far);
  }

  // Traffic: only raised where a new or longer road would really help. Jams count through traffic
  // only, so a street that is busy because of the buildings along it isn't blamed on the road.
  const roadPlan = roadPlanFor(city);
  if (roadPlan?.best) {
    const { jam, best } = roadPlan;
    const n = best.tiles.length;
    const street = jam.street || 'This road';
    const less = Math.round(best.gain * 100);
    const how = {
      extend: `Extend the dead end by ${n} tile${n > 1 ? 's' : ''} to make a shortcut`,
      link: `A ${n}-tile link road would give drivers another way`,
      bypass: `A ${n}-tile road alongside it would share the traffic`,
      around: `A ${n}-tile road around it would share the traffic`,
    }[best.kind];
    const mid = best.tiles[Math.floor(n / 2)];
    add(
      'traffic',
      jam.tile.congestion >= 0.99 ? 'bad' : 'caution',
      3,
      `${street} is jammed with through traffic.`,
      `${how} (about ${less}% less delay)${best.trees ? `, clearing ${best.trees} tree${best.trees > 1 ? 's' : ''}` : ''}.`,
      mid,
      jam.segment,
      { plan: best.tiles.map(spot), planKind: best.kind },
    );
  }

  // Money: only a worry outside Sandbox.
  const econ = city.derived.economy;
  const purse = city.systems.economy;
  if (econ && purse && city.systems.mode !== 'sandbox') {
    const costly = econ.costly?.[0];
    if (econ.net < 0) {
      add('budget', purse.money < -econ.net * 2 ? 'bad' : 'caution', 4.5, `The town spends ${Math.round(-econ.net)} dollars a day more than it earns.`, 'More homes and workplaces bring in taxes; services and parks cost upkeep', costly || null, costly ? [costly] : []);
    } else if (purse.money < 200 && econ.net < 100) {
      add('budget', 'caution', 2.5, 'The town is nearly out of money.', 'Taxes come in every day; homes and businesses pay the most', econ.top?.[0] || null, econ.top?.[0] ? [econ.top[0]] : []);
    }
  }

  if (unlocked('clinic')) {
    const far = lived.filter((h) => (h.coverage.health || 0) < 0.1);
    if (far.length) add('health', 'caution', 2.5, "There's no clinic if someone gets sick.", 'Build a clinic', worstOf(far), far);
  }

  if (unlocked('firestation') && lived.length >= 10 && (city.systems.disasters?.level ?? 'gentle') !== 'off') {
    const far = lived.filter((h) => (h.coverage.fire || 0) < 0.1);
    if (far.length) add('fire', 'caution', 1.5, 'If a fire breaks out, no fire engine could get here in time.', 'Build a fire station', worstOf(far), far);
  }

  // A service with more residents than it can look after slips in quality until another is built.
  const stretched = (city.derived.serviceStats || []).filter((st) => st.rating < SERVICE_RATING.strained && st.demand > 0);
  for (const [service, text, hint] of [
    ['school', 'The school is too crowded for all our children.', 'Build another school or a library nearby'],
    ['health', 'The waiting room at the clinic is always full.', 'Build another clinic nearby'],
    ['fire', 'One fire station can’t look after all these homes.', 'Build another fire station nearby'],
  ]) {
    const worst = stretched.filter((st) => st.service === service).sort((a, b) => a.rating - b.rating)[0];
    if (!worst) continue;
    const r = STRUCTURES[worst.type].radius;
    const served = lived.filter((h) => Math.hypot(h.x - worst.tile.x, h.y - worst.tile.y) <= r);
    add(`strained-${service}`, worst.rating < 0.5 ? 'bad' : 'caution', 2.6, text, hint, worst.tile, [worst.tile, ...served]);
  }

  const bare = lived.filter((h) => (h.factors.greenery || 0) < 0.02);
  if (bare.length) add('green', 'caution', 2, "It's all concrete here. A few trees would be lovely.", 'Plant trees or a park', worstOf(bare), bare);

  const quiet = city.tiles.filter(
    (t) => t.structure && STRUCTURES[t.structure.type].jobs >= 4 && t.workersFilled < STRUCTURES[t.structure.type].jobs * 0.5,
  );
  if (quiet.length && homes.length) add('workers', 'caution', 2, 'Some workplaces are short of staff.', 'Build homes nearby, linked by road', quiet[0], quiet);

  // Townsfolk who went hungry, bored or lonely for want of somewhere nearby to go.
  const unmet = city.derived.townsfolkUnmet;
  const folk = city.systems.townsfolk?.people;
  if (unmet && folk?.length) {
    const homesOf = (ids) => {
      const seen = new Set();
      const out = [];
      for (const id of ids) {
        const p = folk.find((q) => q.id === id);
        const t = p && city.getTile(p.home.x, p.home.y);
        if (t?.structure && !seen.has(t)) {
          seen.add(t);
          out.push(t);
        }
      }
      return out;
    };
    const wants = [
      ['eat', 'Nowhere to grab a bite around here.', unlocked('cafe') ? 'Build a café, bakery, shop or mall nearby' : 'Build a shop nearby'],
      ['play', 'There’s nothing to do on the weekend!', 'Build a park, playground or sports field nearby'],
      ['social', 'We never see our friends. Somewhere to meet up?', 'A café or a park gives neighbours a place to meet'],
    ];
    for (const [kind, text, hint] of wants) {
      const tiles = homesOf(unmet[kind] || []);
      if (tiles.length >= 2) add(`folk-${kind}`, tiles.length >= 6 ? 'bad' : 'caution', 2.2, text, hint, worstOf(tiles), tiles);
    }
  }

  if (unlocked('playground')) {
    const far = lived.filter((h) => (h.coverage.fun || 0) < 0.1);
    if (far.length) add('fun', 'caution', 1.5, 'Nowhere to play around here!', 'Build a playground', worstOf(far), far);
  }

  // Always one happy note from the nicest occupied home.
  let best = null;
  for (const h of lived) if (!best || h.desirability > best.desirability) best = h;
  if (best) {
    const text = hasWaterNear(city, best)
      ? 'I love waking up to the water view.'
      : (best.factors.greenery || 0) > 0.15
        ? 'So much green on our street. Love it here!'
        : 'This is a lovely little neighbourhood.';
    add('happy', 'good', 1, text, 'Your happiest home', best);
  }

  // Keep the happy note even on a bad day: red issues first, then yellow, then the happy one.
  const happy = out.filter((t) => t.kind === 'happy');
  const wishes = out
    .filter((t) => t.kind !== 'happy')
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.priority - a.priority);
  return [...wishes.slice(0, MAX_THOUGHTS - happy.length), ...happy];
}
