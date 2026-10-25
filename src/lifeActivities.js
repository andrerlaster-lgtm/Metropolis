// Life Story activities: things the character can choose to do any time between events, a few
// times a year. Many use real places in the city: the nearest playground, park, sports field, shop,
// school or clinic. Pure data plus small functions; LifeSystem.doActivity runs them.
//
// An activity: { id, group, label(ctx), hint(ctx), minAge, maxAge, when(ctx), cost, run(ctx, rng) }.
// `run` returns an outcome { text, effects, do } like an event outcome, or { launch: 'event_id' } to
// open an event card with choices (used for buying a home or job hunting).

import { STRUCTURES } from './config.js';
import { CAREERS } from './lifeData.js';
import { addressOf } from './streets.js';

const o = (text, effects = {}, extra = {}) => ({ text, effects, ...extra });
const where = (t) => `the ${STRUCTURES[t.structure.type].label.toLowerCase()} at ${addressOf(t)}`;
const chance = (rng, p) => rng() < p;

export const ACTIVITY_GROUPS = [
  { id: 'body', label: 'Mind & body' },
  { id: 'people', label: 'People' },
  { id: 'out', label: 'Out in the city' },
  { id: 'create', label: 'Creative' },
  { id: 'money', label: 'Work & home' },
];

// How many activities fit in a year at each age.
export function energyFor(age) {
  if (age < 3) return 0;
  if (age < 13) return 2;
  return 3;
}

// Essentials (essential: true) are always on offer. Everything else rotates: each birthday the
// character is offered ROTATION_SIZE of the activities that suit their age and town, favouring ones
// they weren't offered last year. The choice is saved on the character (char.offered).
export const ROTATION_SIZE = 9;

export function pickRotation(candidates, previous = [], size = ROTATION_SIZE, rng = Math.random) {
  const pool = candidates.map((a) => ({ id: a.id, w: previous.includes(a.id) ? 0.25 : 1 }));
  const out = [];
  while (out.length < size && pool.length) {
    const total = pool.reduce((n, p) => n + p.w, 0);
    let r = rng() * total;
    let k = 0;
    while (k < pool.length - 1 && (r -= pool[k].w) > 0) k++;
    out.push(pool.splice(k, 1)[0].id);
  }
  return out;
}

export const ACTIVITIES = [
  // ---- Mind & body -------------------------------------------------------------
  {
    id: 'study',
    essential: true,
    group: 'body',
    minAge: 5,
    label: (ctx) => (ctx.char.age >= 22 ? 'Take an evening class' : 'Study hard'),
    hint: (ctx) => (ctx.facts.schoolCoverage > 0.25 ? 'School nearby: +Smarts' : 'No school nearby: smaller gain'),
    cost: (ctx) => (ctx.char.age >= 22 ? 300 : 0),
    run: (ctx, rng) => {
      const near = ctx.facts.schoolCoverage > 0.25;
      const curious = ctx.has('curious') ? 1 : 0;
      if (chance(rng, 0.15)) return o('{name} fell asleep on the books. Still, some of it went in.', { smarts: 1, health: 1 });
      return near
        ? o('{name} studied at the school library until closing time.', { smarts: 4 + curious, happiness: -1 })
        : o('With no school nearby, {name} studied alone at the kitchen table.', { smarts: 2 + curious, happiness: -1 });
    },
  },
  {
    id: 'exercise',
    essential: true,
    group: 'body',
    minAge: 6,
    label: (ctx) => {
      const field = ctx.nearest('field', 10);
      if (field) return 'Play sport at the field';
      return ctx.facts.greenery > 0.1 ? 'Go for a run in the park' : 'Go for a jog';
    },
    hint: (ctx) => (ctx.nearest('field', 10) ? `Sports field at ${addressOf(ctx.nearest('field', 10))}: +Health` : '+Health'),
    run: (ctx, rng) => {
      const field = ctx.nearest('field', 10);
      const sporty = ctx.has('sporty') ? 2 : 0;
      if (field) {
        return chance(rng, 0.12)
          ? o(`{name} twisted an ankle at ${where(field)}.`, { health: -3, happiness: -1 })
          : o(`{name} played a game at ${where(field)} and scored twice.`, { health: 6 + sporty, happiness: 4, looks: 1 });
      }
      if (ctx.facts.greenery > 0.1) return o('{name} ran laps under the trees and felt great.', { health: 5 + sporty, happiness: 3 });
      return o('{name} jogged along busy roads. Fresh air would be nicer. (A park or sports field nearby would help.)', { health: 3 + sporty, happiness: -1 });
    },
  },
  {
    id: 'doctor',
    essential: true,
    group: 'body',
    minAge: 10,
    label: () => 'See a doctor',
    hint: (ctx) => (ctx.facts.clinicCoverage > 0.25 ? 'Clinic nearby: +Health' : 'No clinic nearby: long trip'),
    cost: () => 100,
    run: (ctx) =>
      ctx.facts.clinicCoverage > 0.25
        ? o('The clinic down the road gave {name} a full check-up and some good advice.', { health: 7 })
        : o('The nearest clinic was a long trip away, but {name} got seen in the end.', { health: 3, happiness: -2 }),
  },
  {
    id: 'rest',
    essential: true,
    group: 'body',
    minAge: 3,
    label: (ctx) => (ctx.char.age < 13 ? 'Build a blanket fort' : 'Have a lazy day'),
    hint: () => '+Happiness',
    run: (ctx) => (ctx.char.age < 13 ? o('{name} built the greatest blanket fort of all time.', { happiness: 5 }) : o('{name} slept in, read a book and ordered pizza.', { happiness: 5, health: 1 })),
  },
  {
    id: 'makeover',
    group: 'body',
    minAge: 14,
    label: () => 'Get a new look',
    hint: () => '+Looks',
    cost: () => 250,
    run: (ctx, rng) =>
      chance(rng, 0.2)
        ? o('The new haircut was… brave. It will grow back.', { looks: -2, happiness: -2 })
        : o('{name} got a fresh haircut and new clothes, and feels fantastic.', { looks: 5, happiness: 3 }),
  },

  // ---- People ---------------------------------------------------------------------
  {
    id: 'family',
    essential: true,
    group: 'people',
    minAge: 3,
    when: (ctx) => ctx.person('mother') || ctx.person('father'),
    label: (ctx) => (ctx.char.livesWithParents ? 'Family games night' : 'Visit {mother} and {father}'),
    hint: () => '+Closeness with parents',
    run: (ctx) => o(ctx.char.livesWithParents ? '{name} won at cards and {father} demanded a rematch.' : '{name} came home for Sunday lunch. {mother} sent leftovers.', { happiness: 3, rel: { mother: 7, father: 7 } }),
  },
  {
    id: 'sibling',
    essential: true,
    group: 'people',
    minAge: 3,
    when: (ctx) => ctx.person('sibling'),
    label: () => 'Hang out with {sibling}',
    hint: () => '+Closeness',
    run: (ctx, rng) =>
      chance(rng, 0.2)
        ? o('{name} and {sibling} argued over the TV remote.', { happiness: -1, rel: { sibling: -3 } })
        : o('{name} and {sibling} laughed until their sides hurt.', { happiness: 4, rel: { sibling: 8 } }),
  },
  {
    id: 'friend',
    essential: true,
    group: 'people',
    minAge: 4,
    when: (ctx) => ctx.person('friend'),
    label: () => 'Hang out with {friend}',
    hint: () => '+Closeness, +Happiness',
    run: (ctx) => {
      const park = ctx.nearest(['park', 'playground'], 8);
      return park
        ? o(`{name} and {friend} spent the afternoon at ${where(park)}.`, { happiness: 5, rel: { friend: 8 } })
        : o('{name} and {friend} hung out at home playing games.', { happiness: 4, rel: { friend: 7 } });
    },
  },
  {
    id: 'meet',
    essential: true,
    group: 'people',
    minAge: 4,
    label: () => 'Make a new friend',
    hint: (ctx) => (ctx.has('outgoing') ? 'Outgoing: good odds' : 'Might be awkward'),
    run: (ctx, rng) => {
      const n = ctx.neighbour();
      const odds = 0.55 + (ctx.has('outgoing') ? 0.25 : 0) + (ctx.char.stats.looks - 50) / 250;
      if (!chance(rng, odds)) return o('{name} said hello to a few people, but nothing clicked.', { happiness: -1 });
      if (n) return o(`{name} got chatting with ${n.person} from ${n.family} at ${n.address}. A new friend!`, { happiness: 4 }, { do: (c) => c.addFriend(55, n.person) });
      return o('{name} met someone nice and swapped numbers.', { happiness: 4 }, { do: (c) => c.addFriend(50) });
    },
  },
  {
    id: 'date',
    essential: true,
    group: 'people',
    minAge: 16,
    maxAge: 75,
    label: (ctx) => (ctx.char.partner ? 'Date night with {partner}' : 'Go on a date'),
    hint: (ctx) => (ctx.char.partner ? '+Closeness' : 'Looks and Outgoing help'),
    cost: () => 60,
    run: (ctx, rng) => {
      if (ctx.char.partner) {
        const park = ctx.nearest('park', 10);
        return park
          ? o(`{name} and {partner} had a picnic at ${where(park)} at sunset.`, { happiness: 5, rel: { partner: 9 } })
          : o('{name} and {partner} cooked dinner together and burned the rice.', { happiness: 4, rel: { partner: 7 } });
      }
      const odds = 0.3 + ctx.char.stats.looks / 250 + (ctx.has('outgoing') ? 0.15 : 0);
      if (chance(rng, odds)) return o('{name} met someone wonderful over coffee. It\'s official!', { happiness: 9 }, { do: (c) => c.setPartner(55) });
      return o('The date talked about their ex all night. Next!', { happiness: -3 });
    },
  },
  {
    id: 'kids',
    essential: true,
    group: 'people',
    minAge: 18,
    when: (ctx) => ctx.char.children.some((k) => k.alive !== false && k.age < 18),
    label: () => 'Play with {child}',
    hint: (ctx) => (ctx.nearest('playground', 8) ? 'Playground nearby' : '+Happiness'),
    run: (ctx) => {
      const pg = ctx.nearest('playground', 8);
      return pg
        ? o(`{name} pushed {child} on the swings at ${where(pg)}.`, { happiness: 6 })
        : o('{name} and {child} built a cardboard rocket. (A playground nearby would be fun.)', { happiness: 4 });
    },
  },

  // ---- Out in the city ------------------------------------------------------------
  {
    id: 'playground',
    essential: true,
    group: 'out',
    minAge: 3,
    maxAge: 12,
    label: () => 'Go to the playground',
    hint: (ctx) => {
      const pg = ctx.nearest('playground', 8);
      return pg ? `At ${addressOf(pg)}` : 'None nearby: build a playground';
    },
    when: (ctx) => ctx.nearest('playground', 8),
    run: (ctx, rng) => {
      const pg = ctx.nearest('playground', 8);
      if (chance(rng, 0.15)) return o(`{name} fell off the slide at ${where(pg)}. A plaster and a lolly fixed it.`, { health: -1, happiness: 2 });
      return chance(rng, 0.35)
        ? o(`{name} made a friend on the climbing frame at ${where(pg)}.`, { happiness: 6, health: 2 }, { do: (c) => c.addFriend(50) })
        : o(`{name} went down the slide at ${where(pg)} about a hundred times.`, { happiness: 7, health: 2 });
    },
  },
  {
    id: 'park',
    essential: true,
    group: 'out',
    minAge: 3,
    label: () => 'Walk in the park',
    hint: (ctx) => {
      const p = ctx.nearest('park', 10);
      return p ? `At ${addressOf(p)}` : 'None nearby: build a park';
    },
    when: (ctx) => ctx.nearest('park', 10),
    run: (ctx) => {
      const p = ctx.nearest('park', 10);
      const season = ctx.city.derived.weather?.season;
      const extra = season === 'spring' ? ' The blossom was out.' : season === 'autumn' ? ' The leaves were turning orange.' : season === 'winter' ? ' Everything was frosty.' : '';
      return o(`{name} took a long walk round the fountain at ${where(p)}.${extra}`, { happiness: 5, health: 2 });
    },
  },
  {
    id: 'shopping',
    group: 'out',
    minAge: 10,
    label: () => 'Go shopping',
    hint: (ctx) => {
      const s = ctx.nearest('shop', 40);
      return s ? `Shop at ${addressOf(s)}` : 'No shops in town yet';
    },
    when: (ctx) => ctx.nearest('shop', 40),
    cost: () => 150,
    run: (ctx, rng) => {
      const s = ctx.nearest('shop', 40);
      return chance(rng, 0.25)
        ? o(`{name} found a bargain at ${where(s)} and spent less than planned.`, { happiness: 4, looks: 2, money: 80 })
        : o(`{name} came home from ${where(s)} with bags of new things.`, { happiness: 4, looks: 2 });
    },
  },
  {
    id: 'volunteer',
    group: 'out',
    minAge: 12,
    label: () => 'Volunteer',
    hint: () => '+Happiness, maybe a friend',
    when: (ctx) => ctx.nearest(['clinic', 'school', 'park'], 40),
    run: (ctx, rng) => {
      const t = ctx.nearest(['clinic', 'school', 'park'], 40);
      const what = t.structure.type === 'clinic' ? 'helped out at the reception desk' : t.structure.type === 'school' ? 'read stories to the little ones' : 'picked litter and planted bulbs';
      return o(`{name} ${what} at ${where(t)}.`, { happiness: 5, smarts: 1 }, chance(rng, 0.4) ? { do: (c) => c.addFriend(50) } : {});
    },
  },

  // ---- Work & home ------------------------------------------------------------------
  {
    id: 'babysit',
    group: 'money',
    minAge: 13,
    maxAge: 17,
    label: () => 'Babysit for neighbours',
    hint: () => '+$150',
    when: (ctx) => ctx.neighbour(),
    run: (ctx, rng) => {
      const n = ctx.neighbour();
      return chance(rng, 0.2)
        ? o(`The ${n.family.replace(/^the /, '')} kids at ${n.address} painted the cat. {name} still got paid.`, { money: 150, happiness: -2 })
        : o(`{name} babysat for ${n.family} at ${n.address}. Easy money.`, { money: 150, happiness: 1 });
    },
  },
  {
    id: 'job_hunt',
    essential: true,
    group: 'money',
    minAge: 18,
    maxAge: 62,
    label: () => 'Look for a job',
    hint: (ctx) => `${ctx.openJobs().length} workplaces hiring`,
    when: (ctx) => !ctx.char.job && !ctx.char.flags.retired,
    run: () => ({ launch: 'job_hunt' }),
  },
  {
    id: 'overtime',
    essential: true,
    group: 'money',
    minAge: 16,
    when: (ctx) => ctx.char.job,
    label: () => 'Work overtime',
    hint: (ctx) => (ctx.char.job.level < CAREERS[ctx.char.job.type].titles.length - 1 ? 'Money, and a shot at promotion' : 'Extra money'),
    run: (ctx, rng) => {
      const c = ctx.char;
      const career = CAREERS[c.job.type];
      const pay = Math.round(career.pay[c.job.level] * 0.04);
      const top = c.job.level >= career.titles.length - 1;
      if (!top && c.job.years >= 1 && chance(rng, 0.12 + c.stats.smarts / 600)) {
        return o(`The boss noticed! {name} was promoted to ${career.titles[c.job.level + 1].toLowerCase()}.`, { money: pay, happiness: 6, health: -2 }, { do: (x) => ((x.char.job.level += 1), (x.char.job.years = 0)) });
      }
      return o('{name} stayed late at the {workplace} all month.', { money: pay, health: -3, happiness: -1 });
    },
  },
  {
    id: 'buy_home',
    essential: true,
    group: 'money',
    minAge: 18,
    when: (ctx) => !ctx.char.flags.ownsHome || ctx.homesForSale().length,
    label: (ctx) => (ctx.char.flags.ownsHome ? 'Move to a new home' : 'Buy a home'),
    hint: (ctx) => {
      const cheapest = ctx.homesForSale()[0];
      return cheapest ? `From $${Math.min(...ctx.homesForSale().map((h) => h.price)).toLocaleString()}` : 'Nothing for sale';
    },
    run: () => ({ launch: 'buy_home' }),
  },

  // ---- More to do (these rotate: see ROTATION_SIZE) ------------------------------------------

  // Mind & body
  {
    id: 'swim',
    group: 'body',
    minAge: 5,
    label: () => 'Go for a swim',
    hint: (ctx) => `Pool at ${addressOf(ctx.nearest('pool', 12))}: +Health`,
    when: (ctx) => ctx.nearest('pool', 12),
    cost: () => 20,
    run: (ctx, rng) => {
      const pool = ctx.nearest('pool', 12);
      return chance(rng, 0.2)
        ? o(`{name} swam lengths at ${where(pool)} and made a splash at the deep end.`, { health: 6, happiness: 4 })
        : o(`{name} did thirty lengths at ${where(pool)}.`, { health: 6 + (ctx.has('sporty') ? 2 : 0), happiness: 2 });
    },
  },
  {
    id: 'yoga',
    group: 'body',
    minAge: 14,
    label: () => 'Try a yoga class',
    hint: () => '+Health, calmer',
    cost: () => 40,
    run: (ctx, rng) => (chance(rng, 0.15) ? o('{name} fell over in tree pose. Everyone laughed, kindly.', { happiness: 3, health: 2 }) : o('{name} breathed deeply, stretched and left feeling ten years younger.', { health: 4, happiness: 4 })),
  },
  {
    id: 'library_visit',
    group: 'body',
    minAge: 6,
    label: () => 'Spend an afternoon at the library',
    hint: (ctx) => `Library at ${addressOf(ctx.nearest('library', 14))}: +Smarts`,
    when: (ctx) => ctx.nearest('library', 14),
    run: (ctx, rng) => {
      const lib = ctx.nearest('library', 14);
      return chance(rng, 0.2)
        ? o(`{name} found a forgotten old atlas at ${where(lib)} and read it cover to cover.`, { smarts: 6, happiness: 2 })
        : o(`{name} borrowed a pile of books from ${where(lib)}.`, { smarts: 4, happiness: 2 });
    },
  },
  {
    id: 'museum_trip',
    group: 'body',
    minAge: 6,
    label: () => 'Visit the museum',
    hint: (ctx) => `Museum at ${addressOf(ctx.nearest('museum', 14))}: +Smarts`,
    when: (ctx) => ctx.nearest('museum', 14),
    cost: () => 15,
    run: (ctx) => o(`{name} wandered the halls of ${where(ctx.nearest('museum', 14))} and learned something surprising about the town's past.`, { smarts: 5, happiness: 3 }),
  },
  {
    id: 'journal',
    group: 'body',
    minAge: 12,
    label: () => 'Keep a journal',
    hint: () => '+Happiness, +Smarts',
    run: (ctx, rng) => (chance(rng, 0.2) ? o('{name} re-read an old entry and cringed, then laughed.', { happiness: 3, smarts: 1 }) : o('{name} wrote a page every night for a month and felt lighter.', { happiness: 4, smarts: 2 })),
  },
  {
    id: 'cook',
    group: 'body',
    minAge: 10,
    label: () => 'Learn a new recipe',
    hint: () => '+Health, +Happiness',
    cost: () => 25,
    run: (ctx, rng) => (chance(rng, 0.25) ? o('{name} set off the smoke alarm, but the second attempt was delicious.', { health: 2, happiness: 3 }) : o('{name} mastered a proper stew and fed the whole street.', { health: 3, happiness: 5 })),
  },

  // People
  {
    id: 'dinner_out',
    group: 'people',
    minAge: 16,
    label: (ctx) => (ctx.char.partner ? 'Dinner out with {partner}' : 'Dinner out with {friend}'),
    hint: (ctx) => {
      const r = ctx.nearest(['restaurant', 'cafe'], 16);
      return r ? `At ${addressOf(r)}` : '';
    },
    when: (ctx) => ctx.nearest(['restaurant', 'cafe'], 16) && (ctx.char.partner || ctx.person('friend')),
    cost: () => 80,
    run: (ctx) => {
      const r = ctx.nearest(['restaurant', 'cafe'], 16);
      return ctx.char.partner
        ? o(`{name} and {partner} shared dessert at ${where(r)}.`, { happiness: 5, rel: { partner: 8 } })
        : o(`{name} and {friend} talked for hours over dinner at ${where(r)}.`, { happiness: 5, rel: { friend: 8 } });
    },
  },
  {
    id: 'cinema_night',
    group: 'people',
    minAge: 8,
    label: () => 'Go to the cinema',
    hint: (ctx) => `Cinema at ${addressOf(ctx.nearest('cinema', 16))}`,
    when: (ctx) => ctx.nearest('cinema', 16),
    cost: () => 40,
    run: (ctx, rng) => {
      const t = ctx.nearest('cinema', 16);
      const rel = ctx.char.partner ? { partner: 5 } : ctx.person('friend') ? { friend: 5 } : {};
      return chance(rng, 0.2) ? o(`The film at ${where(t)} was dreadful, but the popcorn was excellent.`, { happiness: 3, rel }) : o(`{name} cried at the ending of the picture at ${where(t)}.`, { happiness: 6, rel });
    },
  },
  {
    id: 'dinner_party',
    group: 'people',
    minAge: 18,
    label: () => 'Host a dinner party',
    hint: () => 'Friends and maybe a new one',
    cost: () => 120,
    run: (ctx, rng) => o('{name} cooked for a full table and the evening ran late.', { happiness: 6, rel: { friend: 5 } }, chance(rng, 0.35) ? { do: (c) => c.addFriend(50) } : {}),
  },
  {
    id: 'mentor',
    group: 'people',
    minAge: 13,
    label: (ctx) => `Learn from ${ctx.neighbour().person}`,
    hint: () => '+Smarts, maybe a friend',
    when: (ctx) => ctx.neighbour(),
    run: (ctx, rng) => {
      const n = ctx.neighbour();
      return o(`${n.person} at ${n.address} taught {name} a trick or two over a cup of tea.`, { smarts: 4, happiness: 3 }, chance(rng, 0.3) ? { do: (c) => c.addFriend(50, n.person) } : {});
    },
  },
  {
    id: 'street_bbq',
    group: 'people',
    minAge: 8,
    label: () => 'Join a street barbecue',
    hint: () => '+Happiness, new faces',
    run: (ctx, rng) => o('The whole street came out with plates and folding chairs, and {name} chatted until dark.', { happiness: 5 }, chance(rng, 0.4) ? { do: (c) => c.addFriend(50) } : {}),
  },

  // Out in the city
  {
    id: 'fountain_wish',
    group: 'out',
    minAge: 3,
    label: () => 'Make a wish at the fountain',
    hint: (ctx) => `Fountain at ${addressOf(ctx.nearest('fountain', 12))}`,
    when: (ctx) => ctx.nearest('fountain', 12),
    run: (ctx) => o(`{name} tossed a coin into the fountain at ${where(ctx.nearest('fountain', 12))} and wished quietly.`, { happiness: 5 }),
  },
  {
    id: 'garden_plot',
    group: 'out',
    minAge: 8,
    label: () => 'Tend a garden plot',
    hint: (ctx) => `Garden at ${addressOf(ctx.nearest('garden', 14))}: +Health`,
    when: (ctx) => ctx.nearest('garden', 14),
    run: (ctx, rng) => {
      const g = ctx.nearest('garden', 14);
      return chance(rng, 0.3) ? o(`{name} grew a pumpkin the size of a wheelbarrow at ${where(g)} and sold the seeds.`, { health: 3, happiness: 4, money: 40 }) : o(`{name} weeded and watered the beds at ${where(g)}.`, { health: 4, happiness: 3 });
    },
  },
  {
    id: 'market_stroll',
    group: 'out',
    minAge: 8,
    label: () => 'Stroll round the market',
    hint: (ctx) => `Market at ${addressOf(ctx.nearest('market', 16))}`,
    when: (ctx) => ctx.nearest('market', 16),
    cost: () => 30,
    run: (ctx, rng) => {
      const m = ctx.nearest('market', 16);
      return chance(rng, 0.25) ? o(`{name} haggled a bargain at ${where(m)}.`, { happiness: 4, money: 20 }) : o(`{name} came home from ${where(m)} with fresh bread and flowers.`, { happiness: 5, health: 1 });
    },
  },
  {
    id: 'match_day',
    group: 'out',
    minAge: 8,
    label: () => 'Watch a match',
    hint: (ctx) => `Stadium at ${addressOf(ctx.nearest('stadium', 18))}`,
    when: (ctx) => ctx.nearest('stadium', 18),
    cost: () => 60,
    run: (ctx, rng) => {
      const s = ctx.nearest('stadium', 18);
      const rel = ctx.person('friend') ? { friend: 5 } : {};
      return chance(rng, 0.5) ? o(`The home side won at ${where(s)} and {name} sang all the way home.`, { happiness: 7, rel }) : o(`A tense draw at ${where(s)}. {name} lost their voice cheering.`, { happiness: 4, rel });
    },
  },
  {
    id: 'picnic',
    group: 'out',
    minAge: 5,
    label: () => 'Have a picnic',
    hint: (ctx) => `Park at ${addressOf(ctx.nearest('park', 12))}`,
    when: (ctx) => ctx.nearest('park', 12) && ctx.city.derived.weather?.season !== 'winter',
    cost: () => 20,
    run: (ctx) => {
      const p = ctx.nearest('park', 12);
      const rel = ctx.char.partner ? { partner: 6 } : ctx.person('friend') ? { friend: 6 } : {};
      return o(`{name} spread a blanket on the lawn at ${where(p)}.`, { happiness: 6, health: 1, rel });
    },
  },
  {
    id: 'bike_ride',
    group: 'out',
    minAge: 7,
    label: () => 'Go on a long bike ride',
    hint: (ctx) => (ctx.nearestWater(8) ? 'By the water: +Health' : '+Health'),
    run: (ctx, rng) => {
      const water = ctx.nearestWater(8);
      if (chance(rng, 0.12)) return o('{name} got a puncture miles from home and pushed the bike back.', { health: 3, happiness: -1 });
      return water ? o('{name} cycled along the water and watched the boats.', { health: 5, happiness: 4 }) : o('{name} pedalled all afternoon through the quiet streets.', { health: 5, happiness: 2 });
    },
  },
  {
    id: 'festival',
    group: 'out',
    minAge: 4,
    label: () => 'Go to the town fair',
    hint: () => 'Music, food and games',
    cost: () => 30,
    run: (ctx, rng) => o('{name} ate too many sweets, won a stuffed bear and danced in the square.', { happiness: 7 }, chance(rng, 0.3) ? { do: (c) => c.addFriend(50) } : {}),
  },

  // Creative
  {
    id: 'paint',
    group: 'create',
    minAge: 5,
    label: () => 'Paint a picture',
    hint: (ctx) => (ctx.has('creative') ? 'Creative: +more' : '+Happiness'),
    run: (ctx, rng) => {
      const gift = ctx.has('creative') ? 2 : 0;
      return chance(rng, 0.15) ? o('{name} spilled the water jar, and the mess became the best picture yet.', { happiness: 4 + gift, looks: 1 }) : o('{name} painted the view from the window and pinned it on the wall.', { happiness: 4 + gift, smarts: 1 });
    },
  },
  {
    id: 'instrument',
    group: 'create',
    minAge: 6,
    label: () => 'Practise an instrument',
    hint: (ctx) => (ctx.has('creative') ? 'Creative: +more' : '+Smarts, +Happiness'),
    run: (ctx, rng) => {
      const gift = ctx.has('creative') ? 2 : 0;
      return chance(rng, 0.2) ? o('The neighbours banged on the wall, but {name} finally nailed the tune.', { smarts: 3 + gift, happiness: 2 }) : o('{name} practised scales every day until a simple song came out clean.', { smarts: 3 + gift, happiness: 3 });
    },
  },
  {
    id: 'write_story',
    group: 'create',
    minAge: 8,
    label: () => 'Write a short story',
    hint: () => '+Smarts, +Happiness',
    run: (ctx, rng) => (chance(rng, 0.2) ? o('{name} read the story aloud and the whole room went quiet.', { smarts: 4, happiness: 5 }) : o('{name} filled a notebook with a tale of dragons and bakers.', { smarts: 3, happiness: 3 })),
  },
  {
    id: 'craft',
    group: 'create',
    minAge: 10,
    label: () => 'Make something in a workshop',
    hint: (ctx) => (ctx.nearest('workshop', 16) ? `Workshop at ${addressOf(ctx.nearest('workshop', 16))}` : '+Smarts'),
    cost: () => 35,
    run: (ctx, rng) => {
      const w = ctx.nearest('workshop', 16);
      const at = w ? ` at ${where(w)}` : ' in the shed';
      return chance(rng, 0.2) ? o(`{name} built a wobbly stool${at}. It held, just.`, { smarts: 3, happiness: 3 }) : o(`{name} spent the weekend${at} making a fine little shelf.`, { smarts: 3, happiness: 4, looks: 1 });
    },
  },
  {
    id: 'photo_walk',
    group: 'create',
    minAge: 9,
    label: () => 'Take a photography walk',
    hint: (ctx) => (ctx.facts.greenery > 0.1 ? 'Green streets: nice light' : '+Happiness'),
    run: (ctx, rng) => (chance(rng, 0.25) ? o('{name} caught a perfect sunset over the rooftops.', { happiness: 6, looks: 1 }) : o('{name} wandered the lanes with a camera and found corners nobody notices.', { happiness: 4, smarts: 1 })),
  },
  {
    id: 'choir',
    group: 'create',
    minAge: 7,
    label: () => 'Join the choir',
    hint: () => '+Happiness, new friends',
    run: (ctx, rng) => o('{name} sang in four-part harmony and made friends in the back row.', { happiness: 6 }, chance(rng, 0.3) ? { do: (c) => c.addFriend(50) } : {}),
  },

  // Work & home
  {
    id: 'side_hustle',
    group: 'money',
    minAge: 16,
    maxAge: 70,
    label: () => 'Start a side hustle',
    hint: () => 'Some money, some stress',
    run: (ctx, rng) => (chance(rng, 0.25) ? o('{name} sold out of handmade candles in a weekend.', { money: 420, happiness: 3, health: -1 }) : o('{name} took odd jobs for neighbours in the evenings.', { money: 220, health: -2, happiness: -1 })),
  },
  {
    id: 'savings',
    group: 'money',
    minAge: 18,
    label: () => 'Open a savings account',
    hint: (ctx) => `Bank at ${addressOf(ctx.nearest('bank', 18))}`,
    when: (ctx) => ctx.nearest('bank', 18),
    run: (ctx) => o(`{name} met the clerk at ${where(ctx.nearest('bank', 18))} and set up a plan to save a little every month.`, { money: 150, smarts: 1 }),
  },
  {
    id: 'hospital_volunteer',
    group: 'money',
    minAge: 16,
    label: () => 'Volunteer at the hospital',
    hint: (ctx) => `Hospital at ${addressOf(ctx.nearest('hospital', 20))}`,
    when: (ctx) => ctx.nearest('hospital', 20),
    run: (ctx, rng) => o(`{name} pushed tea trolleys round the wards at ${where(ctx.nearest('hospital', 20))}.`, { happiness: 5, smarts: 2 }, chance(rng, 0.35) ? { do: (c) => c.addFriend(50) } : {}),
  },
  {
    id: 'network',
    group: 'money',
    minAge: 20,
    maxAge: 62,
    when: (ctx) => ctx.char.job,
    label: () => 'Go to a networking evening',
    hint: () => 'A shot at promotion',
    cost: () => 50,
    run: (ctx, rng) => {
      const c = ctx.char;
      const career = CAREERS[c.job.type];
      const top = c.job.level >= career.titles.length - 1;
      if (!top && c.job.years >= 1 && chance(rng, 0.15 + c.stats.smarts / 500)) {
        return o(`A chat over canapés led to an offer: {name} is now ${career.titles[c.job.level + 1].toLowerCase()}.`, { happiness: 6 }, { do: (x) => ((x.char.job.level += 1), (x.char.job.years = 0)) });
      }
      return o('{name} shook many hands and collected a stack of business cards.', { happiness: 2, smarts: 1 });
    },
  },
  {
    id: 'diy',
    group: 'money',
    minAge: 18,
    when: (ctx) => ctx.char.home,
    label: () => 'Fix up the house',
    hint: () => '+Happiness',
    cost: () => 90,
    run: (ctx, rng) => (chance(rng, 0.2) ? o('{name} painted the hall twice, the second time on purpose.', { happiness: 3 }) : o('{name} mended the fence, oiled the hinges and repainted the door.', { happiness: 5, looks: 1 })),
  },
  {
    id: 'read_kinder',
    group: 'money',
    minAge: 15,
    label: () => 'Read to the little ones',
    hint: (ctx) => `Kindergarten at ${addressOf(ctx.nearest('kindergarten', 16))}`,
    when: (ctx) => ctx.nearest('kindergarten', 16),
    run: (ctx, rng) => o(`{name} read picture books to the children at ${where(ctx.nearest('kindergarten', 16))}, doing all the voices.`, { happiness: 6, smarts: 1 }, chance(rng, 0.3) ? { do: (c) => c.addFriend(50) } : {}),
  },
];
