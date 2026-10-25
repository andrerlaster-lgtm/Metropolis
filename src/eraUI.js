// Era and Town history sections of the City panel: the current era, what the next one needs (people
// and years), how fast the town is growing, and the chronicle of firsts, eras, decisions and family.

import { ERAS } from './eras.js';
import { REPUTATION, RESOURCES } from './config.js';
import { shortage } from './resources.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ICON = { first: '★', era: '◆', decision: '⚖', family: '♥', note: '•' };

export function eraKey(eras, growth, city) {
  const p = eras.progress();
  return JSON.stringify([eras.index, eras.year, p && Math.round(p.fraction * 40), growth?.on, growth && Math.round(growth.rate() * 10), (city.systems.chronicle || []).length, Math.round((city.derived.reputation?.value ?? 0.5) * 100), ['food', 'goods', 'power'].map((k) => { const r = city.derived.resources?.[k]; return r ? [r.made, r.need] : 0; })]);
}

export function eraHTML(eras, growth) {
  const cur = eras.current;
  const p = eras.progress();
  const rate = growth?.on ? growth.rate() : 0;
  const boosts = (growth?.state.boosts || []).map((b) => `<span class="dtag ${b.mult >= 1 ? 'good' : 'bad'}">${esc(b.label)}: ${b.mult >= 1 ? 'faster' : 'slower'}</span>`).join('');
  return (
    `<div class="era-now"><span class="era-dot" aria-hidden="true">${ERAS.map((_, i) => `<i class="${i <= eras.index ? 'on' : ''}"></i>`).join('')}</span>` +
    `<div><b>${esc(cur.label)}</b> · ${eras.year}<small>${esc(cur.blurb)}</small></div></div>` +
    (p
      ? `<div class="tier-progress"><span style="width:${Math.round(p.fraction * 100)}%"></span></div>` +
        `<p class="era-need">Next: <b>${esc(p.next.label)}</b> needs ${p.needPop.toLocaleString()} people (now ${p.pop.toLocaleString()}) and ${p.needYears} years since founding (now ${p.years}).</p>`
      : '<p class="era-need">The town has reached its brightest era.</p>') +
    reputationHTML(eras.city.derived.reputation) +
    suppliesHTML(eras.city.derived.resources) +
    (growth
      ? `<p class="era-need">${growth.on ? `Growing by itself at ${Math.round(rate * 100)}% pace. Happier towns grow faster; decisions can speed it up or slow it down.` : 'Growth is off: the town only changes when you build. Turn it on in ☰ Settings.'}</p>` +
        (boosts ? `<p class="dtags">${boosts}</p>` : '')
      : '')
  );
}

// Food, goods and power: what is made against what is needed, and what would help (resources.js).
function suppliesHTML(res) {
  if (!res) return '';
  const rows = ['food', 'goods', 'power'].filter((k) => res[k].need > 0);
  if (!rows.length) return '';
  const s = shortage(res);
  return (
    `<p class="era-need"><b>Supplies:</b> ${rows.map((k) => `${RESOURCES[k].label} ${res[k].made}/${res[k].need}`).join(' · ')}. ` +
    (s ? `Short of ${RESOURCES[s.kind].label.toLowerCase()}: ${esc(s.fix)} would help.` : 'Everyone is well supplied.') +
    ' A fed and powered town is a little happier, and goods help shops earn more.</p>'
  );
}

// What the town is known for, and what is lifting or dragging it. Hidden until there are residents.
function reputationHTML(rep) {
  if (!rep?.parts) return '';
  const pct = Math.round(rep.value * 100);
  const nudge = Math.round((rep.value - 0.5) * REPUTATION.growth * 100);
  const { green, care, services } = rep.parts;
  const notes = [];
  if (green < 0.35) notes.push('Few trees or parks near homes (plant some)');
  else if (green > 0.7) notes.push('Plenty of green around homes');
  if (rep.neglected) notes.push(`${rep.neglected} damaged or ruined ${rep.neglected === 1 ? 'thing' : 'things'} to repair`);
  else if (care === 1) notes.push('Everything is well kept');
  if (services != null && services < 0.5) notes.push('Schools and clinics don\'t reach many homes');
  const trend = rep.target - rep.value > 0.03 ? ' · rising' : rep.target - rep.value < -0.03 ? ' · slipping' : '';
  return (
    `<p class="era-need"><b>Reputation: ${esc(rep.title.label)}</b> (${pct}%${trend}). A good name makes homes a little more appealing and ${nudge >= 0 ? 'speeds up' : 'slows down'} a town that grows by itself (${nudge >= 0 ? '+' : ''}${nudge}%).` +
    (notes.length ? `<br><small>${notes.map(esc).join(' · ')}.</small>` : '') +
    '</p>'
  );
}

export function chronicleHTML(city) {
  const list = (city.systems.chronicle || []).slice().reverse();
  if (!list.length) return '<p class="insp-note">The town\'s story will be written here: firsts, new eras, decisions and family milestones.</p>';
  const row = (c) =>
    `<li class="chron-${c.kind}"><span class="chron-year">${c.year}</span><span class="chron-icon" aria-hidden="true">${ICON[c.kind] || '•'}</span><span>${esc(c.text)}</span>` +
    (c.x != null ? `<button type="button" class="ghost-btn small" data-showtile="${c.x},${c.y}">Show</button>` : '') +
    '</li>';
  return `<ol class="chronicle-list">${list.slice(0, 8).map(row).join('')}</ol>` + (list.length > 8 ? `<details class="trend-table"><summary>Earlier history</summary><ol class="chronicle-list">${list.slice(8).map(row).join('')}</ol></details>` : '');
}
