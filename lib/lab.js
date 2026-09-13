// Laboratory bottleneck planner: adapts the raw game state to the shared
// chain math in public/lab-math.js and produces the `lab` block of the
// analyze payload. The browser re-runs LabMath.planTarget on the same
// `chain` + `stocks` when the capsule target box changes.
const LabMath = require("../public/lab-math.js");

// Founding a base costs 5,000 each of these (in-game wiki, Base Building).
// Shared with the base planner so there is exactly one definition. The
// material -> building table is shared the same way: it names the five
// base-tier buildings (Aeroforge ... Rare Material Facility) and their inputs.
// normalizeBase is the same founded-or-not test the base planner uses: a
// founded base carries a modules array, an unfounded one is absent.
const { FOUNDING_BUNDLE, MATERIAL_BUILDINGS, normalizeBase } = require("../public/base-math.js");
const DEFAULT_CAPSULES = 10;

// Client 1.2.0 feature lock (`LOCKED_LAB_BASE_BUILDINGS`): while solo and
// squadron dungeons are locked, this building is not offered on the panel at
// all -- the store carries no `nextBase` for it even though `nextBaseCost`
// still reads a price. Its product, argoflux, is a dungeon material.
const DUNGEON_LOCKED_BUILDINGS = ["Rare Material Facility"];

// The five base-tier lab buildings (client 1.2.0, wiki "Base and Dungeon
// buildings"): one product each from four raw resources, bought with
// credits on the Laboratory panel's base tab. `bought` rows carry the live
// building; the rest only the table entry. `nextBase` is the building the
// panel offers to build next (null when it offers none) and `nextBaseCost`
// its price; both are 0/null before the panel has been opened in-game (the
// store only fills then: `panelOpened`). Each row's `status` is one of
// "bought", "next" (offered, at nextBaseCost), "locked" (dungeon lock) or
// "unknown" (not bought, not offered, and not on the lock list).
function baseTierFromState(state, stocks) {
  const baseLab = state.baseLab || {};
  const live = Array.isArray(baseLab.buildings) ? baseLab.buildings : [];
  const byName = {};
  for (const b of live) if (b && b.building) byName[b.building] = b;
  const nextBase = typeof baseLab.nextBase === "string" ? baseLab.nextBase : null;
  const rows = Object.entries(MATERIAL_BUILDINGS).filter(([, info]) => info.baseTier).map(([product, info]) => {
    const b = byName[info.building] || null;
    const status = b ? "bought"
      : (nextBase === info.building ? "next"
        : (DUNGEON_LOCKED_BUILDINGS.includes(info.building) ? "locked" : "unknown"));
    const timerNow = b ? LabMath.timerAt(b.timer || 0, b.level || 0) : null;
    const inputs = (b ? [...(b.currency_use || []), ...(b.material_use || [])] : info.inputs).map(LabMath.normName);
    const perUnit = b ? (b.input || 0) : null;
    const output = b ? (b.output || 1) : 1;
    // Whole units the raw stock pays for right now (the scarcest input).
    const unitsFromStock = b && perUnit > 0
      ? Math.floor(Math.min(...inputs.map(n => (stocks[n] || 0) / perUnit))) * output
      : null;
    return {
      building: info.building, product, inputs, bought: !!b, status,
      level: b ? (b.level || 0) : null, timer: b ? (b.timer || 0) : null, timerNow,
      perUnit, output,
      unitsPerHour: timerNow ? 3600 / timerNow * output : null,
      unitsFromStock,
      stock: stocks[product] || 0,
    };
  });
  const nextBaseCost = Number(baseLab.nextBaseCost) || 0;
  return { rows, nextBase, nextBaseCost, panelOpened: live.length > 0 || nextBaseCost > 0 };
}

// Merge common + rare currencies and lab materials into one normalised
// stock map (name -> quantity).
function stocksFromState(state) {
  const stocks = {};
  for (const src of [state.commonResources || {}, state.rareCurrencies || {}]) {
    for (const [k, v] of Object.entries(src)) stocks[LabMath.normName(k)] = Number(v) || 0;
  }
  for (const m of (Array.isArray(state.materials) ? state.materials : [])) {
    if (m && m.name) stocks[LabMath.normName(m.name)] = Number(m.quantity) || 0;
  }
  return stocks;
}

function planLab(state, opts) {
  opts = opts || {};
  const capsules = Math.max(1, Math.floor(Number(opts.capsules) || DEFAULT_CAPSULES));
  // Once the base is founded the bundle is spent and the founding target is
  // moot: no founding plan, no "capsules after founding", no bundle.
  const founded = !!normalizeBase(state.base);
  const lab = state.lab;
  if (!lab || !Array.isArray(lab.buildings) || lab.buildings.length === 0) {
    return {
      available: false, founded, chain: [], stocks: {}, queueSlots: 0, queueInUse: 0, freeSlots: 0,
      capsulesDefault: capsules, capsulesInStock: 0, targets: null, foundingBundle: founded ? null : FOUNDING_BUNDLE, baseTier: null,
    };
  }
  const stocks = stocksFromState(state);
  // Base-tier buildings join the chain: they never sit on the capsule path,
  // so the capsule plan is unchanged, but the emulator can time their
  // products and their queues share the same slot pool (wiki).
  const baseTier = baseTierFromState(state, stocks);
  const baseBuildings = (state.baseLab && Array.isArray(state.baseLab.buildings)) ? state.baseLab.buildings : [];
  const allBuildings = [...lab.buildings, ...baseBuildings];
  const chain = LabMath.buildChain(allBuildings);
  const queueSlots = lab.queueSlots || 0;
  const queueInUse = Array.isArray(lab.queue) ? lab.queue.length : 0;
  const freeSlots = Math.max(0, queueSlots - queueInUse);
  const coreOpts = { freeSlots };
  const capsuleOpts = { ...coreOpts, netTopLevel: false };

  const capsuleDemand = [{ product: "warp capsule", units: capsules }];
  const capsulePlan = LabMath.planTarget(chain, capsuleDemand, stocks, capsuleOpts);

  const targets = { capsules: { product: "warp capsule", units: capsules, ...capsulePlan, afterFounding: null } };
  if (!founded) {
    // Same capsule target on the stock left after paying the founding bundle.
    const afterStocks = LabMath.stocksAfterBundle(stocks, FOUNDING_BUNDLE);
    const after = LabMath.planCore(chain, capsuleDemand, afterStocks, capsuleOpts);
    targets.capsules.afterFounding = { hoursPipelined: after.hoursPipelined, binding: after.binding };
    const foundingPlan = LabMath.planTarget(chain, FOUNDING_BUNDLE, stocks, coreOpts);
    targets.baseFounding = { product: "base founding", units: 1, ...foundingPlan };
  }

  return {
    available: true,
    founded,
    chain: allBuildings,
    baseTier,
    stocks,
    queueSlots, queueInUse, freeSlots,
    capsulesDefault: capsules,
    capsulesInStock: stocks["warp capsule"] || 0,
    targets,
    foundingBundle: founded ? null : FOUNDING_BUNDLE,
  };
}

module.exports = { planLab, stocksFromState, FOUNDING_BUNDLE, DEFAULT_CAPSULES, DUNGEON_LOCKED_BUILDINGS };
