// Behavior locks for the materials advisor (lib/materials.js) and the Korin
// warp-capsule enhancement math (lib/pets.js), ported from the game's JS
// bundle. Goldens were produced by running the CURRENT implementation and
// hardcoding its output.
"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { planMaterials } = require("../lib/materials.js");
const { planPets, petEffects } = require("../lib/pets.js");

describe("Korin dust cost formula", () => {
  test("golden values at levels 1, 13, 30", () => {
    // golden: locks current formula (floor(10000 * level^0.85))
    const cost = (level) => Math.floor(10000 * Math.pow(level, 0.85));
    assert.equal(cost(1), 10000);
    assert.equal(cost(13), 88481);
    assert.equal(cost(30), 180116);
  });

  test("fuel multiplier at level 13 is 3.6x", () => {
    const level = 13;
    assert.equal(1 + level * 0.20, 3.6);
  });
});

describe("planPets: korin", () => {
  test("null when no pet named Korin", () => {
    const state = {
      pets: { pets: [{ _id: "p1", name: "Fluffy", pet_type: "combat", level: 5, current_xp: 0, food: 100 }], petSlots: [] },
      commonResources: {}, materials: [], voyager: null, dust: 0,
    };
    const pets = planPets(state);
    assert.equal(pets.korin, null);
  });

  test("full shape with a synthetic Korin pet, materials and voyager", () => {
    const state = {
      pets: {
        pets: [{ _id: "korin1", name: "Korin", pet_type: "generator", level: 13, current_xp: 0, food: 100 }],
        petSlots: [],
      },
      commonResources: {},
      materials: [
        { name: "warp capsule", quantity: 500 },
        { name: "enhanced warp capsule", quantity: 12 },
      ],
      voyager: { max_fuel: 100, max_jumps: 5, current_fuel: 50 },
      dust: 10_000_000,
    };
    const pets = planPets(state);
    const korin = pets.korin;
    assert.ok(korin, "expected korin object");
    assert.equal(korin.level, 13);
    assert.equal(korin.dustCostPerCapsule, 88481);
    assert.equal(korin.capsules, 500);
    assert.equal(korin.enhancedCapsules, 12);
    assert.equal(korin.dust, 10_000_000);
    // affordableNow = min(capsule stock, dust-affordable count)
    assert.equal(korin.affordableNow, Math.min(500, Math.floor(10_000_000 / 88481)));
    assert.equal(korin.fuelMultiplier, 3.6);
    assert.equal(korin.fuelPerEnhanced, Math.round(100 * 3.6)); // 360
    assert.equal(korin.cooldownReductionPct, 13);
    assert.equal(korin.nextLevel.level, 14);
    assert.equal(korin.nextLevel.dustCostPerCapsule, Math.floor(10000 * Math.pow(14, 0.85)));
    assert.equal(korin.nextLevel.fuelMultiplier, 1 + 14 * 0.20);
  });

  test("equipped reflects whether Korin sits in a slot", () => {
    const korinPet = { _id: "k", name: "Korin", pet_type: "generator", level: 5, current_xp: 0, food: 100 };
    const base = { commonResources: {}, materials: [], voyager: null, dust: 0 };
    const out = planPets({ ...base, pets: { pets: [korinPet], petSlots: [] } });
    assert.equal(out.korin.equipped, false);
    const inSlot = planPets({ ...base, pets: { pets: [korinPet], petSlots: [{ _id: "s", pet: "k", pet_type: "generator", autofeed: true, autofeed_limit: 50 }] } });
    assert.equal(inSlot.korin.equipped, true);
  });

  test("fuelPerEnhanced is null without a voyager max_fuel", () => {
    const state = {
      pets: { pets: [{ _id: "k", name: "Korin", pet_type: "generator", level: 5, current_xp: 0, food: 100 }], petSlots: [] },
      commonResources: {}, materials: [], voyager: null, dust: 0,
    };
    const korin = planPets(state).korin;
    assert.equal(korin.fuelPerEnhanced, null);
  });
});

describe("planPets: pet food burn", () => {
  test("counts only auto-fed equipped pets", () => {
    const pet = (id) => ({ _id: id, name: "Owl", pet_type: "booster", level: 7, current_xp: 0, xpboost: 0, food: 100 });
    const state = {
      pets: {
        pets: [pet("a"), pet("b"), pet("c")],
        petSlots: [
          { _id: "s1", pet: "a", pet_type: "booster", autofeed: true, autofeed_limit: 50 },  // 24/11 per day
          { _id: "s2", pet: "b", pet_type: "booster", autofeed: false },                     // floor, no burn
          // "c" is unequipped: no burn
        ],
        petFood: 100,
      },
      commonResources: {},
    };
    const out = planPets(state);
    assert.equal(out.petFoodPerDay, Math.round((24 / 11) * 10) / 10);
    assert.equal(out.petFoodDays, Math.floor(100 / (24 / 11)));
  });
});

describe("planMaterials", () => {
  // Synthetic state: 2 blueprints sharing "bones" (an NPC drop material),
  // one laboratory material, and one uncategorized ("other") material.
  const state = {
    blueprints: [
      {
        name: "Bone Blade", quantity: 3, charges: 2, scraps_use: 10,
        currency_use: [{ normalCurrency: "copper", amount: 100 }],
        material_use: [
          { material: "bones", amount: 5 },
          { material: "metal scrap", amount: 2 },
        ],
      },
      {
        name: "Ghost Trap", quantity: 1, charges: 1, scraps_use: 0,
        currency_use: [],
        material_use: [
          { material: "bones", amount: 1 },
          { material: "widget", amount: 4 },
        ],
      },
    ],
    materials: [
      { name: "bones", quantity: 10 },
      { name: "metal scrap", quantity: 100 },
      { name: "widget", quantity: 1 },
      // In stock but consumed by no blueprint: must still be listed.
      { name: "ingots", quantity: 7000 },
      { name: "pet food", quantity: 1896 },
      // Zero stock and zero need: noise, must not be listed.
      { name: "aerolite", quantity: 0 },
    ],
    commonResources: { copper: 50, gold: 1000 },
    rareCurrencies: { dark_matter: 12.5 },
  };
  const result = planMaterials(state);

  test("gathered resources are listed with the blueprints' currency charge as need", () => {
    const names = result.gathered.map(r => r.material);
    assert.deepEqual([...names].sort(), ["copper", "dark matter", "gold"]);
    const copper = result.gathered.find(r => r.material === "copper");
    // Bone Blade charges 100 copper per craft, 3 copies x 2 charges = 600
    assert.deepEqual([copper.stock, copper.neededAllUses, copper.deficit], [50, 600, 550]);
    const dm = result.gathered.find(r => r.material === "dark matter");
    assert.deepEqual([dm.stock, dm.neededAllUses, dm.deficit], [12.5, 0, 0]);
    assert.equal(copper.source, "gathered");
  });

  test("stocked materials no blueprint uses are still listed", () => {
    const ingots = result.labMaterials.find(m => m.material === "ingots");
    assert.ok(ingots, "expected ingots in labMaterials");
    assert.deepEqual([ingots.stock, ingots.neededAllUses, ingots.deficit], [7000, 0, 0]);
    const food = result.other.find(m => m.material === "pet food");
    assert.ok(food, "expected pet food in other");
    assert.equal(food.stock, 1896);
    assert.ok(!result.other.find(m => m.material === "aerolite"), "zero stock, zero need is left out");
  });

  test("aggregates need weighted by qty*charges across all blueprints", () => {
    const bones = result.npcDrops.find(m => m.material === "bones");
    assert.ok(bones, "expected a bones entry");
    assert.equal(bones.neededPerCraftAll, undefined, "per-craft view was dropped; need is one number");
    // all-uses: 5*3*2 (Bone Blade) + 1*1*1 (Ghost Trap) = 30 + 1 = 31
    assert.equal(bones.neededAllUses, 31);
    assert.equal(bones.stock, 10);
    assert.equal(bones.deficit, 21);
  });

  test("maps bones to the brutes/Belt NPC source", () => {
    const bones = result.npcDrops.find(m => m.material === "bones");
    assert.equal(bones.source, "npc");
    assert.equal(bones.npc, "brutes");
    assert.equal(bones.location, "Belt");
  });

  test("classifies metal scrap as laboratory and widget as other", () => {
    const scrap = result.labMaterials.find(m => m.material === "metal scrap");
    assert.ok(scrap, "expected metal scrap in labMaterials");
    assert.equal(scrap.neededAllUses, 2 * 3 * 2);
    assert.equal(scrap.deficit, 0); // 100 stock >= 12 needed

    const widget = result.other.find(m => m.material === "widget");
    assert.ok(widget, "expected widget in other");
    assert.equal(widget.neededAllUses, 4);
    assert.equal(widget.stock, 1);
    assert.equal(widget.deficit, 3);
  });

  test("totals: scraps, currency, blueprint count, deficit count", () => {
    assert.equal(result.totals.blueprintsIncluded, 2);
    // scraps: 10 * 3 * 2 (Bone Blade) + 0 (Ghost Trap) = 60
    assert.equal(result.totals.scrapsNeededAllUses, 60);
    // currency: 100 * 3 * 2 = 600
    assert.equal(result.totals.currencyNeeded.copper, 600);
    // deficits: bones (21), widget (3) and copper (550); metal scrap and
    // every zero-need NPC material are not in deficit.
    assert.equal(result.totals.deficitCount, 3);
  });

  test("every NPC drop material appears even with zero blueprint usage", () => {
    const names = result.npcDrops.map(m => m.material);
    assert.ok(names.includes("cog"), "expected unused NPC materials to still be listed");
    const cog = result.npcDrops.find(m => m.material === "cog");
    assert.equal(cog.neededAllUses, 0);
    assert.equal(cog.deficit, 0);
  });
});

// The passive bonus each pet grants. These are not goldens off our own
// implementation: every number is the one the game's PetsPage prints for that
// pet, so a change here means the advisor has started disagreeing with the
// game rather than merely changing.
describe("pet effects match the game's own per-pet summary", () => {
  const at = (name, level) => {
    const out = {};
    for (const e of petEffects(name, level)) out[e.key] = e.pct ?? e.mult ?? e.flat ?? "action";
    return out;
  };

  test("the four boosters: activity currency L%, activity XP L*3%", () => {
    // Game: `Credits ${L}% XP: ${L*3}%` and the same shape for the other three.
    assert.deepEqual(at("Dragon", 14), { battling_credits: 14, battling_xp: 42, dungeon_damage_hp: 1.14 });
    assert.deepEqual(at("Dog", 14), { gathering_resources: 14, gathering_xp: 42, dungeon_gathering: 1.14 });
    assert.deepEqual(at("Cat", 14), { craft_min_range: 14, crafting_xp: 42, dungeon_crafting: 1.14 });
    assert.deepEqual(at("Owl", 14), { cosmic_dust: 14, exploring_xp: 42, dungeon_exploring: 1.14 });
  });

  test("a booster's dungeon multiplier is 1 + L/100", () => {
    // DungeonPage: `e *= 1 + pet.level / 100` while the pet is equipped.
    assert.equal(at("Owl", 0).dungeon_exploring, 1);
    assert.equal(at("Owl", 50).dungeon_exploring, 1.5);
    assert.equal(at("Owl", 100).dungeon_exploring, 2);
  });

  test("the QoL pets", () => {
    assert.deepEqual(at("Drone", 20), { drop_chance: 20 });          // Drop Chance +L%
    assert.deepEqual(at("Quadruped", 20), { rarity_chance: 60 });    // Rarity Chance +L*3%
    assert.deepEqual(at("Roller", 20), { squadron_tax: 20 });        // Tax bonus: L%
    assert.deepEqual(at("Humanoid", 20), { salvage: "action" });     // no number, it is an action
  });

  test("the generators", () => {
    assert.deepEqual(at("Darnex", 9), { stat_per_day: 9 });          // Stat per Day: +L
    assert.deepEqual(at("Velari", 9), { pvp_stats: 450 });           // Stats: +L*50
    assert.deepEqual(at("Selyn", 9), { enhance_success: 27 });       // L*3% per attempt
    assert.deepEqual(at("Korin", 9), { capsule_enhance: "action", engine_cooldown: -9 });
  });

  test("a pet the game adds later reports no effects rather than throwing", () => {
    assert.deepEqual(petEffects("Griffin", 10), []);
  });

  test("planPets attaches the effects at each pet's own level", () => {
    const state = {
      pets: {
        pets: [{ _id: "a", name: "Owl", pet_type: "booster", level: 7, current_xp: 0, xpboost: 0, food: 100 }],
        petSlots: [{ _id: "s1", pet: "a", pet_type: "booster", autofeed: false }],
        petFood: 100,
      },
      commonResources: {},
    };
    const owl = planPets(state).pets[0];
    assert.equal(owl.level, 7);
    assert.deepEqual(owl.effects.map(e => e.key), ["cosmic_dust", "exploring_xp", "dungeon_exploring"]);
    assert.equal(owl.effects[0].pct, 7);
    assert.equal(owl.effects[1].pct, 21);
    assert.equal(owl.effects[2].mult, 1.07);
  });
});
