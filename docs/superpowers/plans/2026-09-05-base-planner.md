# Base Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Base" tab that, before base building unlocks, tells the player what materials to stockpile, what the stellarium timeline looks like, what upkeep will cost and where to found; and, once a base exists, becomes the live upgrade advisor.

**Architecture:** `public/base-math.js` is a pure shared module (like `lab-math.js`) holding the module table, the extracted cost curves, and `planBase(input)`; it reuses `LabMath.planTarget` for material production times. `lib/base.js` builds the `input` from game state (and normalises a live base) and produces the `base` block of the analyze payload; the browser re-runs `BaseMath.planBase` on the same input when level boxes or the star selector change.

**Tech Stack:** Node 22, CommonJS, `node:test` + `node:assert/strict`, vanilla JS GUI (no build step), helpers in `public/app.js` (`card`, `tableHtml`, `fmtC`, `esc`, `setTabCount`, `fmtHours`, `covBar`).

**Spec:** `docs/superpowers/specs/2026-09-05-base-planner-design.md`

## Global Constraints

- Node 22, no npm dependencies, CommonJS in `lib/`, no build step for `public/`. Read-only tool.
- Formulas are the client's (`getBaseModuleLevelUpgradeCost`, `getStellariumCost`, `getModuleResource`, `BaseModuleCard` upkeep), copied exactly; goldens are the source of truth. Provenance: client 1.1.1, bundle `index-BiPcVSdi.js`.
- Level cost is charged from EACH of a module's materials. Unlock cost with N unlocked = Σ_{n=1..N} step(n); modules 2..11 total 220.
- Upkeep per tick = `floor(avgDaily / 24 / 2 / 9 / passiveCount / 2) × (1 + boost/100) × (1 − pvp/100) × (1 − reduction/100)`; per day × 144; quests = separate coverage line (15% each, max 5).
- Stellarium per production is an ESTIMATE (`rate × (1 + boost/100)` every 5 h) and every derived number carries `estimate: true`.
- Unbought base buildings are never estimated: exact totals only, "buy <building> first".
- Engine keeps floats; GUI rounds; every game string through `esc()`; degraded input never throws.
- Commit after every task; trailer:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01F7BWggbJmjAPoPHsLPxCnP
  ```
- Run the suite with `node --test test/*.test.js` (exact glob). GUI checks: `node --check public/app.js && node check-page.js`.
- Do not leave scratch files in the repo root (use `C:\Users\peter\AppData\Local\Temp`).

---

## File map

| File | Responsibility |
| --- | --- |
| `lib/cdp.js` (modify) | READ_ALL: `base`, `baseLab`, `account`, `currentSystem`, `bookmarks`, `gameVersion`. |
| `public/base-math.js` (new) | MODULES table, star/body tables, cost curves, boost/output, upkeep, unlock plan, materials, `normalizeBase`, `planBase(input)`. Exposed as `BaseMath`. |
| `lib/base.js` (new) | `buildBaseInput(state, opts)`, `planBaseFromState(state, opts)`: state → input → payload (`phase`, `provenance`, `input`, `plan`, `live`). |
| `advisor-core.js` (modify) | require, `base` in analyze output, export. |
| `public/index.html`, `check-page.js`, `advisor-server.js` (modify) | tab button, script tag, checker, static whitelist. |
| `public/app.js`, `public/style.css` (modify) | `renderBase`, level boxes + star selector with localStorage, badge. |
| `test/base.test.js` (new) | All engine tests. |
| `README.md` (modify) | Base tab bullet, file table rows. |

---

### Task 1: Read base-related state (`lib/cdp.js`)

**Files:**
- Modify: `lib/cdp.js` (READ_ALL)

**Interfaces:**
- Produces on the state object:
  - `state.base` = raw `BaseBuildingStore.base` (null until founded)
  - `state.baseLab = { buildings: [], nextBaseCost, nextBuildingCost }`
  - `state.account = { registered, lifetimeCredits }`
  - `state.currentSystem = { name, star, bodies: string[] } | null`
  - `state.bookmarks = [{ name, star, bodies: string[] }]`
  - `state.gameVersion = string | null`

- [ ] **Step 1: Add store lookups and entries**

Next to the other `get(...)` lines in READ_ALL add:

```js
  const baseS = get('BaseBuildingStore');
  const gameS = get('GameStore');
```

Inside the returned object add (after the `lab:` entry):

```js
    // Base building (null until a base is founded) and the base-tier lab
    // buildings (Aeroforge etc.; the list and nextBaseCost only populate
    // after the in-game Laboratory panel has been opened once).
    base: baseS && baseS.base ? baseS.base : null,
    baseLab: {
      buildings: (lab && Array.isArray(lab.base)) ? lab.base.map(function (b) {
        return {
          building: b.building, level: b.level || 0,
          currency_use: b.currency_use || [], material_use: b.material_use || [],
          produce: b.produce || [], input: b.input, output: b.output || 1, timer: b.timer,
        };
      }) : [],
      nextBaseCost: lab ? (lab.nextBaseCost || 0) : 0,
      nextBuildingCost: lab ? (lab.nextBuildingCost || 0) : 0,
    },
    // Lifetime credits earned + registration time: the base upkeep formula
    // divides one by the other.
    account: {
      registered: user ? (user.registered || 0) : 0,
      lifetimeCredits: (p && p.statistics && p.statistics.credits && p.statistics.credits.$numberDecimal !== undefined)
        ? Number(p.statistics.credits.$numberDecimal) : ((p && p.statistics && typeof p.statistics.credits === 'number') ? p.statistics.credits : 0),
    },
    currentSystem: (exploreS && exploreS.currentSystem) ? {
      name: exploreS.currentSystem.name, star: exploreS.currentSystem.star,
      bodies: (exploreS.currentSystem.bodies || []).map(function (b) { return b.type; }),
    } : null,
    bookmarks: (exploreS && Array.isArray(exploreS.bookmarks)) ? exploreS.bookmarks
      .filter(function (b) { return b && b.system; })
      .map(function (b) {
        return { name: b.system.name, star: b.system.star, bodies: (b.system.bodies || []).map(function (x) { return x.type; }) };
      }) : [],
    gameVersion: gameS ? (gameS.patchVersion || null) : null,
```

- [ ] **Step 2: Check and probe**

Run: `node --check lib/cdp.js && node -e "require('./lib/cdp.js').readGameState().then(s => console.log(JSON.stringify({ base: s.base, baseLab: s.baseLab, account: s.account, cur: s.currentSystem, bm: s.bookmarks.length, v: s.gameVersion })))"`
Expected (game running): `base: null`, `baseLab.buildings: []`, `account.registered` ≈ 1786174949, `lifetimeCredits` > 5e9, `cur.star` a star type, `bm` ≥ 1, `v: "1.1.1"`. If the game is not running: `game not found`, skip.

- [ ] **Step 3: Full suite, commit**

Run: `node --test test/*.test.js` → all pass.

```bash
git add lib/cdp.js
git commit -m "feat(cdp): read base, base-tier lab buildings, account and location data"
```

---

### Task 2: Tables and cost curves (`public/base-math.js`)

**Files:**
- Create: `public/base-math.js`
- Create: `test/base.test.js`

**Interfaces (all on `BaseMath`):**
- `MODULES: [{ name, type: 'passive'|'active', setup: boolean, needs: string[], materials: string[], halfLevel: boolean, baseAmount: number }]` (11 entries, in the spec's numbered order)
- `MATERIAL_BUILDINGS: { [material]: { building, inputs: string[], baseTier: boolean } }`
- `STAR_BONUSES: { [starName]: { rate, efficiency, rare } }`, `BODY_BONUSES: { [bodyType]: activity }`, `FOUNDING_BUNDLE`, `ESTIMATES`, `PROVENANCE`
- `levelCostCumulative(L)`, `levelCost(L)`, `levelsCost(from, to)`
- `stellariumStep(n)`, `unlockCost(N)`, `tierCost(t)`, `tiersCost(from, to)`
- `moduleBoost(mod, efficiencyBoost)`, `expectedOutputPerTick(mod, efficiencyBoost)`
- `unlockOrder(): string[]`
- `avgDailyIncome(lifetimeCredits, registeredSec, nowSec)`, `upkeepPerTick(avgDaily, passiveCount, boost, pvp, reduction)`, `questsCoverage(n)`
- `stellariumPerDay(rate, boost)`

- [ ] **Step 1: Write the failing tests**

Create `test/base.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/base.test.js`
Expected: FAIL with `Cannot find module '../public/base-math.js'`.

- [ ] **Step 3: Create `public/base-math.js`**

```js
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
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/base.test.js` → PASS. If `levelCost(601)` is not 1202, re-check the cumulative function against the spec (`f(601) = 180300 + (t(601) − t(600)) × 2 = 180300 + 1202`).

- [ ] **Step 5: Commit**

```bash
git add public/base-math.js test/base.test.js
git commit -m "feat(base): module table, level and stellarium cost curves, boost and upkeep math"
```

---

### Task 3: Planning core (`public/base-math.js`: `normalizeBase`, `planBase`)

**Files:**
- Modify: `public/base-math.js`
- Modify: `test/base.test.js`

**Interfaces (added to `BaseMath`):**
- `normalizeBase(raw) → { name, stellarium, nextStellariumTick, modules: [{ name, type, setup, needs, materials, halfLevel, baseAmount, unlocked, level, tier, active, _id }] } | null`
- `defaultModules() → modules` (table entries with `unlocked:false, level:0, tier:0, active:false`)
- `planUnlocks(modules, starRate, minerBoost) → [{ name, unlocked, cost, cumulative, daysToUnlock, estimate: true }]`
- `materialsFor(targets, modules) → { perModule: [{ name, from, to, perMaterial, materials }], perMaterial: { [material]: { needed, modules: string[] } } }`
- `planBase(input) → Plan`, with
  ```
  input = {
    modules,            // normalised live modules or defaultModules()
    founded: boolean,
    stellarium: number, // held (live) else 0
    levels: { [moduleName]: targetLevel },   // default 50 for every module
    starRate: number, starName: string,
    stocks: { [name]: qty },               // normalised, from LabMath stocksFromState
    chainBuildings: [],                     // live warp buildings + bought base-tier buildings (raw LaboratoryStore shape)
    freeSlots: number,
    avgDaily: number, efficiencyBoost: number, upkeepReduction: number, pvpBaseBoost: number, questsClaimed: number,
  }
  Plan = {
    unlocks: [...planUnlocks],  totalStellariumLeft, daysToAllUnlocks (estimate),
    stellariumPerDay (estimate),
    targets: [{ name, type, from, to, materials, perMaterial, boostAtTarget, outputAtTarget, upkeepPerHourAtTarget }],
    stockpile: [{ material, needed, stock, short, modules, building, baseTier, bought, inputs, hoursPipelined|null, binding|null }],
    buyFirst: string[],
    upkeep: { passiveCount, perTick, perHour, perDay, coverage, netPerDay, shareOfIncome },
  }
  ```

- [ ] **Step 1: Write the failing tests** (append to `test/base.test.js`)

```js
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
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/base.test.js` → the new blocks FAIL (`BM.normalizeBase is not a function`).

- [ ] **Step 3: Add the planning core to `public/base-math.js`** (before `const BaseMath = {`)

```js
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
  const buyFirst = stockpile.filter(s => !s.bought && s.baseTier && s.needed > 0).map(s => s.building)
    .filter((v, i, arr) => arr.indexOf(v) === i);

  return {
    unlocks, totalStellariumLeft, stellariumPerDay: perDay,
    daysToAllUnlocks: perDay > 0 ? totalStellariumLeft / perDay : Infinity,
    targets, stockpile, buyFirst, upkeep,
  };
}
```

Add `defaultModules, normalizeBase, planUnlocks, materialsFor, planBase` to the `BaseMath` export object.

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/base.test.js` → PASS. Check the `fusion cells` binding test: 2,225 fusion cells need 2.225M argon against 640k → argon coverage 0.29 (lowest) → binding argon.

- [ ] **Step 5: Commit**

```bash
git add public/base-math.js test/base.test.js
git commit -m "feat(base): normaliser, unlock plan, material totals and planBase"
```

---

### Task 4: Adapter `lib/base.js` and analyze wiring

**Files:**
- Create: `lib/base.js`
- Modify: `advisor-core.js`, `test/base.test.js`

**Interfaces:**
- `buildBaseInput(state, opts) → input` (shape from Task 3) using `stocksFromState` from `lib/lab.js`, `statTotalsByContext` from `lib/installs.js` for `base_upkeep_reduction`, `state.dailyQuests` absent → `questsClaimed: 0`.
- `planBaseFromState(state, opts) → { phase: 'pre'|'live', provenance: { client, bundle, live, drift }, founding: { bundle: [{ product, units, have }], ready }, location: { current: { name, star, rate, rare }, bookmarks: [{ name, star, rate }], best: { name, star, rate } | null, chosen: { name, star, rate }, bodies: [{ type, activity }] }, input, plan, live: { name, stellarium, nextStellariumTick, modules: [{ name, unlocked, level, tier, active, boost, output, nextLevelCost, nextTierCost }] , nextUnlock: { name, cost, etaDays } | null } | null, labPanelHint: boolean }`
- `advisor-core.js`: `base` in the analyze output; `planBaseFromState` exported as `planBase`.

- [ ] **Step 1: Write the failing tests** (append to `test/base.test.js`)

```js
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
    gameVersion: "1.1.1",
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
    assert.deepEqual(b.location.bodies.map(x => x.activity), ["exploring", "crafting"]);
    assert.equal(b.input.avgDaily, 200000000);
    assert.equal(b.plan.upkeep.passiveCount, 9);
    assert.ok(b.plan.stockpile.find(s => s.material === "microcircuits").bought);
    assert.deepEqual(b.plan.buyFirst, ["Aeroforge", "Cryovault", "Ferric Mill", "Prism Nexus"]);
    assert.equal(b.live, null);
    assert.equal(b.labPanelHint, true, "base-tier list empty and nextBaseCost 0 -> panel never opened");
    assert.equal(b.provenance.live, "1.1.1"); assert.equal(b.provenance.drift, false);
  });

  test("opts.star chooses the ETA star; opts.levels override targets", () => {
    const b = planBaseFromState(liveState(), { star: "Black Hole", levels: { "Stellarium miner": 100 }, now: 1786174949 + 27 * 86400 });
    assert.equal(b.location.chosen.rate, 8);
    assert.equal(b.plan.targets.find(t => t.name === "Stellarium miner").to, 100);
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

  test("degraded: missing account, currentSystem, bookmarks, lab -> no throw", () => {
    const b = planBaseFromState({ materials: [] }, {});
    assert.equal(b.phase, "pre");
    assert.equal(b.founding.ready, false);
    assert.equal(b.location.current.star, null);
    assert.equal(b.input.avgDaily, 0);
    assert.ok(Array.isArray(b.plan.stockpile));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/base.test.js` → FAIL with `Cannot find module '../lib/base.js'`.

- [ ] **Step 3: Create `lib/base.js`**

```js
// Base planner adapter: turns raw game state into BaseMath.planBase input
// and the `base` block of the analyze payload. The browser re-runs
// BaseMath.planBase on `input` when level boxes or the star selector change.
const BaseMath = require("../public/base-math.js");
const LabMath = require("../public/lab-math.js");
const { stocksFromState } = require("./lab.js");
const { statTotalsByContext } = require("./installs.js");

function starInfo(name) {
  const s = BaseMath.STAR_BONUSES[name];
  return s ? { star: name, rate: s.rate, efficiency: s.efficiency, rare: s.rare } : { star: name || null, rate: 0, efficiency: 0, rare: false };
}

function buildBaseInput(state, opts) {
  opts = opts || {};
  const live = BaseMath.normalizeBase(state.base);
  const modules = live ? live.modules : BaseMath.defaultModules();
  const account = state.account || {};
  const now = opts.now || Math.floor(Date.now() / 1000);
  const avgDaily = BaseMath.avgDailyIncome(account.lifetimeCredits, account.registered, now);
  let upkeepReduction = 0;
  try {
    const totals = state.ship ? statTotalsByContext(state.ship) : {};
    upkeepReduction = (totals.default || {}).base_upkeep_reduction || 0;
  } catch (e) { upkeepReduction = 0; }
  if (live && live.upkeepReduction) upkeepReduction = live.upkeepReduction;
  const chainBuildings = [
    ...((state.lab && Array.isArray(state.lab.buildings)) ? state.lab.buildings : []),
    ...((state.baseLab && Array.isArray(state.baseLab.buildings)) ? state.baseLab.buildings : []),
  ];
  const queueSlots = state.lab ? (state.lab.queueSlots || 0) : 0;
  const queueInUse = state.lab && Array.isArray(state.lab.queue) ? state.lab.queue.length : 0;
  const cur = state.currentSystem || {};
  const chosenStar = opts.star || cur.star || null;
  return {
    modules, founded: !!live, stellarium: live ? live.stellarium : 0,
    levels: opts.levels || {},
    starName: chosenStar, starRate: starInfo(chosenStar).rate,
    stocks: stocksFromState(state),
    chainBuildings, freeSlots: Math.max(0, queueSlots - queueInUse),
    avgDaily, efficiencyBoost: (state.player && state.player.skills && state.player.skills.base_module_efficiency_boost) || 0,
    upkeepReduction, pvpBaseBoost: 0, questsClaimed: Number(opts.questsClaimed) || 0,
  };
}

function planBaseFromState(state, opts) {
  opts = opts || {};
  const live = BaseMath.normalizeBase(state.base);
  const input = buildBaseInput(state, opts);
  const plan = BaseMath.planBase(input);

  const stocks = input.stocks;
  const bundle = BaseMath.FOUNDING_BUNDLE.map(b => ({ product: b.product, units: b.units, have: stocks[b.product] || 0 }));
  const founding = { bundle, ready: bundle.every(b => b.have >= b.units) };

  const cur = state.currentSystem || {};
  const current = { name: cur.name || null, ...starInfo(cur.star) };
  const bookmarks = (state.bookmarks || []).map(b => ({ name: b.name || null, ...starInfo(b.star) }));
  const candidates = [current, ...bookmarks].filter(c => c.rate > 0);
  const best = candidates.length ? candidates.reduce((a, b) => (b.rate > a.rate ? b : a)) : null;
  const chosen = { name: input.starName === cur.star ? current.name : null, ...starInfo(input.starName) };
  const bodies = (cur.bodies || []).map(type => ({ type, activity: BaseMath.BODY_BONUSES[type] || null }));
  const location = { current, bookmarks, best, chosen, bodies };

  let liveBlock = null;
  if (live) {
    const eff = input.efficiencyBoost;
    const modules = live.modules.map(m => ({
      name: m.name, unlocked: m.unlocked, level: m.level, tier: m.tier, active: m.active,
      boost: BaseMath.moduleBoost(m, eff), output: BaseMath.expectedOutputPerTick(m, eff),
      nextLevelCost: BaseMath.levelCost(m.level + 1), nextTierCost: BaseMath.tierCost(m.tier), materials: m.materials,
    }));
    const next = plan.unlocks.find(u => !u.unlocked) || null;
    const perDay = plan.stellariumPerDay;
    liveBlock = {
      name: live.name, stellarium: live.stellarium, nextStellariumTick: live.nextStellariumTick, modules,
      nextUnlock: next ? { name: next.name, cost: next.cost, etaDays: next.cost <= live.stellarium ? 0 : (perDay > 0 ? (next.cost - live.stellarium) / perDay : Infinity), estimate: true } : null,
    };
  }

  const baseLab = state.baseLab || {};
  const labPanelHint = !(Array.isArray(baseLab.buildings) && baseLab.buildings.length) && !(baseLab.nextBaseCost > 0);
  const liveVersion = state.gameVersion || null;
  return {
    phase: live ? "live" : "pre",
    provenance: { client: BaseMath.PROVENANCE.client, bundle: BaseMath.PROVENANCE.bundle, live: liveVersion, drift: !!(liveVersion && liveVersion !== BaseMath.PROVENANCE.client) },
    founding, location, input, plan, live: liveBlock, labPanelHint,
  };
}

module.exports = { buildBaseInput, planBaseFromState };
```

- [ ] **Step 4: Wire `advisor-core.js`**

Add next to the other lib requires: `const { planBaseFromState } = require("./lib/base.js");`
In `analyze(s)` after `const lab = planLab(s, {});` add `const base = planBaseFromState(s, {});` and add `base,` to the returned object. Add `planBase: planBaseFromState,` to `module.exports`.

- [ ] **Step 5: Run and commit**

Run: `node --test test/*.test.js` → all pass.

```bash
git add lib/base.js advisor-core.js test/base.test.js
git commit -m "feat(base): state adapter, founding and location advice, analyze payload"
```

---

### Task 5: GUI "Base" tab and README

**Files:**
- Modify: `public/index.html` (button after Lab; `<script src="/base-math.js">` after `/lab-math.js`), `check-page.js` (add `base-math.js` to both loops and a module-load check for `planBase`), `advisor-server.js` (static whitelist entry for `base-math.js`, same pattern as `lab-math.js`), `public/app.js`, `public/style.css`, `README.md`

**Interfaces:**
- Consumes `d.base` (Task 4 shape), `window.BaseMath.planBase(input)`, helpers `card`, `tableHtml`, `fmtC`, `esc`, `setTabCount`, `fmtHours`, `covBar`.
- localStorage keys: `advisor-base-levels` (JSON map name → level), `advisor-base-star` (star name).

- [ ] **Step 1: index.html, check-page.js, advisor-server.js**

Tab button after the Lab button: `<button data-tab="base" class="ghost" onclick="setTab('base')">Base</button>`. Script tag `<script src="/base-math.js"></script>` after `/lab-math.js`. In `check-page.js` add `"base-math.js"` to the syntax loop and `"/base-math.js"` to the reference loop, plus:

```js
try {
  const bm = require(path.join(PUBLIC_DIR, "base-math.js"));
  if (typeof bm.planBase !== "function") throw new Error("planBase missing");
  console.log("  ok: base-math.js loads as a module");
} catch (e) {
  fail("base-math.js does not load: " + e.message);
}
```

In `advisor-server.js` add the `base-math.js` entry next to `lab-math.js` in the static map. Update the footer hint in `index.html` if the key list is shown (the 12th tab has no key; leave keys as they are).

- [ ] **Step 2: CSS** (append near the lab styles)

```css
  .base-input { width: 70px; }
  .est { color: var(--dim); font-size: 11px; }
  .drift { color: var(--warn); }
```

- [ ] **Step 3: `renderBase` in `public/app.js`** (after `renderLab`)

```js
// ---- Base planner ----
function baseLevels() {
  try { const v = JSON.parse(localStorage.getItem('advisor-base-levels') || 'null'); if (v && typeof v === 'object') return v; } catch (e) {}
  return {};
}
function setBaseLevel(name, v) {
  const levels = baseLevels();
  const n = Math.max(0, Math.floor(Number(v) || 0));
  levels[name] = n;
  try { localStorage.setItem('advisor-base-levels', JSON.stringify(levels)); } catch (e) {}
  if (window.lastData) render(window.lastData);
}
function baseStar(fallback) {
  try { const v = localStorage.getItem('advisor-base-star'); if (v) return v; } catch (e) {}
  return fallback;
}
function setBaseStar(v) {
  try { localStorage.setItem('advisor-base-star', v); } catch (e) {}
  if (window.lastData) render(window.lastData);
}
function fmtDays(d) {
  if (d === null || d === undefined || !isFinite(d)) return '?';
  if (d < 1) return Math.round(d * 24) + ' h';
  return d.toFixed(1) + ' d';
}
// Recompute the plan client-side from the payload input with the stored
// level boxes and star selector applied.
function basePlanFor(b) {
  const BM = window.BaseMath;
  const levels = Object.assign({}, b.input.levels || {}, baseLevels());
  const starName = baseStar(b.input.starName);
  const rate = (BM.STAR_BONUSES[starName] || { rate: b.input.starRate || 0 }).rate;
  const input = Object.assign({}, b.input, { levels, starName, starRate: rate });
  return { plan: BM.planBase(input), starName, rate, levels };
}
function baseShortfallCount(b) {
  if (!b || !b.plan) return 0;
  return basePlanFor(b).plan.stockpile.filter(s => s.short > 0).length;
}
function renderBase(b) {
  if (!b) return '<div class="empty-note">No base data in the game state.</div>';
  const BM = window.BaseMath;
  const { plan, starName, rate } = basePlanFor(b);
  setTabCount('base', plan.stockpile.filter(s => s.short > 0).length, true);
  let html = '';
  html += '<div class="sub">Formulas from the game client ' + esc(b.provenance.client) +
    (b.provenance.drift ? ' <span class="drift">(game now reports ' + esc(String(b.provenance.live)) + ' &mdash; re-check formulas)</span>' : '') +
    '. Stellarium income is an estimate (star rate &times; miner boost every 5 h); everything else is exact. Level cost is charged from EACH of a module\'s materials.</div>';

  // --- cards ---
  html += '<div class="cards">';
  html += card('Phase', b.phase === 'live' ? '<span style="color:var(--good)">base founded</span>' : 'pre-founding');
  const readyCount = b.founding.bundle.filter(x => x.have >= x.units).length;
  html += card('Founding materials', (readyCount === b.founding.bundle.length ? '<span style="color:var(--good)">' : '<span style="color:var(--warn)">') + readyCount + ' / ' + b.founding.bundle.length + '</span>');
  const stars = [b.location.current].concat(b.location.bookmarks).filter(s => s.star);
  const seen = {}; const options = [];
  for (const s of stars) { if (seen[s.star]) continue; seen[s.star] = true; options.push(s); }
  html += card('Stellarium star', '<select class="pet-input" onchange="setBaseStar(this.value)">' +
    options.map(s => '<option value="' + esc(s.star) + '"' + (s.star === starName ? ' selected' : '') + '>' + esc(s.star) + ' (rate ' + s.rate + ')' + (s.name ? ' &middot; ' + esc(s.name) : '') + '</option>').join('') +
    '</select>' + (b.location.best && b.location.best.rate > rate ? '<span class="est"> best known: ' + esc(b.location.best.star) + ' rate ' + b.location.best.rate + (b.location.best.name ? ' at ' + esc(b.location.best.name) : '') + '</span>' : ''));
  html += card('Stellarium / day', plan.stellariumPerDay.toFixed(1) + '<span class="est"> estimate &middot; all unlocks in ' + fmtDays(plan.daysToAllUnlocks) + ' (' + plan.totalStellariumLeft + ' left)</span>');
  const up = plan.upkeep;
  html += card('Upkeep / day at targets', fmtC(up.perDay) + '<span class="est"> ' + (up.shareOfIncome !== null ? (up.shareOfIncome * 100).toFixed(0) + '% of avg daily income (' + fmtC(b.input.avgDaily) + ')' : 'income unknown') +
    ' &middot; ' + up.passiveCount + ' passive modules &middot; 5 dailies cover 75% &rarr; net ' + fmtC(up.perDay * 0.25) + '</span>');
  html += '</div>';
  if (b.labPanelHint) html += '<div class="sub">Base-tier lab buildings (Aeroforge, Cryovault, Ferric Mill, Prism Nexus, Rare Material Facility) and their price only show up after you open the Laboratory panel in-game once.</div>';
  if (b.location.bodies.length) html += '<div class="sub">Body XP bonus (+10%, permanent) in the current system: ' + b.location.bodies.map(x => esc(x.type) + (x.activity ? ' &rarr; ' + esc(x.activity) : '')).join(', ') + '.</div>';

  // --- live block ---
  if (b.live) {
    html += '<h2>Base: ' + esc(b.live.name) + '</h2><div class="cards">';
    html += card('Stellarium held', String(b.live.stellarium));
    if (b.live.nextUnlock) html += card('Next unlock', esc(b.live.nextUnlock.name) + '<span class="est"> ' + b.live.nextUnlock.cost + ' stellarium &middot; ' + (b.live.nextUnlock.etaDays === 0 ? 'affordable now' : 'in ' + fmtDays(b.live.nextUnlock.etaDays) + ' (estimate)') + '</span>');
    html += '</div>';
    html += tableHtml('tbl-base-live', b.live.modules.filter(m => m.unlocked), [
      { label: 'Module', numeric: false, getValue: r => r.name, render: r => '<b>' + esc(r.name) + '</b>' + (r.active ? '' : ' <span style="color:var(--bad)">(off)</span>') },
      { label: 'Level', numeric: true, getValue: r => r.level, render: r => String(r.level) },
      { label: 'Tier', numeric: true, getValue: r => r.tier, render: r => String(r.tier) },
      { label: 'Boost', numeric: true, getValue: r => r.boost, render: r => r.boost.toFixed(1) + '%' },
      { label: 'Output / tick', numeric: true, getValue: r => r.output, render: r => r.output.toFixed(2) },
      { label: 'Next level', numeric: true, getValue: r => r.nextLevelCost, render: r => fmtC(r.nextLevelCost) + ' of each: ' + r.materials.map(esc).join(', ') },
      { label: 'Next tier', numeric: true, getValue: r => r.nextTierCost, render: r => r.nextTierCost + ' stellarium' },
    ]);
  }

  // --- modules / targets ---
  html += '<h2>Modules and targets</h2><div class="sub">unlock order follows the needs tree; set the level you want to reach in each box (saved in this browser)</div>';
  const unlockByName = {}; for (const u of plan.unlocks) unlockByName[u.name] = u;
  const rows = plan.unlocks.map(u => Object.assign({}, u, plan.targets.find(t => t.name === u.name) || {}));
  html += tableHtml('tbl-base-modules', rows, [
    { label: 'Module', numeric: false, getValue: r => r.name, render: r => '<b>' + esc(r.name) + '</b>' + (r.unlocked ? ' <span style="color:var(--good)">unlocked</span>' : '') },
    { label: 'Type', numeric: false, getValue: r => r.type || '', render: r => esc(r.type || '') },
    { label: 'Unlock', numeric: true, getValue: r => r.cost, render: r => r.unlocked ? '-' : r.cost + '<span class="est"> (' + r.cumulative + ' cum. &middot; ' + fmtDays(r.daysToUnlock) + ')</span>' },
    { label: 'Materials', numeric: false, getValue: r => (r.materials || []).join(','), render: r => (r.materials || []).map(esc).join(', ') },
    { label: 'Target level', numeric: true, getValue: r => r.to || 0, render: r => '<input class="pet-input base-input" type="number" min="0" value="' + (r.to || 0) + '" onchange="setBaseLevel(' + jsStr(r.name) + ', this.value)">' + (r.from ? '<span class="est"> from ' + r.from + '</span>' : '') },
    { label: 'Cost to target', numeric: true, getValue: r => r.perMaterial || 0, render: r => fmtC(r.perMaterial || 0) + ' of each' },
    { label: 'Boost at target', numeric: true, getValue: r => r.boostAtTarget || 0, render: r => (r.boostAtTarget || 0).toFixed(0) + '%' },
    { label: 'Upkeep / h at target', numeric: true, getValue: r => r.upkeepPerHourAtTarget || 0, render: r => r.type === 'active' ? '-' : fmtC(r.upkeepPerHourAtTarget || 0) },
  ]);

  // --- stockpile ---
  html += '<h2>Stockpile for the targets</h2>';
  if (plan.buyFirst.length) html += '<div class="sub" style="color:var(--warn)">Buy these base-tier lab buildings first: ' + plan.buyFirst.map(esc).join(', ') + '.</div>';
  html += tableHtml('tbl-base-stock', plan.stockpile, [
    { label: 'Material', numeric: false, getValue: r => r.material, render: r => '<b>' + esc(r.material) + '</b>' },
    { label: 'Needed', numeric: true, getValue: r => r.needed, render: r => fmtC(r.needed) },
    { label: 'Stock', numeric: true, getValue: r => r.stock, render: r => fmtC(r.stock) },
    { label: 'Short', numeric: true, getValue: r => r.short, render: r => r.short > 0 ? '<span style="color:var(--bad)">' + fmtC(r.short) + '</span>' : '<span style="color:var(--good)">0</span>' },
    { label: 'For', numeric: false, getValue: r => r.modules.length, render: r => r.modules.map(esc).join(', ') },
    { label: 'Produced by', numeric: false, getValue: r => r.building || '', render: r => r.bought ? esc(r.building || '') : '<span style="color:var(--warn)">buy ' + esc(r.building || '?') + ' first</span><span class="est"> &middot; consumes ' + r.inputs.map(esc).join(', ') + '</span>' },
    { label: 'Chain time', numeric: true, getValue: r => r.hoursPipelined === null ? -1 : r.hoursPipelined, render: r => r.hoursPipelined === null ? '-' : fmtHours(r.hoursPipelined) + (r.binding ? '<span style="color:var(--bad)"> binding ' + esc(r.binding.name) + ' ' + (r.binding.coverage * 100).toFixed(0) + '%</span>' : '') },
  ]);
  return html;
}
```

Dispatch in `render(d)`: `} else if (tab === 'base') { html += '<h2>Base planner</h2>' + renderBase(d.base);`. Badge in the `setTabCount` block (guarded like lab): `if (tab !== 'base') setTabCount('base', baseShortfallCount(d.base), true);`.

- [ ] **Step 4: Verify**

Run: `node --check public/app.js && node check-page.js && node --test test/*.test.js` → all ok. Restart the dev server (`netstat -ano | grep 8787`, `taskkill //PID <pid> //F`, `nohup node advisor-server.js >> advisor-server.log 2>&1 &`), `curl -s --max-time 150 http://localhost:8787/api/analyze -o /dev/null`, open the Base tab in the browser (chrome-devtools MCP if available: click `[...document.querySelectorAll('.maintabs button')].find(x=>x.dataset.tab==='base').click()`), confirm: cards render, star selector lists the current star and bookmarks, changing a level box re-renders and survives reload, stockpile shows microcircuits/fusion cells with chain times and aerolite/cryovita/ferricrystal/luminaris as "buy … first", no console errors.

- [ ] **Step 5: README**

After the Lab bullet:

```markdown
- **Base** — base-building planner. Before founding: founding readiness, which star to
  found under (stellarium rate per star type), the unlock order with stellarium cost per
  module and an estimated timeline, per-module target levels with the exact material cost
  (charged from each of the module's materials), the stockpile list with shortfalls and lab
  chain times, which base-tier lab buildings to buy first, and the upkeep bill at the
  targets as a share of your average daily income. After founding: the live module table
  with boost, output, next level and tier cost, and the next unlock's ETA
```

File table rows: `| lib/base.js | Base planner adapter |`, `| public/base-math.js | Shared base-building math (module table, cost curves, upkeep, planBase) |`.

- [ ] **Step 6: Commit**

```bash
git add public/index.html check-page.js advisor-server.js public/app.js public/style.css README.md
git commit -m "feat(base): Base tab with targets, stockpile, upkeep and location advice"
```

---

## Self-review

- Spec coverage: data (T1), tables/curves/upkeep (T2), normaliser/unlocks/materials/planBase with stockpile + buyFirst + estimates flag (T3), adapter with founding/location/live/provenance/labPanelHint (T4), GUI + README (T5). `maxLevelsAffordable` intentionally absent (cut). Body bonus as footnote (T5). Version drift footer (T5).
- Placeholders: none.
- Type consistency: `planBase` returns `unlocks/totalStellariumLeft/stellariumPerDay/daysToAllUnlocks/targets/stockpile/buyFirst/upkeep`; `planBaseFromState` wraps it in `plan` and adds `phase/provenance/founding/location/input/live/labPanelHint`; `renderBase` reads exactly those. `stocksFromState` is exported from `lib/lab.js` (existing). `statTotalsByContext` exported from `lib/installs.js` (existing).
