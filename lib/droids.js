// Droid survival math (from the game's own wiki text in the client bundle):
//   Every droid has a base 50% chance to dodge. Maneuverability adds dodge
//   in a 2:1 relation (100% maneuverability = +50% dodge). The "Droids dodge
//   chance" crafting mod on a laser or probe is additive with the base and
//   applies to every droid. A destroyed droid brings nothing back from that
//   action (it returns for free on the next one).
//   Efficiency and Storage add together and raise the COMMON resource
//   amount a droid brings back; rare resources ignore both.
// Expected common yield of the fleet is therefore
//   sum_i  dodge_i/100 * (1 + (efficiency_i + storage_i)/100)
// and dodge is capped at 100%, so past maneuverability = 100 - 2*modBonus
// more maneuverability is dead credits.

const DROID_BASE_DODGE = 50;
const DODGE_CAP = 100;
const MANEUVERABILITY_DODGE_RATIO = 0.5;

function droidDodge(maneuverability, modBonus) {
  return Math.min(DODGE_CAP, DROID_BASE_DODGE + (maneuverability || 0) * MANEUVERABILITY_DODGE_RATIO + (modBonus || 0));
}

// Maneuverability level at which dodge reaches the cap given the mods.
function maneuverabilityCap(modBonus) {
  return Math.max(0, (DODGE_CAP - DROID_BASE_DODGE - (modBonus || 0)) / MANEUVERABILITY_DODGE_RATIO);
}

function droidSurvival(droids, modBonus) {
  const cap = maneuverabilityCap(modBonus);
  const perDroid = (droids || []).map(d => {
    const m = d.maneuverability || 0;
    const dodge = droidDodge(m, modBonus);
    return {
      name: d.name,
      maneuverability: m,
      dodge: Math.round(dodge * 1000) / 1000,
      capped: dodge >= DODGE_CAP - 1e-9,
      breakdown: {
        base: DROID_BASE_DODGE,
        maneuverability: Math.round(m * MANEUVERABILITY_DODGE_RATIO * 1000) / 1000,
        mods: modBonus || 0,
      },
    };
  });
  const count = perDroid.length;
  const expectedAlive = perDroid.reduce((s, d) => s + d.dodge / 100, 0);
  return {
    modBonus: modBonus || 0,
    count,
    perDroid,
    avgDodge: count ? Math.round((perDroid.reduce((s, d) => s + d.dodge, 0) / count) * 1000) / 1000 : 0,
    expectedAlive: Math.round(expectedAlive * 1000) / 1000,
    maneuverabilityCap: cap,
    cappedCount: perDroid.filter(d => d.capped).length,
  };
}

// Expected common-resource yield of the fleet (relative units).
function expectedCommonYield(droids, modBonus) {
  return (droids || []).reduce((s, d) =>
    s + (droidDodge(d.maneuverability, modBonus) / 100) * (1 + ((d.efficiency || 0) + (d.storage || 0)) / 100), 0);
}

// Relative gain (%) in expected common yield when EVERY droid gets +delta
// on one skill. Numeric so the dodge cap is respected exactly.
function skillYieldMarginal(droids, modBonus, delta) {
  const base = expectedCommonYield(droids, modBonus);
  const out = {};
  for (const skill of ["efficiency", "storage", "maneuverability"]) {
    const bumped = (droids || []).map(d => ({ ...d, [skill]: (d[skill] || 0) + delta }));
    const gain = base > 0 ? (expectedCommonYield(bumped, modBonus) / base - 1) * 100 : 0;
    out[skill] = Math.abs(gain) < 1e-12 ? 0 : gain;
  }
  return out;
}

// Dodge-mod removal schedule. The end state is maneuverability 100 (dodge
// 100% with no mods at all), at which point every laser/probes dodge mod
// should be recrafted into a single "Rare Resource drop chance" (+10 rare
// instead of +5). On the way there mods can go one at a time: a mod is
// removable once the weakest droid still dodges 100% without it (and
// without the mods already scheduled for removal before it). Larger mods
// are scheduled first (they free the most rare-drop value).
//   mods: [{ slot, value }]   minManeuverability: the fleet's weakest droid
function dodgeModPlan(minManeuverability, mods) {
  const ordered = (mods || []).filter(m => m.value > 0)
    .sort((a, b) => (b.value - a.value) || (a.slot === "laser_slot" ? -1 : 1));
  const total = ordered.reduce((s, m) => s + m.value, 0);
  let removed = 0;
  return ordered.map(m => {
    removed += m.value;
    const remaining = total - removed;
    const removableAt = Math.max(0, (DODGE_CAP - DROID_BASE_DODGE - remaining) / MANEUVERABILITY_DODGE_RATIO);
    return { slot: m.slot, value: m.value, removableAt, removableNow: (minManeuverability || 0) >= removableAt - 1e-9 };
  });
}

module.exports = {
  dodgeModPlan,
  DROID_BASE_DODGE, DODGE_CAP, MANEUVERABILITY_DODGE_RATIO,
  droidDodge, maneuverabilityCap, droidSurvival, expectedCommonYield, skillYieldMarginal,
};
