// Behavior locks for public/pet-math.js — the shared pet XP/food/boost-cost
// formulas ported from the game's JS bundle. These goldens were produced by
// running the CURRENT implementation and hardcoding its output; if a future
// refactor or a game update silently changes a formula, these tests fail.
"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const pm = require("../public/pet-math.js");

describe("petXpTarget", () => {
  test("golden values at levels 1, 5, 10, 30", () => {
    // golden: locks current formula (floor(100 * 1.31^(L-1)))
    assert.equal(pm.petXpTarget(1), 100);
    assert.equal(pm.petXpTarget(5), 294);
    assert.equal(pm.petXpTarget(10), 1136);
    assert.equal(pm.petXpTarget(30), 251690);
  });

  test("strictly increasing with level", () => {
    let prev = pm.petXpTarget(1);
    for (let l = 2; l <= 50; l++) {
      const cur = pm.petXpTarget(l);
      assert.ok(cur > prev, `petXpTarget(${l})=${cur} should exceed petXpTarget(${l - 1})=${prev}`);
      prev = cur;
    }
  });
});

describe("petXpBoostCost", () => {
  test("golden values at boosts 1, 5, 10", () => {
    // golden: locks current formula
    assert.equal(pm.petXpBoostCost(1), 7500000);
    assert.equal(pm.petXpBoostCost(5), 37968750);
    assert.equal(pm.petXpBoostCost(10), 288325195);
  });
});

describe("petXpBoostCostCumulative", () => {
  test("golden cumulative ranges", () => {
    // golden: locks current formula
    assert.equal(pm.petXpBoostCostCumulative(1, 5), 60937500);
    assert.equal(pm.petXpBoostCostCumulative(0, 3), 23750000);
  });
});

describe("petXpPerHour", () => {
  test("golden combos incl. premium and food levels", () => {
    // golden: locks current formula
    assert.equal(pm.petXpPerHour(10, 5, 100, 0, false), 20);
    assert.equal(pm.petXpPerHour(10, 5, 100, 0, true), 22);
    assert.equal(pm.petXpPerHour(10, 5, 50, 0, false), 10);
    assert.equal(pm.petXpPerHour(20, 10, 100, 20, true), 60);
  });

  test("monotonic non-decreasing in boost", () => {
    let prev = pm.petXpPerHour(10, 0, 100, 0, false);
    for (let b = 1; b <= 20; b++) {
      const cur = pm.petXpPerHour(10, b, 100, 0, false);
      assert.ok(cur >= prev, `xp/hr should not decrease as boost rises (boost=${b})`);
      prev = cur;
    }
  });

  test("monotonic non-decreasing in food", () => {
    let prev = pm.petXpPerHour(10, 5, 50, 0, false);
    for (let f = 55; f <= 100; f += 5) {
      const cur = pm.petXpPerHour(10, 5, f, 0, false);
      assert.ok(cur >= prev, `xp/hr should not decrease as food rises (food=${f})`);
      prev = cur;
    }
  });
});

describe("petHoursToNextLevel", () => {
  test("autofeed reaches next level in fewer-or-equal hours than no autofeed", () => {
    // golden: locks current formula (autofeed keeps food topped up, so it
    // should never take MORE hours than the plain floor-at-50 decay).
    const noAuto = pm.petHoursToNextLevel(5, 0, 3, 100, false, 50, 0, false);
    const auto = pm.petHoursToNextLevel(5, 0, 3, 100, true, 80, 0, false);
    assert.equal(noAuto, 43);
    assert.equal(auto, 27);
    assert.ok(auto <= noAuto);
  });
});

describe("petAvgFood", () => {
  test("golden values for autofeed limits 50/75/100 vs no autofeed", () => {
    // golden: locks current formula
    assert.equal(pm.petAvgFood(100, true, 50), 75);
    assert.equal(pm.petAvgFood(100, true, 75), 87.5);
    assert.equal(pm.petAvgFood(100, true, 100), 100);
    assert.equal(pm.petAvgFood(100, false, 50), 59.2);
  });
});
