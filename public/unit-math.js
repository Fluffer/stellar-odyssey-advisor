// Shared droid/clone upgrade-cost math. Loaded by lib/units.js (the engine,
// via require) and by the GUI's app.js (via a <script> tag, as
// window.UnitMath) so the cost emulator in the browser charges exactly what
// the advisor and the game charge.
//
// Exact port of the game's droid/clone upgrade cost (credits):
//   cost(level) = 5000 * level * e^(0.15 * level)   per +0.1% step
// The game steps levels in 0.1 increments and charges the cost of each step
// it passes (cumulativeDroidCost / cumulativeCloneCost in the game source).
// Upgrades are PER UNIT and PER SKILL; the game's "apply to all" mode simply
// charges the sum over every unit.
//
// Wrapped in a function: in the browser every one of these files is a classic
// <script> sharing ONE global scope, so a top-level `function levelCost` here
// and another in a sibling file silently overwrite each other.
// Only window.UnitMath / module.exports leave this scope.
(function () {
const UNIT_STEP = 0.1;
const UNIT_COST_BASE = 5000;
const UNIT_COST_GROW = 0.15;

function unitStepCost(level) {
  return UNIT_COST_BASE * level * Math.exp(UNIT_COST_GROW * level);
}

// Round to the game's 0.1 grid (levels are only ever multiples of 0.1).
function unitStepRound(level) {
  return Number((Math.round((Number(level) || 0) * 10) / 10).toFixed(1));
}

// Total credits to raise one skill of one unit from `from` to `to` (%),
// stepping in 0.1 increments exactly like the game (toFixed(1) steps).
function cumulativeUnitCost(from, to) {
  let total = 0;
  for (let i = Number((from + UNIT_STEP).toFixed(1)); i <= to + 1e-9; i = Number((i + UNIT_STEP).toFixed(1))) {
    total += unitStepCost(i);
  }
  return total;
}

// How many whole +0.1% steps of ONE skill on ALL `count` units can be
// bought with `credits` (each step costs count x step cost).
function unitMaxStepsAll(level, credits, count) {
  let steps = 0, spent = 0;
  if (!count) return 0;
  if (!isFinite(Number(credits)) || Number(credits) <= 0) return 0;
  for (;;) {
    const next = count * unitStepCost(Number((level + UNIT_STEP).toFixed(1)));
    if (spent + next > credits) break;
    spent += next;
    level = Number((level + UNIT_STEP).toFixed(1));
    steps++;
    if (steps > 10000) break;
  }
  return steps;
}

// Purchase price of the n-th droid or clone (1-based). Player-verified
// curve: every unit costs 10x the previous one and the 8th costs 100B, so
// price(n) = 10^(n+3) (1st = 10,000). Used when the trainer page has not
// been opened yet (no captured getNextDroidPrice/getNextClonePrice).
function unitPrice(n) {
  return Math.pow(10, n + 3);
}

// Expected damage multiplier of one clone (game formula):
//   (1 + critChance/100 * (30 + critDamage)/100) * (1 + dualShot/100)
function cloneMultiplier(c) {
  return (1 + (c.critical_chance / 100) * ((30 + c.critical_damage) / 100)) * (1 + c.dual_shot / 100);
}

// Marginal damage of +1% on a single clone skill (analytic partials).
function cloneSkillMarginal(skill, c) {
  const cc = c.critical_chance, cd = c.critical_damage, ds = c.dual_shot;
  if (skill === "dual_shot") return (1 + (cc / 100) * ((30 + cd) / 100)) / 100;
  if (skill === "critical_chance") return (((30 + cd) / 100) / 100) * (1 + ds / 100);
  return ((cc / 100) / 100) * (1 + ds / 100);
}

// ---- cost emulator ----
// One skill of a group of units taken to a common `target` level. A unit
// already at or above the target costs nothing; the rest each pay their own
// cumulative cost from where they stand, which is what the game charges
// whether the steps are bought one unit at a time or with "apply to all".
function groupUpgradeCost(units, skill, target) {
  const to = unitStepRound(target);
  const perUnit = (units || []).map(u => {
    const from = unitStepRound(u[skill]);
    return {
      name: u.name,
      from,
      to,
      steps: to > from ? Math.round((to - from) * 10) : 0,
      cost: to > from ? cumulativeUnitCost(from, to) : 0,
    };
  });
  return {
    skill,
    target: to,
    perUnit,
    total: perUnit.reduce((s, p) => s + p.cost, 0),
    unitsUpgraded: perUnit.filter(p => p.cost > 0).length,
  };
}

// Highest common target for one skill that `credits` still covers for the
// whole group, walking the same 0.1 grid the game charges on.
function maxAffordableTarget(units, skill, credits) {
  const levels = (units || []).map(u => unitStepRound(u[skill]));
  if (!levels.length) return { target: 0, cost: 0 };
  // A non-finite budget must buy NOTHING: every `spent + inc > credits`
  // comparison is false against NaN, so the walk would run to its 500 guard
  // and report an absurd target as affordable.
  const budget = Number(credits);
  if (!isFinite(budget) || budget <= 0) return { target: Math.min.apply(null, levels), cost: 0 };
  let target = Math.min.apply(null, levels);
  let spent = 0;
  for (;;) {
    const next = Number((target + UNIT_STEP).toFixed(1));
    const inc = levels.reduce((s, l) => s + (l < next - 1e-9 ? unitStepCost(next) : 0), 0);
    if (spent + inc > budget) break;
    spent += inc;
    target = next;
    if (target > 500) break;
  }
  return { target, cost: spent };
}

// Every skill of a group taken to its own target, with the per-unit and
// per-skill breakdown and the total measured against the credit pool.
function emulateGroup(units, skills, targets, credits) {
  const bySkill = skills.map(s => groupUpgradeCost(units, s, targets[s]));
  const total = bySkill.reduce((s, r) => s + r.total, 0);
  const perUnit = (units || []).map((u, i) => ({
    name: u.name,
    costs: skills.reduce((acc, s, si) => { acc[s] = bySkill[si].perUnit[i].cost; return acc; }, {}),
    total: bySkill.reduce((s, r) => s + r.perUnit[i].cost, 0),
  }));
  return {
    bySkill,
    perUnit,
    total,
    credits,
    leftover: credits - total,
    affordable: total <= credits,
  };
}

const UnitMath = {
  UNIT_STEP, UNIT_COST_BASE, UNIT_COST_GROW,
  unitStepCost, unitStepRound, cumulativeUnitCost, unitMaxStepsAll, unitPrice,
  cloneMultiplier, cloneSkillMarginal,
  groupUpgradeCost, maxAffordableTarget, emulateGroup,
};
if (typeof module !== "undefined" && module.exports) module.exports = UnitMath;
if (typeof window !== "undefined") window.UnitMath = UnitMath;
})();
