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
  voyager ← exploring ← default). On the laser and probes that chain means a Voyager
  expedition reads their **exploring** group, which the game labels "Exploring & Voyager"
  and the advisor now labels the same. Note that label covers the *profile*, not the dust:
  a measured expedition paid exactly `owl × premium × raw` — an expedition gets neither
  the Cosmic dust catalyst nor the exploring cosmic-dust skill, only its own reward bonus
  and voyager tech skill. Each activity card lists only the stats that matter
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
  can be recrafted into a single "Rare Resource drop chance" mod (+10 rare instead of +5).
  A **cost emulator** per group answers "what does taking these to X% cost?": set a target
  per skill (or all three at once) and it shows the cost for one individual unit and for
  the whole group, the per-unit breakdown, the total against your credit pile, the highest
  target your credits actually cover for each skill, and what a newly bought unit would
  cost to buy and catch up to the same targets. Targets are remembered in the browser
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
- **Node.js 22 or newer** — no npm dependencies, standard library only, nothing to install.
  The version matters: the CDP client uses Node's built-in `WebSocket`, which only exists
  from Node 22. On anything older the server refuses to start and says so.
- **Stellar Odyssey** (Steam version)

## Setup: none needed

The advisor talks to the running game through the Chrome DevTools Protocol. The Steam
build **already exposes a DevTools port** — it opens one on every start without any
launch option, on a random high port that changes each time. The advisor enumerates
listening ports and identifies the game by asking each page whether it exposes the game's
Pinia stores, so the changing port does not matter. Just start the game and run the
advisor.

Verified on the current Steam build: no Steam launch options set, no
`--remote-debugging-port` on the game's command line, port open regardless (60465 on one
run, different on the next).

If a future patch turns that off, `node diagnose-connection.js` will say so, and you can
pin a port yourself: **Library → right-click Stellar Odyssey → Properties → General →
Launch Options**, enter `%command% --remote-debugging-port=8788`, and start the game
**from Steam** (a desktop shortcut does not inherit `%command%`). Any free port works;
just not 8787, which the advisor's own web GUI uses.

The debug port only exposes the game's internal UI state on `127.0.0.1` — nothing is
opened to the network.

## Running it

Make sure the game is running and you are logged in (the main screen must be loaded).

```
node advisor-server.js
```

Then open **http://localhost:8787** and click **Analyze now**
(there is also an auto-refresh checkbox with an interval in minutes next to it — 60 by
default, anything from 1 to 1440). Both the interval and the checkbox are remembered
between sessions. On load the page shows the most recent snapshot immediately (marked as
stale) until you analyze fresh; if auto-refresh was left on, that snapshot's age counts
towards the interval, so reopening the page only analyzes straight away when one was
already due.

### Language

The GUI ships in **English and Simplified Chinese**. The selector in the toolbar switches
between them instantly — no reload, no re-analysis — and the choice is remembered in
`localStorage` (`advisor-lang`). A browser whose language starts with `zh` opens in
Chinese by default; everything else opens in English.

Every user-facing string lives in `public/i18n.js` as a key in two catalogues, looked up
by `t('key')` at render time. Numbers are deliberately *not* re-localised: `1,234,567`
grouping and the `K`/`M`/`B`/`T` suffixes stay the same in both languages, because they
are read side by side with the game's own figures. `node check-page.js` fails if the GUI
uses a key that no catalogue defines, or if an English string has no Chinese translation.

The Chinese wording follows **the game's own `zh-CN` locale**, not a fresh translation:
the game ships English, Spanish and Simplified Chinese catalogues in its bundle, and the
advisor's game-domain vocabulary (rarities, currencies, activities, ship slots, base
modules, materials) was taken from there so the two screens read the same. Where the
game's own Chinese is inconsistent — Stellarium appears as 星辰矿石, 星晶 and 星辉晶 in
different panels — the advisor uses the name of the thing itself. Advisor-only concepts
that the game has no term for (the upgrade-cost emulator, the snapshot history, the
win-rate probe metric) are translated on their own.

Adding a third language means adding one catalogue object to `public/i18n.js`, listing it
in `LANGS`/`LANG_NAMES`, and adding an `<option>` in `public/index.html`.

### Extras

- `node check-page.js` — sanity check: syntax-checks the GUI scripts in `public/`,
  verifies `index.html` references them, and checks the i18n catalogues (every key the
  GUI uses exists, every English string is translated, no stale translations) — useful
  after editing the GUI code
- `node diagnose-connection.js` — walks every stage of the connection to the game and
  reports which stage fails and how to fix it (see below)

### Troubleshooting: "game not found"

Discovery does not depend on the game's name. It enumerates every listening TCP port
with its owning process, tries the most game-like candidates first (exact process name,
then a path mentioning the game, then anything under `steamapps`, then any windowed
`.exe`), and confirms a candidate by asking the page itself whether it exposes the game's
Pinia stores. So a renamed executable, a non-Steam copy, or playing in another language
all still resolve — the game is one Electron build that switches language in-app, so the
process stays `Stellar Odyssey.exe` regardless.

The error message names the stage that failed:

- *could not enumerate listening ports* — PowerShell or `Get-NetTCPConnection` is blocked
- *no debug port found* — the game normally opens a DevTools port on its own, so this
  means it is not running, or a patch disabled it. If it persists, pin a port with the
  Steam launch option `%command% --remote-debugging-port=8788` and start the game **from
  Steam** (a desktop shortcut does not inherit `%command%`)
- *a debug port is open but no page on it is the game* — log in and get past the loading
  screen, then retry

If it fails before any of that with `WebSocket is not defined`, the Node version is too
old — see Requirements.

## Notes and limits

- **Base upkeep is billed hourly on the `statistics.credits` counter**, not on recent or
  battle income: the game's own base module card divides `player.statistics.credits` by the
  age of the account in days, and the advisor mirrors that formula exactly. A module ticks
  once an hour (the card counts down `60 - tickCounter*10` minutes and labels both output
  and upkeep per hour), so the formula's output is an hourly charge — 24 a day, not one per
  10-minute worker run. Nothing in-game lowers it except the module efficiency boost, PvP
  base boost and catalyst upkeep reduction.
- **`statistics.credits` is not everything you have earned.** On this account it reads
  ~7.4B while the wallet holds ~12.6B, so it misses whole sources. Treat it as the game's
  billing counter, nothing more. Affordability is therefore shown against the *observed*
  rate — how fast credits actually grew across `snapshots/history.jsonl` — which needs at
  least an hour between two analyses before it appears. The upkeep share of the billing
  basis is deliberately **not** shown as a verdict: upkeep is linear in that basis, so the
  ratio cancels out and reads the same at any income.
- **Daily quest coverage** shows as unknown until you open the daily quests panel in-game
  once: `DailyQuestsStore` is empty before that, so "nothing claimed" and "not loaded" are
  indistinguishable in the raw state. While unknown, no coverage is applied, so the net
  upkeep shown is a worst case (each claimed daily cuts it 15%, up to 75%).
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
| `public/i18n.js` | GUI string catalogue (English + Simplified Chinese) and the `t()` lookup runtime |
| `public/pet-math.js` | Shared pet formulas used by both the engine and the GUI |
| `public/lab-math.js` | Shared laboratory chain math used by both the engine and the GUI |
| `public/base-math.js` | Shared base-building math (module table, cost curves, upkeep, planBase) |
| `public/unit-math.js` | Shared droid/clone upgrade-cost math and the cost emulator, used by both the engine and the GUI |
| `lib/income.js` | Observed income rate from the history log |
| `check-page.js` | GUI file sanity checker |
| `diagnose-connection.js` | Connection diagnostic (why "game not found") |
| `package.json` | Metadata, `npm` scripts and the Node version floor |

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
