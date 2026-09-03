// Catalyst merge planning.

const { RARITIES, MERGE_COST, PROTECT_COST, STAT_BASES, RARITY_MULT, SAME_STAT_PENALTY } = require("./constants.js");
const { mergeRangeBonus, mergeSuccessChance, nextRarity, activityOf, fmtCat, fmtVal } = require("./value.js");

// The game's planCatalystMergeGroups: form groups of 5 using the WEAKEST
// catalysts that still reach avg + bonus >= target (saves high ranges).
function planCatalystMergeGroups(items, bonus, target = 100, size = 5) {
  const s = [...items].sort((a, b) => b.range - a.range);
  const n = Math.floor(s.length / size);
  if (n < 1) return { groups: [], leftover: s };
  const need = size * Math.max(0, target - bonus);
  const groups = [];
  while (groups.length < n) {
    const grp = [];
    let sum = 0;
    while (grp.length < size) {
      const remaining = size - grp.length - 1;
      let topSum = 0;
      for (let k = 0; k < remaining; k++) topSum += s[k].range;
      const proj = (idx) => topSum + (idx < remaining ? s[remaining].range : s[idx].range);
      let pick = 0;
      if (proj(0) >= need - sum) {
        for (let k = s.length - 1; k >= 0; k--) {
          if (proj(k) >= need - sum) { pick = k; break; }
        }
      }
      const c = s.splice(pick, 1)[0];
      grp.push(c);
      sum += c.range;
    }
    groups.push(grp.sort((a, b) => b.range - a.range));
  }
  return { groups, leftover: s };
}

// Minimum RESULT range a merge into rarity rIdx must achieve to stay on the
// perfect-legendary path (merge bonus propagates one tier per step).
function tierThreshold(rIdx, bonus) {
  return Math.max(0, 100 - (RARITIES.length - 1 - rIdx) * bonus);
}

// Merge chains per (stat, activity). Base groups come from inventory
// catalysts only. Optionally, ONE installed catalyst may be pulled from gear
// to complete a group of 5 (4 inventory + 1 pulled), provided the merged
// result re-installed in the freed slot is at least as valuable as the
// pulled catalyst was (no degradation of the overall installation).
// Only merges that stay on the perfect-legendary path are suggested;
// pulled-catalyst merges must ALSO strictly improve (result > pulled).
function planMerges(pool, craftLevel, installedPulls = []) {
  const bonus = mergeRangeBonus(craftLevel);
  const byStatAct = {};
  for (const c of pool) {
    if (c.onMarket || c.locked) continue;
    const key = `${c.stat}|${activityOf(c)}`;
    (byStatAct[key] = byStatAct[key] || []).push(c);
  }
  // Index the pullable installed catalysts the same way.
  const pullsByStatAct = {};
  for (const c of installedPulls) {
    if (c.onMarket || c.locked) continue;
    const act = (c._activity === "dungeon") ? "dungeons" : (c._activity || "default");
    const key = `${c.stat}|${act}`;
    (pullsByStatAct[key] = pullsByStatAct[key] || []).push(c);
  }
  const plans = [];
  for (const [key, list] of Object.entries(byStatAct)) {
    const [stat, act] = key.split("|");
    const tiers = {};
    RARITIES.forEach(r => (tiers[r] = list.filter(c => c.rarity === r)));
    const pullTiers = {};
    RARITIES.forEach(r => (
      pullTiers[r] = (pullsByStatAct[key] || []).filter(c => c.rarity === r)
    ));
    const steps = [];
    const usedPullIds = new Set();
    for (let i = 0; i < RARITIES.length; i++) {
      const rarity = RARITIES[i];
      const next = nextRarity(rarity);
      if (tiers[rarity].length < 5) continue;
      const isLegendaryPerfection = rarity === "legendary";
      const { groups, leftover } = planCatalystMergeGroups(tiers[rarity], bonus);
      let usable = groups.filter(g => {
        const res = Math.min(100, g.reduce((s, c) => s + c.range, 0) / g.length + bonus);
        if (isLegendaryPerfection) {
          return res >= 100 && res > Math.max(...g.map(c => c.range)) - 0.001;
        }
        return res >= tierThreshold(RARITIES.indexOf(next), bonus);
      });
      // Nothing usable: this tier is a dead end -> skip (do not suggest).
      if (usable.length) {
        const chance = Math.round(mergeSuccessChance(rarity, craftLevel) * 10) / 10;
        const cost = MERGE_COST[rarity];
        const protect = PROTECT_COST[rarity];
        const p = chance / 100;
        const recommendProtect = cost > 0 && (cost / p) > (cost + protect);
        steps.push({
          from: rarity, to: next, chance,
          dustPerMerge: undefined, qcPerMerge: cost, qcProtectPerMerge: protect, recommendProtect,
          groups: usable.map(g => ({
            ids: g.map(c => c._id),
            inputs: g.map(c => c.range),
            result: Math.round(Math.min(100, g.reduce((s, c) => s + c.range, 0) / g.length + bonus) * 10) / 10,
            pulled: [],
          })),
        });
        const resultRarity = isLegendaryPerfection ? "legendary" : next;
        tiers[resultRarity] = tiers[resultRarity].concat(usable.map(g => ({
          _id: "projected",
          stat, rarity: resultRarity,
          range: Math.min(100, g.reduce((s, c) => s + c.range, 0) / g.length + bonus),
        })));
        tiers[rarity] = leftover.concat(groups.filter(g => !usable.includes(g)).flat());
      }

      // --- Pull-from-gear merges for this tier ---
      // Only when inventory alone can't complete a group (4 available).
      // At most ONE pulled catalyst per group; the merged result must
      // strictly beat the pulled catalyst's effective value in its slot.
      const invCount = tiers[rarity].length;
      const pullAvail = pullTiers[rarity].filter(c => !usedPullIds.has(c._id));
      if (isLegendaryPerfection) continue; // never pull installed legendaries
      if (invCount >= 4 && pullAvail.length > 0) {
        // Take the 4 strongest inventory catalysts of this tier.
        const inv4 = [...tiers[rarity]].sort((a, b) => b.range - a.range).slice(0, 4);
        for (const pulled of pullAvail) {
          if (invCount < 4) break;
          const all5 = [...inv4, pulled];
          const res = Math.min(100, all5.reduce((s, c) => s + c.range, 0) / all5.length + bonus);
          // Chain-path requirement (same as pure-inventory merges).
          if (res < tierThreshold(RARITIES.indexOf(next), bonus)) continue;
          // No-degradation: result re-installed in the pulled catalyst's
          // slot. If a same-stat sibling remains in that group, the result
          // becomes the 2nd same-stat -> halved.
          const remainingSame = Math.max(0, pulled._groupSameStat - 1);
          const resultHalved = remainingSame >= 1;
          const resultValue = (STAT_BASES[stat] || 0) * (RARITY_MULT[next] || 1) *
            (res / 100) * (resultHalved ? SAME_STAT_PENALTY : 1);
          if (resultValue < pulled._eff - 0.001) continue; // would degrade
          if (resultValue <= pulled._eff + 0.001 && res <= pulled.range) continue; // not a real upgrade
          // Commit: consume the 4 inventory catalysts and the pull.
          usedPullIds.add(pulled._id);
          for (const c of inv4) {
            const idx = tiers[rarity].findIndex(x => x._id === c._id);
            if (idx !== -1) tiers[rarity].splice(idx, 1);
          }
          const chance2 = Math.round(mergeSuccessChance(rarity, craftLevel) * 10) / 10;
          const cost2 = MERGE_COST[rarity];
          const protect2 = PROTECT_COST[rarity];
          const p2 = chance2 / 100;
          const prot2 = cost2 > 0 && (cost2 / p2) > (cost2 + protect2);
          // Find or create the step for this tier.
          let step = steps.find(s2 => s2.from === rarity && s2.to === next && s2.pullsAllowed !== false);
          if (!step) {
            step = {
              from: rarity, to: next, chance: chance2,
              qcPerMerge: cost2, qcProtectPerMerge: protect2, recommendProtect: prot2,
              groups: [],
            };
            steps.push(step);
          }
          step.groups.push({
            ids: all5.map(c => c._id),
            inputs: all5.map(c => c.range),
            result: Math.round(res * 10) / 10,
            pulled: [{
              id: pulled._id,
              text: fmtCat(pulled),
              item: pulled._item,
              activity: pulled._activity,
              reinstallText: fmtVal(stat, resultValue),
            }],
          });
          tiers[next] = tiers[next].concat([{
            _id: "projected",
            stat, rarity: next, range: res,
          }]);
          break; // only one pull-merge per tier per stat
        }
      }
    }
    const legendaries = tiers.legendary.map(c => Math.round(c.range * 10) / 10);
    if (steps.length) {
      // Present the plan as a CHAIN: the projected final legendary is the
      // goal (e.g. "=> legendary 70"), and each step shows how to get there.
      const bestLegendary = legendaries.length ? Math.max(...legendaries) : null;
      // Order steps bottom-up (normal first, legendary last).
      steps.sort((a, b) => RARITIES.indexOf(a.from) - RARITIES.indexOf(b.from));
      let chainGoal = null;
      if (bestLegendary !== null) {
        chainGoal = bestLegendary >= 100
          ? `perfect legendary ${stat} 100`
          : `legendary ${stat} ${Math.round(bestLegendary * 10) / 10}`;
      } else {
        // No legendary reachable: goal = best projected result of any step.
        let bestRes = 0, bestTo = null;
        for (const st of steps) {
          for (const g of st.groups) {
            if (g.result > bestRes) { bestRes = g.result; bestTo = st.to; }
          }
        }
        chainGoal = bestTo ? `${bestTo} ${stat} ${Math.round(bestRes * 10) / 10}` : null;
      }
      plans.push({
        stat, activity: act, steps,
        chainGoal,
        projectedLegendaries: legendaries,
        perfectCount: legendaries.filter(r => r >= 100).length,
      });
    }
  }
  plans.sort((a, b) => (b.perfectCount - a.perfectCount) ||
    (b.projectedLegendaries.length - a.projectedLegendaries.length));
  return plans;
}

module.exports = { planCatalystMergeGroups, tierThreshold, planMerges };
