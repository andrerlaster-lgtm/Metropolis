// Run with: node --test tests/
// Machine-gun nests (and every other armed defence): they pick a target in range by themselves, no
// soldier needed, hurt it by the numbers in militaryData.js, stop when destroyed or when nothing is in
// range, turn to face the target, and every shot is something the 3D view can draw (an aim for the gun
// and the muzzle flash, and a tracer that starts at the muzzle). The same holds in player-defence,
// computer-defence and auto-resolved battles. Playtesting found nests that seemed to sit idle: they
// were firing, but the battle never recorded which way the gun pointed, so the 3D view never turned the
// gun or showed a muzzle flash.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { CityState } = await import('../src/state.js');
const { generateTown } = await import('../src/generator.js');
const { Simulation } = await import('../src/simulation.js');
const { World } = await import('../src/world.js');
const { WarRoom } = await import('../src/warRoom.js');
const { Military } = await import('../src/military.js');
const { Battle, STEP } = await import('../src/battle.js');
const D = await import('../src/militaryData.js');
const { mulberry32 } = await import('../src/utils.js');
const G = await import('../src/view3d/gunfire.js');

function base(seed = 3) {
  const city = new CityState(32, 32);
  generateTown(city, seed);
  const sim = new Simulation(city);
  sim.refresh();
  const m = new Military(city, { economy: sim.economy, rand: mulberry32(1) });
  m.state.funds = 9999;
  return { city, sim, m };
}
const spot = (m, type) => {
  for (let y = 4; y < D.BASE_H - 2; y++) for (let x = 2; x < D.BASE_W; x++) if (!m.placeError(type, x, y)) return [x, y];
  return null;
};

// A battle with one nest, one frozen attacker at `dx, dy` from it, and the command post's own gun
// silenced, so what happens is the nest's doing alone. No soldier is posted anywhere.
function duel({ dx = 2, dy = 0, type = 'rifleman', level = 1, hp = 100000 } = {}) {
  const { m } = base();
  m.place('mg', ...spot(m, 'mg'));
  const spec = {
    seed: 7,
    auto: true,
    name: 'Test raid',
    map: m.layout(),
    attacker: { name: 'Them', waves: [{ at: 0, units: [{ id: 500, type, xp: 0 }] }] },
    defender: { name: 'Us', budget: 0, garrison: [], reserve: [] },
  };
  const b = new Battle(spec);
  b.step();
  const nest = b.structs.find((s) => s.type === 'mg');
  const hq = b.structs.find((s) => s.type === 'hq');
  nest.level = level;
  const enemy = b.units.find((u) => u.side === 'att');
  b.act = () => {}; // the attacker stands still
  enemy.x = nest.x + 0.5 + dx;
  enemy.y = nest.y + 0.5 + dy;
  enemy.hp = enemy.maxHp = hp;
  const shots = [];
  const addFx = b.addFx.bind(b);
  b.addFx = (f) => {
    if (f.kind === 'shot') shots.push({ ...f, t: b.t });
    return addFx(f);
  };
  const run = (seconds) => {
    const fired = [];
    for (let i = 0; i < Math.round(seconds / STEP); i++) {
      const before = nest.fired;
      hq.cd = 1e9;
      b.step();
      if (nest.fired !== before) fired.push(b.t);
    }
    return fired;
  };
  return { b, nest, hq, enemy, shots, run };
}

test('a nest on its own fires at an enemy in range and takes health off it, with no soldier posted', () => {
  const d = duel();
  const fired = d.run(5);
  assert.ok(fired.length >= 15, `${fired.length} shots in 5 seconds`);
  assert.equal(d.nest.tgt, d.enemy.id);
  const lost = 100000 - d.enemy.hp;
  assert.ok(lost > 0, 'the enemy is hurt');
  // A rifleman has no armour and a nest does 6 to a person ×1.15 against infantry: whole multiples of 6.9.
  const hits = lost / (6 * 1.15);
  assert.ok(Math.abs(hits - Math.round(hits)) < 1e-6, `${lost} is whole hits of 6.9`);
  assert.ok(hits >= 1 && hits <= fired.length, `${hits} hits from ${fired.length} shots`);
  assert.equal(d.b.garrisonCount ?? 0, 0);
});

test('damage follows the numbers: the infantry bonus, armour and upgrade levels', () => {
  const lost = (o) => {
    const d = duel(o);
    d.run(5);
    return 100000 - d.enemy.hp;
  };
  const perHit = (o, per) => lost(o) / per;
  const one = perHit({}, 6 * 1.15);
  assert.ok(Math.abs(one - Math.round(one)) < 1e-6);
  // A machine gunner has 1 armour: 6.9 − 1 per hit.
  const gun = perHit({ type: 'gunner' }, 6 * 1.15 - D.UNITS.gunner.armor);
  assert.ok(Math.abs(gun - Math.round(gun)) < 1e-6, 'armour is taken off every hit');
  // Level 3 hits 60% harder (levelDmg).
  const l3 = perHit({ level: 3 }, 6 * 1.15 * D.levelDmg(3));
  assert.ok(Math.abs(l3 - Math.round(l3)) < 1e-6);
});

test('range: it reaches the enemy up to its range plus half its size, and not beyond', () => {
  const reach = D.DEFENCES.mg.attack.range + 0.5;
  const edge = duel({ dx: reach - 0.05 });
  assert.ok(edge.run(3).length > 0, 'just inside');
  const out = duel({ dx: reach + 0.1 });
  assert.equal(out.run(3).length, 0, 'just outside');
  assert.equal(out.nest.tgt, null);
  assert.equal(100000 - out.enemy.hp, 0);
});

test('it stops when destroyed, and when nothing is left to shoot', () => {
  const d = duel();
  assert.ok(d.run(2).length > 0);
  d.nest.hp = 0;
  assert.equal(d.run(2).length, 0, 'a wrecked nest is silent');
  const e = duel();
  e.run(1);
  e.enemy.alive = false;
  assert.equal(e.run(2).length, 0, 'no valid target, no shots');
  assert.equal(e.nest.tgt, null);
});

test('the nest fires at the rate in militaryData.js (a step is 0.05 s, so about 3 to 4 shots a second)', () => {
  const d = duel();
  const n = d.run(10).length;
  assert.ok(n >= 30 && n <= 40, `${n} shots in 10 seconds (rated ${D.DEFENCES.mg.attack.rate} a second)`);
});

test('the gun turns to face its target and follows it round', () => {
  const d = duel({ dx: 2, dy: 0 });
  d.run(0.5);
  assert.ok(Number.isFinite(d.nest.aim), 'an aim is recorded');
  assert.ok(Math.abs(d.nest.aim - 0) < 1e-9, 'facing east');
  d.enemy.x = d.nest.x + 0.5;
  d.enemy.y = d.nest.y + 0.5 + 2;
  d.run(0.3);
  assert.ok(Math.abs(d.nest.aim - Math.PI / 2) < 1e-9, 'facing south (down the map) once the enemy moves there');
  d.enemy.x = d.nest.x + 0.5 - 1.5;
  d.enemy.y = d.nest.y + 0.5 - 1.5;
  d.run(0.3);
  assert.ok(Math.abs(d.nest.aim - Math.atan2(-1.5, -1.5)) < 1e-9);
});

test('every shot is drawable: a shot effect from the muzzle side of the nest, and a flash while it fires', () => {
  const d = duel();
  const fired = d.run(3);
  assert.equal(d.shots.length, fired.length, 'one shot effect for every shot fired');
  for (const s of d.shots) {
    assert.equal(s.side, 'def');
    assert.ok(Math.abs(s.x - (d.nest.x + 0.5)) < 1e-9 && Math.abs(s.y - (d.nest.y + 0.5)) < 1e-9, 'it starts at the nest');
    assert.ok(Number.isFinite(s.x2) && Number.isFinite(s.y2));
    assert.equal(s.struct, d.nest.id, 'and says which nest fired it');
  }
  // While a shot is fresh the 3D view gets a flash, in front of the gun; a while after, none.
  const f = G.flashOf(d.nest, d.nest.fired + 0.01);
  assert.ok(f, 'a muzzle flash right after a shot');
  const dist = Math.hypot(f.x - (d.nest.x + 0.5), f.z - (d.nest.y + 0.5));
  assert.ok(Math.abs(dist - G.MUZZLE_REACH.mg) < 1e-9, 'at the end of the barrel');
  assert.ok(f.y > 0.2 && f.y < 0.5, 'at gun height');
  assert.equal(G.flashOf(d.nest, d.nest.fired + 5), null, 'and none when the nest has been quiet');
  assert.equal(G.flashOf({ ...d.nest, hp: 0 }, d.nest.fired + 0.01), null, 'none from a wreck');
  assert.equal(G.flashOf({ ...d.nest, aim: undefined }, d.nest.fired + 0.01), null, 'none when the gun was never aimed (the old bug)');
});

test('a miss still looks like a shot, and the tracer runs from the muzzle to the target (or just past it)', () => {
  const d = duel();
  d.run(4);
  const ends = d.shots.map((s) => G.tracerOf(s, d.b.structs));
  for (const t of ends) {
    assert.ok(t.y0 > 0.2 && t.y0 < 0.5, 'leaves at gun height');
    assert.ok(Math.hypot(t.x0 - (d.nest.x + 0.5), t.z0 - (d.nest.y + 0.5)) > 0.3, 'from the muzzle, not the middle of the nest');
    assert.ok(Math.hypot(t.x1 - t.x0, t.z1 - t.z0) > 0.5, 'and travels well on');
  }
  assert.ok(ends.length > 5);
});

test('recoil: the gun kicks back when it fires and settles again', () => {
  const d = duel();
  d.run(0.5);
  assert.ok(G.recoilOf(d.nest, d.nest.fired) > 0.9);
  assert.ok(G.recoilOf(d.nest, d.nest.fired + 0.02) < G.recoilOf(d.nest, d.nest.fired));
  assert.equal(G.recoilOf(d.nest, d.nest.fired + 1), 0);
  assert.equal(G.recoilOf({ ...d.nest, fired: undefined }, 5), 0);
});

test('turning and flashes come for every armed defence, not only nests', () => {
  const { m } = base();
  m.place('mortar', ...spot(m, 'mortar'));
  m.place('bunker', ...spot(m, 'bunker'));
  const spec = { seed: 7, auto: true, name: 't', map: m.layout(), attacker: { name: 'Them', waves: [{ at: 0, units: [{ id: 500, type: 'rifleman', xp: 0 }] }] }, defender: { name: 'Us', budget: 0, garrison: [], reserve: [] } };
  const b = new Battle(spec);
  b.step();
  const hq = b.structs.find((s) => s.type === 'hq');
  const enemy = b.units.find((u) => u.side === 'att');
  b.act = () => {};
  enemy.hp = enemy.maxHp = 100000;
  enemy.x = hq.x + 1 + 2;
  enemy.y = hq.y + 1;
  for (let i = 0; i < 60; i++) b.step();
  assert.ok(Number.isFinite(hq.aim), 'the command post turns too');
  assert.ok(G.flashOf({ ...hq, fired: b.t }, b.t), 'and shows its own flash');
});

// ---- The same in every kind of battle ------------------------------------------------------------

function raidSpec(m, seed = 9) {
  const fit = m.fit();
  return {
    seed,
    auto: true,
    name: 'Test raid',
    map: m.layout(),
    attacker: { name: 'Them', waves: [{ at: 0, units: ['rifleman', 'rifleman', 'gunner', 'grenadier'].map((type, i) => ({ id: 500 + i, type, xp: 0 })) }] },
    defender: { name: 'Us', budget: 0, garrison: fit.filter((s) => s.post).map((s) => ({ id: s.id, type: s.type, xp: s.xp, x: s.post.x, y: s.post.y })), reserve: [] },
  };
}

test('player defence, computer defence and an auto-resolved battle all fire their nests and record the aim', () => {
  const { city, sim } = base(11);
  const world = new World(city, sim, { rand: mulberry32(11) });
  const war = new WarRoom(world, { rand: mulberry32(12) });
  const cpu = world.neighbours[0];
  for (const [name, mil] of [['your base', war.military], ['the computer’s base', cpu.military]]) {
    mil.state.funds = 9999;
    mil.place('mg', ...spot(mil, 'mg'));
    const b = new Battle(raidSpec(mil));
    const nest = b.structs.find((s) => s.type === 'mg');
    let shots = 0;
    for (let i = 0; i < 4000 && !b.over; i++) {
      const before = nest.fired;
      b.step();
      if (nest.fired !== before) shots++;
    }
    assert.ok(shots > 0, `${name}: the nest fired`);
    assert.ok(Number.isFinite(nest.aim), `${name}: the gun has an aim`);
    // resolve() runs the very same steps without the picture.
    const auto = new Battle(raidSpec(mil));
    const n2 = auto.structs.find((s) => s.type === 'mg');
    auto.resolve();
    assert.ok(n2.fired !== undefined && n2.fired > 0, `${name}: the auto-resolved battle fired it too`);
    assert.equal(n2.fired, nest.fired, 'stepped and auto-resolved battles agree to the shot');
  }
});

test('drawing details never change a battle: the same start gives the same result', () => {
  const { m } = base(5);
  m.place('mg', ...spot(m, 'mg'));
  const a = new Battle(raidSpec(m)).resolve();
  const b = new Battle(raidSpec(m)).resolve();
  assert.deepEqual(a, b);
});
