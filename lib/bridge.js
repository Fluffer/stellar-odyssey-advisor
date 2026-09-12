// Browser bridge: the game also runs as a plain web app
// (https://steam.stellarodyssey.app), and a normal browser profile has no
// DevTools port for lib/cdp.js to attach to. bridge-extension/ runs the same
// READ_ALL expression inside the game tab and POSTs the result here. This
// module holds the latest pushed state and lets an analyze ask the extension
// for a fresh read through a long-poll, so a click on "Analyze now" gets
// live data instead of the last periodic push.
"use strict";

const DEFAULTS = {
  attachWindowMs: 90 * 1000, // heard from the extension this recently == attached
  pollHoldMs: 25 * 1000,     // a long-poll is answered "no" after this
};

class Bridge {
  constructor(opts) {
    this.opts = { ...DEFAULTS, ...(opts || {}) };
    this.latest = null;      // { state, at, url }
    this.lastPollAt = 0;
    this.pollWaiters = [];   // [{ resolve, timer }]
    this.pushWaiters = [];   // [{ resolve, timer }]
    this.pushes = 0;
  }

  now() { return Date.now(); }

  // A state arrived from the extension. `state` is whatever READ_ALL
  // produced: a JSON string on success, or an { error } object.
  push(state, meta) {
    if (typeof state === "string") state = JSON.parse(state);
    if (!state || typeof state !== "object") throw new Error("bridge: state is not an object");
    if (state.error) throw new Error("bridge: page reported: " + state.error);
    // READ_ALL fills `player` from UserStore.player, which is null on the
    // login screen. Analyzing that would fail later in an opaque way, and a
    // logged-out tab must not shadow a running Steam client.
    if (!state.player) throw new Error("bridge: the game tab is not logged in");
    this.latest = { state, at: this.now(), url: meta && meta.url };
    this.pushes++;
    for (const w of this.pushWaiters.splice(0)) { clearTimeout(w.timer); w.resolve(this.latest); }
    return this.latest;
  }

  // The extension's background worker asks "do you want a read now?". Held
  // until requestFresh() wants one, or pollHoldMs passes.
  waitForPoll() {
    this.lastPollAt = this.now();
    return new Promise((resolve) => {
      const entry = { resolve, timer: null };
      entry.timer = setTimeout(() => {
        this.pollWaiters = this.pollWaiters.filter(w => w !== entry);
        resolve({ read: false });
      }, this.opts.pollHoldMs);
      this.pollWaiters.push(entry);
    });
  }

  attached() {
    const now = this.now();
    return (now - this.lastPollAt) < this.opts.attachWindowMs ||
      (this.latest !== null && (now - this.latest.at) < this.opts.attachWindowMs);
  }

  // Wake one waiting poller and wait for the push it triggers. Resolves null
  // when no browser is attached or nothing arrives within timeoutMs.
  requestFresh(timeoutMs) {
    if (!this.attached()) return Promise.resolve(null);
    const waiter = this.pollWaiters.shift();
    if (waiter) { clearTimeout(waiter.timer); waiter.resolve({ read: true }); }
    return new Promise((resolve) => {
      const entry = { resolve, timer: null };
      entry.timer = setTimeout(() => {
        this.pushWaiters = this.pushWaiters.filter(w => w !== entry);
        resolve(null);
      }, timeoutMs);
      this.pushWaiters.push(entry);
    });
  }

  // The latest push if it is at most maxAgeMs old, else null.
  freshest(maxAgeMs) {
    if (!this.latest) return null;
    return (this.now() - this.latest.at) <= maxAgeMs ? this.latest : null;
  }

  status() {
    const now = this.now();
    return {
      attached: this.attached(),
      pushes: this.pushes,
      lastPushAgeMs: this.latest ? now - this.latest.at : null,
      lastPollAgeMs: this.lastPollAt ? now - this.lastPollAt : null,
      url: this.latest ? this.latest.url : null,
      pollersWaiting: this.pollWaiters.length,
    };
  }
}

module.exports = { Bridge, DEFAULTS };
