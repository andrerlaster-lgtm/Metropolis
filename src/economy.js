// Town budget: taxes come in from residents, workers and businesses; upkeep goes out on roads,
// schools, clinics and parks; building things costs money up front (except in Sandbox).
// The balance and a daily ledger are saved in city.systems.economy. Per-building earnings are
// derived each market refresh into tile.earning and city.derived.economy.

import { STRUCTURES, COSTS, UPKEEP, TAX, BUSINESS_TAX, START_MONEY, WORKER_SHARE } from './config.js';

const KEEP_DAYS = 7;

// The category a building's money shows up under in the budget.
export function categoryOf(type) {
  const def = STRUCTURES[type];
  if (!def) return null;
  if (def.capacity) return 'homes';
  if (BUSINESS_TAX[type]) return type;
  if (UPKEEP[type]) return type;
  return null;
}

export const CATEGORY_LABELS = {
  homes: 'Home taxes',
  shop: 'Shops',
  cafe: 'Cafés',
  bakery: 'Bakeries',
  office: 'Offices',
  mall: 'Malls',
  factory: 'Factories',
  road: 'Roads',
  school: 'Schools',
  clinic: 'Clinics',
  library: 'Libraries',
  firestation: 'Fire stations',
  university: 'Universities',
  park: 'Parks',
  playground: 'Playgrounds',
  field: 'Sports fields',
  restaurant: 'Restaurants',
  market: 'Markets',
  bank: 'Banks',
  hotel: 'Hotels',
  warehouse: 'Warehouses',
  workshop: 'Workshops',
  powerplant: 'Power plants',
  kindergarten: 'Kindergartens',
  museum: 'Museums',
  pharmacy: 'Pharmacies',
  hospital: 'Hospitals',
  firehut: 'Fire huts',
  fountain: 'Fountains',
  garden: 'Community gardens',
  pool: 'Swimming pools',
  cinema: 'Cinemas',
  stadium: 'Stadiums',
  bonds: 'Town bonds',
  interest: 'Savings bank',
};

export class Economy {
  constructor(city) {
    this.city = city;
    this.modifiers = { businessTax: 1, buildCost: 1, upkeep: 1, residentTax: 1 }; // notable people and town decisions change these
  }

  get sandbox() {
    return this.city.systems.mode === 'sandbox';
  }

  // Lazily created, so older saves start with a sensible balance.
  get state() {
    const s = this.city.systems;
    if (!s.economy) s.economy = { money: START_MONEY.town, today: { day: this.city.day, income: 0, expenses: 0, built: 0 }, days: [] };
    return s.economy;
  }

  get money() {
    return this.state.money;
  }

  reset(start) {
    this.city.systems.economy = { money: START_MONEY[start] ?? START_MONEY.town, today: { day: this.city.day, income: 0, expenses: 0, built: 0 }, days: [] };
  }

  // ---- Building costs -------------------------------------------------------------

  costOf(tool) {
    if (this.sandbox) return 0;
    return Math.round((COSTS[tool] || 0) * (tool === 'bulldoze' ? 1 : this.modifiers.buildCost));
  }

  canAfford(amount) {
    return this.sandbox || amount <= this.state.money;
  }

  // How many of `n` placements fit the budget.
  affordable(tool, n) {
    const c = this.costOf(tool);
    if (!c) return n;
    return Math.max(0, Math.min(n, Math.floor(this.state.money / c)));
  }

  spend(amount) {
    if (!amount) return;
    this.state.money -= amount;
    this.state.today.built += amount;
  }

  refund(amount) {
    if (!amount) return;
    this.state.money += amount;
    this.state.today.built -= amount;
  }

  // ---- Daily taxes and upkeep -----------------------------------------------------------

  // Per-building earnings per day (positive = taxes in, negative = upkeep out), and the totals.
  assess() {
    const city = this.city;
    const income = {};
    const expenses = {};
    const earners = [];
    for (const t of city.tiles) {
      t.earning = 0;
      const s = t.structure;
      if (!s) continue;
      const def = STRUCTURES[s.type];
      let e = 0;
      if (def.capacity) {
        const workers = Math.round(s.residents * WORKER_SHARE) * (t.employment || 0);
        e = (s.residents * TAX.resident + workers * TAX.worker) * (this.modifiers.residentTax ?? 1) * (city.derived.skills?.residentTax ?? 1);
      } else if (BUSINESS_TAX[s.type]) {
        e = (t.workersFilled || 0) * BUSINESS_TAX[s.type] * this.modifiers.businessTax * (city.derived.skills?.typeTax?.[s.type] ?? 1);
      } else if (UPKEEP[s.type]) {
        e = -UPKEEP[s.type] * this.modifiers.upkeep;
      }
      if (!e) continue;
      t.earning = e;
      const cat = categoryOf(s.type);
      if (e > 0) income[cat] = (income[cat] || 0) + e;
      else expenses[cat] = (expenses[cat] || 0) - e;
      if (s.type !== 'road') earners.push(t);
    }
    // Town bonds (an upgrade, skills.js): a steady income that grows with the town; the Town mint adds to it.
    const sk = city.derived.skills;
    if (sk?.grantBase || sk?.grantPerResident) income.bonds = (sk.grantBase + sk.grantPerResident * (city.stats?.population || 0)) * (sk.bondsMult ?? 1);
    // A Savings bank (skills.js) pays interest on the money the town holds, up to a daily limit.
    if (sk?.interest > 0) {
      const n = Math.min(sk.interestCap || 0, Math.max(0, this.state.money) * sk.interest);
      if (n > 0) income.interest = n;
    }
    const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
    const totalIn = sum(income);
    const totalOut = sum(expenses);
    earners.sort((a, b) => b.earning - a.earning);
    const result = {
      income,
      expenses,
      totalIn,
      totalOut,
      net: totalIn - totalOut,
      top: earners.filter((t) => t.earning > 0).slice(0, 5),
      costly: earners.filter((t) => t.earning < 0).reverse().slice(0, 3).reverse(),
    };
    city.derived.economy = result;
    return result;
  }

  // Money flows in and out continuously, a day's worth per in-game day.
  update(dayFraction) {
    const d = this.city.derived.economy;
    if (!d || dayFraction <= 0) return;
    const st = this.state;
    st.money += d.net * dayFraction;
    // Without Sandbox the town can't borrow: upkeep stops at zero (residents notice).
    if (!this.sandbox && st.money < 0) st.money = 0;
    st.today.income += d.totalIn * dayFraction;
    st.today.expenses += d.totalOut * dayFraction;
    if (this.city.day !== st.today.day) {
      st.days.push({ day: st.today.day, income: Math.round(st.today.income), expenses: Math.round(st.today.expenses), built: Math.round(st.today.built) });
      if (st.days.length > KEEP_DAYS) st.days.shift();
      st.today = { day: this.city.day, income: 0, expenses: 0, built: 0 };
    }
  }
}

export const money = (n) => `${n < 0 ? '−' : ''}$${Math.round(Math.abs(n)).toLocaleString()}`;
