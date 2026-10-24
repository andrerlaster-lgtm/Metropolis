// Town upgrades: a skill tree for your town. The town earns points by growing (one to start, one for
// each new town title, one for every 50 residents at its biggest) and spends them on upgrades in four
// branches: Treasury (money), Wellbeing (happiness), Services & growth, and Defence (the military
// base). An upgrade needs one of the upgrades listed before it in its branch. Points can be taken
// back at any time for free: one upgrade at a time (when nothing learned after it depends on it), or
// all at once.
//
// Saved in city.systems.skills = { v, learned: [ids], peak } where peak is the most residents the
// town has had, so points never go away when people move out. Pure rules, no screen (skillsUI.js).
//
// Every other system reads the combined effects from city.derived.skills (filled in by the
// simulation): economy.js (taxes, costs, upkeep, the bonds), desirability.js (how much parks,
// traffic, smoke and sport count, plus a flat happiness bonus), coverage.js (how far services
// reach), labor.js (jobs), simulation.js (how many people homes hold, how fast newcomers arrive)
// and military.js (training, defence costs, repairs, pay, recovery, veterans).

import { MILESTONES } from './config.js';

export const SKILLS_VERSION = 1;
export const START_POINTS = 1;
export const RESIDENTS_PER_POINT = 50;

export const BRANCHES = [
  { id: 'treasury', label: 'Treasury', blurb: 'More money in, less going out' },
  { id: 'wellbeing', label: 'Wellbeing', blurb: 'Happier homes' },
  { id: 'services', label: 'Services & growth', blurb: 'Services reach further, homes and jobs grow' },
  { id: 'defence', label: 'Defence', blurb: 'A stronger, cheaper military base' },
];

// Tier 1 needs nothing; every later upgrade needs any one of `needs`. Tier 4 upgrades cost 2 points.
// `fx` says what the upgrade does; effects() combines them.
export const SKILLS = [
  // Treasury
  { id: 'taxOffice', branch: 'treasury', tier: 1, name: 'Tax office', text: 'Home taxes bring in 10% more.', fx: { residentTax: 1.1 } },
  { id: 'marketDays', branch: 'treasury', tier: 2, needs: ['taxOffice'], name: 'Market days', text: 'Businesses pay 15% more tax.', fx: { businessTax: 1.15 } },
  { id: 'thrifty', branch: 'treasury', tier: 2, needs: ['taxOffice'], name: 'Thrifty builders', text: 'Building costs 10% less.', fx: { buildCost: 0.9 } },
  { id: 'tradeFair', branch: 'treasury', tier: 3, needs: ['marketDays'], name: 'Trade fair', text: 'Businesses pay another 15% more tax.', fx: { businessTax: 1.15 } },
  { id: 'crews', branch: 'treasury', tier: 3, needs: ['thrifty'], name: 'Maintenance crews', text: 'Upkeep of roads, schools, parks and services costs 20% less.', fx: { upkeep: 0.8 } },
  { id: 'bonds', branch: 'treasury', tier: 4, cost: 2, needs: ['tradeFair', 'crews'], name: 'Town bonds', text: 'A steady income of $25 a day, plus 25¢ for every resident.', fx: { grantBase: 25, grantPerResident: 0.25 } },
  // Wellbeing
  { id: 'gardeners', branch: 'wellbeing', tier: 1, name: 'Town gardeners', text: 'Parks and trees make homes 25% nicer.', fx: { greenery: 1.25 } },
  { id: 'quietStreets', branch: 'wellbeing', tier: 2, needs: ['gardeners'], name: 'Quiet streets', text: 'Busy roads bother homes 40% less.', fx: { traffic: 0.6 } },
  { id: 'cleanAir', branch: 'wellbeing', tier: 2, needs: ['gardeners'], name: 'Clean air rules', text: 'Factory smoke bothers homes 40% less.', fx: { pollution: 0.6 } },
  { id: 'festivals', branch: 'wellbeing', tier: 3, needs: ['quietStreets'], name: 'Festivals', text: 'Every home is 3% happier.', fx: { happy: 0.03 } },
  { id: 'sportForAll', branch: 'wellbeing', tier: 3, needs: ['cleanAir'], name: 'Sport for all', text: 'Playgrounds and sports fields make homes 50% nicer.', fx: { entertainment: 1.5 } },
  { id: 'civicPride', branch: 'wellbeing', tier: 4, cost: 2, needs: ['festivals', 'sportForAll'], name: 'Civic pride', text: 'Every home is another 5% happier.', fx: { happy: 0.05 } },
  // Services & growth
  { id: 'catchments', branch: 'services', tier: 1, name: 'Wider catchments', text: 'Schools and clinics reach 1 tile further.', fx: { radius: { school: 1, health: 1 } } },
  { id: 'roomyHomes', branch: 'services', tier: 2, needs: ['catchments'], name: 'Roomier homes', text: 'Homes hold 10% more people.', fx: { capacity: 1.1 } },
  { id: 'hubs', branch: 'services', tier: 2, needs: ['catchments'], name: 'Business hubs', text: 'Workplaces offer 10% more jobs.', fx: { jobs: 1.1 } },
  { id: 'playStreets', branch: 'services', tier: 3, needs: ['roomyHomes'], name: 'Play streets', text: 'Playgrounds and sports fields reach 1 tile further.', fx: { radius: { fun: 1 } } },
  { id: 'fireDrills', branch: 'services', tier: 3, needs: ['hubs'], name: 'Fire drills', text: 'Fire stations reach 2 tiles further.', fx: { radius: { fire: 2 } } },
  { id: 'welcome', branch: 'services', tier: 4, cost: 2, needs: ['playStreets', 'fireDrills'], name: 'Welcome centre', text: 'Newcomers move in 50% faster.', fx: { moveIn: 1.5 } },
  // Defence
  { id: 'drill', branch: 'defence', tier: 1, name: 'Drill sergeants', text: 'Recruits train 30% faster.', fx: { train: 0.7 } },
  { id: 'engineers', branch: 'defence', tier: 2, needs: ['drill'], name: 'Army engineers', text: 'Defences and their upgrades cost 20% less.', fx: { defenceCost: 0.8 } },
  { id: 'fieldHospital', branch: 'defence', tier: 2, needs: ['drill'], name: 'Field hospital', text: 'Wounded soldiers recover 40% faster.', fx: { recovery: 0.6 } },
  { id: 'repairCrews', branch: 'defence', tier: 3, needs: ['engineers'], name: 'Repair crews', text: 'The base is repaired 50% faster.', fx: { repair: 1.5 } },
  { id: 'quartermaster', branch: 'defence', tier: 3, needs: ['fieldHospital'], name: 'Quartermaster', text: 'Soldiers’ pay costs 20% less.', fx: { pay: 0.8 } },
  { id: 'veterans', branch: 'defence', tier: 4, cost: 2, needs: ['repairCrews', 'quartermaster'], name: 'Veteran instructors', text: 'New recruits start as Corporals.', fx: { veteranXp: 40 } },
];

export const SKILL = Object.fromEntries(SKILLS.map((s) => [s.id, s]));
export const costOf = (id) => SKILL[id]?.cost || 1;

const MULTIPLY = ['residentTax', 'businessTax', 'buildCost', 'upkeep', 'greenery', 'traffic', 'pollution', 'entertainment', 'capacity', 'jobs', 'moveIn', 'train', 'defenceCost', 'repair', 'pay', 'recovery'];
const ADD = ['grantBase', 'grantPerResident', 'happy', 'veteranXp'];

// What no upgrades at all do: nothing.
export function noEffects() {
  const fx = { radius: { school: 0, health: 0, fun: 0, fire: 0 } };
  for (const k of MULTIPLY) fx[k] = 1;
  for (const k of ADD) fx[k] = 0;
  return fx;
}

// The combined effects of a list of learned upgrades.
export function effectsOf(learned) {
  const fx = noEffects();
  for (const id of learned) {
    const s = SKILL[id];
    if (!s) continue;
    for (const [k, v] of Object.entries(s.fx)) {
      if (k === 'radius') for (const [svc, r] of Object.entries(v)) fx.radius[svc] = (fx.radius[svc] || 0) + r;
      else if (MULTIPLY.includes(k)) fx[k] *= v;
      else fx[k] += v;
    }
  }
  return fx;
}

export class Skills {
  constructor(city) {
    this.city = city;
  }

  // Lazily created, so older saves start with the points their town has already earned.
  get state() {
    const s = this.city.systems;
    if (!s.skills || typeof s.skills !== 'object') s.skills = { v: SKILLS_VERSION, learned: [], peak: 0 };
    const st = s.skills;
    if (!Array.isArray(st.learned)) st.learned = [];
    st.learned = st.learned.filter((id, i, a) => SKILL[id] && a.indexOf(id) === i);
    if (!Number.isFinite(st.peak)) st.peak = 0;
    st.peak = Math.max(st.peak, this.city.stats?.population || 0);
    return st;
  }

  get learned() {
    return this.state.learned;
  }

  has(id) {
    return this.learned.includes(id);
  }

  // Points the town has earned: one to start, one per town title past the first, one per 50 residents.
  earned() {
    const st = this.state;
    const reached = Math.max(0, Math.min(MILESTONES.length - 1, this.city.systems.milestones?.reached || 0));
    return START_POINTS + reached + Math.floor(st.peak / RESIDENTS_PER_POINT);
  }

  spent() {
    return this.learned.reduce((n, id) => n + costOf(id), 0);
  }

  available() {
    return Math.max(0, this.earned() - this.spent());
  }

  // Residents still needed for the next point from growth.
  toNextPoint() {
    const peak = this.state.peak;
    return (Math.floor(peak / RESIDENTS_PER_POINT) + 1) * RESIDENTS_PER_POINT - peak;
  }

  // Why an upgrade can't be learned now, or null when it can.
  learnError(id) {
    const s = SKILL[id];
    if (!s) return 'No such upgrade';
    if (this.has(id)) return 'Already yours';
    if (s.needs && !s.needs.some((n) => this.has(n))) return `Needs ${s.needs.map((n) => SKILL[n].name).join(' or ')} first`;
    const c = costOf(id);
    if (this.available() < c) return c > 1 ? `Needs ${c} points` : 'Needs a point';
    return null;
  }

  learn(id) {
    const err = this.learnError(id);
    if (err) return { error: err };
    this.state.learned.push(id);
    return { learned: id };
  }

  // An upgrade can be taken back when nothing learned after it would be left without what it needs.
  forgetError(id) {
    if (!this.has(id)) return 'Not learned';
    const rest = this.learned.filter((x) => x !== id);
    const stranded = rest.find((x) => SKILL[x].needs && !SKILL[x].needs.some((n) => rest.includes(n)));
    return stranded ? `${SKILL[stranded].name} needs it. Take that back first` : null;
  }

  forget(id) {
    const err = this.forgetError(id);
    if (err) return { error: err };
    this.state.learned = this.learned.filter((x) => x !== id);
    return { forgot: id };
  }

  // Take every point back, for free.
  reset() {
    const n = this.learned.length;
    this.state.learned = [];
    return n;
  }

  effects() {
    return effectsOf(this.learned);
  }

  // Call after stats update. Returns how many points were just earned (0 most of the time).
  update() {
    const now = this.earned(); // reading the state raises the peak
    const before = this._last ?? now;
    this._last = now;
    return Math.max(0, now - before);
  }
}
