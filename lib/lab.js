// Laboratory bottleneck planner: adapts the raw game state to the shared
// chain math in public/lab-math.js and produces the `lab` block of the
// analyze payload. The browser re-runs LabMath.planTarget on the same
// `chain` + `stocks` when the capsule target box changes.
const LabMath = require("../public/lab-math.js");

// Founding a base costs 5,000 each of these (in-game wiki, Base Building).
// Shared with the base planner so there is exactly one definition.
const { FOUNDING_BUNDLE } = require("../public/base-math.js");
const DEFAULT_CAPSULES = 10;

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
  const lab = state.lab;
  if (!lab || !Array.isArray(lab.buildings) || lab.buildings.length === 0) {
    return {
      available: false, chain: [], stocks: {}, queueSlots: 0, queueInUse: 0, freeSlots: 0,
      capsulesDefault: capsules, capsulesInStock: 0, targets: null, foundingBundle: FOUNDING_BUNDLE,
    };
  }
  const chain = LabMath.buildChain(lab.buildings);
  const stocks = stocksFromState(state);
  const queueSlots = lab.queueSlots || 0;
  const queueInUse = Array.isArray(lab.queue) ? lab.queue.length : 0;
  const freeSlots = Math.max(0, queueSlots - queueInUse);
  const coreOpts = { freeSlots };
  const capsuleOpts = { ...coreOpts, netTopLevel: false };

  const capsuleDemand = [{ product: "warp capsule", units: capsules }];
  const capsulePlan = LabMath.planTarget(chain, capsuleDemand, stocks, capsuleOpts);

  // Same capsule target on the stock left after paying the founding bundle.
  const afterStocks = LabMath.stocksAfterBundle(stocks, FOUNDING_BUNDLE);
  const after = LabMath.planCore(chain, capsuleDemand, afterStocks, capsuleOpts);

  const foundingPlan = LabMath.planTarget(chain, FOUNDING_BUNDLE, stocks, coreOpts);

  return {
    available: true,
    chain: lab.buildings,
    stocks,
    queueSlots, queueInUse, freeSlots,
    capsulesDefault: capsules,
    capsulesInStock: stocks["warp capsule"] || 0,
    targets: {
      capsules: {
        product: "warp capsule", units: capsules, ...capsulePlan,
        afterFounding: { hoursPipelined: after.hoursPipelined, binding: after.binding },
      },
      baseFounding: { product: "base founding", units: 1, ...foundingPlan },
    },
    foundingBundle: FOUNDING_BUNDLE,
  };
}

module.exports = { planLab, stocksFromState, FOUNDING_BUNDLE, DEFAULT_CAPSULES };
