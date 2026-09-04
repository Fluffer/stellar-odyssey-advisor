# Lab / crafting bottleneck planner — design

Date: 2026-09-04. Status: approved in chat, sub-project 1 of 3.

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
  (`UserStore.additionalQueueSlots`). Adding units to a running queue needs no
  slot.
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
  hours, stages: [{ stage, hours, critical }],
  upgradeRoi: [{ name, level, nextLevelCost, hoursSaved, creditsPerHourSaved, levelsToFloor, costToFloor }],
  speed: { building, options: [{ x, inputMult, hours, affordable }] } | null,
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
3. Time per building = `unitsToRun × timer(level) / output`. Stage time =
   buildings in the stage scheduled greedily onto `queueSlots` parallel
   slots (longest-first); chain hours = sum of stage times. `critical` marks
   the longest building per stage.
4. `upgradeRoi`: for each building with `unitsToRun > 0`, recompute chain
   hours with `level + 1`; `hoursSaved`, `creditsPerHourSaved =
   nextLevelCost / hoursSaved` (null if 0). `levelsToFloor` and `costToFloor`
   from the 0.1 s/level rule (`Σ 1.15M × k`).
5. `speed` for the critical building of the longest stage: for x in 2..10,
   hours with time / x and inputs × mult; `affordable` = every input still
   covered by stock at that multiplier.
6. `raw`: per raw currency `needed`, `stock`, `coverage = stock / needed`,
   `unitsSupported = floor(stock / needed × units)`. `binding` = lowest
   coverage < 1. `ready` = no shortfalls anywhere.
7. Base founding target = a virtual product whose inputs are the five
   intermediates × 5,000, expanded through the same code path.

Not modelled: claim cooldown, Laboratory enhancer, partial units in progress,
market purchases.

## GUI: new "Lab" tab (`public/app.js`, `public/style.css`)

- Cards: capsule target input (number box, default 10, saved in
  localStorage `advisor-lab-capsules`, re-renders on change without a new
  analyze), chain hours, binding currency with coverage bar, queue slots
  free / total.
- "Per building" table (sortable): stage, units to run, timer now, hours,
  inputs needed vs stock (short in red), critical marker.
- "Raw currencies" table: needed / stock / coverage bar / capsules supported.
- "Upgrade ROI" list: top 5 buildings by credits per hour saved, plus cost to
  floor for the critical one.
- Speed multiplier note for the critical building (first affordable x that
  cuts at least 1 hour).
- Base founding card: 5/5 materials ready, or shortfalls, plus refill hours
  after founding.
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
- Stage times: seven stage-1 buildings on 10 slots → stage time = longest
  building; on 4 slots → greedy packing.
- ROI ordering: the critical building ranks first; a zero-unit building has
  no ROI row.
- Base founding: stocks at 5,000 each → `ready = true`, zero hours.
- Speed table: x10 multiplies input by 77.7 and divides time by 10.

## Files

- `lib/cdp.js` (read lab + rare currencies), `lib/lab.js` (new),
  `public/lab-math.js` (new, shared expansion), `advisor-core.js` (wire
  `lab` into analyze output and exports), `public/app.js`, `public/style.css`,
  `public/index.html` (script tag), `test/lab.test.js` (new), `README.md`,
  `check-page.js` (new script reference).
