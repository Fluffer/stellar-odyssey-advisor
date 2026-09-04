# Stellar Odyssey Advisor

A read-only companion tool for the Steam game **Stellar Odyssey**. It reads the live game
state and computes optimal catalyst installs, merge chains, droid/clone upgrade strategy,
technology (skill) spending, and pet XP planning — including a battle simulator that
validates every gear suggestion against your actual win rates.

It never sends commands to the game. It only *reads* state through the game's debug
interface, so it cannot spend, craft, equip or change anything on your account.

## Features

- **Gear** — every equipped item with its catalyst groups per activity tab, effective
  values (including the 50% "halved" penalty for a duplicate stat in the same group)
- **Stats** — battle benchmark (the max NPC level you can beat at >= 98% win rate for all
  8 NPC types) plus a per-activity bonus panel showing what is *actually* active during
  each activity using the game's real activity-chain semantics (a non-empty activity
  group replaces the item's default group for that activity; empty groups inherit,
  voyager ← exploring ← default). Each activity card lists only the stats that matter
  there; every capped stat relevant to that activity is shown with current / cap — even
  at zero investment — with an inline fill bar and the wasted amount when over the cap,
  plus alerts for activity overrides that lose value vs what they replace
- **Installs** — an install/replace plan for your unequipped catalysts in two variants
  (full explore / full resources). Every battling suggestion is battle-simulated
  first: if it would drop your win rate, it is filtered out. Includes reinstall guidance
  when a catalyst should be pulled from another item, plus a what-if projection showing
  the max NPC level you'd reach per NPC type if the whole full-explore plan were applied.
  Every action on a capped stat shows that stat's total in the tab before → after / cap
- **Inventory** — every unequipped catalyst in one sortable, filterable table (stat,
  rarity, range, activity, value), tagged with what it's already earmarked for (an
  install or a merge group) and, for the rest, a sell advisor that flags catalysts too
  weak to feed a merge that stays on the perfect-legendary path
- **Merges** — merge chains toward *perfect legendaries* (range 100): which 5-packs to
  merge, success chances, protect-extra recommendations, quantum core costs, and the input
  quality tiers required to stay on the perfect path
- **Droids & Clones** — per-skill upgrade costs, clone damage multipliers, the
  break-even analysis "upgrade existing units to X% vs buy the next unit", and droid
  survival: exact dodge chance per droid (50% base + maneuverability ÷ 2 + dodge mods,
  capped at 100%), expected droids alive per action vs the last real action, credits per
  +1% expected yield for each droid skill so you know which one to buy first, and the
  road to the no-mods end state: at which maneuverability each laser/probes dodge mod
  can be recrafted into a single "Rare Resource drop chance" mod (+10 rare instead of +5)
- **Technology** — all skills with costs, a battle-simulated ranking of the four combat
  skills (levels gained per quantum core), the optimal way to spend the cores you have,
  per-skill cores-to-max, and an account-wide max-out counter with a time-to-cover
  estimate from your (editable) quantum core income rate
- **Pets** — XP per hour and time-to-next-level for every pet, the food decay/auto-feed
  cycle model, XP boost upgrade costs (paid in all 16 common resources), and an
  interactive simulator (boost level, auto-feed threshold, account-wide pet food burn).
  If you have a Korin pet, a **Korin advisor** shows its dust cost per warp-capsule
  enhancement, capsule stock, how many you can afford right now, the fuel and engine
  cooldown bonuses an enhanced capsule gives, and the next-level preview
- **Materials** — every blueprint's material requirements weighted across all copies
  and charges you own (plus the unweighted per-craft cost), checked against your current
  material stock. Split into NPC drop materials (with which NPC and location to farm),
  laboratory-produced materials, and everything else, with deficits called out
- **Lab** — bottleneck planner for the Laboratory chain: set a warp-capsule target and
  see, from the live buildings and your stock, which raw resource binds (coverage bars),
  how many units each building must run and for how long, the chain time both pipelined
  (claim and re-queue every 10 minutes) and sequential, which building level buys the
  most time per credit (1.15M × level, 0.1 s per level down to the 5 s floor), the best
  affordable speed multiplier, and base-founding readiness (5,000 each of the five
  intermediates) with the capsule chain time after founding; the target counts capsules
  on top of what you already hold
- **Base** — base-building planner. Before founding: founding readiness, which star to
  found under (stellarium rate per star type), the unlock order with stellarium cost per
  module and an estimated timeline, per-module target levels with the exact material cost
  (charged from each of the module's materials), the stockpile list with shortfalls and lab
  chain times, which base-tier lab buildings to buy first, and the upkeep bill at the
  targets as a share of your average daily income. After founding: the live module table
  with boost, output, next level and tier cost, and the next unlock's ETA
- **Item advisor** (Gear tab) — per-slot ship item analysis: how many levels behind the
  matching skill (battling/gathering/exploring) each item's craft-time level is and what
  recrafting now would cap its value at, weapon/shield NPC-weakness mod coverage, an engine
  cooldown breakdown against the hard 5-minute floor (engine value + crafted mods + Korin
  + the purchased global Cooldown boost, whose tier decays with its remaining time — the
  advice distinguishes "floored only while the boost lasts" from "floored permanently"),
  the scan reward multiplier, and an exact droid-dodge check: dodge = 50% base +
  maneuverability ÷ 2 + "Droids dodge chance" mods, capped at 100%, so each dodge mod
  carries the maneuverability level at which it can go, and is flagged to recraft once
  the droids no longer need it
- **History** — every analysis is snapshotted; trend charts for battle benchmark,
  crafting level, currencies, catalyst counts and pet levels

## Requirements

- **Windows** (game-process discovery uses PowerShell)
- **Node.js 22 or newer** — no npm dependencies, standard library only, nothing to install
- **Stellar Odyssey** (Steam version)

## One-time setup: start the game with debugging enabled

The advisor talks to the running game through the Chrome DevTools Protocol, which is only
active when the game is launched with a debug port:

1. In Steam: **Library → right-click Stellar Odyssey → Properties**
2. Under **General**, find **Launch Options**
3. Enter:
   ```
   %command% --remote-debugging-port=8788
   ```
4. Close the properties window and start the game normally.

Any free port works — the advisor auto-detects the port on every run, so the game's port
changing between restarts is fine. Just don't pick a port something else is using
(8788 is free by default; the advisor's own web GUI uses 8787).

The debug port only exposes the game's internal UI state on `127.0.0.1` — nothing is
opened to the network.

## Running it

Make sure the game is running and you are logged in (the main screen must be loaded).

```
node advisor-server.js
```

Then open **http://localhost:8787** and click **Analyze now**
(there is also an auto-refresh-every-60s checkbox). On load the page shows the most
recent snapshot immediately (marked as stale) until you analyze fresh.

### Extras

- `node check-page.js` — sanity check: syntax-checks the GUI scripts in `public/` and
  verifies `index.html` references them (useful after editing the GUI code)

## Notes and limits

- **Droid/clone purchase prices**: until you open the Gathering/Battling trainer pages
  the advisor uses the known curve (every unit costs 10× the previous one, the 8th costs
  100B, i.e. 10^(n+3) credits) and marks the price "(curve)". Opening a trainer page once
  while the GUI runs captures the game's own figure, which then takes precedence.
- The game window must stay on the logged-in character; re-run **Analyze now** after
  changing gear, skills or pets in-game.
- All game formulas (merge chances, upgrade costs, pet XP, slot mechanics) were extracted
  from the game's JavaScript bundle, so the numbers match the game exactly.
- Windows-only for now (process/port discovery via PowerShell).
- Analysis snapshots are stored in `snapshots/`, newest 50 kept; `history.jsonl` keeps
  the long-term trend data.
- Analysis runs in a background worker thread, so the GUI stays responsive during the
  30-90s battle simulation.

## Files

| File | Purpose |
| --- | --- |
| `advisor-server.js` | Web GUI server (port 8787), serves `public/` |
| `advisor-core.js` | Analysis pipeline facade (see `lib/`) |
| `lib/` | Engine modules (constants, value math, CDP reader, install/merge planners, battle rating, units/tech/pets/materials/ship-items advisors) |
| `lib/lab.js` | Lab planner adapter (game state → shared chain math) |
| `lib/base.js` | Base planner adapter |
| `advisor-battle.js` | Battle simulator (ported from the game's battle code) |
| `public/index.html` | GUI page skeleton |
| `public/style.css` | GUI styles |
| `public/app.js` | GUI client-side rendering and the pet simulator |
| `public/pet-math.js` | Shared pet formulas used by both the engine and the GUI |
| `public/lab-math.js` | Shared laboratory chain math used by both the engine and the GUI |
| `public/base-math.js` | Shared base-building math (module table, cost curves, upkeep, planBase) |
| `check-page.js` | GUI file sanity checker |

## Tests

`test/` contains golden-value tests that lock the current behavior of the ported game
formulas (catalyst value math, merge/install planners, unit/tech planners, pet XP math,
and the battle simulator). They exist so a refactor — or a game update that silently
changes a formula — gets caught immediately instead of producing subtly wrong advice.

Run them with:

```
node --test
```

This uses only the Node.js built-in test runner (`node:test`) and `node:assert/strict` —
no npm dependencies, matching the rest of the project. Node auto-discovers every
`test/*.test.js` file, so no arguments are needed.

Note: on this Windows/Node build, `node --test test/` (passing the directory explicitly)
fails with `MODULE_NOT_FOUND` — an apparent Node directory-argument resolution quirk,
unrelated to this project's code. The no-argument form above works reliably; an explicit
glob (`node --test "test/*.test.js"`) also works if you need to target the folder
directly.

Each test file's header comment explains what it locks. Where a value is a "golden," it
was produced by running the current implementation and hardcoding the output — if that
number ever changes, the test failure is telling you the underlying game formula (or the
port of it) changed, so double-check which one is now correct before updating the golden.

## Disclaimer

Unofficial fan tool, not affiliated with or endorsed by the developer of Stellar Odyssey.
It is read-only by design, but use it at your own risk.
