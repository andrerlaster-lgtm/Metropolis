// Town upgrades: a skill tree for your town. The town earns points as it grows and as its family line
// goes on, and spends them on upgrades in eight branches of seven tiers.
//
// Points: one to start, one for each town title past the first, one for every 20 residents at the
// town's biggest (12 on a small map), one for each new era, and one for each new generation of your
// family (up to 10). Measured against how big towns really get (a town left to grow by itself levels
// off near 180 residents on a small map, 480 on a medium one and 770 on a large one), a whole game
// over many generations earns roughly a third of the tree on a small map, two fifths on a medium
// one and half on a large one; densely built towns earn more.
// Two upgrades earn more points (Founding families, Boom town). Points never go away.
//
// Tiers: tier 1 needs nothing; every later upgrade needs any one of `needs`. Tiers 3 and 4 need the
// Village title, tiers 5 and 6 the Town title, and the tier-7 milestone of each branch the City title
// or the third generation of your family. Each branch has one fork at tier 5: two upgrades that
// `exclude` each other, so you choose (and can change your mind for free). Some upgrades have their
// own `gate` (a generation).
//
// Points can be taken back at any time for free: one upgrade at a time (when nothing learned after
// it depends on it), or all at once.
//
// Saved in city.systems.skills = { v, learned: [ids], peak, peakEra, peakGen }: the most residents,
// the latest era and the latest generation the town has seen, so points never go away. Pure rules,
// no screen (skillsUI.js).
//
// Every other system reads the combined effects from city.derived.skills (filled in by the
// simulation): economy.js (taxes by kind of building, costs, upkeep, bonds, savings interest),
// desirability.js (how much each kind of nearby thing counts, plus a flat happiness bonus),
// reputation.js, coverage.js (how far services reach and how many residents they serve), labor.js
// (jobs, road capacity), simulation.js (homes, newcomers), growth.js (how fast the town builds
// itself), notables.js, disasters.js (damage, warnings, repairs), military.js and warRoom.js (the
// base and raid warnings), mayor.js (duties, skills, succession) and diplomacy.js (grievances).

import { MILESTONES } from './config.js';

export const SKILLS_VERSION = 2;
export const START_POINTS = 1;
export const RESIDENTS_PER_POINT = 20;
// Small maps (16 × 16) hold far fewer people, so their residents earn points faster.
export const RESIDENTS_PER_POINT_SMALL = 12;
export const SMALL_MAP_TILES = 16 * 16;
export const GEN_POINTS_MAX = 10;

export const BRANCHES = [
  { id: 'treasury', label: 'Treasury', icon: '$', blurb: 'More money in, less going out' },
  { id: 'wellbeing', label: 'Wellbeing', icon: '☺', blurb: 'Happier homes and a good name' },
  { id: 'housing', label: 'Housing & Growth', icon: '⌂', blurb: 'More homes, more newcomers, faster growth' },
  { id: 'services', label: 'Education & Services', icon: '✚', blurb: 'Schools, clinics and fire stations that reach and serve more' },
  { id: 'infrastructure', label: 'Infrastructure', icon: '⛭', blurb: 'Roads that flow, a town that weathers storms' },
  { id: 'industry', label: 'Industry & Commerce', icon: '⚒', blurb: 'More jobs and busier businesses' },
  { id: 'defence', label: 'Defence', icon: '⛨', blurb: 'A stronger, cheaper military base' },
  { id: 'leadership', label: 'Leadership & Legacy', icon: '♛', blurb: 'Better mayors, smoother successions, a lasting family name' },
];

// Town titles (config.js MILESTONES index) each tier needs; tier 7 also opens with the third generation.
export const TIER_TITLE = [0, 0, 0, 1, 1, 2, 2, 3];
export const MILESTONE_GEN = 3;
// Points for a tier when an upgrade doesn't say: cheap at the start, dearer near the top.
export const TIER_COST = [0, 1, 1, 2, 2, 3, 3, 4];

const S = (o) => o;
// `fx` says what the upgrade does; effects() combines them. `text` must say exactly what fx does.
export const SKILLS = [
  // ---- Treasury ------------------------------------------------------------------------------------
  S({ id: 'taxOffice', branch: 'treasury', tier: 1, name: 'Tax office', text: 'Home taxes bring in 10% more.', fx: { residentTax: 1.1 } }),
  S({ id: 'marketDays', branch: 'treasury', tier: 2, cost: 1, needs: ['taxOffice'], name: 'Market days', text: 'Businesses pay 15% more tax.', fx: { businessTax: 1.15 } }),
  S({ id: 'thrifty', branch: 'treasury', tier: 2, cost: 1, needs: ['taxOffice'], name: 'Thrifty builders', text: 'Building costs 10% less.', fx: { buildCost: 0.9 } }),
  S({ id: 'tradeFair', branch: 'treasury', tier: 3, cost: 1, needs: ['marketDays'], name: 'Trade fair', text: 'Businesses pay another 15% more tax.', fx: { businessTax: 1.15 } }),
  S({ id: 'crews', branch: 'treasury', tier: 3, cost: 1, needs: ['thrifty'], name: 'Maintenance crews', text: 'Upkeep of roads, schools, parks and services costs 20% less.', fx: { upkeep: 0.8 } }),
  S({ id: 'bonds', branch: 'treasury', tier: 4, cost: 2, needs: ['tradeFair', 'crews'], name: 'Town bonds', text: 'A steady income of $25 a day, plus 25¢ for every resident.', fx: { grantBase: 25, grantPerResident: 0.25 } }),
  S({ id: 'charter', branch: 'treasury', tier: 5, needs: ['bonds'], excludes: ['relief'], name: 'Merchants’ charter', text: 'Businesses pay 12% more tax, but home taxes bring in 6% less.', fx: { businessTax: 1.12, residentTax: 0.94 } }),
  S({ id: 'relief', branch: 'treasury', tier: 5, needs: ['bonds'], excludes: ['charter'], name: 'Homestead relief', text: 'Home taxes bring in 8% less, and every home is 2% happier.', fx: { residentTax: 0.92, happy: 0.02 } }),
  S({ id: 'savingsBank', branch: 'treasury', tier: 6, needs: ['charter', 'relief'], name: 'Savings bank', text: 'The treasury earns 0.5% a day on the money it holds, up to $150 a day.', fx: { interest: 0.005, interestCap: 150 } }),
  S({ id: 'mint', branch: 'treasury', tier: 7, needs: ['savingsBank'], milestone: true, name: 'Town mint', text: 'Town bonds pay 50% more, and the mayor’s fundraisers raise 25% more.', fx: { bondsMult: 1.5, fundraiser: 1.25 } }),

  // ---- Wellbeing -----------------------------------------------------------------------------------
  S({ id: 'gardeners', branch: 'wellbeing', tier: 1, name: 'Town gardeners', text: 'Parks and trees make homes 25% nicer.', fx: { greenery: 1.25 } }),
  S({ id: 'quietStreets', branch: 'wellbeing', tier: 2, cost: 1, needs: ['gardeners'], name: 'Quiet streets', text: 'Busy roads bother homes 40% less.', fx: { traffic: 0.6 } }),
  S({ id: 'cleanAir', branch: 'wellbeing', tier: 2, cost: 1, needs: ['gardeners'], name: 'Clean air rules', text: 'Factory smoke bothers homes 40% less.', fx: { pollution: 0.6 } }),
  S({ id: 'festivals', branch: 'wellbeing', tier: 3, cost: 1, needs: ['quietStreets'], name: 'Festivals', text: 'Every home is 3% happier.', fx: { happy: 0.03 } }),
  S({ id: 'sportForAll', branch: 'wellbeing', tier: 3, cost: 1, needs: ['cleanAir'], name: 'Sport for all', text: 'Playgrounds and sports fields make homes 50% nicer.', fx: { entertainment: 1.5 } }),
  S({ id: 'civicPride', branch: 'wellbeing', tier: 4, cost: 2, needs: ['festivals', 'sportForAll'], name: 'Civic pride', text: 'Every home is another 5% happier.', fx: { happy: 0.05 } }),
  S({ id: 'boulevards', branch: 'wellbeing', tier: 5, needs: ['civicPride'], excludes: ['carFree'], name: 'Tree-lined boulevards', text: 'Parks and trees make homes another 15% nicer, and busy roads bother them 20% less.', fx: { greenery: 1.15, traffic: 0.8 } }),
  S({ id: 'carFree', branch: 'wellbeing', tier: 5, needs: ['civicPride'], excludes: ['boulevards'], name: 'Car-free square', text: 'Busy roads bother homes 35% less and every home is 2% happier, but roads carry 8% less traffic.', fx: { traffic: 0.65, happy: 0.02, roadCapacity: 0.92 } }),
  S({ id: 'goodName', branch: 'wellbeing', tier: 6, needs: ['boulevards', 'carFree'], name: 'A good name', text: 'The town’s reputation scores 6 points higher, so it draws more newcomers.', fx: { reputation: 0.06 } }),
  S({ id: 'beloved', branch: 'wellbeing', tier: 7, needs: ['goodName'], milestone: true, name: 'Beloved town', text: 'The mayor’s speeches last twice as long, and every home is 3% happier.', fx: { speechDays: 2, happy: 0.03 } }),

  // ---- Housing & Growth ----------------------------------------------------------------------------
  S({ id: 'roomyHomes', branch: 'housing', tier: 1, name: 'Roomier homes', text: 'Homes hold 10% more people.', fx: { capacity: 1.1 } }),
  S({ id: 'landOffice', branch: 'housing', tier: 1, name: 'Land office', text: 'When the town builds itself, it builds 15% faster.', fx: { growth: 1.15 } }),
  S({ id: 'riverside', branch: 'housing', tier: 2, needs: ['roomyHomes', 'landOffice'], name: 'Riverside lots', text: 'Water views make homes 60% nicer.', fx: { waterfront: 1.6 } }),
  S({ id: 'welcome', branch: 'housing', tier: 3, cost: 2, needs: ['riverside'], name: 'Welcome centre', text: 'Newcomers move in 50% faster.', fx: { moveIn: 1.5 } }),
  S({ id: 'fineHomes', branch: 'housing', tier: 4, needs: ['welcome'], name: 'Fine townhouses', text: 'Notable people are drawn to the town 25% sooner.', fx: { inspire: 1.25 } }),
  S({ id: 'highRise', branch: 'housing', tier: 5, needs: ['fineHomes'], excludes: ['gardenCity'], name: 'Taller blocks', text: 'Homes hold another 12% more people, but busy roads bother them 10% more.', fx: { capacity: 1.12, traffic: 1.1 } }),
  S({ id: 'gardenCity', branch: 'housing', tier: 5, needs: ['fineHomes'], excludes: ['highRise'], name: 'Garden city', text: 'Parks and trees make homes 20% nicer, and homes hold 4% more people.', fx: { greenery: 1.2, capacity: 1.04 } }),
  S({ id: 'boomTown', branch: 'housing', tier: 7, needs: ['highRise', 'gardenCity'], milestone: true, name: 'Boom town', text: 'One more upgrade point for every 50 residents past 500 at the town’s biggest, and the town builds itself 15% faster.', fx: { boomPoints: 1, growth: 1.15 } }),

  // ---- Education & Services ------------------------------------------------------------------------
  S({ id: 'catchments', branch: 'services', tier: 1, name: 'Wider catchments', text: 'Schools and clinics reach 1 tile further.', fx: { radius: { school: 1, health: 1 } } }),
  S({ id: 'bigClassrooms', branch: 'services', tier: 2, needs: ['catchments'], name: 'Bigger classrooms', text: 'Schools, libraries and universities each look after 20% more residents.', fx: { serves: { school: 1.2 } } }),
  S({ id: 'nightNurses', branch: 'services', tier: 2, needs: ['catchments'], name: 'Night nurses', text: 'Clinics each look after 25% more residents.', fx: { serves: { health: 1.25 } } }),
  S({ id: 'playStreets', branch: 'services', tier: 3, cost: 1, needs: ['bigClassrooms', 'nightNurses'], name: 'Play streets', text: 'Playgrounds and sports fields reach 1 tile further.', fx: { radius: { fun: 1 } } }),
  S({ id: 'fireDrills', branch: 'services', tier: 3, cost: 1, needs: ['bigClassrooms', 'nightNurses'], name: 'Fire drills', text: 'Fire stations reach 2 tiles further.', fx: { radius: { fire: 2 } } }),
  S({ id: 'goodSchools', branch: 'services', tier: 4, needs: ['playStreets', 'fireDrills'], name: 'Good schools', text: 'Homes value having a school or clinic nearby 25% more.', fx: { services: 1.25 } }),
  S({ id: 'villageSchools', branch: 'services', tier: 5, needs: ['goodSchools'], excludes: ['boarding'], name: 'Village schools', text: 'Schools reach 2 tiles further, but each looks after 10% fewer residents.', fx: { radius: { school: 2 }, serves: { school: 0.9 } } }),
  S({ id: 'boarding', branch: 'services', tier: 5, needs: ['goodSchools'], excludes: ['villageSchools'], name: 'Boarding schools', text: 'Schools each look after 35% more residents, but reach 1 tile less.', fx: { radius: { school: -1 }, serves: { school: 1.35 } } }),
  S({ id: 'seatOfLearning', branch: 'services', tier: 7, needs: ['villageSchools', 'boarding'], milestone: true, name: 'Seat of learning', text: 'Schools, clinics and fire stations each look after 15% more residents, and clinics reach 1 tile further.', fx: { serves: { school: 1.15, health: 1.15, fire: 1.15 }, radius: { health: 1 } } }),

  // ---- Infrastructure ------------------------------------------------------------------------------
  S({ id: 'roadMenders', branch: 'infrastructure', tier: 1, name: 'Road menders', text: 'Roads carry 15% more traffic before they jam.', fx: { roadCapacity: 1.15 } }),
  S({ id: 'weatherWatch', branch: 'infrastructure', tier: 1, name: 'Weather watchers', text: 'Warnings of extreme weather come twice as early: about 6 hours ahead instead of 3.', fx: { warning: 2 } }),
  S({ id: 'stormShutters', branch: 'infrastructure', tier: 2, needs: ['weatherWatch'], name: 'Storm shutters', text: 'Storms, wind and hail do 20% less damage to buildings.', fx: { damage: 0.8 } }),
  S({ id: 'publicWorks', branch: 'infrastructure', tier: 2, needs: ['roadMenders', 'weatherWatch'], name: 'Public works', text: 'Damage is repaired twice as fast, and repairs cost 25% less.', fx: { repairSpeed: 2, repairCost: 0.75 } }),
  S({ id: 'floodBanks', branch: 'infrastructure', tier: 3, needs: ['stormShutters'], name: 'Flood banks', text: 'Floods and washouts do 40% less damage.', fx: { flood: 0.6 } }),
  S({ id: 'firebreaks', branch: 'infrastructure', tier: 4, needs: ['floodBanks', 'publicWorks'], name: 'Firebreaks', text: 'Fires and lightning do 30% less damage.', fx: { fire: 0.7 } }),
  S({ id: 'tramways', branch: 'infrastructure', tier: 5, needs: ['firebreaks'], excludes: ['cycleLanes'], name: 'Tramways', text: 'Roads carry 25% more traffic before they jam.', fx: { roadCapacity: 1.25 } }),
  S({ id: 'cycleLanes', branch: 'infrastructure', tier: 5, needs: ['firebreaks'], excludes: ['tramways'], name: 'Cycle lanes', text: 'Busy roads bother homes 25% less, and roads carry 8% more traffic.', fx: { traffic: 0.75, roadCapacity: 1.08 } }),
  S({ id: 'resilientTown', branch: 'infrastructure', tier: 7, needs: ['tramways', 'cycleLanes'], milestone: true, name: 'Resilient town', text: 'Every kind of disaster does another 20% less damage, and warnings come 50% earlier still.', fx: { damage: 0.8, flood: 0.8, fire: 0.8, warning: 1.5 } }),

  // ---- Industry & Commerce -------------------------------------------------------------------------
  S({ id: 'hubs', branch: 'industry', tier: 1, name: 'Business hubs', text: 'Workplaces offer 10% more jobs.', fx: { jobs: 1.1 } }),
  S({ id: 'guilds', branch: 'industry', tier: 1, name: 'Craft guilds', text: 'Shops, cafés and bakeries pay 20% more tax.', fx: { typeTax: { shop: 1.2, cafe: 1.2, bakery: 1.2 } } }),
  S({ id: 'railSiding', branch: 'industry', tier: 2, needs: ['hubs', 'guilds'], name: 'Rail siding', text: 'Factories offer 15% more jobs and pay 10% more tax.', fx: { typeJobs: { factory: 1.15 }, typeTax: { factory: 1.1 } } }),
  S({ id: 'officeQuarter', branch: 'industry', tier: 3, needs: ['railSiding'], name: 'Office quarter', text: 'Offices and malls offer 15% more jobs and pay 15% more tax.', fx: { typeJobs: { office: 1.15, mall: 1.15 }, typeTax: { office: 1.15, mall: 1.15 } } }),
  S({ id: 'smokeless', branch: 'industry', tier: 4, needs: ['officeQuarter'], name: 'Smoke filters', text: 'Factory smoke bothers homes 30% less, and factories pay another 10% more tax.', fx: { pollution: 0.7, typeTax: { factory: 1.1 } } }),
  S({ id: 'freeTrade', branch: 'industry', tier: 5, needs: ['smokeless'], excludes: ['coops'], name: 'Free trade', text: 'Businesses pay 10% more tax, but upkeep costs 5% more.', fx: { businessTax: 1.1, upkeep: 1.05 } }),
  S({ id: 'coops', branch: 'industry', tier: 5, needs: ['smokeless'], excludes: ['freeTrade'], name: 'Co-operatives', text: 'Workplaces offer 8% more jobs, and homes value good jobs 15% more.', fx: { jobs: 1.08, employment: 1.15 } }),
  S({ id: 'industrialAge', branch: 'industry', tier: 7, needs: ['freeTrade', 'coops'], milestone: true, name: 'Industrial age', text: 'Factories offer 25% more jobs and pay 20% more tax, and their smoke bothers homes 20% less.', fx: { typeJobs: { factory: 1.25 }, typeTax: { factory: 1.2 }, pollution: 0.8 } }),

  // ---- Defence -------------------------------------------------------------------------------------
  S({ id: 'drill', branch: 'defence', tier: 1, name: 'Drill sergeants', text: 'Recruits train 30% faster.', fx: { train: 0.7 } }),
  S({ id: 'engineers', branch: 'defence', tier: 2, cost: 1, needs: ['drill'], name: 'Army engineers', text: 'Defences and their upgrades cost 20% less.', fx: { defenceCost: 0.8 } }),
  S({ id: 'fieldHospital', branch: 'defence', tier: 2, cost: 1, needs: ['drill'], name: 'Field hospital', text: 'Wounded soldiers recover 40% faster.', fx: { recovery: 0.6 } }),
  S({ id: 'scouts', branch: 'defence', tier: 2, needs: ['drill'], name: 'Scouts', text: 'Raids are spotted 50% earlier, so you have longer to get ready.', fx: { raidWarning: 1.5 } }),
  S({ id: 'repairCrews', branch: 'defence', tier: 3, cost: 1, needs: ['engineers'], name: 'Repair crews', text: 'The base is repaired 50% faster.', fx: { repair: 1.5 } }),
  S({ id: 'quartermaster', branch: 'defence', tier: 3, cost: 1, needs: ['fieldHospital'], name: 'Quartermaster', text: 'Soldiers’ pay costs 20% less.', fx: { pay: 0.8 } }),
  S({ id: 'veterans', branch: 'defence', tier: 4, cost: 2, needs: ['repairCrews', 'quartermaster'], name: 'Veteran instructors', text: 'New recruits start as Corporals.', fx: { veteranXp: 40 } }),
  S({ id: 'standingArmy', branch: 'defence', tier: 5, needs: ['veterans'], excludes: ['militia'], name: 'Standing army', text: 'The base holds 4 more soldiers, but soldiers’ pay costs 10% more.', fx: { armyCap: 4, pay: 1.1 } }),
  S({ id: 'militia', branch: 'defence', tier: 5, needs: ['veterans'], excludes: ['standingArmy'], name: 'Citizen militia', text: 'Recruits cost 30% less and train another 20% faster.', fx: { recruitCost: 0.7, train: 0.8 } }),
  S({ id: 'citadel', branch: 'defence', tier: 7, needs: ['standingArmy', 'militia'], milestone: true, name: 'Citadel', text: 'The base holds 2 more soldiers, the mayor’s base inspections do twice as much, and raids are spotted 50% earlier still.', fx: { armyCap: 2, inspect: 2, raidWarning: 1.5 } }),

  // ---- Leadership & Legacy -------------------------------------------------------------------------
  S({ id: 'clerks', branch: 'leadership', tier: 1, name: 'Town clerks', text: 'The mayor’s skills grow 50% faster with every duty.', fx: { mayorGain: 1.5 } }),
  S({ id: 'oratory', branch: 'leadership', tier: 1, name: 'Oratory lessons', text: 'The mayor’s speeches lift homes 30% more.', fx: { speech: 1.3 } }),
  S({ id: 'envoys', branch: 'leadership', tier: 2, needs: ['clerks', 'oratory'], name: 'Envoy service', text: 'Meeting a neighbour’s mayor builds 40% more trust, and their grudges fade 50% faster.', fx: { envoy: 1.4, grievanceFade: 1.5 } }),
  S({ id: 'familyTutors', branch: 'leadership', tier: 3, needs: ['envoys'], name: 'Family tutors', text: 'When your heir takes office, they start with 10 more in every mayor skill.', fx: { heirBonus: 10 } }),
  S({ id: 'regents', branch: 'leadership', tier: 3, needs: ['envoys'], name: 'Trusted regents', text: 'A relative standing in as mayor leads with at least 50 in every skill.', fx: { regentFloor: 50 } }),
  S({ id: 'council', branch: 'leadership', tier: 4, cost: 3, needs: ['familyTutors', 'regents'], name: 'Town council', text: 'The mayor can do 4 duties a day instead of 3.', fx: { actions: 1 } }),
  S({ id: 'peoplesMayor', branch: 'leadership', tier: 5, needs: ['council'], excludes: ['shrewdMayor'], name: 'People’s mayor', text: 'Speeches lift homes another 20% more, and meetings with neighbours build 20% more trust.', fx: { speech: 1.2, envoy: 1.2 } }),
  S({ id: 'shrewdMayor', branch: 'leadership', tier: 5, needs: ['council'], excludes: ['peoplesMayor'], name: 'Shrewd mayor', text: 'Fundraisers raise 40% more, and base inspections do 30% more.', fx: { fundraiser: 1.4, inspect: 1.3 } }),
  S({ id: 'foundingFamilies', branch: 'leadership', tier: 6, needs: ['peoplesMayor', 'shrewdMayor'], gate: { gen: 2 }, name: 'Founding families', text: 'One more upgrade point for each generation of your family after the first (up to 10).', fx: { genPoints: 1 } }),
  S({ id: 'dynasty', branch: 'leadership', tier: 7, needs: ['foundingFamilies'], milestone: true, name: 'Dynasty', text: 'Every mayor duty does 15% more, and a new mayor starts with at least 45 in every skill.', fx: { speech: 1.15, fundraiser: 1.15, inspect: 1.15, envoy: 1.15, leaderFloor: 45 } }),
];

export const SKILL = Object.fromEntries(SKILLS.map((s) => [s.id, s]));
export const costOf = (id) => SKILL[id]?.cost || TIER_COST[SKILL[id]?.tier] || 1;
export const TOTAL_COST = SKILLS.reduce((n, s) => n + costOf(s.id), 0);

// Effects that multiply, that add up, and the per-kind maps.
const MULTIPLY = [
  'residentTax', 'businessTax', 'buildCost', 'upkeep', 'greenery', 'traffic', 'pollution', 'entertainment', 'waterfront', 'services', 'employment', 'capacity', 'jobs', 'moveIn', 'growth', 'inspire',
  'train', 'defenceCost', 'repair', 'pay', 'recovery', 'recruitCost', 'raidWarning',
  'roadCapacity', 'warning', 'damage', 'flood', 'fire', 'repairSpeed', 'repairCost',
  'bondsMult', 'fundraiser', 'speech', 'speechDays', 'inspect', 'envoy', 'mayorGain', 'grievanceFade',
];
const ADD = ['grantBase', 'grantPerResident', 'happy', 'veteranXp', 'reputation', 'interest', 'interestCap', 'armyCap', 'actions', 'heirBonus', 'boomPoints', 'genPoints'];
const MAX = ['regentFloor', 'leaderFloor'];
const SERVICES = ['school', 'health', 'fun', 'fire'];
const TYPES = ['shop', 'cafe', 'bakery', 'office', 'mall', 'factory'];

// Limits on what upgrades can add up to, whatever is learned, so nothing becomes trivial: no home is
// more than 12% happier from upgrades, business taxes never more than 60% up, and so on. effectsOf
// clamps to these; the tests check every combination stays inside them.
export const CAPS = {
  residentTax: [0.85, 1.15],
  businessTax: [1, 1.6],
  buildCost: [0.85, 1],
  upkeep: [0.75, 1.1],
  happy: [0, 0.12],
  greenery: [1, 1.6],
  traffic: [0.3, 1.15],
  pollution: [0.4, 1],
  capacity: [1, 1.3],
  moveIn: [1, 1.6],
  growth: [1, 1.35],
  jobs: [1, 1.2],
  roadCapacity: [0.9, 1.45],
  damage: [0.6, 1],
  flood: [0.45, 1],
  fire: [0.55, 1],
  train: [0.5, 1],
  speech: [1, 1.8],
  fundraiser: [1, 2],
  inspect: [1, 2.5],
  envoy: [1, 1.8],
  reputation: [0, 0.06],
  armyCap: [0, 6],
};
const SERVES_CAP = [0.85, 1.6];
const TYPE_CAP = [1, 1.6];

// What no upgrades at all do: nothing.
export function noEffects() {
  const fx = { radius: {}, serves: {}, typeTax: {}, typeJobs: {} };
  for (const k of SERVICES) {
    fx.radius[k] = 0;
    fx.serves[k] = 1;
  }
  for (const k of TYPES) {
    fx.typeTax[k] = 1;
    fx.typeJobs[k] = 1;
  }
  for (const k of MULTIPLY) fx[k] = 1;
  for (const k of ADD) fx[k] = 0;
  for (const k of MAX) fx[k] = 0;
  return fx;
}

const clamp = (v, [a, b]) => Math.max(a, Math.min(b, v));

// The combined effects of a list of learned upgrades.
export function effectsOf(learned) {
  const fx = noEffects();
  for (const id of learned) {
    const s = SKILL[id];
    if (!s) continue;
    for (const [k, v] of Object.entries(s.fx)) {
      if (k === 'radius') for (const [svc, r] of Object.entries(v)) fx.radius[svc] = (fx.radius[svc] || 0) + r;
      else if (k === 'serves' || k === 'typeTax' || k === 'typeJobs') for (const [key, m] of Object.entries(v)) fx[k][key] = (fx[k][key] ?? 1) * m;
      else if (MULTIPLY.includes(k)) fx[k] *= v;
      else if (MAX.includes(k)) fx[k] = Math.max(fx[k], v);
      else fx[k] += v;
    }
  }
  for (const [k, range] of Object.entries(CAPS)) fx[k] = clamp(fx[k], range);
  for (const k of SERVICES) fx.serves[k] = clamp(fx.serves[k], SERVES_CAP);
  for (const k of TYPES) {
    fx.typeTax[k] = clamp(fx.typeTax[k], TYPE_CAP);
    fx.typeJobs[k] = clamp(fx.typeJobs[k], TYPE_CAP);
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
    st.peakEra = Math.max(Number.isFinite(st.peakEra) ? st.peakEra : 0, this.city.systems.era?.index || 0);
    st.peakGen = Math.max(Number.isFinite(st.peakGen) ? st.peakGen : 1, this.city.systems.life?.char?.generation || 1);
    st.v = SKILLS_VERSION;
    return st;
  }

  get learned() {
    return this.state.learned;
  }

  has(id) {
    return this.learned.includes(id);
  }

  title() {
    return Math.max(0, Math.min(MILESTONES.length - 1, this.city.systems.milestones?.reached || 0));
  }

  generation() {
    return this.state.peakGen;
  }

  residentsPerPoint() {
    return this.city.width * this.city.height <= SMALL_MAP_TILES ? RESIDENTS_PER_POINT_SMALL : RESIDENTS_PER_POINT;
  }

  // Where each point came from, for the sheet.
  sources(learned = this.learned) {
    const st = this.state;
    const gens = Math.min(GEN_POINTS_MAX, Math.max(0, st.peakGen - 1));
    return {
      start: START_POINTS,
      titles: this.title(),
      residents: Math.floor(st.peak / this.residentsPerPoint()),
      eras: st.peakEra,
      generations: gens,
      founders: learned.includes('foundingFamilies') ? gens : 0,
      boom: learned.includes('boomTown') ? Math.floor(Math.max(0, st.peak - 500) / 50) : 0,
    };
  }

  // Points the town has earned (with a given set of upgrades, since two of them earn points).
  earned(learned = this.learned) {
    return Object.values(this.sources(learned)).reduce((a, b) => a + b, 0);
  }

  spent(learned = this.learned) {
    return learned.reduce((n, id) => n + costOf(id), 0);
  }

  available() {
    return Math.max(0, this.earned() - this.spent());
  }

  // Residents still needed for the next point from growth.
  toNextPoint() {
    const peak = this.state.peak;
    const per = this.residentsPerPoint();
    return (Math.floor(peak / per) + 1) * per - peak;
  }

  // What an upgrade needs from the town (title, generation), as words, or null when it's open.
  gateError(id) {
    const s = SKILL[id];
    const title = TIER_TITLE[s.tier] || 0;
    const gen = s.gate?.gen || 0;
    if (s.milestone) {
      if (this.title() < title && this.generation() < MILESTONE_GEN) return `Needs the ${MILESTONES[title].label} title or your family’s third generation`;
    } else if (this.title() < title) return `Needs the ${MILESTONES[title].label} title`;
    if (gen && this.generation() < gen) return gen === 2 ? 'Needs your family’s second generation' : `Needs generation ${gen} of your family`;
    return null;
  }

  // Why an upgrade can't be learned now, or null when it can.
  learnError(id) {
    const s = SKILL[id];
    if (!s) return 'No such upgrade';
    if (this.has(id)) return 'Already yours';
    const rival = (s.excludes || []).find((x) => this.has(x));
    if (rival) return `You chose ${SKILL[rival].name}. Take it back to choose this instead`;
    if (s.needs && !s.needs.some((n) => this.has(n))) return `Needs ${s.needs.map((n) => SKILL[n].name).join(' or ')} first`;
    const gate = this.gateError(id);
    if (gate) return gate;
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

  // An upgrade can be taken back when nothing learned after it would be left without what it needs
  // (upgrades already learned under older rules keep their place), and when the points it earned
  // aren't already spent.
  forgetError(id) {
    if (!this.has(id)) return 'Not learned';
    const all = this.learned;
    const rest = all.filter((x) => x !== id);
    const ok = (x, set) => !SKILL[x].needs || SKILL[x].needs.some((n) => set.includes(n));
    const stranded = rest.find((x) => ok(x, all) && !ok(x, rest));
    if (stranded) return `${SKILL[stranded].name} needs it. Take that back first`;
    if (this.spent(rest) > this.earned(rest)) return 'The points it earned are spent. Take back other upgrades first';
    return null;
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
    const now = this.earned(); // reading the state raises the peaks
    const before = this._last ?? now;
    this._last = now;
    return Math.max(0, now - before);
  }
}
