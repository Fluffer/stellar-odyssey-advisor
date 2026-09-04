// Behaviour locks for the lab bottleneck planner (public/lab-math.js +
// lib/lab.js). The fixture is the live 10-building chain at level 20.
"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const LabMath = require("../public/lab-math.js");

// Live chain shape (LaboratoryStore.buildings), all level 20.
function liveBuildings() {
  const b = (building, currency_use, material_use, produce, input, timer) =>
    ({ building, level: 20, currency_use, material_use, produce, input, output: 1, timer });
  return [
    b("Foundry", ["gold", "silver", "copper", "platinum"], [], ["ingots"], 10000, 45),
    b("Refinery", ["diamond", "ruby", "emerald", "sapphire"], [], ["refined_crystals"], 10000, 45),
    b("Crystal Synthesis Lab", ["water", "nitrogen", "sulfur", "carbon"], [], ["high_end_crystals"], 10000, 45),
    b("Noble Gas Processing Station", ["helium", "methane"], [], ["propulsors"], 10000, 45),
    b("Nanotech Complex", ["ammonia", "hydrogen"], [], ["nanoconductors"], 10000, 45),
    b("Circuit Integration Facility", ["silicon", "cobalt"], [], ["microcircuits"], 1000, 30),
    b("Energetic Fusion Center", ["argon", "dark matter"], [], ["fusion cells"], 1000, 30),
    b("Module Assembly Plant", [], ["ingots", "refined crystals", "microcircuits"], ["fuel cell casing"], 20, 30),
    b("Fuel Lab", [], ["high end crystals", "propulsors", "nanoconductors", "fusion cells"], ["unstable fuel"], 20, 30),
    b("Space Capsule Complex", [], ["unstable fuel", "fuel cell casing"], ["warp capsule"], 10, 30),
  ];
}
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, (msg || "") + ` expected ${b} got ${a}`);

describe("LabMath.normName / buildChain", () => {
  test("normalises underscores, case and whitespace", () => {
    assert.equal(LabMath.normName("Refined_Crystals "), "refined crystals");
    assert.equal(LabMath.normName("dark matter"), "dark matter");
  });

  test("builds the product index with normalised input names and kinds", () => {
    const chain = LabMath.buildChain(liveBuildings());
    assert.equal(chain.list.length, 10);
    const plant = chain.byProduct["fuel cell casing"];
    assert.equal(plant.name, "Module Assembly Plant");
    assert.deepEqual(plant.inputs, [
      { name: "ingots", kind: "material" },
      { name: "refined crystals", kind: "material" },
      { name: "microcircuits", kind: "material" },
    ]);
    assert.equal(chain.byProduct["refined crystals"].name, "Refinery");
    assert.deepEqual(chain.byProduct["fusion cells"].inputs, [
      { name: "argon", kind: "currency" }, { name: "dark matter", kind: "currency" },
    ]);
  });

  test("duplicate products: keeps the first building, ignores later ones", () => {
    const buildings = [
      { building: "Foundry A", level: 20, currency_use: ["gold"], material_use: [], produce: ["ingots"], input: 10000, output: 1, timer: 45 },
      { building: "Foundry B", level: 20, currency_use: ["silver"], material_use: [], produce: ["ingots"], input: 5000, output: 1, timer: 30 },
    ];
    const chain = LabMath.buildChain(buildings);
    assert.equal(chain.list.length, 2);
    assert.equal(chain.byProduct["ingots"].name, "Foundry A");
  });
});

describe("LabMath.expand", () => {
  test("10 capsules from empty stocks: full chain requirement", () => {
    const chain = LabMath.buildChain(liveBuildings());
    const r = LabMath.expand(chain, [{ product: "warp capsule", units: 10 }], {});
    assert.equal(r.runs["Space Capsule Complex"], 10);
    assert.equal(r.runs["Module Assembly Plant"], 100);
    assert.equal(r.runs["Fuel Lab"], 100);
    for (const name of ["Foundry", "Refinery", "Crystal Synthesis Lab", "Noble Gas Processing Station",
      "Nanotech Complex", "Circuit Integration Facility", "Energetic Fusion Center"]) {
      assert.equal(r.runs[name], 2000, name);
    }
    assert.equal(r.gross["ingots"], 2000);
    assert.equal(r.gross["unstable fuel"], 100);
    for (const c of ["gold", "silver", "copper", "platinum", "diamond", "ruby", "emerald", "sapphire",
      "water", "nitrogen", "sulfur", "carbon", "helium", "methane", "ammonia", "hydrogen"]) {
      assert.equal(r.raw[c], 20000000, c);
    }
    for (const c of ["silicon", "cobalt", "argon", "dark matter"]) assert.equal(r.raw[c], 2000000, c);
  });

  test("stock netting: 5000 ingots in stock -> Foundry runs 0, gross unchanged", () => {
    const chain = LabMath.buildChain(liveBuildings());
    const r = LabMath.expand(chain, [{ product: "warp capsule", units: 10 }], { ingots: 5000 });
    assert.equal(r.runs["Foundry"], 0);
    assert.equal(r.gross["ingots"], 2000);
    assert.equal(r.raw["gold"], undefined);
    assert.equal(r.runs["Refinery"], 2000);
  });

  test("partial stock: 500 casings in stock -> plant runs 50", () => {
    const chain = LabMath.buildChain(liveBuildings());
    const r = LabMath.expand(chain, [{ product: "warp capsule", units: 100 }], { "fuel cell casing": 500 });
    assert.equal(r.runs["Module Assembly Plant"], 500);
    assert.equal(r.runs["Foundry"], 10000);
  });

  test("a demand for a raw currency or an unknown product lands in raw", () => {
    const chain = LabMath.buildChain(liveBuildings());
    const r = LabMath.expand(chain, [{ product: "gold", units: 5 }, { product: "unobtainium", units: 1 }], {});
    assert.equal(r.raw["gold"], 5);
    assert.equal(r.raw["unobtainium"], 1);
    assert.deepEqual(r.runs, {});
  });

  test("stageOf: raw 0, intermediates 1, casing/fuel 2, capsule 3", () => {
    const chain = LabMath.buildChain(liveBuildings());
    assert.equal(LabMath.stageOf(chain, "gold"), 0);
    assert.equal(LabMath.stageOf(chain, "ingots"), 1);
    assert.equal(LabMath.stageOf(chain, "fuel cell casing"), 2);
    assert.equal(LabMath.stageOf(chain, "warp capsule"), 3);
  });
});

describe("LabMath timing", () => {
  test("timerAt: 0.1 s per level down to the 5 s floor", () => {
    near(LabMath.timerAt(45, 20), 43);
    near(LabMath.timerAt(30, 20), 28);
    assert.equal(LabMath.timerAt(45, 500), 5);
  });

  test("levelCost / levelsToFloor / costToFloor", () => {
    assert.equal(LabMath.levelCost(1), 1150000);
    assert.equal(LabMath.levelCost(21), 24150000);
    assert.equal(LabMath.levelsToFloor(45, 20), 380);
    assert.equal(LabMath.levelsToFloor(45, 400), 0);
    // sum_{k=21}^{22} 1.15M*k = 1.15M*43
    assert.equal(LabMath.costToFloor(20, 2), 1150000 * 43);
  });

  test("planCore for 10 capsules from empty stocks, 10 free slots", () => {
    const chain = LabMath.buildChain(liveBuildings());
    const core = LabMath.planCore(chain, [{ product: "warp capsule", units: 10 }], {}, { freeSlots: 10 });
    const by = Object.fromEntries(core.buildings.map(b => [b.name, b]));
    assert.equal(by["Foundry"].stage, 1);
    assert.equal(by["Module Assembly Plant"].stage, 2);
    assert.equal(by["Space Capsule Complex"].stage, 3);
    near(by["Foundry"].timerNow, 43);
    near(by["Foundry"].seconds, 2000 * 43);
    near(by["Foundry"].hours, 2000 * 43 / 3600);
    near(by["Circuit Integration Facility"].hours, 2000 * 28 / 3600);
    near(by["Module Assembly Plant"].hours, 100 * 28 / 3600);
    near(by["Space Capsule Complex"].hours, 10 * 28 / 3600);
    assert.equal(core.critical, "Foundry");
    // sequential: stage maxes 23.888 + 0.777 + 0.0777
    near(core.hoursSequential, (2000 * 43 + 100 * 28 + 10 * 28) / 3600);
    // pipelined: critical + 10 min per downstream stage (2 stages)
    near(core.hoursPipelined, 2000 * 43 / 3600 + 2 * 10 / 60);
    // inputs of the Foundry row
    const gold = by["Foundry"].inputs.find(i => i.name === "gold");
    assert.deepEqual(gold, { name: "gold", kind: "currency", perUnit: 10000, needed: 20000000, stock: 0, short: 20000000, coverage: 0 });
    assert.equal(core.ready, false);
    assert.equal(core.binding.coverage, 0);
  });

  test("raw coverage, binding and unitsSupported", () => {
    const chain = LabMath.buildChain(liveBuildings());
    const stocks = { gold: 40e6, silver: 40e6, copper: 40e6, platinum: 5e6,
      diamond: 40e6, ruby: 40e6, emerald: 40e6, sapphire: 40e6,
      water: 40e6, nitrogen: 40e6, sulfur: 40e6, carbon: 40e6,
      helium: 40e6, methane: 40e6, ammonia: 40e6, hydrogen: 40e6,
      silicon: 4e6, cobalt: 4e6, argon: 4e6, "dark matter": 4e6 };
    const core = LabMath.planCore(chain, [{ product: "warp capsule", units: 10 }], stocks, { freeSlots: 10 });
    const plat = core.raw.find(r => r.name === "platinum");
    near(plat.coverage, 0.25);
    assert.equal(plat.unitsSupported, 2);
    assert.equal(core.binding.name, "platinum");
    const gold = core.raw.find(r => r.name === "gold");
    near(gold.coverage, 2);
    assert.equal(gold.unitsSupported, 20);
  });

  test("binding is the LOWEST coverage when several raw inputs are short", () => {
    const chain = LabMath.buildChain(liveBuildings());
    const stocks = { gold: 40e6, silver: 40e6, copper: 40e6, platinum: 5e6,
      diamond: 40e6, ruby: 40e6, emerald: 40e6, sapphire: 40e6,
      water: 40e6, nitrogen: 2e6, sulfur: 40e6, carbon: 40e6,
      helium: 40e6, methane: 40e6, ammonia: 40e6, hydrogen: 40e6,
      silicon: 4e6, cobalt: 4e6, argon: 4e6, "dark matter": 4e6 };
    const core = LabMath.planCore(chain, [{ product: "warp capsule", units: 10 }], stocks, { freeSlots: 10 });
    assert.equal(core.binding.name, "nitrogen");
    assert.equal(core.raw[0].name, "nitrogen");
    assert.equal(core.raw[1].name, "platinum");
  });

  test("ready when every raw input is covered; coverage is 1 when nothing is needed", () => {
    const chain = LabMath.buildChain(liveBuildings());
    const stocks = { "unstable fuel": 100, "fuel cell casing": 100 };
    const core = LabMath.planCore(chain, [{ product: "warp capsule", units: 10 }], stocks, { freeSlots: 10 });
    assert.equal(core.ready, true);
    assert.equal(core.binding, null);
    assert.equal(core.raw.length, 0);
    const foundry = core.buildings.find(b => b.name === "Foundry");
    assert.equal(foundry.unitsToRun, 0);
    assert.equal(foundry.hours, 0);
    near(core.hoursPipelined, 10 * 28 / 3600);
  });

  test("stage waves when a stage has more buildings than free slots", () => {
    const chain = LabMath.buildChain(liveBuildings());
    const core = LabMath.planCore(chain, [{ product: "warp capsule", units: 10 }], {}, { freeSlots: 4 });
    // stage 1 has 7 buildings on 4 slots -> 2 waves of the longest (Foundry 23.89 h)
    near(core.hoursSequential, (2 * 2000 * 43 + 100 * 28 + 10 * 28) / 3600);
  });

  test("levelOverrides and speed change only the named building", () => {
    const chain = LabMath.buildChain(liveBuildings());
    const up = LabMath.planCore(chain, [{ product: "warp capsule", units: 10 }], {}, { freeSlots: 10, levelOverrides: { Foundry: 21 } });
    near(up.buildings.find(b => b.name === "Foundry").timerNow, 42.9);
    const fast = LabMath.planCore(chain, [{ product: "warp capsule", units: 10 }], {}, { freeSlots: 10, speed: { building: "Foundry", x: 2 } });
    near(fast.buildings.find(b => b.name === "Foundry").hours, 2000 * 43 / 2 / 3600);
    const gold = fast.buildings.find(b => b.name === "Foundry").inputs.find(i => i.name === "gold");
    near(gold.needed, 20000000 * 2.6);
    near(fast.raw.find(r => r.name === "gold").needed, 20000000 * 2.6);
    // an untouched building keeps its numbers
    near(fast.buildings.find(b => b.name === "Refinery").hours, 2000 * 43 / 3600);
  });

  test("degraded: empty chain -> empty core, no throw", () => {
    const chain = LabMath.buildChain([]);
    const core = LabMath.planCore(chain, [{ product: "warp capsule", units: 10 }], {}, { freeSlots: 10 });
    assert.deepEqual(core.buildings, []);
    assert.equal(core.ready, false);
    assert.equal(core.hoursPipelined, 0);
    assert.equal(core.critical, null);
  });
});

describe("LabMath.planTarget: ROI and speed", () => {
  const chain = () => LabMath.buildChain(liveBuildings());
  const demands = [{ product: "warp capsule", units: 10 }];

  test("ROI: critical Foundry first, cost 1.15M*21, hours saved = 200 s", () => {
    const plan = LabMath.planTarget(chain(), demands, {}, { freeSlots: 10 });
    assert.equal(plan.upgradeRoi[0].name, "Foundry");
    assert.equal(plan.upgradeRoi[0].level, 20);
    assert.equal(plan.upgradeRoi[0].nextLevelCost, 1150000 * 21);
    near(plan.upgradeRoi[0].hoursSaved, 200 / 3600);
    near(plan.upgradeRoi[0].creditsPerHourSaved, 1150000 * 21 / (200 / 3600));
    assert.equal(plan.upgradeRoi[0].levelsToFloor, 380);
    assert.equal(plan.upgradeRoi[0].costToFloor, LabMath.costToFloor(20, 380));
    // a non-critical building saves nothing on the pipelined estimate
    const circuit = plan.upgradeRoi.find(r => r.name === "Circuit Integration Facility");
    assert.equal(circuit.hoursSaved, 0);
    assert.equal(circuit.creditsPerHourSaved, null);
  });

  test("ROI: buildings with nothing to run have no row", () => {
    const plan = LabMath.planTarget(chain(), demands, { ingots: 5000 }, { freeSlots: 10 });
    assert.ok(!plan.upgradeRoi.some(r => r.name === "Foundry"));
  });

  test("speed options for the critical building: x10 = /10 time, x77.7 inputs", () => {
    const stocks = { gold: 100e6, silver: 100e6, copper: 100e6, platinum: 100e6 };
    const plan = LabMath.planTarget(chain(), demands, stocks, { freeSlots: 10 });
    assert.equal(plan.speed.building, "Foundry");
    assert.equal(plan.speed.options.length, 9);
    const x2 = plan.speed.options[0];
    assert.equal(x2.x, 2);
    near(x2.inputMult, 2.6);
    near(x2.hours, 2000 * 43 / 2 / 3600 + 2 * 10 / 60);
    near(x2.hoursSaved, plan.hoursPipelined - x2.hours);
    assert.equal(x2.affordable, true); // 52M of each <= 100M
    assert.deepEqual(x2.extraInputs.find(e => e.name === "gold"), { name: "gold", extra: 20000000 * 1.6 });
    const x10 = plan.speed.options[8];
    near(x10.inputMult, 77.7);
    assert.equal(x10.affordable, false); // 1.554B > 100M
  });

  test("speed is null when nothing needs to run", () => {
    const plan = LabMath.planTarget(chain(), demands, { "warp capsule": 10 }, { freeSlots: 10 });
    assert.equal(plan.speed, null);
    assert.deepEqual(plan.upgradeRoi, []);
    assert.equal(plan.ready, true);
  });
});
