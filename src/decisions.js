// Town decisions: every couple of in-game days the town asks you to choose. Each choice has its own
// effects, good and bad, on how the town grows:
//   cost / gain     money from the town budget
//   growth          the town grows faster or slower for a few days (×1.4 for 5 days…)
//   spirit          homes everywhere feel nicer or worse for a while (Town spirit in the inspector)
//   hurry           the next era comes this many years sooner
//   tax             resident taxes go up or down from now on
//   build           something is built (a gift: free)
//   trees           woods cleared (negative) or planted (positive)
//   fun             townsfolk get a lift
// An unanswered question goes with its last choice after a day. Decisions are plain data: add one to
// DECISIONS with `when(ctx)` (is it a fitting moment?) and two or three `choices`.
//
// Saved in city.systems.decisions = { pending, next, seen, effects, taxRate, made }.

import { addChronicle } from './chronicle.js';
import { clamp, pickWeighted } from './utils.js';

const day = (city) => city.day + city.clock;
const has = (ctx, type) => ctx.city.tiles.some((t) => t.structure?.type === type);
const nearWater = (ctx) => ctx.city.tiles.some((t) => t.terrain === 'water');

export const DECISIONS = [
  // ---- Pioneer days ----
  {
    id: 'well',
    era: [0, 0],
    once: true,
    title: 'A proper town well?',
    text: 'The settlers are tired of hauling water from the river. They ask for a stone well in the square.',
    choices: [
      { label: 'Dig the well', cost: 400, spirit: [0.06, 6], growth: [1.2, 4], result: 'The town dug a stone well in the square.' },
      { label: 'Make do', spirit: [-0.03, 4], result: 'The settlers kept hauling water from the river.' },
    ],
  },
  {
    id: 'woods',
    era: [0, 1],
    title: 'Clear the old woods?',
    text: 'Families want the woods near town cleared for farms and new homes. Others love their walks under the trees.',
    when: (ctx) => ctx.city.tiles.filter((t) => t.structure?.type === 'tree').length > 20,
    choices: [
      { label: 'Clear them', trees: -8, growth: [1.4, 5], spirit: [-0.04, 8], result: 'The old woods were cleared for farms and homes.' },
      { label: 'Protect the woods', growth: [0.85, 4], spirit: [0.04, 8], result: 'The town protected its old woods.' },
    ],
  },
  {
    id: 'festival',
    era: [0, 4],
    title: 'Harvest festival',
    text: 'The harvest is in. Should the town throw a festival in the square?',
    when: (ctx) => ctx.season === 'autumn' || ctx.season === 'summer',
    choices: [
      { label: 'Throw a festival', cost: 300, fun: 0.4, spirit: [0.05, 3], result: 'The whole town danced at the harvest festival.' },
      { label: 'Save the money', result: 'The town skipped the festival this year.' },
    ],
  },
  {
    id: 'newcomers',
    era: [0, 2],
    title: 'Newcomers at the gate',
    text: 'A wagon train of families asks to settle here. There may not be work for everyone at first.',
    choices: [
      { label: 'Welcome them', growth: [1.6, 3], spirit: [-0.02, 3], result: 'The town welcomed a wagon train of new families.' },
      { label: 'Turn them away', growth: [0.7, 3], result: 'The town turned the newcomers away.' },
    ],
  },
  // ---- Railway age ----
  {
    id: 'railway',
    era: [1, 1],
    once: true,
    title: 'The railway is coming',
    text: 'A railway company will run a line to town if we help pay for the station.',
    choices: [
      { label: 'Pay for the station', cost: 1500, hurry: 6, growth: [1.3, 6], result: 'The first train steamed into the new station.' },
      { label: 'Let it pass us by', growth: [0.9, 4], result: 'The railway went to the next town instead.' },
    ],
  },
  {
    id: 'mill',
    era: [1, 2],
    title: 'A mill on the edge of town',
    text: 'An industrialist wants to build a mill. It means jobs and money for the land, and smoke.',
    choices: [
      { label: 'Accept the offer', gain: 500, build: ['factory', 'edge'], spirit: [-0.02, 6], result: 'A mill went up on the edge of town.' },
      { label: 'Refuse', spirit: [0.02, 4], result: 'The town said no to the mill.' },
    ],
  },
  {
    id: 'gaslights',
    era: [1, 1],
    once: true,
    title: 'Gas lamps for the high street?',
    text: 'Gas lamps would make the evenings safer and brighter.',
    choices: [
      { label: 'Light the streets', cost: 800, spirit: [0.05, 8], result: 'Gas lamps lit the high street for the first time.' },
      { label: 'Lanterns will do', result: 'The streets stayed lantern-lit.' },
    ],
  },
  {
    id: 'schoolhouse',
    era: [0, 3],
    title: 'A bigger schoolhouse',
    text: 'Parents say the children have too far to walk to school.',
    when: (ctx) => ctx.city.homes().filter((h) => h.structure.residents > 0 && (h.coverage?.school || 0) < 0.1).length >= 4,
    choices: [
      { label: 'Build a school', cost: 1200, build: ['school', 'center'], spirit: [0.03, 5], result: 'A new schoolhouse opened its doors.' },
      { label: 'Not this year', spirit: [-0.03, 4], result: 'The school would have to wait.' },
    ],
  },
  // ---- Motor age ----
  {
    id: 'paving',
    era: [2, 2],
    once: true,
    title: 'Pave the roads?',
    text: 'Motor cars are rattling over the cobbles. Paving the streets would bring more business.',
    choices: [
      { label: 'Pave them', cost: 1200, hurry: 5, growth: [1.2, 6], result: 'The town paved its streets for motor cars.' },
      { label: 'Keep the cobbles', growth: [0.9, 4], spirit: [0.02, 6], result: 'The town kept its charming cobbles.' },
    ],
  },
  {
    id: 'taxes',
    era: [1, 4],
    title: 'The council debates taxes',
    text: 'Raise taxes to fill the treasury, or cut them to draw more families?',
    choices: [
      { label: 'Raise taxes', tax: 1.2, growth: [0.8, 6], spirit: [-0.04, 6], result: 'The council raised taxes.' },
      { label: 'Cut taxes', tax: 0.85, growth: [1.3, 6], spirit: [0.03, 6], result: 'The council cut taxes.' },
      { label: 'Leave them', result: 'Taxes stayed as they were.' },
    ],
  },
  {
    id: 'grandpark',
    era: [2, 4],
    title: 'A gift of land',
    text: 'A wealthy family offers land in town for a park, or the town could sell it for houses.',
    choices: [
      { label: 'Make it a park', build: ['park', 'center'], spirit: [0.04, 6], result: 'A grand new park opened in town.' },
      { label: 'Sell it', gain: 1000, growth: [1.2, 4], result: 'The land was sold for new houses.' },
    ],
  },
  // ---- Modern times ----
  {
    id: 'highway',
    era: [3, 3],
    once: true,
    title: 'A highway through downtown?',
    text: 'The state offers a highway. Business would boom, but downtown would be noisier.',
    choices: [
      { label: 'Build it', hurry: 5, growth: [1.4, 8], spirit: [-0.05, 10], result: 'The new highway opened through downtown.' },
      { label: 'Keep downtown quiet', spirit: [0.03, 8], result: 'The town said no to the highway.' },
    ],
  },
  {
    id: 'towers',
    era: [3, 4],
    title: 'Developers want to build high',
    text: 'Developers want to put up tall towers. Some residents worry about the skyline.',
    choices: [
      { label: 'Let them build', growth: [1.5, 5], spirit: [-0.02, 5], result: 'Towers began to rise over downtown.' },
      { label: 'Height limit', growth: [0.85, 5], spirit: [0.03, 8], result: 'The town set a height limit.' },
    ],
  },
  {
    id: 'concert',
    era: [2, 4],
    title: 'Summer music festival',
    text: 'Bands from all over want to play a weekend festival in the park.',
    when: (ctx) => has(ctx, 'park') && ctx.season === 'summer',
    choices: [
      { label: 'Host it', cost: 1500, fun: 0.5, spirit: [0.06, 4], growth: [1.15, 4], result: 'Thousands came for the summer music festival.' },
      { label: 'Not this year', result: 'The park stayed quiet this summer.' },
    ],
  },
  // ---- Bright future ----
  {
    id: 'solar',
    era: [4, 4],
    once: true,
    title: 'Solar roofs for everyone?',
    text: 'The town could help every home put solar panels on its roof.',
    choices: [
      { label: 'Fund solar roofs', cost: 3000, spirit: [0.06, 12], result: 'Solar panels went up on roofs all over town.' },
      { label: 'Maybe later', result: 'The town put off the solar plan.' },
    ],
  },
  {
    id: 'gardens',
    era: [3, 4],
    title: 'Community gardens',
    text: 'Residents want to plant gardens and trees on empty lots.',
    choices: [
      { label: 'Plant them', cost: 600, trees: 6, spirit: [0.05, 8], result: 'Neighbours planted community gardens.' },
      { label: 'Keep the lots for building', growth: [1.15, 4], result: 'The empty lots were kept for building.' },
    ],
  },
  // ---- Weather ----
  {
    id: 'buildingcode',
    era: [1, 4],
    once: true,
    title: 'Storm-proof building rules?',
    text: 'After the last bad weather, builders suggest stronger frames, roofs and foundations for every building.',
    when: (ctx) => (ctx.city.systems.disasters?.log || []).length > 0,
    choices: [
      { label: 'Adopt the rules', cost: 1500, resilience: 0.6, growth: [0.9, 4], result: 'The town adopted storm-proof building rules.' },
      { label: 'Too expensive', result: 'The town kept its old building rules.' },
    ],
  },
  {
    id: 'levee',
    era: [1, 4],
    once: true,
    title: 'A flood wall along the river?',
    text: 'Families by the water ask for a wall to keep floods out.',
    when: (ctx) => nearWater(ctx) && (ctx.city.systems.disasters?.log || []).some((e) => e.kind === 'flood' || e.kind === 'hurricane'),
    choices: [
      { label: 'Build the wall', cost: 2000, levee: true, spirit: [0.03, 6], result: 'A flood wall went up along the river.' },
      { label: 'Not now', spirit: [-0.02, 4], result: 'The riverside stayed unprotected.' },
    ],
  },
  ...['flood', 'tornado', 'hurricane'].map((kind) => ({
    id: `prepare-${kind}`,
    manual: true, // only asked when the disasters system warns of one
    era: [0, 4],
    title: { flood: 'Flood warning!', tornado: 'Tornado warning!', hurricane: 'Hurricane warning!' }[kind],
    text: {
      flood: 'The river is rising fast and will burst its banks within hours.',
      tornado: 'A funnel cloud has been spotted heading for town.',
      hurricane: 'A hurricane is heading straight for the town.',
    }[kind],
    choices: [
      { label: { flood: 'Sandbag the riverbanks', tornado: 'Board up and take shelter', hurricane: 'Board up the town' }[kind], cost: { flood: 500, tornado: 400, hurricane: 800 }[kind], prepare: true, result: 'The town got ready for the storm. Damage should be halved.' },
      { label: 'Ride it out', result: 'The town waited for the weather to pass.' },
    ],
  })),
  // ---- Any time ----
];
export const decisionById = (id) => DECISIONS.find((d) => d.id === id);

// Short tags describing what a choice does, for the card.
export function effectTags(c) {
  const tags = [];
  if (c.cost) tags.push({ text: `−$${c.cost.toLocaleString()}`, tone: 'bad' });
  if (c.gain) tags.push({ text: `+$${c.gain.toLocaleString()}`, tone: 'good' });
  if (c.growth) tags.push({ text: c.growth[0] >= 1 ? 'Faster growth' : 'Slower growth', tone: c.growth[0] >= 1 ? 'good' : 'bad' });
  if (c.spirit) tags.push({ text: c.spirit[0] >= 0 ? 'Happier homes' : 'Unhappier homes', tone: c.spirit[0] >= 0 ? 'good' : 'bad' });
  if (c.hurry) tags.push({ text: 'Next era sooner', tone: 'good' });
  if (c.tax) tags.push({ text: c.tax > 1 ? 'More tax money' : 'Less tax money', tone: c.tax > 1 ? 'good' : 'bad' });
  if (c.build) tags.push({ text: `New ${c.build[0] === 'factory' ? 'mill' : c.build[0]}`, tone: 'good' });
  if (c.trees) tags.push({ text: c.trees > 0 ? 'More trees' : 'Fewer trees', tone: c.trees > 0 ? 'good' : 'bad' });
  if (c.fun) tags.push({ text: 'Townsfolk cheer up', tone: 'good' });
  if (c.prepare) tags.push({ text: 'Half the damage', tone: 'good' });
  if (c.resilience) tags.push({ text: 'Storms do less damage', tone: 'good' });
  if (c.levee) tags.push({ text: 'Floods kept out', tone: 'good' });
  return tags;
}

export class Decisions {
  constructor(city, { economy, growth, eras, townsfolk, rng = Math.random } = {}) {
    this.city = city;
    this.economy = economy;
    this.growth = growth;
    this.eras = eras;
    this.townsfolk = townsfolk;
    this.rng = rng;
  }

  get state() {
    const s = this.city.systems;
    if (!s.decisions) s.decisions = { pending: null, next: day(this.city) + 1, seen: {}, effects: [], taxRate: 1, made: 0 };
    return s.decisions;
  }

  get pending() {
    const p = this.state.pending;
    return p ? { ...p, decision: decisionById(p.id) } : null;
  }

  // Called each simulation tick: keeps effects current, asks new questions, and lets old ones lapse.
  update() {
    const st = this.state;
    const now = day(this.city);
    st.effects = st.effects.filter((e) => e.until > now);
    this.city.derived.spirit = clamp(st.effects.reduce((s, e) => s + e.amount, 0), -0.15, 0.15);
    // Older saves kept a tax multiplier here; it is now the income tax rate (economy.js).
    if (st.taxRate !== 1 && this.economy) {
      this.economy.setTaxRate(this.economy.taxRate * st.taxRate);
      st.taxRate = 1;
    }
    if (st.pending) {
      if (now - st.pending.day >= 1) this.choose(decisionById(st.pending.id).choices.length - 1, { lapsed: true });
      return null;
    }
    if (now < st.next || (this.city.stats?.population || 0) < 8) return null;
    return this.ask();
  }

  ctx() {
    const w = this.city.derived.weather;
    return { city: this.city, era: this.eras ? this.eras.index : 0, season: w?.season || 'spring' };
  }

  // Pick a fitting question that hasn't come up lately.
  ask(forceId = null) {
    const st = this.state;
    const ctx = this.ctx();
    const now = day(this.city);
    const fits = DECISIONS.filter((d) => {
      if (forceId) return d.id === forceId;
      if (d.manual) return false;
      if (ctx.era < d.era[0] || ctx.era > d.era[1]) return false;
      const seen = st.seen[d.id];
      if (seen != null && (d.once || now - seen < 10)) return false;
      return !d.when || d.when(ctx);
    });
    const d = pickWeighted(fits, (x) => (x.once ? 2 : 1), this.rng);
    if (!d) {
      st.next = now + 0.5;
      return null;
    }
    st.pending = { id: d.id, day: now };
    st.seen[d.id] = now;
    this.city.emit('decision', { decision: d });
    return d;
  }

  canAfford(choice) {
    return !choice.cost || !this.economy || this.economy.sandbox || this.economy.money >= choice.cost;
  }

  // Apply a choice's effects. Returns a short summary for the toast.
  choose(index, { lapsed = false } = {}) {
    const st = this.state;
    const d = st.pending && decisionById(st.pending.id);
    if (!d) return null;
    let c = d.choices[index];
    if (!c) return null;
    if (!this.canAfford(c)) c = d.choices[d.choices.length - 1]; // can't pay: the cheapest path
    const now = day(this.city);
    const eco = this.economy;
    if (c.cost && eco && !eco.sandbox) eco.spend(c.cost);
    if (c.gain && eco) eco.refund(c.gain);
    if (c.growth && this.growth) this.growth.boost(c.growth[0], c.growth[1], d.title);
    if (c.spirit) st.effects.push({ amount: c.spirit[0], until: now + c.spirit[1], id: d.id });
    if (c.hurry && this.eras) this.eras.hurry(c.hurry);
    if (c.tax && eco) eco.setTaxRate(eco.taxRate * c.tax);
    if (c.build && this.growth) this.growth.buildType(c.build[0], { where: c.build[1], free: true });
    if (c.trees && this.growth) {
      if (c.trees < 0) this.growth.clearTrees(-c.trees);
      else this.growth.plantTrees(c.trees);
    }
    if (c.prepare) this.disasters?.prepare();
    if (c.resilience) this.city.systems.disasters && (this.city.systems.disasters.resilience = c.resilience);
    if (c.levee && this.city.systems.disasters) this.city.systems.disasters.levee = true;
    if (c.fun && this.townsfolk) {
      for (const p of this.townsfolk.people) {
        p.needs.fun = clamp(p.needs.fun + c.fun, 0, 1);
        p.needs.social = clamp(p.needs.social + c.fun / 2, 0, 1);
      }
    }
    st.pending = null;
    st.made = (st.made || 0) + 1;
    st.next = now + 1.5 + this.rng() * 1.2;
    this.city.dirty = true;
    addChronicle(this.city, lapsed ? `${c.result} (No decision was made in time.)` : c.result, null, 'decision');
    this.city.emit('decided', { decision: d, choice: c, lapsed });
    return { decision: d, choice: c, lapsed };
  }
}
