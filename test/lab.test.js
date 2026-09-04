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
const nearRel = (a, b, msg) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), (msg || "") + ` expected ${b} got ${a}`);

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
  // Every raw input generously stocked (100M), so speed affordability is
  // decided by the multiplier alone.
  const richStocks = () => Object.fromEntries(["gold", "silver", "copper", "platinum", "diamond", "ruby", "emerald",
    "sapphire", "water", "nitrogen", "sulfur", "carbon", "helium", "methane", "ammonia", "hydrogen",
    "silicon", "cobalt", "argon", "dark matter"].map(n => [n, 100e6]));

  test("ties: five stage-1 buildings share the maximum, so a single +1 level saves nothing", () => {
    const plan = LabMath.planTarget(chain(), demands, {}, { freeSlots: 10 });
    assert.deepEqual(plan.criticalGroup.slice().sort(), ["Crystal Synthesis Lab", "Foundry", "Nanotech Complex", "Noble Gas Processing Station", "Refinery"]);
    const foundry = plan.upgradeRoi.find(r => r.name === "Foundry");
    assert.equal(foundry.level, 20);
    assert.equal(foundry.nextLevelCost, 1150000 * 21);
    assert.equal(foundry.hoursSaved, 0);
    assert.equal(foundry.creditsPerHourSaved, null);
    assert.equal(foundry.levelsToFloor, 380);
    assert.equal(foundry.costToFloor, LabMath.costToFloor(20, 380));
    // the group row carries the real answer: all five +1 together
    assert.deepEqual(plan.groupRoi.buildings.slice().sort(), plan.criticalGroup.slice().sort());
    assert.equal(plan.groupRoi.cost, 5 * 1150000 * 21);
    near(plan.groupRoi.hoursSaved, 200 / 3600);
    nearRel(plan.groupRoi.creditsPerHourSaved, 5 * 1150000 * 21 / (200 / 3600));
  });

  test("single critical building: Foundry on a 60 s timer is alone at the top", () => {
    const buildings = liveBuildings();
    buildings[0].timer = 60; // Foundry: 2000 x 58 s
    const plan = LabMath.planTarget(LabMath.buildChain(buildings), demands, {}, { freeSlots: 10 });
    assert.deepEqual(plan.criticalGroup, ["Foundry"]);
    assert.equal(plan.upgradeRoi[0].name, "Foundry");
    near(plan.upgradeRoi[0].hoursSaved, 200 / 3600);
    nearRel(plan.upgradeRoi[0].creditsPerHourSaved, 1150000 * 21 / (200 / 3600));
    const circuit = plan.upgradeRoi.find(r => r.name === "Circuit Integration Facility");
    assert.equal(circuit.hoursSaved, 0);
    assert.equal(circuit.creditsPerHourSaved, null);
    assert.deepEqual(plan.groupRoi.buildings, ["Foundry"]);
    near(plan.groupRoi.hoursSaved, plan.upgradeRoi[0].hoursSaved);
  });

  test("ROI: buildings with nothing to run have no row", () => {
    const plan = LabMath.planTarget(chain(), demands, { ingots: 5000 }, { freeSlots: 10 });
    assert.ok(!plan.upgradeRoi.some(r => r.name === "Foundry"));
    assert.ok(!plan.criticalGroup.includes("Foundry"));
  });

  test("speed options apply to the whole critical group: x2 halves the tied stage, x10 is unaffordable", () => {
    const plan = LabMath.planTarget(chain(), demands, richStocks(), { freeSlots: 10 });
    assert.equal(plan.speed.buildings.length, 5);
    assert.equal(plan.speed.options.length, 9);
    const x2 = plan.speed.options[0];
    assert.equal(x2.x, 2);
    near(x2.inputMult, 2.6);
    near(x2.hours, 2000 * 28 / 3600 + 2 * 10 / 60); // Circuit Integration becomes the bottleneck once the tied five are halved
    near(x2.hoursSaved, plan.hoursPipelined - x2.hours);
    assert.equal(x2.affordable, true); // 52M of each raw input <= 100M
    assert.deepEqual(x2.extraInputs.find(e => e.name === "gold"), { name: "gold", extra: 20000000 * 1.6 });
    assert.deepEqual(x2.extraInputs.find(e => e.name === "diamond"), { name: "diamond", extra: 20000000 * 1.6 });
    assert.ok(!x2.extraInputs.some(e => e.name === "silicon"), "non-group inputs are not listed");
    const x10 = plan.speed.options[8];
    near(x10.inputMult, 77.7);
    assert.equal(x10.affordable, false); // 1.554B > 100M
  });

  test("planCore accepts speed for several buildings and still the old single-building form", () => {
    const multi = LabMath.planCore(chain(), demands, {}, { freeSlots: 10, speed: { buildings: ["Foundry", "Refinery"], x: 2 } });
    near(multi.buildings.find(b => b.name === "Foundry").hours, 2000 * 43 / 2 / 3600);
    near(multi.buildings.find(b => b.name === "Refinery").hours, 2000 * 43 / 2 / 3600);
    near(multi.buildings.find(b => b.name === "Crystal Synthesis Lab").hours, 2000 * 43 / 3600);
    const single = LabMath.planCore(chain(), demands, {}, { freeSlots: 10, speed: { building: "Foundry", x: 2 } });
    near(single.buildings.find(b => b.name === "Foundry").hours, 2000 * 43 / 2 / 3600);
  });

  test("speed and groupRoi are null when nothing needs to run", () => {
    const plan = LabMath.planTarget(chain(), demands, { "warp capsule": 10 }, { freeSlots: 10 });
    assert.equal(plan.speed, null);
    assert.equal(plan.groupRoi, null);
    assert.deepEqual(plan.criticalGroup, []);
    assert.deepEqual(plan.upgradeRoi, []);
    assert.equal(plan.ready, true);
  });
});

describe("planLab (lib/lab.js)", () => {
  const { planLab, FOUNDING_BUNDLE } = require("../lib/lab.js");
  const liveState = () => ({
    lab: { buildings: liveBuildings(), queue: [], queueSlots: 10 },
    commonResources: { gold: 14.8e6, silver: 16.5e6, copper: 25.6e6, platinum: 5.8e6, diamond: 683e6, ruby: 717e6,
      emerald: 727e6, sapphire: 654e6, water: 28.1e6, nitrogen: 7.5e6, sulfur: 17.2e6, carbon: 16e6,
      helium: 15.1e6, methane: 24.9e6, ammonia: 26.8e6, hydrogen: 18.2e6 },
    rareCurrencies: { silicon: 1.28e6, cobalt: 22.9e6, argon: 0.64e6, dark_matter: 0.74e6 },
    materials: [
      { name: "ingots", quantity: 5000 }, { name: "refined crystals", quantity: 5000 },
      { name: "high end crystals", quantity: 5000 }, { name: "propulsors", quantity: 5000 },
      { name: "nanoconductors", quantity: 5000 }, { name: "microcircuits", quantity: 1600 },
      { name: "fusion cells", quantity: 1600 }, { name: "fuel cell casing", quantity: 0 },
      { name: "unstable fuel", quantity: 0 }, { name: "cog", quantity: 2817 },
    ],
  });

  test("founding bundle is the five intermediates x 5000", () => {
    assert.deepEqual(FOUNDING_BUNDLE.map(b => b.product), ["ingots", "refined crystals", "high end crystals", "propulsors", "nanoconductors"]);
    assert.ok(FOUNDING_BUNDLE.every(b => b.units === 5000));
  });

  test("live-shaped state: stocks merged and normalised, both targets computed", () => {
    const lab = planLab(liveState(), { capsules: 10 });
    assert.equal(lab.available, true);
    assert.equal(lab.stocks["dark matter"], 0.74e6);
    assert.equal(lab.stocks["ingots"], 5000);
    assert.equal(lab.queueSlots, 10);
    assert.equal(lab.freeSlots, 10);
    assert.equal(lab.targets.capsules.units, 10);
    // 10 capsules need 2000 of each intermediate; 5000 in stock covers the
    // five founding materials, so only microcircuits/fusion cells (1600) and
    // the casing/fuel/capsule buildings run.
    const runs = Object.fromEntries(lab.targets.capsules.buildings.map(b => [b.name, b.unitsToRun]));
    assert.equal(runs["Foundry"], 0);
    assert.equal(runs["Circuit Integration Facility"], 400);
    assert.equal(runs["Energetic Fusion Center"], 400);
    assert.equal(runs["Module Assembly Plant"], 100);
    // argon: 400 * 1000 = 400k needed vs 640k stock -> covered
    assert.equal(lab.targets.capsules.ready, true);
    // founding: everything in stock already
    assert.equal(lab.targets.baseFounding.ready, true);
    assert.equal(lab.targets.baseFounding.hoursPipelined, 0);
    // after founding, the five intermediates are gone -> Foundry must run and platinum binds
    const af = lab.targets.capsules.afterFounding;
    assert.ok(af.hoursPipelined > lab.targets.capsules.hoursPipelined);
    assert.equal(af.binding.name, "platinum"); // 2000 ingots need 20M platinum, stock 5.8M
  });

  test("degraded: no lab in state", () => {
    const lab = planLab({ commonResources: {}, materials: [] }, { capsules: 10 });
    assert.equal(lab.available, false);
    assert.equal(lab.targets, null);
  });
});
