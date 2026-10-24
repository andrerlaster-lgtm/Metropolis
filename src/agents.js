// Agents: cars and pedestrians that make the simulation visible. They read the city and are never
// directly controlled. Positions are in grid units; the renderer decides how they look.

import { CAR_COLORS, SHIRT_COLORS, SKIN_TONES, STRUCTURES } from './config.js';
import { DIRS } from './state.js';
import { pick, pickWeighted } from './utils.js';
import { SidewalkNetwork } from './sidewalks.js';

const MAX_CARS = 70;
const MAX_WALKERS = 90;
const MAX_TOWN_WALKERS = 14;
const CART_COLORS = ['#b88a5a', '#a87a52', '#c99b6a', '#9b7a5f'];
const HORSE_COLORS = ['#8a5d3b', '#6f4a33', '#c9a27a', '#4e3a2e', '#e8dccb'];
const VINTAGE_COLORS = ['#3d3a4f', '#5b4a6e', '#7a3f3f', '#2f4a4a', '#6b5a3a'];

// How busy commuting is at this time of day: morning and evening rush hours, quiet nights.
export function commuteActivity(clock) {
  const peak = (c, w) => Math.exp(-(((clock - c) / w) ** 2));
  return Math.min(1, 0.12 + 0.88 * peak(0.33, 0.05) + 0.88 * peak(0.73, 0.05) + 0.3 * peak(0.52, 0.12));
}

export class AgentSystem {
  constructor(city) {
    this.city = city;
    this.cars = [];
    this.walkers = [];
    this.time = 0;
    this._carTimer = 0;
    this._walkTimer = 0;
    this.hero = null; // the Life Story character, when they are out and about
    this.paths = new SidewalkNetwork(city);
    this._heroWait = 1;
    city.on((ev) => {
      if (ev.type === 'reset' || ev.type === 'loaded') this.clear();
    });
  }

  clear() {
    this.cars.length = 0;
    this.walkers.length = 0;
    this.hero = null;
  }

  update(dt, daylight) {
    this.time += dt;
    this._carTimer -= dt;
    this._walkTimer -= dt;
    this.updateCars(dt, daylight);
    this.updateWalkers(dt, daylight);
    this.updateHero(dt, daylight);
  }

  get commuters() {
    return this.cars.filter((c) => c.route && !c.leaving).length;
  }

  // ---- Cars -------------------------------------------------------------

  // Cruising cars scale with the road network; commuters follow the labor market's routes.
  desiredCars(daylight) {
    let roads = 0;
    for (const t of this.city.tiles) if (t.roadMask) roads++;
    if (roads < 2) return { cruising: 0, commuting: 0 };
    const cruising = Math.round(
      Math.min(Math.floor(roads / 6), 2 + Math.floor(this.city.stats.population / 25), 20) * (0.35 + 0.65 * daylight)
    );
    const employed = this.city.derived.labor?.employed || 0;
    const commuting = Math.round(Math.min(MAX_CARS - 20, employed / 5) * commuteActivity(this.city.clock));
    return { cruising, commuting };
  }

  updateCars(dt, daylight) {
    const want = this.desiredCars(daylight);
    const active = this.cars.filter((c) => !c.leaving);
    const commuting = active.filter((c) => c.route).length;
    const cruising = active.length - commuting;
    if (this._carTimer <= 0) {
      if (commuting < want.commuting && this.spawnCommuter()) this._carTimer = 0.18;
      else if (cruising < want.cruising) {
        this.spawnCar();
        this._carTimer = 0.4;
      } else if (cruising > want.cruising) {
        active.find((c) => !c.route).leaving = true;
        this._carTimer = 0.6;
      }
    }
    // Tiles where someone is crossing the street right now: cars wait before driving into them.
    this.crossing = new Set();
    for (const w of this.walkers) if (!w.leaving && w.cross?.[w.i] && w.s > 0) this.crossing.add(w.pts[w.i].k);
    for (const c of this.cars) this.stepCar(c, dt);
    this.cars = this.cars.filter((c) => !c.dead);
  }

  // What drives on the roads depends on the era: horse carts first, then early motor cars.
  vehicle() {
    const era = this.city.systems.era?.index ?? 3;
    const cartOdds = [1, 0.55, 0.12, 0, 0][era] ?? 0;
    if (Math.random() < cartOdds) return { kind: 'cart', cartColor: pick(CART_COLORS), horse: pick(HORSE_COLORS) };
    if (era <= 2 && Math.random() < 0.6) return { color: pick(VINTAGE_COLORS) };
    return {};
  }

  // Pick a commute weighted by how many people make it. Mornings head to work, evenings home.
  spawnCommuter() {
    const flows = this.city.derived.labor?.flows;
    if (!flows || !flows.length) return false;
    const flow = pickWeighted(flows, (f) => (f.path.length > 1 ? f.count : 0));
    if (!flow) return false;
    const W = this.city.width;
    const homeward = this.city.clock > 0.55 || (this.city.clock > 0.42 && Math.random() < 0.5);
    const route = (homeward ? flow.path.slice().reverse() : flow.path).map((k) => ({ x: k % W, y: Math.floor(k / W) }));
    const [a, b] = route;
    this.cars.push({
      x: a.x,
      y: a.y,
      px: a.x,
      py: a.y,
      nx: b.x,
      ny: b.y,
      route,
      ri: 1,
      t: 0,
      speed: 1.1 + Math.random() * 0.5,
      color: pick(CAR_COLORS),
      alpha: 0,
      leaving: false,
      dead: false,
      ...this.vehicle(),
    });
    return true;
  }

  spawnCar() {
    const roads = this.city.tiles.filter((t) => t.roadMask);
    if (!roads.length) return;
    const start = pick(roads);
    const next = pick(this.city.roadNeighbors(start.x, start.y));
    this.cars.push({
      x: start.x,
      y: start.y,
      px: start.x,
      py: start.y,
      nx: next.x,
      ny: next.y,
      t: Math.random() * 0.5,
      speed: 0.9 + Math.random() * 0.5,
      color: pick(CAR_COLORS),
      alpha: 0,
      leaving: false,
      dead: false,
      ...this.vehicle(),
    });
  }

  stepCar(c, dt) {
    const city = this.city;
    if (!city.isRoad(c.x, c.y) || !city.isRoad(c.nx, c.ny)) c.leaving = true; // road was bulldozed under it
    c.alpha = c.leaving ? c.alpha - dt * 2.5 : Math.min(1, c.alpha + dt * 2);
    if (c.leaving && c.alpha <= 0) {
      c.dead = true;
      return;
    }
    if (!city.isRoad(c.nx, c.ny)) return;
    // Stop for people on the crossing ahead.
    if (c.t > 0.45 && this.crossing?.has(c.ny * city.width + c.nx) && (c.held = (c.held || 0) + dt) < 4) return;
    c.held = 0;
    // Busy roads slow everyone down.
    const jam = city.getTile(c.x, c.y)?.congestion || 0;
    c.t += c.speed * (c.kind === 'cart' ? 0.55 : 1) * (1 - 0.55 * jam) * dt;
    while (c.t >= 1) {
      c.t -= 1;
      c.px = c.x;
      c.py = c.y;
      c.x = c.nx;
      c.y = c.ny;
      if (c.route) {
        const next = c.route[++c.ri];
        if (!next || !city.isRoad(next.x, next.y)) {
          c.leaving = true; // arrived
          c.t = 0;
          c.nx = c.x + (c.x - c.px);
          c.ny = c.y + (c.y - c.py);
          if (!city.isRoad(c.nx, c.ny)) {
            c.nx = c.x;
            c.ny = c.y;
          }
          break;
        }
        c.nx = next.x;
        c.ny = next.y;
        continue;
      }
      const options = city.roadNeighbors(c.x, c.y).filter((n) => !(n.x === c.px && n.y === c.py));
      const next = options.length ? pick(options) : { x: c.px, y: c.py };
      if (!city.isRoad(next.x, next.y)) {
        c.leaving = true;
        c.t = 0;
        break;
      }
      c.nx = next.x;
      c.ny = next.y;
    }
  }

  // Grid-space pose of a car, keeping to the right-hand lane.
  carPose(c) {
    const dx = c.nx - c.x;
    const dy = c.ny - c.y;
    const lane = 0.16;
    return {
      gx: c.x + dx * c.t + 0.5 - dy * lane,
      gy: c.y + dy * c.t + 0.5 + dx * lane,
      dx,
      dy,
    };
  }

  // ---- Pedestrians -----------------------------------------------------
  // People walk the sidewalk network (sidewalks.js): along the kerbs, over zebra crossings and through
  // parks, never through buildings. Each walk has a purpose that suits the hour: the commute on foot,
  // errands to shops and the library, school runs, or a stroll to the park. Both views draw the same
  // walkers from the fields set here (gx, gy, heading, moving, alpha and their look).

  desiredWalkers(daylight) {
    const pop = this.city.stats.population;
    const w = this.city.derived.weather;
    const shelter = 1 - 0.55 * (w?.rain || 0) - 0.4 * (w?.snow || 0);
    return Math.round(Math.min(MAX_WALKERS, pop / 3.5) * (0.15 + 0.85 * daylight) * shelter);
  }

  updateWalkers(dt, daylight) {
    const active = this.walkers.filter((w) => !w.leaving).length;
    if (active < this.desiredWalkers(daylight) && this._walkTimer <= 0) {
      this.spawnWalker();
      this._walkTimer = 0.3;
    }
    for (const w of this.walkers) this.stepWalker(w, dt);
    this.walkers = this.walkers.filter((w) => !w.dead);
  }

  spawnWalker() {
    const clock = this.city.clock;
    if (Math.random() < 0.45 * commuteActivity(clock) && this.spawnCommuteWalk()) return;
    const homes = this.city.homes().filter((h) => h.structure.residents > 0);
    const home = pickWeighted(homes, (h) => h.structure.residents);
    if (!home) return;
    const child = Math.random() < 0.18;
    const route = this.findOuting(home, { child });
    if (!route) return;
    const end = route.points[route.points.length - 1];
    const inside = !!end.door;
    this.walkers.push(this.walker(route, { home, child, look: makeLook(child), errand: inside }));
  }

  // Someone who lives close to work walks there in the morning and home again in the evening.
  spawnCommuteWalk() {
    const flows = this.city.derived.labor?.flows;
    if (!flows?.length) return false;
    const flow = pickWeighted(flows, (f) => (f.path.length <= 10 ? f.count : 0));
    if (!flow) return false;
    const W = this.city.width;
    const home = { x: flow.from % W, y: Math.floor(flow.from / W) };
    const job = { x: flow.to % W, y: Math.floor(flow.to / W) };
    const homeward = this.city.clock > 0.55;
    const route = homeward ? this.paths.route(job, home, 14) : this.paths.route(home, job, 14);
    if (!route) return false;
    this.walkers.push(this.walker(route, { home: homeward ? job : home, look: makeLook(false), oneWay: true }));
    return true;
  }

  // A new walker at the start of a route.
  walker(route, { home, dest = null, look, child = false, oneWay = false, speed = 0.5 + Math.random() * 0.3, ...extra }) {
    const p = route.points[0];
    return {
      home: { x: home.x, y: home.y },
      dest: dest ? { x: dest.x, y: dest.y } : null,
      pts: route.points,
      cross: route.crossings,
      i: 0,
      s: 0,
      state: 'out',
      wait: 0,
      speed: child ? speed * 1.1 : speed,
      lane: 0.018 + Math.random() * 0.022, // how far right of the walking line they keep
      shirt: look.shirt,
      skin: look.skin,
      hair: look.hair,
      pants: look.pants,
      hat: look.hat,
      build: look.build,
      phase: Math.random() * Math.PI * 2,
      alpha: 0,
      gx: p.x,
      gy: p.y,
      heading: 0,
      moving: true,
      leaving: false,
      dead: false,
      child,
      oneWay,
      ...extra,
    };
  }

  // ---- Townsfolk -------------------------------------------------------------------

  // A named resident heads somewhere new this hour: show the walk if it's a short one on foot.
  townTrip(trip, person) {
    if (!person || this.walkers.length >= MAX_WALKERS) return;
    if (this.walkers.filter((w) => w.townId && !w.leaving).length >= MAX_TOWN_WALKERS) return;
    for (const w of this.walkers) if (w.townId === person.id) w.leaving = true; // they've moved on
    if (Math.abs(trip.from.x - trip.to.x) + Math.abs(trip.from.y - trip.to.y) > 16) return; // they drove
    const route = this.paths.route(trip.from, trip.to, 24);
    if (!route || route.points.length < 2) return;
    const end = this.city.getTile(trip.to.x, trip.to.y);
    const child = person.age < 13;
    const look = makeLook(child, person.look);
    this.walkers.push(
      this.walker(route, {
        home: trip.from,
        dest: trip.to,
        look,
        child,
        oneWay: true,
        speed: 0.6 + Math.random() * 0.25,
        townId: person.id,
        mood: person.mood,
        stay: !!end?.structure && !!STRUCTURES[end.structure.type].walkable, // parks: they hang around
      })
    );
  }

  // ---- The Life Story character ----------------------------------------------------

  // The character walks their real routes: to work by day if they have a job, otherwise out to a
  // park or playground, then home again. Babies stay in.
  updateHero(dt, daylight) {
    const c = this.city.systems.life?.char;
    const home = c?.alive && c.age >= 3 ? c.home : null;
    const h = this.hero;
    if (h && (h.dead || !home || h.home.x !== home.x || h.home.y !== home.y)) {
      if (!h.dead) h.leaving = true;
      this.hero = null;
      this._heroWait = 1.5;
    }
    if (this.hero || !home) return;
    this._heroWait -= dt;
    if (this._heroWait > 0) return;
    this._heroWait = 3 + Math.random() * 4;
    const homeTile = this.city.getTile(home.x, home.y);
    if (!homeTile?.structure) return;
    const child = c.age < 13;
    let route = null;
    let dest = null;
    if (c.job && daylight > 0.5 && Math.random() < 0.7) {
      route = this.paths.route(home, c.job, 30);
      if (route) dest = c.job;
    }
    if (!route) route = this.findOuting(homeTile, { child, leisure: true });
    if (!route || route.points.length < 2) return;
    // Your main person looks as they do in the Life panel: no random hat.
    const look = makeLook(child, { shirt: c.look?.outfit || SHIRT_COLORS[0], skin: c.look?.skin || SKIN_TONES[0], hair: c.look?.hair || '#5b3a29', hat: null });
    const w = this.walker(route, { home, dest, look, child, speed: 0.85, hero: true, lane: 0.02, phase: 0 });
    this.hero = w;
    this.walkers.push(w);
  }

  // The tiles a walk from one building to another passes, or null when it's too far on foot.
  pathTo(from, to) {
    const route = this.paths.route(from, to, 30);
    if (!route) return null;
    const W = this.city.width;
    const tiles = [];
    for (const p of route.points) if (tiles[tiles.length - 1]?.k !== p.k) tiles.push({ k: p.k });
    return tiles.map(({ k }) => ({ x: k % W, y: Math.floor(k / W) }));
  }

  // Somewhere worth walking to from home, given the hour: shops and cafés by day, school in the
  // morning for children, parks and playgrounds any time, a friend's house now and then.
  findOuting(home, { child = false, leisure = false } = {}) {
    const clock = this.city.clock;
    const open = clock > 0.33 && clock < 0.8;
    const schoolRun = child && clock > 0.28 && clock < 0.45;
    return this.paths.outing(home, (t, d) => {
      if (d < 1.5) return 0;
      const type = t.structure?.type;
      let w;
      if (!type) w = 0.25;
      else if (type === 'park') w = 8;
      else if (type === 'playground') w = child ? 12 : 4;
      else if (type === 'field') w = child ? 7 : 5;
      else if (type === 'tree') w = 1.2;
      else if (leisure) w = type === 'cafe' ? 4 : 0;
      else if (type === 'school') w = schoolRun ? 30 : 0;
      else if (type === 'cafe' || type === 'bakery') w = open ? 6 : 0.5;
      else if (type === 'shop' || type === 'mall') w = open && !child ? 6 : 0;
      else if (type === 'library') w = open ? 3 : 0;
      else if (type === 'clinic') w = open && !child ? 0.6 : 0;
      else if (STRUCTURES[type].capacity && t.structure.residents > 0) w = child ? 0.6 : 0.9; // visiting
      else w = 0;
      return w / (1 + d * 0.12);
    });
  }

  // Is a car close to where a walker is about to cross?
  carNear(a, b) {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    for (const c of this.cars) {
      if (c.alpha < 0.3) continue;
      const p = this.carPose(c);
      if (Math.abs(p.gx - mx) < 0.75 && Math.abs(p.gy - my) < 0.75) return true;
    }
    return false;
  }

  stepWalker(w, dt) {
    const city = this.city;
    w.alpha = w.leaving ? w.alpha - dt * 2 : w.indoors ? w.alpha : Math.min(1, w.alpha + dt * 2);
    if (w.leaving && w.alpha <= 0) {
      w.dead = true;
      return;
    }
    const pts = w.pts;
    if (w.state === 'linger') {
      w.moving = false;
      w.wait -= dt;
      const end = pts[pts.length - 1];
      if (w.indoors) {
        // Inside the shop, school or workplace, hidden until it's time to come out.
        w.alpha = Math.max(0, w.alpha - dt * 3);
        w.gx = end.x;
        w.gy = end.y;
        if (w.wait > 0) return;
        w.indoors = false;
      } else {
        if (!this.paths.walkable(end.k)) w.leaving = true; // something was built where they stood
        // A slow wander about the spot: a park bench, the swings, under a tree.
        const drift = this.time * 0.35 + w.phase;
        const nx = end.x + Math.sin(drift) * 0.2;
        const ny = end.y + Math.cos(drift * 0.8) * 0.2;
        if (Math.abs(nx - w.gx) + Math.abs(ny - w.gy) > 1e-4) w.heading = Math.atan2(ny - w.gy, nx - w.gx);
        w.gx = nx;
        w.gy = ny;
        w.moving = Math.abs(Math.cos(drift)) > 0.4;
      }
      if (w.wait <= 0 && w.oneWay) {
        w.leaving = true;
        return;
      }
      if (w.wait <= 0) {
        w.state = 'back';
        w.pts = pts.slice().reverse();
        w.cross = w.cross.slice().reverse();
        w.i = 0;
        w.s = 0;
      }
      return;
    }
    const a = pts[w.i];
    const b = pts[w.i + 1];
    if (!b) {
      if (w.state === 'out') {
        w.state = 'linger';
        const type = city.tiles[a.k]?.structure?.type;
        w.wait = type === 'park' || type === 'playground' || type === 'field' ? 5 + Math.random() * 8 : 2 + Math.random() * 3;
        if (w.oneWay) {
          // Townsfolk stay out in parks a while and step inside cafés and homes.
          if (w.stay) w.wait = 8 + Math.random() * 6;
          else w.leaving = true;
        } else if (a.door) {
          w.indoors = true; // a shift at work, a lesson, the shopping
          w.wait = w.dest ? 10 + Math.random() * 6 : 4 + Math.random() * 6;
        }
      } else {
        w.leaving = true; // home again
      }
      return;
    }
    w.moving = true;
    this.stepAlong(w, w.speed * dt, dt);
    this.placeWalker(w);
  }

  // Walk `dist` grid units along the route. Each new stretch is checked first: something built or
  // washed out ahead turns them back, and at a crossing they wait at the kerb while a car goes by.
  stepAlong(w, dist, dt) {
    while (dist > 0) {
      const a = w.pts[w.i];
      const b = w.pts[w.i + 1];
      if (!b) return;
      if (w.s === 0) {
        if (!b.door && !this.paths.walkable(b.k)) {
          w.leaving = true;
          return;
        }
        if (w.cross[w.i] && (w.held || 0) < 2.5 && this.carNear(a, b)) {
          w.held = (w.held || 0) + dt;
          w.moving = false;
          return;
        }
        w.held = 0;
      }
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (w.s + dist < len) {
        w.s += dist;
        return;
      }
      dist -= len - w.s;
      w.i++;
      w.s = 0;
    }
  }

  // Position on the current stretch, kept a little to the walker's right so people pass each other,
  // eased in near doors and around corners.
  placeWalker(w) {
    const p = w.pts[w.i];
    const q = w.pts[w.i + 1] || p;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    const t = Math.min(1, w.s / len);
    let rx = -dy / len;
    let ry = dx / len;
    const o = w.pts[w.i - 1];
    if (o && w.s < 0.12) {
      const pl = Math.hypot(p.x - o.x, p.y - o.y) || 1;
      const k = w.s / 0.12;
      rx = rx * k + (-(p.y - o.y) / pl) * (1 - k);
      ry = ry * k + ((p.x - o.x) / pl) * (1 - k);
    }
    const fromDoor = p.door ? w.s : Infinity;
    const toDoor = q.door ? len - w.s : Infinity;
    const off = w.lane * Math.min(1, Math.min(fromDoor, toDoor) / 0.15);
    w.gx = p.x + dx * t + rx * off;
    w.gy = p.y + dy * t + ry * off;
    if (len > 1e-3 && q !== p) w.heading = Math.atan2(dy, dx);
  }
}

const PANTS_COLORS = ['#5b6a8f', '#3f4a66', '#7a6a5a', '#2f3a4a', '#8a8fa6', '#6d5a7a', '#4a5f55', '#b8a58c'];
const HAIR_COLORS = ['#3b2a20', '#5b3a29', '#8a5a3a', '#d9b46a', '#1f1a1a', '#a0522d', '#c9c3bb', '#e0c38a'];
const HAT_COLORS = ['#f2e6c9', '#6d5a7a', '#ff8f7e', '#3f4a66', '#7fc4ad', '#ffcf6e'];

// What someone looks like: shirt, trousers, hair, now and then a hat, and how tall and broad they are.
// `base` keeps the colours a named resident already has.
export function makeLook(child = false, base = {}) {
  return {
    shirt: base.shirt || pick(SHIRT_COLORS),
    skin: base.skin || pick(SKIN_TONES),
    hair: base.hair || (Math.random() < 0.85 ? pick(HAIR_COLORS) : null),
    pants: base.pants || pick(PANTS_COLORS),
    hat: base.hat !== undefined ? base.hat : Math.random() < 0.18 ? pick(HAT_COLORS) : null,
    build: child ? 0.68 + Math.random() * 0.1 : 0.9 + Math.random() * 0.2,
  };
}
