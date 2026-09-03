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
  // Total pet food consumption: every equipped pet burns 1 food per
  // auto-feed cycle; cycle length = (100 - limit)/5 + 1 hours.
  const petFoodPerDay = pets
    .filter(x => x.equipped)
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

module.exports = { planPets };
