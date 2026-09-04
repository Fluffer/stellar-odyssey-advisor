# Lab / crafting bottleneck planner — design

Date: 2026-09-04. Status: approved in chat, critiqued by model-iq (deepseek, kimi), sub-project 1 of 3.

## Goal

Answer "what stops me from making N warp capsules (or founding a base), how long
does the chain take, and which credit spend shortens it most" from the live
Laboratory state. Read-only, deterministic, no simulation of claim timing.

Sub-projects (this spec covers only #1):

1. Lab chain engine + Lab tab (warp capsules, base founding, upgrade ROI).
2. Blueprint crafting shortfall (Materials tab extension). Separate spec.
3. Base modules. Deferred until a base exists (module cost base rates only
   appear in `BaseBuildingStore.base`).

## Game rules used (from the in-game wiki text in the client bundle)

- A building consumes `input` units of EACH listed currency/material per
  produced unit and yields `output` units (all 1 today).
- Production timer per unit: `max(5, timer − 0.1 × level)` seconds.
- Level k costs `1,150,000 × k` credits (levels purchasable in bulk).
- Speed multiplier x1..x10: same output in 1/x the time, input per unit
  multiplied by `[1, 2.6, 4.5, 7, 10.5, 15.4, 22.7, 33.8, 50.9, 77.7]`.
- Queue slots: 4 standard, 6 premium, plus purchased extra slots
  (`UserStore.additionalQueueSlots`). The pool is global across lab, base and
  dungeon buildings; a building holds ONE queue (one multiplier at a time), so
  a building is strictly serial and never spans several slots. Adding units to
  a running queue needs no slot.
- Inputs are consumed when units are queued ("provided you have enough
  resources"), not per unit or at claim.
- Production keeps running while output sits unclaimed; Claim (10-minute
  cooldown per queue) only banks what is ready. Claiming therefore gates when
  downstream buildings can be fed, not throughput.
- Level upgrades change the timer only (never input or output).
- The speed multiplier is per queue, costs no credits, multiplies every input
  of that queue and divides its time.
- Chain (Warp Capsule buildings):
  - Foundry: gold, silver, copper, platinum → ingots
  - Refinery: diamond, ruby, emerald, sapphire → refined crystals
  - Crystal Synthesis Lab: water, nitrogen, sulfur, carbon → high end crystals
  - Noble Gas Processing Station: helium, methane → propulsors
  - Nanotech Complex: ammonia, hydrogen → nanoconductors
  - Circuit Integration Facility: silicon, cobalt → microcircuits
  - Energetic Fusion Center: argon, dark matter → fusion cells
  - Module Assembly Plant: ingots, refined crystals, microcircuits → fuel cell casing
  - Fuel Lab: high end crystals, propulsors, nanoconductors, fusion cells → unstable fuel
  - Space Capsule Complex: unstable fuel, fuel cell casing → warp capsule
- Base founding costs 5,000 each of ingots, refined crystals, high end
  crystals, propulsors, nanoconductors.

The chain is taken from the live `LaboratoryStore.buildings` (names, inputs,
`input`, `output`, `timer`, `level`), not hardcoded, so base/dungeon buildings
appear automatically if bought. Material names are normalised (`_` and space,
lower-case) because the store mixes `refined_crystals` and `refined crystals`.

## Data (`lib/cdp.js`)

Add to READ_ALL:

```
lab: {
  buildings: [{ building, level, currency_use, material_use, produce, input, output, timer }],
  queue: labQueue (as-is),
  queueSlots: (premium.active ? 6 : 4) + (user.additionalQueueSlots || 0),
}
```

Currencies (`commonResources`) and `materials` are already read; extend
`commonResources` with the four rare currencies the lab consumes: silicon,
cobalt, argon, dark_matter.

## Engine (`lib/lab.js`, pure functions, exported through advisor-core)

```
planLab(state, opts) -> {
  targets: { capsules: TargetPlan, baseFounding: TargetPlan },
  queueSlots, queueInUse,
}
TargetPlan = {
  product, units,
  buildings: [{ name, stage, unitsToRun, timerNow, seconds, hours,
                inputs: [{ name, kind, perUnit, needed, stock, short, coverage }], critical }],
  raw:  [{ name, needed, stock, coverage, unitsSupported }],
  binding: { name, coverage } | null,
  hoursSequential, hoursPipelined, freeSlots,
  upgradeRoi: [{ name, level, nextLevelCost, hoursSaved, creditsPerHourSaved, levelsToFloor, costToFloor }],
  criticalGroup: string[],
  groupRoi: { buildings, cost, hoursSaved, creditsPerHourSaved } | null,
  speed: { buildings, options: [{ x, inputMult, hours, hoursSaved, affordable, extraInputs }] } | null,
  afterFounding: { hoursPipelined, binding } | null,   // capsule target only
  ready: boolean,
}
```

Algorithm:

1. `expand(product, units)`: depth-first. Requirement for a product = units ×
   input per unit of each input. Existing stock of an intermediate is netted
   first (`needToProduce = max(0, needed − stock)`), then that shortfall is
   expanded into its building's inputs. Raw currencies terminate.
2. Stage = longest path from the product down to raw inputs (capsule 3,
   casing/fuel 2, intermediates 1). Buildings with `unitsToRun = 0` are
   listed with zero time.
3. Time per building = `unitsToRun × timer(level) / output` (serial: one
   queue per building). Free slots = `queueSlots − labQueue.length`. Stage
   time = max building hours in the stage when the stage has at most
   `freeSlots` buildings, else `ceil(count / freeSlots)` waves as an upper
   bound (no packing code). Two chain estimates are reported:
   - `hoursSequential` = sum of stage times (queue each stage in full only
     after the previous stage has finished).
   - `hoursPipelined` = the critical building's hours + 10 minutes per stage
     downstream of it (claim and re-queue every cooldown as inputs arrive).
     This is the realistic lower bound because inputs are consumed at
     queue time, so pipelining is a manual claim/queue loop.
   `critical` = the building with the largest hours overall; per-stage
   critical is derivable in the GUI.
4. `upgradeRoi`: for each building with `unitsToRun > 0`, recompute
   `hoursPipelined` with `level + 1` (full recompute; at most ~15 buildings,
   cheap enough for the browser on every keystroke); `hoursSaved`,
   `creditsPerHourSaved = nextLevelCost / hoursSaved` (null if 0).
   `levelsToFloor` and `costToFloor` from the 0.1 s/level rule
   (`Σ 1.15M × k`). Buildings not on the critical path show hoursSaved 0.
   Ties: several buildings often share the maximum hours (all stage-1
   buildings at the same level and unit count). Upgrading one of them alone
   saves nothing, which the full recompute reports honestly. So the plan also
   carries `criticalGroup` = every building whose hours are within 1e-9 of
   the maximum, and `groupRoi` = { buildings, cost = Σ nextLevelCost over
   the group, hoursSaved = recompute with EVERY group member at level + 1,
   creditsPerHourSaved }. The GUI shows the group row first whenever the
   group has more than one member.
5. `speed` for the critical group: for x in 2..10, recompute
   `hoursPipelined` with every group member's time / x and inputs × mult
   (recompute, so a shifted bottleneck is reflected); `affordable` = every
   input of every group member still covered by stock at that multiplier;
   `extraInputs` lists the additional units of each input, summed across
   the group. `planCore` accepts `speed: { buildings: string[], x }`. The GUI shows the
   best affordable x only. The multiplier costs resources, not credits, so it
   is presented next to level upgrades in hours-saved terms, never merged into
   one credits-per-hour ranking.
6. `raw`: per raw currency `needed`, `stock`, `coverage = stock / needed`,
   `unitsSupported = floor(stock / needed × units)`. `binding` = lowest
   coverage < 1. `ready` = no shortfalls anywhere.
7. Base founding target = a virtual product whose inputs are the five
   intermediates × 5,000, expanded through the same code path. The two
   targets are computed independently over the same stock; the GUI states
   that they share stock and shows, for the capsule target, a second line
   "after founding" computed on stock minus the founding bundle.
8. Degraded input: no `lab` in state, no buildings, or a target product no
   building produces → an empty plan (`ready: false`, empty arrays), never a
   throw.

Not modelled: Laboratory enhancer (needs a base), units already in
`labQueue` (shape unknown until observed; noted in the UI as "queued units are
not counted"), market purchases, currency income over time (a rate model is a
separate parked feature; stocks are treated as static). Coverage with
`needed = 0` is defined as 1. Name normalisation happens once, at the
engine entry (`normalizeLab(state.lab)`), never in the GUI.

## GUI: new "Lab" tab (`public/app.js`, `public/style.css`)

- Cards: capsule target input (number box, default 10, saved in
  localStorage `advisor-lab-capsules`, re-renders on change without a new
  analyze), chain hours (pipelined, with sequential as the small print),
  binding currency with coverage bar, queue slots free / total. A one-line
  note: "queued units are not counted; stocks are treated as static".
- "Per building" table (sortable): stage, units to run, timer now, hours,
  inputs needed vs stock (short in red), critical marker.
- "Raw currencies" table: needed / stock / coverage bar / capsules supported.
- "Upgrade ROI" list: top 5 buildings by credits per hour saved, plus cost to
  floor for the critical one.
- Speed multiplier note for the critical building: best affordable x, hours
  saved, extra inputs consumed.
- Base founding card: 5/5 materials ready, or shortfalls, plus capsule chain
  hours after founding (stock minus the bundle).
- Zero-unit buildings stay in the payload and are hidden in the table by
  default.
- Tab count badge: number of raw shortfalls for the capsule target.

The client re-runs only the cheap expansion/timing math when the target box
changes; the engine therefore ships the raw chain (`lab.buildings`, stocks) in
the analyze payload and the browser uses a shared copy of the expansion code
(`public/lab-math.js`, required by `lib/lab.js` the same way `pet-math.js` is).

## Tests (`test/lab.test.js`)

Synthetic 10-building chain identical to the live one at level 20:

- 10 capsules with empty stocks → 100 fuel, 100 casings, 2,000 of each of
  the seven intermediates, 20M of each Foundry/Refinery/Crystal currency,
  2M of each Circuit/Fusion currency.
- Stock netting: 5,000 ingots in stock → Foundry runs 0 units.
- Timer: level 20 on a 45 s base → 43 s; level 500 → 5 s floor.
- Stage times: seven stage-1 buildings on 10 free slots → stage time =
  longest building; on 4 free slots → 2 waves. `hoursPipelined` = critical
  hours + 10 min × downstream stages; `hoursSequential` = sum of stage
  maxes.
- ROI ordering: the critical building ranks first; a zero-unit building has
  no ROI row; a non-critical building has hoursSaved 0.
- Degraded: state without `lab` → empty plan, no throw.
- Rounding: engine keeps floats; tests compare with tolerance; GUI rounds.
- Base founding: stocks at 5,000 each → `ready = true`, zero hours.
- Speed table: x10 multiplies input by 77.7 and divides time by 10.

## Files

- `lib/cdp.js` (read lab + rare currencies), `lib/lab.js` (new),
  `public/lab-math.js` (new, shared expansion), `advisor-core.js` (wire
  `lab` into analyze output and exports), `public/app.js`, `public/style.css`,
  `public/index.html` (script tag), `test/lab.test.js` (new), `README.md`,
  `check-page.js` (new script reference).
