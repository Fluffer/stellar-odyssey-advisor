// Behavior locks for the materials advisor (lib/materials.js) and the Korin
// warp-capsule enhancement math (lib/pets.js), ported from the game's JS
// bundle. Goldens were produced by running the CURRENT implementation and
// hardcoding its output.
"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { planMaterials } = require("../lib/materials.js");
const { planPets } = require("../lib/pets.js");

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

  test("fuelPerEnhanced is null without a voyager max_fuel", () => {
    const state = {
      pets: { pets: [{ _id: "k", name: "Korin", pet_type: "generator", level: 5, current_xp: 0, food: 100 }], petSlots: [] },
      commonResources: {}, materials: [], voyager: null, dust: 0,
    };
    const korin = planPets(state).korin;
    assert.equal(korin.fuelPerEnhanced, null);
  });
});

describe("planMaterials", () => {
  // Synthetic state: 2 blueprints sharing "bones" (an NPC drop material),
  // one laboratory material, and one uncategorized ("other") material.
  const state = {
    blueprints: [
      {
        name: "Bone Blade", quantity: 3, charges: 2, scraps_use: 10,
        currency_use: [{ normalCurrency: "credits", amount: 100 }],
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
    ],
  };
  const result = planMaterials(state);

  test("aggregates per-craft (unweighted) and all-uses (weighted by qty*charges) needs", () => {
    const bones = result.npcDrops.find(m => m.material === "bones");
    assert.ok(bones, "expected a bones entry");
    // per-craft: 5 (Bone Blade) + 1 (Ghost Trap) = 6, one craft each
    assert.equal(bones.neededPerCraftAll, 6);
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
    assert.equal(result.totals.currencyNeeded.credits, 600);
    // deficits: bones (21) and widget (3); metal scrap and every
    // zero-need NPC material are not in deficit.
    assert.equal(result.totals.deficitCount, 2);
  });

  test("every NPC drop material appears even with zero blueprint usage", () => {
    const names = result.npcDrops.map(m => m.material);
    assert.ok(names.includes("cog"), "expected unused NPC materials to still be listed");
    const cog = result.npcDrops.find(m => m.material === "cog");
    assert.equal(cog.neededAllUses, 0);
    assert.equal(cog.deficit, 0);
  });
});
