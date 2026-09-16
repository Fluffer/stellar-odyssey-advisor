// Crafting-XP planner adapter: turns raw game state into the `craft` block
// of the analyze payload. The GUI re-runs CraftMath on this block when the
// target level or the bonus boxes change, so the math lives once, in
// public/craft-math.js.
//
// Everything the account itself can answer is prefilled from state:
//   - crafting level / current XP (CraftStore)
//   - the metal scrap stock (MaterialsStore) and the Metal scrap generator's
//     hourly output (BaseMath.baseProduction)
//   - the Craftron 3000 module boost (level, tier, base-module-efficiency)
//   - the gas-giant +10% (the founded base's bodyType)
//   - the crafting base-XP tech skill
//   - the equipped Cat pet's +3%/level
//   - premium (+10%) and the equipped catalysts' crafting_xp total
// The three the client does not expose in the state (Forge level, dungeon
// bonus, battlefield/PvP boost, global XP event) are left at 0 defaults and
// the GUI offers boxes for them.
const CraftMath = require("../public/craft-math.js");
const BaseMath = require("../public/base-math.js");
const { stocksFromState } = require("./lab.js");

function catFromPets(pets) {
  if (!pets || !Array.isArray(pets.pets)) return { level: 0, equipped: false };
  const cat = pets.pets.find(p => p.name === "Cat");
  return cat ? { level: cat.level || 0, equipped: !!cat.equipped } : { level: 0, equipped: false };
}

function craftingXpFromTotals(craftingTotals) {
  if (!Array.isArray(craftingTotals)) return 0;
  const row = craftingTotals.find(r => r.stat === "crafting_xp");
  return row ? (Number(row.total) || 0) : 0;
}

function planCraft(state, opts) {
  opts = opts || {};
  const craft = state.craft || {};
  const level = Math.max(1, Math.floor(Number(craft.crafting_level) || 1));
  const currentXp = Math.max(0, Math.floor(Number(craft.crafting_current_xp) || 0));
  const targetXp = Number(craft.crafting_target_xp) || CraftMath.targetXp(level);

  const eff = (state.player && state.player.skills && state.player.skills.base_module_efficiency_boost) || 0;
  const base = BaseMath.normalizeBase(state.base);
  const modules = base ? base.modules : [];
  const craftron = modules.find(m => m.name === "Craftron 3000") || null;
  const craftronBoost = craftron && craftron.unlocked ? BaseMath.moduleBoost(craftron, eff) : 0;
  const gasGiant = !!(base && BaseMath.BODY_NODE_BONUSES[base.bodyType] === "crafting");

  const cat = catFromPets(opts.pets);
  const techBaseXpBoost = (state.player && state.player.skills && state.player.skills.crafting_base_xp_boost) || 0;
  const premium = !!(state.pets && state.pets.premiumActive);
  const catalystCraftingXp = craftingXpFromTotals(opts.craftingTotals);

  // Global XP event: the state carries only the boost timers; the bonus is
  // derived from the time left (5 x tier), exactly as the client does.
  const now = Number(state.stateReadAt) || Math.floor(Date.now() / 1000);
  const xpTimer = state.globalBoosts ? Number(state.globalBoosts["XP"]) : 0;
  const globalXpBoost = xpTimer > 0 ? CraftMath.globalBoostBonus(xpTimer - now).bonus : 0;

  // Squadron Forge and Crafting dungeon: both live on the squadron object.
  const sq = state.squadron || null;
  const forgeLevel = sq ? Math.max(0, Number(sq.forgeLevel) || 0) : 0;
  const craftingHighest = sq ? Math.max(0, Number(sq.craftingHighest) || 0) : 0;
  const dungeonBonus = CraftMath.dungeonBoostBonus(craftingHighest);
  const pvpBoost = 0;

  const stocks = stocksFromState(state);
  const scrapStock = stocks["metal scrap"] || 0;
  const rates = base ? BaseMath.productionByProduct(base, eff) : {};
  const scrapPerHour = rates["metal scrap"] || 0;

  const bonusOpts = {
    craftingLevel: level, catalystCraftingXp, catPetLevel: cat.equipped ? cat.level : 0,
    premium, moduleBoost: craftronBoost, gasGiant, techBaseXpBoost,
    globalXpBoost, forgeLevel, dungeonBonus, pvpBoost,
  };
  const bonus = CraftMath.craftronBonus(bonusOpts);

  return {
    provenance: CraftMath.PROVENANCE,
    level, currentXp, targetXp,
    nextLevelXp: CraftMath.targetXp(level),
    // Auto-filled inputs. `overrides` is what the GUI boxes remember; the
    // server only reports the live values it can see.
    scrapStock, scrapPerHour,
    moduleBoost: craftronBoost,
    craftronUnlocked: !!craftron,
    gasGiant, bodyType: base ? base.bodyType : null,
    techBaseXpBoost, premium, catalystCraftingXp,
    catPetLevel: cat.level, catEquipped: cat.equipped,
    // Auto-filled from the squadron / global boost timers. The GUI keeps
    // editable boxes so a value the state cannot see can still be tried.
    globalXpBoost, forgeLevel, craftingHighest, dungeonBonus,
    defaults: { forgeLevel, dungeonBonus, pvpBoost, globalXpBoost },
    bonus,
    bonusTotal: bonus.total,
    xpPerScrap: 1 + bonus.total / 100,
    // The level curve around the current level, so the tab can show where the
    // player is without recomputing the whole thing client-side.
    curve: (() => {
      const out = [];
      for (let n = level; n < level + 10; n++) out.push({ level: n, target: CraftMath.targetXp(n) });
      return out;
    })(),
  };
}

module.exports = { planCraft };
