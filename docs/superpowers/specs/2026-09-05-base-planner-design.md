# Base planner ("Base" tab) — design

Date: 2026-09-05. Status: draft for model-iq critique; built autonomously on the user's instruction ("build and design a base upgrade tab so we can see how and what needs to upgrade it and get stellarium, so I can start building the right resources; release in about a week").

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
- **Unlock cost in stellarium** with N modules already unlocked:
  `stellariumCost(N) = Σ_{n=1..N} i(n)`, `i(n) = n × (n ≥ 100 ? 2^(floor((n−100)/50)+1) : 1)`
  (= N(N+1)/2 for N < 100). The first module (Stellarium miner) is free with founding.
- **Tier cost** for going from tier t to t+1: `i(t+1)` stellarium (same curve).
- **Level cost** (cumulative to level L, in units of EACH of the module's materials):
  `t(L) = L(L+1)/2`; `f(L) = t(L)` for L ≤ 600, then the increments are
  multiplied by 2 up to 1000, 4 up to 1500, 8 up to 1750, 16 up to 2000, 64 beyond.
  Cost of one level L = f(L) − f(L−1) (= L for L ≤ 600).
- **Boost** = `(name ∈ {Quantum server, Laboratory enhancer} ? level/2 : level) × (1 + tier/100) × (1 + base_module_efficiency_boost/100)` (percent).
- **Output per production tick** = `base × (1 + floor(boost/100))` plus one extra `base`
  with probability `(boost mod 100)%`. Base amounts: Material generator 200, Metal scrap
  generator 1500, Resource miner 20,000, Fuel facility 5, all others 1.
  Expected output per tick = `base × (1 + boost/100)`.
- **Ticks**: passive modules charge upkeep every 10 minutes and produce on the sixth
  charge (hourly). The Stellarium miner produces every 5 hours; its base amount per
  production is the star's `stellarium_rate` (estimate: the bundle ties the rate to the
  star and the wiki says "every 5 hours"; treat as `rate × (1 + boost/100)` per 5 h).
- **Upkeep** per passive module per 10-minute tick (`BaseModuleCard`):
  `avgDaily = floor(lifetimeCredits / daysSinceRegistration)`;
  `charge = floor(avgDaily / 864 / passiveUnlockedCount) × (1 + boost/100) × (1 − pvpBaseBoost/100) × (1 − min(base_upkeep_reduction, cap)/100)`.
  Daily quests cover 15% each of the daily upkeep (5 quests = 75%). If a charge
  cannot be paid the module switches off.
- **Base-material buildings** (lab, "base" tier, bought with credits, cost shown only when
  the Laboratory panel is open — `LaboratoryStore.nextBaseCost`): Aeroforge (gold, ruby,
  sulfur, hydrogen → aerolite), Cryovault (silver, emerald, carbon, helium → cryovita),
  Ferric Mill (copper, sapphire, water, methane → ferricrystal), Prism Nexus (platinum,
  diamond, nitrogen, ammonia → luminaris), Rare Material Facility (argon, cobalt, dark
  matter, silicon → argoflux). Their `input`/`timer` are unknown until bought;
  **estimate** them as the tier-1 warp buildings (input 10,000, timer 45 s, level 0)
  and label every number derived from them "estimate".
- **Item booster** costs 300M credits base + 1 anomaly per use (not planned here).

## Data (`lib/cdp.js`)

Add to READ_ALL:

```
base: BaseBuildingStore.base (as-is, null until founded: { modules:[{ name, type, unlocked, level, tier, needs, tickCounter, ... }], stellarium, ... }),
baseLab: { buildings: LaboratoryStore.base (as-is), nextBaseCost, nextBuildingCost },
account: { registered: UserStore.registered, lifetimeCredits: Number(UserStore.player.statistics.credits.$numberDecimal) },
currentSystem: { star: ExploreStore.currentSystem.star, bodies: [{ type }] },
bookmarks: ExploreStore.bookmarks.map(b => ({ name: b.system.name, star: b.system.star, bodies: b.system.bodies.map(x => x.type) })),
```

`player.skills.base_module_efficiency_boost` and the equipped
`base_upkeep_reduction` total (default context) are already available.

## Engine

### `public/base-math.js` (pure, shared like `lab-math.js`)

- Constants: `MODULES` (the 11 entries above with `needs`, `materials`, `type`, `halfLevel`, `baseAmount`), `STAR_BONUSES`, `BODY_BONUSES`, `FOUNDING_BUNDLE`.
- `levelCostCumulative(L)`, `levelCost(L)`, `levelsCost(from, to)` (materials per material), `maxLevelsAffordable(level, budget)`.
- `stellariumStep(n)`, `stellariumUnlockCost(unlockedCount)`, `tierCost(tier)`, `tiersCost(from, to)`.
- `moduleBoost(module, efficiencyBoost)`, `expectedOutputPerTick(module, efficiencyBoost)`.
- `unlockOrder(modules)`: topological order by `needs` (stable, in the numbered order).
- `upkeepPerTick(avgDaily, passiveCount, boost, pvpBaseBoost, upkeepReduction)`; `upkeepPerDay` for a set of modules; `questsCoverage(claimedCount) = 0.15 × claimed`.
- `stellariumPerDay(starRate, boost) = starRate × (1 + boost/100) × (24/5)`.
- `planUnlocks(state)`: given `base` (or an all-locked virtual base when null), returns for each module in unlock order: `unlocked`, `stellariumCost` (i-curve), cumulative stellarium, and, with the miner's projected income, `daysToUnlock` cumulative.
- `materialsFor(targets)`: `targets = [{ module, toLevel }]` → per-material totals (`f(to) − f(current)` each), grouped by material, and for each material its producing lab building (`microcircuits`/`fusion cells` = warp chain; the five base materials = base buildings; `warp capsule` = the capsule chain).

### `lib/base.js` (adapter)

`planBase(state, opts)`:

- `phase`: `"pre"` (base null) or `"live"`.
- `founding`: from `lib/lab.js` (reuse `FOUNDING_BUNDLE` readiness) plus the location advice: current system star (rate/efficiency), best bookmarked star by rate, body-type bonus per activity, a one-line recommendation ("found on a rare-star system if you can find one: +33% stellarium vs an A-type").
- `unlocks`: from `planUnlocks`, with cumulative stellarium and ETA at the chosen star.
- `targets`: default `toLevel` per module from `opts.levels` (GUI box, default 50 for all unlocked-by-plan modules; localStorage), giving the **stockpile list**: material → needed / stock / short, and for each material the lab chain to produce the shortfall via `LabMath.planTarget` on a chain that is the live warp buildings plus ESTIMATED base buildings for the five base materials (flag `estimated: true` on those rows; when `baseLab.buildings` is non-empty the real ones replace the estimates).
- `upkeep`: avgDaily from `account`, `passiveCount` = planned passive modules, per-module boost at target levels, per hour and per day, quest coverage, and "credits/day net" versus avgDaily.
- `live` (phase live only): per unlocked module its next unlock/level/tier costs, expected output per tick, current boost; next unlock cost and ETA from real stellarium and the miner's current boost.
- Degraded: missing `account` or `lab` → still return `phase` and `founding`, other sections `null`.

## GUI: "Base" tab (`public/app.js`)

- Cards: phase (pre-release / founded), founding readiness (5/5), location advice (current star rate vs best), stellarium per day at the chosen star, upkeep per day at target levels vs average daily income (with quest coverage), total stellarium to unlock all 11 and ETA.
- Table "Modules" in unlock order: name, type, needs, materials, unlock cost (stellarium, cumulative), target level box (number input per row, saved in localStorage `advisor-base-levels`), level cost to target (per material), expected output per tick at target, upkeep per hour at target.
- Table "Stockpile": material → needed / stock / short / produced by (building, estimated flag) / chain hours for the shortfall / binding raw resource. Rows for the five base materials say "buy <building> first" when it is not in `baseLab.buildings`.
- Note lines: estimates flagged; "buy these base buildings now: Aeroforge, Cryovault, Ferric Mill, Prism Nexus (cost visible in-game on the Laboratory panel)".
- Tab badge: number of stockpile materials short for the target.
- Client-side recompute when a level box changes, using `window.BaseMath` + `window.LabMath` on payload data (chain, stocks, account).

## Tests (`test/base.test.js`)

- Level cost curve: `levelCost(1)=1`, `levelCost(600)=600`, `levelCost(601)=1202`, `levelCostCumulative(600)=180300`, `levelsCost(0,50)=1275`.
- Stellarium: `stellariumStep(99)=99`, `stellariumStep(100)=200`, `stellariumStep(150)=600`, `stellariumUnlockCost(3)=6`, cumulative for 10 unlocks = 55.
- Boost: Quantum server level 200 tier 10 eff 0 → 110; Resource miner level 250 → expected output 20000×3.5 per tick.
- Unlock order respects needs (Research lab after Quantum server, Craftron, Fuel facility).
- Upkeep: avgDaily 200M, 1 passive module, boost 0, no reductions → 231,481 per tick; 5 quests → 75% coverage.
- `planBase` pre-phase on a live-shaped state: founding ready, location advice names the best bookmarked star, stockpile lists microcircuits/fusion cells shortfalls for the default targets and flags aerolite rows as needing the Aeroforge.
- Degraded: no account → sections null, no throw.

## Out of scope

Item booster economics, PvP base boost tiles, dungeon material setups, market purchases. When the game populates `BaseBuildingStore.base` the live phase may need field-name fixes; the tab must degrade to the pre-phase view rather than fail.
