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
  factory: { label: 'Factory', capacity: 0, jobs: 20, greenery: 0, height: 34, pollution: 1 },
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
};

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

// Milestones: the town's title grows with its population, and each step unlocks new buildings.
// Unlocks are permanent. Tools not listed here are always available.
export const MILESTONES = [
  { id: 'hamlet', label: 'Hamlet', pop: 0, unlocks: [] },
  { id: 'village', label: 'Village', pop: 60, unlocks: ['school', 'playground', 'apartments', 'factory', 'library', 'firestation'] },
  { id: 'town', label: 'Town', pop: 200, unlocks: ['tower', 'office', 'clinic', 'mall'] },
  { id: 'city', label: 'City', pop: 450, unlocks: ['field', 'university'] },
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
  playground: 400,
  field: 1500,
  tree: 10,
  park: 100,
  water: 50,
  bulldoze: 0,
};
// Upkeep per in-game day.
export const UPKEEP = { road: 0.5, school: 30, clinic: 35, library: 12, firestation: 25, university: 60, park: 2, playground: 5, field: 12 };
// Taxes per in-game day: every resident pays a little, every worker a little more, and each business
// pays per filled job.
export const TAX = { resident: 0.8, worker: 1.2 };
export const BUSINESS_TAX = { shop: 1.5, cafe: 1.5, bakery: 1.5, office: 2, mall: 1.5, factory: 2.2 };
export const START_MONEY = { land: 10000, town: 25000 };

// Resident thoughts: red needs fixing, yellow is worth a look, green is going well.
export const SEVERITY_COLORS = { bad: '#ef6461', caution: '#f2b230', good: '#5cbf88' };

// Toolbar: each group is one button; groups with several tools open a small tray.
export const TOOL_GROUPS = [
  { id: 'inspect', label: 'Inspect', tools: [{ id: 'inspect', label: 'Inspect', key: 'i' }] },
  {
    id: 'homes',
    label: 'Homes',
    tools: [
      { id: 'house', label: 'House', key: '1' },
      { id: 'cottage', label: 'Cottage', key: 'k' },
      { id: 'apartments', label: 'Apartments', key: 'o' }, // A moves the camera (WASD)
      { id: 'tower', label: 'Tower', key: '2' },
    ],
  },
  {
    id: 'work',
    label: 'Work',
    tools: [
      { id: 'shop', label: 'Shop', key: '3' },
      { id: 'cafe', label: 'Café', key: 'e' },
      { id: 'bakery', label: 'Bakery', key: 'n' },
      { id: 'office', label: 'Office', key: '4' },
      { id: 'mall', label: 'Mall', key: 'l' },
      { id: 'factory', label: 'Factory', key: 'y' },
    ],
  },
  {
    id: 'services',
    label: 'Services',
    tools: [
      { id: 'school', label: 'School', key: '5' },
      { id: 'clinic', label: 'Clinic', key: '6' },
      { id: 'library', label: 'Library', key: 'j' },
      { id: 'firestation', label: 'Fire station', key: 'h' },
      { id: 'university', label: 'University', key: 'u' },
    ],
  },
  {
    id: 'nature',
    label: 'Nature',
    tools: [
      { id: 'tree', label: 'Tree', key: '7' },
      { id: 'park', label: 'Park', key: '8' },
      { id: 'playground', label: 'Playground', key: 'p' },
      { id: 'field', label: 'Sports field', key: 'f' },
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
