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

    // nextPrice handling: no captured prices -> extrapolated from the
    // 10x-per-unit curve (3rd unit = 1e6), so break-even is computed.
    assert.equal(units.droids.nextPrice, 1e6);
    assert.equal(units.droids.priceSource, "extrapolated");
    assert.equal(units.clones.nextPrice, 1e6);
    assert.equal(units.clones.priceSource, "extrapolated");

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

describe("droid survival (lib/droids.js)", () => {
  const droids = require("../lib/droids.js");

  test("dodge = 50 base + maneuverability/2 + mods, capped at 100", () => {
    assert.equal(droids.droidDodge(0, 0), 50);
    assert.equal(droids.droidDodge(33, 10), 76.5);
    assert.equal(droids.droidDodge(100, 0), 100);
    assert.equal(droids.droidDodge(90, 10), 100); // 50 + 45 + 10 = 105 -> capped
  });

  test("maneuverability cap: the level past which more maneuverability cannot raise dodge", () => {
    assert.equal(droids.maneuverabilityCap(0), 100);
    assert.equal(droids.maneuverabilityCap(10), 80);
    assert.equal(droids.maneuverabilityCap(60), 0);
  });

  test("fleet survival summary", () => {
    const fleet = [
      { name: "d1", efficiency: 33, storage: 33, maneuverability: 33 },
      { name: "d2", efficiency: 33, storage: 33, maneuverability: 90 },
    ];
    const s = droids.droidSurvival(fleet, 10);
    assert.equal(s.modBonus, 10);
    assert.equal(s.count, 2);
    assert.equal(s.perDroid[0].dodge, 76.5);
    assert.deepEqual(s.perDroid[0].breakdown, { base: 50, maneuverability: 16.5, mods: 10 });
    assert.equal(s.perDroid[1].dodge, 100);
    assert.equal(s.perDroid[1].capped, true);
    assert.equal(s.expectedAlive, 1.765);
    assert.equal(s.maneuverabilityCap, 80);
    assert.equal(s.cappedCount, 1);
  });

  test("expected common yield and per-skill marginal: maneuverability worth 0 once dodge is capped", () => {
    const fleet = [{ name: "d1", efficiency: 33, storage: 33, maneuverability: 33 }];
    // yield = dodge/100 * (1 + (eff+sto)/100) = 0.765 * 1.66
    assert.ok(Math.abs(droids.expectedCommonYield(fleet, 10) - 0.765 * 1.66) < 1e-9);
    const m = droids.skillYieldMarginal(fleet, 10, 0.1); // relative gain (%) for +0.1% on every droid
    // maneuverability: +0.05 dodge on 76.5 -> +0.0654%; efficiency: +0.1 on 166 -> +0.0602%
    assert.ok(Math.abs(m.maneuverability - (0.05 / 76.5) * 100) < 1e-6);
    assert.ok(Math.abs(m.efficiency - (0.1 / 166) * 100) < 1e-6);
    assert.ok(Math.abs(m.storage - m.efficiency) < 1e-12);
    const capped = droids.skillYieldMarginal([{ efficiency: 0, storage: 0, maneuverability: 100 }], 0, 0.1);
    assert.equal(capped.maneuverability, 0);
  });
});

describe("planUnits droid survival integration", () => {
  test("survival block, per-skill yield-per-credit and best skill", () => {
    const state = {
      credits: 1e9,
      droids: [
        { name: "d1", efficiency: 33, storage: 33, maneuverability: 33 },
        { name: "d2", efficiency: 33, storage: 33, maneuverability: 33 },
      ],
      ship: {
        laser_slot: { bonuses: ["Rare Resource drop chance", "Droids dodge chance"] },  // dual -> 5
        probes_slot: { bonuses: ["Rare Resource drop chance", "Droids dodge chance"] }, // dual -> 5
      },
      gatherLast: { alive: 1, total: 2 },
      player: { clones: [] },
      prices: {},
    };
    const u = core.planUnits(state);
    assert.equal(u.droids.survival.modBonus, 10);
    assert.equal(u.droids.survival.avgDodge, 76.5);
    assert.equal(u.droids.survival.expectedAlive, 1.53);
    assert.deepEqual(u.droids.survival.lastAction, { alive: 1, total: 2 });
    const bySkill = Object.fromEntries(u.droids.rows.map(r => [r.skill, r]));
    assert.ok(byskillOk(bySkill));
    // maneuverability gives more yield per credit than efficiency at equal levels
    assert.ok(bySkill.maneuverability.marginalYield > bySkill.efficiency.marginalYield);
    assert.ok(bySkill.maneuverability.creditsPerPctYield < bySkill.efficiency.creditsPerPctYield);
    assert.equal(u.droids.bestSkill, "maneuverability");
    function byskillOk(b) { return ["efficiency", "storage", "maneuverability"].every(k => typeof b[k].marginalYield === "number" && typeof b[k].creditsPerPctYield === "number"); }
  });

  test("best skill flips to efficiency once maneuverability is at the cap", () => {
    const state = {
      credits: 1e9,
      droids: [{ name: "d1", efficiency: 33, storage: 33, maneuverability: 100 }],
      ship: {}, player: { clones: [] }, prices: {},
    };
    const u = core.planUnits(state);
    const bySkill = Object.fromEntries(u.droids.rows.map(r => [r.skill, r]));
    assert.equal(bySkill.maneuverability.marginalYield, 0);
    assert.equal(bySkill.maneuverability.creditsPerPctYield, null);
    assert.equal(u.droids.bestSkill, "efficiency");
  });
});

describe("dodge mod removal schedule", () => {
  const droids = require("../lib/droids.js");

  test("two dual mods (5 + 5): first removable at maneuverability 90, second at 100", () => {
    const plan = droids.dodgeModPlan(33, [{ slot: "laser_slot", value: 5 }, { slot: "probes_slot", value: 5 }]);
    assert.deepEqual(plan.map(p => [p.slot, p.removableAt, p.removableNow]), [
      ["laser_slot", 90, false],
      ["probes_slot", 100, false],
    ]);
  });

  test("at maneuverability 90 only ONE of two dual mods is removable now", () => {
    const plan = droids.dodgeModPlan(90, [{ slot: "laser_slot", value: 5 }, { slot: "probes_slot", value: 5 }]);
    assert.deepEqual(plan.map(p => p.removableNow), [true, false]);
  });

  test("single +10 mod removable at 100; larger mods are scheduled first", () => {
    const plan = droids.dodgeModPlan(0, [{ slot: "probes_slot", value: 5 }, { slot: "laser_slot", value: 10 }]);
    assert.deepEqual(plan.map(p => [p.slot, p.removableAt]), [["laser_slot", 90], ["probes_slot", 100]]);
  });

  test("planUnits exposes the schedule and the no-mods target", () => {
    const state = {
      credits: 1, droids: [{ name: "d1", efficiency: 0, storage: 0, maneuverability: 33 }],
      ship: {
        laser_slot: { bonuses: ["Rare Resource drop chance", "Droids dodge chance"] },
        probes_slot: { bonuses: ["Rare Resource drop chance", "Droids dodge chance"] },
      },
      player: { clones: [] }, prices: {},
    };
    const u = core.planUnits(state);
    assert.equal(u.droids.survival.noModsCap, 100);
    assert.deepEqual(u.droids.survival.modPlan.map(p => [p.slot, p.value, p.removableAt]), [
      ["laser_slot", 5, 90], ["probes_slot", 5, 100],
    ]);
  });
});

describe("unit purchase price extrapolation (10x per unit, 8th = 100B)", () => {
  test("unitPrice(n) = 10^(n+3)", () => {
    assert.equal(core.unitPrice(1), 1e4);
    assert.equal(core.unitPrice(7), 1e10);
    assert.equal(core.unitPrice(8), 1e11);
    assert.equal(core.unitPrice(9), 1e12);
  });

  test("planUnits falls back to the curve when the trainer page was never opened, captured price wins otherwise", () => {
    const seven = n => Array.from({ length: n }, (_, i) => ({ name: "u" + i, efficiency: 0, storage: 0, maneuverability: 0,
      critical_chance: 0, critical_damage: 0, dual_shot: 0 }));
    const state = { credits: 1, droids: seven(7), player: { clones: seven(7) }, ship: {}, prices: { clone: 123 } };
    const u = core.planUnits(state);
    assert.equal(u.droids.nextPrice, 1e11);
    assert.equal(u.droids.priceSource, "extrapolated");
    assert.equal(u.clones.nextPrice, 123);
    assert.equal(u.clones.priceSource, "captured");
  });
});
