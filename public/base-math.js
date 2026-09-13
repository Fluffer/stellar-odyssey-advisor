// Shared base-building math. Loaded by lib/base.js (engine, via require)
// and by the GUI's app.js (via a <script> tag, as window.BaseMath) so the
// planner runs the same code on the server and in the browser.
//
// Every formula below is the game client's own (bundle index-BiPcVSdi.js,
// patch 1.1.1: getBaseModuleLevelUpgradeCost, getStellariumCost,
// getModuleResource, BaseModuleCard upkeep). The ONLY estimate is how much
// stellarium the miner yields per production (server-side); it lives in
// ESTIMATES and every number derived from it is flagged.
//
// Wrapped in a function: in the browser every one of these files is a classic
// <script> sharing ONE global scope, so a top-level `function levelCost` here
// and another in a sibling file silently overwrite each other (lab-math's
// 1.15M x level was replaced by base-math's module curve at call time).
// Only window.BaseMath / module.exports leave this scope.
(function () {
const PROVENANCE = { client: "1.2.0", bundle: "index-CfS9fhKw.js" };

// defaultTarget: the level a fresh (no stored override) target box shows.
// 50 for every module except the two warp-capsule ones, which cost twice as
// much per level as any other material (charged from a single, expensive
// chain) and make the default view look hopeless at 50 (2,550 capsules =~
// 250 days); 10 keeps the default view reachable.
const MODULES = [
  { name: "Stellarium miner", type: "passive", setup: false, needs: [], materials: ["microcircuits", "fusion cells"], halfLevel: false, baseAmount: 1, defaultTarget: 50 },
  { name: "Material generator", type: "passive", setup: true, needs: ["Stellarium miner"], materials: ["aerolite"], halfLevel: false, baseAmount: 200, defaultTarget: 50 },
  { name: "Metal scrap generator", type: "passive", setup: false, needs: ["Stellarium miner"], materials: ["cryovita"], halfLevel: false, baseAmount: 1500, defaultTarget: 50 },
  { name: "Resource miner", type: "passive", setup: true, needs: ["Stellarium miner"], materials: ["ferricrystal"], halfLevel: false, baseAmount: 20000, defaultTarget: 50 },
  { name: "Quantum server", type: "passive", setup: false, needs: ["Material generator"], materials: ["microcircuits"], halfLevel: true, baseAmount: 1, defaultTarget: 50 },
  { name: "Craftron 3000", type: "active", setup: true, needs: ["Metal scrap generator"], materials: ["luminaris"], halfLevel: false, baseAmount: 1, defaultTarget: 50 },
  { name: "Fuel facility", type: "passive", setup: false, needs: ["Resource miner"], materials: ["fusion cells"], halfLevel: false, baseAmount: 5, defaultTarget: 50 },
  { name: "Research lab", type: "passive", setup: false, needs: ["Quantum server", "Craftron 3000", "Fuel facility"], materials: ["warp capsule"], halfLevel: false, baseAmount: 1, defaultTarget: 10 },
  { name: "Item booster", type: "active", setup: true, needs: ["Research lab"], materials: ["fusion cells"], halfLevel: false, baseAmount: 1, defaultTarget: 50 },
  { name: "Laboratory enhancer", type: "passive", setup: false, needs: ["Research lab"], materials: ["microcircuits"], halfLevel: true, baseAmount: 1, defaultTarget: 50 },
  { name: "Battling Trainer (PvP)", type: "passive", setup: false, needs: ["Laboratory enhancer", "Item booster"], materials: ["warp capsule"], halfLevel: false, baseAmount: 1, defaultTarget: 10 },
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
// The founded base stores the body's nodeType (client bodyTypeBonuses), not
// its display name: rocky / icy / gas / crystal.
const BODY_NODE_BONUSES = { rocky: "battling", icy: "gathering", gas: "crafting", crystal: "exploring" };
const FOUNDING_BUNDLE = ["ingots", "refined crystals", "high end crystals", "propulsors", "nanoconductors"]
  .map(product => ({ product, units: 5000 }));

// Stellarium per drop. The game's base header shows "Drop rate N + p% chance"
// from the miner's boost alone: N = 1 + floor(boost/100), p = boost mod 100
// (BaseBuildingPage: `1+Le.value` and `Re.value`). Seen live on 2026-09-13,
// client 1.2.0: miner level 150, module efficiency +50%, boost 225% ->
// "3 + 25% chance". Expected value per drop = 1 + boost/100.
//
// The star table (`starTypeBonuses`) is still shipped but nothing in the
// client reads it, the placement panel shows only the body table, and the
// wiki names the body type as the one placement choice. The server does keep
// a `stellariumHourly` on the founded base equal to the star's table rate
// (5 on a G type), so a server-side multiplier cannot be ruled out until
// drops are observed: `minerAmountStar` is that variant, a footnote only.
// The observed drop (history log, see lib/income.js) is what settles it.
//
// Cadence: one drop every 5 hours (`base.nextStellariumTick`, the header's
// "Next drop in"). The miner's module card also prints "(3 /hour)" -- that
// is the generic passive-module output label, and the developer confirmed
// on 2026-09-13 that it should not say "per hour" for the miner: the amount
// is per 5-hour tick. Do not read the card label as an hourly rate.
const ESTIMATES = {
  STELLARIUM_TICK_HOURS: 5,
  dropRate: boost => ({
    guaranteed: 1 + Math.floor((boost || 0) / 100),
    chance: Math.round(((boost || 0) % 100) * 100) / 100,
  }),
  minerAmount: boost => 1 + (boost || 0) / 100,
  minerAmountStar: (starRate, boost) => (starRate || 0) * (1 + (boost || 0) / 100),
};
// A module ticks ONCE AN HOUR: the card counts down "Next tick" as
// 60 - module.tickCounter*10 minutes (a 10-minute worker advances the
// counter, the tick fires on the 6th), the module's output renders as
// "(N /hour)" and its upkeep as "<amount> /h" -- the amount being exactly
// upkeepPerTick() below. It is charged per tick, i.e. hourly, not per worker
// run; billing it every 10 minutes overstates upkeep 6x.
const TICKS_PER_DAY = 24;
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
// Exactly the game's own accumulation (BaseBuildingPage, total upkeep):
//   t = floor(avgDaily / 24 / 2 / 9 / <passive AND unlocked count> / 2)
//   t *= (1 - pvpBaseBoost/100); if (reduction) t *= (1 - reduction/100)
//   per module: floor(t * (1 + moduleBoost/100))
// The OUTER floor is per module. `passiveCount` is the
// divisor the game uses: every unlocked passive module, active or not -- but
// only ACTIVE ones are summed, which is the caller's job.
function upkeepPerTick(avgDaily, passiveCount, boost, pvpBaseBoost, upkeepReduction) {
  if (!passiveCount || passiveCount <= 0) return 0;
  const red = Math.min(UPKEEP_CAP, upkeepReduction || 0);
  let t = Math.floor((avgDaily || 0) / 24 / 2 / 9 / passiveCount / 2);
  t *= 1 - (pvpBaseBoost || 0) / 100;
  if (red > 0) t *= 1 - red / 100;
  return Math.floor(t * (1 + (boost || 0) / 100));
}
function questsCoverage(claimed) { return 0.15 * Math.min(5, Math.max(0, claimed || 0)); }

// Stellarium per day at a miner boost: the game's drop rate, 24/5 drops a day.
function stellariumPerDay(boost) {
  return ESTIMATES.minerAmount(boost) * (24 / ESTIMATES.STELLARIUM_TICK_HOURS);
}
// The unconfirmed server-side variant (star rate x drop); see ESTIMATES.
function stellariumPerDayStar(starRate, boost) {
  return ESTIMATES.minerAmountStar(starRate, boost) * (24 / ESTIMATES.STELLARIUM_TICK_HOURS);
}
// When the next unlock is paid: drops still needed, counting only the
// guaranteed part of each drop, and the tick (unix seconds) that pays the
// last of them -- drops land every STELLARIUM_TICK_HOURS from nextTick.
function unlockEta(cost, held, boost, nextTick) {
  const short = Math.max(0, (cost || 0) - (held || 0));
  const drops = short > 0 ? Math.ceil(short / ESTIMATES.dropRate(boost).guaranteed) : 0;
  const tick = Number(nextTick) || 0;
  return { drops, etaTick: drops > 0 && tick > 0 ? tick + (drops - 1) * ESTIMATES.STELLARIUM_TICK_HOURS * 3600 : null };
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
    // Fields the 1.2.0 server writes on a founded base. stellariumHourly is
    // the star's table rate; bodyType is the body's nodeType (rocky, icy...).
    stellariumHourly: Number(raw.stellariumHourly) || 0,
    bodyType: typeof raw.bodyType === "string" ? raw.bodyType : null,
    systemId: raw.systemId || null,
    bodyId: raw.bodyId || null,
    modules,
  };
}

// Unlock plan in topological order. The Stellarium miner comes with
// founding (cost 0). Each further unlock costs unlockCost(N) with N = modules
// unlocked before it. ETA divides the cumulative stellarium still to pay by
// the daily miner income at the given boost (drop timing is the estimate).
function planUnlocks(modules, minerBoost) {
  const order = unlockOrder();
  const byName = {};
  for (const m of modules || []) byName[m.name] = m;
  const perDay = stellariumPerDay(minerBoost);
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

  const unlocks = planUnlocks(modules, minerBoost);
  const last = unlocks[unlocks.length - 1];
  const totalStellariumLeft = last ? last.cumulative : 0;
  const perDay = stellariumPerDay(minerBoost);

  // Targets: every module with a level box; default is the module's
  // defaultTarget (50, 10 for the warp-capsule modules). Once founded, a
  // locked module has a target only when the player set one, and an
  // unlocked module's default is never below its current level.
  const levels = input.levels || {};
  const targetList = modules
    .filter(m => !input.founded || m.unlocked || Number(levels[m.name]) > 0)
    .map(m => ({ name: m.name, toLevel: levels[m.name] !== undefined ? levels[m.name]
      : (input.founded ? Math.max(m.defaultTarget || 50, m.level || 0) : (m.defaultTarget || 50)) }));
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
    t.upkeepPerHourAtTarget = tick;
    perTick += tick;
  }
  // DailyQuestsStore is empty until the player opens the daily quests panel
  // in-game, so "0 claimed" and "not loaded" look identical in the raw state.
  // When it is not loaded, claim no coverage rather than silently assuming 0%.
  const questsKnown = input.questsKnown !== false;
  const coverage = questsKnown ? questsCoverage(input.questsClaimed) : 0;
  const perDayUpkeep = perTick * TICKS_PER_DAY;
  // shareOfIncome is NOT an affordability signal: upkeep is linear in
  // avgDaily (bar the floor), so this ratio cancels avgDaily out and is a
  // constant of the chosen target levels -- it reads the same at any income.
  // Compare perDay against an OBSERVED income rate to judge affordability.
  const upkeep = {
    passiveCount, perTick, perHour: perTick, perDay: perDayUpkeep, coverage, questsKnown,
    netPerDay: perDayUpkeep * (1 - coverage),
    shareOfIncome: input.avgDaily > 0 ? perDayUpkeep / input.avgDaily : null,
  };

  // Upkeep bill the player is paying right now, at current (not target)
  // levels, using only the passive modules already unlocked live.
  let upkeepNow = null;
  if (input.founded) {
    // The game divides by every unlocked passive module but bills only the
    // ACTIVE ones, so switching a passive module off is a real upkeep lever.
    const passiveNow = modules.filter(m => m.type === "passive" && m.unlocked);
    const billed = passiveNow.filter(m => m.active);
    let tick = 0;
    for (const m of billed) tick += upkeepPerTick(input.avgDaily, passiveNow.length, moduleBoost(m, eff), input.pvpBaseBoost, input.upkeepReduction);
    const day = tick * TICKS_PER_DAY;
    upkeepNow = { passiveCount: passiveNow.length, billedCount: billed.length, perTick: tick, perHour: tick, perDay: day, coverage, questsKnown, netPerDay: day * (1 - coverage), shareOfIncome: input.avgDaily > 0 ? day / input.avgDaily : null };
  }

  // Stockpile: per material totals vs stock; production time via the lab
  // chain for materials whose building is present in chainBuildings.
  const stocks = input.stocks || {};
  const stockOf = name => (LM ? (stocks[LM.normName(name)] || 0) : (stocks[name] || 0));
  const chain = LM ? LM.buildChain(input.chainBuildings || []) : { list: [], byProduct: {} };
  const stockpile = Object.entries(mats.perMaterial).filter(([, row]) => row.needed > 0).map(([material, row]) => {
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
    // The game's drop-rate chip for the miner at its current boost.
    dropRate: ESTIMATES.dropRate(minerBoost),
    // Unconfirmed server-side variant (star rate x drop); footnote only.
    stellariumPerDayStar: stellariumPerDayStar(starRate, minerBoost),
    daysToAllUnlocksStar: (() => {
      const hi = stellariumPerDayStar(starRate, minerBoost);
      return hi > 0 ? totalStellariumLeft / hi : Infinity;
    })(),
    targets, stockpile, buyFirst, upkeep, upkeepNow,
  };
}

const BaseMath = {
  PROVENANCE, MODULES, MATERIAL_BUILDINGS, STAR_BONUSES, BODY_BONUSES, BODY_NODE_BONUSES, FOUNDING_BUNDLE, ESTIMATES, TICKS_PER_DAY, UPKEEP_CAP,
  levelCostCumulative, levelCost, levelsCost,
  stellariumStep, unlockCost, tierCost, tiersCost,
  moduleBoost, expectedOutputPerTick, unlockOrder,
  avgDailyIncome, upkeepPerTick, questsCoverage, stellariumPerDay, stellariumPerDayStar, unlockEta,
  defaultModules, normalizeBase, planUnlocks, materialsFor, planBase,
};
if (typeof module !== "undefined" && module.exports) module.exports = BaseMath;
if (typeof window !== "undefined") window.BaseMath = BaseMath;
})();
