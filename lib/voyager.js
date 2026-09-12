// Voyager upgrade planner: adapts the raw game state to the shared upgrade
// math in public/voyager-math.js and produces the `voyager` block of the
// analyze payload. The browser re-runs VoyagerMath.emulate on the same
// `current` + `stocks` + `bonuses` when the plan inputs change.
"use strict";
const VoyagerMath = require("../public/voyager-math.js");

// The voyager catalyst profile's totals as { stat: total }. `ctx` is the
// contextTotals.voyager array from advisor-core (stat, total, cap, ...).
function bonusesFromContext(ctx) {
  const by = {};
  for (const row of (Array.isArray(ctx) ? ctx : [])) by[row.stat] = row.total || 0;
  return {
    jumpsBonus: by.voyager_jumps_bonus || 0,
    fuelEfficiency: by.fuel_efficiency || 0,
    dropChance: by.catalyst_drop_chance || 0,
    cosmicDust: by.cosmic_dust_bonus || 0,
  };
}

function planVoyager(state, voyagerContext) {
  const v = state.voyager;
  const stocks = {
    dust: Number(state.dust) || 0,
    qc: Number(state.quantum_cores) || 0,
    credits: Number(state.credits) || 0,
  };
  const bonuses = bonusesFromContext(voyagerContext);
  const techRows = (state.tech && Array.isArray(state.tech.skills)) ? state.tech.skills : [];
  const techRow = techRows.find(s => s && s.key === "voyager_reward_boost");
  if (!v) {
    return { available: false, current: null, stocks, bonuses, techRewardLevel: techRow ? techRow.level : null };
  }
  const current = {
    timer: Number(v.timer) || 0,
    max_jumps: Number(v.max_jumps) || 0,
    reward_bonus: Number(v.reward_bonus) || 0,
    max_fuel: Number(v.max_fuel) || VoyagerMath.BASE_FUEL,
    current_fuel: Number(v.current_fuel) || 0,
  };
  const baseline = VoyagerMath.emulate(current, {}, stocks, bonuses);
  return {
    available: true,
    current, stocks, bonuses,
    techRewardLevel: techRow ? techRow.level : null,
    caps: {
      maxTimerUpgrade: VoyagerMath.MAX_TIMER_UPGRADE, minTimer: VoyagerMath.MIN_TIMER,
      baseTimer: VoyagerMath.BASE_TIMER, maxJumps: VoyagerMath.MAX_JUMPS,
      jumpsBonusCap: VoyagerMath.JUMPS_BONUS_CAP, fuelEffCap: VoyagerMath.FUEL_EFF_CAP,
    },
    stats: baseline.before,
    nextCost: baseline.nextCost,
    maxAffordable: baseline.maxAffordable,
  };
}

module.exports = { planVoyager, bonusesFromContext };
