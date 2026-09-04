// Shared base-building math. Loaded by lib/base.js (engine, via require)
// and by the GUI's app.js (via a <script> tag, as window.BaseMath) so the
// planner runs the same code on the server and in the browser.
//
// Every formula below is the game client's own (bundle index-BiPcVSdi.js,
// patch 1.1.1: getBaseModuleLevelUpgradeCost, getStellariumCost,
// getModuleResource, BaseModuleCard upkeep). The ONLY estimate is how much
// stellarium the miner yields per production (server-side); it lives in
// ESTIMATES and every number derived from it is flagged.
const PROVENANCE = { client: "1.1.1", bundle: "index-BiPcVSdi.js" };

const MODULES = [
  { name: "Stellarium miner", type: "passive", setup: false, needs: [], materials: ["microcircuits", "fusion cells"], halfLevel: false, baseAmount: 1 },
  { name: "Material generator", type: "passive", setup: true, needs: ["Stellarium miner"], materials: ["aerolite"], halfLevel: false, baseAmount: 200 },
  { name: "Metal scrap generator", type: "passive", setup: false, needs: ["Stellarium miner"], materials: ["cryovita"], halfLevel: false, baseAmount: 1500 },
  { name: "Resource miner", type: "passive", setup: true, needs: ["Stellarium miner"], materials: ["ferricrystal"], halfLevel: false, baseAmount: 20000 },
  { name: "Quantum server", type: "passive", setup: false, needs: ["Material generator"], materials: ["microcircuits"], halfLevel: true, baseAmount: 1 },
  { name: "Craftron 3000", type: "active", setup: true, needs: ["Metal scrap generator"], materials: ["luminaris"], halfLevel: false, baseAmount: 1 },
  { name: "Fuel facility", type: "passive", setup: false, needs: ["Resource miner"], materials: ["fusion cells"], halfLevel: false, baseAmount: 5 },
  { name: "Research lab", type: "passive", setup: false, needs: ["Quantum server", "Craftron 3000", "Fuel facility"], materials: ["warp capsule"], halfLevel: false, baseAmount: 1 },
  { name: "Item booster", type: "active", setup: true, needs: ["Research lab"], materials: ["fusion cells"], halfLevel: false, baseAmount: 1 },
  { name: "Laboratory enhancer", type: "passive", setup: false, needs: ["Research lab"], materials: ["microcircuits"], halfLevel: true, baseAmount: 1 },
  { name: "Battling Trainer (PvP)", type: "passive", setup: false, needs: ["Laboratory enhancer", "Item booster"], materials: ["warp capsule"], halfLevel: false, baseAmount: 1 },
];

// Which lab building makes each module material. baseTier buildings are
// bought separately (LaboratoryStore.base) and are never estimated.
const MATERIAL_BUILDINGS = {
  "microcircuits": { building: "Circuit Integration Facility", inputs: ["silicon", "cobalt"], baseTier: false },
  "fusion cells": { building: "Energetic Fusion Center", inputs: ["argon", "dark matter"], baseTier: false },
  "warp capsule": { building: "Space Capsule Complex", inputs: ["unstable fuel", "fuel cell casing"], baseTier: false },
  "aerolite": { building: "Aeroforge", inputs: ["gold", "ruby", "sulfur", "hydrogen"], baseTier: true },
  "cryovita": { building: "Cryovault", inputs: ["silver", "emerald", "carbon", "helium"], baseTier: true },
  "ferricrystal": { building: "Ferric Mill", inputs: ["copper", "sapphire", "water", "methane"], baseTier: true },
  "luminaris": { building: "Prism Nexus", inputs: ["platinum", "diamond", "nitrogen", "ammonia"], baseTier: true },
  "argoflux": { building: "Rare Material Facility", inputs: ["argon", "cobalt", "dark matter", "silicon"], baseTier: true },
};

const STAR_BONUSES = {
  "Ringed Dwarf": { rate: 8, efficiency: 125, rare: true }, "Binary Stars": { rate: 8, efficiency: 125, rare: true },
  "Neutron Star": { rate: 8, efficiency: 125, rare: true }, "Black Hole": { rate: 8, efficiency: 125, rare: true },
  "O type": { rate: 7, efficiency: 110, rare: false }, "B type": { rate: 7, efficiency: 110, rare: false },
  "A type": { rate: 6, efficiency: 100, rare: false }, "F type": { rate: 6, efficiency: 100, rare: false },
  "G type": { rate: 5, efficiency: 85, rare: false }, "K type": { rate: 5, efficiency: 85, rare: false }, "M type": { rate: 5, efficiency: 85, rare: false },
};
const BODY_BONUSES = {
  "Rocky Planet": "battling", "Asteroid": "battling", "Icy Planet": "gathering", "Belt": "gathering",
  "Gas Planet": "crafting", "Nebula": "crafting", "Crystal Planet": "exploring", "Comet": "exploring",
};
const FOUNDING_BUNDLE = ["ingots", "refined crystals", "high end crystals", "propulsors", "nanoconductors"]
  .map(product => ({ product, units: 5000 }));

const ESTIMATES = {
  STELLARIUM_TICK_HOURS: 5,
  // Stellarium per miner production: star rate scaled by the module boost.
  minerAmount: (starRate, boost) => (starRate || 0) * (1 + (boost || 0) / 100),
};
const TICKS_PER_DAY = 144;      // one upkeep charge every 10 minutes
const UPKEEP_CAP = 60;          // catalyst base_upkeep_reduction cap (STAT_CAPS)

// --- level cost: client getBaseModuleLevelUpgradeCost, cumulative to L, per material ---
function levelCostCumulative(L) {
  L = Math.max(0, Math.floor(L || 0));
  const t = x => x * (x + 1) / 2;
  if (L <= 600) return t(L);
  let c = t(600);
  if (L <= 1000) return c + (t(L) - t(600)) * 2;
  c += (t(1000) - t(600)) * 2;
  if (L <= 1500) return c + (t(L) - t(1000)) * 4;
  c += (t(1500) - t(1000)) * 4;
  if (L <= 1750) return c + (t(L) - t(1500)) * 8;
  c += (t(1750) - t(1500)) * 8;
  if (L <= 2000) return c + (t(L) - t(1750)) * 16;
  c += (t(2000) - t(1750)) * 16;
  return c + (t(L) - t(2000)) * 64;
}
function levelCost(L) { return levelCostCumulative(L) - levelCostCumulative(L - 1); }
function levelsCost(from, to) { return Math.max(0, levelCostCumulative(to) - levelCostCumulative(from)); }

// --- stellarium: client getStellariumCost step curve ---
function stellariumStep(n) {
  n = Math.max(0, Math.floor(n || 0));
  let mult = 1;
  if (n >= 100) mult = Math.pow(2, Math.floor((n - 100) / 50) + 1);
  return n * mult;
}
// Cost of the next unlock when N modules are already unlocked.
function unlockCost(N) {
  let total = 0;
  for (let n = 1; n <= (N || 0); n++) total += stellariumStep(n);
  return total;
}
function tierCost(t) { return stellariumStep((t || 0) + 1); }
function tiersCost(from, to) {
  let total = 0;
  for (let t = (from || 0); t < (to || 0); t++) total += tierCost(t);
  return total;
}

// --- boost / output: client currentModuleBoost + getModuleResource ---
function moduleBoost(mod, efficiencyBoost) {
  const lvl = (mod.halfLevel ? (mod.level || 0) / 2 : (mod.level || 0));
  return lvl * (1 + (mod.tier || 0) / 100) * (1 + (efficiencyBoost || 0) / 100);
}
function expectedOutputPerTick(mod, efficiencyBoost) {
  return (mod.baseAmount || 1) * (1 + moduleBoost(mod, efficiencyBoost) / 100);
}

// Topological order by `needs`, stable in table order.
function unlockOrder() {
  const done = [];
  let guard = 0;
  while (done.length < MODULES.length && guard++ < 20) {
    for (const m of MODULES) {
      if (done.includes(m.name)) continue;
      if (m.needs.every(n => done.includes(n))) done.push(m.name);
    }
  }
  return done;
}

// --- upkeep: client BaseModuleCard ---
function avgDailyIncome(lifetimeCredits, registeredSec, nowSec) {
  const days = Math.max(1, ((nowSec || 0) - (registeredSec || 0)) / 86400);
  return Math.floor(Math.max(0, lifetimeCredits || 0) / days);
}
function upkeepPerTick(avgDaily, passiveCount, boost, pvpBaseBoost, upkeepReduction) {
  if (!passiveCount || passiveCount <= 0) return 0;
  const red = Math.min(UPKEEP_CAP, upkeepReduction || 0);
  return Math.floor((avgDaily || 0) / 24 / 2 / 9 / passiveCount / 2) * (1 + (boost || 0) / 100) * (1 - (pvpBaseBoost || 0) / 100) * (1 - red / 100);
}
function questsCoverage(claimed) { return 0.15 * Math.min(5, Math.max(0, claimed || 0)); }

// ESTIMATE: stellarium per day at a star rate and miner boost.
function stellariumPerDay(starRate, boost) {
  return ESTIMATES.minerAmount(starRate, boost) * (24 / ESTIMATES.STELLARIUM_TICK_HOURS);
}

// Lab math is needed for material production times. In Node it is a
// sibling module; in the browser it is the LabMath global loaded first.
const LM = (typeof module !== "undefined" && module.exports) ? require("./lab-math.js") : (typeof window !== "undefined" ? window.LabMath : null);

function defaultModules() {
  return MODULES.map(m => ({ ...m, unlocked: false, level: 0, tier: 0, active: false, _id: null }));
}

// Live BaseBuildingStore.base -> engine shape. Unknown module names are
// dropped, missing table modules are added locked, missing fields default.
function normalizeBase(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.modules)) return null;
  const byName = {};
  for (const m of raw.modules) if (m && typeof m === "object" && m.name) byName[m.name] = m;
  const modules = MODULES.map(t => {
    const m = byName[t.name] || {};
    return {
      ...t,
      unlocked: !!m.unlocked,
      level: Number(m.level) || 0,
      tier: Number(m.tier) || 0,
      active: m.active === undefined ? !!m.unlocked : !!m.active,
      _id: m._id || null,
    };
  });
  return {
    name: raw.name || "",
    stellarium: Number(raw.stellarium) || 0,
    nextStellariumTick: Number(raw.nextStellariumTick) || 0,
    upkeepReduction: Number(raw.catalystUpkeepReduction) || 0,
    modules,
  };
}

// Unlock plan in topological order. The Stellarium miner comes with
// founding (cost 0). Each further unlock costs unlockCost(N) with N = modules
// unlocked before it. ETA divides the cumulative stellarium still to pay by
// the ESTIMATED daily miner income.
function planUnlocks(modules, starRate, minerBoost) {
  const order = unlockOrder();
  const byName = {};
  for (const m of modules || []) byName[m.name] = m;
  const perDay = stellariumPerDay(starRate, minerBoost);
  let unlockedCount = (modules || []).filter(m => m.unlocked).length;
  let cumulative = 0;
  return order.map(name => {
    const m = byName[name] || { unlocked: false };
    if (m.unlocked) return { name, unlocked: true, cost: 0, cumulative, daysToUnlock: 0, estimate: true };
    const cost = (name === "Stellarium miner" && unlockedCount === 0) ? 0 : unlockCost(unlockedCount);
    unlockedCount++;
    cumulative += cost;
    return { name, unlocked: false, cost, cumulative, daysToUnlock: perDay > 0 ? cumulative / perDay : Infinity, estimate: true };
  });
}

// Materials to take each target module from its current level to toLevel:
// f(to) - f(from), charged from EACH of the module's materials.
function materialsFor(targets, modules) {
  const byName = {};
  for (const m of modules || []) byName[m.name] = m;
  const perModule = [];
  const perMaterial = {};
  for (const t of targets || []) {
    const m = byName[t.name];
    if (!m) continue;
    const from = Math.max(0, Math.floor(m.level || 0));
    const to = Math.max(from, Math.floor(Number(t.toLevel) || 0));
    const each = levelsCost(from, to);
    perModule.push({ name: m.name, from, to, perMaterial: each, materials: m.materials.slice() });
    for (const mat of m.materials) {
      const row = perMaterial[mat] || (perMaterial[mat] = { needed: 0, modules: [] });
      row.needed += each;
      row.modules.push(m.name);
    }
  }
  return { perModule, perMaterial };
}

function planBase(input) {
  input = input || {};
  const modules = Array.isArray(input.modules) && input.modules.length ? input.modules : defaultModules();
  const byName = {};
  for (const m of modules) byName[m.name] = m;
  const eff = Number(input.efficiencyBoost) || 0;
  const miner = byName["Stellarium miner"];
  const minerBoost = miner && miner.unlocked ? moduleBoost(miner, eff) : 0;
  const starRate = Number(input.starRate) || 0;

  const unlocks = planUnlocks(modules, starRate, minerBoost);
  const last = unlocks[unlocks.length - 1];
  const totalStellariumLeft = last ? last.cumulative : 0;
  const perDay = stellariumPerDay(starRate, minerBoost);

  // Targets: every module with a level box; default 50.
  const levels = input.levels || {};
  const targetList = modules.map(m => ({ name: m.name, toLevel: levels[m.name] !== undefined ? levels[m.name] : 50 }));
  const mats = materialsFor(targetList, modules);
  const targets = mats.perModule.map(pm => {
    const m = byName[pm.name];
    const at = { ...m, level: pm.to };
    const boostAtTarget = moduleBoost(at, eff);
    return {
      name: m.name, type: m.type, from: pm.from, to: pm.to, materials: pm.materials, perMaterial: pm.perMaterial,
      boostAtTarget, outputAtTarget: expectedOutputPerTick(at, eff),
      upkeepPerHourAtTarget: 0, // filled below once passiveCount is known
    };
  });

  // Upkeep at the targets: passive modules among the targets (pre) or the
  // unlocked passive ones (live).
  const passiveNames = targets.filter(t => t.type === "passive" && (!input.founded || byName[t.name].unlocked)).map(t => t.name);
  const passiveCount = passiveNames.length;
  let perTick = 0;
  for (const t of targets) {
    if (!passiveNames.includes(t.name)) continue;
    const tick = upkeepPerTick(input.avgDaily, passiveCount, t.boostAtTarget, input.pvpBaseBoost, input.upkeepReduction);
    t.upkeepPerHourAtTarget = tick * 6;
    perTick += tick;
  }
  const coverage = questsCoverage(input.questsClaimed);
  const perDayUpkeep = perTick * TICKS_PER_DAY;
  const upkeep = {
    passiveCount, perTick, perHour: perTick * 6, perDay: perDayUpkeep, coverage,
    netPerDay: perDayUpkeep * (1 - coverage),
    shareOfIncome: input.avgDaily > 0 ? perDayUpkeep / input.avgDaily : null,
  };

  // Upkeep bill the player is paying right now, at current (not target)
  // levels, using only the passive modules already unlocked live.
  let upkeepNow = null;
  if (input.founded) {
    const passiveNow = modules.filter(m => m.type === "passive" && m.unlocked);
    let tick = 0;
    for (const m of passiveNow) tick += upkeepPerTick(input.avgDaily, passiveNow.length, moduleBoost(m, eff), input.pvpBaseBoost, input.upkeepReduction);
    const day = tick * TICKS_PER_DAY;
    upkeepNow = { passiveCount: passiveNow.length, perTick: tick, perHour: tick * 6, perDay: day, coverage, netPerDay: day * (1 - coverage), shareOfIncome: input.avgDaily > 0 ? day / input.avgDaily : null };
  }

  // Stockpile: per material totals vs stock; production time via the lab
  // chain for materials whose building is present in chainBuildings.
  const stocks = input.stocks || {};
  const stockOf = name => (LM ? (stocks[LM.normName(name)] || 0) : (stocks[name] || 0));
  const chain = LM ? LM.buildChain(input.chainBuildings || []) : { list: [], byProduct: {} };
  const stockpile = Object.entries(mats.perMaterial).map(([material, row]) => {
    const info = MATERIAL_BUILDINGS[material] || { building: null, inputs: [], baseTier: false };
    const bought = !!chain.byProduct[LM ? LM.normName(material) : material];
    const stock = stockOf(material);
    const short = Math.max(0, row.needed - stock);
    let hoursPipelined = null, binding = null;
    if (bought && short > 0 && LM) {
      const core = LM.planCore(chain, [{ product: material, units: short }], stocks, { freeSlots: input.freeSlots || 1, netTopLevel: false });
      hoursPipelined = core.hoursPipelined;
      binding = core.binding;
    }
    return { material, needed: row.needed, stock, short, modules: row.modules, building: info.building, baseTier: info.baseTier, inputs: info.inputs.slice(), bought, hoursPipelined, binding };
  }).sort((a, b) => b.short - a.short);
  const buyFirst = stockpile.filter(s => !s.bought && s.baseTier && s.short > 0).map(s => s.building)
    .filter((v, i, arr) => arr.indexOf(v) === i);

  return {
    unlocks, totalStellariumLeft, stellariumPerDay: perDay,
    daysToAllUnlocks: perDay > 0 ? totalStellariumLeft / perDay : Infinity,
    targets, stockpile, buyFirst, upkeep, upkeepNow,
  };
}

const BaseMath = {
  PROVENANCE, MODULES, MATERIAL_BUILDINGS, STAR_BONUSES, BODY_BONUSES, FOUNDING_BUNDLE, ESTIMATES, TICKS_PER_DAY, UPKEEP_CAP,
  levelCostCumulative, levelCost, levelsCost,
  stellariumStep, unlockCost, tierCost, tiersCost,
  moduleBoost, expectedOutputPerTick, unlockOrder,
  avgDailyIncome, upkeepPerTick, questsCoverage, stellariumPerDay,
  defaultModules, normalizeBase, planUnlocks, materialsFor, planBase,
};
if (typeof module !== "undefined" && module.exports) module.exports = BaseMath;
if (typeof window !== "undefined") window.BaseMath = BaseMath;
