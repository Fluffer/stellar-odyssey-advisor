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
// raw and accumulate in `raw`. `opts.netTopLevel` (default true) controls
// whether a demand's own product is netted against stock; when false the
// demand is treated as additional units on top of stock, though the stock
// of everything the demand needs (its inputs, at depth > 0) is still netted.
function expand(chain, demands, stocks, opts) {
  const netTopLevel = !(opts && opts.netTopLevel === false);
  const remaining = {};
  for (const [k, v] of Object.entries(stocks || {})) remaining[normName(k)] = Number(v) || 0;
  const runs = {}, gross = {}, raw = {};
  const need = (product, units, depth) => {
    if (units <= 0 || depth > 32) return;
    const b = chain.byProduct[product];
    if (!b) { raw[product] = (raw[product] || 0) + units; return; }
    gross[product] = (gross[product] || 0) + units;
    const have = (netTopLevel || depth > 0) ? (remaining[product] || 0) : 0;
    const use = Math.min(have, units);
    if (use > 0) remaining[product] = have - use;
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

function timerAt(baseTimer, level) {
  return Math.max(TIMER_FLOOR, (baseTimer || 0) - TIMER_STEP * (level || 0));
}
function levelCost(k) {
  return LEVEL_COST_BASE * k;
}
// Levels left until the timer hits the floor (0.1 s each).
function levelsToFloor(baseTimer, level) {
  const total = Math.round(((baseTimer || 0) - TIMER_FLOOR) / TIMER_STEP);
  return Math.max(0, total - (level || 0));
}
// Credits for the next n levels starting after `level`: sum 1.15M * k.
function costToFloor(level, n) {
  if (n <= 0) return 0;
  return LEVEL_COST_BASE * (n * level + (n * (n + 1)) / 2);
}

// Core plan: expansion + per-building timing + raw coverage + the two chain
// estimates. Pure; `opts.levelOverrides` / `opts.speed` let ROI and speed
// analysis re-run it with one building changed. The demanded product's own
// stock is netted unless `opts.netTopLevel === false`.
function planCore(chain, demands, stocks, opts) {
  opts = opts || {};
  const freeSlots = Math.max(1, opts.freeSlots || 1);
  const overrides = opts.levelOverrides || {};
  const speed = opts.speed || null;
  const stockOf = {};
  for (const [k, v] of Object.entries(stocks || {})) stockOf[normName(k)] = Number(v) || 0;

  // Speed multiplies the inputs of specified buildings: fold it into the expansion
  // by scaling those buildings' `input` before expanding.
  const speedList = speed ? (Array.isArray(speed.buildings) ? speed.buildings : (speed.building ? [speed.building] : [])) : [];
  const speedX = speed ? Math.min(10, Math.max(1, speed.x)) : 1;
  const chainUsed = speedList.length ? {
    list: chain.list.map(b => speedList.includes(b.name)
      ? { ...b, input: b.input * SPEED_INPUT_MULT[speedX - 1] }
      : b),
    byProduct: {},
  } : chain;
  if (speedList.length) for (const b of chainUsed.list) if (!chainUsed.byProduct[b.product]) chainUsed.byProduct[b.product] = b;

  const ex = expand(chainUsed, demands, stockOf, { netTopLevel: opts.netTopLevel !== false });

  const buildings = chainUsed.list.map(b => {
    const level = overrides[b.name] !== undefined ? overrides[b.name] : b.level;
    const unitsToRun = ex.runs[b.name] || 0;
    const timerNow = timerAt(b.timer, level);
    const div = speedList.includes(b.name) ? speedX : 1;
    const seconds = unitsToRun * timerNow / div;
    const inputs = b.inputs.map(inp => {
      const needed = unitsToRun * b.input;
      const stock = stockOf[inp.name] || 0;
      return {
        name: inp.name, kind: inp.kind, perUnit: b.input, needed, stock,
        short: Math.max(0, needed - stock),
        coverage: needed > 0 ? stock / needed : 1,
      };
    });
    return {
      name: b.name, stage: stageOf(chainUsed, b.product), level, unitsToRun, timerNow,
      seconds, hours: seconds / 3600, inputs,
    };
  });

  const raw = Object.entries(ex.raw).map(([name, needed]) => {
    const stock = stockOf[name] || 0;
    const coverage = needed > 0 ? stock / needed : 1;
    const units = (demands || []).reduce((s, d) => s + (Number(d.units) || 0), 0);
    return { name, needed, stock, coverage, unitsSupported: needed > 0 ? Math.floor(coverage * units) : units };
  }).sort((a, b) => a.coverage - b.coverage);

  const shortRaw = raw.filter(r => r.coverage < 1);
  const binding = shortRaw.length ? { name: shortRaw[0].name, coverage: shortRaw[0].coverage } : null;

  // Stages: max within a stage (parallel queues), waves when the stage has
  // more buildings than free slots.
  const stageMap = {};
  for (const b of buildings) {
    if (b.unitsToRun <= 0) continue;
    (stageMap[b.stage] = stageMap[b.stage] || []).push(b);
  }
  let hoursSequential = 0;
  for (const list of Object.values(stageMap)) {
    const longest = Math.max(...list.map(b => b.hours));
    hoursSequential += longest * Math.ceil(list.length / freeSlots);
  }
  let critical = null, maxHours = 0, maxStage = 0;
  for (const b of buildings) {
    if (b.unitsToRun > 0) maxStage = Math.max(maxStage, b.stage);
    if (b.hours > maxHours) { maxHours = b.hours; critical = b.name; }
  }
  const critStage = critical ? buildings.find(b => b.name === critical).stage : 0;
  const hoursPipelined = critical ? maxHours + Math.max(0, maxStage - critStage) * (CLAIM_COOLDOWN_MIN / 60) : 0;

  return {
    buildings, raw, gross: ex.gross, binding, critical,
    hoursSequential, hoursPipelined, freeSlots,
    ready: buildings.length > 0 && shortRaw.length === 0,
  };
}

// Full target plan: core + upgrade ROI (per building, +1 level, full
// recompute) + the critical GROUP (every building tied at the maximum
// hours: upgrading one of them alone saves nothing, so the group row is
// the honest answer) + speed options for the group (full recompute so a
// shifted bottleneck is reflected).
const TIE_EPS = 1e-9;
function planTarget(chain, demands, stocks, opts) {
  opts = opts || {};
  const base = planCore(chain, demands, stocks, opts);
  const running = base.buildings.filter(b => b.unitsToRun > 0);
  const maxHours = running.reduce((m, b) => Math.max(m, b.hours), 0);
  const criticalGroup = base.critical ? running.filter(b => b.hours >= maxHours - TIE_EPS).map(b => b.name) : [];

  const overridesPlus = (names) => {
    const o = { ...(opts.levelOverrides || {}) };
    for (const n of names) {
      const b = base.buildings.find(x => x.name === n);
      o[n] = (b ? b.level : 0) + 1;
    }
    return o;
  };

  const upgradeRoi = running
    .map(b => {
      const src = chain.list.find(x => x.name === b.name);
      const up = planCore(chain, demands, stocks, { ...opts, levelOverrides: overridesPlus([b.name]) });
      const hoursSaved = Math.max(0, base.hoursPipelined - up.hoursPipelined);
      const nextLevelCost = levelCost(b.level + 1);
      const ltf = levelsToFloor(src ? src.timer : 0, b.level);
      return {
        name: b.name, level: b.level, nextLevelCost,
        hoursSaved: hoursSaved < TIE_EPS ? 0 : hoursSaved,
        creditsPerHourSaved: hoursSaved > TIE_EPS ? nextLevelCost / hoursSaved : null,
        levelsToFloor: ltf, costToFloor: costToFloor(b.level, ltf),
      };
    })
    .sort((a, b) => {
      if (a.creditsPerHourSaved === null && b.creditsPerHourSaved === null) return 0;
      if (a.creditsPerHourSaved === null) return 1;
      if (b.creditsPerHourSaved === null) return -1;
      return a.creditsPerHourSaved - b.creditsPerHourSaved;
    });

  let groupRoi = null;
  if (criticalGroup.length) {
    const up = planCore(chain, demands, stocks, { ...opts, levelOverrides: overridesPlus(criticalGroup) });
    const cost = criticalGroup.reduce((s, n) => s + levelCost(base.buildings.find(x => x.name === n).level + 1), 0);
    const hoursSaved = Math.max(0, base.hoursPipelined - up.hoursPipelined);
    groupRoi = {
      buildings: criticalGroup, cost,
      hoursSaved: hoursSaved < TIE_EPS ? 0 : hoursSaved,
      creditsPerHourSaved: hoursSaved > TIE_EPS ? cost / hoursSaved : null,
    };
  }

  let speed = null;
  if (criticalGroup.length) {
    const options = [];
    for (let x = 2; x <= 10; x++) {
      const fast = planCore(chain, demands, stocks, { ...opts, speed: { buildings: criticalGroup, x } });
      const extra = {};
      let affordable = true;
      for (const name of criticalGroup) {
        const before = base.buildings.find(b => b.name === name);
        const after = fast.buildings.find(b => b.name === name);
        for (const inp of after.inputs) {
          const was = before.inputs.find(i => i.name === inp.name);
          extra[inp.name] = (extra[inp.name] || 0) + inp.needed - (was ? was.needed : 0);
          if (inp.coverage < 1) affordable = false;
        }
      }
      options.push({
        x, inputMult: SPEED_INPUT_MULT[x - 1], hours: fast.hoursPipelined,
        hoursSaved: Math.max(0, base.hoursPipelined - fast.hoursPipelined),
        affordable,
        extraInputs: Object.entries(extra).map(([name, e]) => ({ name, extra: e })),
      });
    }
    speed = { buildings: criticalGroup, options };
  }

  return { ...base, upgradeRoi, criticalGroup, groupRoi, speed };
}

const LabMath = {
  SPEED_INPUT_MULT, LEVEL_COST_BASE, TIMER_FLOOR, TIMER_STEP, CLAIM_COOLDOWN_MIN,
  normName, buildChain, expand, stageOf,
  timerAt, levelCost, levelsToFloor, costToFloor, planCore, planTarget,
};
if (typeof module !== "undefined" && module.exports) module.exports = LabMath;
if (typeof window !== "undefined") window.LabMath = LabMath;
