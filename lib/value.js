// Value helpers.

const {
  STAT_CATEGORIES, MERGE_CHANCE, CRAFT_LEVEL_MERGE_BONUS, RARITIES,
  MERGE_RANGE_BONUS, STAT_BASES, RARITY_MULT, FLAT_INTEGER_STATS, ITEM_ACTIVITIES,
} = require("./constants.js");

function statCategory(stat) {
  for (const [cat, stats] of Object.entries(STAT_CATEGORIES)) {
    if (stats.includes(stat)) return cat;
  }
  return null;
}
function activityOf(c) {
  return c.activity || "default";
}
function mergeRangeBonus(craftLevel) {
  return MERGE_RANGE_BONUS + Math.floor(craftLevel / 10);
}
function mergeSuccessChance(rarity, craftLevel) {
  return Math.min(100, (MERGE_CHANCE[rarity] || 50) + craftLevel * CRAFT_LEVEL_MERGE_BONUS);
}
function nextRarity(rarity) {
  const i = RARITIES.indexOf(rarity);
  return RARITIES[Math.min(i + 1, RARITIES.length - 1)];
}
function catalystValue(c) {
  const t = (STAT_BASES[c.stat] || 0) * (RARITY_MULT[c.rarity] || 1) * (c.range / 100);
  return c.halved ? 0.5 * t : t;
}
// Raw value ignoring the stored halved flag.
function rawValue(c) {
  return (STAT_BASES[c.stat] || 0) * (RARITY_MULT[c.rarity] || 1) * (c.range / 100);
}
// Effective value inside a group: uses the STORED halved flag only (the
// game bakes the same-stat penalty in at install time, then just sums).
function effInGroup(c) {
  return catalystValue(c);
}
function groupValue(group) {
  return group.reduce((s, c) => s + effInGroup(c), 0);
}
function fmtVal(stat, v) {
  const flat = FLAT_INTEGER_STATS.has(stat);
  return flat ? Math.floor(v).toString() : `${v.toFixed(2)}%`;
}
function fmtCat(c) {
  const h = c.halved ? " (halved)" : "";
  return `${c.rarity} ${c.stat} ${c.range}%${h}`;
}
function fmtAct(a) {
  return a === "default" ? "default" : a;
}
// Split an item's catalysts into activity groups. Normalizes legacy
// "dungeon" to "dungeons".
function itemGroups(slot, item) {
  const byAct = {};
  for (const act of ITEM_ACTIVITIES[slot] || []) byAct[act] = [];
  for (const c of item.catalysts || []) {
    const act = (activityOf(c) === "dungeon") ? "dungeons" : activityOf(c);
    (byAct[act] = byAct[act] || []).push(c);
  }
  return byAct;
}

module.exports = {
  statCategory, activityOf, mergeRangeBonus, mergeSuccessChance, nextRarity,
  catalystValue, rawValue, effInGroup, groupValue, fmtVal, fmtCat, fmtAct, itemGroups,
};
