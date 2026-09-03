// Behavior locks for the catalyst-merge planning in advisor-core.js
// (planCatalystMergeGroups and planMerges), ported from the game's JS
// bundle. Goldens were produced by running the CURRENT implementation
// against synthetic catalyst lists and hardcoding the resulting grouping.
"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../advisor-core.js");

function mkCat(id, range, opts) {
  return Object.assign({ _id: id, range, stat: "defense", rarity: "normal", activity: "default" }, opts || {});
}

describe("planCatalystMergeGroups", () => {
  test("fewer than 5 items: no groups, everything left over", () => {
    const items = [1, 2, 3, 4].map((r, i) => mkCat("c" + i, r));
    const { groups, leftover } = core.planCatalystMergeGroups(items, 10);
    assert.equal(groups.length, 0);
    assert.equal(leftover.length, 4);
  });

  test("exactly 5 items: one group of 5, no leftover", () => {
    const items = [10, 20, 30, 40, 50].map((r, i) => mkCat("c" + i, r));
    const { groups, leftover } = core.planCatalystMergeGroups(items, 10);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].length, 5);
    assert.equal(leftover.length, 0);
  });

  test("12 items: 2 groups of 5, 2 left over", () => {
    const items = Array.from({ length: 12 }, (_, i) => mkCat("c" + i, (i + 1) * 5));
    const { groups, leftover } = core.planCatalystMergeGroups(items, 10);
    assert.equal(groups.length, 2);
    for (const g of groups) assert.equal(g.length, 5);
    assert.equal(leftover.length, 2);
  });

  test("every produced group has exactly 5 items", () => {
    const items = Array.from({ length: 27 }, (_, i) => mkCat("c" + i, (i * 7) % 100));
    const { groups } = core.planCatalystMergeGroups(items, 8);
    assert.ok(groups.length > 0);
    for (const g of groups) assert.equal(g.length, 5);
  });

  test("golden grouping: picks the weakest catalysts that still reach the target", () => {
    // 5 catalysts at range 100 and 5 at range 60. bonus=10, target=100.
    // golden: locks current grouping algorithm's picks (run current code
    // first — this is NOT hand-derived, it is what planCatalystMergeGroups
    // actually produces).
    const ranges = [100, 100, 100, 100, 100, 60, 60, 60, 60, 60];
    const items = ranges.map((r, i) => mkCat("c" + i, r));
    const { groups, leftover } = core.planCatalystMergeGroups(items, 10, 100);
    assert.equal(groups.length, 2);
    assert.deepEqual(groups[0].map(c => c.range), [100, 100, 100, 100, 60]);
    assert.deepEqual(groups[1].map(c => c.range), [100, 60, 60, 60, 60]);
    assert.equal(leftover.length, 0);
  });
});

describe("planMerges", () => {
  test("pool of 5 identical normal catalysts on the perfect path produces one normal->uncommon plan", () => {
    const pool = [100, 100, 100, 100, 100].map((r, i) =>
      ({ _id: "n" + i, stat: "defense", rarity: "normal", range: r, activity: "default" })
    );
    const plans = core.planMerges(pool, 0);
    assert.equal(plans.length, 1);
    assert.equal(plans[0].stat, "defense");
    assert.equal(plans[0].activity, "default");
    assert.equal(plans[0].steps.length, 1);
    assert.equal(plans[0].steps[0].from, "normal");
    assert.equal(plans[0].steps[0].to, "uncommon");
    assert.equal(plans[0].steps[0].groups.length, 1);
    assert.equal(plans[0].steps[0].groups[0].result, 100);
  });

  test("pool of only 4 catalysts produces no plans", () => {
    const pool = [100, 100, 100, 100].map((r, i) =>
      ({ _id: "n" + i, stat: "defense", rarity: "normal", range: r, activity: "default" })
    );
    const plans = core.planMerges(pool, 0);
    assert.equal(plans.length, 0);
  });
});
