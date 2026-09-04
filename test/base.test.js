// Behaviour locks for the base planner (public/base-math.js + lib/base.js).
// Formulas are the client's (bundle index-BiPcVSdi.js, patch 1.1.1).
"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const BM = require("../public/base-math.js");
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, (msg || "") + ` expected ${b} got ${a}`);

describe("BaseMath tables", () => {
  test("11 modules in order, each with needs/materials/type", () => {
    assert.equal(BM.MODULES.length, 11);
    assert.equal(BM.MODULES[0].name, "Stellarium miner");
    assert.deepEqual(BM.MODULES[0].materials, ["microcircuits", "fusion cells"]);
    assert.equal(BM.MODULES[4].name, "Quantum server");
    assert.equal(BM.MODULES[4].halfLevel, true);
    assert.deepEqual(BM.MODULES[7].needs, ["Quantum server", "Craftron 3000", "Fuel facility"]);
    assert.equal(BM.MODULES.filter(m => m.type === "active").length, 2);
    assert.equal(BM.MATERIAL_BUILDINGS.aerolite.building, "Aeroforge");
    assert.equal(BM.MATERIAL_BUILDINGS.aerolite.baseTier, true);
    assert.equal(BM.MATERIAL_BUILDINGS.microcircuits.baseTier, false);
    assert.equal(BM.STAR_BONUSES["Black Hole"].rate, 8);
    assert.equal(BM.STAR_BONUSES["A type"].rate, 6);
    assert.equal(BM.STAR_BONUSES["M type"].rate, 5);
    assert.equal(BM.BODY_BONUSES["Comet"], "exploring");
    assert.equal(BM.PROVENANCE.client, "1.1.1");
  });
});

describe("BaseMath level cost curve (f(L) per material)", () => {
  test("small levels: one level L costs L, cumulative L(L+1)/2", () => {
    assert.equal(BM.levelCost(1), 1);
    assert.equal(BM.levelCost(50), 50);
    assert.equal(BM.levelCostCumulative(50), 1275);
    assert.equal(BM.levelsCost(0, 50), 1275);
    assert.equal(BM.levelsCost(20, 21), 21);
    assert.equal(BM.levelCostCumulative(600), 180300);
  });
  test("multiplier boundaries are inclusive at 600/1000/1500/1750/2000", () => {
    assert.equal(BM.levelCost(600), 600);
    assert.equal(BM.levelCost(601), 1202);
    assert.equal(BM.levelCost(1000), 2000);
    assert.equal(BM.levelCost(1001), 4004);
    assert.equal(BM.levelCost(1500), 6000);
    assert.equal(BM.levelCost(1501), 12008);
    assert.equal(BM.levelCost(1750), 14000);
    assert.equal(BM.levelCost(1751), 28016);
    assert.equal(BM.levelCost(2000), 32000);
    assert.equal(BM.levelCost(2001), 128064);
  });
  test("degenerate inputs", () => {
    assert.equal(BM.levelCostCumulative(0), 0);
    assert.equal(BM.levelsCost(50, 50), 0);
    assert.equal(BM.levelsCost(60, 50), 0);
  });
});

describe("BaseMath stellarium curve", () => {
  test("steps and unlock costs", () => {
    assert.equal(BM.stellariumStep(1), 1);
    assert.equal(BM.stellariumStep(99), 99);
    assert.equal(BM.stellariumStep(100), 200);
    assert.equal(BM.stellariumStep(149), 298);
    assert.equal(BM.stellariumStep(150), 600);
    assert.equal(BM.unlockCost(0), 0);
    assert.equal(BM.unlockCost(1), 1);
    assert.equal(BM.unlockCost(3), 6);
    assert.equal(BM.unlockCost(10), 55);
    let total = 0;
    for (let n = 1; n <= 10; n++) total += BM.unlockCost(n);
    assert.equal(total, 220, "modules 2..11");
  });
  test("tier costs use the same step curve", () => {
    assert.equal(BM.tierCost(0), 1);
    assert.equal(BM.tierCost(2), 3);
    assert.equal(BM.tiersCost(0, 3), 6);
    assert.equal(BM.tiersCost(99, 100), 200);
  });
});

describe("BaseMath boost, output, upkeep, income", () => {
  const mod = (name, level, tier) => ({ ...BM.MODULES.find(m => m.name === name), level, tier });
  test("boost and expected output", () => {
    near(BM.moduleBoost(mod("Quantum server", 200, 10), 0), 110);
    near(BM.moduleBoost(mod("Resource miner", 250, 0), 0), 250);
    near(BM.moduleBoost(mod("Resource miner", 100, 50), 20), 180);
    near(BM.expectedOutputPerTick(mod("Resource miner", 250, 0), 0), 70000);
    near(BM.expectedOutputPerTick(mod("Stellarium miner", 20, 2), 0), 1.204);
  });
  test("unlock order respects needs", () => {
    const order = BM.unlockOrder();
    assert.equal(order.length, 11);
    const idx = n => order.indexOf(n);
    assert.equal(idx("Stellarium miner"), 0);
    assert.ok(idx("Research lab") > idx("Quantum server"));
    assert.ok(idx("Research lab") > idx("Craftron 3000"));
    assert.ok(idx("Research lab") > idx("Fuel facility"));
    assert.ok(idx("Battling Trainer (PvP)") > idx("Laboratory enhancer"));
    assert.ok(idx("Battling Trainer (PvP)") > idx("Item booster"));
  });
  test("average daily income guards days < 1 and uses lifetime credits", () => {
    assert.equal(BM.avgDailyIncome(5.4e9, 1786174949, 1786174949 + 27 * 86400), 200000000);
    assert.equal(BM.avgDailyIncome(1000, 100, 100), 1000);
    assert.equal(BM.avgDailyIncome(0, 0, 0), 0);
  });
  test("upkeep per tick copies the client's divisor chain", () => {
    assert.equal(BM.upkeepPerTick(200e6, 1, 0, 0, 0), 231481);
    assert.equal(BM.upkeepPerTick(200e6, 2, 0, 0, 0), 115740);
    near(BM.upkeepPerTick(200e6, 1, 100, 0, 0), 462962);
    near(BM.upkeepPerTick(200e6, 1, 0, 0, 50), 115740.5);
    assert.equal(BM.upkeepPerTick(200e6, 0, 0, 0, 0), 0);
    near(BM.questsCoverage(5), 0.75);
    near(BM.questsCoverage(9), 0.75);
    near(BM.questsCoverage(0), 0);
  });
  test("stellarium per day is an estimate: rate x (1+boost) x 24/5", () => {
    near(BM.stellariumPerDay(6, 0), 28.8);
    near(BM.stellariumPerDay(8, 50), 57.6);
    assert.equal(BM.ESTIMATES.STELLARIUM_TICK_HOURS, 5);
  });
});
