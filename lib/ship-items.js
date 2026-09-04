// Ship item (weapon/shield/engine/sensors/laser/probes) enhancement advisor.
//
// Item level is fixed at craft time to the matching skill's level then -
// recrafting at a higher skill level yields a higher item level. The value
// roll range at craft is MIN..MAX, with
//   MAX = 10 x (1 + 30% + craftingLevel%) x rarityMult x itemLevel
// (dungeon bonus omitted). We use this MAX as the cap a fully-optimized
// craft could reach, to gauge how close the current roll is.
//
// Two domain rules are modeled here beyond the extracted formulas:
//   1. Cooldown floor: engine jump cooldown has a hard 5-minute floor. Once
//      the cooldown-reduction score reaches the breakpoint for the player's
//      jump distance, more reduction is worthless and 'Scan reward boost'
//      is strictly better.
//   2. Droid dodge cap: dodge = 50 base + maneuverability/2 + dodge mods,
//      capped at 100% (lib/droids.js). A 'Droids dodge chance' mod is
//      flagged when the cap clips part or all of it - then 'Rare Resource
//      drop chance' is the better mod.

const {
  ITEM_CATEGORY, BATTLING_NPCS, SHIP_ITEM_RARITY_MULT, ITEM_MATCHING_SKILL,
} = require("./constants.js");

const { droidDodge, droidSurvival, dodgeModPlan } = require("./droids.js");

// Non-damage mod strength (engine/sensors cooldown & scan mods, laser/probes
// drop/dodge mods): a lone mod is worth +10, two mods (which must differ)
// split the strength to +5 each.
function nonDamageModValue(item, modName) {
  const bonuses = (item && item.bonuses) || [];
  if (!bonuses.includes(modName)) return 0;
  return bonuses.length <= 1 ? 10 : 5;
}
// Damage-type mod strength (weapon/shield): a lone mod is 30% vs the
// matching NPC weakness, two mods split to 15% each.
function damageModValue(item, dmgType) {
  const bonuses = (item && item.bonuses) || [];
  if (!bonuses.includes(dmgType)) return 0;
  return bonuses.length <= 1 ? 30 : 15;
}

// Value cap for a ship item of the given rarity/level at the current
// crafting level - the MAX end of the craft-time roll range (dungeon bonus
// omitted): 10 x (1.3 + craftingLevel/100) x rarityMult x itemLevel.
function valueMaxForLevel(craftLevel, rarity, level) {
  const mult = SHIP_ITEM_RARITY_MULT[rarity] || 1;
  return Math.round(10 * (1.3 + craftLevel / 100) * mult * level);
}

// The cooldown-reduction score d at which the jump cooldown at `distLy`
// hits the hard 5-minute floor. Past this point, more reduction (from the
// engine's value or from cooldown mods) is wasted at that distance.
function cooldownFloorBreakpoint(distLy) {
  return 100 * (1 - 300000 / (600000 * (1 + distLy / 100)));
}
// Jump cooldown at `distLy` for a given cooldown-reduction score d.
function cooldownAt(d, distLy) {
  const ms = Math.max(Math.floor(600000 * (1 + distLy / 100) * (1 - d / 100)), 300000);
  return { seconds: ms / 1000, floored: ms <= 300000 };
}

// Purchased global boost (Cooldown/XP/Income/'Drop chance'): tier from the
// REMAINING minutes on its timer, bonus = tier x 5 (game's GlobalBoostTier).
function globalBoostBonus(state, name) {
  const timer = (state.globalBoosts || {})[name] || 0;
  const now = state.stateReadAt || Math.floor(Date.now() / 1000);
  if (timer <= now) return { bonus: 0, tier: 0, hoursLeft: 0 };
  const minutes = Math.floor((timer - now) / 60);
  const tier = minutes < 360 ? 1 : minutes < 720 ? 2 : minutes < 1440 ? 3 : minutes < 2880 ? 4 : 5;
  return { bonus: tier * 5, tier, hoursLeft: Math.round(minutes / 6) / 10 };
}

function planShipItems(state) {
  const ship = state.ship || {};
  const craftLevel = (state.craft && state.craft.crafting_level) || 1;
  const skills = state.skillLevels || {};
  const skillLevelOf = {
    battling: skills.battling || 0,
    gathering: skills.gathering || 0,
    exploring: skills.exploring || 0,
  };

  const engineItem = ship.engine_slot || null;
  const sensorsItem = ship.sensors_slot || null;

  // --- engine cooldown ---
  // d = engineValue/100 + cooldownModBonus (engine AND sensors mods count)
  // + globalCooldownBoost + KorinPetLevel (equipped Korin only).
  // The global boost is a purchased timer: tier depends on REMAINING time
  // (<6h:1, <12h:2, <24h:3, <48h:4, else 5), bonus = tier x 5 (so up to
  // +25%). It expires, so both d values are reported: dNow (with boost) for
  // the current situation, dBase (without) for permanent-decision advice.
  const engineValue = engineItem ? (engineItem.value || 0) : 0;
  const cooldownModBonus = nonDamageModValue(engineItem, "Engine cooldown reduction") +
    nonDamageModValue(sensorsItem, "Engine cooldown reduction");
  const korinPet = ((state.pets && state.pets.pets) || [])
    .find(p => p.pet_type === "generator" && p.name === "Korin");
  const korinEquipped = !!korinPet &&
    ((state.pets.petSlots || []).some(s => s.pet === korinPet._id));
  const korinLevel = korinEquipped ? korinPet.level : 0;
  const globalBoost = globalBoostBonus(state, "Cooldown");
  const dBase = engineValue / 100 + cooldownModBonus + korinLevel;
  const d = dBase + globalBoost.bonus;
  const breakpointD10ly = Math.round(cooldownFloorBreakpoint(10) * 100) / 100;
  const cooldownModPresent = cooldownModBonus > 0;
  // Whether a +10 cooldown mod would still meaningfully help at 10 ly.
  // Judged on the PERMANENT baseline (dBase, boost excluded) because mods
  // outlive the boost timer; flooredNowAt10ly says whether the boost
  // currently pins the cooldown regardless.
  const withCooldownModAt10ly = dBase < breakpointD10ly;
  const flooredNowAt10ly = d >= breakpointD10ly;
  // Max jump distance still pinned to the floor at the current d:
  // 600s*(1+L/100)*(1-d/100) <= 300s  =>  L <= 100*(1/(2*(1-d/100)) - 1).
  const flooredUpToLy = d < 50 ? 0
    : (d >= 100 ? Infinity : Math.round(100 * (1 / (2 * (1 - d / 100)) - 1) * 10) / 10);

  const cooldown = {
    d: Math.round(d * 100) / 100,
    dBase: Math.round(dBase * 100) / 100,
    componentBreakdown: {
      engineValue, mods: cooldownModBonus, korin: korinLevel,
      globalBoost: globalBoost.bonus, globalBoostTier: globalBoost.tier,
      globalBoostHoursLeft: globalBoost.hoursLeft,
    },
    at10ly: cooldownAt(d, 10),
    at50ly: cooldownAt(d, 50),
    at100ly: cooldownAt(d, 100),
    at10lyNoBoost: cooldownAt(dBase, 10),
    breakpointD10ly,
    withCooldownModAt10ly,
    flooredNowAt10ly,
    flooredUpToLy,
  };

  // --- scan reward ---
  // multiplier = 1 + sensorsValue/10000 + scanModBonus/100 (scan mods
  // counted on engine AND sensors).
  const sensorsValue = sensorsItem ? (sensorsItem.value || 0) : 0;
  const scanModBonus = nonDamageModValue(engineItem, "Scan reward boost") +
    nonDamageModValue(sensorsItem, "Scan reward boost");
  const scan = {
    multiplier: Math.round((1 + sensorsValue / 10000 + scanModBonus / 100) * 10000) / 10000,
    sensorsComponent: Math.round((sensorsValue / 10000) * 10000) / 10000,
    modComponent: Math.round((scanModBonus / 100) * 10000) / 10000,
  };

  // --- droid dodge (exact) ---
  const droids = state.droids || [];
  const dodgeModBonus = nonDamageModValue(ship.laser_slot, "Droids dodge chance") +
    nonDamageModValue(ship.probes_slot, "Droids dodge chance");
  const droidDodgeSummary = droidSurvival(droids, dodgeModBonus);
  // Removal schedule: which item's dodge mod can be recrafted into a single
  // rare-drop mod at which maneuverability (weakest droid), one at a time.
  const minManeuverability = droids.length ? Math.min(...droids.map(dd => dd.maneuverability || 0)) : 0;
  const modPlan = dodgeModPlan(minManeuverability, [
    { slot: "laser_slot", value: nonDamageModValue(ship.laser_slot, "Droids dodge chance") },
    { slot: "probes_slot", value: nonDamageModValue(ship.probes_slot, "Droids dodge chance") },
  ]);
  droidDodgeSummary.modPlan = modPlan;
  // How much of THIS item's dodge mod actually lands, averaged over the
  // fleet, once the 100% cap is applied.
  const dodgeModEffective = (item) => {
    const v = nonDamageModValue(item, "Droids dodge chance");
    if (!v || !droids.length) return { value: v, effective: v };
    const landed = droids.reduce((sum, dd) =>
      sum + (droidDodge(dd.maneuverability, dodgeModBonus) - droidDodge(dd.maneuverability, dodgeModBonus - v)), 0) / droids.length;
    return { value: v, effective: Math.round(landed * 1000) / 1000 };
  };

  const items = [];
  for (const slot of Object.keys(ITEM_CATEGORY)) {
    const item = ship[slot];
    if (!item) continue;
    const matchingSkill = ITEM_MATCHING_SKILL[slot];
    const skillLevel = skillLevelOf[matchingSkill] || 0;
    const level = item.level || 0;
    const rarity = item.rarity || "normal";
    const value = item.value || 0;
    const bonuses = item.bonuses || [];
    const levelsBehind = Math.max(0, skillLevel - level);
    const vMax = valueMaxForLevel(craftLevel, rarity, level);
    const vMaxRecrafted = valueMaxForLevel(craftLevel, rarity, skillLevel);
    const valuePctOfMax = vMax > 0 ? Math.round((value / vMax) * 1000) / 10 : 0;

    const recommendations = [];
    if (levelsBehind >= 5) {
      recommendations.push(
        `${levelsBehind} levels behind ${matchingSkill} — recrafting now would cap value at ${vMaxRecrafted} (current max ${vMax})`
      );
    }
    if (slot === "engine_slot" || slot === "sensors_slot") {
      if (!cooldownModPresent) {
        if (!withCooldownModAt10ly) {
          recommendations.push(
            `Cooldown is at the 5-min floor at 10 ly even without the global boost (dBase=${cooldown.dBase} >= breakpoint ${breakpointD10ly}) — a cooldown mod would be wasted; prefer 'Scan reward boost'`
          );
        } else if (flooredNowAt10ly) {
          recommendations.push(
            `Cooldown currently floored up to ~${cooldown.flooredUpToLy} ly thanks to the +${globalBoost.bonus}% global Cooldown boost (tier ${globalBoost.tier}, ~${globalBoost.hoursLeft}h left) — a cooldown mod adds nothing NOW, but without the boost d=${cooldown.dBase} < ${breakpointD10ly}, so it would help once the boost lapses`
          );
        } else {
          recommendations.push(
            `No 'Engine cooldown reduction' mod equipped on engine or sensors — adding one would still help at 10 ly (d=${cooldown.d}, floor breakpoint ${breakpointD10ly})`
          );
        }
      }
    }
    if (slot === "weapon_slot" || slot === "shield_slot") {
      const covered = [];
      const uncovered = [];
      for (const npc of BATTLING_NPCS) {
        const hitMods = bonuses.filter(b => npc.weakness.includes(b));
        if (hitMods.length) {
          const pct = hitMods.reduce((sum, b) => sum + damageModValue(item, b), 0);
          covered.push(`${npc.name} (${pct}%)`);
        } else {
          uncovered.push(npc.name);
        }
      }
      recommendations.push(
        `Damage mods [${bonuses.join(", ") || "none"}] hit: ${covered.join(", ") || "none"}` +
        (uncovered.length ? ` — uncovered: ${uncovered.join(", ")}` : "")
      );
    }
    if ((slot === "laser_slot" || slot === "probes_slot") && bonuses.includes("Droids dodge chance")) {
      const eff = dodgeModEffective(item);
      const planned = modPlan.find(p => p.slot === slot);
      const single = bonuses.length <= 1;
      const recraftText = single
        ? "recraft with a single 'Rare Resource drop chance' mod"
        : "recraft with a single 'Rare Resource drop chance' mod (+10 rare instead of +5)";
      if (planned && planned.removableNow) {
        recommendations.push(
          `'Droids dodge chance' adds nothing: droids dodge 100% without it (weakest droid maneuverability ${minManeuverability}%) — ${recraftText}`
        );
      } else if (planned) {
        recommendations.push(
          `'Droids dodge chance' still needed (droid dodge ${droidDodgeSummary.avgDodge}%). At ${planned.removableAt}% maneuverability on every droid this mod can go: ${recraftText}` +
          (eff.effective < eff.value - 0.001 ? ` — right now only +${eff.effective} of its +${eff.value} lands (100% cap)` : "")
        );
      }
    }
    if (item.anomaly) {
      recommendations.push("Anomalous item — mods can be rerolled for 500,000 cosmic dust");
    }

    items.push({
      slot, name: item.name, level, rarity, value, bonuses,
      enhanced: !!item.enhanced, anomaly: !!item.anomaly, crafted: !!item.crafted,
      matchingSkill, skillLevel, levelsBehind,
      valueMaxForLevel: vMax, valuePctOfMax, valueMaxIfRecrafted: vMaxRecrafted,
      recommendations,
    });
  }

  return { items, cooldown, scan, droidDodge: droidDodgeSummary };
}

module.exports = {
  planShipItems, valueMaxForLevel, cooldownFloorBreakpoint, cooldownAt,
  nonDamageModValue, damageModValue,
};
