// Static game data. Systems read from here; nothing in this file holds mutable state.

export const TILE_W = 64;
export const TILE_H = 32;
export const DEFAULT_MAP_SIZE = 32;
export const SAVE_VERSION = 2;
export const DAY_LENGTH_SECONDS = 300; // one full day/night cycle
export const SIM_STEP = 0.25; // fixed simulation tick, in seconds

export const PALETTE = {
  grass: '#a8d5a2',
  water: '#7ec8e3',
  road: '#d6d0c4',
  peach: '#ffb5a7',
  blush: '#fcd5ce',
  mint: '#b8e0d2',
  lavender: '#cdb4db',
  sidewalk: '#ece7dd',
  sand: '#efe3c8',
  earth: '#d2b89c',
  earthDark: '#b09379',
  leaf: '#93cf98',
  leafLight: '#b9e4ab',
  leafDeep: '#76b585',
  blossom: '#f7c6cf',
  blossomLight: '#fde0e5',
  trunk: '#b99679',
  parkGrass: '#b9e2ad',
  path: '#efe6d6',
  stone: '#f1ece4',
  glass: '#e5eff5',
  windowLit: '#ffe29a',
  pole: '#9d97b6',
  lampOff: '#efe9f6',
  lampOn: '#fff4c9',
  marking: '#fbf8f2',
};

export const BUILDING_VARIANTS = {
  peach: { wall: PALETTE.peach, roof: '#e9968c', trim: '#fff1ec' },
  blush: { wall: PALETTE.blush, roof: '#e6a79e', trim: '#fff7f4' },
  mint: { wall: PALETTE.mint, roof: '#8ec3af', trim: '#f2fbf7' },
  lavender: { wall: PALETTE.lavender, roof: '#a991c4', trim: '#f8f2fb' },
};
export const VARIANT_KEYS = Object.keys(BUILDING_VARIANTS);

// Structure definitions. `capacity` > 0 makes a structure housing; `jobs` > 0 makes it a workplace;
// `service` names the coverage it provides, `serves` how many residents it can look after at full quality
// (see SERVICE_RATING); `greenery` feeds desirability.
// Future per-structure data (upkeep, power draw, pollution, …) belongs here.
export const STRUCTURES = {
  house: { label: 'House', capacity: 4, jobs: 0, greenery: 0, height: 27 },
  cottage: { label: 'Cottage', capacity: 2, jobs: 0, greenery: 0, height: 20 },
  apartments: { label: 'Apartments', capacity: 10, jobs: 0, greenery: 0, height: 44 },
  tower: { label: 'Tower', capacity: 16, jobs: 0, greenery: 0, height: 70 },
  shop: { label: 'Shop', capacity: 0, jobs: 5, greenery: 0, height: 22 },
  cafe: { label: 'Café', capacity: 0, jobs: 3, greenery: 0, height: 18, service: 'fun', radius: 3 },
  mall: { label: 'Mall', capacity: 0, jobs: 24, greenery: 0, height: 26 },
  factory: { label: 'Factory', capacity: 0, jobs: 20, greenery: 0, height: 34, pollution: 1, produces: { goods: 70 } },
  office: { label: 'Office', capacity: 0, jobs: 16, greenery: 0, height: 58 },
  school: { label: 'School', capacity: 0, jobs: 4, greenery: 0, height: 30, service: 'school', radius: 7, serves: 250 },
  clinic: { label: 'Clinic', capacity: 0, jobs: 4, greenery: 0, height: 28, service: 'health', radius: 7, serves: 320 },
  playground: { label: 'Playground', capacity: 0, jobs: 0, greenery: 0.5, walkable: true, height: 14, service: 'fun', radius: 4 },
  field: { label: 'Sports field', capacity: 0, jobs: 2, greenery: 1, walkable: true, height: 12, service: 'fun', radius: 6 },
  tree: { label: 'Tree', capacity: 0, jobs: 0, greenery: 1, walkable: true, height: 26 },
  park: { label: 'Park', capacity: 0, jobs: 0, greenery: 3, walkable: true, height: 0 },
  road: { label: 'Road', capacity: 0, jobs: 0, greenery: 0, walkable: true, road: true, height: 0 },
  // What a building becomes when a disaster destroys it. Not a tool: crews or the bulldozer clear it.
  rubble: { label: 'Rubble', capacity: 0, jobs: 0, greenery: 0, height: 7 },
  // New kinds go at the end: share links store each type by its position in this list.
  bakery: { label: 'Bakery', capacity: 0, jobs: 4, greenery: 0, height: 20 },
  library: { label: 'Library', capacity: 0, jobs: 3, greenery: 0, height: 26, service: 'school', radius: 5, serves: 100 },
  firestation: { label: 'Fire station', capacity: 0, jobs: 6, greenery: 0, height: 30, service: 'fire', radius: 7, serves: 280 },
  university: { label: 'University', capacity: 0, jobs: 30, greenery: 0, height: 40, service: 'school', radius: 9, serves: 450 },
  // Phase 4: the wider catalog. Still appended in this order (share links count by position).
  bungalow: { label: 'Bungalow', capacity: 3, jobs: 0, greenery: 0.3, height: 17 },
  rowhouse: { label: 'Row houses', capacity: 7, jobs: 0, greenery: 0, height: 30 },
  villa: { label: 'Villa', capacity: 3, jobs: 0, greenery: 1, height: 26 },
  restaurant: { label: 'Restaurant', capacity: 0, jobs: 8, greenery: 0, height: 22, service: 'fun', radius: 4 },
  market: { label: 'Market', capacity: 0, jobs: 6, greenery: 0.3, height: 16, produces: { food: 20 } },
  bank: { label: 'Bank', capacity: 0, jobs: 12, greenery: 0, height: 40 },
  hotel: { label: 'Hotel', capacity: 0, jobs: 14, greenery: 0, height: 46, service: 'fun', radius: 3 },
  warehouse: { label: 'Warehouse', capacity: 0, jobs: 14, greenery: 0, height: 24 },
  workshop: { label: 'Workshop', capacity: 0, jobs: 9, greenery: 0, height: 22, produces: { goods: 25 } },
  powerplant: { label: 'Power plant', capacity: 0, jobs: 18, greenery: 0, height: 52, pollution: 1, produces: { power: 260 } },
  kindergarten: { label: 'Kindergarten', capacity: 0, jobs: 3, greenery: 0, height: 18, service: 'school', radius: 4, serves: 90 },
  museum: { label: 'Museum', capacity: 0, jobs: 6, greenery: 0, height: 30, service: 'school', radius: 6, serves: 140 },
  pharmacy: { label: 'Pharmacy', capacity: 0, jobs: 3, greenery: 0, height: 18, service: 'health', radius: 4, serves: 110 },
  hospital: { label: 'Hospital', capacity: 0, jobs: 30, greenery: 0, height: 44, service: 'health', radius: 10, serves: 900 },
  firehut: { label: 'Fire hut', capacity: 0, jobs: 2, greenery: 0, height: 18, service: 'fire', radius: 4, serves: 90 },
  fountain: { label: 'Fountain', capacity: 0, jobs: 0, greenery: 1, walkable: true, height: 14, service: 'fun', radius: 3 },
  garden: { label: 'Community garden', capacity: 0, jobs: 1, greenery: 2, walkable: true, height: 8 },
  pool: { label: 'Swimming pool', capacity: 0, jobs: 4, greenery: 0.3, height: 16, service: 'fun', radius: 5 },
  cinema: { label: 'Cinema', capacity: 0, jobs: 8, greenery: 0, height: 30, service: 'fun', radius: 6 },
  stadium: { label: 'Stadium', capacity: 0, jobs: 14, greenery: 0, height: 34, service: 'fun', radius: 10 },
  // Phase 8: the first producer that needs open land rather than a road.
  farm: { label: 'Farm', capacity: 0, jobs: 4, greenery: 0.5, walkable: true, height: 16, produces: { food: 70 } },
  // The mill buys the harvest of farms near it and turns it into money (resources.js).
  mill: { label: 'Mill', capacity: 0, jobs: 8, greenery: 0, height: 34, mills: true },
};

// Resources (resources.js): what the town makes and uses each day.
export const RESOURCES = {
  food: { label: 'Food', note: 'Farms and markets feed the homes' },
  goods: { label: 'Goods', note: 'Workshops and factories supply the businesses' },
  power: { label: 'Power', note: 'Power plants light the town from the Motor age' },
};
export const RESOURCE_NEED = { foodPerResident: 0.5, goodsPerWorker: 0.25, powerFromEra: 2, powerPerResident: 0.5, powerPerWorker: 0.3 };
// Farm → mill chain: each farm sells to the nearest mill within `range` tiles that has room (a mill takes
// `farms` of them); a mill with its farms staffed earns up to `income` a day per farm, less the longer the haul.
export const MILL = { range: 10, farms: 3, income: 60 };
// What a fully supplied town gets: homes a little happier, and a little more tax from shops and the like.
export const SUPPLY_BONUS = { food: 0.04, power: 0.03, retailTax: 0.08 };

// Share of residents who go out to work.
export const WORKER_SHARE = 0.6;
// Commuters a road tile carries before it counts as fully congested.
export const ROAD_CAPACITY = 24;
export const SERVICES = [
  { id: 'school', label: 'Schools' },
  { id: 'health', label: 'Clinics' },
];
// Every kind of coverage a building can provide (services above, plus recreation and fire cover,
// which protects buildings from disaster damage rather than making homes more desirable).
export const COVERAGE_IDS = ['school', 'health', 'fun', 'fire'];

// Service quality: a school, clinic, library, university or fire station looks after `serves` residents.
// The residents in its reach are shared between the buildings that cover them (the nearer, the bigger
// share); when a building has more than it can serve, its quality target falls (never below `min`).
// Quality drifts toward that target by at most `perDay` a day, so it recovers or slips over several days,
// and below `strained` the town starts asking for another one. Quality scales the building's coverage.
export const SERVICE_RATING = { min: 0.3, perDay: 0.3, strained: 0.75 };

// Town reputation (reputation.js): a slow 0..1 score from how green and well kept the town is. 0.5 is neutral.
export const REPUTATION = {
  perDay: 0.04, // the most it moves in a game day, so the whole range takes about 25 days
  homeAppeal: 0.1, // homes look up to ±0.05 more or less appealing at the ends
  growth: 0.3, // a town that grows by itself runs up to ±15% faster or slower
  weights: { green: 0.4, care: 0.35, services: 0.25 },
};

// Milestones: the town's title grows with its population, and each step unlocks new buildings.
// Unlocks are permanent. Tools not listed here are always available.
export const MILESTONES = [
  { id: 'hamlet', label: 'Hamlet', pop: 0, unlocks: [] },
  { id: 'village', label: 'Village', pop: 60, unlocks: ['school', 'playground', 'apartments', 'factory', 'library', 'firestation', 'rowhouse', 'restaurant', 'kindergarten', 'warehouse', 'workshop', 'fountain', 'mill'] },
  { id: 'town', label: 'Town', pop: 200, unlocks: ['tower', 'office', 'clinic', 'mall', 'villa', 'bank', 'hotel', 'cinema', 'museum', 'pool'] },
  { id: 'city', label: 'City', pop: 450, unlocks: ['field', 'university', 'hospital', 'stadium', 'powerplant'] },
  { id: 'metropolis', label: 'Metropolis', pop: 900, unlocks: [] },
];

// ---- Town budget ----------------------------------------------------------------------
// What each thing costs to build (Milestones mode; Sandbox builds for free).
export const COSTS = {
  road: 20,
  house: 150,
  cottage: 80,
  apartments: 600,
  tower: 1000,
  shop: 300,
  cafe: 200,
  office: 1200,
  mall: 2500,
  factory: 1500,
  school: 2000,
  clinic: 2500,
  bakery: 180,
  library: 900,
  firestation: 1800,
  university: 6000,
  bungalow: 100,
  rowhouse: 450,
  villa: 800,
  restaurant: 350,
  market: 250,
  bank: 1800,
  hotel: 3000,
  warehouse: 900,
  workshop: 600,
  powerplant: 4000,
  kindergarten: 900,
  museum: 2200,
  pharmacy: 450,
  hospital: 8000,
  firehut: 600,
  fountain: 300,
  garden: 120,
  pool: 1600,
  cinema: 2000,
  stadium: 7000,
  farm: 250,
  mill: 1200,
  playground: 400,
  field: 1500,
  tree: 10,
  park: 100,
  water: 50,
  bulldoze: 0,
};
// Upkeep per in-game day.
export const UPKEEP = { road: 0.5, school: 30, clinic: 35, library: 12, firestation: 25, university: 60, park: 2, playground: 5, field: 12, kindergarten: 12, museum: 20, pharmacy: 8, hospital: 120, firehut: 8, fountain: 3, garden: 2, pool: 15, stadium: 45 };
// Taxes per in-game day: every resident pays a little, every worker a little more, and each business
// pays per filled job.
export const TAX = { resident: 0.8, worker: 1.2 };
export const BUSINESS_TAX = { shop: 1.5, cafe: 1.5, bakery: 1.5, office: 2, mall: 1.5, factory: 2.2, restaurant: 1.8, market: 1.2, bank: 3, hotel: 2.4, warehouse: 1.2, workshop: 1.8, powerplant: 2.5, cinema: 1.8, farm: 1.4, mill: 1.6 };
export const START_MONEY = { land: 10000, town: 25000 };

// Resident thoughts: red needs fixing, yellow is worth a look, green is going well.
export const SEVERITY_COLORS = { bad: '#ef6461', caution: '#f2b230', good: '#5cbf88' };

// Build menu: each group is one category button; groups with several tools open a panel of them.
// A tool's `key` is optional (only a few letters are free); new kinds go in the group that fits them.
export const TOOL_GROUPS = [
  { id: 'inspect', label: 'Inspect', tools: [{ id: 'inspect', label: 'Inspect', key: 'i' }] },
  {
    id: 'homes',
    label: 'Homes',
    tools: [
      { id: 'house', label: 'House', key: '1' },
      { id: 'cottage', label: 'Cottage', key: 'k' },
      { id: 'bungalow', label: 'Bungalow' },
      { id: 'rowhouse', label: 'Row houses' },
      { id: 'apartments', label: 'Apartments', key: 'o' }, // A moves the camera (WASD)
      { id: 'villa', label: 'Villa' },
      { id: 'tower', label: 'Tower', key: '2' },
    ],
  },
  {
    id: 'shops',
    label: 'Shops',
    tools: [
      { id: 'shop', label: 'Shop', key: '3' },
      { id: 'cafe', label: 'Café', key: 'e' },
      { id: 'bakery', label: 'Bakery', key: 'n' },
      { id: 'restaurant', label: 'Restaurant' },
      { id: 'market', label: 'Market' },
      { id: 'mall', label: 'Mall', key: 'l' },
    ],
  },
  {
    id: 'work',
    label: 'Work',
    tools: [
      { id: 'office', label: 'Office', key: '4' },
      { id: 'bank', label: 'Bank' },
      { id: 'hotel', label: 'Hotel' },
      { id: 'workshop', label: 'Workshop' },
      { id: 'farm', label: 'Farm' },
      { id: 'mill', label: 'Mill' },
      { id: 'warehouse', label: 'Warehouse' },
      { id: 'factory', label: 'Factory', key: 'y' },
      { id: 'powerplant', label: 'Power plant' },
    ],
  },
  {
    id: 'services',
    label: 'Services',
    tools: [
      { id: 'school', label: 'School', key: '5' },
      { id: 'kindergarten', label: 'Kindergarten' },
      { id: 'library', label: 'Library', key: 'j' },
      { id: 'museum', label: 'Museum' },
      { id: 'university', label: 'University', key: 'u' },
      { id: 'clinic', label: 'Clinic', key: '6' },
      { id: 'pharmacy', label: 'Pharmacy' },
      { id: 'hospital', label: 'Hospital' },
      { id: 'firestation', label: 'Fire station', key: 'h' },
      { id: 'firehut', label: 'Fire hut' },
    ],
  },
  {
    id: 'leisure',
    label: 'Leisure',
    tools: [
      { id: 'tree', label: 'Tree', key: '7' },
      { id: 'park', label: 'Park', key: '8' },
      { id: 'garden', label: 'Community garden' },
      { id: 'fountain', label: 'Fountain' },
      { id: 'playground', label: 'Playground', key: 'p' },
      { id: 'pool', label: 'Swimming pool' },
      { id: 'cinema', label: 'Cinema' },
      { id: 'field', label: 'Sports field', key: 'f' },
      { id: 'stadium', label: 'Stadium' },
      { id: 'water', label: 'Water', key: '0' },
    ],
  },
  { id: 'road', label: 'Road', tools: [{ id: 'road', label: 'Road', key: '9' }] },
  { id: 'bulldoze', label: 'Bulldoze', tools: [{ id: 'bulldoze', label: 'Bulldoze', key: 'b' }] },
];
export const TOOLS = TOOL_GROUPS.flatMap((g) => g.tools);

export const VIEWS = [
  { id: 'none', label: 'City' },
  { id: 'desirability', label: 'Desirability' },
  { id: 'traffic', label: 'Traffic' },
  { id: 'services', label: 'Services' },
];

export const CAR_COLORS = ['#ff9f8f', '#8fd0bd', '#b49ad1', '#ffd98f', '#9cc4ea', '#f7f3ea', '#f6a9c0'];
export const SHIRT_COLORS = ['#ff8f7e', '#7fc4ad', '#a98bd0', '#ffcf6e', '#86b5e6', '#f49ab8', '#ffffff'];
export const SKIN_TONES = ['#f6d5bd', '#e8b896', '#c98e6a', '#8d5a3f', '#f1c7a5'];
