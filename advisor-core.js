// Shared core for the catalyst & gear advisor.
// Facade + analysis pipeline; implementation lives in lib/.
// Used by advisor-server.js (GUI) via lib/analyze-worker.js.

const {
  RARITIES, RARITY_MULT, SHIP_ITEM_RARITY_MULT, ITEM_MATCHING_SKILL,
  STAT_BASES, STAT_CATEGORIES, ITEM_CATEGORY, ITEM_ACTIVITIES,
  activityChain, MERGE_CHANCE, MERGE_COST, PROTECT_COST, MERGE_RANGE_BONUS, CRAFT_LEVEL_MERGE_BONUS,
  SLOTS_PER_GROUP, MAX_SAME_STAT, SAME_STAT_PENALTY, FLAT_INTEGER_STATS, STAT_CAPS,
  STAT_CAPS_BY_CONTEXT, BATTLING_NPCS, ACTIVITY_RELEVANT_STATS,
} = require("./lib/constants.js");
const {
  statCategory, activityOf, mergeRangeBonus, mergeSuccessChance, nextRarity,
  catalystValue, effInGroup, groupValue, fmtVal, fmtCat, fmtAct, itemGroups,
} = require("./lib/value.js");
const {
  CDP, evalInPage, READ_ALL, discoverGame, discoverGameWsUrl, fetchJson, readGameState,
} = require("./lib/cdp.js");
const { planCatalystMergeGroups, tierThreshold, planMerges } = require("./lib/merges.js");
const { statTotalsByContext, planInstalls, inheritedGroupInfo } = require("./lib/installs.js");
const {
  equippedBonuses, battlePlayer, averageMaxLevel, perNpcMaxLevels, makeBattleValidator,
  projectShip,
} = require("./lib/battle-rating.js");
const { planInventory } = require("./lib/inventory.js");
const { unitStepCost, cumulativeUnitCost, unitPrice, planUnits } = require("./lib/units.js");
const { planTech, techBattleRanking } = require("./lib/tech.js");
const { planPets } = require("./lib/pets.js");
const { planMaterials, NPC_MATERIAL_SOURCES } = require("./lib/materials.js");
const { planShipItems } = require("./lib/ship-items.js");
const { planLab } = require("./lib/lab.js");
const { planBaseFromState } = require("./lib/base.js");
const PetMath = require("./public/pet-math.js");
const {
  petXpTarget, petXpBoostCost, petXpBoostCostCumulative, petXpPerHour,
  petHoursToNextLevel,
} = PetMath;

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

// Full analysis. Takes the raw state (from readGameState) and returns a
// presentation-ready structure for the GUI.
function analyze(s) {
  // Normalize the collection-shaped fields ONCE, here, instead of guarding at
  // every consumer. A store that has not hydrated arrives as null (or, after a
  // game update, as some other shape) and one such field used to abort the
  // whole analysis with an unhelpful TypeError.
  s = Object.assign({}, s, {
    craft: s.craft || {},
    ship: s.ship || {},
    player: s.player || {},
    catalysts: Array.isArray(s.catalysts) ? s.catalysts : [],
    droids: Array.isArray(s.droids) ? s.droids : [],
    blueprints: Array.isArray(s.blueprints) ? s.blueprints : [],
    materials: Array.isArray(s.materials) ? s.materials : [],
  });
  const craftLevel = s.craft.crafting_level || 1;
  const bonus = mergeRangeBonus(craftLevel);
  const unequipped = s.catalysts.filter(c => !c.equippedOn);
  // Installed catalysts live on the equipped items, not in CatalystStore.
  const installedCount = Object.values(s.ship)
    .reduce((sum, item) => sum + ((item && item.catalysts) ? item.catalysts.length : 0), 0);
  const installable = unequipped.filter(c => !c.onMarket && !c.locked);

  const player = {
    craftLevel,
    currentXp: s.craft.crafting_current_xp,
    targetXp: s.craft.crafting_target_xp,
    rangeBonus: bonus,
    successBonus: craftLevel * CRAFT_LEVEL_MERGE_BONUS,
    dust: s.dust,
    parts: s.catalyst_parts,
    qc: s.quantum_cores,
    totalCatalysts: installedCount + unequipped.length,
    installedCount,
    unequippedCount: unequipped.length,
  };

  // Pool counts keyed by activity|category for the gear view.
  const poolByActCat = {};
  for (const c of installable) {
    const key = `${activityOf(c)}|${statCategory(c.stat)}`;
    (poolByActCat[key] = poolByActCat[key] || []).push(c);
  }

  // Chain-override losses: for every equipped item, a non-empty specialized
  // group REPLACES the item's chain-inherited group in that context - it
  // does not stack on top of it. If the specialized group is worth LESS,
  // in stats relevant to that activity, than what it replaced, the player
  // would be better off emptying it (leaving the item to inherit instead).
  const fmtAgg = (v) => v.toFixed(2) + "%";
  const overrideLosses = [];

  const gear = [];
  for (const [slot, category] of Object.entries(ITEM_CATEGORY)) {
    const item = s.ship[slot];
    const entry = { slot, category, empty: !item };
    if (!item) { gear.push(entry); continue; }
    entry.name = item.name;
    entry.level = item.level;
    entry.rarity = item.rarity;
    const groups = itemGroups(slot, item);
    entry.groups = ITEM_ACTIVITIES[slot].map(act => {
      const list = groups[act] || [];
      let inherited = false;
      let inheritedFrom = null;
      if (list.length === 0) {
        const inh = inheritedGroupInfo(groups, act);
        if (inh) { inherited = true; inheritedFrom = inh.activity; }
      } else if (act !== "default") {
        // Non-empty specialized group: it REPLACES whatever this item
        // would otherwise inherit in this context. Compare relevant value.
        const inh = inheritedGroupInfo(groups, act);
        if (inh) {
          const relevant = ACTIVITY_RELEVANT_STATS[act];
          const relevantValue = (grp) => grp.reduce((sum, c) =>
            sum + ((!relevant || relevant.includes(c.stat)) ? effInGroup(c) : 0), 0);
          const currentValue = relevantValue(list);
          const inheritedValue = relevantValue(inh.group);
          if (currentValue < inheritedValue - 0.001) {
            overrideLosses.push({
              item: item.name, slot, activity: act,
              currentText: fmtAgg(currentValue),
              inheritedText: fmtAgg(inheritedValue) + " (" + inh.activity + ")",
              lostText: fmtAgg(inheritedValue - currentValue),
            });
          }
        }
      }
      return {
        activity: act,
        filled: list.length,
        slots: SLOTS_PER_GROUP,
        inherited,
        inheritedFrom,
        poolCount: (poolByActCat[`${act}|${category}`] || []).length,
        catalysts: list.map(c => ({
          id: c._id,
          stat: c.stat,
          rarity: c.rarity,
          range: c.range,
          halved: !!c.halved,
          effText: fmtVal(c.stat, effInGroup(c)),
          sameCount: list.filter(x => x.stat === c.stat).length,
        })),
      };
    });
    gear.push(entry);
  }

  const totals = statTotalsByContext(s.ship);
  // Over-cap warnings (Stats tab badge count). Every non-default context
  // INHERITS the default totals, so a (ctx, stat) pair is only reported
  // when it adds information over default: the stat does something during
  // that activity AND its total or cap differs from default (block: 40 vs
  // NPCs, 25 in galaxy boss).
  const warnings = [];
  const defTotals = totals.default || {};
  for (const [ctx, stats] of Object.entries(totals)) {
    for (const [stat, total] of Object.entries(stats)) {
      const cap = (STAT_CAPS_BY_CONTEXT[stat] || {})[ctx] ?? STAT_CAPS[stat];
      if (cap === undefined || total <= cap) continue;
      if (ctx !== "default") {
        const relevant = ACTIVITY_RELEVANT_STATS[ctx];
        if (relevant && !relevant.includes(stat)) continue;
        const defCap = (STAT_CAPS_BY_CONTEXT[stat] || {}).default ?? STAT_CAPS[stat];
        const sameAsDefault = Math.abs(total - (defTotals[stat] || 0)) < 0.001 && cap === defCap;
        if (sameAsDefault) continue;
      }
      warnings.push({
        ctx, stat,
        totalText: fmtVal(stat, total),
        capText: fmtVal(stat, cap),
        wastedText: fmtVal(stat, total - cap),
      });
    }
  }

  // Two install variants. Both variants fill every specialized tab
  // (exploring/crafting/galaxyboss/dungeons/voyager) — they differ ONLY in
  // the DEFAULT-tab strategy:
  //   full     : even weights, general stats.
  //   resources: gathering-only in default slots, resource stats weighted.
  // Battle validator shared by all variants: baseline max NPC levels and
  // per-action ratings are cached across analyze calls. planInstalls runs
  // it on every default-tab action at commit time, so battle-degrading
  // changes never consume their catalyst — it stays in the pool for the
  // specialized tabs instead of being wasted.
  const validator = makeBattleValidator(s);
  const validateDefault = validator ? (a) => validator.validate(a) : null;

  const fullPlan = planInstalls(s.ship, installable, { validateDefault });
  // Full-resources variant: ALL-in on gathering resources — the default
  // boost slots go to gathering_yield first, then gathering_xp. Battling
  // XP/credits stay out of the resource plan (that's the full variant).
  const RES_WEIGHTS = {
    gathering_yield: 3, cosmic_dust_bonus: 3,
    gathering_xp: 1.5,
    battling_xp: 0.01, battling_credits: 0.01,
    crafting_xp: 0.01, exploring_xp: 0.01,
  };
  const resourcesPlan = planInstalls(s.ship, installable, {
    statWeights: RES_WEIGHTS,
    // Resources variant default slots: gathering stats + resource-adjacent
    // utility (catalyst_drop_chance = more drops, fuel_efficiency = less
    // fuel spent per jump). Battling XP/credits are NOT resource stats.
    restrictDefault: ["gathering_yield", "gathering_xp", "catalyst_drop_chance", "fuel_efficiency"],
    validateDefault,
  });

  const toDisplay = (a, i) => {
    const rating = validator ? validator.getRating(a) : null;
    return {
      n: i + 1,
      action: a.action,
      item: a.item,
      slot: a.slot,
      activity: a.activity,
      sameCount: a.sameCount || 0,
      remove: a.remove ? {
        id: a.remove._id,
        stat: a.remove.stat, rarity: a.remove.rarity,
        range: a.remove.range, halved: !!a.remove.halved,
        text: fmtCat(a.remove),
      } : null,
      add: {
        id: a.add._id,
        stat: a.add.stat, rarity: a.add.rarity,
        range: a.add.range, halved: !!a.add.halved,
        text: fmtCat(a.add),
      },
      gainText: fmtVal(a.add.stat, a.gain),
      // Cap context in this activity: total before -> after vs the cap.
      capInfo: a.cap !== undefined ? {
        cap: a.cap, before: a.capTotalBefore, after: a.capTotalAfter,
        capText: fmtVal(a.add.stat, a.cap),
        beforeText: fmtVal(a.add.stat, a.capTotalBefore),
        afterText: fmtVal(a.add.stat, a.capTotalAfter),
        over: a.capTotalAfter > a.cap + 0.0001,
      } : null,
      npcDeltas: rating ? rating.npcDeltas : null,
      worstDelta: rating ? rating.worstDelta : null,
    };
  };

  // Default-tab battle actions were already validated at commit time inside
  // planInstalls — no post-filtering needed, no catalyst is ever wasted on
  // a dropped action.
  const buildPlan = (plan) => {
    const defs = plan.actions.filter(a => a.activity === "default").map(toDisplay);
    const spec = plan.actions.filter(a => a.activity !== "default").map(toDisplay);
    return [...defs, ...spec].map((a, i) => ({ ...a, n: i + 1 }));
  };
  const installs = buildPlan(fullPlan);
  const installsResources = buildPlan(resourcesPlan);

  const battleNote = validator ? validator.note : null;
  const battleBase = validator ? validator.baseLevels : null;

  const freedTexts = fullPlan.freed.map(f => fmtCat(f));

  // Per-tier merge requirements so the advice is transparent at any level.
  // tierThreshold(rIdx) = the minimum RESULT range a merge into rarity rIdx
  // must achieve to stay on the perfect-legendary path.
  const mergeRequirements = RARITIES.map((r, rIdx) => ({
    rarity: r,
    resultNeeded: Math.round(tierThreshold(rIdx, bonus) * 10) / 10,
    inputAvgNeeded: Math.round(Math.max(0, tierThreshold(rIdx, bonus) - bonus) * 10) / 10,
  }));

  // The merge pool may also pull ONE catalyst from installed gear per merge
  // group (4 from inventory + 1 pulled). Rules:
  //   - at most 1 pulled catalyst per group of 5
  //   - pulling it must not degrade the overall installation: the merged
  //     result (next rarity) will be re-installed in the freed slot, so its
  //     value must be >= the pulled catalyst's effective value there
  //   - every pull is CALLED OUT with the item + tab it must be taken from
  const reservedIds = new Set([
    ...fullPlan.actions.map(a => a.add._id),
    ...resourcesPlan.actions.map(a => a.add._id),
  ]);
  const inventoryPool = unequipped
    .filter(c => !reservedIds.has(c._id) && !c.onMarket && !c.locked);
  const installedPulls = [];
  for (const slot of Object.keys(ITEM_CATEGORY)) {
    const item = s.ship[slot];
    if (!item) continue;
    const groups = itemGroups(slot, item);
    for (const [act, list] of Object.entries(groups)) {
      for (const c of list) {
        if (reservedIds.has(c._id)) continue;
        installedPulls.push({
          ...c,
          pulledFromGear: true,
          _item: item.name, _slot: slot,
          _activity: act === "dungeon" ? "dungeons" : act,
          _eff: catalystValue(c),
          _groupSameStat: list.filter(x => x.stat === c.stat).length,
        });
      }
    }
  }
  const mergePlans = planMerges(inventoryPool, craftLevel, installedPulls);

  // What-if projection: per-NPC max levels if every Full-explore action
  // above were applied, so the impact of the whole plan is visible up
  // front instead of only the per-action deltas.
  let projection = null;
  if (validator && battleBase) {
    const npcLevels = projectShip(s, fullPlan.actions, { ssBoost: s.ssBattlingBoost || 0 });
    const names = Object.keys(npcLevels);
    const deltas = {};
    for (const npc of names) deltas[npc] = npcLevels[npc] - battleBase[npc];
    const avgDelta = names.length
      ? Math.round((names.reduce((sum, npc) => sum + deltas[npc], 0) / names.length) * 10) / 10
      : 0;
    projection = { npcLevels, deltas, avgDelta };
  }

  const inventory = planInventory(s, { reservedIds, mergePlans, craftLevel });

  const units = planUnits(s);
  const tech = planTech(s);
  const pets = planPets(s);
  const materials = planMaterials(s);
  const shipItems = planShipItems(s);
  const lab = planLab(s, {});
  const base = planBaseFromState(s, {});

  // Full per-activity stat breakdown for the Stats tab. Chain semantics:
  // totals[ctx] already holds exactly what is active during that activity.
  // Stats that have no effect in a context (e.g. battling stats while
  // crafting) are still active via inherited groups - mark them irrelevant
  // so the GUI can dim them instead of hiding real game state.
  const contextTotals = buildContextTotals(totals);

  return {
    player, gear, warnings, overrideLosses, contextTotals,
    installs, installsResources, freedTexts,
    mergePlans, mergeRequirements, battleNote, battleBase,
    // false => every battle figure in this analysis is missing the squadron
    // multiplier; treat them as unknown, not as a regression.
    battleTrusted: s.ssBattlingBoostKnown !== false,
    projection, inventory,
    units, tech, pets, materials, shipItems, lab, base,
  };
}

// Full per-activity stat breakdown for the Battle tab. Chain semantics:
// totals[ctx] already holds exactly what is active during that activity.
// Stats that have no effect in a context (e.g. battling stats while
// crafting) are still active via inherited groups - mark them irrelevant
// so the GUI can hide them instead of losing real game state. Every capped
// stat that DOES matter in the activity is listed even at zero, so each
// card reads as a complete cap checklist; over-cap rows carry the waste.
function buildContextTotals(totals) {
  const CTX_ORDER = ["default", "exploring", "crafting", "galaxyboss", "dungeons", "voyager"];
  const allCapped = new Set([...Object.keys(STAT_CAPS), ...Object.keys(STAT_CAPS_BY_CONTEXT)]);
  const contextTotals = {};
  for (const ctx of CTX_ORDER) {
    const stats = { ...(totals[ctx] || {}) };
    const relevant = ACTIVITY_RELEVANT_STATS[ctx];
    const isRelevant = (stat) => !relevant || relevant.includes(stat);
    for (const stat of allCapped) {
      if (stats[stat] === undefined && isRelevant(stat)) stats[stat] = 0;
    }
    contextTotals[ctx] = Object.entries(stats)
      .filter(([stat, v]) => v > 0.0001 || allCapped.has(stat))
      .map(([stat, total]) => {
        const cap = (STAT_CAPS_BY_CONTEXT[stat] || {})[ctx] ?? STAT_CAPS[stat];
        const over = cap !== undefined && total > cap + 0.0001;
        return {
          stat, total,
          category: statCategory(stat),
          totalText: fmtVal(stat, total),
          cap: cap !== undefined ? cap : null,
          capText: cap !== undefined ? fmtVal(stat, cap) : null,
          wastedText: over ? fmtVal(stat, total - cap) : null,
          relevant: isRelevant(stat),
        };
      })
      .sort((a, b) => (b.relevant - a.relevant) || (b.total - a.total));
  }
  return contextTotals;
}

module.exports = {
  buildContextTotals,
  RARITIES, RARITY_MULT, SHIP_ITEM_RARITY_MULT, ITEM_MATCHING_SKILL,
  STAT_BASES, STAT_CATEGORIES, ITEM_CATEGORY, ITEM_ACTIVITIES,
  activityChain, MERGE_CHANCE, MERGE_COST, PROTECT_COST, MERGE_RANGE_BONUS, CRAFT_LEVEL_MERGE_BONUS,
  SLOTS_PER_GROUP, MAX_SAME_STAT, SAME_STAT_PENALTY, FLAT_INTEGER_STATS, STAT_CAPS,
  statCategory, activityOf, mergeRangeBonus, mergeSuccessChance, nextRarity,
  catalystValue, effInGroup, groupValue, fmtVal, fmtCat, fmtAct, itemGroups,
  equippedBonuses, battlePlayer, averageMaxLevel, perNpcMaxLevels, projectShip,
  planCatalystMergeGroups, statTotalsByContext, planInstalls, inheritedGroupInfo, planMerges,
  BATTLING_NPCS, unitStepCost, cumulativeUnitCost, unitPrice, planUnits, planTech, techBattleRanking,
  petXpTarget, petXpBoostCost, petXpBoostCostCumulative, petXpPerHour,
  petHoursToNextLevel, planPets, planInventory, planMaterials, NPC_MATERIAL_SOURCES,
  planShipItems, planLab, planBase: planBaseFromState,
  CDP, evalInPage, READ_ALL, discoverGame, discoverGameWsUrl, fetchJson, readGameState, analyze,
};
