# Base planner ("Base" tab) — design

Date: 2026-09-05. Status: critiqued by model-iq (deepseek, kimi), changes applied; built autonomously on the user's instruction ("build and design a base upgrade tab so we can see how and what needs to upgrade it and get stellarium, so I can start building the right resources; release in about a week").

## Goal

Before base building unlocks for this account, tell the player what to
stockpile and where to found, so that on release day the base can be founded
and its modules unlocked and levelled without waiting on the lab chain. After
founding (when `BaseBuildingStore.base` is populated) the same tab turns into
the live upgrade advisor: what the next unlock costs, what each module's next
levels cost, how long the stellarium takes, and what the upkeep bill is.

## Game rules (extracted from the client bundle, chunk `Ec`/`Oc`, and the
in-game wiki text) — exact unless marked estimate

- **Founding**: 5,000 each of ingots, refined crystals, high end crystals,
  propulsors, nanoconductors (`fundationMaterialAmount`, `fundationMaterialList`).
- **Location**: star type sets the Stellarium miner's rate and efficiency
  (`starTypeBonuses`): Ringed Dwarf / Binary Stars / Neutron Star / Black Hole
  rate 8, efficiency 125%; O, B: 7 / 110%; A, F: 6 / 100%; G, K, M: 5 / 85%.
  Body type gives a permanent +10% XP bonus (`bodyTypeBonuses`): Rocky Planet /
  Asteroid → battling; Icy Planet / Belt → gathering; Gas Planet / Nebula →
  crafting; Crystal Planet / Comet → exploring.
- **Modules (11)**, unlock order forced by `needs`, each levelled with the
  listed materials (charged in full from EACH material):
  1. Stellarium miner — passive — needs: none — microcircuits, fusion cells
  2. Material generator — passive, setup — needs Stellarium miner — aerolite
  3. Metal scrap generator — passive — needs Stellarium miner — cryovita
  4. Resource miner — passive, setup — needs Stellarium miner — ferricrystal
  5. Quantum server — passive — needs Material generator — microcircuits (half level counts)
  6. Craftron 3000 — active, setup — needs Metal scrap generator — luminaris
  7. Fuel facility — passive — needs Resource miner — fusion cells
  8. Research lab — passive — needs Quantum server + Craftron 3000 + Fuel facility — warp capsule
  9. Item booster — active, setup — needs Research lab — fusion cells
  10. Laboratory enhancer — passive — needs Research lab — microcircuits (half level counts)
  11. Battling Trainer (PvP) — passive — needs Laboratory enhancer + Item booster — warp capsule
- **Unlock cost in stellarium** with N modules already unlocked (client:
  `getStellariumCost(unlockedCount)`): `unlockCost(N) = Σ_{n=1..N} i(n)`,
  `i(n) = n × (n ≥ 100 ? 2^(floor((n−100)/50)+1) : 1)` (= N(N+1)/2 for N < 100).
  The first module (Stellarium miner) comes with founding (N = 1 afterwards).
  Unlocking modules 2..11 therefore costs 1, 3, 6, 10, 15, 21, 28, 36, 45, 55 =
  **220 stellarium in total**. Goldens are the source of truth for the curve.
- **Tier cost** for going from tier t to t+1: `i(t+1)` stellarium (same step curve,
  `getMaxStellariumUpgrades` walks it greedily).
- **Level cost**, paid in materials: reaching level L costs `f(L)` units of EACH of
  the module's materials (a Stellarium miner at level 50 has consumed 1,275 microcircuits
  AND 1,275 fusion cells). `t(L) = L(L+1)/2`; `f(L) = t(L)` for L ≤ 600;
  `f(L) = f(600) + (t(L) − t(600)) × 2` for 600 < L ≤ 1000; `× 4` for 1000 < L ≤ 1500;
  `× 8` for 1500 < L ≤ 1750; `× 16` for 1750 < L ≤ 2000; `× 64` for L > 2000 (upper bounds
  inclusive, exactly as the client's `getBaseModuleLevelUpgradeCost`). One level L costs
  `f(L) − f(L−1)` (= L for L ≤ 600, 1202 for L = 601).
- **Boost** = `(name ∈ {Quantum server, Laboratory enhancer} ? level/2 : level) × (1 + tier/100) × (1 + base_module_efficiency_boost/100)` (percent).
- **Output per production tick** = `base × (1 + floor(boost/100))` plus one extra `base`
  with probability `(boost mod 100)%`. Base amounts: Material generator 200, Metal scrap
  generator 1500, Resource miner 20,000, Fuel facility 5, all others 1.
  Expected output per tick = `base × (1 + boost/100)`.
- **Ticks**: passive modules charge upkeep every 10 minutes (144 per day) and produce on
  the sixth charge (hourly). The Stellarium miner produces every 5 hours
  (`base.nextStellariumTick` is the next one). **ESTIMATE (server-side, not in the
  client)**: amount per production = star `stellarium_rate × (1 + boost/100)`; the star's
  `efficiency` field is unused by the client and is ignored here. Every ETA derived from
  it is labelled "estimate" in the GUI and lives behind one `ESTIMATES` constant.
- **Upkeep** per passive module per 10-minute tick, exactly as the client's
  `BaseModuleCard` computes it:
  `avgDaily = floor(lifetimeCredits / daysSinceRegistration)` where `lifetimeCredits` is the
  lifetime-earned counter `player.statistics.credits` (not the balance) and days =
  `(now − registered) / 86400` (guard: days < 1 → 1);
  `charge = floor(avgDaily / 24 / 2 / 9 / passiveUnlockedCount / 2) × (1 + boost/100) × (1 − pvpBaseBoost/100) × (1 − min(base_upkeep_reduction, cap)/100)`
  (the divisor chain is 864 × passiveUnlockedCount; kept verbatim). `passiveUnlockedCount` =
  unlocked modules of type `passive` (the Stellarium miner is passive and pays upkeep;
  Craftron 3000 and Item booster are active and pay nothing). Per day = charge × 144.
  Pre-founding the set is the PLANNED passive modules (the targets), stated in the UI.
  Daily quests are not in the charge: they refund 15% of the day's upkeep each (5 = 75%),
  shown as a separate "covered by quests" line, multiplicative with nothing. If a charge
  cannot be paid the module switches off (its output is then 0; the live view flags
  `active === false`).
- **Base-material buildings** (lab, "base" tier, bought with credits, cost shown only when
  the Laboratory panel is open — `LaboratoryStore.nextBaseCost`): Aeroforge (gold, ruby,
  sulfur, hydrogen → aerolite), Cryovault (silver, emerald, carbon, helium → cryovita),
  Ferric Mill (copper, sapphire, water, methane → ferricrystal), Prism Nexus (platinum,
  diamond, nitrogen, ammonia → luminaris), Rare Material Facility (argon, cobalt, dark
  matter, silicon → argoflux). Their `input`/`timer` are unknown until bought and are
  **not estimated**: the stockpile shows exact material totals only, and for the five base
  materials says "buy <building> first" (with its raw inputs listed from the table above)
  until the building appears in `baseLab.buildings`, after which the real building feeds
  the lab chain. `LaboratoryStore.base`/`nextBaseCost` populate only after the in-game
  Laboratory panel has been opened once; the GUI says so when they are empty.
- **Item booster** costs 300M credits base + 1 anomaly per use (not planned here).

## Data (`lib/cdp.js`)

Add to READ_ALL:

```
base: BaseBuildingStore.base (as-is, null until founded),
baseLab: { buildings: LaboratoryStore.base (as-is), nextBaseCost, nextBuildingCost },
account: { registered: UserStore.registered, lifetimeCredits: Number(UserStore.player.statistics.credits.$numberDecimal || 0) },
currentSystem: { name, star: ExploreStore.currentSystem.star, bodies: [type] },
bookmarks: ExploreStore.bookmarks.map(b => ({ name: b.system.name, star: b.system.star, bodies: b.system.bodies.map(x => x.type) })),
gameVersion: GameStore.patchVersion,
```

Live base shape as the client reads it (field names grepped from the bundle):
`base = { _id, name, stellarium, nextStellariumTick, catalystUpkeepReduction,
modules: [{ _id, name, type: 'passive'|'active', unlocked, level, tier, needs: string[],
tickCounter, active, selection, uses }] }`. `lib/base.js` runs every live read through
`normalizeBase(raw)`, which tolerates missing fields (defaults: level 0, tier 0,
unlocked false, type from the MODULES table by name) and returns null for anything
that is not an object with a `modules` array; the tab then shows the pre-founding view.
A fixture built from this shape drives the live-phase tests.

Formula provenance: bundle `assets/index-BiPcVSdi.js`, game patch 1.1.1 (`GameStore.patchVersion`).
The tab footer shows "formulas from client 1.1.1"; if the live `gameVersion` differs, the
footer turns amber ("re-check formulas").

`player.skills.base_module_efficiency_boost` and the equipped
`base_upkeep_reduction` total (default context) are already available.

## Engine

### `public/base-math.js` (pure, shared like `lab-math.js`)

- Constants: `MODULES` (the 11 entries above with `needs`, `materials`, `type`, `halfLevel`, `baseAmount`), `STAR_BONUSES`, `BODY_BONUSES`, `FOUNDING_BUNDLE`.
- `levelCostCumulative(L)`, `levelCost(L)`, `levelsCost(from, to)` (materials per material), `maxLevelsAffordable(level, budget)`.
- `stellariumStep(n)`, `stellariumUnlockCost(unlockedCount)`, `tierCost(tier)`, `tiersCost(from, to)`.
- `moduleBoost(module, efficiencyBoost)`, `expectedOutputPerTick(module, efficiencyBoost)`.
- `unlockOrder(modules)`: topological order by `needs` (stable, in the numbered order).
- `upkeepPerTick(avgDaily, passiveCount, boost, pvpBaseBoost, upkeepReduction)`; `upkeepPerDay(modules, ...)` = Σ over passive modules of perTick × 144; `questsCoverage(claimedCount) = 0.15 × min(5, claimed)`; `avgDailyIncome(lifetimeCredits, registered, now)` with the days ≥ 1 guard.
- `stellariumPerDay(starRate, boost) = starRate × (1 + boost/100) × (24/5)` (ESTIMATE, from the `ESTIMATES` constant).
- `planUnlocks(modules, starRate, minerBoost)`: `modules` = normalised live modules or the all-locked default set; returns for each module in unlock order: `unlocked`, `stellariumCost` (`unlockCost(N)` with N = modules unlocked before it), cumulative stellarium still to pay, and `daysToUnlock` (cumulative ÷ stellariumPerDay, estimate) — the miner's boost is its CURRENT level (live) or 0 (pre); `starRate` is the rate of the star chosen in the GUI (default: current system's star; selector offers current system and bookmarked systems).
- `materialsFor(targets, modules)`: `targets = [{ name, toLevel }]` → per module `f(toLevel) − f(currentLevel)` charged from EACH of its materials; grouped per material with the list of modules that need it. Producing building per material: microcircuits (Circuit Integration Facility), fusion cells (Energetic Fusion Center), warp capsule (Space Capsule Complex), aerolite (Aeroforge), cryovita (Cryovault), ferricrystal (Ferric Mill), luminaris (Prism Nexus), argoflux (Rare Material Facility).

### `lib/base.js` (adapter)

`planBase(state, opts)`:

- `phase`: `"pre"` (base null) or `"live"`.
- `founding`: from `lib/lab.js` (reuse `FOUNDING_BUNDLE` readiness) plus the location advice: current system star (rate/efficiency), best bookmarked star by rate, body-type bonus per activity, a one-line recommendation ("found on a rare-star system if you can find one: +33% stellarium vs an A-type").
- `unlocks`: from `planUnlocks`, with cumulative stellarium and ETA at the chosen star.
- `targets`: `toLevel` per module from `opts.levels` (GUI boxes, default 50 each; localStorage `advisor-base-levels`), giving the **stockpile list**: material → needed / stock / short / modules needing it / producing building. For materials whose building exists in the live lab (warp chain, or a base building once bought) the shortfall's chain time and binding raw resource come from `LabMath.planTarget` on the live buildings (warp + `baseLab.buildings`), one demand per material, `netTopLevel: false`. For materials whose building is not bought the row reads "buy <building> first — consumes <raw inputs>" and has no time. Nothing is estimated.
- `upkeep`: avgDaily from `account`, `passiveCount` = passive modules among the targets (pre) or unlocked passive modules (live), per-module boost at target (pre) or current (live) level and tier, per tick / per hour / per day, quest coverage line, and "share of average daily income" = upkeepPerDay ÷ avgDaily.
- `live` (phase live only, from `normalizeBase`): stellarium held, next tick time, per module: unlocked, level, tier, active, boost, expected output per tick, next level cost (materials), next tier cost, and the next unlock's cost and ETA from real stellarium.
- Degraded: missing `account` → `upkeep: null`; missing `lab` → stockpile rows without times; missing `currentSystem`/`bookmarks` → location advice with "unknown star"; a malformed `base` → pre phase. Never throws.
- Estimated numbers (stellarium per day, days to unlock) carry `estimate: true`.

## GUI: "Base" tab (`public/app.js`)

- Cards: phase (pre-release / founded), founding readiness (5/5), location (star selector: current system + bookmarks; shows rate and the best available), stellarium per day at the chosen star (estimate), upkeep per day at target levels as a share of average daily income (with the quest coverage line). Body-type XP bonus is one footnote line, not a card.
- Table "Modules" in unlock order: name, type, needs, materials, unlock cost (stellarium, cumulative), target level box (number input per row, saved in localStorage `advisor-base-levels`), level cost to target (per material), expected output per tick at target, upkeep per hour at target.
- Table "Stockpile": material → needed / stock / short / modules / produced by / chain hours for the shortfall / binding raw resource. Rows whose building is not bought say "buy <building> first" and list its raw inputs.
- Note lines: "buy these base buildings now: …" listing every unbought base building the targets need (cost visible in-game on the Laboratory panel; the advisor reads it once that panel has been opened); estimate footnote for stellarium ETAs; formula provenance footer.
- Every game-supplied string (system names, module names) goes through `esc()`.
- Tab badge: number of stockpile materials short for the target.
- Client-side recompute when a level box changes, using `window.BaseMath` + `window.LabMath` on payload data (chain, stocks, account).

## Tests (`test/base.test.js`)

- Level cost curve: `levelCost(1)=1`, `levelCost(600)=600`, `levelCost(601)=1202`, `levelCostCumulative(600)=180300`, `levelsCost(0,50)=1275`.
- Stellarium: `stellariumStep(99)=99`, `stellariumStep(100)=200`, `stellariumStep(149)=298`, `stellariumStep(150)=600`, `unlockCost(1)=1`, `unlockCost(3)=6`, `unlockCost(10)=55`, total for modules 2..11 = 220; `tiersCost(0,3)=6`.
- Level curve boundaries: `levelCost(1000)=1000×2`, `levelCost(1001)=1001×4`, `levelCost(1500)=1500×4`, `levelCost(1501)=1501×8`, `levelCost(1750)=1750×8`, `levelCost(1751)=1751×16`, `levelCost(2000)=2000×16`, `levelCost(2001)=2001×64`.
- Boost: Quantum server level 200 tier 10 eff 0 → 110; Resource miner level 250 → expected output 20000×3.5 per tick.
- Unlock order respects needs (Research lab after Quantum server, Craftron, Fuel facility).
- Upkeep: avgDaily 200M, 1 passive module, boost 0, no reductions → 231,481 per tick, 33,333,264 per day; 2 passive modules → 115,740 each; boost 100 doubles it; 5 quests → 75% coverage; `avgDailyIncome` guards days < 1.
- Live phase on a fixture built from the bundle's field names (miner unlocked level 20 tier 2, others locked): next unlock cost 1, next level cost 21 of each material, boost 20 × 1.02; `normalizeBase` returns null for `{}` and for a string.
- `planBase` pre-phase on a live-shaped state: founding ready, location advice names the best bookmarked star, stockpile lists microcircuits/fusion cells shortfalls for the default targets and flags aerolite rows as needing the Aeroforge.
- Degraded: no account → sections null, no throw.

## Out of scope

Item booster economics, PvP base boost tiles, dungeon material setups, market purchases, estimating unbought base buildings, `maxLevelsAffordable` (no consumer yet). When the game populates `BaseBuildingStore.base` the live phase may need field-name fixes; `normalizeBase` and the pre-phase fallback contain the damage.

## Critique delta (model-iq, 2026-09-05)

Accepted: unlock-cost golden corrected (220 total, prose = client function); level cost stated per material with inclusive boundaries and boundary goldens; upkeep formula kept verbatim from the client with passive-set definition, days ≥ 1 guard, lifetime-earned semantics and quests as a separate coverage line; stellarium output isolated as an ESTIMATE constant and flagged in the GUI; live base shape extracted from the bundle plus a normalizer and fixture; estimated base buildings removed (exact totals + "buy first"); star selector parameter; "open the Laboratory panel once" hint; formula provenance/version footer; body bonus demoted to a footnote; `maxLevelsAffordable` and the redundant "total stellarium" card cut; `esc()` rule stated.
Rejected: "divisor 864 contradicts 10-minute ticks" — the divisor chain is copied verbatim from the client (`/24/2/9/n/2`), the per-day figure is charge × 144; "make planBase shared" — the GUI only recomputes materials/upkeep from `BaseMath` on level-box changes, planBase stays a thin server adapter; "stellarium cap / held pre-founding" — stellarium exists only after founding, ETAs start at founding day (stated in the UI).
