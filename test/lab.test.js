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
    assert.equal(lab.baseTier, null);
  });

  // Live shape of LaboratoryStore.base on client 1.2.0 (2026-09-13): four of
  // the five base-tier buildings bought, 100,000 of each input per unit.
  const baseLab = () => ({
    buildings: [
      { building: "Aeroforge", level: 11, currency_use: ["gold", "ruby", "sulfur", "hydrogen"], material_use: [], produce: ["aerolite"], input: 100000, output: 1, timer: 45 },
      { building: "Cryovault", level: 10, currency_use: ["silver", "emerald", "carbon", "helium"], material_use: [], produce: ["cryovita"], input: 100000, output: 1, timer: 45 },
      { building: "Ferric Mill", level: 10, currency_use: ["copper", "sapphire", "water", "methane"], material_use: [], produce: ["ferricrystal"], input: 100000, output: 1, timer: 45 },
      { building: "Prism Nexus", level: 10, currency_use: ["platinum", "diamond", "nitrogen", "ammonia"], material_use: [], produce: ["luminaris"], input: 100000, output: 1, timer: 45 },
    ],
    nextBaseCost: 100000000, nextBuildingCost: 0,
  });

  test("base-tier buildings join the chain and get their own rows", () => {
    const state = Object.assign(liveState(), { baseLab: baseLab() });
    state.materials.push({ name: "aerolite", quantity: 7 });
    const lab = planLab(state, { capsules: 10 });
    // in the chain, so the emulator can time aerolite; the capsule plan is untouched
    assert.ok(lab.chain.find(b => b.building === "Aeroforge"));
    assert.equal(LabMath.buildChain(lab.chain).byProduct["aerolite"].name, "Aeroforge");
    assert.equal(lab.targets.capsules.buildings.find(b => b.name === "Aeroforge").unitsToRun, 0);
    assert.equal(lab.targets.capsules.ready, true);
    const rows = lab.baseTier.rows;
    assert.deepEqual(rows.map(r => r.building), ["Aeroforge", "Cryovault", "Ferric Mill", "Prism Nexus", "Rare Material Facility"]);
    const aero = rows.find(r => r.building === "Aeroforge");
    assert.equal(aero.bought, true); assert.equal(aero.level, 11); assert.equal(aero.perUnit, 100000);
    assert.ok(Math.abs(aero.timerNow - 43.9) < 1e-9);
    assert.ok(Math.abs(aero.unitsPerHour - 3600 / 43.9) < 1e-9);
    assert.deepEqual(aero.inputs, ["gold", "ruby", "sulfur", "hydrogen"]);
    // gold 14.8M is the scarcest of its four inputs -> 148 units
    assert.equal(aero.unitsFromStock, 148);
    assert.equal(aero.stock, 7);
    const rare = rows.find(r => r.building === "Rare Material Facility");
    assert.equal(rare.bought, false); assert.equal(rare.level, null); assert.equal(rare.timerNow, null);
    assert.equal(rare.unitsFromStock, null);
    assert.deepEqual(rare.inputs, ["argon", "cobalt", "dark matter", "silicon"]);
    // The live store carried a price but no nextBase: the panel offers
    // nothing, and the client's lock list names this building -> locked.
    assert.equal(rare.status, "locked");
    assert.equal(aero.status, "bought");
    assert.equal(lab.baseTier.nextBase, null);
    assert.equal(lab.baseTier.nextBaseCost, 100000000);
    assert.equal(lab.baseTier.panelOpened, true);
  });

  test("base-tier: the building the panel offers next is 'next' at nextBaseCost, the lock list stays locked", () => {
    const bl = baseLab();
    bl.buildings = bl.buildings.slice(0, 3); // Prism Nexus not yet bought
    bl.nextBase = "Prism Nexus"; bl.nextBaseCost = 50000000;
    const lab = planLab(Object.assign(liveState(), { baseLab: bl }), { capsules: 10 });
    const by = Object.fromEntries(lab.baseTier.rows.map(r => [r.building, r.status]));
    assert.equal(by["Prism Nexus"], "next");
    assert.equal(by["Rare Material Facility"], "locked");
    assert.equal(by["Aeroforge"], "bought");
    assert.equal(lab.baseTier.nextBase, "Prism Nexus");
    assert.equal(lab.baseTier.nextBaseCost, 50000000);
  });

  test("base-tier without the panel opened: table rows only, nothing bought, panelOpened false", () => {
    const lab = planLab(Object.assign(liveState(), { baseLab: { buildings: [], nextBaseCost: 0, nextBuildingCost: 0 } }), { capsules: 10 });
    assert.equal(lab.baseTier.rows.length, 5);
    assert.ok(lab.baseTier.rows.every(r => !r.bought && r.perUnit === null));
    assert.deepEqual(lab.baseTier.rows.map(r => r.status), ["unknown", "unknown", "unknown", "unknown", "locked"]);
    assert.equal(lab.baseTier.panelOpened, false);
    assert.equal(lab.chain.length, liveBuildings().length);
    // and with no baseLab at all
    const none = planLab(liveState(), { capsules: 10 });
    assert.equal(none.baseTier.rows.length, 5);
    assert.equal(none.baseTier.panelOpened, false);
  });

  test("founded base: no founding target, no after-founding capsule plan, no bundle", () => {
    const foundedBase = { name: "Home", stellarium: 0, modules: [{ name: "Stellarium miner", unlocked: true, level: 1 }] };
    const pre = planLab(liveState(), { capsules: 10 });
    assert.equal(pre.founded, false);
    assert.ok(pre.targets.baseFounding);
    assert.ok(pre.targets.capsules.afterFounding);
    assert.equal(pre.foundingBundle.length, 5);

    const lab = planLab(Object.assign(liveState(), { base: foundedBase }), { capsules: 10 });
    assert.equal(lab.founded, true);
    assert.equal(lab.targets.baseFounding, undefined);
    assert.equal(lab.targets.capsules.afterFounding, null);
    assert.equal(lab.foundingBundle, null);
    // the capsule plan itself is unchanged by founding
    assert.equal(lab.targets.capsules.hoursPipelined, pre.targets.capsules.hoursPipelined);
    assert.equal(lab.targets.capsules.ready, pre.targets.capsules.ready);
    // degraded state keeps the flag too
    const none = planLab({ base: foundedBase, commonResources: {}, materials: [] }, { capsules: 10 });
    assert.equal(none.available, false);
    assert.equal(none.founded, true);
    assert.equal(none.foundingBundle, null);
  });
});

describe("target product is not netted against its own stock (additional capsules)", () => {
  test("expand with netTopLevel:false ignores stock of the demanded product but still nets intermediates", () => {
    const chain = LabMath.buildChain(liveBuildings());
    const stocks = { "warp capsule": 15, "fuel cell casing": 100 };
    const netted = LabMath.expand(chain, [{ product: "warp capsule", units: 10 }], stocks);
    assert.equal(netted.runs["Space Capsule Complex"], 0);
    const extra = LabMath.expand(chain, [{ product: "warp capsule", units: 10 }], stocks, { netTopLevel: false });
    assert.equal(extra.runs["Space Capsule Complex"], 10);
    assert.equal(extra.runs["Module Assembly Plant"], 0, "casings in stock still count");
    assert.equal(extra.runs["Fuel Lab"], 100);
  });

  test("planCore forwards netTopLevel", () => {
    const chain = LabMath.buildChain(liveBuildings());
    const core = LabMath.planCore(chain, [{ product: "warp capsule", units: 10 }], { "warp capsule": 15 }, { freeSlots: 10, netTopLevel: false });
    assert.equal(core.buildings.find(b => b.name === "Space Capsule Complex").unitsToRun, 10);
    assert.equal(core.ready, false);
  });

  test("planLab: capsule target is additional capsules, founding still nets stock, capsulesInStock exposed", () => {
    const { planLab } = require("../lib/lab.js");
    const state = {
      lab: { buildings: liveBuildings(), queue: [], queueSlots: 10 },
      commonResources: {}, rareCurrencies: {},
      materials: [
        { name: "warp capsule", quantity: 15 },
        { name: "ingots", quantity: 5000 }, { name: "refined crystals", quantity: 5000 },
        { name: "high end crystals", quantity: 5000 }, { name: "propulsors", quantity: 5000 },
        { name: "nanoconductors", quantity: 5000 },
      ],
    };
    const lab = planLab(state, { capsules: 10 });
    assert.equal(lab.capsulesInStock, 15);
    const complex = lab.targets.capsules.buildings.find(b => b.name === "Space Capsule Complex");
    assert.equal(complex.unitsToRun, 10);
    assert.equal(lab.targets.capsules.ready, false);
    assert.equal(lab.targets.baseFounding.ready, true);
    assert.equal(lab.targets.capsules.afterFounding.hoursPipelined > 0, true);
  });
});

describe("cyclic or malformed chains", () => {
  const cycleBuilding = (name, produces, needs) =>
    ({ building: name, level: 0, currency_use: [], material_use: needs, produce: [produces], input: 1, output: 1, timer: 10 });

  test("two-building cycle (A: x<-y, B: y<-x) does not hang stageOf or expand", { timeout: 5000 }, () => {
    const buildings = [cycleBuilding("A", "x", ["y"]), cycleBuilding("B", "y", ["x"])];
    const chain = LabMath.buildChain(buildings);
    const stage = LabMath.stageOf(chain, "x");
    assert.ok(stage <= 2, `stageOf(x) should be small, got ${stage}`);
    const r = LabMath.expand(chain, [{ product: "x", units: 3 }], {});
    assert.equal(r.runs.A, 3);
    for (const v of Object.values(r.raw)) assert.ok(Number.isFinite(v), `raw value not finite: ${v}`);
    const core = LabMath.planCore(chain, [{ product: "x", units: 3 }], {}, { freeSlots: 1 });
    assert.ok(Number.isFinite(core.hoursPipelined));
  });

  test("three-building cycle, each with TWO producible inputs, does not explode planCore", { timeout: 5000 }, () => {
    const buildings = [
      cycleBuilding("A", "x", ["y", "z"]),
      cycleBuilding("B", "y", ["x", "z"]),
      cycleBuilding("C", "z", ["x", "y"]),
    ];
    const chain = LabMath.buildChain(buildings);
    const core = LabMath.planCore(chain, [{ product: "x", units: 3 }], {}, { freeSlots: 1 });
    assert.ok(Number.isFinite(core.hoursPipelined));
  });
});

describe("F2: freeSlots reported honestly when the queue is full", () => {
  test("planLab: queueSlots 4, 4 queued -> freeSlots 0 (not clamped to 1)", () => {
    const { planLab } = require("../lib/lab.js");
    const state = {
      lab: { buildings: liveBuildings(), queue: [{}, {}, {}, {}], queueSlots: 4 },
      commonResources: {}, rareCurrencies: {}, materials: [],
    };
    const lab = planLab(state, { capsules: 10 });
    assert.equal(lab.freeSlots, 0);
    assert.ok(Number.isFinite(lab.targets.capsules.hoursPipelined));
  });
});

describe("F3: negative stock is clamped to 0", () => {
  test("expand: -100 ingots in stock does not add to what's needed", () => {
    const chain = LabMath.buildChain(liveBuildings());
    const r = LabMath.expand(chain, [{ product: "warp capsule", units: 10 }], { ingots: -100 });
    assert.equal(r.runs["Foundry"], 2000);
  });
});

describe("F6: LabMath.stocksAfterBundle", () => {
  test("subtracts bundle units from stock, clamped at 0, without mutating the input", () => {
    const stocks = { ingots: 6000, propulsors: 100 };
    const result = LabMath.stocksAfterBundle(stocks, [
      { product: "ingots", units: 5000 },
      { product: "propulsors", units: 5000 },
    ]);
    assert.deepEqual(result, { ingots: 1000, propulsors: 0 });
    assert.deepEqual(stocks, { ingots: 6000, propulsors: 100 });
  });
});

describe("F8: output > 1 per batch", () => {
  test("Mint: input 3, output 5, 12 coins needed -> 3 runs (ceil(12/5)), 9 gold", () => {
    const buildings = [
      { building: "Mint", level: 0, currency_use: ["gold"], material_use: [], produce: ["coins"], input: 3, output: 5, timer: 10 },
    ];
    const chain = LabMath.buildChain(buildings);
    const r = LabMath.expand(chain, [{ product: "coins", units: 12 }], {});
    assert.equal(r.runs["Mint"], 3);
    assert.equal(r.raw["gold"], 9);
  });
});

// ---- production emulator (Lab tab) ----
// "How long does N of a product take, and what do levels / speed do to it?"
describe("LabMath: floorLevel / upgradeCost / levelsAffordable", () => {
  test("floor level is where 0.1 s per level reaches the 5 s floor", () => {
    assert.equal(LabMath.floorLevel(45), 400);
    assert.equal(LabMath.floorLevel(30), 250);
    assert.equal(LabMath.floorLevel(5), 0);
    assert.equal(LabMath.floorLevel(0), 0);
  });

  test("upgradeCost is the sum of 1.15M * k over the levels bought, 0 downward", () => {
    // 20 -> 22: 1.15M * (21 + 22)
    assert.equal(LabMath.upgradeCost(20, 22), 1150000 * 43);
    assert.equal(LabMath.upgradeCost(20, 20), 0);
    assert.equal(LabMath.upgradeCost(20, 10), 0);
    assert.equal(LabMath.upgradeCost(0, 1), 1150000);
  });

  test("levelsAffordable counts whole levels the budget covers", () => {
    assert.equal(LabMath.levelsAffordable(20, 1150000 * 43), 2);
    assert.equal(LabMath.levelsAffordable(20, 1150000 * 43 - 1), 1);
    assert.equal(LabMath.levelsAffordable(20, 0), 0);
    assert.equal(LabMath.levelsAffordable(20, NaN), 0);
  });
});

describe("LabMath.planCore: per-building speed map", () => {
  test("speed.byBuilding divides each named building's time and multiplies its inputs", () => {
    const chain = LabMath.buildChain(liveBuildings());
    const core = LabMath.planCore(chain, [{ product: "warp capsule", units: 10 }], {},
      { freeSlots: 10, speed: { byBuilding: { Foundry: 2, Refinery: 5, "Fuel Lab": 1 } } });
    const by = Object.fromEntries(core.buildings.map(b => [b.name, b]));
    near(by["Foundry"].hours, 2000 * 43 / 2 / 3600);
    assert.equal(by["Foundry"].speedX, 2);
    near(by["Foundry"].inputs.find(i => i.name === "gold").needed, 20000000 * 2.6);
    near(by["Refinery"].hours, 2000 * 43 / 5 / 3600);
    near(by["Refinery"].inputs.find(i => i.name === "ruby").needed, 20000000 * 10.5);
    // x1 is "no multiplier"
    assert.equal(by["Fuel Lab"].speedX, 1);
    near(by["Fuel Lab"].hours, 100 * 28 / 3600);
    // untouched building unchanged
    near(by["Crystal Synthesis Lab"].hours, 2000 * 43 / 3600);
    assert.equal(by["Crystal Synthesis Lab"].speedX, 1);
  });

  test("the group shape still works and reports speedX on its members", () => {
    const chain = LabMath.buildChain(liveBuildings());
    const core = LabMath.planCore(chain, [{ product: "warp capsule", units: 10 }], {},
      { freeSlots: 10, speed: { buildings: ["Foundry"], x: 3 } });
    assert.equal(core.buildings.find(b => b.name === "Foundry").speedX, 3);
    near(core.buildings.find(b => b.name === "Foundry").hours, 2000 * 43 / 3 / 3600);
  });
});

describe("LabMath.clampScenarioLevels", () => {
  test("never below the live level, never above the floor level, floored to whole levels", () => {
    const chain = LabMath.buildChain(liveBuildings());
    const lv = LabMath.clampScenarioLevels(chain, { Foundry: 5, Refinery: 999, "Fuel Lab": 33.7, "Space Capsule Complex": "abc" });
    assert.equal(lv["Foundry"], 20);            // cannot downgrade
    assert.equal(lv["Refinery"], 400);          // capped at the floor level
    assert.equal(lv["Fuel Lab"], 33);
    assert.equal(lv["Space Capsule Complex"], 20); // garbage -> live level
    assert.equal(lv["Nanotech Complex"], 20);   // unset -> live level
  });

  test("a live level already past the floor is kept, not cut", () => {
    const b = liveBuildings();
    b[0].level = 450;
    const chain = LabMath.buildChain(b);
    assert.equal(LabMath.clampScenarioLevels(chain, {})["Foundry"], 450);
    assert.equal(LabMath.clampScenarioLevels(chain, { Foundry: 460 })["Foundry"], 450);
  });
});

describe("LabMath.stripIntermediates", () => {
  test("zeroes every product the chain makes and keeps raw stock, without mutating", () => {
    const chain = LabMath.buildChain(liveBuildings());
    const stocks = { gold: 5, ingots: 7000, "warp capsule": 50, "pet food": 3 };
    const out = LabMath.stripIntermediates(chain, stocks);
    assert.deepEqual(out, { gold: 5, ingots: 0, "warp capsule": 0, "pet food": 3,
      "refined crystals": 0, "high end crystals": 0, propulsors: 0, nanoconductors: 0,
      microcircuits: 0, "fusion cells": 0, "fuel cell casing": 0, "unstable fuel": 0 });
    assert.equal(stocks.ingots, 7000);
  });
});

describe("LabMath.emulateProduction", () => {
  const chain = () => LabMath.buildChain(liveBuildings());
  const demand = [{ product: "warp capsule", units: 10 }];
  const opts = { freeSlots: 10, netTopLevel: false };

  test("no changes: scenario equals baseline, nothing bought, nothing saved", () => {
    const e = LabMath.emulateProduction(chain(), demand, {}, {}, opts);
    near(e.hoursNow, 2000 * 43 / 3600 + 2 * 10 / 60);
    near(e.hours, e.hoursNow);
    assert.equal(e.hoursSaved, 0);
    assert.equal(e.upgradeCost, 0);
    assert.equal(e.creditsPerHourSaved, null);
    assert.deepEqual(e.speeds, {});
    // all five 45 s stage-1 buildings are tied at the top
    assert.deepEqual(e.criticalGroup.sort(), ["Crystal Synthesis Lab", "Foundry", "Nanotech Complex", "Noble Gas Processing Station", "Refinery"]);
    const f = e.buildings.find(b => b.name === "Foundry");
    assert.equal(f.levelNow, 20); assert.equal(f.level, 20); assert.equal(f.floorLevel, 400);
    assert.equal(f.levelsBought, 0); assert.equal(f.speedX, 1); assert.equal(f.critical, true);
    assert.deepEqual(f.extraInputs, []);
  });

  test("upgrading ONE tied building saves nothing but still costs; the group saves", () => {
    const one = LabMath.emulateProduction(chain(), demand, {}, { levels: { Foundry: 30 } }, opts);
    assert.equal(one.upgradeCost, LabMath.upgradeCost(20, 30));
    assert.equal(one.hoursSaved, 0);
    assert.equal(one.creditsPerHourSaved, null);
    assert.equal(one.buildings.find(b => b.name === "Foundry").critical, false);
    const group = { Foundry: 30, Refinery: 30, "Crystal Synthesis Lab": 30, "Noble Gas Processing Station": 30, "Nanotech Complex": 30 };
    const all = LabMath.emulateProduction(chain(), demand, {}, { levels: group }, opts);
    near(all.hoursSaved, 2000 * 1 / 3600); // 43 s -> 42 s on 2000 units
    assert.equal(all.upgradeCost, 5 * LabMath.upgradeCost(20, 30));
    near(all.creditsPerHourSaved, all.upgradeCost / all.hoursSaved);
    near(all.buildings.find(b => b.name === "Foundry").timer, 42);
    assert.equal(all.buildings.find(b => b.name === "Foundry").levelsBought, 10);
  });

  test("a speed multiplier costs resources, not credits, and is reported as extra inputs", () => {
    const e = LabMath.emulateProduction(chain(), demand, {}, { speeds: { Foundry: 2, Refinery: "2", "Fuel Lab": 1, Nope: 3 } }, opts);
    assert.deepEqual(e.speeds, { Foundry: 2, Refinery: 2, Nope: 3 });
    assert.equal(e.upgradeCost, 0);
    const f = e.buildings.find(b => b.name === "Foundry");
    assert.equal(f.speedX, 2);
    near(f.hours, 2000 * 43 / 2 / 3600);
    near(f.timer, 43); // the timer itself is unchanged, the queue runs at x2
    assert.deepEqual(f.extraInputs.map(x => x.name).sort(), ["copper", "gold", "platinum", "silver"]);
    near(f.extraInputs.find(x => x.name === "gold").extra, 20000000 * 1.6);
    // the other three tied buildings still bound the chain
    assert.equal(e.hoursSaved, 0);
  });

  test("useStock=false times the chain from scratch; default uses intermediates on the shelf", () => {
    const stocks = { "unstable fuel": 100, "fuel cell casing": 100 };
    const withStock = LabMath.emulateProduction(chain(), demand, stocks, {}, opts);
    near(withStock.hoursNow, 10 * 28 / 3600);
    const scratch = LabMath.emulateProduction(chain(), demand, stocks, { useStock: false }, opts);
    near(scratch.hoursNow, 2000 * 43 / 3600 + 2 * 10 / 60);
    // the demanded product's own stock never counts either way
    const capsules = LabMath.emulateProduction(chain(), demand, { "warp capsule": 500 }, {}, opts);
    assert.equal(capsules.buildings.find(b => b.name === "Space Capsule Complex").unitsToRun, 10);
  });

  test("any product the chain makes can be the target", () => {
    const e = LabMath.emulateProduction(chain(), [{ product: "ingots", units: 100 }], {}, {}, opts);
    assert.equal(e.buildings.find(b => b.name === "Foundry").unitsToRun, 100);
    assert.equal(e.buildings.filter(b => b.unitsToRun > 0).length, 1);
    near(e.hoursNow, 100 * 43 / 3600);
    assert.deepEqual(e.criticalGroup, ["Foundry"]);
  });

  test("a level on a building the product never runs is not billed", () => {
    const e = LabMath.emulateProduction(chain(), [{ product: "ingots", units: 100 }], {}, { levels: { Foundry: 25, Refinery: 300 } }, opts);
    assert.equal(e.upgradeCost, LabMath.upgradeCost(20, 25));
    assert.equal(e.buildings.find(b => b.name === "Refinery").upgradeCost, 0);
    assert.equal(e.buildings.find(b => b.name === "Refinery").level, 300);
  });
});

describe("LabMath.spendOnChain", () => {
  const chain = () => LabMath.buildChain(liveBuildings());
  const demand = [{ product: "warp capsule", units: 10 }];
  const opts = { freeSlots: 10, netTopLevel: false };
  const tied = ["Foundry", "Refinery", "Crystal Synthesis Lab", "Noble Gas Processing Station", "Nanotech Complex"];

  test("lifts the whole tied group one level per step until the budget runs out", () => {
    // one step = 5 buildings x level 21 = 5 x 24.15M; two steps add 5 x 25.3M
    const oneStep = 5 * LabMath.levelCost(21);
    const twoSteps = oneStep + 5 * LabMath.levelCost(22);
    const r = LabMath.spendOnChain(chain(), demand, {}, opts, twoSteps + 1, {}, {});
    assert.equal(r.steps, 2);
    assert.equal(r.spent, twoSteps);
    for (const n of tied) assert.equal(r.levels[n], 22);
    assert.equal(r.levels["Fuel Lab"], 20);
    near(r.hoursBefore - r.hoursAfter, 2000 * 0.2 / 3600);
    const short = LabMath.spendOnChain(chain(), demand, {}, opts, oneStep - 1, {}, {});
    assert.equal(short.steps, 0);
    assert.equal(short.spent, 0);
    near(short.hoursAfter, short.hoursBefore);
  });

  test("spends on top of the scenario it is given, and moves on once the group is no longer the slowest", () => {
    // Put the five 45 s buildings near their floor: 2000 x 5.1 s = 2.83 h, now
    // below the two 30 s buildings' 2000 x 28 s = 15.6 h, which become the group.
    const start = {};
    for (const n of tied) start[n] = 399;
    const r = LabMath.spendOnChain(chain(), demand, {}, opts, 2 * LabMath.levelCost(21), start, {});
    assert.equal(r.steps, 1);
    assert.equal(r.levels["Circuit Integration Facility"], 21);
    assert.equal(r.levels["Energetic Fusion Center"], 21);
    for (const n of tied) assert.equal(r.levels[n], 399);
  });

  test("stops when a member of the tied group is at its floor", () => {
    const start = {};
    for (const n of tied) start[n] = 400;
    // the two 30 s buildings would be next (15.6 h); give them the floor too,
    // so the slowest stage is all at the floor -> nothing left to buy
    start["Circuit Integration Facility"] = 250;
    start["Energetic Fusion Center"] = 250;
    const r = LabMath.spendOnChain(chain(), demand, {}, opts, 1e15, start, {});
    assert.equal(r.steps, 0);
    assert.equal(r.spent, 0);
  });

  test("a non-finite or zero budget buys nothing; empty chain does not throw", () => {
    assert.equal(LabMath.spendOnChain(chain(), demand, {}, opts, NaN, {}, {}).steps, 0);
    assert.equal(LabMath.spendOnChain(chain(), demand, {}, opts, 0, {}, {}).steps, 0);
    const r = LabMath.spendOnChain(LabMath.buildChain([]), demand, {}, opts, 1e12, {}, {});
    assert.equal(r.steps, 0);
    assert.deepEqual(r.levels, {});
  });
});
