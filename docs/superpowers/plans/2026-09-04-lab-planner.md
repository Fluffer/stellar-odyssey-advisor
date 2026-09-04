# Lab Bottleneck Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Lab" tab that tells the player which raw currency and which building limit a warp-capsule (or base-founding) target, how many hours the chain takes, and which building level or speed multiplier shortens it most.

**Architecture:** A pure, dependency-free math module `public/lab-math.js` (shared by the Node engine and the browser, same pattern as `public/pet-math.js`) expands a demand through the live building chain, nets existing stock, and computes timing, ROI and speed options. `lib/lab.js` adapts the raw game state into that module's inputs and produces the `lab` block of the analyze payload; the browser re-runs the same math when the target box changes.

**Tech Stack:** Node 22, CommonJS, `node:test` + `node:assert/strict`, vanilla JS GUI (no build step), existing helpers in `public/app.js` (`card`, `tableHtml`, `fmtC`, `esc`, `setTabCount`).

**Spec:** `docs/superpowers/specs/2026-09-04-lab-planner-design.md`

## Global Constraints

- Node 22, no npm dependencies, CommonJS in `lib/`, no build step for `public/`.
- Read-only: never send commands to the game.
- Chain data comes from the live `LaboratoryStore.buildings`; never hardcode the chain in engine code (test fixtures may).
- Names normalised once at the engine entry: lower-case, `_` → space, trimmed.
- Engine keeps floats; GUI rounds. Tests compare with tolerance (`Math.abs(a-b) < 1e-6` unless integer).
- Degraded input (no `lab`, no buildings, unknown product) returns an empty plan, never throws.
- Commit after every task with the trailer:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01F7BWggbJmjAPoPHsLPxCnP
  ```
- Run the whole suite with `node --test test/*.test.js` (the `test/` directory form does not work on this Windows setup).
- Deviation from spec, agreed: the four rare currencies (silicon, cobalt, argon, dark_matter) are read into a new `rareCurrencies` object, not merged into `commonResources` (pets code iterates that object by a fixed list).

---

## File map

| File | Responsibility |
| --- | --- |
| `public/lab-math.js` (new) | Pure math: normalisation, chain graph, demand expansion with stock netting, stage/timing, ROI, speed. Exposed as `LabMath` (module.exports + window). |
| `lib/lab.js` (new) | `planLab(state, opts)`: adapt game state (buildings, currencies, materials, slots) into `LabMath` calls; both targets; after-founding line. |
| `lib/cdp.js` (modify) | READ_ALL: add `lab` and `rareCurrencies`. |
| `advisor-core.js` (modify) | Require `lib/lab.js`, add `lab` to the analyze output, export `planLab`. |
| `public/index.html` (modify) | Lab tab button, `<script src="/lab-math.js">`. |
| `check-page.js` (modify) | Syntax-check and module-load `lab-math.js`, verify the script reference. |
| `public/app.js` (modify) | `renderLab`, target box with localStorage, tab dispatch, badge. |
| `public/style.css` (modify) | Small styles for the coverage bar and critical marker. |
| `test/lab.test.js` (new) | All engine tests. |
| `README.md` (modify) | Lab tab bullet, file table row. |

---

### Task 1: Read lab state and rare currencies (`lib/cdp.js`)

**Files:**
- Modify: `lib/cdp.js` (READ_ALL string, near the `voyager:` and `commonResources:` entries)

**Interfaces:**
- Produces on the state object:
  - `state.lab = { buildings: [{ building, level, currency_use, material_use, produce, input, output, timer }], queue: any[], queueSlots: number } | null`
  - `state.rareCurrencies = { silicon, cobalt, argon, dark_matter } | null`

- [ ] **Step 1: Add the two entries to READ_ALL**

In `lib/cdp.js`, inside the `return JSON.stringify({ ... })` object of `READ_ALL`, add after the `commonResources:` entry:

```js
    // Rare gathering currencies consumed by the lab (Circuit Integration
    // Facility, Energetic Fusion Center).
    rareCurrencies: cur ? {
      silicon: cur.silicon, cobalt: cur.cobalt, argon: cur.argon, dark_matter: cur.dark_matter,
    } : null,
```

and after the `voyager:` entry:

```js
    // Laboratory: live building chain (inputs, per-unit input amount,
    // output, base timer, level), the running queues, and the queue-slot
    // pool (4 standard, 6 premium, plus purchased extra slots).
    lab: lab ? {
      buildings: (lab.buildings || []).map(function (b) {
        return {
          building: b.building, level: b.level || 0,
          currency_use: b.currency_use || [], material_use: b.material_use || [],
          produce: b.produce || [], input: b.input, output: b.output || 1, timer: b.timer,
        };
      }),
      queue: lab.labQueue || [],
      queueSlots: ((prem && prem.active) ? 6 : 4) + ((user && user.additionalQueueSlots) || 0),
    } : null,
```

Add the store lookup next to the other `get(...)` calls at the top of READ_ALL:

```js
  const lab = get('LaboratoryStore');
```

- [ ] **Step 2: Syntax check**

Run: `node --check lib/cdp.js && node -e "require('./lib/cdp.js'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Live probe (game must be running)**

Run:
```bash
node -e "require('./lib/cdp.js').readGameState().then(s => { console.log(JSON.stringify(s.lab).slice(0, 300)); console.log(s.rareCurrencies); })"
```
Expected: 10 buildings with `input`/`timer`/`level`, `queueSlots: 10`, four rare currency numbers. If the game is not running, expected error `game not found` and skip this step.

- [ ] **Step 4: Commit**

```bash
git add lib/cdp.js
git commit -m "feat(cdp): read laboratory chain, queue slots and rare currencies"
```

---

### Task 2: Chain graph and demand expansion (`public/lab-math.js`)

**Files:**
- Create: `public/lab-math.js`
- Create: `test/lab.test.js`

**Interfaces:**
- Produces (all on the `LabMath` object):
  - `normName(s: string): string`
  - `buildChain(buildings): Chain` where `Chain = { list: Building[], byProduct: { [product]: Building } }` and `Building = { name, level, timer, input, output, product, inputs: [{ name, kind: 'currency' | 'material' }] }`
  - `expand(chain, demands: [{ product, units }], stocks: { [name]: number }): { runs: { [buildingName]: number }, gross: { [product]: number }, raw: { [name]: number } }`
    - `runs` = units each building must produce after netting stock
    - `gross` = total demand per intermediate before netting
    - `raw` = total demand per raw input (names that no building produces)
  - `stageOf(chain, product): number` (0 for raw, 1 for first-tier intermediates, ...)

- [ ] **Step 1: Write the failing tests**

Create `test/lab.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/lab.test.js`
Expected: FAIL with `Cannot find module '../public/lab-math.js'`

- [ ] **Step 3: Create `public/lab-math.js`**

```js
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
  for (const b of list) byProduct[b.product] = b;
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
    if (toProduce <= 0) return;
    const batches = Math.ceil(toProduce / b.output);
    runs[b.name] = (runs[b.name] || 0) + batches;
    for (const inp of b.inputs) need(inp.name, batches * b.input, depth + 1);
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/lab.test.js`
Expected: all tests in the two describe blocks PASS.

- [ ] **Step 5: Commit**

```bash
git add public/lab-math.js test/lab.test.js
git commit -m "feat(lab): chain graph and demand expansion with stock netting"
```

---

### Task 3: Timing, stages and the two chain estimates (`public/lab-math.js`)

**Files:**
- Modify: `public/lab-math.js`
- Modify: `test/lab.test.js`

**Interfaces:**
- Produces on `LabMath`:
  - `timerAt(baseTimer: number, level: number): number` seconds
  - `levelCost(k: number): number`
  - `levelsToFloor(baseTimer, level): number`, `costToFloor(level, n): number`
  - `planCore(chain, demands, stocks, opts): Core` where `opts = { freeSlots: number, levelOverrides?: { [buildingName]: number }, speed?: { building: string, x: number } }` and
    ```
    Core = {
      buildings: [{ name, stage, level, unitsToRun, timerNow, seconds, hours,
                    inputs: [{ name, kind, perUnit, needed, stock, short, coverage }] }],
      raw: [{ name, needed, stock, coverage, unitsSupported }],
      gross: { [product]: number },
      binding: { name, coverage } | null,
      critical: string | null,             // building name with max hours
      hoursSequential: number, hoursPipelined: number,
      freeSlots: number, ready: boolean,
    }
    ```

- [ ] **Step 1: Write the failing tests** (append to `test/lab.test.js`)

```js
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
    const stocks = { gold: 40e6, silver: 40e6, copper: 40e6, platinum: 5e6 };
    const core = LabMath.planCore(chain, [{ product: "warp capsule", units: 10 }], stocks, { freeSlots: 10 });
    const plat = core.raw.find(r => r.name === "platinum");
    near(plat.coverage, 0.25);
    assert.equal(plat.unitsSupported, 2);
    assert.equal(core.binding.name, "platinum");
    const gold = core.raw.find(r => r.name === "gold");
    near(gold.coverage, 2);
    assert.equal(gold.unitsSupported, 20);
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/lab.test.js`
Expected: the new describe block FAILS with `LabMath.timerAt is not a function`.

- [ ] **Step 3: Add timing and planCore to `public/lab-math.js`**

Insert before `const LabMath = {`:

```js
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
// analysis re-run it with one building changed.
function planCore(chain, demands, stocks, opts) {
  opts = opts || {};
  const freeSlots = Math.max(1, opts.freeSlots || 1);
  const overrides = opts.levelOverrides || {};
  const speed = opts.speed || null;
  const stockOf = {};
  for (const [k, v] of Object.entries(stocks || {})) stockOf[normName(k)] = Number(v) || 0;

  // Speed multiplies the inputs of ONE building: fold it into the expansion
  // by scaling that building's `input` before expanding.
  const chainUsed = speed ? {
    list: chain.list.map(b => b.name === speed.building
      ? { ...b, input: b.input * SPEED_INPUT_MULT[Math.min(10, Math.max(1, speed.x)) - 1] }
      : b),
    byProduct: {},
  } : chain;
  if (speed) for (const b of chainUsed.list) chainUsed.byProduct[b.product] = b;

  const ex = expand(chainUsed, demands, stockOf);

  const buildings = chainUsed.list.map(b => {
    const level = overrides[b.name] !== undefined ? overrides[b.name] : b.level;
    const unitsToRun = ex.runs[b.name] || 0;
    const timerNow = timerAt(b.timer, level);
    const div = speed && speed.building === b.name ? Math.min(10, Math.max(1, speed.x)) : 1;
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
```

And extend the export object:

```js
const LabMath = {
  SPEED_INPUT_MULT, LEVEL_COST_BASE, TIMER_FLOOR, TIMER_STEP, CLAIM_COOLDOWN_MIN,
  normName, buildChain, expand, stageOf,
  timerAt, levelCost, levelsToFloor, costToFloor, planCore,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/lab.test.js`
Expected: PASS. If `stage waves` fails, check that `hoursSequential` multiplies the stage's longest building by `ceil(count / freeSlots)`.

- [ ] **Step 5: Commit**

```bash
git add public/lab-math.js test/lab.test.js
git commit -m "feat(lab): per-building timing, stage estimates, raw coverage"
```

---

### Task 4: Upgrade ROI and speed options (`public/lab-math.js`)

**Files:**
- Modify: `public/lab-math.js`
- Modify: `test/lab.test.js`

**Interfaces:**
- Produces on `LabMath`:
  - `planTarget(chain, demands, stocks, opts): TargetPlan` = `Core` plus
    ```
    upgradeRoi: [{ name, level, nextLevelCost, hoursSaved, creditsPerHourSaved, levelsToFloor, costToFloor }]  // sorted by creditsPerHourSaved asc, nulls last
    criticalGroup: string[]   // every building within 1e-9 h of the maximum hours (empty when nothing runs)
    groupRoi: { buildings: string[], cost, hoursSaved, creditsPerHourSaved } | null   // all group members +1 level together
    speed: { buildings: string[], options: [{ x, inputMult, hours, hoursSaved, affordable, extraInputs: [{ name, extra }] }] } | null
    ```
  - `planCore` now accepts `opts.speed = { buildings: string[], x }` (the old `{ building, x }` form is still accepted as a one-element list).
    ```
    ```

- [ ] **Step 1: Write the failing tests** (append to `test/lab.test.js`)

```js
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
    near(plan.groupRoi.creditsPerHourSaved, 5 * 1150000 * 21 / (200 / 3600));
  });

  test("single critical building: Foundry on a 60 s timer is alone at the top", () => {
    const buildings = liveBuildings();
    buildings[0].timer = 60; // Foundry: 2000 x 58 s
    const plan = LabMath.planTarget(LabMath.buildChain(buildings), demands, {}, { freeSlots: 10 });
    assert.deepEqual(plan.criticalGroup, ["Foundry"]);
    assert.equal(plan.upgradeRoi[0].name, "Foundry");
    near(plan.upgradeRoi[0].hoursSaved, 200 / 3600);
    near(plan.upgradeRoi[0].creditsPerHourSaved, 1150000 * 21 / (200 / 3600));
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
    near(x2.hours, 2000 * 43 / 2 / 3600 + 2 * 10 / 60);
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/lab.test.js`
Expected: FAIL with `LabMath.planTarget is not a function`.

- [ ] **Step 3: Add planTarget to `public/lab-math.js`** (before `const LabMath = {`)

```js
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
```

Also change `planCore` so `opts.speed` accepts a LIST of buildings (keep the single-building form working):

```js
  const speedList = speed ? (Array.isArray(speed.buildings) ? speed.buildings : (speed.building ? [speed.building] : [])) : [];
  const speedX = speed ? Math.min(10, Math.max(1, speed.x)) : 1;
  const chainUsed = speedList.length ? {
    list: chain.list.map(b => speedList.includes(b.name)
      ? { ...b, input: b.input * SPEED_INPUT_MULT[speedX - 1] }
      : b),
    byProduct: {},
  } : chain;
  if (speedList.length) for (const b of chainUsed.list) if (!chainUsed.byProduct[b.product]) chainUsed.byProduct[b.product] = b;
```

and in the per-building loop replace the `div` line with `const div = speedList.includes(b.name) ? speedX : 1;`.

Add `planTarget` to the `LabMath` export object.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/lab.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/lab-math.js test/lab.test.js
git commit -m "feat(lab): upgrade ROI and speed multiplier options"
```

---

### Task 5: Engine adapter `lib/lab.js` and analyze wiring

**Files:**
- Create: `lib/lab.js`
- Modify: `advisor-core.js` (requires near line 30, analyze return near line 327, `module.exports`)
- Modify: `test/lab.test.js`

**Interfaces:**
- Consumes: `LabMath.buildChain`, `LabMath.planTarget`, `LabMath.normName`; `state.lab`, `state.commonResources`, `state.rareCurrencies`, `state.materials` (array of `{ name, quantity }`).
- Produces: `planLab(state, opts = { capsules: 10 })` returning
  ```
  {
    available: boolean,               // false when state.lab is missing
    chain: state.lab.buildings (raw, for the browser), stocks: { [name]: number },
    queueSlots, queueInUse, freeSlots,
    capsulesDefault: number,
    targets: {
      capsules: TargetPlan & { product: 'warp capsule', units, afterFounding: { hoursPipelined, binding } | null },
      baseFounding: TargetPlan & { product: 'base founding', units: 1 },
    } | null,
    foundingBundle: [{ product, units }],
  }
  ```
  and `FOUNDING_BUNDLE` constant. Exported from `advisor-core.js` as `planLab`; the analyze output gains `lab`.

- [ ] **Step 1: Write the failing tests** (append to `test/lab.test.js`)

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/lab.test.js`
Expected: FAIL with `Cannot find module '../lib/lab.js'`.

- [ ] **Step 3: Create `lib/lab.js`**

```js
// Laboratory bottleneck planner: adapts the raw game state to the shared
// chain math in public/lab-math.js and produces the `lab` block of the
// analyze payload. The browser re-runs LabMath.planTarget on the same
// `chain` + `stocks` when the capsule target box changes.
const LabMath = require("../public/lab-math.js");

// Founding a base costs 5,000 each of these (in-game wiki, Base Building).
const FOUNDING_BUNDLE = ["ingots", "refined crystals", "high end crystals", "propulsors", "nanoconductors"]
  .map(product => ({ product, units: 5000 }));
const DEFAULT_CAPSULES = 10;

// Merge common + rare currencies and lab materials into one normalised
// stock map (name -> quantity).
function stocksFromState(state) {
  const stocks = {};
  for (const src of [state.commonResources || {}, state.rareCurrencies || {}]) {
    for (const [k, v] of Object.entries(src)) stocks[LabMath.normName(k)] = Number(v) || 0;
  }
  for (const m of state.materials || []) {
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
      capsulesDefault: capsules, targets: null, foundingBundle: FOUNDING_BUNDLE,
    };
  }
  const chain = LabMath.buildChain(lab.buildings);
  const stocks = stocksFromState(state);
  const queueSlots = lab.queueSlots || 0;
  const queueInUse = Array.isArray(lab.queue) ? lab.queue.length : 0;
  const freeSlots = Math.max(1, queueSlots - queueInUse);
  const coreOpts = { freeSlots };

  const capsuleDemand = [{ product: "warp capsule", units: capsules }];
  const capsulePlan = LabMath.planTarget(chain, capsuleDemand, stocks, coreOpts);

  // Same capsule target on the stock left after paying the founding bundle.
  const afterStocks = { ...stocks };
  for (const b of FOUNDING_BUNDLE) afterStocks[b.product] = Math.max(0, (afterStocks[b.product] || 0) - b.units);
  const after = LabMath.planCore(chain, capsuleDemand, afterStocks, coreOpts);

  const foundingPlan = LabMath.planTarget(chain, FOUNDING_BUNDLE, stocks, coreOpts);

  return {
    available: true,
    chain: lab.buildings,
    stocks,
    queueSlots, queueInUse, freeSlots,
    capsulesDefault: capsules,
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
```

- [ ] **Step 4: Wire into `advisor-core.js`**

Add the require next to the other `lib/` requires:

```js
const { planLab } = require("./lib/lab.js");
```

In `analyze(s)`, after `const shipItems = planShipItems(s);` add:

```js
  const lab = planLab(s, {});
```

and add `lab,` to the returned object (the line that reads `units, tech, pets, materials, shipItems,`). Add `planLab,` to `module.exports`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/*.test.js`
Expected: all PASS (existing suites untouched).

- [ ] **Step 6: Commit**

```bash
git add lib/lab.js advisor-core.js test/lab.test.js
git commit -m "feat(lab): planLab adapter, both targets, analyze payload"
```

---

### Task 6: GUI Lab tab

**Files:**
- Modify: `public/index.html` (tab button after Materials; script tag before `/app.js`)
- Modify: `check-page.js` (add `lab-math.js` to both loops)
- Modify: `public/app.js` (new `renderLab`, target box handler, dispatch, badge)
- Modify: `public/style.css`

**Interfaces:**
- Consumes: `d.lab` from the analyze payload (shape from Task 5), `window.LabMath.planTarget`, `window.LabMath.planCore`, helpers `card`, `tableHtml`, `fmtC`, `esc`, `setTabCount`, `capTone`.
- Produces: tab `lab`, localStorage key `advisor-lab-capsules`.

- [ ] **Step 1: index.html and check-page.js**

In `public/index.html` add after the Materials button:

```html
      <button data-tab="lab" class="ghost" onclick="setTab('lab')">Lab</button>
```

and before `<script src="/app.js"></script>`:

```html
<script src="/lab-math.js"></script>
```

In `check-page.js` change `for (const f of ["app.js", "pet-math.js"])` to `for (const f of ["app.js", "pet-math.js", "lab-math.js"])`, the reference loop to `["/style.css", "/pet-math.js", "/lab-math.js", "/app.js"]`, and add a module-load check mirroring the pet-math one:

```js
try {
  const lm = require(path.join(PUBLIC_DIR, "lab-math.js"));
  if (typeof lm.planTarget !== "function") throw new Error("planTarget missing");
  console.log("  ok: lab-math.js loads as a module");
} catch (e) {
  fail("lab-math.js does not load: " + e.message);
}
```

Run: `node check-page.js`
Expected: `ok: lab-math.js loads as a module` and `index.html references /lab-math.js`.

- [ ] **Step 2: Styles** (append to `public/style.css` before the `.ctxgrid` rule)

```css
  /* lab planner */
  .covbar { display: inline-block; width: 90px; height: 6px; background: var(--panel2); border-radius: 3px; overflow: hidden; vertical-align: middle; margin-right: 6px; }
  .covbar-fill { display: block; height: 100%; border-radius: 3px; }
  .crit { color: var(--warn); font-weight: 700; }
  .lab-input { width: 90px; }
```

- [ ] **Step 3: renderLab in `public/app.js`**

Add after `renderMaterials` (before `function renderSummary`):

```js
// ---- Lab bottleneck planner ----
function labCapsuleTarget(fallback) {
  try {
    const v = parseInt(localStorage.getItem('advisor-lab-capsules') || '', 10);
    if (v > 0) return v;
  } catch (e) {}
  return fallback || 10;
}
function setLabCapsules(v) {
  const n = Math.max(1, Math.floor(Number(v) || 0));
  try { localStorage.setItem('advisor-lab-capsules', String(n)); } catch (e) {}
  if (window.lastData) render(window.lastData);
}
function fmtHours(h) {
  if (h === null || h === undefined) return '?';
  if (h < 1 / 60) return '< 1 min';
  if (h < 1) return Math.round(h * 60) + ' min';
  if (h < 48) return h.toFixed(1) + ' h';
  return (h / 24).toFixed(1) + ' d';
}
function covBar(coverage) {
  const tone = coverage >= 1 ? { color: 'var(--good)', width: 100 } : capTone(coverage * 100, 100);
  if (coverage < 1) tone.color = coverage >= 0.8 ? 'var(--warn)' : 'var(--bad)';
  return '<span class="covbar"><span class="covbar-fill" style="width:' + Math.min(100, coverage * 100).toFixed(0) + '%;background:' + tone.color + '"></span></span>';
}
function renderLab(lab) {
  if (!lab || !lab.available) return '<div class="empty-note">No laboratory buildings found in the game state.</div>';
  const LM = window.LabMath;
  const capsules = labCapsuleTarget(lab.capsulesDefault);
  const chain = LM.buildChain(lab.chain);
  const opts = { freeSlots: lab.freeSlots };
  const demand = [{ product: 'warp capsule', units: capsules }];
  const plan = LM.planTarget(chain, demand, lab.stocks, opts);
  const afterStocks = Object.assign({}, lab.stocks);
  for (const b of lab.foundingBundle) afterStocks[b.product] = Math.max(0, (afterStocks[b.product] || 0) - b.units);
  const after = LM.planCore(chain, demand, afterStocks, opts);
  const founding = lab.targets.baseFounding;

  let html = '<div class="sub">Chain from the live Laboratory: each unit consumes its building\'s input of EVERY listed resource; timer = base &minus; 0.1 s per level (floor 5 s); level k costs 1.15M &times; k credits. Queued units are not counted; stocks are treated as static. Both targets below share the same stock.</div>';

  // --- cards ---
  html += '<div class="cards">';
  html += card('Warp capsule target', '<input class="pet-input lab-input" type="number" min="1" value="' + capsules + '" onchange="setLabCapsules(this.value)"> capsules');
  html += card('Chain time (pipelined)', fmtHours(plan.hoursPipelined) +
    '<span style="font-size:11px;color:var(--dim)"> claim &amp; re-queue every 10 min &middot; sequential ' + fmtHours(plan.hoursSequential) + '</span>');
  if (plan.binding) {
    html += card('Binding resource', '<span style="color:var(--bad)">' + esc(plan.binding.name) + '</span> ' + covBar(plan.binding.coverage) +
      '<span style="font-size:11px;color:var(--dim)">' + (plan.binding.coverage * 100).toFixed(0) + '% covered</span>');
  } else {
    html += card('Resources', '<span style="color:var(--good)">all covered</span>');
  }
  html += card('Queue slots', lab.freeSlots + ' free / ' + lab.queueSlots);
  html += card('Critical building' + (plan.criticalGroup.length > 1 ? 's (tied)' : ''), plan.criticalGroup.length ? '<span class="crit">' + plan.criticalGroup.map(esc).join(', ') + '</span>' : '-');
  html += '</div>';

  // --- per building ---
  const rows = plan.buildings.filter(b => b.unitsToRun > 0);
  html += '<h2>Per building</h2><div class="sub">buildings with nothing to run are hidden; a building runs one queue, so its time is serial</div>';
  html += tableHtml('tbl-lab-buildings', rows, [
    { label: 'Building', numeric: false, getValue: r => r.name, render: r => (plan.criticalGroup.includes(r.name) ? '<span class="crit">' : '<b>') + esc(r.name) + (plan.criticalGroup.includes(r.name) ? ' &#9650;</span>' : '</b>') },
    { label: 'Stage', numeric: true, getValue: r => r.stage, render: r => String(r.stage) },
    { label: 'Units', numeric: true, getValue: r => r.unitsToRun, render: r => String(r.unitsToRun) },
    { label: 'Timer', numeric: true, getValue: r => r.timerNow, render: r => r.timerNow.toFixed(1) + ' s (lvl ' + r.level + ')' },
    { label: 'Time', numeric: true, getValue: r => r.hours, render: r => fmtHours(r.hours) },
    { label: 'Inputs needed / stock', numeric: false, getValue: r => r.inputs.length,
      render: r => r.inputs.map(i => '<span style="white-space:nowrap;' + (i.coverage < 1 && i.kind === 'currency' ? 'color:var(--bad)' : '') + '">' +
        esc(i.name) + ' ' + fmtC(i.needed) + '<span class="dimtext"> / ' + fmtC(i.stock) + '</span></span>').join(' &middot; ') },
  ]);

  // --- raw currencies ---
  html += '<h2>Raw resources</h2>';
  html += tableHtml('tbl-lab-raw', plan.raw, [
    { label: 'Resource', numeric: false, getValue: r => r.name, render: r => '<b>' + esc(r.name) + '</b>' },
    { label: 'Needed', numeric: true, getValue: r => r.needed, render: r => fmtC(r.needed) },
    { label: 'Stock', numeric: true, getValue: r => r.stock, render: r => fmtC(r.stock) },
    { label: 'Coverage', numeric: true, getValue: r => r.coverage, render: r => covBar(r.coverage) + (r.coverage * 100).toFixed(0) + '%' },
    { label: 'Capsules supported', numeric: true, getValue: r => r.unitsSupported, render: r => String(r.unitsSupported) },
  ]);

  // --- upgrade ROI ---
  html += '<h2>Upgrade ROI</h2><div class="sub">credits per hour saved on the pipelined chain time, +1 level each. Buildings tied at the top must be upgraded together: one alone saves nothing.</div><div class="list">';
  let roiIndex = 0;
  if (plan.groupRoi && plan.groupRoi.buildings.length > 1) {
    roiIndex++;
    html += '<div class="row"><span class="num">' + roiIndex + '</span><span><b>' + plan.groupRoi.buildings.map(esc).join(' + ') + '</b> (tied at the top) +1 level each: ' +
      fmtC(plan.groupRoi.cost) + (plan.groupRoi.creditsPerHourSaved !== null
        ? ' saves ' + fmtHours(plan.groupRoi.hoursSaved) + ' &mdash; <b>' + fmtC(plan.groupRoi.creditsPerHourSaved) + '</b> per hour saved'
        : ' saves nothing (next stage bounds the chain)') + '</span></div>';
  }
  const roi = plan.upgradeRoi.filter(r => r.creditsPerHourSaved !== null).slice(0, 5);
  if (!roi.length && !(plan.groupRoi && plan.groupRoi.creditsPerHourSaved !== null)) html += '<div class="row"><span>No level upgrade shortens the chain (nothing on the critical path to speed up).</span></div>';
  roi.forEach((r) => {
    roiIndex++;
    html += '<div class="row"><span class="num">' + roiIndex + '</span><span><b>' + esc(r.name) + '</b> lvl ' + r.level + ' &rarr; ' + (r.level + 1) +
      ': ' + fmtC(r.nextLevelCost) + ' saves ' + fmtHours(r.hoursSaved) + ' &mdash; <b>' + fmtC(r.creditsPerHourSaved) + '</b> per hour saved' +
      (r.levelsToFloor ? '<span class="dimtext"> &middot; ' + r.levelsToFloor + ' levels to the 5 s floor (' + fmtC(r.costToFloor) + ')</span>' : '<span class="dimtext"> &middot; at the floor</span>') +
      '</span></div>';
  });
  html += '</div>';

  // --- speed multiplier ---
  if (plan.speed) {
    const best = plan.speed.options.filter(o => o.affordable && o.hoursSaved > 0).sort((a, b) => b.hoursSaved - a.hoursSaved)[0];
    html += '<h2>Speed multiplier</h2><div class="list">';
    if (best) {
      html += '<div class="row"><span><b>' + plan.speed.buildings.map(esc).join(' + ') + '</b> at <b>x' + best.x + '</b>' + (plan.speed.buildings.length > 1 ? ' (all of them, they are tied)' : '') + ': chain ' + fmtHours(best.hours) + ' (saves ' + fmtHours(best.hoursSaved) + '), inputs &times;' + best.inputMult +
        ' &mdash; extra ' + best.extraInputs.map(e => esc(e.name) + ' ' + fmtC(e.extra)).join(', ') + '. Costs resources, not credits; compare with the level upgrades above by hours saved.</span></div>';
    } else {
      html += '<div class="row"><span>No speed multiplier on <b>' + plan.speed.buildings.map(esc).join(' + ') + '</b> is affordable from stock.</span></div>';
    }
    html += '</div>';
  }

  // --- base founding ---
  html += '<h2>Base founding</h2><div class="cards">';
  const bundleRows = lab.foundingBundle.map(b => ({ name: b.product, need: b.units, have: lab.stocks[b.product] || 0 }));
  const shortRows = bundleRows.filter(b => b.have < b.need);
  html += card('Bundle', shortRows.length ? '<span style="color:var(--warn)">' + (bundleRows.length - shortRows.length) + ' / ' + bundleRows.length + ' ready</span>' : '<span style="color:var(--good)">5 / 5 ready</span>');
  html += card('Chain time to complete', founding.ready ? '0' : fmtHours(founding.hoursPipelined));
  html += card('Capsules after founding', fmtHours(after.hoursPipelined) + (after.binding ? '<span style="font-size:11px;color:var(--bad)"> binding ' + esc(after.binding.name) + '</span>' : ''));
  html += '</div>';
  if (shortRows.length) {
    html += '<div class="list">' + shortRows.map(b => '<div class="row"><span><b>' + esc(b.name) + '</b> ' + fmtC(b.have) + ' / ' + fmtC(b.need) + '</span></div>').join('') + '</div>';
  }
  return html;
}
```

- [ ] **Step 4: Dispatch and badge**

In `render(d)`, add after the `materials` branch:

```js
  } else if (tab === 'lab') {
    html += '<h2>Lab bottleneck planner</h2>' + renderLab(d.lab);
```

Next to the other `setTabCount(...)` calls (near line 977) add:

```js
    setTabCount('lab', d.lab && d.lab.targets ? d.lab.targets.capsules.raw.filter(r => r.coverage < 1).length : 0, true);
```

- [ ] **Step 5: Verify**

Run: `node --check public/app.js && node check-page.js && node --test test/*.test.js`
Expected: all ok, all tests pass.

Then restart the server (`taskkill` the running `node advisor-server.js`, start it again with `node advisor-server.js` in the background), run `curl -s http://localhost:8787/api/analyze -o /dev/null`, open http://localhost:8787, press the Lab tab, and check:
- Cards render with the target box at 10; changing it to 50 re-renders without a new analyze and survives a page reload.
- "Per building" hides zero-unit buildings; the critical one is marked.
- Raw resources table shows coverage bars; badge on the Lab tab equals the number of red rows.
- Browser console has no errors.

- [ ] **Step 6: Commit**

```bash
git add public/index.html check-page.js public/app.js public/style.css
git commit -m "feat(lab): Lab tab with target box, chain timing, ROI and founding"
```

---

### Task 7: README

**Files:**
- Modify: `README.md` (features list after the Materials bullet; file table)

- [ ] **Step 1: Add the feature bullet** after the Materials bullet:

```markdown
- **Lab** — bottleneck planner for the Laboratory chain: set a warp-capsule target and
  see, from the live buildings and your stock, which raw resource binds (coverage bars),
  how many units each building must run and for how long, the chain time both pipelined
  (claim and re-queue every 10 minutes) and sequential, which building level buys the
  most time per credit (1.15M × level, 0.1 s per level down to the 5 s floor), the best
  affordable speed multiplier, and base-founding readiness (5,000 each of the five
  intermediates) with the capsule chain time after founding
```

- [ ] **Step 2: File table rows**

```markdown
| `lib/lab.js` | Lab planner adapter (game state → shared chain math) |
| `public/lab-math.js` | Shared laboratory chain math used by both the engine and the GUI |
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: Lab tab"
```

---

## Self-review

- Spec coverage: data (Task 1), expansion + netting (2), stages/timing/two estimates/coverage/binding/degraded (3), ROI + speed (4), both targets + after-founding + analyze wiring (5), GUI cards/tables/ROI/speed/founding/badge/localStorage (6), README (7). Normalisation at engine entry: `stocksFromState` and `buildChain` normalise; the GUI never normalises. `afterFounding` shape matches spec. `queueInUse` exposed.
- Placeholders: none. Every step has code or an exact command.
- Type consistency: `planCore` returns `hoursSequential/hoursPipelined/critical/binding/raw/buildings/gross/freeSlots/ready`; `planTarget` spreads it and adds `upgradeRoi/speed`; `planLab` spreads `planTarget` into each target and adds `product/units/afterFounding`. GUI reads exactly those names.
