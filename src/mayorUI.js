// Town hall sheet: the mayor (mayor.js), their skills, today's actions and the four duties, what
// they did lately and who takes over next. Also keeps the mayor chip on the town card up to date
// and gives the City panel its Mayor line. Changes go through Mayor.perform.

import { DUTIES, SKILL_LABELS, ACTIONS_PER_DAY } from './mayor.js';
import { MAYOR_FOCUS } from './autopilot.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const actionsText = (n) => `${n} of ${ACTIONS_PER_DAY} action${ACTIONS_PER_DAY === 1 ? '' : 's'} left today`;

// The City panel's line about the mayor, with a button that opens the town hall.
export function mayorLineHTML(m) {
  const st = m.state;
  return `<p class="sk-line"><b>${esc(m.title())} ${esc(st.name)}</b>, ${esc(m.relation())}. ${actionsText(st.actions)}.</p><button type="button" class="ghost-btn small" data-townhall>Town hall</button>`;
}
export const mayorLineKey = (m) => JSON.stringify([m.state.name, m.state.who, m.state.actions, m.relation()]);

export class TownHall {
  // deps: { mayor: () → Mayor, autopilot: () → Autopilot, toast(msg, ms), sound(name), onOpen(), onChange() }
  constructor(deps) {
    this.d = deps;
    this.el = document.getElementById('townhall-sheet');
    this.chip = document.getElementById('mayor-chip');
    this.open = false;
    this._key = '';
    this.el.addEventListener('click', (e) => this.onClick(e));
    // The chip sits on the town card, which opens the City panel: a tap here opens the town hall instead.
    const fromChip = (e) => {
      e.stopPropagation();
      this.toggle(true);
    };
    this.chip.addEventListener('click', fromChip);
    this.chip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fromChip(e);
      }
    });
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape' || !this.open || e.target?.closest?.('input, textarea, select, [contenteditable]')) return;
        this.toggle(false);
        e.preventDefault();
        e.stopImmediatePropagation();
      },
      true
    );
  }

  get m() {
    return this.d.mayor();
  }

  toggle(force = !this.open) {
    this.open = force;
    this.el.hidden = !force;
    if (force) {
      this.d.onOpen?.();
      this.render(true);
    }
  }

  // A few times a second: the chip, and the sheet while it's open.
  tick() {
    const m = this.m;
    m.update();
    const n = m.state.actions;
    this.chip.textContent = `🏛 ${n}`;
    this.chip.classList.toggle('is-spent', !n);
    this.chip.setAttribute('aria-label', `${m.title()} ${m.state.name}: ${actionsText(n)}. Open the town hall`);
    if (this.open) this.render(false);
  }

  render(force) {
    const m = this.m;
    const st = m.state;
    const auto = this.d.autopilot?.().state.mayor;
    const pro = m.prospects();
    const key = JSON.stringify([st.name, st.who, st.age, st.actions, st.done, st.skills, st.log[0]?.text, DUTIES.map((d) => m.preview(d.id)), auto, pro]);
    if (!force && key === this._key) return;
    this._key = key;
    const next = m.nextInLine();
    this.el.innerHTML = `
      <header><h2>Town hall</h2><button type="button" class="insp-close" data-close aria-label="Close">${CLOSE}</button></header>
      <div class="th-who">
        <div><span class="insp-kicker">${esc(m.title())}</span><h3>${esc(st.name)}</h3><p class="sk-line">${esc(m.relation())} · age ${Math.round(st.age)}</p></div>
        <p class="th-actions" aria-label="${actionsText(st.actions)}">${Array.from({ length: ACTIONS_PER_DAY }, (_, i) => `<span class="th-pip${i < st.actions ? ' on' : ''}"></span>`).join('')}<small>${actionsText(st.actions)}</small></p>
      </div>
      <dl class="th-skills">${Object.entries(SKILL_LABELS)
        .map(([k, label]) => `<div><dt>${label}</dt><dd><span class="sbar"><span style="width:${st.skills[k]}%"></span></span><b>${st.skills[k]}</b></dd></div>`)
        .join('')}</dl>
      <div class="th-duties">${DUTIES.map((d) => this.dutyHTML(d)).join('')}</div>
      ${auto ? this.autoHTML(auto) : ''}
      ${next ? `<p class="sk-intro">Who leads next: ${esc(next)}</p>` : ''}
      ${pro ? this.prospectsHTML(pro) : ''}
      ${st.log.length ? `<h3 class="th-h">Lately</h3><ul class="th-log">${st.log.slice(0, 6).map((l) => `<li><span>Day ${l.day}</span>${esc(l.text)}</li>`).join('')}</ul>` : ''}`;
  }

  // Auto mode: the mayor picks the day's duties, with the focus you set.
  autoHTML(auto) {
    return `<div class="th-auto">
      <div class="th-auto-head"><b>Auto mode</b><button type="button" class="pill small${auto.on ? ' is-on' : ''}" data-auto-mayor aria-pressed="${auto.on}">${auto.on ? 'On' : 'Off'}</button></div>
      <div class="seg th-focus" role="group" aria-label="What the mayor does first">${MAYOR_FOCUS.map((f) => `<button type="button" data-mayor-focus="${f.id}" aria-pressed="${auto.focus === f.id}" title="${esc(f.hint)}">${esc(f.label)}</button>`).join('')}</div>
      <p class="sk-intro">${auto.on ? 'The mayor does the day’s duties on their own, spread over the day.' : 'Turn it on and the mayor does the day’s duties on their own.'} ${esc(MAYOR_FOCUS.find((f) => f.id === auto.focus)?.hint || '')}.</p>
    </div>`;
  }

  // What your main person would bring as mayor, from how they're growing up.
  prospectsHTML(pro) {
    const c = this.m.char;
    return `<div class="th-prospects"><h3 class="th-h">If ${esc(c.first)} led today</h3>
      <p class="th-pro">${Object.entries(SKILL_LABELS).map(([k, label]) => `<span>${label} <b>${pro[k]}</b></span>`).join('')}</p>
      <p class="sk-intro">How ${esc(c.first)} grows up decides how good a mayor they'll be: smarts, health, happiness, looks, friends, a career and their traits all count.</p></div>`;
  }

  dutyHTML(d) {
    const m = this.m;
    const err = m.dutyError(d.id);
    const done = m.state.done[d.id];
    return `<button type="button" class="th-duty${done ? ' is-done' : ''}" data-duty="${d.id}" ${err ? 'aria-disabled="true"' : ''} title="${esc(err || d.text)}">
      <span class="sk-name">${done ? '✓ ' : ''}${esc(d.name)}<span class="th-skill">${SKILL_LABELS[d.skill]}</span></span>
      <span class="sk-text">${esc(d.text)}</span>
      <span class="th-effect">${esc(err || m.preview(d.id))}</span>
    </button>`;
  }

  onClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.close != null) return this.toggle(false);
    const ap = this.d.autopilot?.();
    if (ap && b.dataset.autoMayor != null) {
      ap.set('mayor', { on: !ap.state.mayor.on });
      this.d.sound?.('click');
      return this.render(true);
    }
    if (ap && b.dataset.mayorFocus) {
      ap.set('mayor', { focus: b.dataset.mayorFocus });
      this.d.sound?.('click');
      return this.render(true);
    }
    const id = b.dataset.duty;
    if (!id) return;
    const r = this.m.perform(id);
    if (r.error) {
      this.d.sound?.('nope');
      this.d.toast?.(r.error, 2600);
    } else {
      this.d.onChange?.(id);
      this.d.sound?.('chime');
      this.d.toast?.(r.text, 4200);
    }
    this.render(true);
  }
}
