// Locks the crafting-XP math: the level curve (target(1) = 100, each level
// ×1.1) against five live snapshot values, and the Craftron 3000 scrap →
// XP conversion against the client formula. Also gates the new Crafting tab,
// so a rename in the payload cannot leave it silently blank.
"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const CM = require("../public/craft-math.js");
const { planCraft } = require("../lib/craft.js");
const { sandbox } = require("../lib/gui-render.js");
const text = html => html.replace(/<[^>]+>/g, "");

describe("crafting level curve", () => {
  test("golden targets from live snapshots", () => {
    // Levels 65/74/82/85/86 reported by the game itself in five snapshots.
    assert.equal(CM.targetXp(65), 43150);
    assert.equal(CM.targetXp(74), 101742);
    assert.equal(CM.targetXp(82), 218087);
    assert.equal(CM.targetXp(85), 290272);
    assert.equal(CM.targetXp(86), 319299);
  });
  test("level 1 starts at 100 and every level is floor(previous x 1.1)", () => {
    assert.equal(CM.targetXp(1), 100);
    assert.equal(CM.targetXp(2), 110);
    assert.equal(CM.targetXp(3), 121);
  });
  test("xpToReach sums the current level remainder and the levels in between", () => {
    // 319299 - 132140 to finish 86, then 351228 for 87.
    assert.equal(CM.xpToReach(86, 132140, 87), 187159);
    assert.equal(CM.xpToReach(86, 132140, 88), 187159 + CM.targetXp(87));
    assert.equal(CM.xpToReach(86, 132140, 86), 0);
    assert.equal(CM.xpToReach(86, 132140, 80), 0);
  });
  test("applyXp rolls levels and keeps the remainder", () => {
    const one = CM.applyXp(86, 132140, 187159);
    assert.deepEqual(one, { level: 87, currentXp: 0, gained: 1 });
    const spill = CM.applyXp(86, 132140, 187159 + 200000);
    assert.equal(spill.level, 87);
    assert.equal(spill.currentXp, 200000);
    assert.equal(spill.gained, 1);
  });
});

describe("Craftron 3000 conversion", () => {
  test("live 2026-09-16 account: level 86, module boost 156, nothing else", () => {
    const b = CM.craftronBonus({ craftingLevel: 86, moduleBoost: 156 });
    assert.equal(b.total, 92.71);
    assert.equal(b.additive, 86);
    assert.equal(CM.scrapToXp(76846, b.total), Math.floor(76846 * 1.9271));
  });
  test("every bonus stacks the way the client does (Forge is 3% per LEVEL)", () => {
    const b = CM.craftronBonus({
      craftingLevel: 86, catPetLevel: 10, globalXpBoost: 50, pvpBoost: 20,
      catalystCraftingXp: 15, techBaseXpBoost: 20, premium: true,
      moduleBoost: 200, gasGiant: true, forgeLevel: 100, dungeonBonus: 25,
    });
    // (86+30+50+20+15) x1.2 x1.1 x1.1 x1.1 x4.0 x1.25 = 1605.186
    assert.equal(b.total, 1605.19);
    assert.equal(b.parts.forgeBonus, 300);
  });
  test("the live 2026-09-16 dialog: total 646.67 xp bonus", () => {
    const b = CM.craftronBonus({
      craftingLevel: 86, catPetLevel: 13, globalXpBoost: 25, catalystCraftingXp: 63.1,
      techBaseXpBoost: 57, premium: true, moduleBoost: 156, forgeLevel: 21,
    });
    assert.equal(b.total, 646.67);
    // The panel's own preview: 76,846 scraps -> 573,786 crafting XP.
    assert.equal(CM.scrapToXp(76846, b.total), 573786);
  });
  test("global XP event bonus is 5 x the remaining-time tier", () => {
    assert.equal(CM.globalBoostBonus(3 * 3600).bonus, 5);      // 3h  -> tier 1
    assert.equal(CM.globalBoostBonus(8 * 3600).bonus, 10);     // 8h  -> tier 2
    assert.equal(CM.globalBoostBonus(20 * 3600).bonus, 15);    // 20h -> tier 3
    assert.equal(CM.globalBoostBonus(30 * 3600).bonus, 20);    // 30h -> tier 4
    assert.equal(CM.globalBoostBonus(100 * 3600).bonus, 25);   // 4d+ -> tier 5
    assert.equal(CM.globalBoostBonus(0).bonus, 0);
    assert.equal(CM.globalBoostBonus(-5).bonus, 0);
  });
  test("squadron crafting dungeon bonus steps 5/4/3/2 per run cleared", () => {
    assert.equal(CM.dungeonBoostBonus(0), 0);
    assert.equal(CM.dungeonBoostBonus(5), 25);
    assert.equal(CM.dungeonBoostBonus(10), 45);
    assert.equal(CM.dungeonBoostBonus(20), 75);
    assert.equal(CM.dungeonBoostBonus(25), 85);
  });
  test("level 215+ scales the whole bonus by 1.09 per level", () => {
    const b = CM.craftronBonus({ craftingLevel: 216 });
    assert.equal(b.highLevelFactor, 1.09);
    assert.equal(b.total, Number((216 * 1.09).toFixed(2)));
  });
  test("scrapping a blueprint returns (50 + scraps) x rarity x charges", () => {
    assert.equal(CM.scrapFromBlueprint(50, "normal", 1), 150);
    assert.equal(CM.scrapFromBlueprint(400, "legendary", 3), Math.floor(450 * 5 * 3));
  });
});

describe("planCraft adapter", () => {
  const state = () => ({
    craft: { crafting_level: 86, crafting_current_xp: 132140, crafting_target_xp: 319299 },
    player: { skills: { base_module_efficiency_boost: 100, crafting_base_xp_boost: 0 } },
    base: { name: "Fluffystan", stellarium: 19, nextStellariumTick: 0, bodyType: "icy", stellariumHourly: 5,
      modules: [
        { name: "Metal scrap generator", type: "passive", unlocked: true, level: 78, tier: 0, active: true, selection: ["metal scrap"] },
        { name: "Craftron 3000", type: "active", unlocked: true, level: 78, tier: 0, active: true, selection: [] },
      ] },
    materials: [{ name: "metal scrap", quantity: 76846 }],
    pets: { pets: [], petSlots: [], premiumActive: false, petFood: 0 },
  });

  test("prefills level, stock, rate and module boost from state", () => {
    const c = planCraft(state(), { craftingTotals: [], pets: { pets: [] } });
    assert.equal(c.level, 86);
    assert.equal(c.nextLevelXp, 319299);
    assert.equal(c.craftronUnlocked, true);
    assert.equal(c.moduleBoost, 156);
    assert.equal(c.scrapStock, 76846);
    assert.equal(c.scrapPerHour, 3840);
    assert.equal(c.gasGiant, false);
    assert.equal(c.bonus.total, 92.71);
  });

  test("global XP event and squadron Forge/dungeon are auto-filled", () => {
    const s = state();
    s.stateReadAt = 1000000;
    s.globalBoosts = { XP: 1000000 + 3600 * 100 }; // ~4 days left -> tier 5 -> +25%
    s.squadron = { forgeLevel: 21, craftingHighest: 0 };
    const c = planCraft(s, { craftingTotals: [], pets: { pets: [] } });
    assert.equal(c.globalXpBoost, 25);
    assert.equal(c.forgeLevel, 21);
    assert.equal(c.craftingHighest, 0);
    assert.equal(c.dungeonBonus, 0);
    // additive 86 + 25 = 111, x1.078 module, x1.63 forge.
    assert.equal(c.bonus.total, Number((111 * 1.078 * 1.63).toFixed(2)));
    assert.deepEqual(c.defaults, { forgeLevel: 21, dungeonBonus: 0, pvpBoost: 0, globalXpBoost: 25 });
  });

  test("a gas-giant base and a crafting_xp catalyst feed the bonus", () => {
    const s = state();
    s.base.bodyType = "gas";
    const c = planCraft(s, { craftingTotals: [{ stat: "crafting_xp", total: 5 }], pets: { pets: [] } });
    assert.equal(c.gasGiant, true);
    assert.equal(c.catalystCraftingXp, 5);
    // (86 + 5) x 1.078 x 1.1
    assert.equal(c.bonus.total, Number(((86 + 5) * 1.078 * 1.1).toFixed(2)));
  });
});

describe("crafting tab renders", () => {
  const snapshot = () => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "units-tech-state.json"), "utf8"));
  const withCraft = () => {
    const d = snapshot();
    d.craft = require("../lib/craft.js").planCraft({
      craft: { crafting_level: 86, crafting_current_xp: 132140, crafting_target_xp: 319299 },
      player: { skills: { base_module_efficiency_boost: 100 } },
      base: { name: "F", stellarium: 0, nextStellariumTick: 0, bodyType: "gas", stellariumHourly: 5,
        modules: [{ name: "Craftron 3000", type: "active", unlocked: true, level: 78, tier: 0, active: true, selection: [] }] },
      materials: [{ name: "metal scrap", quantity: 76846 }],
      pets: { pets: [{ _id: "c1", name: "Cat", level: 5 }], petSlots: [{ pet: "c1", pet_type: "cat" }], premiumActive: true },
    }, { craftingTotals: [], pets: { pets: [{ _id: "c1", name: "Cat", level: 5, equipped: true }] } });
    return d;
  };

  test("shows the live level, the required XP and the conversion result", () => {
    const out = text(sandbox(withCraft()).render("craft"));
    assert.match(out, /Required crafting XP/);
    assert.match(out, /Craftron 3000: metal scraps to crafting XP/);
    assert.match(out, /Bonus breakdown/);
    // 186 XP needed to finish level 86 (319299 - 132140), then level 87 costs 351228.
    assert.match(out, /187\.2k|187,159/);
  });

  test("a stored target and scrap amount drive the output", () => {
    const storage = { "advisor-craft": JSON.stringify({ target: 88, scraps: 100000, hours: 0, forgeLevel: 0, dungeonBonus: 0, pvpBoost: 0, globalXpBoost: 0 }) };
    const out = text(sandbox(withCraft(), { storage }).render("craft"));
    assert.match(out, /XP gained/);
    // 100k scraps x 2.3174 = 231,740 XP -> past the 187,159 left in level 86.
    assert.match(out, /After conversion: level 87/);
  });

  test("an old snapshot without craft data says so instead of throwing", () => {
    const out = text(sandbox(snapshot()).render("craft"));
    assert.match(out, /No crafting data/);
  });
});
