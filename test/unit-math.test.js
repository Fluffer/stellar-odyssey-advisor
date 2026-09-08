// Behavior locks for public/unit-math.js — the shared droid/clone upgrade
// cost formulas (ported from the game bundle) and the cost emulator that the
// GUI's Droids & Clones tab runs on top of them. The goldens below were
// produced by summing the game's own per-step formula independently; if a
// refactor or a game update silently changes a formula, these tests fail.
"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const um = require("../public/unit-math.js");
const units = require("../lib/units.js");

// 7 droids at the same level, the usual shape of a real fleet.
const fleet = n => Array.from({ length: n }, (_, i) => ({
  name: "Droid " + (i + 1), efficiency: 34, storage: 34, maneuverability: 35,
}));
const DROID_SKILLS = ["efficiency", "storage", "maneuverability"];

describe("unit step cost", () => {
  test("golden values: 5000 * level * e^(0.15*level)", () => {
    assert.equal(Math.round(um.unitStepCost(0.1)), 508);
    assert.equal(Math.round(um.unitStepCost(10)), 224084);
    assert.equal(Math.round(um.unitStepCost(34.1)), 28388383);
  });

  test("cumulativeUnitCost sums every 0.1 step it passes", () => {
    let brute = 0;
    for (let i = 341; i <= 390; i++) brute += um.unitStepCost(i / 10);
    assert.equal(Math.round(um.cumulativeUnitCost(34, 39)), Math.round(brute));
    assert.equal(Math.round(um.cumulativeUnitCost(34, 39)), 2267964075);
  });

  test("no steps when the target is at or below the current level", () => {
    assert.equal(um.cumulativeUnitCost(34, 34), 0);
    assert.equal(um.cumulativeUnitCost(34, 30), 0);
  });

  test("lib/units.js re-exports the same functions (one source of truth)", () => {
    assert.equal(units.unitStepCost, um.unitStepCost);
    assert.equal(units.cumulativeUnitCost, um.cumulativeUnitCost);
    assert.equal(units.cloneMultiplier, um.cloneMultiplier);
  });
});

describe("groupUpgradeCost", () => {
  test("group cost is the sum of the individual unit costs", () => {
    const g = um.groupUpgradeCost(fleet(7), "efficiency", 39);
    assert.equal(g.perUnit.length, 7);
    assert.equal(Math.round(g.perUnit[0].cost), 2267964075);
    assert.ok(Math.abs(g.total - g.perUnit[0].cost * 7) < 1e-3);
    assert.equal(Math.round(g.total), 15875748524);
    assert.equal(g.unitsUpgraded, 7);
    assert.equal(g.perUnit[0].steps, 50);
  });

  test("a unit already at or above the target pays nothing", () => {
    const g = um.groupUpgradeCost(
      [{ name: "a", efficiency: 40 }, { name: "b", efficiency: 34 }], "efficiency", 39);
    assert.equal(g.perUnit[0].cost, 0);
    assert.equal(g.perUnit[0].steps, 0);
    assert.equal(Math.round(g.perUnit[1].cost), 2267964075);
    assert.equal(g.unitsUpgraded, 1);
  });

  test("targets are snapped to the game's 0.1 grid", () => {
    assert.equal(um.groupUpgradeCost(fleet(1), "efficiency", 39.04).target, 39);
    assert.equal(um.groupUpgradeCost(fleet(1), "efficiency", 39.06).target, 39.1);
  });
});

describe("maxAffordableTarget", () => {
  test("spends the exact cost of a reachable target and stops there", () => {
    const exact = um.groupUpgradeCost(fleet(7), "efficiency", 39).total;
    const m = um.maxAffordableTarget(fleet(7), "efficiency", exact);
    assert.equal(m.target, 39);
    assert.equal(Math.round(m.cost), Math.round(exact));
  });

  test("one credit short of a step stops on the step below", () => {
    const exact = um.groupUpgradeCost(fleet(7), "efficiency", 39).total;
    assert.equal(um.maxAffordableTarget(fleet(7), "efficiency", exact - 1).target, 38.9);
  });

  test("no credits leaves the group where it stands", () => {
    assert.equal(um.maxAffordableTarget(fleet(7), "efficiency", 0).target, 34);
  });

  test("a non-finite budget buys nothing instead of everything", () => {
    // `spent + inc > credits` is FALSE against NaN, so without an explicit
    // guard the walk ran to its 500 ceiling and reported target 500.1 at a
    // cost of 6.3e40 as affordable.
    for (const bad of [undefined, null, NaN, -5, "", "abc"]) {
      const m = um.maxAffordableTarget(fleet(7), "efficiency", bad);
      assert.equal(m.target, 34, "budget " + String(bad));
      assert.equal(m.cost, 0);
      assert.equal(um.unitMaxStepsAll(34, bad, 7), 0);
    }
  });
});

describe("emulateGroup", () => {
  const emu = um.emulateGroup(
    fleet(7), DROID_SKILLS, { efficiency: 39, storage: 39, maneuverability: 40 }, 18713526833);

  test("totals reconcile across the per-skill and per-unit views", () => {
    const bySkill = emu.bySkill.reduce((s, r) => s + r.total, 0);
    const byUnit = emu.perUnit.reduce((s, r) => s + r.total, 0);
    assert.equal(Math.round(bySkill), Math.round(emu.total));
    assert.equal(Math.round(byUnit), Math.round(emu.total));
    assert.equal(Math.round(emu.total), 50696898943);
  });

  test("every unit carries its own per-skill breakdown", () => {
    assert.equal(emu.perUnit.length, 7);
    assert.equal(Math.round(emu.perUnit[0].costs.efficiency), 2267964075);
    assert.equal(Math.round(emu.perUnit[0].costs.maneuverability), 2706485985);
  });

  test("affordability is measured against the credit pool", () => {
    assert.equal(emu.affordable, false);
    assert.equal(Math.round(emu.leftover), Math.round(18713526833 - emu.total));
    const cheap = um.emulateGroup(fleet(7), DROID_SKILLS,
      { efficiency: 34, storage: 34, maneuverability: 35 }, 1000);
    assert.equal(cheap.total, 0);
    assert.equal(cheap.affordable, true);
  });
});
