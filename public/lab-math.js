// Shared laboratory chain math. Loaded by lib/lab.js (engine, via require)
// and by the GUI's app.js (via a <script> tag, as window.LabMath) so the
// planner runs the same code on the server and in the browser.
//
// Game rules (in-game wiki text, client bundle):
//   - A building consumes `input` units of EACH listed input per produced
//     unit and yields `output` units.
//   - Timer per unit = max(5, timer - 0.1 * level) seconds.
//   - Level k costs 1,150,000 * k credits.
//   - Speed multiplier x2..x10 divides the time and multiplies EVERY input
//     of that queue by SPEED_INPUT_MULT[x - 1].
//   - One queue per building (serial); the slot pool is global.
//   - Inputs are consumed at queue time; production keeps running while
//     unclaimed; Claim has a 10-minute cooldown per queue.
const SPEED_INPUT_MULT = [1, 2.6, 4.5, 7, 10.5, 15.4, 22.7, 33.8, 50.9, 77.7];
const LEVEL_COST_BASE = 1150000;
const TIMER_FLOOR = 5;
const TIMER_STEP = 0.1;
const CLAIM_COOLDOWN_MIN = 10;

function normName(s) {
  return String(s == null ? "" : s).toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

// Live LaboratoryStore.buildings -> chain graph. A building produces ONE
// product (produce[0]); inputs keep their kind so the GUI can label them.
function buildChain(buildings) {
  const list = (buildings || []).map(b => ({
    name: b.building,
    level: b.level || 0,
    timer: b.timer || 0,
    input: b.input || 0,
    output: b.output || 1,
    product: normName((b.produce || [])[0]),
    inputs: [
      ...(b.currency_use || []).map(n => ({ name: normName(n), kind: "currency" })),
      ...(b.material_use || []).map(n => ({ name: normName(n), kind: "material" })),
    ],
  })).filter(b => b.name && b.product);
  const byProduct = {};
  // Keep the first building for each product; duplicates are ignored
  for (const b of list) if (!byProduct[b.product]) byProduct[b.product] = b;
  return { list, byProduct };
}

// Expand demands through the chain. Existing stock of an intermediate is
// consumed first (once - `remaining` is mutated as we go); the shortfall is
// produced and its inputs demanded in turn. Names no building produces are
// raw and accumulate in `raw`.
function expand(chain, demands, stocks) {
  const remaining = {};
  for (const [k, v] of Object.entries(stocks || {})) remaining[normName(k)] = Number(v) || 0;
  const runs = {}, gross = {}, raw = {};
  const need = (product, units, depth) => {
    if (units <= 0 || depth > 32) return;
    const b = chain.byProduct[product];
    if (!b) { raw[product] = (raw[product] || 0) + units; return; }
    gross[product] = (gross[product] || 0) + units;
    const have = remaining[product] || 0;
    const use = Math.min(have, units);
    remaining[product] = have - use;
    const toProduce = units - use;
    const batches = Math.ceil(Math.max(0, toProduce) / b.output);
    runs[b.name] = (runs[b.name] || 0) + batches;
    if (batches > 0) {
      for (const inp of b.inputs) need(inp.name, batches * b.input, depth + 1);
    }
  };
  for (const d of demands || []) need(normName(d.product), Number(d.units) || 0, 0);
  return { runs, gross, raw };
}

// Longest path from a product down to raw inputs.
function stageOf(chain, product, depth) {
  const b = chain.byProduct[normName(product)];
  if (!b || (depth || 0) > 32) return 0;
  let deepest = 0;
  for (const inp of b.inputs) deepest = Math.max(deepest, stageOf(chain, inp.name, (depth || 0) + 1));
  return deepest + 1;
}

const LabMath = {
  SPEED_INPUT_MULT, LEVEL_COST_BASE, TIMER_FLOOR, TIMER_STEP, CLAIM_COOLDOWN_MIN,
  normName, buildChain, expand, stageOf,
};
if (typeof module !== "undefined" && module.exports) module.exports = LabMath;
if (typeof window !== "undefined") window.LabMath = LabMath;
