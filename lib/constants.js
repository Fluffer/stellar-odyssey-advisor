// Game constants (extracted from game source).

// NPC definitions (from game source battlingNPCs)
const BATTLING_NPCS = [
  { name: "brutes",    weakness: ["kinetic", "explosive"] },
  { name: "spectres",  weakness: ["energy", "electromagnetic"] },
  { name: "glacials",  weakness: ["explosive", "incendiary"] },
  { name: "machiners", weakness: ["energy", "electromagnetic"] },
  { name: "scorchers", weakness: ["chemical", "kinetic"] },
  { name: "toxoids",   weakness: ["incendiary", "chemical"] },
  { name: "miners",    weakness: ["kinetic", "explosive"] },
  { name: "dusters",   weakness: ["electromagnetic", "chemical"] },
];

const RARITIES = ["normal", "uncommon", "rare", "unique", "epic", "legendary"];
const RARITY_MULT = { normal: 1, uncommon: 1.5, rare: 2, unique: 2.5, epic: 3, legendary: 4 };
// Ship item (weapon/shield/engine/sensors/laser/probes) rarity multiplier
// used in the craft-time value roll. Distinct from RARITY_MULT above, which
// is the catalyst-installation multiplier - ship items use a flatter curve.
const SHIP_ITEM_RARITY_MULT = { normal: 1, uncommon: 1.1, rare: 1.25, unique: 1.5, epic: 1.75, legendary: 2 };
// Which crafting skill's level, AT CRAFT TIME, becomes a ship item's level
// (recrafting at a higher skill level yields a higher item level).
const ITEM_MATCHING_SKILL = {
  weapon_slot: "battling", shield_slot: "battling",
  laser_slot: "gathering", probes_slot: "gathering",
  engine_slot: "exploring", sensors_slot: "exploring",
};
const STAT_BASES = {
  defense: 10, armor_penetration: 10, lifesteal: 3, stun: 10, block: 10,
  dot: 10, precision: 5, evasion: 5, battling_xp: 10, battling_credits: 10,
  gathering_xp: 10, gathering_yield: 10, exploring_xp: 10, cosmic_dust_bonus: 10,
  crafting_xp: 10, crafting_scrap: 10, catalyst_drop_chance: 5,
  fuel_efficiency: 5, voyager_jumps_bonus: 2, base_upkeep_reduction: 5,
};
const STAT_CATEGORIES = {
  battling: ["defense", "armor_penetration", "lifesteal", "stun", "block", "dot", "precision", "evasion"],
  boost: ["battling_xp", "battling_credits", "gathering_xp", "gathering_yield", "exploring_xp", "cosmic_dust_bonus", "crafting_xp", "crafting_scrap"],
  utility: ["catalyst_drop_chance", "fuel_efficiency", "voyager_jumps_bonus", "base_upkeep_reduction"],
};
const ITEM_CATEGORY = {
  weapon_slot: "battling", shield_slot: "battling",
  engine_slot: "utility", sensors_slot: "utility",
  laser_slot: "boost", probes_slot: "boost",
};
// Per-category activity tabs (from live game config catalystActivitiesByCategory):
//   battling: default, galaxyboss, dungeons
//   boost:    default, exploring, crafting, galaxyboss, dungeons
//   utility:  default, voyager
// Voyager profiles INHERIT the exploring profile when empty
// (catalystActivityFallbacks: { voyager: ["exploring"] }).
const ITEM_ACTIVITIES = {
  weapon_slot: ["default", "galaxyboss", "dungeons"],
  shield_slot: ["default", "galaxyboss", "dungeons"],
  engine_slot: ["default", "voyager"],
  sensors_slot: ["default", "voyager"],
  laser_slot: ["default", "exploring", "crafting", "galaxyboss", "dungeons"],
  probes_slot: ["default", "exploring", "crafting", "galaxyboss", "dungeons"],
};
// Activity profiles that fall back to another profile's bonuses when empty.
const ACTIVITY_FALLBACKS = { voyager: ["exploring"] };
// Per-item, per-context resolution chain (game source: chain(activity) =
// [activity, ...(fallbacks[activity] ?? []), 'default'], deduped).
// getEquippedOn(item, activity) walks this chain and returns the FIRST
// non-empty catalyst group on the item - that group and ONLY that group
// contributes to the item's bonuses in that activity. A non-empty
// specialized group therefore REPLACES the default group in that context;
// an empty specialized group means the item inherits down the chain
// (voyager -> exploring -> default).
function activityChain(activity) {
  if (activity === "default") return ["default"];
  const chain = [activity, ...(ACTIVITY_FALLBACKS[activity] || []), "default"];
  return [...new Set(chain)];
}
const MERGE_CHANCE = { normal: 100, uncommon: 75, rare: 60, unique: 45, epic: 30, legendary: 20 };
const MERGE_COST = { normal: 0, uncommon: 27, rare: 31, unique: 37, epic: 43, legendary: 50 };
const PROTECT_COST = { normal: 0, uncommon: 50, rare: 100, unique: 200, epic: 500, legendary: 1000 };
const MERGE_RANGE_BONUS = 5;
const CRAFT_LEVEL_MERGE_BONUS = 0.1;
const SLOTS_PER_GROUP = 4;
const MAX_SAME_STAT = 2;
const SAME_STAT_PENALTY = 0.5;
const FLAT_INTEGER_STATS = new Set(["voyager_jumps_bonus"]);
// Minimum gain for a suggestion to be worth the install resources. A swap
// that gains less than this (e.g. fresh 88 replacing a halved 87 = +0.05%)
// costs more to install than it delivers — leave the installed one in place.
const MIN_WORTHWHILE_GAIN = 0.1;
// Stat caps applied by the battle sim at combat time. Block has TWO caps:
// 40 vs regular NPCs, 25 in galaxy boss. Others are per-context where noted.
const STAT_CAPS = {
  lifesteal: 36, defense: 50, armor_penetration: 50,
  stun: 40, voyager_jumps_bonus: 15, fuel_efficiency: 60,
  base_upkeep_reduction: 60, catalyst_drop_chance: 60,
};
const STAT_CAPS_BY_CONTEXT = {
  block: { default: 40, exploring: 40, crafting: 40, dungeons: 40, galaxyboss: 25, voyager: 40 },
};

// Stats that only matter in a specific activity context -> they should
// ALWAYS go to their specialized tab, never the default tab (default slots
// are reserved for always-on stats like battling/gathering).
const SPECIALIZED_ONLY_STATS = {
  voyager_jumps_bonus: "voyager",
};

// Which stats actually DO something during each activity. A catalyst whose
// stat is not relevant to the tab's activity is wasted there (e.g.
// gathering_yield in the crafting tab has no effect while crafting).
const BATTLING_STATS = ["defense", "armor_penetration", "lifesteal", "stun", "block", "dot", "precision", "evasion"];
const ACTIVITY_RELEVANT_STATS = {
  default: null, // null = everything applies (default is always-on)
  exploring: ["exploring_xp", "cosmic_dust_bonus"],
  crafting: ["crafting_xp", "crafting_scrap"],
  galaxyboss: [...BATTLING_STATS, "battling_xp", "battling_credits"],
  dungeons: [...BATTLING_STATS, "battling_xp", "battling_credits"],
  // Boost items (laser/probes) have NO voyager tab, so an expedition resolves
  // voyager -> exploring, and the game labels that tab "Exploring & Voyager"
  // on those two items and lists its Cosmic Dust Bonus as a current bonus.
  // That label is about the PROFILE, not about the dust reward. Measured on a
  // real expedition (Zilsynkyxbal, 2026-09-09: K star 10 + 3 bodies 60 +
  // 17,956.78 ly = raw 18,026.78) the voyager paid 17,044 kept + 5,681 taxed
  // = 22,725 gross, confirmed independently by the publish credits
  // (22.72M = 1000x gross). That is a multiplier of x1.2606 -- and this was
  // WITH a 20% voyager reward bonus and a 10% voyager tech skill already
  // bought. The player's cosmic dust catalyst was +54.9% and the exploring
  // cosmic-dust skill +100%; either one alone would have put the result
  // above x2. So neither reaches an expedition: do not add cosmic_dust_bonus
  // here. (What the x1.2606 decomposes into is NOT settled -- it is within
  // 0.5% of owl 14% x premium 10%, which would mean the two upgrades did
  // nothing measurable. One data point cannot separate that from the levers
  // applying against a smaller base. The catalyst conclusion holds either
  // way. exploring_xp on an expedition is likewise untested.)
  voyager: ["fuel_efficiency", "catalyst_drop_chance", "voyager_jumps_bonus"],
};

// Per item-type (category), which stats are relevant in the DEFAULT tab.
// NOTE: the category check (battling/boost/utility catalyst -> matching
// item type) is enforced separately, so these lists only ever widen or
// narrow within a catalyst's own installable items:
//   battling catalysts -> weapon/shield only
//   boost catalysts    -> laser/probes only
//   utility catalysts  -> engine/sensors only
const DEFAULT_RELEVANT_STATS = {
  battling: [...BATTLING_STATS],
  boost: ["battling_xp", "battling_credits", "gathering_xp", "gathering_yield"],
  utility: ["fuel_efficiency", "catalyst_drop_chance"],
};

// Resource stats that only apply during their own activity -> they belong
// in that activity's tab, never default.
const ACTIVITY_ONLY_STATS = {
  crafting_scrap: "crafting",
  crafting_xp: "crafting",
  exploring_xp: "exploring",
  cosmic_dust_bonus: "exploring",
};

module.exports = {
  BATTLING_NPCS, RARITIES, RARITY_MULT, SHIP_ITEM_RARITY_MULT, ITEM_MATCHING_SKILL,
  STAT_BASES, STAT_CATEGORIES, ITEM_CATEGORY,
  ITEM_ACTIVITIES, ACTIVITY_FALLBACKS, activityChain, MERGE_CHANCE, MERGE_COST, PROTECT_COST,
  MERGE_RANGE_BONUS, CRAFT_LEVEL_MERGE_BONUS, SLOTS_PER_GROUP, MAX_SAME_STAT,
  SAME_STAT_PENALTY, FLAT_INTEGER_STATS, MIN_WORTHWHILE_GAIN, STAT_CAPS,
  STAT_CAPS_BY_CONTEXT, SPECIALIZED_ONLY_STATS, BATTLING_STATS,
  ACTIVITY_RELEVANT_STATS, DEFAULT_RELEVANT_STATS, ACTIVITY_ONLY_STATS,
};
