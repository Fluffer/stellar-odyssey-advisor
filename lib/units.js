// Droid & clone upgrade advisor.

const { nonDamageModValue } = require("./ship-items.js");
const { droidSurvival, skillYieldMarginal, dodgeModPlan, maneuverabilityCap } = require("./droids.js");

// Exact port of the game's droid/clone upgrade cost (credits):
//   cost(level) = 5000 * level * e^(0.15 * level)   per +0.1% step
// The game steps levels in 0.1 increments and charges the cost of each step
// it passes (cumulativeDroidCost / cumulativeCloneCost in the game source).
// Upgrades are PER UNIT and PER SKILL; the game's "apply to all" mode simply
// charges the sum over every unit.
function unitStepCost(level) {
  return 5000 * level * Math.exp(0.15 * level);
}

// Total credits to raise one skill of one unit from `from` to `to` (%),
// stepping in 0.1 increments exactly like the game (toFixed(1) steps).
function cumulativeUnitCost(from, to) {
  let total = 0;
  for (let i = Number((from + 0.1).toFixed(1)); i <= to; i = Number((i + 0.1).toFixed(1))) {
    total += unitStepCost(i);
  }
  return total;
}

// How many whole +0.1% steps of ONE skill on ALL `count` units can be
// bought with `credits` (each step costs count x step cost).
function unitMaxStepsAll(level, credits, count) {
  let steps = 0, spent = 0;
  if (!count) return 0;
  for (;;) {
    const next = count * unitStepCost(Number((level + 0.1).toFixed(1)));
    if (spent + next > credits) break;
    spent += next;
    level = Number((level + 0.1).toFixed(1));
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

// Unit advisor: table of current droids/clones, upgrade costs, and the
// break-even analysis "upgrade skills to X% before buying the next unit".
// Purchase prices come from the game's getNextDroidPrice/getNextClonePrice
// responses (captured by the price listener installed from READ_ALL).
function planUnits(state) {
  const credits = state.credits || 0;
  const droids = (state.droids || []).map(d => ({
    name: d.name,
    efficiency: d.efficiency || 0,
    storage: d.storage || 0,
    maneuverability: d.maneuverability || 0,
  }));
  const clones = (state.player && state.player.clones ? state.player.clones : []).map(c => ({
    name: c.name,
    critical_chance: c.critical_chance || 0,
    critical_damage: c.critical_damage || 0,
    dual_shot: c.dual_shot || 0,
  }));
  const prices = state.prices || {};
  const droidCaptured = typeof prices.droid === "number";
  const cloneCaptured = typeof prices.clone === "number";
  const nextDroidPrice = droidCaptured ? prices.droid : unitPrice(droids.length + 1);
  const nextClonePrice = cloneCaptured ? prices.clone : unitPrice(clones.length + 1);

  const DROID_SKILLS = ["efficiency", "storage", "maneuverability"];
  const CLONE_SKILLS = ["critical_chance", "critical_damage", "dual_shot"];

  // Droid survival: dodge from base + maneuverability + the "Droids dodge
  // chance" mods on the equipped laser and probes (additive, all droids).
  const ship = state.ship || {};
  const dodgeModBonus = nonDamageModValue(ship.laser_slot, "Droids dodge chance") +
    nonDamageModValue(ship.probes_slot, "Droids dodge chance");
  const survival = droidSurvival(droids, dodgeModBonus);
  // End state: maneuverability at the no-mods cap (100) -> dodge mods can be
  // recrafted into single rare-drop mods. Schedule which item's mod can go
  // at which maneuverability level on the way there.
  const minManeuverability = droids.length ? Math.min(...droids.map(d => d.maneuverability || 0)) : 0;
  survival.noModsCap = maneuverabilityCap(0);
  survival.modPlan = dodgeModPlan(minManeuverability, [
    { slot: "laser_slot", value: nonDamageModValue(ship.laser_slot, "Droids dodge chance") },
    { slot: "probes_slot", value: nonDamageModValue(ship.probes_slot, "Droids dodge chance") },
  ]);
  survival.lastAction = state.gatherLast && typeof state.gatherLast.total === "number"
    ? { alive: state.gatherLast.alive, total: state.gatherLast.total } : null;
  // Relative expected-common-yield gain (%) for +0.1% of each skill on all
  // droids; maneuverability goes to 0 once every droid sits at 100% dodge.
  const droidYieldMarginal = skillYieldMarginal(droids, dodgeModBonus, 0.1);

  // Cost of raising `skill` by +delta% on ALL units (apply-to-all mode).
  const costAll = (units, skill, delta) =>
    units.reduce((sum, u) => sum + cumulativeUnitCost(u[skill], u[skill] + delta), 0);

  const buildRows = (units, skills, marginals) => skills.map(skill => {
    const level = units.length ? units[0][skill] : 0;
    const uneven = units.some(u => u[skill] !== level);
    const stepAll = units.reduce((s, u) => s + unitStepCost(Number((u[skill] + 0.1).toFixed(1))), 0);
    return {
      skill,
      level,
      uneven,
      costStepOne: unitStepCost(Number((level + 0.1).toFixed(1))),
      costStepAll: stepAll,
      costPlusOneAll: costAll(units, skill, 1),
      affordableStepsAll: unitMaxStepsAll(level, credits, units.length),
      // Marginal total damage when this skill goes +0.1% on every clone.
      marginalDamage: marginals
        ? Math.round(clones.reduce((s, c) => s + cloneSkillMarginal(skill, c), 0) * 0.1 * 100000) / 100000
        : null,
    };
  });

  const droidRows = buildRows(droids, DROID_SKILLS, null).map(r => {
    const marginalYield = Math.round(droidYieldMarginal[r.skill] * 1e6) / 1e6;
    return {
      ...r,
      marginalYield,
      // Credits per +1% expected common yield at the current level.
      creditsPerPctYield: marginalYield > 0 ? Math.round(r.costStepAll / marginalYield) : null,
    };
  });
  const droidBestSkill = droidRows
    .filter(r => r.creditsPerPctYield !== null)
    .sort((a, b) => a.creditsPerPctYield - b.creditsPerPctYield)
    .map(r => r.skill)[0] || null;
  const cloneRows = buildRows(clones, CLONE_SKILLS, true);

  // Linear break-even: the skill % at which raising any skill by +0.1% on
  // all units costs the same per skill-point as buying one more unit and
  // catching it up to that level.
  //   upgrade: stepCost(L)/0.1 credits per skill-point
  //   buy:     (price + 3*cumulative(0,L)) / (3*L) credits per skill-point
  const breakEven = (count, startLevel, price) => {
    if (!price || !count || !startLevel) return null;
    const diff = (L) =>
      unitStepCost(L + 0.1) / 0.1 -
      (price + 3 * cumulativeUnitCost(0, L)) / (3 * L);
    let lo = 0.1, hi = 300;
    if (diff(hi) < 0) return null; // upgrades always cheaper - no break-even
    if (diff(lo) > 0) return 0.1;  // already past break-even - buy is better
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2;
      if (diff(mid) < 0) lo = mid; else hi = mid;
    }
    return Math.round(((lo + hi) / 2) * 10) / 10;
  };

  // Clone damage analysis (analytic multipliers - the battle sim rates these
  // in levels; the multiplier ratio is the exact damage scale).
  const totalMult = clones.reduce((s, c) => s + cloneMultiplier(c), 0);
  const avgSkill = clones.length
    ? (cloneRows[0].level + cloneRows[1].level + cloneRows[2].level) / 3
    : 0;
  const upOnePct = clones.length
    ? clones.reduce((s, c) => s + cloneMultiplier({
        critical_chance: c.critical_chance + 1,
        critical_damage: c.critical_damage + 1,
        dual_shot: c.dual_shot + 1,
      }), 0)
    : 0;
  const eighthZero = clones.length ? totalMult + 1 : 0;      // new clone at 0% skills
  const eighthParity = clones.length ? totalMult + cloneMultiplier({ critical_chance: avgSkill, critical_damage: avgSkill, dual_shot: avgSkill }) : 0;

  const upgradeCostAllSkills = cloneRows.reduce((s, r) => s + r.costPlusOneAll, 0);
  const perPctUpgrade = upgradeCostAllSkills > 0 && upOnePct > totalMult
    ? upgradeCostAllSkills / ((upOnePct / totalMult - 1) * 100)
    : null;
  const cloneCatchUp = 3 * cumulativeUnitCost(0, avgSkill);
  const perPctBuy = nextClonePrice !== null && clones.length && eighthParity > totalMult
    ? (nextClonePrice + cloneCatchUp) / ((eighthParity / totalMult - 1) * 100)
    : null;

  // Damage-based break-even for clones: the all-skills level at which
  // +1% on every clone costs the same per point of damage as buying the
  // next clone and catching it up.
  const cloneDamageBreakEven = (() => {
    if (!nextClonePrice || !clones.length || !totalMult || !(eighthParity > totalMult)) return null;
    const buyGain = eighthParity - totalMult;
    const buyPerDmg = (nextClonePrice + cloneCatchUp) / buyGain;
    const upPerDmg = (L) => {
      const gain = clones.length * (cloneMultiplier({ critical_chance: L + 1, critical_damage: L + 1, dual_shot: L + 1 }) - cloneMultiplier({ critical_chance: L, critical_damage: L, dual_shot: L }));
      if (gain <= 0) return Infinity;
      return (clones.length * 3 * cumulativeUnitCost(L, L + 1)) / gain;
    };
    let lo = avgSkill, hi = 200;
    if (upPerDmg(hi) < buyPerDmg) return null;
    if (upPerDmg(lo) >= buyPerDmg) return Math.round(avgSkill * 10) / 10;
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2;
      if (upPerDmg(mid) < buyPerDmg) lo = mid; else hi = mid;
    }
    return Math.round(((lo + hi) / 2) * 10) / 10;
  })();

  return {
    credits,
    droids: {
      count: droids.length,
      rows: droidRows,
      list: droids,
      nextPrice: nextDroidPrice,
      priceSource: droidCaptured ? "captured" : "extrapolated",
      breakEvenLevel: breakEven(droids.length, droidRows[0] ? droidRows[0].level : 0, nextDroidPrice),
      catchUpCost: 3 * cumulativeUnitCost(0, droidRows[0] ? droidRows[0].level : 0),
      survival,
      bestSkill: droidBestSkill,
    },
    clones: {
      count: clones.length,
      rows: cloneRows,
      list: clones,
      nextPrice: nextClonePrice,
      priceSource: cloneCaptured ? "captured" : "extrapolated",
      breakEvenLevel: breakEven(clones.length, avgSkill, nextClonePrice),
      damageBreakEvenLevel: cloneDamageBreakEven,
      catchUpCost: cloneCatchUp,
      damage: {
        totalMultiplier: Math.round(totalMult * 1000) / 1000,
        plusOnePctAll: Math.round(((upOnePct / totalMult - 1) * 100) * 100) / 100,
        eighthAtZero: Math.round(((eighthZero / totalMult - 1) * 100) * 100) / 100,
        eighthAtParity: Math.round(((eighthParity / totalMult - 1) * 100) * 100) / 100,
        perPctUpgradeCost: perPctUpgrade,
        perPctBuyCost: perPctBuy,
      },
    },
  };
}

module.exports = { unitStepCost, cumulativeUnitCost, unitMaxStepsAll, unitPrice, cloneMultiplier, cloneSkillMarginal, planUnits };
