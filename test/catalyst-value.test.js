// Behavior locks for the catalyst-value formulas in advisor-core.js, ported
// from the game's JS bundle. Goldens were produced by running the CURRENT
// implementation and hardcoding its output.
"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../advisor-core.js");

describe("catalystValue", () => {
  test("golden values across stat/rarity/range combos", () => {
    // golden: locks current formula (STAT_BASES[stat] * RARITY_MULT[rarity] * range/100)
    assert.equal(core.catalystValue({ stat: "defense", rarity: "normal", range: 100, halved: false }), 10);
    assert.equal(core.catalystValue({ stat: "defense", rarity: "legendary", range: 100, halved: false }), 40);
    assert.equal(core.catalystValue({ stat: "gathering_yield", rarity: "rare", range: 80, halved: false }), 16);
    assert.equal(core.catalystValue({ stat: "voyager_jumps_bonus", rarity: "epic", range: 100, halved: false }), 6);
    assert.equal(core.catalystValue({ stat: "lifesteal", rarity: "unique", range: 50, halved: false }), 3.75);
  });

  test("halved is exactly half of the unhalved value, across rarities", () => {
    const combos = [
      { stat: "defense", rarity: "normal", range: 100 },
      { stat: "defense", rarity: "uncommon", range: 100 },
      { stat: "defense", rarity: "rare", range: 100 },
      { stat: "defense", rarity: "unique", range: 100 },
      { stat: "defense", rarity: "epic", range: 100 },
      { stat: "defense", rarity: "legendary", range: 100 },
    ];
    for (const c of combos) {
      const full = core.catalystValue({ ...c, halved: false });
      const half = core.catalystValue({ ...c, halved: true });
      assert.equal(half, full / 2, `halved value for ${c.rarity} should be exactly half of ${full}`);
    }
  });
});

describe("fmtVal", () => {
  test("percent stat formats with 2 decimals and a % sign", () => {
    // golden: locks current formula
    assert.equal(core.fmtVal("defense", 12.3456), "12.35%");
  });

  test("flat integer stat (voyager_jumps_bonus) floors and has no % sign", () => {
    // golden: locks current formula
    assert.equal(core.fmtVal("voyager_jumps_bonus", 7.9), "7");
  });
});

describe("mergeRangeBonus", () => {
  test("golden values at craft levels 1, 9, 10, 56, 100", () => {
    // golden: locks current formula (5 + floor(craftLevel/10))
    assert.equal(core.mergeRangeBonus(1), 5);
    assert.equal(core.mergeRangeBonus(9), 5);
    assert.equal(core.mergeRangeBonus(10), 6);
    assert.equal(core.mergeRangeBonus(56), 10);
    assert.equal(core.mergeRangeBonus(100), 15);
  });
});

describe("mergeSuccessChance", () => {
  test("golden values per rarity at craft level 0 and 56", () => {
    // golden: locks current formula
    assert.equal(core.mergeSuccessChance("normal", 0), 100);
    assert.equal(core.mergeSuccessChance("uncommon", 0), 75);
    assert.equal(core.mergeSuccessChance("rare", 0), 60);
    assert.equal(core.mergeSuccessChance("unique", 0), 45);
    assert.equal(core.mergeSuccessChance("epic", 0), 30);
    assert.equal(core.mergeSuccessChance("legendary", 0), 20);

    assert.equal(core.mergeSuccessChance("normal", 56), 100); // capped at 100
    assert.equal(core.mergeSuccessChance("uncommon", 56), 80.6);
    assert.equal(core.mergeSuccessChance("rare", 56), 65.6);
    assert.equal(core.mergeSuccessChance("unique", 56), 50.6);
    assert.equal(core.mergeSuccessChance("epic", 56), 35.6);
    assert.equal(core.mergeSuccessChance("legendary", 56), 25.6);
  });

  test("never exceeds 100 regardless of craft level", () => {
    for (const r of core.RARITIES) {
      assert.ok(core.mergeSuccessChance(r, 10000) <= 100);
    }
  });
});

describe("nextRarity", () => {
  test("chain from normal through legendary, legendary maps to itself", () => {
    // golden: locks current chain order
    assert.equal(core.nextRarity("normal"), "uncommon");
    assert.equal(core.nextRarity("uncommon"), "rare");
    assert.equal(core.nextRarity("rare"), "unique");
    assert.equal(core.nextRarity("unique"), "epic");
    assert.equal(core.nextRarity("epic"), "legendary");
    assert.equal(core.nextRarity("legendary"), "legendary");
  });
});

describe("statCategory", () => {
  test("returns the correct category for one stat of each category", () => {
    assert.equal(core.statCategory("defense"), "battling");
    assert.equal(core.statCategory("battling_xp"), "boost");
    assert.equal(core.statCategory("fuel_efficiency"), "utility");
  });

  test("returns null for an unknown stat", () => {
    assert.equal(core.statCategory("totally_unknown_stat"), null);
  });
});
