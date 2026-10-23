// Simulation: advances time, recomputes desirability, moves residents in and out, and tallies stats.

import { STRUCTURES, DAY_LENGTH_SECONDS, SIM_STEP } from './config.js';
import { recomputeDesirability } from './desirability.js';
import { computeLaborMarket } from './labor.js';
import { computeCoverage } from './coverage.js';
import { Reputation } from './reputation.js';
import { computeStreets } from './streets.js';
import { AgentSystem } from './agents.js';
import { LifeSystem } from './life.js';
import { WeatherSystem } from './weather.js';
import { Milestones } from './milestones.js';
import { Economy } from './economy.js';
import { Notables } from './notables.js';
import { Townsfolk } from './townsfolk.js';
import { Eras } from './eras.js';
import { Growth } from './growth.js';
import { Decisions } from './decisions.js';
import { Disasters, soundness } from './disasters.js';
import { computeThoughts } from './advisor.js';
import { daylightAt } from './time.js';
import { clamp, pickWeighted } from './utils.js';

export const TREND_SAMPLES_PER_DAY = 8;
const TREND_KEEP = 48;

export class Simulation {
  constructor(city) {
    this.city = city;
    this.agents = new AgentSystem(city);
    this.life = new LifeSystem(city);
    this.weather = new WeatherSystem(city);
    this.milestones = new Milestones(city);
    this.reputation = new Reputation(city, { unlocked: (tool) => this.milestones.isUnlocked(tool) });
    this.economy = new Economy(city);
    this.notables = new Notables(city);
    this.townsfolk = new Townsfolk(city);
    this.eras = new Eras(city);
    this.growth = new Growth(city, { eras: this.eras, economy: this.economy, milestones: this.milestones });
    this.decisions = new Decisions(city, { economy: this.economy, growth: this.growth, eras: this.eras, townsfolk: this.townsfolk });
    this.disasters = new Disasters(city, { economy: this.economy, decisions: this.decisions, eras: this.eras });
    this.decisions.disasters = this.disasters;
    this._notableRates = null;
    this._thoughtTimer = 0;
    this._streetsRev = -1;
    this.speed = 1; // 0 pauses; 1–3 run faster
    this._acc = 0;
    this._marketTimer = 0;
  }

  update(dt) {
    const city = this.city;
    const step = Math.min(dt, 0.25) * this.speed;
    if (!step) return;
    city.clock += step / DAY_LENGTH_SECONDS;
    if (city.clock >= 1) {
      city.clock -= 1;
      city.day++;
    }
    this._acc += step;
    while (this._acc >= SIM_STEP) {
      this._acc -= SIM_STEP;
      this.tick();
    }
    this.economy.update(step / DAY_LENGTH_SECONDS);
    this.growth.update(step);
    if (this._notableRates && this.notables.update(step / DAY_LENGTH_SECONDS, this._notableRates)) city.dirty = true; // their bonuses apply now
    this.weather.update(step);
    this.disasters.update(step);
    this.agents.update(step, daylightAt(city.clock));
    this.life.update(step);
    // Townsfolk live hour by hour; the trips they make show up as walkers.
    if (city.stats) for (const trip of this.townsfolk.update()) this.agents.townTrip(trip, this.townsfolk.byId(trip.id));
  }

  tick() {
    const city = this.city;
    this._marketTimer -= SIM_STEP;
    this._ratingTime = (this._ratingTime || 0) + SIM_STEP;
    this.updateStreets();
    // Jobs, traffic and desirability feed each other, so refresh them together about once a second.
    if (city.dirty || this._marketTimer <= 0) {
      if (city.dirty) {
        this.notables.syncHomes();
        this.applyNotables();
      }
      // Every refresh, not only when the map changed: residents moving in change how busy services are.
      const elapsed = this._ratingTime / DAY_LENGTH_SECONDS;
      computeCoverage(city, elapsed);
      this._ratingTime = 0;
      city.derived.labor = computeLaborMarket(city);
      this.reputation.update(elapsed); // from this pass's coverage and the last pass's greenery
      recomputeDesirability(city);
      this.economy.assess();
      this._notableRates = this.notables.rates();
      this._marketTimer = 1;
    }
    this.updateHousing();
    this.updateStats();
    this.updateTrends();
    this.milestones.update();
    this.eras.update();
    this.decisions.update();
    this._thoughtTimer -= SIM_STEP;
    if (this._thoughtTimer <= 0) {
      city.derived.thoughts = computeThoughts(city, this.milestones);
      this._thoughtTimer = 4;
    }
  }

  // Run the derived systems immediately, e.g. right after loading or generating a city.
  refresh() {
    this._streetsRev = -1;
    this.updateStreets();
    this.notables.syncHomes();
    this.applyNotables();
    computeCoverage(this.city);
    this.city.derived.labor = computeLaborMarket(this.city);
    recomputeDesirability(this.city);
    this.economy.assess();
    this._notableRates = this.notables.rates();
    this.updateStats();
    void this.milestones.state; // settle the starting title without a celebration
    void this.eras.state; // and the era and calendar
    // Reputation needs the stats and title settled above (what is unlocked) and the greenery just computed;
    // homes and stats are then scored again with it.
    this.reputation.update(0);
    recomputeDesirability(this.city);
    this.updateStats();
    this.city.derived.thoughts = computeThoughts(this.city, this.milestones);
  }

  // Notable people's bonuses: wider coverage, cheaper building, more tax, less upkeep.
  applyNotables() {
    const fx = this.notables.effects();
    this.city.derived.notableEffects = fx;
    Object.assign(this.economy.modifiers, { businessTax: fx.businessTax, buildCost: fx.buildCost, upkeep: fx.upkeep });
  }

  // Trends for the City panel: a sample every three in-game hours, the last six days kept.
  // Saved with the city (a few hundred numbers), so the charts survive a reload.
  updateTrends() {
    const city = this.city;
    const slot = Math.floor((city.day + city.clock) * TREND_SAMPLES_PER_DAY);
    const tr = (city.systems.trends ||= { slot: -1, t: [], pop: [], happy: [], employ: [], traffic: [] });
    tr.money ||= [];
    if (tr.slot === slot) return;
    tr.slot = slot;
    const s = city.stats;
    tr.t.push(Math.round((city.day + city.clock) * 1000) / 1000);
    tr.pop.push(s.population);
    tr.happy.push(s.homes ? s.happiness : 0);
    tr.employ.push(Math.round((s.employment ?? 1) * 100));
    tr.traffic.push(Math.round((s.traffic || 0) * 100));
    tr.money.push(Math.round(this.economy.money));
    while (tr.money.length < tr.t.length) tr.money.unshift(tr.money[0]); // older saves had no money trend
    for (const k of ['t', 'pop', 'happy', 'employ', 'traffic', 'money']) if (tr[k].length > TREND_KEEP) tr[k].splice(0, tr[k].length - TREND_KEEP);
  }

  // Street names and addresses follow the map; recompute only when a tile changed.
  updateStreets() {
    if (this._streetsRev === this.city.revision) return;
    this._streetsRev = this.city.revision;
    computeStreets(this.city);
  }

  // Desirability maps to how full a home can get: a bare lot fills a little, a leafy one fills up.
  targetResidents(tile) {
    const cap = STRUCTURES[tile.structure.type].capacity * soundness(tile.structure); // storm damage halves it
    return Math.round(cap * clamp((tile.desirability - 0.15) / 0.7, 0, 1));
  }

  updateHousing() {
    const city = this.city;
    const homes = city.homes();
    for (const h of homes) h.housingTarget = this.targetResidents(h);

    // Residents drift away from homes that are less appealing than they used to be.
    for (const h of homes) {
      const s = h.structure;
      if (s.residents > h.housingTarget && Math.random() < 0.1) {
        s.residents--;
        city.emit('movedOut', { x: h.x, y: h.y });
      }
    }

    // Newcomers choose among vacancies, favouring the most desirable homes.
    const open = homes.filter((h) => h.structure.residents < h.housingTarget);
    if (!open.length) return;
    const attempts = 1 + Math.floor(open.length / 8);
    for (let i = 0; i < attempts; i++) {
      if (Math.random() > 0.3) continue;
      const h = pickWeighted(open, (c) => (c.housingTarget - c.structure.residents) * c.desirability ** 2);
      if (!h || h.structure.residents >= h.housingTarget) continue;
      h.structure.residents++;
      city.emit('movedIn', { x: h.x, y: h.y });
    }
  }

  updateStats() {
    const city = this.city;
    let population = 0;
    let capacity = 0;
    let weighted = 0;
    let desirSum = 0;
    const homes = city.homes();
    for (const h of homes) {
      const r = h.structure.residents;
      population += r;
      capacity += STRUCTURES[h.structure.type].capacity;
      weighted += r * h.desirability;
      desirSum += h.desirability;
    }
    const happiness = population ? weighted / population : homes.length ? desirSum / homes.length : 0;
    const labor = city.derived.labor || { employed: 0, unemployed: 0, jobs: 0 };
    const workers = labor.employed + labor.unemployed;
    let busiest = 0;
    for (const t of city.tiles) if (t.congestion > busiest) busiest = t.congestion;
    city.stats = {
      population,
      capacity,
      homes: homes.length,
      occupancy: capacity ? population / capacity : 0,
      happiness: Math.round(happiness * 100),
      jobs: labor.jobs,
      employed: labor.employed,
      employment: workers ? labor.employed / workers : 1,
      traffic: busiest,
    };
  }
}
