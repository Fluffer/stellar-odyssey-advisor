// Behavior locks for lib/systems.js: the nine starter systems as the game
// client lists them, the plane distance the game uses for "light years to
// the nearest starter system", and the per-system description the base tab
// shows (coordinates, distance from here, nearest starter).
"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const S = require("../lib/systems.js");
const { planBaseFromState } = require("../lib/base.js");

describe("starter systems", () => {
  test("nine starters on the 875/3500/6125 grid at z = 1", () => {
    assert.equal(S.STARTER_SYSTEMS.length, 9);
    const axis = [875, 3500, 6125];
    for (const st of S.STARTER_SYSTEMS) {
      assert.ok(axis.includes(st.x) && axis.includes(st.y), st.name);
      assert.equal(st.z, 1);
    }
    assert.deepEqual(S.STARTER_SYSTEMS.find(s => s.name === "Sun"), { name: "Sun", star: "G type", x: 3500, y: 3500, z: 1 });
  });
  test("distance is measured in the x/y plane only", () => {
    assert.equal(S.distance({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 900 }), 5);
    assert.equal(S.distance({ x: 1, y: 1 }, { name: "no coords" }), null);
  });
  test("nearest starter: Sun for a system just off it, zero distance on a starter itself", () => {
    assert.deepEqual(S.nearestStarter({ x: 3600, y: 3600 }), { name: "Sun", distance: Math.sqrt(2 * 100 * 100) });
    assert.deepEqual(S.nearestStarter({ x: 875, y: 875 }), { name: "Therion", distance: 0 });
    assert.equal(S.nearestStarter({}), null);
  });
  test("describe: coordinates, distance from the current system, starter flag", () => {
    const cur = { x: 3500, y: 3500, z: 1 };
    const d = S.describe({ x: 3500, y: 3600, z: 2 }, cur);
    assert.deepEqual(d, { coords: { x: 3500, y: 3600, z: 2 }, fromCurrent: 100, nearestStarter: "Sun", starterDistance: 100, isStarter: false });
    assert.equal(S.describe(cur, cur).fromCurrent, 0);
    assert.equal(S.describe(cur, cur).isStarter, true);
    assert.deepEqual(S.describe({ name: "unknown" }, cur), { coords: null, fromCurrent: null, nearestStarter: null, starterDistance: null, isStarter: false });
  });
});

describe("base planner carries the system facts and a Stellarium block", () => {
  const state = {
    currentSystem: { name: "Home", star: "G type", x: 3600, y: 3600, z: 2, bodies: [] },
    bookmarks: [{ name: "Far", star: "Black Hole", x: 1000, y: 1000, z: 1, bodies: [] }],
    materials: [], commonResources: {}, rareCurrencies: {},
  };
  const b = planBaseFromState(state, {});
  test("location rows have coordinates and distances", () => {
    assert.deepEqual(b.location.current.coords, { x: 3600, y: 3600, z: 2 });
    assert.equal(b.location.current.nearestStarter, "Sun");
    assert.equal(b.location.bookmarks[0].nearestStarter, "Therion");
    assert.ok(Math.abs(b.location.bookmarks[0].fromCurrent - Math.sqrt(2 * 2600 * 2600)) < 1e-9);
  });
  test("stellarium block: 4.8 ticks a day, unlock curve N(N+1)/2, every star listed", () => {
    const st = b.stellarium;
    assert.equal(st.ticksPerDay, 4.8);
    assert.equal(st.perDay, st.perTick * 4.8);
    assert.deepEqual(st.unlockCurve.slice(0, 4).map(u => u.cost), [1, 3, 6, 10]);
    assert.deepEqual(st.tierCurve.map(x => x.cost), [1, 10, 50, 200, 600, 1600]);
    assert.equal(st.stars.length, 11);
    assert.equal(st.unlockedCount, 0);
    assert.equal(st.held, 0);
  });
});
