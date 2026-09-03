// Behavior locks for planInstalls (the greedy catalyst install/replace
// planner) in advisor-core.js. No opts.validateDefault is passed in any of
// these fixtures, so the battle simulator is never invoked here — purely
// the greedy stat-value logic. Goldens were produced by running the CURRENT
// implementation against synthetic ships/pools and hardcoding the result.
"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../advisor-core.js");

function cat(id, stat, rarity, range, opts) {
  return Object.assign({ _id: id, stat, rarity, range }, opts || {});
}

describe("planInstalls", () => {
  test("fills up to 4 per group, caps same-stat at 2, halves the 2nd same-stat, and respects stat caps", () => {
    const ship = {
      laser_slot: { name: "Test Laser", level: 1, rarity: "normal", catalysts: [] },
      weapon_slot: { name: "Test Weapon", level: 1, rarity: "normal", catalysts: [] },
    };
    // 3 identical gathering_yield candidates (boost category, laser_slot):
    // only 2 should ever be used (MAX_SAME_STAT=2).
    // 2 identical defense candidates (battling category, weapon_slot,
    // cap=50): each legendary/range-100 is worth 40, so the 2nd's gain must
    // be capped down to the remaining headroom (50-40=10).
    const pool = [
      cat("gy1", "gathering_yield", "legendary", 100),
      cat("gy2", "gathering_yield", "legendary", 100),
      cat("gy3", "gathering_yield", "legendary", 100),
      cat("def1", "defense", "legendary", 100),
      cat("def2", "defense", "legendary", 100),
    ];

    const res = core.planInstalls(ship, pool, {});

    // golden: locks current greedy pick order and gain values
    assert.deepEqual(
      res.actions.map(a => ({ id: a.add._id, gain: a.gain, sameCount: a.sameCount })),
      [
        { id: "def1", gain: 40, sameCount: 1 },
        { id: "gy1", gain: 40, sameCount: 1 },
        { id: "gy2", gain: 20, sameCount: 2 },
        { id: "def2", gain: 10, sameCount: 2 },
      ]
    );

    // never more than 2 same-stat per group: the 3rd gathering_yield
    // candidate is never used.
    assert.ok(!res.used.has("gy3"));

    // stat cap respected: total defense gain (40 + 10) never exceeds the
    // cap (50) minus whatever was already installed (0 here).
    const defenseGain = res.actions.filter(a => a.add.stat === "defense").reduce((s, a) => s + a.gain, 0);
    assert.equal(defenseGain, core.STAT_CAPS.defense);
  });

  test("gains below MIN_WORTHWHILE_GAIN are skipped for the default tab", () => {
    // Existing default group (shield_slot, battling) is full (4/4): a
    // halved defense catalyst (range 87) sits alongside an unhalved
    // defense catalyst (range 99) and two unrelated stats. A fresh
    // candidate (range 88) would replace the halved one, but because the
    // sibling stat is still present the candidate is halved too, making
    // the raw gain only 0.05 - below MIN_WORTHWHILE_GAIN (0.1).
    const ship = {
      shield_slot: {
        name: "Test Shield", level: 1, rarity: "normal",
        catalysts: [
          cat("d0", "defense", "normal", 99, { halved: false }),
          cat("d1", "defense", "normal", 87, { halved: true }),
          cat("p0", "precision", "normal", 50, { halved: false }),
          cat("e0", "evasion", "normal", 50, { halved: false }),
        ],
      },
    };
    const pool = [cat("d2", "defense", "normal", 88)];
    const res = core.planInstalls(ship, pool, {});

    const defaultActions = res.actions.filter(a => a.activity === "default");
    assert.equal(defaultActions.length, 0, "the tiny-gain replace must not be suggested for the default tab");
  });

  test("does NOT suggest a weak first specialized catalyst when the inherited default group is stronger in relevant stats", () => {
    // Weapon's default group is FULL (4/4) with strong battling stats -
    // getEquippedOn(weapon, 'galaxyboss') currently falls through to this
    // default group (galaxyboss group is empty). Overriding it with a weak
    // first galaxyboss catalyst would REPLACE all 140 worth of relevant
    // battling value with a single 0.5-value precision catalyst - a huge
    // net loss that must never be suggested.
    const ship = {
      weapon_slot: {
        name: "Test Weapon", level: 1, rarity: "legendary",
        catalysts: [
          cat("d1", "defense", "legendary", 100, { activity: "default" }),            // 40
          cat("d2", "defense", "legendary", 100, { activity: "default", halved: true }), // 20
          cat("ap1", "armor_penetration", "legendary", 100, { activity: "default" }), // 40
          cat("st1", "stun", "legendary", 100, { activity: "default" }),              // 40
        ],
      },
    };
    const pool = [cat("weak-precision", "precision", "normal", 10)]; // raw value 0.5
    const res = core.planInstalls(ship, pool, {});
    assert.equal(res.actions.length, 0, "no action should touch the full default group or the empty galaxyboss/dungeons groups");
  });

  test("DOES suggest a first specialized catalyst when the default group holds only stats irrelevant to that activity", () => {
    // Laser's default group holds gathering_yield, which does NOTHING
    // during exploring (ACTIVITY_RELEVANT_STATS.exploring is exploring_xp /
    // cosmic_dust_bonus only) - overriding the (empty) exploring group costs
    // nothing in relevant value, so even a weak exploring_xp catalyst is a
    // pure win and must be suggested. A second candidate for a different
    // stat then lands in the now-non-empty group with plain additive gain
    // (no further inherited-replacement penalty).
    const ship = {
      laser_slot: {
        name: "Test Laser", level: 1, rarity: "normal",
        catalysts: [cat("gy1", "gathering_yield", "legendary", 100, { activity: "default" })],
      },
    };
    const pool = [
      cat("ex1", "exploring_xp", "normal", 10),      // raw value 1.0
      cat("cd1", "cosmic_dust_bonus", "normal", 10), // raw value 1.0
    ];
    const res = core.planInstalls(ship, pool, {});
    const exploring = res.actions.filter(a => a.activity === "exploring");
    assert.equal(exploring.length, 2, "both exploring candidates should be installed");
    assert.ok(exploring.every(a => Math.abs(a.gain - 1.0) < 0.001), "no inherited-replacement penalty once the group already has a catalyst");
  });
});

describe("statTotalsByContext (chain semantics)", () => {
  test("item with default + galaxyboss groups: galaxyboss context uses ONLY the galaxyboss group for that item", () => {
    const ship = {
      weapon_slot: {
        name: "Test Weapon", level: 1, rarity: "legendary",
        catalysts: [
          cat("d1", "defense", "legendary", 100, { activity: "default" }),      // 40
          cat("p1", "precision", "legendary", 100, { activity: "galaxyboss" }), // 20
        ],
      },
    };
    const totals = core.statTotalsByContext(ship);
    assert.equal(totals.default.defense, 40);
    assert.equal(totals.default.precision, undefined);
    // galaxyboss group is non-empty -> it REPLACES default, so defense must
    // NOT leak in from the default group.
    assert.equal(totals.galaxyboss.precision, 20);
    assert.equal(totals.galaxyboss.defense, undefined);
  });

  test("item with only a default group: the default group is inherited everywhere", () => {
    const ship = {
      weapon_slot: {
        name: "Test Weapon", level: 1, rarity: "legendary",
        catalysts: [cat("d1", "defense", "legendary", 100, { activity: "default" })], // 40
      },
    };
    const totals = core.statTotalsByContext(ship);
    assert.equal(totals.default.defense, 40);
    assert.equal(totals.galaxyboss.defense, 40);
    assert.equal(totals.dungeons.defense, 40);
  });

  test("voyager inherits exploring before default (chain = [voyager, exploring, default])", () => {
    const ship = {
      engine_slot: {
        name: "Test Engine", level: 1, rarity: "rare",
        catalysts: [
          cat("f1", "fuel_efficiency", "legendary", 100, { activity: "default" }),   // 20
          cat("f2", "fuel_efficiency", "rare", 50, { activity: "exploring" }),       // 5
        ],
      },
    };
    const totals = core.statTotalsByContext(ship);
    assert.equal(totals.default.fuel_efficiency, 20);
    assert.equal(totals.exploring.fuel_efficiency, 5);
    // voyager's own group is empty -> falls to exploring (NOT default).
    assert.equal(totals.voyager.fuel_efficiency, 5);
  });
});
