// The computer's mayor: a small rule-based planner that runs a town on its own.
//
// It doesn't invent buildings. It drives the town's own systems, under the player's rules:
//   - growth.js decides what the town needs (homes when they fill up, work when people are idle,
//     cafés and parks where townsfolk lack them, schools and clinics where families have none, new
//     streets when lots run out), at the pace a growing town builds;
//   - it grows by the player's rules: residents build homes and businesses, and the town's own budget
//     pays for roads, services, parks and trees at the player's prices, keeping a reserve back for
//     upkeep; nothing paid for is built while the money isn't there;
//   - eras and milestones decide what may be built, and every placement goes through city.apply,
//     the same placement rules as the player's tools;
//   - when families need a school or clinic it can't afford yet, it saves up for it (other building
//     waits, except new businesses while many people are out of work, since they bring in taxes) and
//     builds it as soon as the money is there;
//   - town decisions are answered by weighing their effects against what the town can afford.
// It only ever touches its own town.
//
// Saved in the town's city.systems.cpu = { log: [{ day, type, x, y, n, rebuilt }], built,
// goal: { kind, type, cost, since } | null }.

import { decisionById } from './decisions.js';

const LOG_KEEP = 12;
const RESERVE_MIN = 250;
const LOOK_EVERY = 20; // game seconds between looks at what the town needs most
const SAVE_DAYS = 30; // never save for longer than this (at today's income); give up after 1.5× the plan
// Essentials worth saving up for: growth demand → building.
const ESSENTIALS = [
  ['school', 'school'],
  ['clinic', 'clinic'],
];

export class CpuPlanner {
  constructor(sim) {
    this.sim = sim;
    this.city = sim.city;
    const g = sim.growth;
    g.on = true;
    g.onBuilt = (what) => this.note(what);
  }

  get state() {
    const s = this.city.systems;
    if (!s.cpu) s.cpu = { log: [], built: 0 };
    return s.cpu;
  }

  dispose() {
    if (this.sim.growth.onBuilt) this.sim.growth.onBuilt = null;
  }

  // Money kept back: a couple of days of upkeep, and never less than a small float.
  reserve() {
    const out = this.city.derived.economy?.totalOut || 0;
    return Math.max(RESERVE_MIN, Math.round(out * 2));
  }

  // Called after the town's simulation has run for `step` game seconds.
  update(step = 0) {
    const sim = this.sim;
    const g = sim.growth;
    g.on = true;
    const base = this.reserve();
    g.reserve = base;
    if (sim.decisions.pending) this.decide();
    this._look = (this._look ?? 0) - step;
    if (this._look <= 0) {
      this._look = LOOK_EVERY;
      this.plan();
    }
    const goal = this.state.goal;
    if (!goal) return;
    // Saving up: other building waits until the money for the goal is there, except new jobs when
    // many people are out of work (they pay taxes, so the saving goes faster).
    if (sim.economy.money < goal.cost + base) {
      g.reserve = goal.cost + base;
      const today = this.city.day;
      if (this.jobsWanted && this.state.jobDay !== today && sim.economy.money >= 300 + base) {
        g.reserve = base;
        const done = g.act('work');
        if (done) {
          this.note(done);
          this.state.jobDay = today; // one new business a day while saving
        }
        g.reserve = goal.cost + base;
      }
      return;
    }
    const done = g.act(goal.kind);
    this.state.goal = null;
    if (done) this.note(done);
  }

  // What the town needs most that it can't yet afford: start (or give up) saving for it.
  plan() {
    const st = this.state;
    const g = this.sim.growth;
    const now = this.city.day + this.city.clock;
    if (st.goal && now - st.goal.since > (st.goal.days || SAVE_DAYS) * 1.5) {
      st.resting = now + 3; // it didn't work out (no money coming in, or nowhere to put it); later
      st.goal = null;
    }
    if (st.goal || (st.resting && now < st.resting)) return;
    const net = this.city.derived.economy?.net || 0;
    if (net <= 0) return; // no income: saving would never end
    const d = g.demand();
    this.jobsWanted = (d.work || 0) >= 1.5;
    const want = ESSENTIALS.filter(([kind, type]) => (d[kind] || 0) >= 0.7 && g.allowed(type)).sort((a, b) => d[b[0]] - d[a[0]])[0];
    if (!want) return;
    const cost = this.sim.economy.costOf(want[1]);
    const short = cost + this.reserve() - this.sim.economy.money;
    if (short <= 0) return; // affordable now: growth will get to it
    const days = short / net;
    if (days > SAVE_DAYS) return; // too far off at today's income
    st.goal = { kind: want[0], type: want[1], cost, since: now, days: Math.max(2, days) };
  }

  // Answer a town decision: the choice with the best effects the town can afford with money to spare.
  decide() {
    const p = this.sim.decisions.pending;
    const d = p && decisionById(p.id);
    if (!d) return null;
    const money = this.sim.economy.money;
    const spare = money - this.reserve();
    let best = d.choices.length - 1;
    let bestScore = -Infinity;
    d.choices.forEach((c, i) => {
      if (c.cost && c.cost > spare) return;
      const s = scoreChoice(c, money);
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    });
    return this.sim.decisions.choose(best);
  }

  note(ev) {
    const st = this.state;
    st.built = (st.built || 0) + 1;
    st.log.unshift({ day: this.city.day, type: ev.type, x: ev.x, y: ev.y, n: ev.n || 1, rebuilt: !!ev.rebuilt });
    if (st.log.length > LOG_KEEP) st.log.length = LOG_KEEP;
  }
}

// How good a choice looks to a careful mayor: growth and happiness are good, spending is weighed
// against what the town has, and income helps a poor town most.
export function scoreChoice(c, money) {
  let s = 0;
  if (c.growth) s += (c.growth[0] - 1) * 6 * Math.min(c.growth[1], 6);
  if (c.spirit) s += c.spirit[0] * 40 * Math.min(c.spirit[1], 8);
  if (c.cost) s -= (c.cost / Math.max(500, money)) * 6;
  if (c.gain) s += (c.gain / Math.max(500, money)) * 6;
  if (c.build) s += 1.5;
  if (c.fun) s += c.fun * 3;
  if (c.tax) s += (c.tax - 1) * (money < 1500 ? 8 : -4);
  if (c.prepare || c.levee || c.resilience) s += 1;
  if (c.hurry) s += 0.5;
  return s;
}
