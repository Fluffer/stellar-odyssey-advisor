# Stellar Odyssey Advisor

A read-only companion tool for the Steam game **Stellar Odyssey**. It reads the live game
state and computes optimal catalyst installs, merge chains, droid/clone upgrade strategy,
technology (skill) spending, pet XP planning, material deficits, and the laboratory, base
and Voyager upgrade paths — including a battle simulator that validates every gear
suggestion against your actual win rates.

It never sends commands to the game. It only *reads* state through the game's debug
interface, so it cannot spend, craft, equip or change anything on your account.

## Features

- **Gear** — every equipped item with its catalyst groups per activity tab and their
  effective values (a duplicate stat in the same group counts 50%, shown as "halved")
- **Stats** — the battle benchmark (the max NPC level you beat at >= 98% win rate, for
  all 8 NPC types) and a per-activity bonus panel: what is active during each activity
  under the game's activity-chain rules (a non-empty activity group replaces the item's
  default group for that activity; empty groups inherit, voyager ← exploring ← default,
  so a Voyager expedition reads the laser's and probes' "Exploring & Voyager" group).
  An expedition's dust is its own reward bonus and the voyager tech skill only; the
  Cosmic dust catalyst and the exploring cosmic-dust skill do not apply to it. Each
  activity card lists the stats that matter there with current / cap, a fill bar and
  the wasted amount when over the cap, plus alerts for activity overrides that lose
  value against what they replace
- **Installs** — an install/replace plan for the unequipped catalysts in two variants
  (full explore / full resources). Every battling suggestion is battle-simulated first
  and dropped if it would lower the win rate. Includes reinstall guidance when a catalyst
  should move from another item, and a what-if projection of the max NPC level per NPC
  type with the whole full-explore plan applied. Every action on a capped stat shows
  that stat's tab total before → after / cap
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
  affordable speed multiplier and, while the base is not founded yet, founding readiness
  (5,000 each of the five intermediates) with the capsule chain time after founding; the
  target counts capsules on top of what you already hold. A **production emulator**
  answers "how long does N of this take, and what do upgrades do to that?": pick any
  product the chain makes and an amount (on top of stock, optionally ignoring the
  intermediates you already hold), and it shows the chain time as it stands next to the
  time with your changes. Per building
  you set a scenario level (bounded by the live level and the 5 s floor) and a speed
  multiplier (x2..x10, which costs resources, not credits); the page shows the timer and
  time before and after per building, which buildings are tied at the top (they must all
  get faster for the chain to), the credit cost of the levels against your pile, the
  credits per hour saved, and the extra resources the multipliers eat. Buttons take every
  running building +10 / +50 / to the floor, and a **budget spend** lifts the whole tied
  group one level at a time until the credits run out. The scenario is remembered in the
  browser
- **Base** — base-building planner. Known systems (current + bookmarks) with their
  coordinates, distance from here and distance to the nearest starter system (the uncapped
  part of a discovery's dust value); a Stellarium section with yield per tick and per day,
  next tick, the unlock and tier cost curves, and every star type's rate. Before founding:
  founding readiness, which star to found under (stellarium rate per star type), the
  unlock order with stellarium cost per module and an estimated timeline, per-module
  target levels with the exact material cost (charged from each of the module's
  materials), the stockpile list with shortfalls and lab chain times, which base-tier lab
  buildings to buy first, and the upkeep bill at the targets as a share of your average
  daily income. After founding: the live module table with boost, output, next level and
  tier cost, and the next unlock's ETA
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
- **Voyager** — upgrade emulator: the four Voyager upgrades (travel time, max jumps, max
  fuel, reward bonus) with the game's own cost formulas, what the stock covers, and what a
  planned set of upgrades does to jumps per expedition, expedition duration, fuel need
  versus tank, systems and expected catalysts per day
- **History** — every analysis is snapshotted; trend charts for battle benchmark,
  crafting level, currencies, catalyst counts and pet levels

## Requirements

- **Windows** (game-process discovery uses PowerShell)
- **Node.js 22 or newer** — no npm dependencies, standard library only, nothing to install.
  The version matters: the CDP client uses Node's built-in `WebSocket`, which only exists
  from Node 22. On anything older the server refuses to start and says so.
- **Stellar Odyssey**: the Steam client, or the browser version with the bridge extension
  (see *Playing in a browser*)

## Setup: none needed

The advisor talks to the running game through the Chrome DevTools Protocol. The Steam
build **already exposes a DevTools port** — it opens one on every start without any
launch option, on a random high port that changes each time. The advisor enumerates
listening ports and identifies the game by asking each page whether it exposes the game's
Pinia stores, so the changing port does not matter. Just start the game and run the
advisor.

No Steam launch options are needed: the game's command line carries no
`--remote-debugging-port`, and the port is open regardless, on a different number each
run.

If a future patch turns that off, `node diagnose-connection.js` will say so, and you can
pin a port yourself: **Library → right-click Stellar Odyssey → Properties → General →
Launch Options**, enter `%command% --remote-debugging-port=8788`, and start the game
**from Steam** (a desktop shortcut does not inherit `%command%`). Any free port works;
just not 8787, which the advisor's own web GUI uses.

The debug port only exposes the game's internal UI state on `127.0.0.1` — nothing is
opened to the network.

## Playing in a browser instead of Steam

The game also runs as a web app at https://steam.stellarodyssey.app (same client,
same internal stores), and the advisor can read that too. A normal browser profile has
no DevTools port, so the bridge is a small extension in `bridge-extension/`:

1. In Edge or Chrome open `edge://extensions` / `chrome://extensions`, turn on
   **Developer mode**, click **Load unpacked** and pick the `bridge-extension` folder.
2. Open the game tab and log in. The extension badge turns `on` once it has pushed a
   state to the advisor.

A game tab that was already open when the extension was loaded is picked up as well, so
you do not have to reload the game or log in again. After editing anything in
`bridge-extension/`, press the reload icon on the extension's card.

From then on the extension pushes the game state every 30 seconds, and **Analyze now**
asks it for a fresh read first, so the data is live. When a browser is attached the
advisor prefers it over the Steam client; close the game tab to go back to reading the
Steam client. The status line under the buttons says which source the analysis used.
`node diagnose-connection.js` reports the bridge state first. If the DevTools read of
the Steam client fails, a browser push from the last five minutes is used instead.

### Letting the extension start the server

An extension cannot start a program, but the browser may start a registered *native
messaging host* for it. `bridge-extension/native-host/` is such a host: asked by the
extension, it checks whether the advisor answers on port 8787 and starts
`advisor-server.js` detached when it does not (output goes to `advisor-server.log` and
`advisor-server.err.log`). Register it once for your user account, no admin rights
needed:

```
node bridge-extension/native-host/install.js
```

This writes a host manifest with this machine's paths next to the launcher and points
Edge and Chrome to it in the registry (`HKCU`). From then on the extension starts the
server whenever it finds it down: on browser start, when the game tab loads, and on its
30-second check. So with the game open in the browser there is nothing to start by
hand. `install.js --uninstall` removes the registration.

Once the server answers, the extension also opens the advisor page in a tab, on
extension load and on browser start, unless it is already open; the 30-second check never
opens one, so a tab you closed stays closed. Clicking the extension icon opens or focuses
the advisor tab.

The registration is tied to the extension's ID, which for an unpacked extension the
browser derives from the folder path. `install.js` computes that ID the same way; if the
extension's badge shows `id`, compare with the ID on `edge://extensions` and rerun
`install.js <that-id>`. Moving the folder changes the ID.

**Badge meanings:** `on` state pushed; `tab` no game tab open; `err` the page did not
answer (not logged in, or the tab needs a reload); `srv` the advisor server is not
running and could not be started; `host` the native host is not registered; `id` it is
registered for a different extension ID.

The alternative without an extension is a dedicated browser profile started with a
DevTools port, which discovery then finds like the Steam client:

```
msedge --remote-debugging-port=9333 --user-data-dir=%LOCALAPPDATA%\StellarOdysseyAdvisor\edge-profile https://steam.stellarodyssey.app/
```

(Current browsers refuse a debug port on the default profile, hence the separate one; you
log in once in that profile.)

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
  verifies `index.html` references them, checks the i18n catalogues (every key the
  GUI uses exists, every English string is translated, no stale translations), and fails
  if two GUI scripts declare the same top-level name (they are classic `<script>` tags
  sharing one global scope, so the later one silently replaces the earlier; the shared
  `*-math.js` files are wrapped in a function for that reason) — useful after editing
  the GUI code
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

When you play in a browser, "game not found" is expected from the DevTools stages: the
state comes from the bridge extension instead (see *Playing in a browser*). The error
then ends with *no browser bridge attached either*, and `diagnose-connection.js` shows
the bridge status as its first stage.

## Notes and limits

- **Base upkeep is billed hourly on the `statistics.credits` counter**, not on recent or
  battle income: the game's own base module card divides `player.statistics.credits` by the
  age of the account in days, and the advisor mirrors that formula exactly. A module ticks
  once an hour (the card counts down `60 - tickCounter*10` minutes and labels both output
  and upkeep per hour), so the formula's output is an hourly charge — 24 a day, not one per
  10-minute worker run. Nothing in-game lowers it except the module efficiency boost, PvP
  base boost and catalyst upkeep reduction.
- **`statistics.credits` is not everything you have earned.** It can sit far below the
  wallet, so it misses whole sources. Treat it as the game's billing counter, nothing
  more. Affordability is therefore shown against the *observed* rate — how fast credits
  actually grew across `snapshots/history.jsonl` — which needs at least an hour between
  two analyses before it appears. The upkeep share of the billing
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
| `lib/systems.js` | Starter systems, plane distances, per-system coordinate facts |
| `advisor-battle.js` | Battle simulator (ported from the game's battle code) |
| `public/index.html` | GUI page skeleton |
| `public/style.css` | GUI styles |
| `public/app.js` | GUI client-side rendering and the pet simulator |
| `public/i18n.js` | GUI string catalogue (English + Simplified Chinese) and the `t()` lookup runtime |
| `public/pet-math.js` | Shared pet formulas used by both the engine and the GUI |
| `public/lab-math.js` | Shared laboratory chain math and the production emulator, used by both the engine and the GUI |
| `public/base-math.js` | Shared base-building math (module table, cost curves, upkeep, planBase) |
| `public/unit-math.js` | Shared droid/clone upgrade-cost math and the cost emulator, used by both the engine and the GUI |
| `public/voyager-math.js` | Shared Voyager upgrade costs (ported from the game) and the upgrade emulator, used by both the engine and the GUI |
| `lib/voyager.js` | Voyager planner adapter (game state + voyager catalyst profile → emulator inputs) |
| `lib/income.js` | Observed income rate from the history log |
| `lib/bridge.js` | Browser bridge state holder: pushed states, long-poll, fresh-read requests |
| `lib/analyze-worker.js` | Worker thread running the analysis, from DevTools or a pushed state |
| `bridge-extension/` | Browser extension (Edge/Chrome, unpacked) feeding the web build's state to the server; `page.js` is generated from `lib/cdp.js` by `build.js` |
| `bridge-extension/native-host/` | Native messaging host that starts the server on the extension's request, plus `install.js` to register it |
| `check-page.js` | GUI file sanity checker |
| `diagnose-connection.js` | Connection diagnostic (why "game not found") |
| `package.json` | Metadata, `npm` scripts and the Node version floor |

## Tests

`test/` contains golden-value tests that lock the current behavior of the ported game
formulas (catalyst value math, merge/install planners, unit/tech planners, pet XP math,
and the battle simulator), plus `bridge.test.js` for the browser bridge (including a
check that the generated `bridge-extension/page.js` matches the current reader). They exist so a refactor — or a game update that silently
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
