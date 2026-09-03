// Catalyst inventory browser + sell advisor.

const { RARITIES } = require("./constants.js");
const { statCategory, activityOf, mergeRangeBonus, nextRarity, catalystValue } = require("./value.js");
const { tierThreshold } = require("./merges.js");

// Classify every unequipped catalyst: what it's already earmarked for
// (an install plan or a merge group), and whether it's dead weight for the
// perfect-legendary path — a catalyst whose range falls short of the
// average its own rarity tier needs to feed a merge that stays on that
// path. Legendaries are end products and are never flagged.
function planInventory(state, { reservedIds, mergePlans, craftLevel }) {
  const mergeIds = new Set();
  for (const plan of mergePlans || []) {
    for (const step of plan.steps || []) {
      for (const g of step.groups || []) {
        for (const id of g.ids || []) mergeIds.add(id);
      }
    }
  }
  const bonus = mergeRangeBonus(craftLevel);

  const items = [];
  let planned = 0, mergeFodder = 0, sellCandidates = 0;
  for (const c of state.catalysts) {
    if (c.equippedOn) continue;
    const act = activityOf(c) === "dungeon" ? "dungeons" : activityOf(c);

    let plannedUse = null;
    if (reservedIds.has(c._id)) plannedUse = "install";
    else if (mergeIds.has(c._id)) plannedUse = "merge";

    let sellCandidate = false, sellReason = null;
    if (!plannedUse && !c.locked && !c.onMarket && c.rarity !== "legendary") {
      const inputAvgNeeded = Math.max(0, tierThreshold(RARITIES.indexOf(nextRarity(c.rarity)), bonus) - bonus);
      if (c.range < inputAvgNeeded) {
        sellCandidate = true;
        sellReason = `range ${c.range} < ${Math.round(inputAvgNeeded * 10) / 10} needed for the perfect path at ${c.rarity}`;
      }
    }

    if (plannedUse === "install") planned++;
    else if (plannedUse === "merge") mergeFodder++;
    if (sellCandidate) sellCandidates++;

    items.push({
      id: c._id, stat: c.stat, rarity: c.rarity, range: c.range, activity: act,
      category: statCategory(c.stat),
      value: Math.round(catalystValue(c) * 100) / 100,
      onMarket: !!c.onMarket, locked: !!c.locked,
      plannedUse, sellCandidate, sellReason,
    });
  }

  return { items, counts: { total: items.length, planned, mergeFodder, sellCandidates } };
}

module.exports = { planInventory };
