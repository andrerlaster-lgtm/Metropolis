// Life Story interface: the Life button, the life panel (create, follow, remember) and the event card.
// Shows state from LifeSystem; every change goes through the callbacks main.js passes in.

import { STRUCTURES } from './config.js';
import { typingTarget } from './input.js';
import { PRONOUNS, SKIN_TONES, HAIR_COLORS, OUTFIT_COLORS, TRAITS, CAREERS, stageFor } from './lifeData.js';
import { STAT_LABELS } from './lifeEngine.js';
import { addressOf } from './streets.js';
import { ACTIVITY_GROUPS, energyFor } from './lifeActivities.js';
import { KID_FOCUS, EVENT_POLICIES } from './autopilot.js';
import { ACHIEVEMENTS } from './lifeAchievements.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const money = (n) => `$${Math.round(n).toLocaleString()}`;

export function avatarSVG(look = {}, size = 56) {
  const skin = look.skin || SKIN_TONES[1];
  const hair = look.hair || HAIR_COLORS[0];
  const outfit = look.outfit || OUTFIT_COLORS[0];
  return `<svg viewBox="0 0 56 56" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="28" cy="28" r="28" fill="var(--avatar-bg)"/>
    <path d="M10 56c1-11 8.5-17 18-17s17 6 18 17z" fill="${outfit}"/>
    <circle cx="28" cy="25" r="11" fill="${skin}"/>
    <path d="M16.6 24.5c-.4-8 4.6-12.5 11.4-12.5s11.8 4.5 11.4 12.5c-2.6-4.2-6.6-6.3-11.4-6.3s-8.8 2.1-11.4 6.3z" fill="${hair}"/>
    <circle cx="24" cy="26.5" r="1.3" fill="#3d3550"/><circle cx="32" cy="26.5" r="1.3" fill="#3d3550"/>
    <path d="M24.6 30.6c1.9 1.5 4.9 1.5 6.8 0" stroke="#3d3550" stroke-width="1.4" fill="none" stroke-linecap="round"/>
  </svg>`;
}

const CATEGORY_LABEL = { personal: 'Personal', family: 'Family', political: 'Politics', economic: 'Money & work', military: 'War & the base', social: 'Town life' };

export class LifeInterface {
  constructor(handlers) {
    this.h = handlers; // { life, onFocus, onCreate, onAgeUp, onChoose, onActivity, onContinue, onNewLife, onOpen }
    this.panel = document.getElementById('life-panel');
    this.card = document.getElementById('life-card');
    this.btn = document.getElementById('btn-life');
    this.open = false;
    this.cardMinimized = false;
    this.outcome = null;
    this.draft = this.newDraft();

    this.btn.addEventListener('click', () => this.toggle());
    this.panel.addEventListener('click', (e) => this.onPanelClick(e));
    this.panel.addEventListener('input', (e) => this.onPanelInput(e));
    this.panel.addEventListener('change', (e) => {
      if (e.target.matches?.('[data-kidevents]')) this.h.setAutoKid?.({ events: e.target.value });
      else if (e.target.matches?.('[data-kidfocus]')) this.h.setAutoKid?.({ focus: e.target.value });
      else return;
      this.render();
    });
    this.panel.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitDraft();
    });
    this.card.addEventListener('click', (e) => this.onCardClick(e));
    // While the event card is up, number keys answer it instead of picking tools.
    window.addEventListener(
      'keydown',
      (e) => {
        if (this.card.hidden || e.metaKey || e.ctrlKey || e.altKey || typingTarget(e.target)) return;
        const n = Number(e.key);
        if (this.outcome && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.closeOutcome();
        } else if (!this.outcome && n >= 1 && n <= 4) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.choose(n - 1);
        }
      },
      true
    );
    this.render();
  }

  get life() {
    return this.h.life;
  }

  newDraft() {
    const { first, last } = this.h.life.randomName();
    const pickOne = (a) => a[Math.floor(Math.random() * a.length)];
    return {
      first,
      last,
      pronouns: pickOne(Object.keys(PRONOUNS)),
      look: { skin: pickOne(SKIN_TONES), hair: pickOne(HAIR_COLORS), outfit: pickOne(OUTFIT_COLORS) },
      traits: [],
    };
  }

  toggle(force) {
    const was = this.open;
    this.open = force ?? !this.open;
    if (this.open && !was) this.h.onOpen?.();
    this.render();
  }

  // ---- Panel ---------------------------------------------------------------

  render() {
    const c = this.life.char;
    this.btn.classList.toggle('is-on', this.open);
    this.btn.querySelector('.badge').hidden = !c?.pending || (!this.cardMinimized && !this.card.hidden);
    this.renderCard();
    // On phones the event card and the panel share the same space; the card wins.
    const narrow = window.innerWidth < 560 || window.innerHeight < 520;
    this.panel.hidden = !this.open || (narrow && !this.card.hidden);
    if (!this.panel.hidden) {
      this.panel.innerHTML = !c ? this.createHTML() : c.alive ? this.lifeHTML(c) : this.deathHTML(c);
    }
  }

  // Light refresh for the year progress bar, without rebuilding the panel.
  tick() {
    const c = this.life.char;
    if (!this.open || !c?.alive) return;
    const bar = this.panel.querySelector('.year-bar span');
    if (bar) bar.style.width = `${Math.min(100, c.yearProgress * 100).toFixed(1)}%`;
  }

  createHTML() {
    const d = this.draft;
    const swatches = (name, colors, value) =>
      `<div class="swatches" role="radiogroup" aria-label="${name}">${colors
        .map((col) => `<button type="button" class="swatch" data-look="${name}" data-value="${col}" aria-pressed="${col === value}" style="--c:${col}" aria-label="${name} ${col}"></button>`)
        .join('')}</div>`;
    return `<form class="life-create">
      <header class="life-head">
        <div class="avatar">${avatarSVG(d.look, 64)}</div>
        <div><span class="life-kicker">Life Story</span><h2>Start a life</h2><p class="life-sub">Born as a baby in your city. Your choices, and the city you build, shape the story.</p></div>
      </header>
      <div class="field-row">
        <label class="field"><span>First name</span><input id="life-first" name="first" value="${esc(d.first)}" maxlength="20" required autocomplete="off"></label>
        <label class="field"><span>Last name</span><input id="life-last" name="last" value="${esc(d.last)}" maxlength="20" required autocomplete="off"></label>
        <button type="button" class="icon-btn" data-act="reroll" aria-label="Random name" title="Random name"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 9h.01M15 15h.01M12 12h.01" stroke-width="2.8"/></svg></button>
      </div>
      <fieldset class="field"><legend>Pronouns</legend><div class="seg">${Object.entries(PRONOUNS)
        .map(([id, p]) => `<button type="button" data-pronouns="${id}" aria-pressed="${id === d.pronouns}">${p.label}</button>`)
        .join('')}</div></fieldset>
      <fieldset class="field"><legend>Skin</legend>${swatches('skin', SKIN_TONES, d.look.skin)}</fieldset>
      <fieldset class="field"><legend>Hair</legend>${swatches('hair', HAIR_COLORS, d.look.hair)}</fieldset>
      <fieldset class="field"><legend>Outfit</legend>${swatches('outfit', OUTFIT_COLORS, d.look.outfit)}</fieldset>
      <fieldset class="field"><legend>Traits <small>pick two</small></legend><div class="chips">${TRAITS.map(
        (t) => `<button type="button" class="chip" data-trait="${t.id}" aria-pressed="${d.traits.includes(t.id)}" title="${t.hint}">${t.label}<small>${t.hint}</small></button>`
      ).join('')}</div></fieldset>
      <button type="submit" class="primary-btn" ${d.traits.length === 2 ? '' : 'disabled'}>${d.traits.length === 2 ? 'Be born' : `Pick ${2 - d.traits.length} more trait${d.traits.length === 1 ? '' : 's'}`}</button>
    </form>`;
  }

  lifeHTML(c) {
    const life = this.life;
    const stage = stageFor(c.age);
    const f = life.facts();
    const bars = ['happiness', 'health', 'smarts', 'looks']
      .map((k) => `<li><span>${STAT_LABELS[k]}</span><span class="sbar"><span class="s-${k}" style="width:${c.stats[k]}%"></span></span><b>${c.stats[k]}</b></li>`)
      .join('');
    const career = c.job && CAREERS[c.job.type];
    const occupation = c.job
      ? `${career.titles[c.job.level]} at the ${STRUCTURES[c.job.type].label.toLowerCase()}, ${addressOf(life.city.getTile(c.job.x, c.job.y))}`
      : c.age >= 6 && c.age <= 17
        ? f.schoolCoverage > 0.25
          ? 'At school'
          : 'Learning at home (no school nearby)'
        : c.flags.retired
          ? 'Retired'
          : c.age < 6
            ? 'Too young for school'
            : 'Looking for work';
    const people = [
      ...['mother', 'father'].map((k) => c.family[k] && { ...c.family[k], role: c.family[k].name === this.h.mayorName?.() ? 'Parent · Mayor' : 'Parent' }),
      ...(c.siblings || []).map((sb) => ({ ...sb, role: 'Sibling', alive: sb.alive !== false })),
      c.partner && { ...c.partner, role: c.partner.married ? 'Spouse' : 'Partner', alive: true },
      ...c.children.map((k) => ({ ...k, role: 'Child', closeness: 80 })),
      ...c.friends.map((fr) => ({ ...fr, role: 'Friend', alive: true })),
    ].filter(Boolean);
    const log = c.log
      .slice(0, 40)
      .map((l) => `<li><span class="log-age">${l.age}</span><span>${esc(l.text)}</span></li>`)
      .join('');
    const waiting = !!c.pending;
    return `<header class="life-head">
        <div class="avatar">${avatarSVG(c.look, 64)}</div>
        <div class="life-id"><span class="life-kicker">${c.generation > 1 ? `Generation ${c.generation}` : 'Life Story'}</span><h2>${esc(c.first)} ${esc(c.last)}</h2>
        <p class="life-sub">Age ${c.age} · ${stage.label}${this.h.youLead?.() ? ' · Mayor' : ''}</p>
        <div class="year-bar" title="Progress to next birthday"><span style="width:${Math.min(100, c.yearProgress * 100).toFixed(1)}%"></span></div></div>
        <button type="button" class="icon-btn" data-act="close" aria-label="Close life panel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      </header>
      <div class="life-actions">
        ${waiting ? '<button type="button" class="primary-btn" data-act="showcard">Open the waiting event</button>' : '<button type="button" class="primary-btn" data-act="ageup">Age up · +1 year</button>'}
        <button type="button" class="ghost-btn" data-act="focus" ${c.home ? '' : 'disabled'}>Show home</button>
        <button type="button" class="ghost-btn" data-act="follow" aria-pressed="${!!this.h.isFollowing?.()}">${this.h.isFollowing?.() ? 'Stop following' : 'Follow on map'}</button>
      </div>
      <p class="life-hint">Life moves one year per city day. Age up skips ahead; time stops while an event waits.</p>
      <ul class="stat-bars">${bars}<li><span>Money</span><span></span><b>${money(c.money)}</b></li></ul>
      ${this.activitiesHTML(c)}
      <dl class="life-facts">
        <div><dt>Home</dt><dd>${c.home ? `<button type="button" class="address-link" data-act="focus" title="Show on the map">${esc(addressOf(f.home))}</button><small>${c.livesWithParents ? 'With family' : c.flags.ownsHome ? 'Owned' : 'Own place'} · ${Math.round(f.desirability * 100)}% desirable</small>` : 'No home'}</dd></div>
        <div><dt>Daily life</dt><dd>${esc(occupation)}</dd></div>
        <div><dt>Traits</dt><dd>${c.traits.map((t) => TRAITS.find((x) => x.id === t)?.label).join(', ')}</dd></div>
      </dl>
      <h3>People</h3>
      <ul class="people">${people
        .map(
          (p) =>
            `<li class="${p.alive === false ? 'gone' : ''}"><span><b>${esc(p.name)}</b><small>${p.role}${p.alive === false ? ' · passed away' : p.age != null && p.role === 'Child' ? ` · ${p.age}` : ''}</small></span><span class="sbar"><span class="s-rel" style="width:${p.closeness}%"></span></span></li>`
        )
        .join('')}</ul>
      <h3>Life so far</h3>
      <ol class="life-log">${log}</ol>
      ${this.achievementsHTML()}`;
  }

  // Things to do any time, grouped, with energy dots for what's left this year.
  activitiesHTML(c) {
    const max = energyFor(c.age);
    if (!max) return `<h3>Things to do</h3><p class="life-hint">Babies mostly eat, sleep and giggle. Activities start at age 3.</p>${this.autoHTML(c)}`;
    const left = Math.max(0, c.energy ?? max);
    const list = this.life.activities();
    const dots = Array.from({ length: max }, (_, i) => `<span class="energy-dot${i < left ? ' on' : ''}"></span>`).join('');
    const groups = ACTIVITY_GROUPS.map((g) => {
      const items = list.filter((a) => a.group === g.id);
      if (!items.length) return '';
      return `<div class="act-group"><span class="act-group-label">${g.label}</span><div class="act-grid">${items
        .map(
          (a) =>
            `<button type="button" class="act" data-activity="${a.id}" ${a.blocked ? 'disabled' : ''} title="${esc(a.blocked || a.hint)}">` +
            `<b>${esc(a.label)}</b><small>${esc(a.blocked && a.blocked !== 'No energy left this year' ? a.blocked : a.hint)}${a.cost ? ` · ${money(a.cost)}` : ''}</small></button>`
        )
        .join('')}</div></div>`;
    }).join('');
    return `<div class="act-head"><h3>Things to do</h3><span class="energy" aria-label="${left} of ${max} activities left this year">${dots}<small>${left ? `${left} left this year` : 'Rested by next birthday'}</small></span></div>${this.autoHTML(c)}${groups}`;
  }

  // Auto mode: your main person picks their own activities through the year, with a focus you set.
  autoHTML(c) {
    const auto = this.h.autoKid?.();
    if (!auto) return '';
    const f = KID_FOCUS.find((x) => x.id === auto.focus) || KID_FOCUS[0];
    return `<div class="auto-row"><button type="button" class="pill small${auto.on ? ' is-on' : ''}" data-act="autokid" aria-pressed="${auto.on}">Auto: ${auto.on ? 'on' : 'off'}</button>
      <label class="auto-focus">Life events <select data-kidevents aria-label="What ${esc(c.first)} does when a life event asks a question">${EVENT_POLICIES.map((x) => `<option value="${x.id}"${x.id === (auto.events || 'ask') ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label>
      <label class="auto-focus">Focus <select data-kidfocus aria-label="What ${esc(c.first)} works on">${KID_FOCUS.map((x) => `<option value="${x.id}"${x.id === auto.focus ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label>
      <small>${esc(auto.on ? `${c.first} picks their own activities through the year. ${f.hint}.` : `Turn on to let ${c.first} pick their own activities. ${f.hint}.`)}</small></div>`;
  }

  // Achievements are shared by every life in this city.
  achievementsHTML() {
    const got = this.life.state?.achievements || {};
    const n = ACHIEVEMENTS.filter((a) => got[a.id]).length;
    return `<details class="achievements"><summary><h3>Achievements</h3><span>${n} of ${ACHIEVEMENTS.length}</span></summary><ul class="ach-grid">${ACHIEVEMENTS.map((a) => {
      const g = got[a.id];
      return `<li class="${g ? 'got' : ''}" title="${esc(g ? `${a.desc}. Earned by ${g.by} at ${g.age}` : a.desc)}"><span class="ach-icon" aria-hidden="true">${g ? '★' : '☆'}</span><span><b>${a.label}</b><small>${esc(g ? `${g.by}, age ${g.age}` : a.desc)}</small></span></li>`;
    }).join('')}</ul></details>`;
  }

  deathHTML(c) {
    const kid = c.children.find((k) => k.alive !== false) || { name: 'a niece or nephew', relative: true };
    const career = c.job && CAREERS[c.job.type];
    return `<header class="life-head">
        <div class="avatar gone">${avatarSVG(c.look, 64)}</div>
        <div><span class="life-kicker">In memory</span><h2>${esc(c.first)} ${esc(c.last)}</h2><p class="life-sub">Lived to ${c.death.age} · ${esc(c.death.cause)}</p></div>
      </header>
      ${c.ribbon ? `<div class="ribbon" style="--ribbon:${c.ribbon.color}"><svg class="ribbon-badge" viewBox="0 0 32 40" width="30" height="38" aria-hidden="true"><path d="M10 22 5 38l6-3 4 5 3-14zM22 22l5 16-6-3-4 5-3-14z" fill="${c.ribbon.color}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/><circle cx="16" cy="15" r="12" fill="${c.ribbon.color}" stroke="#fff" stroke-width="2"/><circle cx="16" cy="15" r="7" fill="none" stroke="#fff" stroke-width="1.5" opacity=".8"/></svg><span><small>Life ribbon</small><b>${esc(c.ribbon.label)}</b></span></div>` : ''}
      <dl class="life-facts">
        <div><dt>Last job</dt><dd>${career ? career.titles[c.job.level] : c.flags.retired ? 'Retired' : 'None'}</dd></div>
        <div><dt>Savings</dt><dd>${money(c.money)}</dd></div>
        <div><dt>Children</dt><dd>${c.children.length || 'None'}</dd></div>
        <div><dt>Friends</dt><dd>${c.friends.length}</dd></div>
      </dl>
      <div class="life-actions">
        <button type="button" class="primary-btn" data-act="continue">${kid.relative ? 'Continue with a niece or nephew' : `Continue as ${esc(kid.name.split(' ')[0])}`}</button>
        <button type="button" class="ghost-btn" data-act="newlife">Start a new life</button>
      </div>
      <p class="life-hint">The family story carries on by itself in a few moments.</p>
      ${this.historyHTML()}
      <h3>Life story</h3>
      <ol class="life-log">${c.log
        .slice(0, 60)
        .map((l) => `<li><span class="log-age">${l.age}</span><span>${esc(l.text)}</span></li>`)
        .join('')}</ol>
      ${this.achievementsHTML()}`;
  }

  historyHTML() {
    const past = this.life.state?.history || [];
    if (!past.length) return '';
    return `<h3>Earlier lives</h3><ul class="past-lives">${past
      .slice(-8)
      .reverse()
      .map((p) => `<li><b>${esc(p.name)}</b><small>Lived to ${p.age}</small>${p.ribbon ? `<span class="mini-ribbon" style="--ribbon:${p.ribbon.color}">${esc(p.ribbon.label)}</span>` : ''}</li>`)
      .join('')}</ul>`;
  }

  onPanelInput(e) {
    if (e.target.id === 'life-first') this.draft.first = e.target.value;
    if (e.target.id === 'life-last') this.draft.last = e.target.value;
  }

  onPanelClick(e) {
    const t = e.target.closest('button');
    if (!t) return;
    const d = this.draft;
    if (t.dataset.pronouns) d.pronouns = t.dataset.pronouns;
    else if (t.dataset.look) d.look[t.dataset.look] = t.dataset.value;
    else if (t.dataset.trait) {
      const id = t.dataset.trait;
      d.traits = d.traits.includes(id) ? d.traits.filter((x) => x !== id) : [...d.traits, id].slice(-2);
    } else if (t.dataset.act === 'reroll') Object.assign(d, this.h.life.randomName());
    else if (t.dataset.act === 'close') return this.toggle(false);
    else if (t.dataset.act === 'ageup') {
      this.h.onAgeUp();
      this.cardMinimized = false;
    } else if (t.dataset.act === 'showcard') this.cardMinimized = false;
    else if (t.dataset.act === 'focus') return this.h.onFocus();
    else if (t.dataset.act === 'follow') {
      this.h.onFollow?.();
      if (window.innerWidth < 760) return this.toggle(false); // phones: close the panel so the map shows
    }
    else if (t.dataset.activity) {
      const result = this.h.onActivity(t.dataset.activity);
      if (result?.text) this.outcome = { ...result, age: this.life.char?.age };
      this.cardMinimized = false;
      this._cardFor = null;
    }
    else if (t.dataset.act === 'autokid') this.h.setAutoKid?.({ on: !this.h.autoKid?.().on });
    else if (t.dataset.act === 'continue') this.h.onContinue();
    else if (t.dataset.act === 'newlife') {
      this.draft = this.newDraft();
      this.h.onNewLife();
    } else return;
    this.render();
  }

  submitDraft() {
    const d = this.draft;
    if (d.traits.length !== 2) return;
    this.h.onCreate({ first: d.first.trim() || 'Ava', last: d.last.trim() || 'Park', pronouns: d.pronouns, look: { ...d.look }, traits: d.traits });
    this.draft = this.newDraft();
    this.render();
  }

  // ---- Event card ------------------------------------------------------------

  // A new event arrived: show it unless the player tucked the card away.
  eventArrived() {
    this.cardMinimized = false;
    this.render();
  }

  renderCard() {
    const c = this.life.char;
    if (this.outcome) {
      this.card.hidden = false;
      const chips = this.outcome.changes
        .map((ch) => {
          const up = ch.delta > 0;
          const label = ch.key === 'rel' ? `${ch.who.split(' ')[0]}` : ch.key === 'money' ? 'Money' : ch.key === 'town' ? ch.label : STAT_LABELS[ch.key];
          const amount = ch.key === 'money' || ch.money ? money(Math.abs(ch.delta)) : `${Math.abs(ch.delta)}${ch.pct ? '%' : ''}`;
          return `<span class="delta ${up ? 'up' : 'down'}">${up ? '+' : '−'}${amount} ${label}</span>`;
        })
        .join('');
      this.card.innerHTML = `<div class="card-head">${avatarSVG(c?.look, 36)}<span>${esc(c ? `${c.first}, ${this.outcome.age}` : '')}</span></div>
        <p class="bubble reply">${esc(this.outcome.text)}</p>
        ${chips ? `<div class="deltas">${chips}</div>` : ''}
        <button type="button" class="primary-btn" data-act="ok">Continue</button>`;
      return;
    }
    const view = this.life.current();
    if (!view || this.cardMinimized) {
      this.card.hidden = true;
      return;
    }
    this.card.hidden = false;
    if (this._cardFor === `${view.id}|${c.age}`) return;
    this._cardFor = `${view.id}|${c.age}`;
    this.card.innerHTML = `<div class="card-head">${avatarSVG(c.look, 36)}<span>${esc(c.first)}, ${c.age} · ${stageFor(c.age).label}</span>
        <button type="button" class="later" data-act="later">Later</button></div>
      ${view.category || view.echo ? `<p class="event-tags">${view.category ? `<span class="event-tag tag-${esc(view.category)}">${esc(CATEGORY_LABEL[view.category] || view.category)}</span>` : ''}${view.echo ? `<span class="event-tag tag-echo" title="A consequence of something chosen years ago">↺ Set in motion by ${esc(view.echo.from)}${view.echo.year ? ` in ${view.echo.year}` : ''}</span>` : ''}</p>` : ''}
      ${view.title ? `<h3>${esc(view.title)}</h3>` : ''}
      <p class="bubble">${esc(view.text)}</p>
      <div class="choices">${view.choices.map((ch, i) => `<button type="button" class="choice" data-choice="${i}"><kbd>${i + 1}</kbd><span>${esc(ch)}</span></button>`).join('')}</div>`;
  }

  onCardClick(e) {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.choice != null) this.choose(Number(t.dataset.choice));
    else if (t.dataset.act === 'ok') this.closeOutcome();
    else if (t.dataset.act === 'later') {
      this.cardMinimized = true;
      this._cardFor = null;
      this.render();
    }
  }

  choose(i) {
    const age = this.life.char?.age;
    const result = this.h.onChoose(i);
    if (!result) return;
    this.outcome = { ...result, age };
    this._cardFor = null;
    this.render();
  }

  closeOutcome() {
    this.outcome = null;
    this._cardFor = null;
    this.render();
  }
}
