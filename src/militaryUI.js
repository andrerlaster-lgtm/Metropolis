// The military base screen and the battle screen on top of the 3D field (view3d/battle3d.js).
//   Base: build defences (tap the field; the preview says why a spot won't do), upgrade, repair in
//   the order you choose, recruit and post soldiers, run the military budget and read the reports.
//   Battle: the raid comes in waves; your garrison holds its posts, you send in reserve squads, give
//   them orders (tap the field to move, or hold / charge / fall back), call artillery, pause to plan
//   (orders given while paused are carried out when it resumes), or pull out. The world waits.
//   Attack: the War tab sends your reserve against a computer town's base. You command the attacking
//   squads (sent in from the left, middle or right of their edge, or from a forward position you
//   hold); they defend with their guards, reserve and defences.
// All the rules live in military.js, battle.js and warRoom.js; this file only shows them.

import { DEFENCES, BUILDABLE, UNITS, UNIT_TYPES, MAX_LEVEL, upgradeCost, ARTILLERY, ARMY_CAP } from './militaryData.js';
import { TIME_LIMIT } from './battle.js';
import { titleOf, MAX_SHARE, RAID_LEVELS } from './military.js';
import { money } from './economy.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const SAVE_EVERY = 1; // seconds between battle snapshots written into the save
const ICON = {
  sandbags: '▤',
  mg: '⦿',
  bunker: '■',
  mortar: '◎',
  rifleman: 'R',
  gunner: 'G',
  grenadier: 'Gr',
  medic: '+',
};
const STATUS = { ready: 'Ready', training: 'Training', injured: 'Recovering', raiding: 'Away' };
const TABS = [
  ['build', 'Build'],
  ['troops', 'Troops'],
  ['war', 'War'],
  ['repairs', 'Repairs'],
  ['budget', 'Budget'],
  ['log', 'Log'],
];

export function inDays(d) {
  if (d <= 0) return 'now';
  const h = d * 24;
  if (h < 1) return 'within the hour';
  if (h < 36) return `in ${Math.round(h)} h`;
  return `in ${(Math.round(d * 2) / 2).toLocaleString()} days`;
}
const forDays = (d) => (d * 24 < 36 ? `${Math.max(1, Math.round(d * 24))} h` : `${(Math.round(d * 2) / 2).toLocaleString()} days`);

export class MilitaryScreen {
  // deps: { war: () → WarRoom, now: () → day + clock, cityMoney: () → number, toast, sound(name),
  //   load3d: () → Promise<module>, isTyping, onOpen(), onClose(), clock: () → text }
  constructor(deps) {
    this.d = deps;
    this.el = document.getElementById('military');
    this.btn = document.getElementById('btn-base');
    this.app = document.getElementById('app');
    this.open = false;
    this.tab = 'build';
    this.tool = null;
    this.selSoldier = null;
    this.selStruct = null;
    this.battle = null;
    this.raid = null;
    this.selSquad = null;
    this.targeting = false;
    this.speed = 1;
    this.view = null;
    this.loading = null;
    this.saveTimer = 0;
    this.uiTimer = 0;
    this.realT = 0;
    this.camMode = 'angled';
    this.confirmRetreat = 0;
    this.build();
    this.btn.addEventListener('click', () => (this.open ? this.close() : this.show()));
    // While the base is open it has the keyboard: the town's shortcuts don't fire behind it.
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    window.addEventListener(
      'keyup',
      (e) => {
        if (!this.open) return;
        this.view?.key(e.code, false);
      },
      true
    );
  }

  get war() {
    return this.d.war();
  }
  get m() {
    return this.war.military;
  }

  build() {
    this.el.innerHTML = `
      <div class="mil-stage" data-stage></div>
      <header class="mil-top glass">
        <div class="mil-title"><b>Military base</b><span data-town></span></div>
        <div class="mil-chips" data-chips></div>
        <div class="seg mil-cam" role="group" aria-label="Camera"><button type="button" data-cam="angled" aria-pressed="true">Angled</button><button type="button" data-cam="free" aria-pressed="false">Free</button></div>
        <button type="button" class="pill mil-close" data-close>Back to town</button>
      </header>
      <aside class="mil-panel glass" data-panel></aside>
      <div class="mil-hud" data-hud hidden></div>
      <div class="mil-hint glass" data-hint hidden></div>
      <section class="mil-card glass" data-card role="dialog" aria-modal="true" hidden></section>
      <p class="mil-no3d glass" data-no3d hidden>The 3D field can't run in this browser. You can still run the base from the panel, and leave battles to your officers.</p>`;
    this.$ = (k) => this.el.querySelector(`[data-${k}]`);
    this.el.addEventListener('click', (e) => this.onClick(e));
    // While a finger or the mouse is down on a panel, it isn't redrawn (so taps and slider drags land).
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.mil-panel, .mil-hud, .mil-card')) this.hold = true;
    });
    window.addEventListener('pointerup', () => setTimeout(() => (this.hold = false), 0));
    window.addEventListener('pointercancel', () => (this.hold = false));
    this.el.addEventListener('input', (e) => {
      if (e.target.dataset.share == null) return;
      this.m.setShare(Number(e.target.value) / 100);
      const label = e.target.parentElement.querySelector('span');
      if (label) label.textContent = `${Math.round(this.m.state.share * 100)}% of the town's income`;
    });
    this.el.addEventListener('change', (e) => {
      if (e.target.dataset.share != null) this.renderPanel(true);
    });
  }

  // ---- Opening and closing ------------------------------------------------------------------

  async show() {
    if (!this.open) {
      this.open = true;
      this.d.onOpen?.();
      this.el.hidden = false;
      this.app.classList.add('mode-military');
      this.btn.setAttribute('aria-pressed', 'true');
    }
    this.renderAll();
    await this.ensure3d();
    this.view?.show();
    this.view?.resize();
    this.frameView();
  }

  close() {
    if (!this.open) return;
    if (this.war.pending()) return this.d.toast('The enemy is at the gates. Defend the base or leave it to your officers first', 3000);
    this.open = false;
    this.tool = null;
    this.selSoldier = null;
    this.selStruct = null;
    this.view?.hide();
    this.el.hidden = true;
    this.app.classList.remove('mode-military');
    this.btn.setAttribute('aria-pressed', 'false');
    this.d.onClose?.();
  }

  // Another town was loaded: start the screen afresh (the war room re-reads the new save).
  reset() {
    this.battle = null;
    this.raid = null;
    this.tool = null;
    this.selSoldier = null;
    this.selStruct = null;
    this.selSquad = null;
    this.targeting = false;
    this.hideCard();
    if (this.open) {
      this.open = false;
      this.view?.hide();
      this.el.hidden = true;
      this.app.classList.remove('mode-military');
      this.btn.setAttribute('aria-pressed', 'false');
    }
    this._panel = this._hud = this._chips = '';
  }

  async ensure3d() {
    if (this.view || this.no3d) return this.view;
    if (!this.loading) {
      this.loading = this.d
        .load3d()
        .then((mod) =>
          mod.createBattleView({
            mount: (c) => this.$('stage').append(c),
            onTap: (x, y) => this.onTap(x, y),
            onHover: (x, y) => this.onHover(x, y),
            isTyping: this.d.isTyping,
          })
        )
        .catch((err) => {
          console.warn('Battle view failed to load', err);
          return null;
        });
    }
    const v = await this.loading;
    if (!v) {
      this.no3d = true;
      this.$('no3d').hidden = false;
      return null;
    }
    this.view = v;
    v.setModel(() => this.model());
    v.setCamera(this.camMode);
    window.addEventListener('resize', () => this.open && requestAnimationFrame(() => this.frameView()));
    return v;
  }

  // Centre the field in the space the bars and panels leave free, and fit it in.
  frameView({ fit = true } = {}) {
    const v = this.view;
    if (!v || !this.open) return;
    const box = this.el.getBoundingClientRect();
    const rect = (el) => (el && !el.hidden && el.offsetParent !== null ? el.getBoundingClientRect() : null);
    const insets = { top: 0, right: 0, bottom: 0, left: 0 };
    const tops = [this.el.querySelector('.mil-top'), this.battle ? this.el.querySelector('.mil-hud-top') : null];
    for (const el of tops) {
      const r = rect(el);
      if (r) insets.top = Math.max(insets.top, r.bottom - box.top + 6);
    }
    const panel = rect(this.battle ? null : this.$('panel'));
    if (panel) {
      // Beside the field on wide screens, under it on phones.
      if (panel.height > box.height * 0.6) insets.right = box.right - panel.left + 6;
      else insets.bottom = box.bottom - panel.top + 6;
    }
    const bottom = rect(this.battle ? this.el.querySelector('.mil-hud-bottom') : null);
    if (bottom) insets.bottom = Math.max(insets.bottom, box.bottom - bottom.top + 6);
    v.setInsets(insets);
    if (fit) v.fit();
  }

  // ---- What the 3D field shows ------------------------------------------------------------------

  model() {
    const b = this.battle;
    if (b) {
      const byId = new Map(b.units.map((u) => [u.id, u]));
      return {
        map: b.map,
        structs: b.structs.map((s) => {
          const t = byId.get(s.tgt);
          if (t) s._aim = Math.atan2(t.y - (s.y + s.h / 2), t.x - (s.x + s.w / 2));
          return { ...s, aim: s._aim ?? -Math.PI / 2 };
        }),
        units: b.units,
        shells: b.shells,
        fx: b.fx,
        t: b.t,
        mine: b.player,
        points: b.points,
      };
    }
    const lay = this.m.layout();
    const units = [];
    const st = this.m.state;
    const reserve = st.soldiers.filter((s) => !s.post && s.status === 'ready');
    for (const s of st.soldiers) {
      if (!s.post || s.status === 'training' || s.status === 'raiding') continue;
      units.push({ id: s.id, side: 'def', type: s.type, x: s.post.x, y: s.post.y, face: -Math.PI / 2, alive: s.status === 'ready', hp: 1, maxHp: 1 });
    }
    reserve.forEach((s, i) => {
      const x = 1.2 + (i % 8) * 0.55 + (i % 2) * 0.1;
      const y = lay.h - 1.4 + Math.floor(i / 8) * 0.55;
      units.push({ id: s.id, side: 'def', type: s.type, x, y, face: -Math.PI / 2 + Math.sin(this.realT * 0.4 + i) * 0.4, alive: true, hp: 1, maxHp: 1 });
    });
    return { map: lay, structs: lay.structures.map((s) => ({ ...s, aim: -Math.PI / 2 })), units, shells: [], fx: [], t: this.realT, mine: 'def', points: [] };
  }

  // ---- Every frame -----------------------------------------------------------------------------

  frame(dt) {
    if (!this.open) return;
    this.realT += dt;
    const b = this.battle;
    if (b && !b.over) {
      b.advance(dt * this.speed);
      this.saveTimer -= dt;
      if (this.saveTimer <= 0) {
        this.saveTimer = SAVE_EVERY;
        this.m.state.battle = b.toJSON();
      }
      if (b.over) this.finishBattle(false);
    }
    this.view?.frame(dt);
    this.uiTimer -= dt;
    if (this.uiTimer <= 0) {
      this.uiTimer = 0.25;
      if (this.battle) this.renderHud();
      else this.renderTop();
    }
  }

  // ---- Raids --------------------------------------------------------------------------------

  // A raid has reached the base (or a battle was left half-way): open the base and ask what to do.
  alarm(raid) {
    this.raid = raid;
    this.show();
    if (raid.kind === 'attack') {
      this.card(`
        <h2>⚔ Your attack on ${esc(raid.targetName)}</h2>
        <p>${raid.status === 'fighting' ? 'The battle was left half-way. Pick it up where it stopped, or let your officers finish it.' : `${raid.size} soldiers are ready to go.`}</p>
        <p class="mil-small">The world waits until the battle is over.</p>
        <div class="mil-card-actions">
          <button type="button" class="primary-btn" data-defend>${raid.status === 'fighting' ? 'Resume the attack' : 'Command the attack'}</button>
          <button type="button" class="pill" data-auto>Leave it to your officers</button>
        </div>`);
      return;
    }
    const g = this.m.garrison().filter((s) => s.status === 'ready').length;
    const r = this.m.fit().filter((s) => !s.post).length;
    const resume = raid.status === 'fighting' && this.m.state.battle;
    this.card(`
      <h2>⚔ ${esc(raid.fromName)} ${resume ? 'is still at the gates' : 'is attacking the base'}</h2>
      <p>${resume ? 'The battle was left half-way. Pick it up where it stopped, or let your officers finish it.' : `${raid.size} soldiers, coming in ${raid.waves.length} waves. You have ${g} on guard and ${r} in reserve.`}</p>
      <p class="mil-small">The world waits until the battle is over.</p>
      <div class="mil-card-actions">
        <button type="button" class="primary-btn" data-defend>${resume ? 'Resume the battle' : 'Defend the base'}</button>
        <button type="button" class="pill" data-auto>${resume ? 'Let your officers finish it' : 'Leave it to your officers'}</button>
      </div>`);
    this.d.sound?.('alert');
  }

  startBattle() {
    const raid = this.raid || this.war.pending();
    if (!raid) return;
    this.raid = raid;
    this.battle = this.war.fight(raid);
    this.battle.paused = false;
    this.saveTimer = 0;
    this.zone = null;
    this.selSquad = null;
    this.targeting = false;
    this.tool = null;
    this.selSoldier = null;
    this.selStruct = null;
    this.view?.setGhost(null);
    this.hideCard();
    this.renderAll();
    this.frameView();
  }

  autoBattle() {
    const raid = this.raid || this.war.pending();
    if (!raid) return;
    const report = this.war.autoResolve(raid, this.battle && !this.battle.over ? this.battle : null);
    this.battle = null;
    this.raid = null;
    this.showReport(report);
  }

  finishBattle() {
    const b = this.battle;
    const report = this.war.conclude(this.raid, b, { auto: false });
    this.lastBattle = b;
    this.showReport(report);
  }

  showReport(r) {
    if (r.kind === 'attack') return this.showAttackReport(r);
    const head = { held: 'The base held!', lost: 'The base fell', retreated: 'You pulled your troops out' }[r.outcome];
    const why =
      {
        repelled: `Every attacker was beaten back.`,
        withdrew: `Their attack broke and they withdrew.`,
        hq: `They destroyed the command post.`,
        army: `Your defenders were overwhelmed.`,
        routed: `Your troops' morale broke and they fell back.`,
        retreat: `You ordered the retreat. Nobody else fell.`,
      }[r.reason] || '';
    const list = (items) => (items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '');
    const you = r.you;
    const damage = you.damage.map((d) => `${d.label}: ${d.wrecked ? 'destroyed' : `${Math.round((d.hp / d.max) * 100)}% left`}`);
    this.card(`
      <h2 class="mil-${r.outcome}">${head}</h2>
      <p>${why} ${r.auto ? 'Your officers fought it for you.' : ''} ${r.time < 60 ? 'It was over in under a minute.' : `It lasted ${Math.round(r.time / 60)} min.`}</p>
      <div class="mil-report">
        <section><h3>${esc(r.from)}</h3><p>${r.attackers.lost} of ${r.attackers.total} soldiers fell${r.attackers.unsent ? `; ${r.attackers.unsent} never came` : ''}.</p></section>
        <section><h3>Your troops</h3><p>${you.fought} fought. ${you.killed.length ? `${you.killed.length} fell:` : 'Nobody fell.'}</p>${list(you.killed)}${you.injured.length ? `<p>Badly hurt, recovering for a few days:</p>${list(you.injured)}` : ''}${you.hurt.length ? `<p>Lightly hurt, back in a day:</p>${list(you.hurt)}` : ''}${you.promoted.length ? `<p>Promoted:</p>${list(you.promoted)}` : ''}</section>
        <section><h3>The base</h3>${damage.length ? list(damage) : '<p>No damage.</p>'}</section>
        <section><h3>Cost</h3><p>${you.spent ? `Artillery: ${money(you.spent)}. ` : 'No artillery used. '}${you.loot ? `They carried off ${money(you.loot)}.` : ''}</p></section>
      </div>
      <div class="mil-card-actions">
        <button type="button" class="primary-btn" data-done="base">Back to the base</button>
        <button type="button" class="pill" data-done="town">Back to town</button>
      </div>`);
    this.d.sound?.(r.outcome === 'held' ? 'cheer' : 'click');
  }

  showAttackReport(r) {
    const head = { won: 'Victory!', lost: 'The attack failed', retreated: 'You pulled your troops out' }[r.outcome];
    const why =
      {
        hq: 'You destroyed their command post and their defenders fled.',
        army: 'Their defenders and their defences were beaten.',
        routed: 'Their defenders broke and fled.',
        withdrew: 'Your troops’ attack broke, or ran out of supplies, and they fell back.',
        repelled: 'Every one of your squads was stopped.',
        retreat: 'You ordered the retreat. Nobody else fell.',
      }[r.reason] || '';
    const list = (items) => (items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '');
    const you = r.you;
    const damage = r.them.damage.map((d) => `${d.label}: ${d.wrecked ? 'destroyed' : `${Math.round((d.hp / d.max) * 100)}% left`}`);
    this.card(`
      <h2 class="mil-${r.outcome === 'won' ? 'held' : r.outcome}">${head}</h2>
      <p>${why} ${r.auto ? 'Your officers fought it for you.' : ''} ${r.time < 60 ? 'It was over in under a minute.' : `It lasted ${Math.round(r.time / 60)} min.`}</p>
      <div class="mil-report">
        <section><h3>${esc(r.target)}</h3><p>${r.them.lost} of their ${r.them.total} defenders fell.</p>${damage.length ? list(damage) : '<p>Their base wasn’t damaged.</p>'}</section>
        <section><h3>Your troops</h3><p>${you.sent} went, ${you.fought} fought. ${you.killed.length ? `${you.killed.length} fell:` : 'Nobody fell.'}</p>${list(you.killed)}${you.injured.length ? `<p>Badly hurt, recovering for a few days:</p>${list(you.injured)}` : ''}${you.hurt.length ? `<p>Lightly hurt, back in a day:</p>${list(you.hurt)}` : ''}${you.promoted.length ? `<p>Promoted:</p>${list(you.promoted)}` : ''}</section>
        <section><h3>Cost and spoils</h3><p>${you.spent ? `Artillery: ${money(you.spent)}. ` : 'No artillery used. '}${you.loot ? `You brought back ${money(you.loot)} to the military budget.` : ''}</p></section>
      </div>
      <div class="mil-card-actions">
        <button type="button" class="primary-btn" data-done="base">Back to the base</button>
        <button type="button" class="pill" data-done="town">Back to town</button>
      </div>`);
    this.d.sound?.(r.outcome === 'won' ? 'cheer' : 'click');
  }

  // The briefing before an attack: what you know of their base, and who goes.
  planAttack(id) {
    const c = this.war.byId(id);
    const err = this.war.attackError(c);
    const intel = this.war.intel().neighbours.find((n) => n.id === id);
    const party = this.war.attackParty();
    const guards = this.m.garrison().filter((s) => s.status === 'ready').length;
    const count = {};
    for (const s of party) count[s.type] = (count[s.type] || 0) + 1;
    const force = Object.entries(count)
      .map(([k, n]) => `${n} ${n > 1 ? UNITS[k].plural.toLowerCase() : UNITS[k].label.toLowerCase()}`)
      .join(', ');
    this.card(`
      <h2>Attack ${esc(c.entry.name)}</h2>
      <p>Their base: about ${intel.soldiers} soldiers (${intel.guards} on guard) and ${intel.defences} defences.</p>
      <p>${party.length ? `You'd send your reserve: ${force}.` : 'Nobody is in your reserve.'}</p>
      ${guards ? `<label class="mil-check"><input type="checkbox" data-with-guards> Send your ${guards} guards too (your base keeps its defences)</label>` : ''}
      <p class="mil-small">You win by beating their soldiers and defences, making them flee, or destroying their command post. Taking their forward positions lets your squads come in closer. The world waits while you fight.</p>
      ${err ? `<p class="mil-warn">${esc(err)}</p>` : ''}
      <div class="mil-card-actions">
        <button type="button" class="primary-btn" data-attack-go="${esc(id)}">Command the attack</button>
        <button type="button" class="pill" data-attack-auto="${esc(id)}">Leave it to your officers</button>
        <button type="button" class="pill" data-cancel>Not now</button>
      </div>`);
  }

  launch(id, auto) {
    const guards = !!this.$('card').querySelector('[data-with-guards]')?.checked;
    const r = this.war.launchAttack(this.war.byId(id), { guards });
    if (r.error) {
      this.d.toast(r.error, 3000);
      this.d.sound?.('nope');
      return;
    }
    this.raid = r.attack;
    if (auto) this.autoBattle();
    else this.startBattle();
  }

  card(html) {
    const c = this.$('card');
    c.innerHTML = html;
    c.hidden = false;
    c.querySelector('button')?.focus();
  }
  hideCard() {
    this.$('card').hidden = true;
  }

  // ---- Taps on the field --------------------------------------------------------------------

  onTap(x, y) {
    if (!this.$('card').hidden) return;
    if (this.battle) return this.tapBattle(x, y);
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    const m = this.m;
    if (this.tool) {
      const r = m.place(this.tool, tx, ty);
      if (r.error) {
        this.d.toast(r.error, 2600);
        this.d.sound?.('nope');
      } else this.d.sound?.('build');
      this.onHover(x, y);
      return this.renderAll();
    }
    if (this.selSoldier != null) {
      const s = m.state.soldiers.find((t) => t.id === this.selSoldier);
      const r = m.station(this.selSoldier, x, y);
      if (r.error) {
        this.d.toast(r.error, 2600);
        this.d.sound?.('nope');
      } else {
        this.d.toast(`${titleOf(s)} stands guard here now`, 2000);
        this.d.sound?.('click');
        this.selSoldier = null;
        this.view?.setGhost(null);
      }
      return this.renderAll();
    }
    const s = m.structureAt(tx, ty);
    if (s) {
      this.selStruct = s.id;
      this.tab = 'build';
      return this.renderAll();
    }
    const guard = m.state.soldiers.find((t) => t.post && Math.hypot(t.post.x - x, t.post.y - y) < 0.6);
    if (guard) {
      this.selSoldier = guard.id;
      this.tab = 'troops';
      return this.renderAll();
    }
    this.selStruct = null;
    this.renderAll();
  }

  maxOf(s) {
    return this.m.layout().structures.find((t) => t.id === s.id)?.maxHp || s.hp;
  }

  onHover(x, y) {
    if (!this.view || this.battle) return;
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (this.tool) {
      const d = DEFENCES[this.tool];
      this.view.setGhost({ x: tx, y: ty, w: d.w, h: d.h, valid: !this.m.placeError(this.tool, tx, ty), range: d.attack?.range, tall: 1 });
      const err = this.m.placeError(this.tool, tx, ty);
      this.hint(err ? `${d.label}: ${err}` : `${d.label}: tap to build for ${money(d.cost)}`);
    } else if (this.selSoldier != null) {
      const s = this.m.state.soldiers.find((t) => t.id === this.selSoldier);
      const err = this.m.stationError(s, x, y);
      this.view.setGhost({ x: tx, y: ty, w: 1, h: 1, valid: !err, tall: 0.12, range: s ? UNITS[s.type].attack.range : 0 });
      this.hint(err ? err : `Tap to post ${s ? titleOf(s) : 'them'} here`);
    }
  }

  tapBattle(x, y) {
    const b = this.battle;
    if (b.over) return;
    if (this.targeting) {
      const r = b.strike(x, y);
      if (r.error) this.d.toast(r.error, 2400);
      else this.d.sound?.('click');
      this.targeting = false;
      return this.renderHud(true);
    }
    // Tap a soldier of yours to pick their squad; tap the ground to send the picked squad there.
    let best = null;
    let bd = 0.7 * 0.7;
    for (const u of b.units) {
      if (u.side !== b.player || !u.alive || u.gone) continue;
      const d = (u.x - x) ** 2 + (u.y - y) ** 2;
      if (d < bd) {
        bd = d;
        best = u;
      }
    }
    if (best) {
      this.selSquad = best.squad;
      this.d.sound?.('click');
      return this.renderHud(true);
    }
    if (this.selSquad) {
      const r = b.order(this.selSquad, { kind: 'move', x, y });
      if (r.error) this.d.toast(r.error, 2200);
      else b.addFx({ kind: 'mark', x, y, r: 0.35, life: 0.6 });
      return this.renderHud(true);
    }
    this.d.toast('Tap one of your soldiers to pick their squad, then tap where they should go', 2600);
  }

  // ---- Buttons ----------------------------------------------------------------------------

  onClick(e) {
    const t = e.target.closest('button');
    if (!t || t.disabled) return;
    const ds = t.dataset;
    const m = this.m;
    if (ds.close != null) return this.close();
    if (ds.cam) {
      this.camMode = ds.cam;
      this.view?.setCamera(ds.cam);
      for (const b of this.el.querySelectorAll('[data-cam]')) b.setAttribute('aria-pressed', String(b.dataset.cam === ds.cam));
      return;
    }
    if (ds.defend != null) return this.startBattle();
    if (ds.auto != null) return this.autoBattle();
    if (ds.attackPlan) return this.planAttack(ds.attackPlan);
    if (ds.attackGo) return this.launch(ds.attackGo, false);
    if (ds.attackAuto) return this.launch(ds.attackAuto, true);
    if (ds.cancel != null) return this.hideCard();
    if (ds.done) {
      this.battle = null;
      this.raid = null;
      this.hideCard();
      this.tab = this.m.damaged().length ? 'repairs' : this.tab;
      this.renderAll();
      if (ds.done === 'town') this.close();
      else this.frameView();
      return;
    }
    if (ds.tab) {
      this.tab = ds.tab;
      this.tool = null;
      this.view?.setGhost(null);
      this.hint(null);
      return this.renderPanel(true);
    }
    if (ds.tool) {
      this.tool = this.tool === ds.tool ? null : ds.tool;
      this.selSoldier = null;
      this.selStruct = null;
      if (!this.tool) this.view?.setGhost(null);
      this.hint(this.tool ? `Tap the field to build a ${DEFENCES[this.tool].label.toLowerCase()}` : null);
      return this.renderPanel(true);
    }
    const id = Number(ds.id);
    const done = (r, ok) => {
      if (r?.error) {
        this.d.toast(r.error, 2600);
        this.d.sound?.('nope');
      } else {
        if (ok) this.d.toast(ok, 2000);
        this.d.sound?.('click');
      }
      this.renderAll();
    };
    if (ds.upgrade != null) return done(m.upgrade(id), 'Upgraded');
    if (ds.repairnow != null) return done(m.repairNow(id), 'Repaired');
    if (ds.remove != null) {
      const r = m.remove(id);
      this.selStruct = null;
      return done(r, r.error ? null : `Taken down: ${money(r.refund)} back`);
    }
    if (ds.prio) {
      m.prioritize(id, ds.prio === 'top' ? -Infinity : Number(ds.prio));
      return this.renderPanel(true);
    }
    if (ds.recruit) {
      const r = m.recruit(ds.recruit, { emergency: ds.emergency != null });
      return done(r, r.error ? null : r.soldier.status === 'training' ? `${UNITS[ds.recruit].label} in training: ready ${inDays(r.soldier.until - this.d.now())}` : `${titleOf(r.soldier)} joins the reserve`);
    }
    if (ds.soldier) {
      this.selSoldier = this.selSoldier === id ? null : id;
      this.tool = null;
      this.view?.setGhost(null);
      this.hint(this.selSoldier != null ? 'Tap the field to post them on guard' : null);
      return this.renderPanel(true);
    }
    if (ds.unpost != null) {
      m.unstation(id);
      this.selSoldier = null;
      return done(null, 'Back in the reserve');
    }
    if (ds.dismiss != null) {
      const s = m.state.soldiers.find((x) => x.id === id);
      if (t.dataset.sure !== '1') {
        t.dataset.sure = '1';
        t.textContent = 'Tap again to dismiss';
        return;
      }
      m.dismiss(id);
      this.selSoldier = null;
      return done(null, `${s ? titleOf(s) : 'The soldier'} has left the army`);
    }
    if (ds.transfer) {
      const n = m.transfer(Number(ds.transfer));
      return done(n ? null : { error: 'The town has no money to spare' }, n ? `${money(n)} moved to the military budget` : null);
    }
    if (ds.raids) {
      m.state.raids = ds.raids;
      return done(null, ds.raids === 'off' ? 'Raids are off: the neighbours leave your base alone' : ds.raids === 'fierce' ? 'Fierce: bigger raids, more often' : 'Gentle: the odd raid, with time to recover');
    }
    // Battle controls.
    const b = this.battle;
    if (!b) return;
    if (ds.pause != null) {
      b.paused = !b.paused;
      return this.renderHud(true);
    }
    if (ds.speed) {
      this.speed = Number(ds.speed);
      return this.renderHud(true);
    }
    if (ds.zone) {
      this.zone = ds.zone;
      return this.renderHud(true);
    }
    if (ds.deploy) {
      const zone = this.zone && b.zones(b.player).some((z) => z.id === this.zone && !z.contested) ? this.zone : null;
      const r = b.deploy(ds.deploy, zone);
      if (r.error) this.d.toast(r.error, 2200);
      else {
        this.selSquad = ds.deploy;
        this.d.sound?.('click');
      }
      return this.renderHud(true);
    }
    if (ds.squad) {
      this.selSquad = this.selSquad === ds.squad ? null : ds.squad;
      return this.renderHud(true);
    }
    if (ds.order && this.selSquad) {
      const r = b.order(this.selSquad, { kind: ds.order });
      if (r.error) this.d.toast(r.error, 2200);
      return this.renderHud(true);
    }
    if (ds.artillery != null) {
      const err = b.strikeError(0, 0);
      if (err) return this.d.toast(err, 2200);
      this.targeting = !this.targeting;
      return this.renderHud(true);
    }
    if (ds.retreat != null) {
      if (performance.now() - this.confirmRetreat > 3000) {
        this.confirmRetreat = performance.now();
        this.d.toast('Tap Retreat again to pull everyone out. The battle will be lost', 3000);
        return;
      }
      b.retreat();
      this.finishBattle();
    }
  }

  onKey(e) {
    if (!this.open || this.d.isTyping?.(e.target)) return;
    e.stopImmediatePropagation();
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (this.view?.key(e.code, true)) return e.preventDefault();
    if (e.code === 'Space' && this.battle && !this.battle.over && this.$('card').hidden) {
      e.preventDefault();
      this.battle.paused = !this.battle.paused;
      this.renderHud(true);
    } else if (e.code === 'Escape') {
      if (this.targeting || this.selSquad) {
        this.targeting = false;
        this.selSquad = null;
        this.renderHud(true);
      } else if (this.tool || this.selSoldier != null || this.selStruct != null) {
        this.tool = null;
        this.selSoldier = null;
        this.selStruct = null;
        this.view?.setGhost(null);
        this.hint(null);
        this.renderPanel(true);
      } else if (!this.battle) this.close();
    }
  }

  hint(text) {
    const h = this.$('hint');
    h.hidden = !text;
    if (text) h.textContent = text;
  }

  // ---- Drawing the panels ------------------------------------------------------------------------

  renderAll() {
    const inBattle = !!this.battle;
    this.$('panel').hidden = inBattle;
    this.$('hud').hidden = !inBattle;
    this.$('town').textContent = this.battle?.player === 'att' ? ` · attacking ${this.battle.names.def}` : ` · ${this.d.townName()}`;
    this.$('close').hidden = inBattle;
    if (inBattle) this.renderHud(true);
    else {
      this.renderTop();
      this.renderPanel(true);
    }
    this.view?.setSelected(inBattle ? this.squadIds() : this.selSoldier != null ? [this.selSoldier] : []);
  }

  renderTop() {
    const intel = this.war.intel();
    const chips = [`<span class="mil-chip" title="Military budget">${money(this.m.funds)}</span>`, `<span class="mil-chip">${esc(this.d.clock())}</span>`];
    if (intel.coming) chips.push(`<span class="mil-chip warn">⚔ ${esc(intel.coming.from)} attacks ${inDays(intel.coming.in)}</span>`);
    else if (intel.protectedFor > 0) chips.push(`<span class="mil-chip ok">Safe for ${forDays(intel.protectedFor)}</span>`);
    else chips.push(`<span class="mil-chip">${this.m.state.raids === 'off' ? 'Raids are off' : 'All quiet'}</span>`);
    const html = chips.join('');
    if (html !== this._chips) {
      this._chips = html;
      this.$('chips').innerHTML = html;
    }
    if (!this.battle) this.renderPanel(false);
  }

  // The panel redraws only when something it shows has changed (it's checked four times a second).
  renderPanel(force) {
    if (!force && this.hold) return;
    const html = this.panelHtml();
    if (!force && html === this._panel) return;
    this._panel = html;
    const p = this.$('panel');
    const scroll = p.querySelector('.mil-body')?.scrollTop || 0;
    p.innerHTML = html;
    const body = p.querySelector('.mil-body');
    if (body) body.scrollTop = scroll;
  }

  panelHtml() {
    const tabs = `<nav class="mil-tabs" role="tablist">${TABS.map(([k, label]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${this.tab === k}">${label}${k === 'repairs' && this.m.damaged().length ? ` <span class="mil-dot">${this.m.damaged().length}</span>` : ''}</button>`).join('')}</nav>`;
    const body = { build: () => this.buildHtml(), troops: () => this.troopsHtml(), war: () => this.warHtml(), repairs: () => this.repairsHtml(), budget: () => this.budgetHtml(), log: () => this.logHtml() }[this.tab]();
    return `${tabs}<div class="mil-body">${body}</div>`;
  }

  buildHtml() {
    const m = this.m;
    const sel = m.state.structures.find((s) => s.id === this.selStruct);
    let info = '';
    if (sel) {
      const d = DEFENCES[sel.type];
      const max = this.maxOf(sel);
      const upErr = m.upgradeError(sel);
      const rc = m.repairCost(sel, true);
      info = `<div class="mil-sel">
        <h3>${esc(d.label)} <small>level ${sel.level}${sel.level >= MAX_LEVEL ? ' (max)' : ''}</small></h3>
        <div class="mil-hp"><span style="width:${Math.round((sel.hp / max) * 100)}%"></span></div>
        <p class="mil-small">${sel.hp <= 0 ? 'Destroyed. Repair it to bring it back.' : `${Math.round(sel.hp)} of ${max} health`}${d.attack ? ` · range ${d.attack.range}` : ''}</p>
        <p class="mil-small">${esc(d.desc)}</p>
        <div class="mil-row">
          ${sel.level < MAX_LEVEL ? `<button type="button" class="pill" data-upgrade data-id="${sel.id}" ${upErr ? 'disabled' : ''} title="${esc(upErr || '')}">Upgrade ${money(upgradeCost(sel.type, sel.level))}</button>` : ''}
          ${rc ? `<button type="button" class="pill" data-repairnow data-id="${sel.id}">Repair now ${money(rc)}</button>` : ''}
          ${!d.fixed ? `<button type="button" class="pill" data-remove data-id="${sel.id}">Take down (+${money(m.refundOf(sel))})</button>` : ''}
        </div></div>`;
    }
    const items = BUILDABLE.map((k) => {
      const d = DEFENCES[k];
      const a = d.attack;
      const stats = a ? `${a.kind === 'shell' ? 'lobs shells' : 'fires'} · range ${a.range}` : 'blocks the way · cover';
      return `<button type="button" class="mil-item${this.tool === k ? ' is-on' : ''}" data-tool="${k}" aria-pressed="${this.tool === k}">
        <span class="mil-ico">${ICON[k]}</span><span class="mil-item-text"><b>${esc(d.label)}</b><small>${stats} · ${d.hp} health</small></span><span class="mil-cost${m.canPay(d.cost) ? '' : ' short'}">${money(d.cost)}</span></button>`;
    }).join('');
    return `${info}<p class="mil-small">Pick a defence, then tap the field. Attackers come from the red edge; there must always be a way from it to your command post. Tap something you've built to upgrade, repair or take it down.</p><div class="mil-list">${items}</div>`;
  }

  troopsHtml() {
    const m = this.m;
    const st = m.state;
    const now = this.d.now();
    const guards = m.garrison().length;
    const rec = UNIT_TYPES.map((k) => {
      const u = UNITS[k];
      const err = m.recruitError(k);
      const errNow = m.recruitError(k, { emergency: true });
      return `<div class="mil-recruit"><span class="mil-ico">${ICON[k]}</span><span class="mil-item-text"><b>${esc(u.label)}</b><small>${esc(u.desc)} ${u.hp} health · range ${u.attack.range}</small></span>
        <span class="mil-row">${
          u.train
            ? `<button type="button" class="pill" data-recruit="${k}" ${err ? 'disabled' : ''} title="${esc(err || '')}">Train ${money(m.recruitCost(k))} · ${forDays(u.train)}</button><button type="button" class="pill" data-recruit="${k}" data-emergency ${errNow ? 'disabled' : ''} title="${esc(errNow || 'Emergency recruit: ready at once')}">Now ${money(m.recruitCost(k, { emergency: true }))}</button>`
            : `<button type="button" class="pill" data-recruit="${k}" ${err ? 'disabled' : ''} title="${esc(err || '')}">Hire ${money(u.cost)}</button>`
        }</span></div>`;
    }).join('');
    const roster = st.soldiers
      .slice()
      .sort((a, b) => (b.post ? 1 : 0) - (a.post ? 1 : 0) || b.xp - a.xp)
      .map((s) => {
        const on = this.selSoldier === s.id;
        const status = s.status === 'ready' ? (s.post ? 'On guard' : 'Reserve') : `${STATUS[s.status]}${s.until ? `, ready ${inDays(s.until - now)}` : ''}`;
        const actions = on
          ? `<span class="mil-row">${s.post ? `<button type="button" class="pill" data-unpost data-id="${s.id}">To the reserve</button>` : ''}<button type="button" class="pill" data-dismiss data-id="${s.id}">Dismiss</button></span><small>Tap the field to post them on guard.</small>`
          : '';
        return `<li class="${on ? 'is-on' : ''}"><button type="button" class="mil-soldier" data-soldier="${s.id}" data-id="${s.id}" aria-pressed="${on}"><span class="mil-ico">${ICON[s.type]}</span><span><b>${esc(titleOf(s))}</b><small>${esc(UNITS[s.type].label)} · ${status} · ${s.xp} xp${s.kills ? ` · ${s.kills} down` : ''}</small></span></button>${actions}</li>`;
      })
      .join('');
    return `<p class="mil-small">${st.soldiers.length} of ${m.armyCap} soldiers (${guards} of ${m.garrisonCap} on guard). Pay: ${money(m.upkeep())} a day.${st.unpaid > 0.05 ? ' <b class="mil-bad">They haven’t been paid: morale will suffer.</b>' : ''}</p>
      <h3>Recruit</h3><div class="mil-list">${rec}</div>
      <h3>Your soldiers</h3>${roster ? `<ul class="mil-roster">${roster}</ul>` : '<p class="mil-small">Nobody yet.</p>'}
      ${st.soldiers.length >= ARMY_CAP[m.level] ? '<p class="mil-small">Upgrade the command post (Build) to hold more soldiers.</p>' : ''}`;
  }

  warHtml() {
    const intel = this.war.intel();
    const party = this.war.attackParty().length;
    const rows = intel.neighbours
      .map((n) => {
        const err = this.war.attackError(this.war.byId(n.id));
        return `<li><span class="mil-item-text"><b>${esc(n.name)}</b><small>About ${n.soldiers} soldiers (${n.guards} on guard), ${n.defences} defences${n.recovering > 0 ? ` · recovering for ${forDays(n.recovering)}` : ''}</small></span>
          <button type="button" class="pill" data-attack-plan="${esc(n.id)}" ${err ? `title="${esc(err)}"` : ''}>Attack…</button></li>`;
      })
      .join('');
    return `<p class="mil-small">Send your reserve against a neighbour's base. You command the attacking squads; they defend with their guards, reserve and defences. Winning carries off part of their military budget. After any battle a base is left alone for a few days.</p>
      <ul class="mil-repairs">${rows}</ul>
      <p class="mil-small">Your reserve: ${party} ready soldiers.${intel.attackReadyIn > 0 ? ` Your troops rest for another ${forDays(intel.attackReadyIn)}.` : ''}</p>
      ${intel.coming ? `<p class="mil-warn">⚔ ${esc(intel.coming.from)} attacks ${inDays(intel.coming.in)}.</p>` : ''}`;
  }

  repairsHtml() {
    const m = this.m;
    const list = m.damaged();
    if (!list.length) return '<p class="mil-small">Everything is in good repair.</p>';
    const rows = list
      .map((s, i) => {
        const max = this.maxOf(s);
        return `<li><span class="mil-item-text"><b>${i + 1}. ${esc(DEFENCES[s.type].label)}</b><small>${s.hp <= 0 ? 'Destroyed' : `${Math.round((s.hp / max) * 100)}% health`} · crews: ${money(m.repairCost(s))}</small><span class="mil-hp"><span style="width:${Math.round((s.hp / max) * 100)}%"></span></span></span>
          <span class="mil-row"><button type="button" class="pill icon" data-prio="-1" data-id="${s.id}" aria-label="Repair sooner" ${i ? '' : 'disabled'}>▲</button><button type="button" class="pill icon" data-prio="1" data-id="${s.id}" aria-label="Repair later" ${i < list.length - 1 ? '' : 'disabled'}>▼</button><button type="button" class="pill" data-repairnow data-id="${s.id}">Now ${money(m.repairCost(s, true))}</button></span></li>`;
      })
      .join('');
    return `<p class="mil-small">Repair crews work down this list, paid from the military budget as they go. Move what matters most to the top, or pay half as much again to fix something at once.</p><ul class="mil-repairs">${rows}</ul>`;
  }

  budgetHtml() {
    const m = this.m;
    const st = m.state;
    const intel = this.war.intel();
    const pct = Math.round(st.share * 100);
    const cash = this.d.cityMoney();
    return `<div class="mil-budget"><b>${money(m.funds)}</b><small>in the military budget</small></div>
      <h3>Automatic funding</h3>
      <label class="mil-slider"><input type="range" min="0" max="${MAX_SHARE * 100}" step="5" value="${pct}" data-share aria-label="Share of the town's daily income for the military"><span>${pct}% of the town's income</span></label>
      <p class="mil-small">Pay for ${m.state.soldiers.length} soldiers: ${money(m.upkeep())} a day, plus repairs.</p>
      <h3>Emergency transfer</h3>
      <div class="mil-row"><button type="button" class="pill" data-transfer="250" ${cash < 1 ? 'disabled' : ''}>+${money(250)}</button><button type="button" class="pill" data-transfer="1000" ${cash < 1 ? 'disabled' : ''}>+${money(1000)}</button><button type="button" class="pill" data-transfer="5000" ${cash < 1 ? 'disabled' : ''}>+${money(5000)}</button></div>
      <p class="mil-small">From the town's budget (${money(cash)}).</p>
      <h3>Raids on your base</h3>
      <div class="seg" role="group">${RAID_LEVELS.map((k) => `<button type="button" data-raids="${k}" aria-pressed="${st.raids === k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>
      <h3>The neighbours</h3>
      <ul class="mil-intel">${intel.neighbours.map((n) => `<li><b>${esc(n.name)}</b> <small>about ${n.soldiers} soldiers (${n.ready} ready)</small></li>`).join('')}</ul>
      ${intel.coming ? `<p class="mil-warn">⚔ ${esc(intel.coming.from)} is sending ${intel.coming.size} soldiers in ${intel.coming.waves} waves. They arrive ${inDays(intel.coming.in)}.</p>` : intel.protectedFor > 0 ? `<p class="mil-small">After the last battle, nobody may raid you for ${forDays(intel.protectedFor)}.</p>` : ''}`;
  }

  logHtml() {
    const st = this.m.state;
    const outcomes = { held: 'Held', lost: 'Lost', retreated: 'Retreated', won: 'Won' };
    const rows = st.log
      .filter((l) => l.kind === 'raid' || l.kind === 'attack')
      .map((l) =>
        l.kind === 'attack'
          ? `<li><b>Day ${l.day}: attack on ${esc(l.target)} · ${outcomes[l.outcome] || ''}</b><small>${l.them.lost} of ${l.them.total} defenders fell. ${l.you.killed.length ? `We lost ${l.you.killed.length}.` : 'We lost nobody.'} ${l.you.injured.length + l.you.hurt.length ? `${l.you.injured.length + l.you.hurt.length} hurt.` : ''} ${l.you.spent ? `Artillery ${money(l.you.spent)}.` : ''} ${l.you.loot ? `Brought back ${money(l.you.loot)}.` : ''}${l.auto ? ' (Fought by your officers.)' : ''}</small></li>`
          : this.raidLine(l, outcomes)
      )
      .join('');
    const fallen = st.fallen.map((f) => `<li>${esc(f.name)} <small>${esc(UNITS[f.type]?.label || '')}, day ${f.day}</small></li>`).join('');
    return `${rows ? `<ul class="mil-log">${rows}</ul>` : '<p class="mil-small">No battles yet.</p>'}${fallen ? `<h3>Remembered</h3><ul class="mil-fallen">${fallen}</ul>` : ''}`;
  }

  raidLine(l, outcomes) {
    return `<li><b>Day ${l.day}: ${esc(l.from)} raid · ${outcomes[l.outcome] || ''}</b><small>${l.attackers.lost} of ${l.attackers.total} attackers fell. ${l.you.killed.length ? `We lost ${l.you.killed.length}.` : 'We lost nobody.'} ${l.you.injured.length + l.you.hurt.length ? `${l.you.injured.length + l.you.hurt.length} hurt.` : ''} ${l.you.spent ? `Artillery ${money(l.you.spent)}.` : ''} ${l.you.loot ? `They took ${money(l.you.loot)}.` : ''}${l.auto ? ' (Fought by your officers.)' : ''}</small></li>`;
  }

  // ---- The battle screen -------------------------------------------------------------------------

  squadIds() {
    const b = this.battle;
    if (!b || !this.selSquad) return [];
    return b.squad(this.selSquad)?.units || [];
  }

  renderHud(force) {
    const b = this.battle;
    if (!b || (!force && this.hold)) return;
    const s = b.status();
    const me = b.player;
    const them = me === 'att' ? 'def' : 'att';
    const sec = (n) => `${Math.ceil(n)} s`;
    const morale = (v, cls) => `<span class="mil-morale ${cls}"><span style="width:${Math.round(v)}%"></span></span>`;
    const squads = b.squads
      .filter((q) => (q.side || 'def') === me)
      .map((q) => {
        const alive = q.deployed ? b.livingIn(q).length : q.members.length;
        const total = q.deployed ? q.units.length : q.members.length;
        const types = (q.deployed ? q.units.map((id) => b.unit(id)?.type) : q.members.map((m) => m.type)).map((t) => ICON[t] || '').join(' ');
        const on = this.selSquad === q.id;
        if (!q.deployed) {
          const err = b.deployError(q.id);
          return `<div class="mil-sq"><b>${esc(q.name)}</b><small>${types}</small><button type="button" class="primary-btn" data-deploy="${q.id}" ${err ? 'disabled' : ''} title="${esc(err || '')}">${s.reinforceIn > 0 ? sec(s.reinforceIn) : 'Send in'}</button></div>`;
        }
        return `<button type="button" class="mil-sq${on ? ' is-on' : ''}${alive ? '' : ' is-out'}" data-squad="${q.id}" aria-pressed="${on}" ${alive ? '' : 'disabled'}><b>${esc(q.name)}</b><small>${alive}/${total} · ${esc(orderLabel(q.order))}</small></button>`;
      })
      .join('');
    // Where the next squad comes in: your edge, or a forward position you hold.
    const zones = b.zones(me);
    const waiting = b.squads.some((q) => (q.side || 'def') === me && !q.deployed);
    const zoneId = this.zone && zones.some((z) => z.id === this.zone && !z.contested) ? this.zone : me === 'att' ? 'centre' : 'base';
    const zoneRow =
      waiting && zones.length > 1
        ? `<div class="mil-orders"><span class="mil-small">Send in at:</span>${zones.map((z) => `<button type="button" class="pill${z.id === zoneId ? ' is-on' : ''}" data-zone="${z.id}" ${z.contested ? 'disabled title="The enemy is too close"' : ''}>${esc(z.label)}</button>`).join('')}</div>`
        : '';
    const choices = me === 'att' ? [['advance', 'Advance'], ['hold', 'Hold'], ['charge', 'Charge'], ['fallback', 'Fall back']] : [['hold', 'Hold'], ['charge', 'Charge'], ['fallback', 'Fall back']];
    const orders = this.selSquad
      ? `<div class="mil-orders"><span class="mil-small">${esc(b.squad(this.selSquad)?.name || '')}: tap the field to move, or</span>${choices.map(([k, l]) => `<button type="button" class="pill" data-order="${k}">${l}</button>`).join('')}</div>`
      : '';
    const art = `<button type="button" class="pill${this.targeting ? ' is-on' : ''}" data-artillery ${s.artilleryIn > 0 || s.budget < ARTILLERY.cost ? 'disabled' : ''}>Artillery ${s.artilleryIn > 0 ? sec(s.artilleryIn) : money(ARTILLERY.cost)}</button>`;
    const supplies = Math.max(0, TIME_LIMIT - s.t);
    const clock = `${Math.floor(supplies / 60)}:${String(Math.floor(supplies % 60)).padStart(2, '0')}`;
    const head =
      me === 'att'
        ? `Attack on ${esc(b.names.def)} · supplies ${clock}`
        : s.nextWaveIn != null
          ? `Wave ${s.wave} of ${s.waves} · next in ${sec(s.nextWaveIn)}`
          : s.withdrawing
            ? 'They are withdrawing'
            : `Wave ${s.wave} of ${s.waves}`;
    const count = { att: s.attackers, def: s.defenders };
    const posts = s.points.map((p) => {
      const capturing = p.by && p.progress > 0 ? ` · ${p.by === me ? 'taking' : 'losing'} ${Math.round(p.progress * 100)}%` : '';
      return `<span class="mil-chip ${p.owner === me ? 'ok' : 'warn'}">${esc(p.name)}: ${p.owner === me ? 'yours' : 'theirs'}${capturing}</span>`;
    });
    const html = `
      <div class="mil-hud-top glass">
        <span class="mil-chip">${head}</span>
        <span class="mil-side def">You ${count[me]}${morale(s.morale[me], 'def')}</span>
        <span class="mil-side att">${esc(b.names[them])} ${count[them]}${morale(s.morale[them], 'att')}</span>
        <span class="mil-chip">${me === 'att' ? 'Their HQ' : 'HQ'} ${Math.round(s.hq * 100)}%</span>
        ${posts.join('')}
        <span class="mil-row">
          <button type="button" class="pill" data-pause aria-pressed="${b.paused}">${b.paused ? '▶ Resume' : '❚❚ Pause'}</button>
          ${[1, 2].map((v) => `<button type="button" class="pill${this.speed === v ? ' is-on' : ''}" data-speed="${v}">${v}×</button>`).join('')}
          <button type="button" class="pill danger" data-retreat>Retreat</button>
        </span>
      </div>
      ${b.paused ? '<div class="mil-paused glass">Paused: give orders now, they start when you resume</div>' : ''}
      <div class="mil-hud-bottom glass"><div class="mil-squads">${squads}</div>${zoneRow}${orders}<div class="mil-row">${art}<span class="mil-small">Budget ${money(s.budget)}</span></div></div>`;
    if (!force && html === this._hud) return;
    this._hud = html;
    this.$('hud').innerHTML = html;
    this.hint(this.targeting ? 'Tap where the shells should land' : null);
    this.view?.setSelected(this.squadIds());
  }
}

function orderLabel(o) {
  return { move: 'moving', hold: 'holding', charge: 'charging', fallback: 'falling back', rally: 'forming up', advance: 'advancing' }[o?.kind] || '';
}

