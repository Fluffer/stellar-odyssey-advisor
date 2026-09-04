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

describe("BaseMath.normalizeBase / defaultModules", () => {
  test("null, non-object and shapeless input -> null", () => {
    assert.equal(BM.normalizeBase(null), null);
    assert.equal(BM.normalizeBase("x"), null);
    assert.equal(BM.normalizeBase({}), null);
    assert.equal(BM.normalizeBase({ modules: "nope" }), null);
  });
  test("live-shaped base is normalised with table defaults for missing fields", () => {
    const raw = {
      _id: "b1", name: "Home", stellarium: 12, nextStellariumTick: 1788600000, catalystUpkeepReduction: 5,
      modules: [
        { _id: "m1", name: "Stellarium miner", type: "passive", unlocked: true, level: 20, tier: 2, needs: [], tickCounter: 3, active: true },
        { _id: "m2", name: "Material generator", unlocked: false },
        { _id: "mx", name: "Unknown thing", unlocked: true, level: 5 },
      ],
    };
    const b = BM.normalizeBase(raw);
    assert.equal(b.name, "Home");
    assert.equal(b.stellarium, 12);
    assert.equal(b.modules.length, 11, "every table module present, unknown names dropped");
    const miner = b.modules.find(m => m.name === "Stellarium miner");
    assert.equal(miner.level, 20); assert.equal(miner.tier, 2); assert.equal(miner.unlocked, true); assert.equal(miner.active, true);
    const gen = b.modules.find(m => m.name === "Material generator");
    assert.equal(gen.level, 0); assert.equal(gen.type, "passive"); assert.deepEqual(gen.materials, ["aerolite"]);
    assert.equal(b.modules.find(m => m.name === "Quantum server").unlocked, false);
  });
  test("defaultModules: all locked at level 0", () => {
    const d = BM.defaultModules();
    assert.equal(d.length, 11);
    assert.ok(d.every(m => !m.unlocked && m.level === 0 && m.tier === 0));
  });
});

describe("BaseMath.planUnlocks", () => {
  test("pre-founding: miner comes with founding, ten unlocks cost 220 total, ETA from the estimate", () => {
    const u = BM.planUnlocks(BM.defaultModules(), 6, 0);
    assert.equal(u.length, 11);
    assert.equal(u[0].name, "Stellarium miner"); assert.equal(u[0].cost, 0);
    assert.equal(u[1].cost, 1); assert.equal(u[1].cumulative, 1);
    assert.equal(u[10].cost, 55); assert.equal(u[10].cumulative, 220);
    near(u[10].daysToUnlock, 220 / 28.8);
    assert.equal(u[10].estimate, true);
  });
  test("live: unlocked modules cost nothing more and cumulative counts only what is left", () => {
    const mods = BM.defaultModules();
    mods.find(m => m.name === "Stellarium miner").unlocked = true;
    mods.find(m => m.name === "Material generator").unlocked = true;
    const u = BM.planUnlocks(mods, 8, 20);
    const next = u.find(x => !x.unlocked);
    assert.equal(next.cost, 3, "two unlocked -> next costs 1+2");
    assert.equal(u[u.length - 1].cumulative, 219);
    near(u[u.length - 1].daysToUnlock, 219 / BM.stellariumPerDay(8, 20));
  });
});

describe("BaseMath.materialsFor", () => {
  test("charges f(to)-f(from) from EACH material and groups per material", () => {
    const mods = BM.defaultModules();
    mods.find(m => m.name === "Stellarium miner").level = 20;
    const r = BM.materialsFor([{ name: "Stellarium miner", toLevel: 50 }, { name: "Quantum server", toLevel: 10 }], mods);
    const miner = r.perModule.find(m => m.name === "Stellarium miner");
    assert.equal(miner.perMaterial, BM.levelsCost(20, 50));           // 1275 - 210 = 1065
    assert.equal(r.perMaterial.microcircuits.needed, 1065 + 55);
    assert.equal(r.perMaterial["fusion cells"].needed, 1065);
    assert.deepEqual(r.perMaterial.microcircuits.modules, ["Stellarium miner", "Quantum server"]);
  });
});

describe("BaseMath.planBase (pre-founding, live-shaped input)", () => {
  const warpBuildings = () => {
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
  };
  const input = () => ({
    modules: BM.defaultModules(), founded: false, stellarium: 0,
    levels: Object.fromEntries(BM.MODULES.map(m => [m.name, 50])),
    starRate: 6, starName: "A type",
    stocks: { microcircuits: 1600, "fusion cells": 1600, "warp capsule": 15, silicon: 1.28e6, cobalt: 22.9e6, argon: 0.64e6, "dark matter": 0.74e6 },
    chainBuildings: warpBuildings(), freeSlots: 10,
    avgDaily: 200e6, efficiencyBoost: 0, upkeepReduction: 0, pvpBaseBoost: 0, questsClaimed: 5,
  });

  test("stockpile: totals per material, shortfalls, chain time for bought buildings, buy-first for base-tier ones", () => {
    const plan = BM.planBase(input());
    const micro = plan.stockpile.find(s => s.material === "microcircuits");
    // miner 1275 + quantum server 1275 + lab enhancer 1275 (half-level only affects boost, not cost)
    assert.equal(micro.needed, 3 * 1275);
    assert.equal(micro.stock, 1600);
    assert.equal(micro.short, 3 * 1275 - 1600);
    assert.equal(micro.building, "Circuit Integration Facility");
    assert.equal(micro.bought, true);
    assert.ok(micro.hoursPipelined > 0);
    assert.equal(micro.binding.name, "silicon", "2225 more microcircuits need 2.225M silicon vs 1.28M in stock");
    const fusion = plan.stockpile.find(s => s.material === "fusion cells");
    assert.equal(fusion.needed, 3 * 1275); // miner, fuel facility, item booster
    assert.equal(fusion.binding.name, "argon", "2225 x 1000 argon > 640k");
    const aero = plan.stockpile.find(s => s.material === "aerolite");
    assert.equal(aero.needed, 1275); assert.equal(aero.bought, false); assert.equal(aero.hoursPipelined, null);
    assert.deepEqual(aero.inputs, ["gold", "ruby", "sulfur", "hydrogen"]);
    assert.deepEqual(plan.buyFirst, ["Aeroforge", "Cryovault", "Ferric Mill", "Prism Nexus"]);
    const caps = plan.stockpile.find(s => s.material === "warp capsule");
    assert.equal(caps.needed, 2 * 1275); assert.equal(caps.short, 2 * 1275 - 15);
  });

  test("upkeep at targets: 9 passive modules at level 50 (boost 50, half-level ones 25)", () => {
    const plan = BM.planBase(input());
    assert.equal(plan.upkeep.passiveCount, 9);
    // 7 passive modules at boost 50 + Quantum server and Laboratory enhancer at boost 25
    const expectedTick = 7 * BM.upkeepPerTick(200e6, 9, 50, 0, 0) + 2 * BM.upkeepPerTick(200e6, 9, 25, 0, 0);
    near(plan.upkeep.perTick, expectedTick);
    near(plan.upkeep.perDay, expectedTick * 144);
    near(plan.upkeep.coverage, 0.75);
    near(plan.upkeep.netPerDay, plan.upkeep.perDay * 0.25);
    near(plan.upkeep.shareOfIncome, plan.upkeep.perDay / 200e6);
  });

  test("unlocks and targets", () => {
    const plan = BM.planBase(input());
    assert.equal(plan.totalStellariumLeft, 220);
    near(plan.stellariumPerDay, 28.8);
    near(plan.daysToAllUnlocks, 220 / 28.8);
    const qs = plan.targets.find(t => t.name === "Quantum server");
    assert.equal(qs.from, 0); assert.equal(qs.to, 50); assert.equal(qs.perMaterial, 1275);
    near(qs.boostAtTarget, 25); near(qs.outputAtTarget, 1.25);
    const craft = plan.targets.find(t => t.name === "Craftron 3000");
    assert.equal(craft.upkeepPerHourAtTarget, 0, "active modules pay no upkeep");
  });

  test("levels below the current level or missing -> zero cost, no negative", () => {
    const inp = input();
    inp.modules.find(m => m.name === "Stellarium miner").level = 80;
    inp.levels = { "Stellarium miner": 50 };
    const plan = BM.planBase(inp);
    const miner = plan.targets.find(t => t.name === "Stellarium miner");
    assert.equal(miner.perMaterial, 0);
    assert.ok(plan.stockpile.every(s => s.needed >= 0));
  });

  test("degraded: no chain buildings -> no times, no throw; empty stocks fine", () => {
    const inp = input(); inp.chainBuildings = []; inp.stocks = {};
    const plan = BM.planBase(inp);
    assert.ok(plan.stockpile.every(s => s.hoursPipelined === null));
    assert.ok(plan.stockpile.find(s => s.material === "microcircuits").bought === false);
  });

  test("upkeepNow: null pre-founding", () => {
    const plan = BM.planBase(input());
    assert.equal(plan.upkeepNow, null);
  });

  test("upkeepNow: live, at CURRENT levels of unlocked passive modules only", () => {
    const inp = input();
    inp.founded = true;
    const miner = inp.modules.find(m => m.name === "Stellarium miner");
    miner.unlocked = true; miner.level = 20; miner.tier = 2;
    const plan = BM.planBase(inp);
    assert.equal(plan.upkeepNow.passiveCount, 1);
    const expectedTick = BM.upkeepPerTick(200e6, 1, BM.moduleBoost({ ...miner, level: 20, tier: 2 }, 0), 0, 0);
    near(plan.upkeepNow.perTick, expectedTick);
    assert.notEqual(plan.upkeepNow.perTick, plan.upkeep.perTick, "upkeepNow (current levels) differs from upkeep (target levels)");
  });

  test("buyFirst: only base-tier buildings that are actually short", () => {
    const inp = input();
    inp.stocks = Object.assign({}, inp.stocks, { aerolite: 5000 }); // target needs 1275, fully stocked
    const plan = BM.planBase(inp);
    assert.ok(!plan.buyFirst.includes("Aeroforge"));
  });

  test("defaultTarget: warp-capsule modules default to 10, everything else to 50", () => {
    assert.equal(BM.MODULES.find(m => m.name === "Research lab").defaultTarget, 10);
    const inp = input();
    inp.levels = {};
    const plan = BM.planBase(inp);
    assert.equal(plan.targets.find(t => t.name === "Research lab").to, 10);
    assert.equal(plan.targets.find(t => t.name === "Battling Trainer (PvP)").to, 10);
    assert.equal(plan.targets.find(t => t.name === "Stellarium miner").to, 50);
  });
});

describe("lib/base.js planBaseFromState", () => {
  const { planBaseFromState, buildBaseInput } = require("../lib/base.js");
  const liveState = () => ({
    lab: { buildings: [
      { building: "Circuit Integration Facility", level: 20, currency_use: ["silicon", "cobalt"], material_use: [], produce: ["microcircuits"], input: 1000, output: 1, timer: 30 },
      { building: "Energetic Fusion Center", level: 20, currency_use: ["argon", "dark matter"], material_use: [], produce: ["fusion cells"], input: 1000, output: 1, timer: 30 },
    ], queue: [], queueSlots: 10 },
    baseLab: { buildings: [], nextBaseCost: 0, nextBuildingCost: 0 },
    base: null,
    account: { registered: 1786174949, lifetimeCredits: 5.4e9 },
    currentSystem: { name: "Torvornir", star: "A type", bodies: ["Comet", "Gas Planet"] },
    bookmarks: [{ name: "Loxgyn", star: "M type", bodies: ["Comet"] }, { name: "Vak", star: "Black Hole", bodies: ["Belt"] }],
    gameVersion: "1.1.2", clientBundle: "index-BiPcVSdi.js",
    commonResources: { gold: 1e6 }, rareCurrencies: { silicon: 1e6, cobalt: 1e6, argon: 1e5, dark_matter: 1e5 },
    materials: [{ name: "ingots", quantity: 5000 }, { name: "refined crystals", quantity: 5000 }, { name: "high end crystals", quantity: 5000 },
      { name: "propulsors", quantity: 5000 }, { name: "nanoconductors", quantity: 5000 }, { name: "microcircuits", quantity: 1600 }, { name: "fusion cells", quantity: 1600 }],
    ship: {}, player: { skills: { base_module_efficiency_boost: 0 } },
  });

  test("pre phase: founding ready, location advice, stockpile and upkeep present, live null", () => {
    const b = planBaseFromState(liveState(), { now: 1786174949 + 27 * 86400 });
    assert.equal(b.phase, "pre");
    assert.equal(b.founding.ready, true);
    assert.equal(b.location.current.rate, 6);
    assert.equal(b.location.best.name, "Vak");
    assert.equal(b.location.best.rate, 8);
    assert.equal(b.location.chosen.star, "A type");
    assert.equal(b.location.chosen.name, "Torvornir", "chosen star equals current star -> current system's name");
    assert.deepEqual(b.location.bodies.map(x => x.activity), ["exploring", "crafting"]);
    assert.equal(b.input.avgDaily, 200000000);
    assert.equal(b.plan.upkeep.passiveCount, 9);
    assert.ok(b.plan.stockpile.find(s => s.material === "microcircuits").bought);
    assert.deepEqual(b.plan.buyFirst, ["Aeroforge", "Cryovault", "Ferric Mill", "Prism Nexus"]);
    assert.equal(b.live, null);
    assert.equal(b.labPanelHint, true, "base-tier list empty and nextBaseCost 0 -> panel never opened");
    assert.equal(b.provenance.live, "1.1.2"); assert.equal(b.provenance.liveBundle, "index-BiPcVSdi.js"); assert.equal(b.provenance.drift, false);
    const drifted = planBaseFromState(Object.assign(liveState(), { clientBundle: "index-ZZZZ.js" }), { now: 1786174949 + 27 * 86400 });
    assert.equal(drifted.provenance.drift, true);
  });

  test("opts.star chooses the ETA star; opts.levels override targets", () => {
    const b = planBaseFromState(liveState(), { star: "Black Hole", levels: { "Stellarium miner": 100 }, now: 1786174949 + 27 * 86400 });
    assert.equal(b.location.chosen.rate, 8);
    assert.equal(b.location.chosen.name, "Vak", "not the current star -> first bookmark with that star");
    assert.equal(b.plan.targets.find(t => t.name === "Stellarium miner").to, 100);
  });

  test("chosen star matching neither the current star nor any bookmark has no name", () => {
    const b = planBaseFromState(liveState(), { star: "O type", now: 1786174949 + 27 * 86400 });
    assert.equal(b.location.chosen.name, null);
  });

  test("live phase from a bundle-shaped base", () => {
    const s = liveState();
    s.base = { _id: "b1", name: "Home", stellarium: 2, nextStellariumTick: 1788600000, catalystUpkeepReduction: 0,
      modules: [{ _id: "m1", name: "Stellarium miner", type: "passive", unlocked: true, level: 20, tier: 2, needs: [], tickCounter: 1, active: true }] };
    const b = planBaseFromState(s, { now: 1786174949 + 27 * 86400 });
    assert.equal(b.phase, "live");
    assert.equal(b.live.name, "Home");
    const miner = b.live.modules.find(m => m.name === "Stellarium miner");
    assert.equal(miner.level, 20); assert.equal(miner.nextLevelCost, 21); assert.equal(miner.nextTierCost, 3);
    near(miner.boost, 20 * 1.02);
    assert.equal(b.live.nextUnlock.name, "Material generator");
    assert.equal(b.live.nextUnlock.cost, 1);
    assert.equal(b.live.nextUnlock.etaDays, 0, "2 stellarium held >= cost 1");
    assert.equal(b.plan.upkeep.passiveCount, 1, "live: only unlocked passive modules pay");
  });

  test("dailyQuests from state feeds questsClaimed and upkeep coverage", () => {
    const s = liveState();
    s.dailyQuests = { claimed: 3, completed: 4, total: 5 };
    const b = planBaseFromState(s, { now: 1786174949 + 27 * 86400 });
    assert.equal(b.input.questsClaimed, 3);
    near(b.plan.upkeep.coverage, 0.45);
  });

  test("degraded: missing account, currentSystem, bookmarks, lab -> no throw", () => {
    const b = planBaseFromState({ materials: [] }, {});
    assert.equal(b.phase, "pre");
    assert.equal(b.founding.ready, false);
    assert.equal(b.location.current.star, null);
    assert.equal(b.input.avgDaily, 0);
    assert.ok(Array.isArray(b.plan.stockpile));
  });
});
