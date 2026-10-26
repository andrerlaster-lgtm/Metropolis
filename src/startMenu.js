// The start menu: shown when the game opens (and from ☰ → Main menu). Continue the town you were in,
// pick a saved town, or start a new one, and choose whether the computer's rival towns are part of the
// game. The choice is applied to whichever town you go on to play: the one you continue, the one you
// load or the one you start. Pure screen: the game's own sheets do the loading and starting.

const LOGO = `<svg class="sm-logo" viewBox="0 0 120 76" aria-hidden="true"><ellipse cx="60" cy="68" rx="52" ry="6" fill="#5f9a4a"/><rect x="76" y="8" width="26" height="58" rx="3" fill="#cfc6e6"/><rect x="76" y="8" width="26" height="6" rx="2" fill="#a99fcb"/><g fill="#8f86b8"><rect x="81" y="20" width="6" height="6"/><rect x="91" y="20" width="6" height="6"/><rect x="81" y="32" width="6" height="6"/><rect x="91" y="32" width="6" height="6"/><rect x="81" y="44" width="6" height="6"/><rect x="91" y="44" width="6" height="6"/></g><rect x="30" y="34" width="40" height="32" rx="2" fill="#f6e7d4"/><path d="M24 36 L50 14 L76 36 Z" fill="#ee6f5f"/><rect x="45" y="48" width="10" height="18" rx="2" fill="#a0634a"/><rect x="34" y="42" width="8" height="8" fill="#9ec7e8"/><rect x="58" y="42" width="8" height="8" fill="#9ec7e8"/><rect x="10" y="48" width="24" height="18" rx="2" fill="#e8dcf3"/><path d="M6 50 L22 36 L38 50 Z" fill="#8f6fc2"/><circle cx="12" cy="36" r="10" fill="#5da64a"/><rect x="11" y="44" width="3" height="22" fill="#7a5a3a"/><circle cx="108" cy="46" r="9" fill="#4f9a44"/><rect x="107" y="52" width="3" height="14" fill="#7a5a3a"/></svg>`;
const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
  load: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class StartMenu {
  // deps: { info() → { name, population, slot } | null, rivals() → bool, apply(rivals: bool),
  //         onLoad(), onNew(), setSpeed(n) → previous speed, backdrop(on) }
  constructor(deps) {
    this.d = deps;
    this.el = document.getElementById('start-menu');
    this.isOpen = false;
    this.choice = true;
    this.before = null;
    this.el.addEventListener('click', (e) => this.onClick(e));
  }

  open() {
    this.choice = this.d.rivals();
    this.isOpen = true;
    this.el.hidden = false;
    this.el.parentElement?.classList.add('menu-open');
    if (this.before == null) {
      this.before = this.d.setSpeed(0); // the town waits while you choose
      this.d.backdrop?.(true);
    }
    this.render();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.hidden = true;
    this.el.parentElement?.classList.remove('menu-open');
    if (this.before != null) {
      this.d.backdrop?.(false);
      this.d.setSpeed(this.before || 1);
    }
    this.before = null;
  }

  // A town was loaded or started from here: give it the chosen setting and get out of the way.
  finish() {
    if (!this.isOpen) return;
    this.d.apply(this.choice);
    this.close();
  }

  render() {
    const info = this.d.info();
    const on = this.choice;
    this.el.innerHTML = `
      <div class="sm-card glass">
        ${LOGO}
        <h1>Pocket Metropolis</h1>
        <p class="sm-sub">Build a town, live a life, lead a family.</p>
        <div class="sm-actions">
          ${info ? `<button type="button" class="primary-btn sm-continue" data-sm="continue">${ICON.play}<span><b>${info.fresh ? 'Start playing' : 'Continue'}</b><small>${esc(info.name)} · ${info.population.toLocaleString()} people${info.fresh ? '' : info.slot ? ` · slot ${info.slot}` : ''}</small></span></button>` : ''}
          <button type="button" class="ghost-btn" data-sm="load">${ICON.load}<span><b>Load a saved town…</b></span></button>
          <button type="button" class="ghost-btn" data-sm="new">${ICON.plus}<span><b>New town…</b></span></button>
        </div>
        <div class="sm-rivals">
          <div class="sm-rivals-head"><b>Rival cities</b>
            <span class="seg" role="group" aria-label="Rival cities">
              <button type="button" data-sm-rivals="1" aria-pressed="${on}">On</button>
              <button type="button" data-sm-rivals="0" aria-pressed="${!on}">Off</button>
            </span>
          </div>
          <p class="sk-intro">${on ? 'A computer-run town grows beside yours. You can trade, talk and make treaties, and it may raid you.' : 'You build alone: no rival towns, no raids and no diplomacy. Your base and army stay, but nobody attacks.'}
          This applies to the town you continue, load or start. Change it any time from ☰ → Main menu.</p>
        </div>
      </div>`;
  }

  onClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.smRivals != null) {
      this.choice = b.dataset.smRivals === '1';
      return this.render();
    }
    const a = b.dataset.sm;
    if (a === 'continue') {
      this.d.apply(this.choice);
      this.close();
    } else if (a === 'load') this.d.onLoad();
    else if (a === 'new') this.d.onNew();
  }
}
