// Shared crafting-XP math. Loaded by lib/craft.js (engine, via require) and
// by the GUI's app.js (via a <script> tag, as window.CraftMath) so the
// simulator runs the same code on the server and in the browser.
//
// Two independent pieces, both taken from the live client bundle
// (index-DRkV5uhx.js, CraftingPage / BaseBuildingPage) and confirmed against
// this account's own snapshots:
//
//   1. the crafting level curve (the "required crafting XP" simulator):
//        target(1) = 100, target(n) = floor(target(n-1) * 1.1)
//      Five live snapshots agree exactly -- levels 65/74/82/85/86 report
//      required XP 43150 / 101742 / 218087 / 290272 / 319299.
//   2. the Craftron 3000 metal-scrap -> crafting-XP conversion:
//        total% = (level + Cat*3 + globalXP + PvP + catalystCraftingXP)
//                 x (1 + tech/100) x (1 + premium/100)
//                 x (1 + moduleBoost/2000) x (gasGiant ? 1.1 : 1)
//                 x (1 + forgeBurst/100) x (1 + dungeon/100)
//                 x 1.09 ^ max(0, level - 215)
//        xp     = floor(scraps x (1 + total%/100))
//      (BaseBuildingPage: the module card prints exactly
//      floor(z * (1 + total/100)) for z metal scraps.)
//
// Wrapped in a function: in the browser every one of these files is a classic
// <script> sharing ONE global scope, so a top-level name here would silently
// overwrite a sibling file's. Only window.CraftMath / module.exports leave
// this scope.
(function () {
const PROVENANCE = { client: "1.2.1", bundle: "index-DRkV5uhx.js" };

// --- crafting level curve (server player.levels.crafting_target_xp) ---
const XP_BASE = 100;         // target XP of crafting level 1
const XP_GROWTH = 1.1;       // each next level costs 10% more

// Memoised targets, computed lazily: targetXp(1) = 100, and each next level
// is floor(previous * 1.1). The recursion (floor each step) is what the game
// uses, not a closed form -- the two diverge a few levels in.
const _targets = [0, XP_BASE];
function targetXp(level) {
  level = Math.max(1, Math.floor(Number(level) || 1));
  while (_targets.length <= level) {
    _targets.push(Math.floor(_targets[_targets.length - 1] * XP_GROWTH));
  }
  return _targets[level];
}

// Total XP still to earn from (level, currentXp) to reach `to`. 0 when `to`
// is at or below the current level. currentXp is progress inside `level`.
function xpToReach(level, currentXp, to) {
  level = Math.max(1, Math.floor(Number(level) || 1));
  to = Math.floor(Number(to) || 0);
  if (to <= level) return 0;
  let total = Math.max(0, targetXp(level) - (Number(currentXp) || 0));
  for (let n = level + 1; n < to; n++) total += targetXp(n);
  return total;
}

// Apply an XP gain and roll the levels it buys. Returns the new level, the
// progress inside it, and how many levels were gained.
function applyXp(level, currentXp, gain) {
  level = Math.max(1, Math.floor(Number(level) || 1));
  let xp = Math.max(0, Number(currentXp) || 0);
  let left = Math.max(0, Math.floor(Number(gain) || 0));
  const from = level;
  let target = targetXp(level);
  while (xp + left >= target) {
    left -= Math.max(0, target - xp);
    xp = 0;
    level += 1;
    target = targetXp(level);
  }
  return { level, currentXp: xp + left, gained: level - from };
}

// --- Craftron 3000: metal scraps -> crafting XP ---
const PREMIUM_BONUS = 10;          // client premiumBonusMultiplier
const FORGE_XP_PER_LEVEL = 3;      // client spaceStationCraftBonuxXPChance: +3% per Forge level
const GAS_GIANT_BONUS = 10;        // bodyBonus === "crafting" (game wiki)
const GLOBAL_BOOST_PER_TIER = 5;   // client baseGlobalBonuses
const HIGH_LEVEL = 215;            // above this the whole bonus is scaled again
const HIGH_LEVEL_GROWTH = 1.09;    // ... by 1.09 per level (client)

// The global XP event's bonus from its remaining time: the client buckets the
// minutes left into 5 tiers (< 6h, 6-12h, 12-24h, 24-48h, 48h+) and pays
// 5 x tier.
function globalBoostBonus(remainingSec) {
  const sec = Number(remainingSec) || 0;
  if (sec <= 0) return { tier: 0, bonus: 0 };
  const min = Math.floor(sec / 60);
  const tier = min > 0 && min < 360 ? 1
    : min >= 360 && min < 720 ? 2
    : min >= 720 && min < 1440 ? 3
    : min >= 1440 && min < 2880 ? 4 : 5;
  return { tier, bonus: tier * GLOBAL_BOOST_PER_TIER };
}

// Squadron Crafting dungeon bonus from the highest run cleared (client
// dungeonBoostBonusPerLevel): +5% for the first 5 levels, +4% for 6-10,
// +3% for 11-20, +2% beyond.
function dungeonBoostBonus(highest) {
  const h = Math.max(0, Math.floor(Number(highest) || 0));
  let t = Math.min(h, 5) * 5;
  if (h > 5) t += Math.min(h - 5, 5) * 4;
  if (h > 10) t += Math.min(h - 10, 10) * 3;
  if (h > 20) t += (h - 20) * 2;
  return t;
}

// opts: { craftingLevel, catalystCraftingXp, catPetLevel, globalXpBoost,
//         pvpBoost, techBaseXpBoost, premium, moduleBoost, gasGiant,
//         forgeLevel, dungeonBonus }
// Returns { total, additive, forgeBonus, highLevelFactor, parts } where
// `total` is the percentage the module card prints; XP per scrap is
// (1 + total/100). Forge contributes 3% per Forge LEVEL (not the "chance of
// a +50% burst" the wiki describes) and is a multiplier, exactly as the
// client does it.
function craftronBonus(opts) {
  opts = opts || {};
  const level = Math.max(0, Number(opts.craftingLevel) || 0);
  const cat = Math.max(0, Number(opts.catPetLevel) || 0) * 3;
  const global = Number(opts.globalXpBoost) || 0;
  const pvp = Number(opts.pvpBoost) || 0;
  const catalyst = Number(opts.catalystCraftingXp) || 0;
  const additive = level + cat + global + pvp + catalyst;
  let total = additive;
  const tech = Math.max(0, Number(opts.techBaseXpBoost) || 0);
  if (tech > 0) total *= 1 + tech / 100;
  if (opts.premium) total *= 1 + PREMIUM_BONUS / 100;
  const moduleBoost = Math.max(0, Number(opts.moduleBoost) || 0);
  total *= 1 + moduleBoost / 2000;
  if (opts.gasGiant) total *= 1 + GAS_GIANT_BONUS / 100;
  const forgeBonus = Math.floor(Math.max(0, Number(opts.forgeLevel) || 0) * FORGE_XP_PER_LEVEL);
  if (forgeBonus > 0) total *= 1 + forgeBonus / 100;
  const dungeon = Number(opts.dungeonBonus) || 0;
  if (dungeon > 0) total *= 1 + dungeon / 100;
  const highLevelFactor = Math.pow(HIGH_LEVEL_GROWTH, Math.max(0, level - HIGH_LEVEL));
  total *= highLevelFactor;
  // The game rounds the percent to 2 decimals BEFORE multiplying the scraps.
  total = Number(total.toFixed(2));
  return {
    total, additive,
    parts: {
      level, cat, global, pvp, catalyst, tech,
      premium: opts.premium ? PREMIUM_BONUS : 0,
      moduleBoost, gasGiant: opts.gasGiant ? GAS_GIANT_BONUS : 0,
      forgeBonus, dungeon, highLevelFactor,
    },
    forgeBonus, highLevelFactor,
  };
}

// The module card's own number: floor(scraps x (1 + total/100)).
function scrapToXp(scraps, bonusPercent) {
  return Math.floor((Number(scraps) || 0) * (1 + (Number(bonusPercent) || 0) / 100));
}

// --- scrapping a blueprint (the other scrap source, wiki "Crafting") ---
// (50 + scraps required) x rarity multiplier x charges, Normal 1.5 up to
// Legendary 5. Kept next to the Craftron math because both answer "what are
// my scraps worth".
const SCRAP_RARITY_MULT = { normal: 1.5, uncommon: 2, rare: 2.5, unique: 3, epic: 4, legendary: 5 };
function scrapFromBlueprint(scrapsUse, rarity, charges) {
  const mult = SCRAP_RARITY_MULT[rarity] || 1;
  return Math.floor((50 + (Number(scrapsUse) || 0)) * mult * (Number(charges) || 1));
}

const CraftMath = {
  PROVENANCE, XP_BASE, XP_GROWTH, PREMIUM_BONUS, FORGE_XP_PER_LEVEL,
  GAS_GIANT_BONUS, GLOBAL_BOOST_PER_TIER, HIGH_LEVEL, HIGH_LEVEL_GROWTH, SCRAP_RARITY_MULT,
  targetXp, xpToReach, applyXp, craftronBonus, globalBoostBonus, dungeonBoostBonus,
  scrapToXp, scrapFromBlueprint,
};
if (typeof module !== "undefined" && module.exports) module.exports = CraftMath;
if (typeof window !== "undefined") window.CraftMath = CraftMath;
})();
