// Behavior locks for public/voyager-math.js: the Voyager upgrade costs
// ported from the game bundle (stellarlib: timerCost, jumpCost, rewardCost,
// totalFuelCostFromLevel and their getMax*Upgrades inverses) and the
// emulator the GUI's Voyager tab runs on them. Goldens are worked by hand
// from the game's formulas.
"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("../public/voyager-math.js");

describe("voyager upgrade costs", () => {
  test("travel time: the k-th second off the base costs 500k dust", () => {
    assert.equal(vm.timerCost(0), 0);
    assert.equal(vm.timerUpgradeCost(0, 1), 500);
    assert.equal(vm.timerUpgradeCost(0, 2), 1500);
    assert.equal(vm.timerUpgradeCost(5, 1), 3000);
    assert.equal(vm.timerUpgradeCost(0, 1200), 500 * 1200 * 1201 / 2); // the full 10-minute floor
  });
  test("max jumps: 25*(j+1)^2, so 3 -> 4 costs 225 quantum cores", () => {
    assert.equal(vm.jumpCost(3), 400);
    assert.equal(vm.jumpUpgradeCost(3, 1), 225);
    assert.equal(vm.jumpUpgradeCost(3, 17), 25 * 441 - 400); // 3 -> 20
  });
  test("reward bonus: 1e6*(r+1)^2, so the first level costs 3M credits", () => {
    assert.equal(vm.rewardUpgradeCost(0, 1), 3e6);
    assert.equal(vm.rewardUpgradeCost(10, 1), 1e6 * (144 - 121));
  });
  test("max fuel: the k-th unit past 100 costs 1+k cores", () => {
    assert.equal(vm.fuelUpgradeCost(0, 1), 1);
    assert.equal(vm.fuelUpgradeCost(0, 3), 6);
    assert.equal(vm.fuelUpgradeCost(50, 2), 51 + 52);
    assert.equal(vm.fuelUpgradeCost(0, 0), 0);
  });
});

describe("how many upgrades the stock covers (game inverses)", () => {
  test("each inverse is exact at the cost boundary", () => {
    for (const [t, n] of [[0, 1], [0, 7], [40, 3], [1000, 200]]) {
      const c = vm.timerUpgradeCost(t, n);
      assert.equal(vm.maxTimerUpgrades(c, t), n, "timer " + t + "+" + n);
      assert.equal(vm.maxTimerUpgrades(c - 1, t), n - 1);
    }
    for (const [j, n] of [[3, 1], [3, 5], [10, 10]]) {
      const c = vm.jumpUpgradeCost(j, n);
      assert.equal(vm.maxJumpUpgrades(c, j), n, "jumps " + j + "+" + n);
      assert.equal(vm.maxJumpUpgrades(c - 1, j), n - 1);
    }
    for (const [r, n] of [[0, 1], [0, 4], [19, 2]]) {
      const c = vm.rewardUpgradeCost(r, n);
      assert.equal(vm.maxRewardUpgrades(c, r), n, "reward " + r + "+" + n);
      assert.equal(vm.maxRewardUpgrades(c - 1, r), n - 1);
    }
    for (const [lvl, n] of [[0, 1], [0, 3], [56, 9], [0, 100]]) {
      const c = vm.fuelUpgradeCost(lvl, n);
      assert.equal(vm.maxFuelUpgrades(lvl, c), n, "fuel " + lvl + "+" + n);
      assert.equal(vm.maxFuelUpgrades(lvl, c - 1), n - 1);
    }
  });
  test("timer and jumps are clamped to the game's maximums, empty stock buys nothing", () => {
    assert.equal(vm.maxTimerUpgrades(1e12, 0), vm.MAX_TIMER_UPGRADE);
    assert.equal(vm.maxTimerUpgrades(1e12, 1200), 0);
    assert.equal(vm.maxJumpUpgrades(1e9, 3), 17);
    assert.equal(vm.maxJumpUpgrades(1e9, 20), 0);
    assert.equal(vm.maxTimerUpgrades(0, 0), 0);
    assert.equal(vm.maxFuelUpgrades(0, 0), 0);
  });
});

describe("expedition stats and the emulator", () => {
  const cur = { timer: 0, max_jumps: 3, reward_bonus: 0, max_fuel: 100 };
  const stocks = { dust: 1e6, qc: 300, credits: 10e6 };
  test("unupgraded voyager: 30 min per jump, 3 jumps, 30 fuel per expedition", () => {
    const s = vm.stats(cur, {});
    assert.equal(s.travelSec, 1800);
    assert.equal(s.jumps, 3);
    assert.equal(s.expeditionSec, 5400);
    assert.equal(s.fuelPerExpedition, 30);
    assert.equal(s.tankCovers, true);
    assert.equal(s.systemsPerDay, 48);
    assert.equal(s.dustFactor, 1);
  });
  test("catalyst bonuses: jumps capped at +15, fuel efficiency at 60%, drop chance scales 8%", () => {
    const s = vm.stats({ timer: 1200, max_jumps: 20, max_fuel: 100 }, { jumpsBonus: 24, fuelEfficiency: 90, dropChance: 60 });
    assert.equal(s.travelSec, 600);
    assert.equal(s.jumps, 35);
    assert.equal(s.fuelPerJump, 4);
    assert.equal(s.fuelPerExpedition, 140);
    assert.equal(s.tankCovers, false);
    assert.equal(s.jumpsTankCovers, 25);
    assert.equal(s.systemsPerDay, 144);
    assert.ok(Math.abs(s.catalystsPerDay - 144 * 0.08 * 1.6) < 1e-9);
  });
  test("emulate: costs per currency, cores shared between jumps and fuel, plans clamped", () => {
    const e = vm.emulate(cur, { timer: 2, jumps: 1, reward: 1, fuel: 3 }, stocks, {});
    assert.deepEqual(e.plan, { timer: 2, jumps: 1, reward: 1, fuel: 3 });
    assert.deepEqual(e.costs, { dust: 1500, qcJumps: 225, qcFuel: 6, credits: 3e6, qc: 231 });
    assert.deepEqual(e.affordable, { dust: true, qc: true, credits: true });
    assert.equal(e.after.travelSec, 1798);
    assert.equal(e.after.jumps, 4);
    assert.equal(e.afterConfig.max_fuel, 103);
    assert.equal(e.after.dustFactor, 1.01);
    const over = vm.emulate(cur, { timer: 5000, jumps: 99, reward: -3, fuel: "x" }, stocks, {});
    assert.deepEqual(over.plan, { timer: 1200, jumps: 17, reward: 0, fuel: 0 });
    assert.equal(over.affordable.dust, false);
    assert.equal(over.affordable.qc, false);
  });
  test("emulate: max affordable and next-unit costs, with the maxed-out ones marked null", () => {
    const e = vm.emulate(cur, {}, stocks, {});
    assert.deepEqual(e.maxAffordable, { timer: 62, jumps: 1, reward: 2, fuel: 24 }); // 0->2 costs 8M of the 10M
    assert.deepEqual(e.nextCost, { timer: 500, jumps: 225, reward: 3e6, fuel: 1 });
    const maxed = vm.emulate({ timer: 1200, max_jumps: 20, reward_bonus: 0, max_fuel: 100 }, {}, stocks, {});
    assert.equal(maxed.nextCost.timer, null);
    assert.equal(maxed.nextCost.jumps, null);
  });
});
