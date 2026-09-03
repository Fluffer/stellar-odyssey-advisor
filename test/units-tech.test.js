// Behavior locks for the droid/clone (planUnits) and technology (planTech)
// advisors in advisor-core.js, ported from the game's JS bundle. Goldens
// were produced by running the CURRENT implementation and hardcoding its
// output.
"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../advisor-core.js");

describe("unitStepCost", () => {
  test("golden values at levels 0.1, 1, 10, 50", () => {
    // golden: locks current formula (5000 * level * e^(0.15*level))
    assert.equal(core.unitStepCost(0.1), 507.55653230785947);
    assert.equal(core.unitStepCost(1), 5809.171213641415);
    assert.equal(core.unitStepCost(10), 224084.45351690322);
    assert.equal(core.unitStepCost(50), 452010603.6140158);
  });
});

describe("cumulativeUnitCost", () => {
  test("golden value for (0,1) and additivity across a midpoint", () => {
    // golden: locks current formula
    const c01 = core.cumulativeUnitCost(0, 1);
    assert.equal(c01, 30565.020463327186);

    const c02 = core.cumulativeUnitCost(0, 2);
    const c12 = core.cumulativeUnitCost(1, 2);
    assert.ok(Math.abs(c02 - (c01 + c12)) < 1e-6, "cumulative(0,2) should equal cumulative(0,1) + cumulative(1,2)");
  });
});

describe("planTech", () => {
  test("synthetic state with no stats/clones -> battle null, shape locked", () => {
    const state = { quantum_cores: 100, player: { skills: {} } };
    const tech = core.planTech(state);

    assert.ok(tech.skills.length >= 15, "expected at least 15 tech skills");
    assert.equal(tech.battle, null);
    assert.deepEqual(tech.allocation, []);
    assert.equal(tech.leftoverCores, 100);

    // Steam-locked skills are flagged.
    const lockedKeys = tech.skills.filter(s => s.locked).map(s => s.key);
    assert.ok(lockedKeys.includes("base_module_efficiency_boost"));
    assert.ok(lockedKeys.includes("dungeon_battle_boost"));
    assert.ok(lockedKeys.includes("dungeon_gather_boost"));
    assert.ok(lockedKeys.includes("dungeon_craft_boost"));
    assert.ok(lockedKeys.includes("dungeon_explore_boost"));
    assert.ok(lockedKeys.includes("dungeon_reward_boost"));
  });
});

describe("planUnits", () => {
  test("synthetic state shape and cloneMultiplier-based totalMultiplier golden", () => {
    const state = {
      credits: 100000,
      droids: [
        { name: "droid1", efficiency: 10, storage: 5, maneuverability: 0 },
        { name: "droid2", efficiency: 10, storage: 5, maneuverability: 0 },
      ],
      player: {
        clones: [
          { name: "clone1", critical_chance: 20, critical_damage: 30, dual_shot: 5 },
          { name: "clone2", critical_chance: 20, critical_damage: 30, dual_shot: 5 },
        ],
      },
      prices: {},
    };
    const units = core.planUnits(state);

    // nextPrice handling: no prices supplied -> null, no break-even.
    assert.equal(units.droids.nextPrice, null);
    assert.equal(units.droids.breakEvenLevel, null);
    assert.equal(units.clones.nextPrice, null);
    assert.equal(units.clones.breakEvenLevel, null);

    // Row shape sanity.
    assert.equal(units.droids.rows.length, 3);
    assert.equal(units.clones.rows.length, 3);
    assert.deepEqual(units.droids.rows.map(r => r.skill), ["efficiency", "storage", "maneuverability"]);
    assert.deepEqual(units.clones.rows.map(r => r.skill), ["critical_chance", "critical_damage", "dual_shot"]);

    // cloneMultiplier formula golden:
    //   (1 + cc/100*(30+cd)/100) * (1+ds/100), summed over both clones.
    const cloneMultiplier = (cc, cd, ds) => (1 + (cc / 100) * ((30 + cd) / 100)) * (1 + ds / 100);
    const expectedTotal = 2 * cloneMultiplier(20, 30, 5);
    assert.equal(units.clones.damage.totalMultiplier, Math.round(expectedTotal * 1000) / 1000);
    assert.equal(units.clones.damage.totalMultiplier, 2.352);
  });
});
