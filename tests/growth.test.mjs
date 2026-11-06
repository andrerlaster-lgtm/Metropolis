// Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { CityState } from '../src/state.js';
import { Simulation } from '../src/simulation.js';
import { generateSeed, generateTown } from '../src/generator.js';
import { ERAS, FOUNDING_YEAR, yearOf, buildsFor, eraForPopulation } from '../src/eras.js';
import { DECISIONS, effectTags } from '../src/decisions.js';
import { DAY_LENGTH_SECONDS } from '../src/config.js';
import { mulberry32 } from '../src/utils.js';

function seedTown(size = 32) {
  const city = new CityState(size, size);
  const center = generateSeed(city, 7);
  const sim = new Simulation(city);
  sim.economy.reset('land');
  sim.refresh();
  sim.eras.found();
  return { city, sim, center };
}

const runDays = (sim, days) => {
  for (let i = 0; i < (days * DAY_LENGTH_SECONDS) / 0.25; i++) sim.update(0.25);
};

test('a seed is a little crossroads with a few cottages on dry land', () => {
  const { city, center } = seedTown();
  const t = city.getTile(center.x, center.y);
  assert.equal(t.structure.type, 'road');
  assert.ok(city.homes().length >= 3);
  for (const h of city.homes()) assert.ok(city.accessRoad(h.x, h.y), 'every seed home is on a road');
});

test('the calendar starts in 1850 and a year passes each day', () => {
  const { city, sim } = seedTown();
  assert.equal(sim.eras.year, FOUNDING_YEAR);
  assert.equal(sim.eras.index, 0);
  city.day += 3;
  assert.equal(yearOf(city), FOUNDING_YEAR + 3);
  assert.equal(sim.eras.age, 3);
});

test('an era needs both people and years, and a decision can hurry it', () => {
  const { city, sim } = seedTown();
  const events = [];
  city.on((e) => e.type === 'era' && events.push(e));
  city.stats.population = ERAS[1].pop + 10;
  assert.equal(sim.eras.update(), null, 'not enough years yet');
  sim.eras.hurry(ERAS[1].years);
  assert.equal(sim.eras.update().id, 'railway');
  assert.equal(events.length, 1);
  assert.ok(buildsFor(1).includes('factory') && !buildsFor(0).includes('factory'));
  assert.equal(eraForPopulation(10_000), ERAS.length - 1);
});

test('an older town without eras starts in the era its size suggests', () => {
  const city = new CityState(32, 32);
  generateTown(city, 3);
  const sim = new Simulation(city);
  sim.refresh();
  assert.ok(sim.eras.index >= 1, `era ${sim.eras.index} for ${city.stats.population} people`);
  assert.equal(sim.eras.year, ERAS[sim.eras.index].nominal);
});

test('left to grow, a seed becomes a town: homes, streets, shops and a school', () => {
  const { city, sim } = seedTown();
  sim.growth.rng = mulberry32(3);
  sim.growth.on = true;
  const homes0 = city.homes().length;
  const roads0 = city.tiles.filter((t) => t.structure?.type === 'road').length;
  runDays(sim, 14);
  const count = (ty) => city.tiles.filter((t) => t.structure?.type === ty).length;
  assert.ok(city.homes().length > homes0 * 3, `homes ${homes0} → ${city.homes().length}`);
  assert.ok(count('road') > roads0, 'new streets');
  assert.ok(count('shop') + count('cafe') >= 1, 'somewhere to work and eat');
  assert.ok(city.stats.population > 40, `population ${city.stats.population}`);
  assert.ok(sim.economy.money >= 0);
  assert.ok((city.systems.chronicle || []).some((c) => c.kind === 'first'), 'firsts go in the town history');
});

test('growth only builds what the era allows, and nothing when it is off', () => {
  const { city, sim } = seedTown();
  assert.equal(sim.growth.allowed('tower'), false);
  assert.equal(sim.growth.allowed('cottage'), true);
  sim.growth.on = false;
  const before = JSON.stringify(city.tiles.map((t) => t.structure?.type || ''));
  runDays(sim, 2);
  assert.equal(JSON.stringify(city.tiles.map((t) => t.structure?.type || '')), before);
});

test("growth never spends the town's last dollar: it keeps two days of upkeep, at least $250", async () => {
  const { upkeepReserve } = await import('../src/growth.js');
  const { city, sim } = seedTown();
  const g = sim.growth;
  const keep = upkeepReserve(city);
  assert.ok(keep >= 250);
  const park = sim.economy.costOf('park');
  sim.economy.state.money = park + keep - 1;
  assert.equal(g.canPay('park'), false, 'one dollar short of the reserve');
  sim.economy.state.money = park + keep;
  assert.equal(g.canPay('park'), true);
  assert.equal(g.canPay('house'), true, 'homes are free, reserve or not');
  sim.economy.state.money = 0;
  assert.equal(g.canPay('house'), true);
});

test('growth keeps the way on from a dead end free for a new street', () => {
  const { city, sim, center } = seedTown();
  // The seed's east arm ends 3 tiles out: the next tile must stay free for the street to continue.
  const past = city.getTile(center.x + 4, center.y);
  assert.ok(sim.growth.reserved(past));
  assert.ok(!sim.growth.lots().includes(past));
});

test('decisions ask, apply their effects, and lapse to the last choice', () => {
  const { city, sim } = seedTown();
  city.stats.population = 40;
  const d = sim.decisions.ask('taxes');
  assert.equal(d.id, 'taxes');
  const money = sim.economy.money;
  sim.decisions.choose(1); // cut taxes
  assert.ok(sim.decisions.state.taxRate < 1);
  assert.ok(sim.growth.rate() > 0);
  assert.ok(sim.growth.state.boosts.some((b) => b.mult > 1));
  assert.equal(sim.economy.money, money);
  // A costly choice spends money and lifts town spirit.
  sim.decisions.ask('well');
  sim.decisions.choose(0);
  assert.equal(sim.economy.money, money - 400);
  sim.decisions.update();
  assert.ok(city.derived.spirit > 0);
  // Unanswered for a day: the last choice happens by itself.
  sim.decisions.ask('newcomers');
  city.day += 2;
  sim.decisions.update();
  assert.equal(sim.decisions.state.pending, null);
  assert.ok(city.systems.chronicle.at(-1).text.includes('No decision was made in time'));
  for (const dd of DECISIONS) for (const c of dd.choices) assert.ok(c.result && effectTags(c));
});

test('the main person passes the story to a child, or to a niece or nephew', () => {
  const { city, sim } = seedTown();
  sim.life.rng = mulberry32(9);
  const c = sim.life.create({ first: 'Ada', last: 'Park', look: {}, traits: ['calm', 'curious'] });
  c.age = 70;
  sim.life.die('old age');
  const heir = sim.life.heir();
  assert.ok(['niece', 'nephew', 'young relative'].includes(heir.relation));
  const next = sim.life.continueAsChild();
  assert.equal(next.last, 'Park');
  assert.equal(next.generation, 2);
  assert.ok(next.age >= 18);
  // With a child, the child carries on.
  next.children.push({ name: 'Mo Park', age: 20, pronouns: 'they', alive: true });
  sim.life.die('old age');
  assert.equal(sim.life.heir().relation, 'child');
  assert.equal(sim.life.continueAsChild().first, 'Mo');
  assert.equal(city.systems.life.char.generation, 3);
});

test('grown-ups in Life Story meet partners and have children over the years', () => {
  let partners = 0;
  let parents = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const { sim } = seedTown(16);
    sim.life.rng = mulberry32(seed);
    const c = sim.life.create({ first: 'Kai', last: 'Osei', look: {}, traits: ['outgoing', 'calm'] });
    c.age = 20;
    for (let y = 0; y < 25 && c.alive; y++) {
      c.pending = null;
      sim.life.birthday();
    }
    if (c.partner) partners++;
    if (c.children.length) parents++;
  }
  assert.ok(partners >= 7, `${partners} of 8 met someone`);
  assert.ok(parents >= 6, `${parents} of 8 had children`);
});
