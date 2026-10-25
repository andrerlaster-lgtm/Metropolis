// The start menu: shown when the game opens (and from ☰ → Main menu). Continue the town you were in,
// pick a saved town, or start a new one, and choose whether the computer's rival towns are part of the
// game. The choice is applied to whichever town you go on to play: the one you continue, the one you
// load or the one you start. Pure screen: the game's own sheets do the loading and starting.

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
        <h1>Pocket Metropolis</h1>
        <p class="sm-sub">Build a town, live a life, lead a family.</p>
        <div class="sm-actions">
          ${info ? `<button type="button" class="primary-btn sm-continue" data-sm="continue"><b>${info.fresh ? 'Start playing' : 'Continue'}</b><small>${esc(info.name)} · ${info.population.toLocaleString()} people${info.fresh ? '' : info.slot ? ` · slot ${info.slot}` : ''}</small></button>` : ''}
          <button type="button" class="ghost-btn" data-sm="load"><b>Load a saved town…</b></button>
          <button type="button" class="ghost-btn" data-sm="new"><b>New town…</b></button>
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
