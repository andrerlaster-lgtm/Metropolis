// The diplomacy sheet and the proposal card. The sheet shows each computer town's mayor (their
// personality, how much they trust you, your reputation), the treaties between you, the war if
// there is one, and lets you propose a treaty with terms, answer their proposals, send gifts or
// declare war. The card pops up when a mayor proposes something or declares war on you.
// The rules live in diplomacy.js; this file only shows them.

import { STANCE_LABEL, KIND_LABEL, DEFAULT_DAYS } from './diplomacy.js';
import { money } from './economy.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const days = (d) => (d == null ? 'no end date' : d * 24 < 36 ? `${Math.max(1, Math.round(d * 24))} h left` : `${(Math.round(d * 2) / 2).toLocaleString()} days left`);

export function trustWord(t) {
  return t <= -60 ? 'Hostile' : t <= -20 ? 'Wary' : t < 20 ? 'Neutral' : t < 60 ? 'Friendly' : 'Close';
}
export function reputationWord(r) {
  return r < 30 ? 'Faithless' : r < 50 ? 'Doubted' : r < 75 ? 'Respected' : 'Honoured';
}

// A blank proposal for the stance you're in.
function freshDraft(stance) {
  const kind = stance === 'war' ? 'peace' : stance === 'pact' || stance === 'peace' ? 'alliance' : 'pact';
  return { kind, payYou: 0, payThem: 0, tributeYou: 0, tributeThem: 0, tributeDays: 5, limitOn: null, limitSoldiers: 6, limitDays: 5, days: DEFAULT_DAYS[kind] ?? 7 };
}

// The draft as diplomacy.js wants it (+ pay means you pay them).
function toOffer(d) {
  const perDay = d.tributeYou - d.tributeThem;
  return {
    kind: d.kind,
    pay: d.payYou - d.payThem,
    tribute: perDay ? { perDay, days: d.tributeDays } : null,
    limit: d.limitOn ? { on: d.limitOn, soldiers: d.limitSoldiers, days: d.limitDays } : null,
    days: d.kind === 'alliance' ? undefined : d.days,
  };
}

// And back, to edit their proposal or counteroffer.
function fromOffer(o) {
  const d = freshDraft(o.kind === 'peace' ? 'war' : 'neutral');
  d.kind = o.kind;
  d.payYou = Math.max(0, o.pay || 0);
  d.payThem = Math.max(0, -(o.pay || 0));
  if (o.tribute) {
    d.tributeYou = Math.max(0, o.tribute.perDay);
    d.tributeThem = Math.max(0, -o.tribute.perDay);
    d.tributeDays = o.tribute.days;
  }
  if (o.limit) {
    d.limitOn = o.limit.on;
    d.limitSoldiers = o.limit.soldiers;
    d.limitDays = o.limit.days;
  }
  d.days = o.days ?? DEFAULT_DAYS[o.kind] ?? 7;
  return d;
}

export class DiplomacySheet {
  // deps: { diplomacy: () → Diplomacy, toast, sound(name), onOpen(), openBase(id) }
  constructor(deps) {
    this.d = deps;
    this.el = document.getElementById('diplomacy-sheet');
    this.card = document.getElementById('diplo-card');
    this.open = false;
    this.draft = null; // { id, ...freshDraft }
    this.reply = null; // { id, outcome, line, counter }
    this.sureWar = null;
    this._key = '';
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.card.addEventListener('click', (e) => this.onCardClick(e));
  }

  get dip() {
    return this.d.diplomacy();
  }

  toggle(force = !this.open, id = null) {
    this.open = force;
    this.el.hidden = !force;
    if (force) {
      this.d.onOpen?.();
      this.focus = id;
      this.render(true);
    } else {
      this.draft = null;
      this.reply = null;
    }
  }

  tick() {
    if (this.open) this.render(false);
  }

  // ---- The sheet ----------------------------------------------------------------------------

  render(force) {
    const dip = this.dip;
    const views = dip.world.neighbours.map((c) => dip.view(c.id));
    const key = JSON.stringify([views.map((v) => [v.stance, v.trust, v.treaties.length, v.offer?.at, v.closedFor > 0, v.war?.battles, v.log[0]?.text]), this.draft, this.reply, this.sureWar, dip.reputation]);
    if (!force && key === this._key) return;
    this._key = key;
    const rep = dip.reputation;
    this.el.innerHTML = `
      <header><h2>Diplomacy</h2><button type="button" class="insp-close" data-close aria-label="Close">${CLOSE}</button></header>
      <p class="dp-intro">Your reputation: <b>${reputationWord(rep)}</b> (${Math.round(rep)}). Keeping treaties earns it; breaking one costs it with every mayor. Raids and attacks only happen in a declared war.</p>
      ${views.map((v) => this.townHtml(v)).join('')}`;
  }

  townHtml(v) {
    const L = v.leader;
    const war = v.war;
    const treaties = v.treaties
      .map((x) => {
        const bits = [];
        if (x.tribute && x.tribute.until > this.dip.now()) bits.push(x.tribute.perDay > 0 ? `you pay ${money(x.tribute.perDay)} a day` : `they pay you ${money(-x.tribute.perDay)} a day`);
        if (x.limit && x.limit.until > this.dip.now()) bits.push(`${x.limit.on === 'you' ? 'your' : 'their'} army capped at ${x.limit.soldiers}`);
        return `<li><b>${esc(KIND_LABEL[x.kind])}</b>${x.surrender ? ' (your surrender)' : ''} · ${days(x.left)}${bits.length ? ` · ${esc(bits.join(', '))}` : ''}</li>`;
      })
      .join('');
    const offer = v.offer
      ? `<div class="dp-offer">
          <p><b>${esc(L.name)} proposes ${v.offer.surrender ? 'that you surrender' : `a ${esc(KIND_LABEL[v.offer.kind].toLowerCase())}`}</b>${this.dip.termsText(v.offer, v.town) ? `: ${esc(this.dip.termsText(v.offer, v.town))}` : ''}.</p>
          <div class="dp-row"><button type="button" class="primary-btn" data-accept="${esc(v.id)}">Accept</button><button type="button" class="pill" data-counter-their="${esc(v.id)}">Counter…</button><button type="button" class="pill" data-refuse="${esc(v.id)}">Turn down</button></div>
        </div>`
      : '';
    const draft = this.draft?.id === v.id ? this.draftHtml(v) : '';
    const sure = this.sureWar === v.id;
    const canWar = !war && !this.dip.warError(v.id);
    const actions = `<div class="dp-row">
        ${!draft ? `<button type="button" class="pill" data-propose="${esc(v.id)}" ${v.closedFor > 0 ? 'disabled' : ''}>${v.closedFor > 0 ? `Not talking for ${days(v.closedFor).replace(' left', '')}` : 'Propose a treaty…'}</button>` : ''}
        <button type="button" class="pill" data-gift="${esc(v.id)}" data-amount="250">Gift ${money(250)}</button>
        <button type="button" class="pill" data-gift="${esc(v.id)}" data-amount="1000">Gift ${money(1000)}</button>
        ${v.stance === 'alliance' ? `<button type="button" class="pill" data-endalliance="${esc(v.id)}">End the alliance</button>` : ''}
        ${canWar ? `<button type="button" class="pill danger" data-war="${esc(v.id)}">${sure ? (v.betrayal ? `Break the ${esc(KIND_LABEL[v.betrayal.kind].toLowerCase())} and declare war?` : 'Tap again to declare war') : 'Declare war'}</button>` : ''}
        <button type="button" class="pill" data-base="${esc(v.id)}">Base</button>
      </div>`;
    const trustPct = Math.round((v.trust + 100) / 2);
    return `<article class="dp-card dp-${v.stance}">
      <header><span class="dp-stance">${esc(STANCE_LABEL[v.stance])}</span><h3>${esc(v.town)}</h3></header>
      <p class="dp-leader">${esc(L.title)} <b>${esc(L.name)}</b>${v.words.length ? ` · ${esc(v.words.join(', '))}` : ''}</p>
      <div class="dp-trust"><span>Trust in you: <b>${trustWord(v.trust)}</b> (${v.trust})</span><span class="dp-meter" role="img" aria-label="Trust ${v.trust} from −100 to 100"><span style="left:${trustPct}%"></span></span></div>
      ${war ? `<p class="dp-war">At war for ${Math.max(1, Math.round(war.days))} day${Math.max(1, Math.round(war.days)) === 1 ? '' : 's'} (${war.by === 'you' ? 'you declared it' : 'they declared it'}). Battles won: you ${war.battles.you}, them ${war.battles.them}. Soldiers lost: you ${war.lost.you}, them ${war.lost.them}.</p>` : ''}
      ${treaties ? `<ul class="dp-treaties">${treaties}</ul>` : ''}
      ${offer}
      ${draft}
      ${actions}
      ${v.log.length ? `<details class="dp-log"><summary>What has happened</summary><ul>${v.log.map((l) => `<li><small>Day ${l.day}</small> ${esc(l.text)}</li>`).join('')}</ul></details>` : ''}
    </article>`;
  }

  draftHtml(v) {
    const d = this.draft;
    const at = v.stance === 'war';
    const kinds = at ? ['peace'] : ['pact', 'alliance'];
    const step = (field, by, label, value, unit = '') => `<span class="dp-step"><span>${label}</span><button type="button" class="pill icon" data-step="${field}" data-by="${-by}" aria-label="Less">−</button><b>${unit === '$' ? money(value) : `${value}${unit}`}</b><button type="button" class="pill icon" data-step="${field}" data-by="${by}" aria-label="More">+</button></span>`;
    const reply = this.reply?.id === v.id ? this.reply : null;
    const counter = reply?.counter;
    return `<div class="dp-draft">
      <div class="seg" role="group">${kinds.map((k) => `<button type="button" data-kind="${k}" aria-pressed="${d.kind === k}">${esc(KIND_LABEL[k])}</button>`).join('')}</div>
      <div class="dp-terms">
        ${d.kind !== 'alliance' ? step('days', 1, d.kind === 'peace' ? 'No war for' : 'Lasts', d.days, ' days') : ''}
        ${step('payYou', 250, 'You pay now', d.payYou, '$')}
        ${step('payThem', 250, 'They pay now', d.payThem, '$')}
        ${step('tributeYou', 50, 'You pay daily', d.tributeYou, '$')}
        ${step('tributeThem', 50, 'They pay daily', d.tributeThem, '$')}
        ${d.tributeYou || d.tributeThem ? step('tributeDays', 1, 'Daily payments for', d.tributeDays, ' days') : ''}
        <span class="dp-step"><span>Army cap</span><span class="seg" role="group">${[
          [null, 'None'],
          ['them', 'Theirs'],
          ['you', 'Yours'],
        ]
          .map(([k, l]) => `<button type="button" data-limit="${k ?? ''}" aria-pressed="${d.limitOn === k}">${l}</button>`)
          .join('')}</span></span>
        ${d.limitOn ? `${step('limitSoldiers', 1, 'At most', d.limitSoldiers, ' soldiers')}${step('limitDays', 1, 'For', d.limitDays, ' days')}` : ''}
      </div>
      ${reply ? `<p class="dp-reply dp-${reply.outcome}">“${esc(reply.line)}”${counter ? ` They'd sign this: ${esc(this.dip.termsText(counter, v.town) || 'no extra terms')}.` : ''}</p>` : ''}
      <div class="dp-row">
        ${counter ? `<button type="button" class="primary-btn" data-takecounter="${esc(v.id)}">Accept their terms</button><button type="button" class="pill" data-editcounter="${esc(v.id)}">Change them</button>` : `<button type="button" class="primary-btn" data-send="${esc(v.id)}">Propose</button>`}
        <button type="button" class="pill" data-cancel>Walk away</button>
      </div>
    </div>`;
  }

  onClick(e) {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const ds = b.dataset;
    const dip = this.dip;
    const done = (r, ok) => {
      if (r?.error) {
        this.d.toast(r.error, 3000);
        this.d.sound?.('nope');
      } else if (ok) {
        this.d.toast(ok, 3200);
        this.d.sound?.('click');
      }
      this.render(true);
    };
    if (ds.close != null) return this.toggle(false);
    if (ds.base) {
      this.toggle(false);
      return this.d.openBase?.(ds.base);
    }
    if (ds.propose) {
      this.draft = { id: ds.propose, ...freshDraft(dip.stance(ds.propose)) };
      this.reply = null;
      return this.render(true);
    }
    if (ds.cancel != null) {
      this.draft = null;
      this.reply = null;
      return this.render(true);
    }
    if (ds.kind && this.draft) {
      this.draft.kind = ds.kind;
      this.draft.days = DEFAULT_DAYS[ds.kind] ?? this.draft.days;
      this.reply = null;
      return this.render(true);
    }
    if (ds.step && this.draft) {
      const lim = { days: [2, 30], payYou: [0, 20000], payThem: [0, 20000], tributeYou: [0, 1000], tributeThem: [0, 1000], tributeDays: [1, 20], limitSoldiers: [0, 24], limitDays: [1, 20] }[ds.step];
      this.draft[ds.step] = Math.max(lim[0], Math.min(lim[1], this.draft[ds.step] + Number(ds.by)));
      this.reply = null;
      return this.render(true);
    }
    if (ds.limit != null && this.draft) {
      this.draft.limitOn = ds.limit || null;
      this.reply = null;
      return this.render(true);
    }
    if (ds.send) {
      const kind = this.draft.kind;
      const r = dip.propose(ds.send, toOffer(this.draft));
      this.reply = { id: ds.send, ...r };
      if (r.outcome === 'accepted') {
        this.draft = null;
        this.reply = null;
        this.d.sound?.('cheer');
        return done(null, `“${r.line}” ${KIND_LABEL[kind]} signed`);
      }
      if (r.outcome === 'closed') this.draft = null;
      this.d.sound?.(r.outcome === 'countered' ? 'click' : 'nope');
      return this.render(true);
    }
    if (ds.takecounter) {
      const r = dip.acceptCounter(ds.takecounter);
      this.draft = null;
      this.reply = null;
      return done(r, r.ok ? 'Signed on their terms' : null);
    }
    if (ds.editcounter) {
      const counter = this.reply?.counter;
      if (counter) this.draft = { id: ds.editcounter, ...fromOffer(counter) };
      this.reply = null;
      return this.render(true);
    }
    if (ds.accept) {
      const r = dip.respond(ds.accept, true);
      this.hideCard();
      return done(r, r.ok ? 'Agreed and signed' : null);
    }
    if (ds.refuse) {
      const r = dip.respond(ds.refuse, false);
      this.hideCard();
      return done(r, r.ok ? 'You turned it down' : null);
    }
    if (ds.counterTheir) {
      const o = dip.rel(ds.counterTheir).offer;
      if (o) this.draft = { id: ds.counterTheir, ...fromOffer(o) };
      this.reply = null;
      return this.render(true);
    }
    if (ds.gift) {
      const r = dip.gift(ds.gift, Number(ds.amount));
      return done(r, r.ok ? 'Gift sent. They think better of you' : null);
    }
    if (ds.endalliance) return done(dip.endAlliance(ds.endalliance), 'The alliance is over');
    if (ds.war) {
      if (this.sureWar !== ds.war) {
        this.sureWar = ds.war;
        setTimeout(() => {
          if (this.sureWar === ds.war) {
            this.sureWar = null;
            this.render(true);
          }
        }, 4000);
        return this.render(true);
      }
      this.sureWar = null;
      const r = dip.declareWar(ds.war, 'you');
      this.d.sound?.('warning');
      return done(r, r.ok ? (r.broken ? 'War declared. Breaking your word has cost you trust everywhere' : 'War declared. Their raids may come soon') : null);
    }
  }

  // ---- The card: their proposal, or their declaration of war -------------------------------

  showEvent(ev) {
    const dip = this.dip;
    const c = dip.town(ev.id);
    if (!c) return;
    const L = dip.leader(c);
    let html = '';
    if (ev.kind === 'war' && ev.by === 'them') {
      html = `<h2>⚔ ${esc(c.entry.name)} declares war</h2>
        <p>${esc(L.title)} ${esc(L.name)} has declared war on your town${ev.broken ? ', breaking your treaty' : ''}. Their raids may come in a few hours. Get your base ready, or try to talk them round.</p>
        <div class="dp-row"><button type="button" class="primary-btn" data-card-base="${esc(ev.id)}">Open the base</button><button type="button" class="pill" data-card-talk="${esc(ev.id)}">Diplomacy</button><button type="button" class="pill" data-card-close>Later</button></div>`;
    } else if (ev.kind === 'offer') {
      const o = ev.offer;
      const terms = dip.termsText(o, c.entry.name);
      html = `<h2>${o.surrender ? '⚑ ' : '✉ '}${esc(c.entry.name)} ${o.surrender ? 'demands your surrender' : `proposes a ${esc(KIND_LABEL[o.kind].toLowerCase())}`}</h2>
        <p>${esc(L.title)} ${esc(L.name)}: ${terms ? esc(terms[0].toUpperCase() + terms.slice(1)) + '.' : 'no other terms.'}</p>
        <p class="dp-small">The proposal stands for a day.</p>
        <div class="dp-row"><button type="button" class="primary-btn" data-card-accept="${esc(ev.id)}">Accept</button><button type="button" class="pill" data-card-talk="${esc(ev.id)}">Counter…</button><button type="button" class="pill" data-card-refuse="${esc(ev.id)}">Turn down</button><button type="button" class="pill" data-card-close>Later</button></div>`;
    } else return;
    this.card.innerHTML = html;
    this.card.hidden = false;
  }

  hideCard() {
    this.card.hidden = true;
  }

  onCardClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    const ds = b.dataset;
    const dip = this.dip;
    if (ds.cardClose != null) return this.hideCard();
    if (ds.cardBase) {
      this.hideCard();
      return this.d.openBase?.(ds.cardBase);
    }
    if (ds.cardTalk) {
      this.hideCard();
      const o = dip.rel(ds.cardTalk).offer;
      this.toggle(true, ds.cardTalk);
      if (o) {
        this.draft = { id: ds.cardTalk, ...fromOffer(o) };
        this.render(true);
      }
      return;
    }
    if (ds.cardAccept || ds.cardRefuse) {
      const id = ds.cardAccept || ds.cardRefuse;
      const r = dip.respond(id, !!ds.cardAccept);
      this.hideCard();
      if (r.error) this.d.toast(r.error, 3000);
      else this.d.toast(ds.cardAccept ? 'Agreed and signed' : 'You turned it down', 2600);
      if (this.open) this.render(true);
    }
  }
}
