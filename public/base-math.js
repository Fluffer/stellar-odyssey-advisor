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

const BaseMath = {
  PROVENANCE, MODULES, MATERIAL_BUILDINGS, STAR_BONUSES, BODY_BONUSES, FOUNDING_BUNDLE, ESTIMATES, TICKS_PER_DAY, UPKEEP_CAP,
  levelCostCumulative, levelCost, levelsCost,
  stellariumStep, unlockCost, tierCost, tiersCost,
  moduleBoost, expectedOutputPerTick, unlockOrder,
  avgDailyIncome, upkeepPerTick, questsCoverage, stellariumPerDay,
};
if (typeof module !== "undefined" && module.exports) module.exports = BaseMath;
if (typeof window !== "undefined") window.BaseMath = BaseMath;
