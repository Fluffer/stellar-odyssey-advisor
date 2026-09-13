// Pet advisor.

// Formulas, constants and the food/boost cost model live in
// ./public/pet-math.js, shared with the GUI's simulator (app.js) so the
// game math is defined exactly once.
const PetMath = require("../public/pet-math.js");
const {
  PET_FOOD_DECAY, PET_FOOD_FLOOR, PET_PREMIUM_BONUS, PET_COMMON_RESOURCES,
  petXpTarget, petXpBoostCost, petXpBoostCostCumulative, petXpPerHour,
  petHoursToNextLevel, petAvgFood,
} = PetMath;

// What each pet DOES -- the passive bonus it grants while equipped. Taken
// from the game's own PetsPage summary (a switch on pet.name) so the numbers
// are the ones the game prints:
//
//   Dog       Resources L%     XP: L*3%      Dragon  Credits L%   XP: L*3%
//   Owl       Cosmic Dust L%   XP: L*3%      Cat     Min range L% XP: L*3%
//   Drone     Drop Chance +L%                Quadruped  Rarity Chance +L*3%
//   Darnex    Stat per Day: +L (avg)         Velari  Stats: +L*50
//   Roller    Tax bonus: L%                  Selyn / Korin / Humanoid: action
//
// The four boosters ALSO multiply the matching dungeon power by (1 + L/100),
// which the game's summary line leaves out. That is not a guess: DungeonPage
// applies `e *= 1 + pet.level / 100` for Dragon (damage and HP), Dog
// (gathering), Cat (crafting) and Owl (exploring), and the bundle's own pets
// wiki page documents it. It is worth showing because it is the reason to
// level a booster you are not otherwise using.
//
// Selyn's success rate (L*3%) comes from that same wiki page: the game files
// it under "action" and prints no number, but the number is real.
//
// Effects are DATA, not sentences: lib/ stays language-free and the GUI
// labels each key. `pct` renders as a percentage, `mult` as a multiplier,
// `flat` as a bare number, and an entry with none of them is an action the
// pet performs rather than a bonus it grants.
const PET_EFFECTS = {
  Dragon: L => [
    { key: "battling_credits", pct: L },
    { key: "battling_xp", pct: L * 3 },
    { key: "dungeon_damage_hp", mult: 1 + L / 100 },
  ],
  Dog: L => [
    { key: "gathering_resources", pct: L },
    { key: "gathering_xp", pct: L * 3 },
    { key: "dungeon_gathering", mult: 1 + L / 100 },
  ],
  Cat: L => [
    { key: "craft_min_range", pct: L },
    { key: "crafting_xp", pct: L * 3 },
    { key: "dungeon_crafting", mult: 1 + L / 100 },
  ],
  Owl: L => [
    { key: "cosmic_dust", pct: L },
    { key: "exploring_xp", pct: L * 3 },
    { key: "dungeon_exploring", mult: 1 + L / 100 },
  ],
  Drone: L => [{ key: "drop_chance", pct: L }],
  Quadruped: L => [{ key: "rarity_chance", pct: L * 3 }],
  Roller: L => [{ key: "squadron_tax", pct: L }],
  Humanoid: () => [{ key: "salvage" }],
  Darnex: L => [{ key: "stat_per_day", flat: L }],
  Velari: L => [{ key: "pvp_stats", flat: L * 50 }],
  Selyn: L => [{ key: "enhance_success", pct: L * 3 }],
  Korin: L => [
    { key: "capsule_enhance" },
    { key: "engine_cooldown", pct: -L },
  ],
};

// Round the way the game prints: percentages to at most one decimal (they are
// whole numbers today, but L*3 on a fractional level would not be), and the
// dungeon multiplier to two, since 1 + L/100 is where the interesting digits
// are.
function petEffects(name, level) {
  const build = PET_EFFECTS[name];
  if (!build) return [];
  return build(level).map(e => {
    const out = { key: e.key };
    if (e.pct !== undefined) out.pct = Math.round(e.pct * 10) / 10;
    if (e.mult !== undefined) out.mult = Math.round(e.mult * 100) / 100;
    if (e.flat !== undefined) out.flat = e.flat;
    if (e.pct === undefined && e.mult === undefined && e.flat === undefined) out.action = true;
    return out;
  });
}

function planPets(state) {
  const pd = state.pets;
  if (!pd || !pd.pets) return null;
  const techSkill = ((state.player && state.player.skills) || {}).pets_base_xp_boost ?? 0;
  const premiumActive = !!pd.premiumActive;
  const res = state.commonResources || {};
  const slots = pd.petSlots || [];
  const slotOf = new Map();
  for (const s of slots) if (s.pet) slotOf.set(s.pet, s);

  const pets = pd.pets.map(p => {
    const slot = slotOf.get(p._id) || null;
    const equipped = !!slot;
    const autofeed = slot ? !!slot.autofeed : false;
    const autofeedLimit = slot ? (slot.autofeed_limit || PET_FOOD_FLOOR) : PET_FOOD_FLOOR;
    const boost = p.xpboost || 0;
    const target = petXpTarget(p.level);
    const hoursNow = equipped
      ? petHoursToNextLevel(p.level, p.current_xp, boost, p.food, autofeed, autofeedLimit, techSkill, premiumActive)
      : null;
    const hoursPlusOne = equipped
      ? petHoursToNextLevel(p.level, p.current_xp, boost + 1, p.food, autofeed, autofeedLimit, techSkill, premiumActive)
      : null;
    const costNext = petXpBoostCost(boost);
    const minResource = PET_COMMON_RESOURCES.reduce((m, r) => Math.min(m, res[r] ?? 0), Infinity);
    return {
      id: p._id, name: p.name, type: p.pet_type,
      level: p.level, currentXp: p.current_xp, targetXp: target,
      boost, food: p.food, activeTimer: p.activeTimer,
      equipped, slotType: slot ? slot.pet_type : null,
      autofeed, autofeedLimit,
      avgFood: equipped ? petAvgFood(p.food, autofeed, autofeedLimit) : null,
      xpPerHourNow: equipped ? petXpPerHour(p.level, boost, p.food, techSkill, premiumActive) : 0,
      hoursToLevel: hoursNow,
      hoursToLevelPlusOne: hoursPlusOne,
      hoursSavedPlusOne: hoursNow !== null && hoursPlusOne !== null ? hoursNow - hoursPlusOne : null,
      // What this pet grants right now. `effects` is what it does at its
      // current level; it only actually applies while equipped, which the
      // GUI dims on.
      effects: petEffects(p.name, p.level),
      costNextBoost: costNext,
      affordableBoost: minResource >= costNext,
      minResource: minResource === Infinity ? null : minResource,
    };
  });
  pets.sort((a, b) => (b.equipped - a.equipped) || a.name.localeCompare(b.name));
  let scarcest = null;
  for (const r of PET_COMMON_RESOURCES) {
    const amount = res[r] ?? 0;
    if (!scarcest || amount < scarcest.amount) scarcest = { name: r, amount };
  }
  // Total pet food consumption: every auto-fed equipped pet burns 1 food per
  // auto-feed cycle; cycle length = (100 - limit)/5 + 1 hours. Without
  // auto-feed food sits at the floor and nothing is consumed.
  const petFoodPerDay = pets
    .filter(x => x.equipped && x.autofeed)
    .reduce((s, x) => s + 24 / ((100 - x.autofeedLimit) / 5 + 1), 0);

  // Korin (pet_type 'generator'): converts normal warp capsules into
  // enhanced warp capsules that refuel more of the voyager's max fuel and
  // reduce engine cooldown. Formulas from the game bundle:
  //   dust/capsule = floor(10000 * level^0.85)
  //   enhanced capsule refuel = (1 + level*0.20)x voyager max fuel
  //   engine cooldown reduction = level%
  const korinPet = pd.pets.find(p => p.pet_type === "generator" && p.name === "Korin");
  let korin = null;
  if (korinPet) {
    const level = korinPet.level;
    const materials = state.materials || [];
    const stockOf = name => {
      const m = materials.find(x => x && x.name === name);
      return m ? (m.quantity || 0) : 0;
    };
    const voyager = state.voyager || null;
    const dust = state.dust || 0;
    const dustCostPerCapsule = Math.floor(10000 * Math.pow(level, 0.85));
    const capsules = stockOf("warp capsule");
    const enhancedCapsules = stockOf("enhanced warp capsule");
    const fuelMultiplier = 1 + level * 0.20;
    const nextLevel = level + 1;
    korin = {
      level, dustCostPerCapsule, capsules, enhancedCapsules, dust,
      // Its effects only apply while it sits in a slot.
      equipped: slotOf.has(korinPet._id),
      affordableNow: Math.min(capsules, Math.floor(dust / dustCostPerCapsule)),
      fuelPerEnhanced: voyager && voyager.max_fuel ? Math.round(voyager.max_fuel * fuelMultiplier) : null,
      fuelMultiplier,
      cooldownReductionPct: level,
      nextLevel: {
        level: nextLevel,
        dustCostPerCapsule: Math.floor(10000 * Math.pow(nextLevel, 0.85)),
        fuelMultiplier: 1 + nextLevel * 0.20,
      },
    };
  }

  return {
    techSkill, premiumActive, petFood: pd.petFood || 0,
    resources: res,
    scarcest,
    petFoodPerDay: Math.round(petFoodPerDay * 10) / 10,
    petFoodDays: petFoodPerDay > 0 ? Math.floor((pd.petFood || 0) / petFoodPerDay) : null,
    model: {
      foodDecay: PET_FOOD_DECAY, foodFloor: PET_FOOD_FLOOR,
      premiumBonus: PET_PREMIUM_BONUS,
      commonResources: PET_COMMON_RESOURCES,
    },
    pets,
    korin,
  };
}

module.exports = { planPets, petEffects, PET_EFFECTS };
