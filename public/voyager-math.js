// Shared Voyager upgrade math. Loaded by lib/voyager.js (the engine, via
// require) and by the GUI's app.js (via a <script> tag, as
// window.VoyagerMath) so the upgrade emulator in the browser charges exactly
// what the game charges.
//
// Exact port of the game's Voyager cost module (stellarlib, index bundle):
//   travel time  : timerCost(t)  = 500 * t(t+1)/2   cosmic dust, t = seconds
//                  bought off the 1800 s base, at most 1200 (10 min floor)
//   max jumps    : jumpCost(j)   = 25 * (j+1)^2     quantum cores, 3..20
//   reward bonus : rewardCost(r) = 1e6 * (r+1)^2    credits, +1% per level
//   max fuel     : the k-th fuel unit past the 100 base costs 1+k quantum
//                  cores (totalFuelCostFromLevel)
// An upgrade from level a to b costs cost(b) - cost(a). The "how many can I
// afford" inverses are the game's own (getMax*Upgrades), kept verbatim.
//
// Wrapped in a function: every one of these files is a classic <script>
// sharing ONE global scope in the browser. Only window.VoyagerMath /
// module.exports leave this scope.
(function () {
const BASE_TIMER = 1800;          // seconds between waypoints, unupgraded
const MIN_TIMER = 600;
const MAX_TIMER_UPGRADE = 1200;   // BASE_TIMER - MIN_TIMER
const MAX_JUMPS = 20;
const BASE_FUEL = 100;
const JUMPS_BONUS_CAP = 15;       // catalyst voyager_jumps_bonus cap
const FUEL_EFF_CAP = 60;          // catalyst fuel_efficiency cap, percent
const CATALYST_PER_SYSTEM = 0.08; // wiki: 8% per system a Voyager discovers
const LY_PER_SYSTEM = 10;         // neighbouring systems are 10 LY apart

function timerCost(t) { return 500 * (t * (t + 1) / 2); }
function jumpCost(j) { return 25 * Math.pow(j + 1, 2); }
function rewardCost(r) { return 1e6 * Math.pow(r + 1, 2); }
// Game: totalFuelCostFromLevel(level, count). level = max_fuel - BASE_FUEL.
function fuelUpgradeCost(level, count) {
  if (count <= 0) return 0;
  const first = 1 + level, last = 1 + (level + count - 1);
  return Math.floor(count * (first + last) / 2);
}
function timerUpgradeCost(t, n) { return n > 0 ? timerCost(t + n) - timerCost(t) : 0; }
function jumpUpgradeCost(j, n) { return n > 0 ? jumpCost(j + n) - jumpCost(j) : 0; }
function rewardUpgradeCost(r, n) { return n > 0 ? rewardCost(r + n) - rewardCost(r) : 0; }

// Game: getMaxTimerUpgrades(dust, timer)
function rawMaxTimer(dust, t) {
  if (dust <= 0) return 0;
  const disc = Math.pow(2 * t + 1, 2) + 4 * dust / 250;
  return Math.max(0, Math.floor((-(2 * t + 1) + Math.sqrt(disc)) / 2));
}
// Game: getMaxJumpUpgrades(qc, max_jumps)
function rawMaxJumps(qc, j) {
  if (qc <= 0) return 0;
  const n = j + 1;
  return Math.max(0, Math.floor(-n + Math.sqrt(n * n + qc / 25)));
}
// Game: getMaxRewardUpgrades(credits, reward_bonus)
function rawMaxReward(credits, r) {
  if (credits <= 0) return 0;
  const n = r + 1;
  return Math.max(0, Math.floor(-n + Math.sqrt(n * n + credits / 1e6)));
}
// Game: getMaxFuelCostUpgrades(level, qc)
function rawMaxFuel(level, qc) {
  if (qc <= 0) return 0;
  const n = 2 * (1 + level) - 1;
  const disc = n * n + 8 * qc;
  if (disc < 0) return 0;
  let o = Math.floor((-n + Math.sqrt(disc)) / 2);
  if (o < 0) o = 0;
  if (fuelUpgradeCost(level, o) > qc) o = Math.max(0, o - 1);
  else if (fuelUpgradeCost(level, o + 1) <= qc) o += 1;
  return o;
}
// The affordable counts, clamped to the game's own maximums like its page does.
function maxTimerUpgrades(dust, t) { return Math.min(rawMaxTimer(dust, t), Math.max(0, MAX_TIMER_UPGRADE - t)); }
function maxJumpUpgrades(qc, j) { return Math.min(rawMaxJumps(qc, j), Math.max(0, MAX_JUMPS - j)); }
function maxRewardUpgrades(credits, r) { return rawMaxReward(credits, r); }
function maxFuelUpgrades(level, qc) { return rawMaxFuel(level, qc); }

function clampInt(v, lo, hi) {
  const n = Math.floor(Number(v));
  if (!isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

// What a Voyager configuration does per expedition and per day.
// bonuses: { jumpsBonus, fuelEfficiency, dropChance } from the voyager
// catalyst profile (jumps / percent / percent). Fuel assumes LY_PER_SYSTEM
// per jump; per-day figures assume expeditions re-queued back to back.
function stats(cfg, bonuses) {
  const b = bonuses || {};
  const travelSec = Math.max(MIN_TIMER, BASE_TIMER - (cfg.timer || 0));
  const jumpsBonus = Math.min(JUMPS_BONUS_CAP, Math.floor(b.jumpsBonus || 0));
  const jumps = (cfg.max_jumps || 0) + jumpsBonus;
  const fuelEff = Math.min(FUEL_EFF_CAP, Math.max(0, b.fuelEfficiency || 0));
  const fuelPerJump = LY_PER_SYSTEM * (1 - fuelEff / 100);
  const fuelPerExpedition = jumps * fuelPerJump;
  const maxFuel = cfg.max_fuel || 0;
  const systemsPerDay = 86400 / travelSec;
  return {
    travelSec, jumps, jumpsBonus,
    expeditionSec: jumps * travelSec,
    fuelPerJump, fuelPerExpedition,
    tankCovers: maxFuel >= fuelPerExpedition,
    jumpsTankCovers: fuelPerJump > 0 ? Math.floor(maxFuel / fuelPerJump) : Infinity,
    systemsPerDay,
    catalystsPerDay: systemsPerDay * CATALYST_PER_SYSTEM * (1 + Math.max(0, b.dropChance || 0) / 100),
    dustFactor: 1 + (cfg.reward_bonus || 0) / 100,
  };
}

// cur: { timer, max_jumps, reward_bonus, max_fuel } as the game stores them.
// plan: { timer, jumps, reward, fuel } counts of upgrades to buy.
// stocks: { dust, qc, credits }. Quantum cores are shared by the jump and
// fuel upgrades, so their affordability is judged on the sum.
function emulate(cur, plan, stocks, bonuses) {
  const c = cur || {};
  const p = plan || {};
  const s = stocks || {};
  const t = c.timer || 0, j = c.max_jumps || 0, r = c.reward_bonus || 0, f = c.max_fuel || BASE_FUEL;
  const level = f - BASE_FUEL;
  const n = {
    timer: clampInt(p.timer, 0, Math.max(0, MAX_TIMER_UPGRADE - t)),
    jumps: clampInt(p.jumps, 0, Math.max(0, MAX_JUMPS - j)),
    reward: clampInt(p.reward, 0, 1e6),
    fuel: clampInt(p.fuel, 0, 1e9),
  };
  const costs = {
    dust: timerUpgradeCost(t, n.timer),
    qcJumps: jumpUpgradeCost(j, n.jumps),
    qcFuel: fuelUpgradeCost(level, n.fuel),
    credits: rewardUpgradeCost(r, n.reward),
  };
  costs.qc = costs.qcJumps + costs.qcFuel;
  const after = { timer: t + n.timer, max_jumps: j + n.jumps, reward_bonus: r + n.reward, max_fuel: f + n.fuel };
  return {
    plan: n, costs,
    affordable: {
      dust: costs.dust <= (s.dust || 0),
      qc: costs.qc <= (s.qc || 0),
      credits: costs.credits <= (s.credits || 0),
    },
    before: stats(c, bonuses),
    after: stats(after, bonuses),
    afterConfig: after,
    maxAffordable: {
      timer: maxTimerUpgrades(s.dust || 0, t),
      jumps: maxJumpUpgrades(s.qc || 0, j),
      reward: maxRewardUpgrades(s.credits || 0, r),
      fuel: maxFuelUpgrades(level, s.qc || 0),
    },
    nextCost: {
      timer: t < MAX_TIMER_UPGRADE ? timerUpgradeCost(t, 1) : null,
      jumps: j < MAX_JUMPS ? jumpUpgradeCost(j, 1) : null,
      reward: rewardUpgradeCost(r, 1),
      fuel: fuelUpgradeCost(level, 1),
    },
  };
}

const VoyagerMath = {
  BASE_TIMER, MIN_TIMER, MAX_TIMER_UPGRADE, MAX_JUMPS, BASE_FUEL, JUMPS_BONUS_CAP, FUEL_EFF_CAP,
  CATALYST_PER_SYSTEM, LY_PER_SYSTEM,
  timerCost, jumpCost, rewardCost, fuelUpgradeCost,
  timerUpgradeCost, jumpUpgradeCost, rewardUpgradeCost,
  maxTimerUpgrades, maxJumpUpgrades, maxRewardUpgrades, maxFuelUpgrades,
  stats, emulate,
};
if (typeof window !== "undefined") window.VoyagerMath = VoyagerMath;
if (typeof module !== "undefined" && module.exports) module.exports = VoyagerMath;
})();
