// Tab guard: only one browser tab plays (and saves) at a time, so two open tabs can't save over each
// other's towns. Uses the Web Locks API: the playing tab holds a lock named after the game. A tab that
// opens while another holds it starts read-only and can take over: it asks the playing tab to save and
// step aside, and if that tab doesn't answer (frozen in the background, say) it takes the lock anyway.
// Browsers without Web Locks play as before, with no guard.

const NAME = 'pocket-metropolis';
const TAKEOVER_WAIT_MS = 1500;

export class TabGuard {
  constructor({ locks = globalThis.navigator?.locks, Channel = globalThis.BroadcastChannel, name = NAME, wait = TAKEOVER_WAIT_MS } = {}) {
    this.locks = locks;
    this.Channel = Channel;
    this.name = name;
    this.wait = wait;
    this.active = false;
    this.release = null; // resolves the promise that keeps the lock held
    this.beforeYield = null; // () → called before stepping aside, e.g. to save
    this.onLost = null; // () → called once another tab has taken over
  }

  get supported() {
    return !!this.locks;
  }

  // Resolves true when this tab may play, false when another tab already is.
  claim() {
    if (!this.locks) {
      this.active = true;
      return Promise.resolve(true);
    }
    this.listen();
    return new Promise((resolve) => {
      this.locks
        .request(this.name, { ifAvailable: true }, (lock) => {
          if (!lock) return resolve(false);
          resolve(true);
          return this.hold();
        })
        .catch(() => this.lost()); // another tab took the lock without waiting
    });
  }

  // Ask the playing tab to step aside, then take the lock. Resolves once this tab holds it.
  takeOver() {
    if (!this.locks) return Promise.resolve();
    this.listen();
    this.channel?.postMessage({ type: 'takeover' });
    return new Promise((resolve) => {
      let granted = false;
      const got = () => {
        granted = true;
        resolve();
        return this.hold();
      };
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.wait);
      this.locks
        .request(this.name, { signal: ctrl.signal }, () => {
          clearTimeout(timer);
          return got();
        })
        .catch(() => {
          if (granted) return this.lost();
          // No answer in time: take the lock from the other tab.
          this.locks.request(this.name, { steal: true }, got).catch(() => this.lost());
        });
    });
  }

  hold() {
    this.active = true;
    return new Promise((r) => (this.release = r));
  }

  listen() {
    if (this.channel || !this.Channel) return;
    this.channel = new this.Channel(this.name);
    this.channel.onmessage = (e) => {
      if (e.data?.type === 'takeover') this.stepAside();
    };
  }

  // Another tab asked to play: save, then let go of the lock.
  stepAside() {
    if (!this.active) return;
    this.beforeYield?.();
    this.active = false;
    this.release?.();
    this.release = null;
    this.onLost?.();
  }

  close() {
    this.channel?.close();
    this.channel = null;
  }

  // The lock was taken without asking (the other tab gave up waiting). Stop saving straight away.
  lost() {
    if (!this.active) return;
    this.active = false;
    this.release = null;
    this.onLost?.();
  }
}
