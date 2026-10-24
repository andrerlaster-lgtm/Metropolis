// Run with: node --test tests/
// The military: a permanent base with defences and soldiers paid from a military budget, battles
// that are the same every time from the same start (so they can be saved half-way and fought out
// with nobody watching), and raids from the computer's town that leave real consequences.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { CityState } = await import('../src/state.js');
const { generateTown } = await import('../src/generator.js');
const { Simulation } = await import('../src/simulation.js');
const { World } = await import('../src/world.js');
const { Military, START_FUNDS } = await import('../src/military.js');
const { Battle, TIME_LIMIT, HQ_LOST } = await import('../src/battle.js');
const { WarRoom, WARN_DAYS } = await import('../src/warRoom.js');
const D = await import('../src/militaryData.js');
const { mulberry32 } = await import('../src/utils.js');
const P = await import('../src/persistence.js');

function base(seed = 1) {
  const city = new CityState(24, 24);
  const sim = new Simulation(city);
  const m = new Military(city, { economy: sim.economy, rand: mulberry32(seed) });
  return { city, sim, m };
}

function homeWorld(seed = 3) {
  const city = new CityState(32, 32);
  generateTown(city, seed);
  const sim = new Simulation(city);
  sim.refresh();
  const world = new World(city, sim, { rand: mulberry32(seed) });
  const war = new WarRoom(world, { rand: mulberry32(seed + 1) });
  return { city, sim, world, war };
}

// The first spot where a defence may go, scanning from (x, y).
function spot(m, type, x = 2, y = 4) {
  for (let yy = y; yy < D.BASE_H - 2; yy++) for (let xx = x; xx < D.BASE_W; xx++) if (!m.placeError(type, xx, yy)) return [xx, yy];
  return null;
}

// A raid party of the given types, as the battle needs it.
const party = (types, from = 500) => types.map((type, i) => ({ id: from + i, type, xp: 0 }));
function spec(m, { waves, seed = 7, auto = true, budget = 0 }) {
  const fit = m.fit();
  return {
    seed,
    auto,
    name: 'Test raid',
    map: m.layout(),
    attacker: { name: 'Them', waves },
    defender: {
      name: 'Us',
      budget,
      garrison: fit.filter((s) => s.post).map((s) => ({ id: s.id, type: s.type, xp: s.xp, x: s.post.x, y: s.post.y })),
      reserve: fit.filter((s) => !s.post).map((s) => ({ id: s.id, type: s.type, xp: s.xp })),
    },
  };
}

test('every town gets a base the first time it is needed, with a way in for attackers', () => {
  const { m, city } = base();
  assert.equal(city.systems.military, undefined, 'nothing is added until the base is used');
  const st = m.state;
  assert.equal(st.v, 1);
  assert.equal(st.funds, START_FUNDS);
  assert.equal(st.structures.length, 1);
  assert.equal(st.structures[0].type, 'hq');
  assert.ok(st.rocks.length > 0);
  assert.equal(st.soldiers.length, 3, 'three riflemen stand guard to begin with');
  assert.ok(st.soldiers.every((s) => s.post && s.status === 'ready'));
  assert.ok(m.routeOpen());
  // Plain data: it survives the save format unchanged.
  assert.deepEqual(JSON.parse(JSON.stringify(st)), st);
});

test('defences go where the rules allow, and the last way in can never be closed', () => {
  const { m } = base();
  m.state.funds = 10000;
  assert.match(m.placeError('mg', 4, 0), /edge the enemy comes from/);
  assert.match(m.placeError('mg', 4, D.BASE_H - 1), /reinforcement area/);
  const [rx, ry] = m.state.rocks[0];
  assert.match(m.placeError('mg', rx, ry), /rock/);
  assert.match(m.placeError('mg', D.HQ_AT.x, D.HQ_AT.y), /already built/);
  const post = m.state.soldiers[0].post;
  assert.match(m.placeError('mg', Math.floor(post.x), Math.floor(post.y)), /stands guard/);
  m.state.funds = 10;
  assert.match(m.placeError('mg', 4, 4), /Needs 160/);
  m.state.funds = 10000;
  // Wall off row 2 from side to side: the last gap is refused.
  const row = 2;
  const refused = [];
  for (let x = 0; x < D.BASE_W; x++) {
    if (m.occupied(x, row)) continue;
    const r = m.place('sandbags', x, row);
    if (r.error) refused.push(r.error);
  }
  assert.equal(refused.length, 1);
  assert.match(refused[0], /last way in/);
  assert.ok(m.routeOpen());
});

test('upgrades, repairs in the order you choose, and crews paid from the military budget', () => {
  const { m, city } = base();
  m.state.funds = 5000;
  const a = m.place('mg', ...spot(m, 'mg', 2, 6)).structure;
  const b = m.place('bunker', ...spot(m, 'bunker', 9, 6)).structure;
  const before = m.funds;
  assert.ok(!m.upgrade(a.id).error);
  assert.equal(a.level, 2);
  assert.equal(a.hp, D.maxHpOf('mg', 2));
  assert.equal(m.funds, before - D.upgradeCost('mg', 1));
  // Damage both; put the bunker first.
  a.hp = 50;
  b.hp = 100;
  assert.deepEqual(m.damaged().map((s) => s.id), [a.id, b.id], 'the worst first by default');
  m.prioritize(b.id, -Infinity);
  assert.deepEqual(m.damaged().map((s) => s.id), [b.id, a.id]);
  const funds = m.funds;
  city.clock += 0.25;
  m.update(0.25);
  assert.ok(b.hp > 100, 'the bunker is repaired first');
  assert.equal(a.hp, 50, 'the nest waits its turn');
  assert.ok(m.funds < funds, 'repairs cost money');
  // Rushing a repair costs half as much again.
  const cost = m.repairCost(a, true);
  assert.equal(cost, Math.ceil((D.maxHpOf('mg', 2) - 50) * D.repairRate('mg') * D.RUSH_REPAIR));
  assert.ok(!m.repairNow(a.id).error);
  assert.equal(a.hp, D.maxHpOf('mg', 2));
  // Taking something down gives half back.
  const r = m.remove(a.id);
  assert.ok(r.refund > 0);
  assert.ok(m.remove(m.hq.id).error, 'the command post stays');
});

test('the military budget: an automatic share of income, emergency transfers, and pay', () => {
  const { m, city, sim } = base();
  city.derived.economy = { net: 400, totalIn: 600, totalOut: 200 };
  sim.economy.state.money = 1000;
  const funds = m.funds;
  m.update(1);
  const pay = m.upkeep();
  assert.equal(Math.round(m.funds), Math.round(funds + 400 * 0.2 - pay));
  assert.equal(Math.round(sim.economy.money), 1000 - 80);
  m.setShare(0.9);
  assert.equal(m.state.share, 0.5, 'never more than half');
  assert.equal(m.transfer(250), 250);
  assert.equal(Math.round(sim.economy.money), 920 - 250);
  assert.equal(m.transfer(1e6), 670, 'only what the town has');
  // Nobody paid: wages fall behind and morale will suffer.
  m.state.funds = 0;
  m.setShare(0);
  m.update(2);
  assert.ok(m.state.unpaid >= 2);
  assert.ok(m.unpaidPenalty() > 0);
});

test('recruits train for a while; emergency recruits and specialists are ready at once; the army has a cap', () => {
  const { m, city } = base();
  m.state.funds = 10000;
  const t = m.recruit('rifleman').soldier;
  assert.equal(t.status, 'training');
  const t2 = m.recruit('rifleman').soldier;
  assert.ok(t2.until > t.until, 'one recruit after another');
  const e = m.recruit('gunner', { emergency: true }).soldier;
  assert.equal(e.status, 'ready');
  const medic = m.recruit('medic').soldier;
  assert.equal(medic.status, 'ready');
  assert.equal(m.recruitCost('gunner', { emergency: true }), Math.round(D.UNITS.gunner.cost * D.EMERGENCY));
  city.day += 2;
  m.update(0.01);
  assert.equal(t.status, 'ready');
  assert.equal(t2.status, 'ready');
  while (m.state.soldiers.length < m.armyCap) m.recruit('rifleman', { emergency: true });
  assert.match(m.recruitError('rifleman'), /holds/);
  // Posting soldiers on guard: limited by the command post too.
  const reserve = m.fit().filter((s) => !s.post);
  let posted = 0;
  for (const s of reserve) if (!m.station(s.id, 2 + posted, 8).error) posted++;
  assert.equal(m.garrison().length, m.garrisonCap);
});

test('a battle is the same every time from the same start, and resumes exactly from a save', () => {
  const { m } = base();
  m.state.funds = 5000;
  m.place('mg', 7, 10);
  m.recruit('rifleman', { emergency: true });
  m.recruit('medic');
  const s = spec(m, { waves: [{ at: 0, units: party(['rifleman', 'gunner', 'grenadier', 'rifleman']) }, { at: 30, units: party(['rifleman', 'grenadier', 'gunner'], 600) }], budget: 500 });
  const one = new Battle(s).resolve();
  const two = new Battle(s).resolve();
  assert.deepEqual(one, two);
  const b = new Battle(s);
  for (let i = 0; i < 500; i++) b.step();
  const saved = JSON.parse(JSON.stringify(b.toJSON()));
  const resumed = Battle.fromJSON(saved);
  assert.equal(resumed.paused, true, 'a resumed battle waits for the commander');
  assert.deepEqual(resumed.resolve(), b.resolve());
  assert.equal(Battle.fromJSON({ v: 99 }), null);
});

test('who wins: holding the base, losing the command post, and pulling out', () => {
  // A small raid against a garrison and a machine-gun nest: the base holds.
  const strong = base(2);
  strong.m.state.funds = 5000;
  strong.m.place('mg', 7, 11);
  strong.m.place('bunker', 9, 11);
  const held = new Battle(spec(strong.m, { waves: [{ at: 0, units: party(['rifleman', 'rifleman', 'rifleman']) }] })).resolve();
  assert.equal(held.winner, 'def');
  assert.ok(['repelled', 'withdrew'].includes(held.reason));
  assert.ok(held.attacker.lost > 0);
  // No soldiers and no armed defences: there is no defending army, so the raid wins as soon as it
  // arrives, without having to touch the command post.
  const empty = base(3);
  empty.m.state.soldiers = [];
  const b = new Battle(spec(empty.m, { waves: [{ at: 0, units: party(['grenadier', 'grenadier', 'grenadier', 'rifleman', 'rifleman', 'gunner']) }] }));
  const lost = b.resolve();
  assert.equal(lost.winner, 'att');
  assert.equal(lost.reason, 'army');
  assert.equal(lost.hqLost, false);
  assert.ok(b.hq.hp > 0);
  // Retreat ends it at once: lost, but nobody else falls.
  const r = base(4);
  const rb = new Battle(spec(r.m, { waves: [{ at: 0, units: party(['rifleman', 'rifleman']) }], auto: false }));
  for (let i = 0; i < 20; i++) rb.step();
  rb.retreat();
  assert.equal(rb.over, true);
  assert.equal(rb.result.winner, 'att');
  assert.equal(rb.result.reason, 'retreat');
  assert.equal(rb.result.defender.lost, 0);
  // Every battle ends: an attack that can't win runs out of time and withdraws.
  assert.ok(held.time <= TIME_LIMIT + 120);
});

test('reinforcements come one squad at a time, and orders given while paused wait', () => {
  const { m } = base(5);
  m.state.funds = 5000;
  for (let i = 0; i < 6; i++) m.recruit('rifleman', { emergency: true });
  const b = new Battle(spec(m, { waves: [{ at: 5, units: party(['rifleman']) }], auto: false }));
  const squads = b.squads.filter((q) => !q.deployed);
  assert.equal(squads.length, 2, 'six in reserve make two squads');
  assert.ok(!b.deploy(squads[0].id).error);
  assert.match(b.deployError(squads[1].id), /Next squad in/);
  assert.match(b.order(squads[1].id, { kind: 'hold' }).error, /Send the squad in first/);
  for (let i = 0; i < 60; i++) b.step();
  b.paused = true;
  const sq = squads[0];
  assert.ok(!b.order(sq.id, { kind: 'move', x: 3, y: 6 }).error);
  const where = b.livingIn(sq).map((u) => [u.x, u.y]);
  b.advance(2);
  assert.deepEqual(b.livingIn(sq).map((u) => [u.x, u.y]), where, 'nothing moves while paused');
  assert.ok(b.livingIn(sq).every((u) => u.mode === 'move'));
  b.paused = false;
  b.advance(0.5);
  b.advance(0.5);
  assert.notDeepEqual(b.livingIn(sq).map((u) => [u.x, u.y]), where, 'they set off when the battle resumes');
  // Artillery: paid from the budget the battle started with, then a cooldown.
  assert.match(b.strikeError(5, 5), /Needs 120/);
  b.budget.def = 500;
  assert.ok(!b.strike(5, 5).error);
  assert.match(b.strikeError(5, 5), /reloading/);
  assert.equal(b.spent.def, D.ARTILLERY.cost);
});

test('the computer raids with troops it paid for, warns ahead, and both towns live with the result', () => {
  const { city, sim, world, war } = homeWorld(5);
  const cpu = world.neighbours[0];
  assert.ok(cpu.military, 'the neighbour has a military too');
  assert.equal(cpu.military.state.share, 0.5);
  let warned = null;
  let arrived = null;
  war.onWarn = (r) => (warned = r);
  war.onArrive = (r) => (arrived = r);
  // Let the world run until the first raid arrives (gentle: not before day 3 of your base).
  sim.speed = 3;
  for (let i = 0; i < 40000 && !arrived; i++) {
    sim.update(0.1);
    world.update(0.1, sim.speed);
    war.update((0.1 * 3) / 300);
  }
  assert.ok(warned, 'a raid was announced');
  assert.ok(arrived === warned);
  assert.ok(city.day + city.clock >= war.military.state.since + 3);
  assert.ok(arrived.at - arrived.warnedAt >= WARN_DAYS - 1e-9);
  assert.ok(war.busy, 'the world waits while the raid is at the gates');
  const raiders = new Set(arrived.waves.flatMap((w) => w.units.map((u) => u.id)));
  assert.ok(cpu.military.state.soldiers.filter((s) => raiders.has(s.id)).every((s) => s.status === 'raiding'));
  const day = city.day;
  const report = war.autoResolve(arrived);
  assert.equal(war.busy, false);
  assert.equal(war.state.raids.length, 0);
  assert.ok(['held', 'lost'].includes(report.outcome));
  assert.equal(report.auto, true);
  // Their dead are gone from their army; the rest are home again.
  assert.equal(cpu.military.state.soldiers.filter((s) => s.status === 'raiding').length, 0);
  const back = cpu.military.state.soldiers.filter((s) => raiders.has(s.id)).length;
  assert.ok(back >= report.attackers.total - report.attackers.lost && back <= report.attackers.total, 'the fallen are gone, survivors and the wounded come home');
  assert.ok(war.military.state.protectedUntil > day, 'your base is protected for a while');
  assert.equal(war.military.state.log[0].kind, 'raid');
  assert.match(city.systems.chronicle.at(-1).text, /raided the military base/);
});

test('a raid that wins carries money off to the raider', () => {
  const { sim, world, war } = homeWorld(6);
  const cpu = world.neighbours[0];
  war.military.state.soldiers = []; // nobody home
  war.military.state.funds = 1000;
  for (let i = 0; i < 8; i++) cpu.military.addSoldier('grenadier');
  const raid = war.launch(cpu, cpu.military.fit());
  raid.status = 'arrived';
  const theirs = cpu.sim.economy.money;
  const ours = sim.economy.money;
  const report = war.autoResolve(raid);
  assert.equal(report.outcome, 'lost');
  assert.ok(report.you.loot > 0);
  assert.equal(Math.round(cpu.sim.economy.money - theirs), report.you.loot);
  assert.ok(war.military.funds < 1000);
  assert.ok(sim.economy.money <= ours);
  assert.equal(report.reason, 'army', 'an undefended base is lost to the raid, command post or not');
});

test('the base, the army and a battle in progress survive saving and loading', () => {
  const { city, sim, world, war } = homeWorld(7);
  const m = war.military;
  m.state.funds = 3000;
  m.place('mortar', 6, 9);
  m.recruit('gunner', { emergency: true });
  const cpu = world.neighbours[0];
  while (cpu.military.fit().length < 4) cpu.military.addSoldier('rifleman');
  const raid = war.launch(cpu, cpu.military.fit());
  raid.status = 'arrived';
  const battle = war.fight(raid);
  for (let i = 0; i < 200; i++) battle.step();
  m.state.battle = battle.toJSON();
  P.setActiveSlot(1);
  assert.ok(P.saveCity(city, 1));
  const back = P.loadCity(1);
  const sim2 = new Simulation(back);
  sim2.refresh();
  const world2 = new World(back, sim2);
  const war2 = new WarRoom(world2);
  assert.equal(war2.military.state.structures.length, m.state.structures.length);
  assert.equal(war2.military.state.soldiers.length, m.state.soldiers.length);
  assert.equal(world2.neighbours[0].military.state.soldiers.length, cpu.military.state.soldiers.length);
  const pending = war2.pending();
  assert.equal(pending?.id, raid.id);
  assert.equal(pending.status, 'fighting');
  const resumed = war2.fight(pending);
  assert.equal(resumed.t, battle.t, 'picks up where it stopped');
  void sim;
});

test('balance: every troop and defence does about the same damage per dollar', () => {
  const dps = (a) => a.dmg * a.rate * (a.splash ? 1.6 : 1);
  const rows = [];
  for (const [k, u] of Object.entries(D.UNITS)) if (!u.heal) rows.push([k, dps(u.attack) / u.cost]);
  for (const k of D.BUILDABLE) {
    const d = D.DEFENCES[k];
    if (d.attack) rows.push([k, dps(d.attack) / d.cost]);
  }
  const values = rows.map((r) => r[1]);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  assert.ok(hi / lo < 4, `damage per dollar spread too wide: ${rows.map(([k, v]) => `${k} ${v.toFixed(3)}`).join(', ')}`);
});

test('the computer builds and guards its own base with its own money, and always leaves a way in', () => {
  const { world, war } = homeWorld(8);
  const cpu = world.neighbours[0];
  const m = cpu.military;
  m.state.funds = 3000;
  while (m.state.soldiers.length < 8) m.addSoldier('rifleman');
  for (let i = 0; i < 12; i++) war.fortify(cpu);
  const built = m.state.structures.filter((s) => s.type !== 'hq');
  assert.ok(built.length >= 4, `built ${built.length}`);
  assert.ok(built.some((s) => D.DEFENCES[s.type].attack), 'armed defences, not only sandbags');
  assert.ok(m.funds < 3000);
  assert.ok(m.routeOpen());
  assert.ok(m.garrison().length >= 3, 'guards posted');
  // Guards stand next to the defences, and some soldiers stay free to raid.
  assert.ok(m.fit().some((s) => !s.post));
});

test('forward positions change hands when one side stands on them unopposed', () => {
  const { m } = base(9);
  m.state.soldiers = [];
  const b = new Battle(spec(m, { waves: [{ at: 0, units: party(['rifleman']) }], auto: false }));
  const p = b.points[0];
  assert.equal(p.owner, 'def');
  const u = b.units.find((x) => x.side === 'att') || (b.spawnWaves(), b.units.find((x) => x.side === 'att'));
  // Freeze the attacker on the post and let time pass.
  u.mode = 'hold';
  u.anchor = { x: p.x, y: p.y };
  u.x = p.x;
  u.y = p.y;
  const moraleBefore = b.morale.def;
  for (let i = 0; i < 160 && p.owner === 'def'; i++) b.step();
  assert.equal(p.owner, 'att');
  assert.ok(b.morale.def < moraleBefore);
  assert.ok(b.zones('att').some((z) => z.id === p.id), 'the attacker may now send squads in there');
});

test('you attack a computer base: your squads from their edge, and the result for both towns', () => {
  const { world, war } = homeWorld(10);
  const cpu = world.neighbours[0];
  const cm = cpu.military;
  cm.state.funds = 600;
  cm.place('mg', ...spot(cm, 'mg', 5, 9));
  const theirs = cm.state.soldiers.length;
  const m = war.military;
  // Not enough soldiers yet: only the starter guards, and they stay home unless asked.
  assert.match(war.attackError(cpu), /at least two/);
  m.state.funds = 5000;
  for (const t of ['rifleman', 'rifleman', 'gunner', 'grenadier', 'grenadier', 'rifleman', 'medic', 'gunner']) m.recruit(t, { emergency: true });
  const funds = m.funds;
  const { attack } = war.launchAttack(cpu);
  assert.ok(attack);
  assert.equal(war.busy, true, 'the world waits during the attack');
  const b = war.fight(attack);
  assert.equal(b.player, 'att');
  const mine = b.squads.filter((q) => q.side === 'att');
  assert.equal(mine.length, 2, 'eight soldiers make two squads');
  assert.deepEqual(b.zones('att').map((z) => z.id), ['left', 'centre', 'right']);
  assert.ok(!b.deploy(mine[0].id, 'left').error);
  assert.ok(b.livingIn(mine[0]).every((u) => u.y < 2 && u.x < D.BASE_W / 2), 'they come in at the left of the enemy edge');
  assert.match(b.deployError(mine[1].id), /Next squad/);
  // Leave the rest to your officers.
  const report = war.autoResolve(attack, b);
  assert.equal(report.kind, 'attack');
  assert.ok(['won', 'lost'].includes(report.outcome));
  assert.equal(war.busy, false);
  assert.equal(m.state.log[0].kind, 'attack');
  assert.ok(m.state.attackReadyAt > 0, 'your troops rest before the next attack');
  assert.match(war.attackError(cpu), /resting|recovering/);
  assert.ok(cm.state.protectedUntil > 0, 'their base is left alone for a while');
  // What happened stays: their losses, their damage, your spoils.
  assert.ok(cm.state.soldiers.length <= theirs);
  if (report.outcome === 'won') assert.ok(m.funds >= funds - report.you.spent);
  assert.equal(cm.state.log[0].kind, 'attacked');
});

test('destroying the command post never wins a battle by itself: only defeating or routing the army does', () => {
  // A raid on your base: the command post falls while your guards still stand.
  const { m } = base(11);
  const raid = new Battle(spec(m, { waves: [{ at: 0, units: party(['rifleman', 'rifleman']) }], auto: false }));
  raid.step();
  const morale = raid.morale.def;
  raid.damage(raid.hq, 1e6, null, null);
  raid.step();
  assert.equal(raid.hq.hp, 0);
  assert.equal(raid.over, false, 'the battle goes on');
  assert.ok(raid.morale.def <= morale - HQ_LOST + 1, 'but the defenders are badly shaken');
  const r1 = raid.resolve();
  assert.notEqual(r1.reason, 'hq');
  assert.equal(r1.hqLost, true);
  // Your attack: wrecking their command post leaves their army to beat.
  const { world, war } = homeWorld(12);
  const cpu = world.neighbours[0];
  const am = war.military;
  am.state.funds = 3000;
  for (let i = 0; i < 4; i++) am.recruit('rifleman', { emergency: true });
  const { attack } = war.launchAttack(cpu);
  const b = war.fight(attack);
  b.step();
  b.damage(b.hq, 1e6, null, null);
  b.step();
  assert.equal(b.over, false);
  assert.ok(b.units.some((u) => u.side === 'def' && u.alive) || b.routing, 'their soldiers fight on (or are breaking)');
  // Across many battles, no result is ever "the command post fell".
  for (let seed = 1; seed <= 12; seed++) {
    const t = base(seed);
    t.m.state.funds = 1000;
    t.m.place('mg', ...spot(t.m, 'mg', 6, 10));
    const r = new Battle(spec(t.m, { seed, waves: [{ at: 0, units: party(['grenadier', 'grenadier', 'gunner', 'rifleman', 'rifleman', 'grenadier', 'gunner']) }, { at: 20, units: party(['grenadier', 'rifleman', 'gunner', 'rifleman'], 700) }] })).resolve();
    assert.ok(['army', 'routed', 'repelled', 'withdrew'].includes(r.reason), r.reason);
  }
  void war.autoResolve(attack, b);
});

test('soldiers point their weapon at whoever they shoot, also while walking', () => {
  const { m } = base(13);
  m.state.funds = 3000;
  for (let i = 0; i < 4; i++) m.recruit('rifleman', { emergency: true });
  const b = new Battle(spec(m, { waves: [{ at: 0, units: party(['rifleman', 'rifleman', 'rifleman', 'gunner', 'rifleman', 'gunner']) }], auto: false }));
  let deployed = false;
  let shots = 0;
  let moving = 0;
  while (!b.over && b.t < 90) {
    // Send the squad in late, so it walks to its line with the enemy already in range.
    if (!deployed && b.units.some((u) => u.side === 'att' && u.alive && u.y > 7)) {
      b.deploy(b.squads.find((q) => q.side === 'def' && !q.deployed).id);
      deployed = true;
    }
    b.step();
    for (const u of b.units) {
      if (u.side !== 'def' || !u.alive || u.fired !== b.t || typeof u.tgt !== 'number') continue;
      const t = b.unit(u.tgt);
      const want = Math.atan2(t.y - u.y, t.x - u.x);
      const off = Math.abs(Math.atan2(Math.sin(want - u.aim), Math.cos(want - u.aim)));
      assert.ok(off < 0.01, `aim off by ${off}`);
      shots++;
      if (u.mode === 'move') moving++;
    }
  }
  assert.ok(shots > 10);
  assert.ok(deployed);
  void moving;
});
