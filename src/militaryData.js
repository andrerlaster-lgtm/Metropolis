// What the military is made of: the base map, the defences you can build on it, the troops you can
// recruit, and the ranks they earn. Plain data, read by military.js (the base and roster), battle.js
// (the fighting) and the screens. Stats are tuned by tests/military.test.mjs, which keeps every
// troop's and defence's damage per dollar inside one band.

// The base map, in tiles. The enemy arrives along the top rows; your command post sits near the
// bottom, and reinforcements come in from the bottom rows.
export const BASE_W = 16;
export const BASE_H = 20;
export const ENTRY_ROWS = 2; // rows 0–1: where attackers arrive (nothing may be built there)
export const DEPLOY_ROWS = 2; // the last two rows: where your reinforcements come in
export const HQ_AT = { x: 7, y: 15 }; // top-left of the 2×2 command post

// Defences. `blocks`: troops can't walk through it (every structure blocks; the route check keeps a
// way open from the enemy's edge to the command post). `attack.kind`: bullet (hits at once),
// shell (lobbed, lands later, splash). `vs`: damage multipliers against a target's tags.
export const DEFENCES = {
  hq: {
    label: 'Command post',
    short: 'HQ',
    w: 2,
    h: 2,
    hp: 1400,
    armor: 4,
    cost: 0,
    fixed: true,
    tags: ['structure'],
    attack: { dmg: 6, rate: 1.4, range: 4, kind: 'bullet' },
    desc: 'Your headquarters. If it falls, the battle is lost. Upgrading it lets you keep a bigger army.',
  },
  sandbags: {
    label: 'Sandbag wall',
    short: 'Sandbags',
    w: 1,
    h: 1,
    hp: 260,
    armor: 2,
    cost: 30,
    tags: ['structure', 'wall'],
    cover: true,
    desc: 'Cheap walls that steer the enemy the long way round. Your soldiers beside them take less damage.',
  },
  mg: {
    label: 'Machine-gun nest',
    short: 'MG nest',
    w: 1,
    h: 1,
    hp: 340,
    armor: 3,
    cost: 160,
    tags: ['structure'],
    cover: true,
    attack: { dmg: 6, rate: 4, range: 4.5, kind: 'bullet', vs: { infantry: 1.15 } },
    desc: 'Fast fire at anyone in range. Good against groups of soldiers.',
  },
  bunker: {
    label: 'Bunker',
    short: 'Bunker',
    w: 1,
    h: 1,
    hp: 760,
    armor: 7,
    cost: 300,
    tags: ['structure'],
    cover: true,
    attack: { dmg: 15, rate: 1.3, range: 4, kind: 'bullet' },
    desc: 'Thick concrete that soaks up a lot of punishment and keeps firing.',
  },
  mortar: {
    label: 'Mortar pit',
    short: 'Mortar',
    w: 1,
    h: 1,
    hp: 230,
    armor: 1,
    cost: 240,
    tags: ['structure'],
    attack: { dmg: 34, rate: 0.32, range: 8, min: 2, kind: 'shell', splash: 1.3 },
    desc: 'Lobs shells a long way. Hits a whole group, but can’t fire at anyone close by.',
  },
};
export const BUILDABLE = ['sandbags', 'mg', 'bunker', 'mortar'];
export const MAX_LEVEL = 3;
// Each level above the first: more health and more damage.
export const levelHp = (level) => 1 + 0.35 * (level - 1);
export const levelDmg = (level) => 1 + 0.3 * (level - 1);
// Upgrading from `level` to `level + 1`.
export function upgradeCost(type, level) {
  if (type === 'hq') return level === 1 ? 450 : 900;
  return Math.round(DEFENCES[type].cost * 0.6 * level);
}
export const maxHpOf = (type, level = 1) => Math.round(DEFENCES[type].hp * levelHp(level));
// Repairs: dollars per point of health. Crews fix damage over time; "repair now" costs half as much again.
export const repairRate = (type) => Math.max(0.3, (DEFENCES[type].cost || 400) / DEFENCES[type].hp) * 0.5;
export const REPAIR_HP_PER_DAY = 700; // what the base's repair crews get through in a day
export const RUSH_REPAIR = 1.5;

// The command post's level sets how many soldiers the base can hold, and how many stand guard.
export const ARMY_CAP = [0, 10, 16, 24];
export const GARRISON_CAP = [0, 4, 6, 8];

// Troops. Everyone is infantry for now. `attack.kind`: bullet or grenade (thrown, lands later,
// splash). `train`: days of regular training; emergency recruits arrive at once for EMERGENCY× the price.
export const UNITS = {
  rifleman: {
    label: 'Rifleman',
    plural: 'Riflemen',
    hp: 100,
    armor: 0,
    speed: 1.5,
    cost: 60,
    upkeep: 3,
    train: 0.4,
    tags: ['infantry'],
    attack: { dmg: 9, rate: 1.1, range: 3.6, kind: 'bullet' },
    desc: 'Dependable all-rounder.',
  },
  gunner: {
    label: 'Machine gunner',
    plural: 'Machine gunners',
    hp: 120,
    armor: 1,
    speed: 1.15,
    cost: 110,
    upkeep: 5,
    train: 0.6,
    tags: ['infantry'],
    attack: { dmg: 4, rate: 4, range: 4, kind: 'bullet', vs: { infantry: 1.25, structure: 0.5 } },
    desc: 'Pins down soldiers. Weak against walls and bunkers.',
  },
  grenadier: {
    label: 'Grenadier',
    plural: 'Grenadiers',
    hp: 105,
    armor: 0,
    speed: 1.35,
    cost: 130,
    upkeep: 5,
    train: 0.6,
    tags: ['infantry'],
    attack: { dmg: 26, rate: 0.45, range: 4.2, kind: 'grenade', splash: 0.9, vs: { structure: 2.2 } },
    desc: 'Throws grenades. Breaks defences and groups.',
  },
  medic: {
    label: 'Medic',
    plural: 'Medics',
    specialist: true,
    hp: 90,
    armor: 0,
    speed: 1.5,
    cost: 170,
    upkeep: 7,
    train: 0,
    tags: ['infantry'],
    heal: { rate: 7, range: 2.4 },
    attack: { dmg: 5, rate: 0.8, range: 3, kind: 'bullet' },
    desc: 'Specialist, hired ready to go. Patches up nearby soldiers, and fewer of the wounded die.',
  },
};
export const UNIT_TYPES = Object.keys(UNITS);
export const EMERGENCY = 2.5;

// Ranks from experience: each one adds a little health and damage.
export const RANKS = [
  { label: 'Private', short: 'Pvt.', xp: 0 },
  { label: 'Corporal', short: 'Cpl.', xp: 40 },
  { label: 'Sergeant', short: 'Sgt.', xp: 120 },
  { label: 'Veteran', short: 'Vet.', xp: 260 },
];
export function rankOf(xp = 0) {
  let r = 0;
  for (let i = 0; i < RANKS.length; i++) if (xp >= RANKS[i].xp) r = i;
  return r;
}
export const rankBonus = (xp) => 1 + 0.08 * rankOf(xp);

// The commander's own call: an artillery strike on a spot, paid from the military budget.
export const ARTILLERY = { cost: 120, cooldown: 45, delay: 2.2, shells: 3, radius: 1.5, dmg: 90, spread: 0.9 };

// Reinforcements: squads of up to this many leave the reserve together, one squad every few seconds.
export const SQUAD_SIZE = 4;
export const REINFORCE_COOLDOWN = 10;

// Injuries: the chance that a soldier who goes down survives (more with a medic in the battle), and
// how long recovery takes in days.
export const SURVIVE = 0.55;
export const SURVIVE_MEDIC = 0.75;
export const INJURY_DAYS = [2, 4];
export const LIGHT_INJURY_DAYS = 1;

export const SURNAMES = [
  'Moreno', 'Okafor', 'Lindqvist', 'Tanaka', 'Brennan', 'Haddad', 'Novak', 'Castillo', 'Mensah', 'Kowalski',
  'Dubois', 'Patel', 'Ferreira', 'Nakamura', 'Ivanova', 'Osei', 'MacLeod', 'Rossi', 'Andersen', 'Delgado',
  'Kaur', 'Fischer', 'Mwangi', 'Silva', 'Horvath', 'Quinn', 'Yilmaz', 'Laurent', 'Abara', 'Petrov',
  'Sato', 'Gallagher', 'Bianchi', 'Nguyen', 'Eriksen', 'Ramos', 'Adeyemi', 'Kim', 'Walsh', 'Romero',
];
export const INITIALS = 'ABCDEFGHJKLMNPRSTVW';
