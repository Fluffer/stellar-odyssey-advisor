// Install / replace planning.

const {
  ITEM_CATEGORY, ITEM_ACTIVITIES, activityChain, STAT_CAPS, SLOTS_PER_GROUP, MAX_SAME_STAT,
  MIN_WORTHWHILE_GAIN, SPECIALIZED_ONLY_STATS, DEFAULT_RELEVANT_STATS,
  ACTIVITY_RELEVANT_STATS, ACTIVITY_ONLY_STATS, SAME_STAT_PENALTY,
} = require("./constants.js");
const { statCategory, itemGroups, rawValue, catalystValue, effInGroup, groupValue } = require("./value.js");

// Stat totals per context, matching the game's getEquippedBonusesForShip:
// PER ITEM, only the first non-empty group in chain(context) contributes -
// a non-empty specialized group REPLACES the item's default group in that
// context; an empty specialized group means the item inherits down the
// chain instead. All 6 equipped items are summed regardless of whether
// their slot even lists `context` as one of its tabs (a weapon during
// 'exploring' still contributes its default group, since it has no
// exploring group of its own).
function statTotalsByContext(ship) {
  const contexts = new Set(["default"]);
  Object.values(ITEM_ACTIVITIES).forEach(list => list.forEach(a => contexts.add(a)));
  const result = {};
  for (const ctx of contexts) {
    const totals = {};
    const chain = activityChain(ctx);
    for (const slot of Object.keys(ITEM_CATEGORY)) {
      const item = ship[slot];
      if (!item) continue;
      const groups = itemGroups(slot, item);
      let chosen = null;
      for (const act of chain) {
        const g = groups[act];
        if (g && g.length > 0) { chosen = g; break; }
      }
      if (!chosen) continue;
      for (const c of chosen) {
        totals[c.stat] = (totals[c.stat] || 0) + effInGroup(c);
      }
    }
    result[ctx] = totals;
  }
  return result;
}

// For an item whose group at `act` is currently empty, find what it
// currently contributes to context `act` via chain inheritance (i.e. the
// first non-empty group further down chain(act), excluding act itself).
// Returns null if nothing is inherited (e.g. default has no fallback).
function inheritedGroupInfo(groupsMap, act) {
  for (const a of activityChain(act).slice(1)) {
    const g = groupsMap[a];
    if (g && g.length > 0) return { activity: a, group: g };
  }
  return null;
}

// Greedy install/replace plan. Each candidate used at most once.
// Respects: category match, 2-same-stat per group, 4 slots per group,
// stat caps (gain can't exceed headroom).
// Phase 1 fills DEFAULT groups (always-on stats, highest priority).
// Phase 2 fills specialized groups (galaxyboss/dungeon/voyager/exploring/
// crafting) with leftover catalysts - context-only value, but free stats.
function planInstalls(ship, pool, opts = {}) {
  const used = new Set();
  const freed = [];
  const actions = [];
  const work = {};
  for (const slot of Object.keys(ITEM_CATEGORY)) {
    const item = ship[slot];
    if (!item) continue;
    work[slot] = { name: item.name, groups: itemGroups(slot, item) };
  }

  const totals = statTotalsByContext(ship);

  // Default-tab actions rejected by the battle check (opts.validateDefault),
  // keyed "candId|slot|activity". The greedy skips them on re-picks so the
  // catalyst stays available for the specialized tabs.
  const battleBlocked = new Set();

  // Hypothetical group evaluation: existing catalysts use their stored
  // halved flag; a CANDIDATE about to be installed gets halved if it would
  // become the 2nd+ same-stat in the group (game behavior at install time).
  const groupValueWith = (group, cand, excluded) => {
    const same = group.filter(x => x !== excluded && x.stat === cand.stat).length;
    const candVal = rawValue(cand) * (same >= 1 ? SAME_STAT_PENALTY : 1);
    return group.reduce((s, x) => s + (x === excluded ? 0 : catalystValue(x)), 0) + candVal;
  };

  // statWeights only apply to the DEFAULT-tab pass (variant strategies);
  // specialized tabs always use raw gains so nothing gets suppressed there.
  const runPass = (actFilter, poolFilter, useWeights) => {
    const weights = (useWeights && opts.statWeights) || {};
    let guard = 0;
    while (guard++ < 500) {
      let best = null;
      for (const slot of Object.keys(work)) {
        const cat = ITEM_CATEGORY[slot];
        for (const act of ITEM_ACTIVITIES[slot]) {
          if (actFilter && !actFilter(act)) continue;
          const group = work[slot].groups[act] || (work[slot].groups[act] = []);
          const before = groupValue(group);
          // An EMPTY specialized group is not "free" - it currently
          // inherits a group from further down the chain (e.g. galaxyboss
          // empty -> weapon's default group is what actually applies during
          // galaxy boss fights). Installing the first catalyst here REPLACES
          // that inherited group in this context, so its cost is what the
          // inherited group was contributing in RELEVANT stats for `act`.
          // Once the group is non-empty, later installs are additive again
          // (this recomputes fresh every outer-loop iteration, so it
          // naturally flips off after the first commit).
          const isEmptyGroup = group.length === 0;
          let inheritedRelevantValue = 0;
          let inheritedFullStats = null;
          if (isEmptyGroup) {
            const inh = inheritedGroupInfo(work[slot].groups, act);
            if (inh) {
              const relevant = ACTIVITY_RELEVANT_STATS[act];
              inheritedFullStats = {};
              for (const c of inh.group) {
                const v = catalystValue(c);
                inheritedFullStats[c.stat] = (inheritedFullStats[c.stat] || 0) + v;
                if (!relevant || relevant.includes(c.stat)) inheritedRelevantValue += v;
              }
            }
          }
          for (const cand of pool) {
            if (used.has(cand._id)) continue;
            if (battleBlocked.has(`${cand._id}|${slot}|${act}`)) continue;
            if (poolFilter && !poolFilter(cand, act, slot)) continue;
            if (statCategory(cand.stat) !== cat) continue;
            const cap = STAT_CAPS[cand.stat];
            const ctxKey = act === "default" ? "default" : act;
            const curTotal = (totals[ctxKey] || {})[cand.stat] || 0;
            // Headroom is computed against what this item will ACTUALLY be
            // contributing after the change: if this is the first catalyst
            // into an empty group, this item's own inherited contribution of
            // this same stat is about to disappear from the context, so it
            // shouldn't count against the candidate's headroom.
            const inheritedOwn = isEmptyGroup && inheritedFullStats ? (inheritedFullStats[cand.stat] || 0) : 0;
            const headroomTotal = curTotal - inheritedOwn;
            if (cap !== undefined && headroomTotal >= cap) continue;

            if (group.length < SLOTS_PER_GROUP) {
              const same = group.filter(x => x.stat === cand.stat).length;
              if (same >= MAX_SAME_STAT) continue;
              let rawCandVal = groupValueWith(group, cand, null) - before;
              if (cap !== undefined) rawCandVal = Math.min(rawCandVal, cap - headroomTotal);
              // For an empty group, the real improvement nets out what the
              // item currently gets for free via inheritance - only that
              // net gain must clear the worthwhile threshold. For an
              // already-non-empty group, rawCandVal IS the gain (unchanged
              // additive behavior).
              const gain = isEmptyGroup ? rawCandVal - inheritedRelevantValue : rawCandVal;
              if (gain < MIN_WORTHWHILE_GAIN) continue;
              const ranked = gain * (weights[cand.stat] !== undefined ? weights[cand.stat] : 1);
              if (ranked > 0.01 && (!best || ranked > best.ranked)) {
                best = {
                  gain, ranked, slot, act, cand, remove: null,
                  rawCandVal, isEmptyGroup, inheritedFullStats,
                };
              }
            }
            if (group.length >= SLOTS_PER_GROUP) {
              for (const m of group) {
                const afterCount = group.filter(x => x !== m && x.stat === cand.stat).length;
                if (afterCount >= MAX_SAME_STAT) continue;
                let gain = groupValueWith(group, cand, m) - before;
                if (cap !== undefined) gain = Math.min(gain, cap - curTotal);
                if (gain < MIN_WORTHWHILE_GAIN) continue;
                const ranked = gain * (weights[cand.stat] !== undefined ? weights[cand.stat] : 1);
                if (ranked > 0.01 && (!best || ranked > best.ranked)) {
                  best = {
                    gain, ranked, slot, act, cand, remove: m,
                    rawCandVal: gain, isEmptyGroup: false, inheritedFullStats: null,
                  };
                }
              }
            }
          }
        }
      }
      if (!best) break;
      // Battle gate: default-tab actions that touch battling stats must pass
      // the battle simulation BEFORE they consume the candidate. A rejected
      // action is blacklisted for that slot and the greedy re-picks the next
      // best option; the catalyst stays in the pool for the specialized tabs.
      if (opts.validateDefault) {
        const pending = {
          action: best.remove ? "replace" : "install",
          slot: best.slot, item: work[best.slot].name, activity: best.act,
          remove: best.remove, add: best.cand,
        };
        if (!opts.validateDefault(pending)) {
          battleBlocked.add(`${best.cand._id}|${best.slot}|${best.act}`);
          continue;
        }
      }
      const w = work[best.slot];
      const group = w.groups[best.act];
      const ctxKey = best.act === "default" ? "default" : best.act;
      totals[ctxKey] = totals[ctxKey] || {};
      const sameAfter = group.filter(x => x.stat === best.cand.stat).length;
      // Commit with the predicted halved flag (2nd+ same-stat gets halved).
      const committed = { ...best.cand, halved: sameAfter >= 1 };
      if (best.remove) {
        const idx = group.findIndex(x => x._id === best.remove._id);
        group.splice(idx, 1);
        freed.push(best.remove);
        const removedEff = catalystValue(best.remove);
        totals[ctxKey][best.remove.stat] = Math.max(0, (totals[ctxKey][best.remove.stat] || 0) - removedEff);
        actions.push({
          action: "replace", slot: best.slot, item: w.name, activity: best.act,
          remove: best.remove, add: best.cand, gain: best.gain,
          sameCount: sameAfter + 1,
        });
      } else {
        actions.push({
          action: "install", slot: best.slot, item: w.name, activity: best.act,
          add: best.cand, gain: best.gain,
          sameCount: sameAfter + 1,
        });
      }
      group.push(committed);
      used.add(best.cand._id);
      // First catalyst into a previously-empty specialized group: the
      // group now REPLACES the inherited group in this context, so the
      // inherited group's stats must come OUT of the context totals before
      // the new stat goes in (keeps cap-headroom bookkeeping coherent).
      if (best.isEmptyGroup && best.inheritedFullStats) {
        for (const [stat, val] of Object.entries(best.inheritedFullStats)) {
          totals[ctxKey][stat] = Math.max(0, (totals[ctxKey][stat] || 0) - val);
        }
      }
      totals[ctxKey][best.cand.stat] = (totals[ctxKey][best.cand.stat] || 0) + best.rawCandVal;
    }
  };

  // Phase 1: default groups. Only stats that DO something in default
  // context of that item type are allowed (e.g. laser/probes default =
  // battling XP/credits + gathering; crafting/exploring stats belong in
  // their own tabs). Also excludes specialized-only stats, and any
  // variant-specific restriction (resources = gathering only).
  // Stat weights (variant strategy) apply HERE ONLY.
  runPass(
    act => act === "default",
    (c, act, slot) => {
      if (SPECIALIZED_ONLY_STATS[c.stat]) return false;
      if (ACTIVITY_ONLY_STATS[c.stat]) return false;
      if (opts.restrictDefault && !opts.restrictDefault.includes(c.stat)) return false;
      const relevant = DEFAULT_RELEVANT_STATS[ITEM_CATEGORY[slot]];
      return !relevant || relevant.includes(c.stat);
    },
    true
  );
  // Voyager slots: voyager_jumps_bonus first (raises the voyager queue
  // cap) in EVERY variant, then the general pass fills the rest.
  runPass(act => act === "voyager", c => c.stat === "voyager_jumps_bonus", false);
  // Phase 2: remaining specialized groups with the remaining pool. A
  // catalyst is only suggested for a tab if its stat does something during
  // that activity. No weights here — raw gains so no tab is suppressed.
  runPass(
    act => act !== "default" && act !== "voyager",
    (c, act) => {
      const relevant = ACTIVITY_RELEVANT_STATS[act];
      return !relevant || relevant.includes(c.stat);
    },
    false
  );

  return { actions, used, freed };
}

module.exports = { statTotalsByContext, planInstalls, inheritedGroupInfo };
