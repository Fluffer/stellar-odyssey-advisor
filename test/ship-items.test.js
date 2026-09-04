// Behavior locks for the ship item (weapon/shield/engine/sensors/laser/probes)
// enhancement advisor (lib/ship-items.js). Goldens for the cooldown/value
// formulas were produced by running the CURRENT implementation and
// hardcoding its output, then hand-checked against the extracted formulas.
"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const {
  planShipItems, valueMaxForLevel, cooldownFloorBreakpoint, cooldownAt,
} = require("../lib/ship-items.js");

describe("cooldownFloorBreakpoint / cooldownAt", () => {
  test("breakpoint at 10 ly is ~54.55", () => {
    // golden: 100 * (1 - 300000/(600000*1.1)) = 100 * (1 - 300000/660000)
    assert.equal(Math.round(cooldownFloorBreakpoint(10) * 100) / 100, 54.55);
  });

  test("cooldown at d=32.76, 10 ly (real-account engine/Korin combo)", () => {
    // golden: floor(660000 * (1 - 0.3276)) = floor(660000 * 0.6724) = 443784 ms
    const c = cooldownAt(32.76, 10);
    assert.equal(c.seconds, 443.784);
    assert.equal(c.floored, false);
  });

  test("cooldown floors at the hard 5-minute minimum once d clears the breakpoint", () => {
    // golden: at d=60, 10 ly: floor(660000 * 0.4) = 264000 < 300000 -> floored to 300000 ms
    const c = cooldownAt(60, 10);
    assert.equal(c.seconds, 300);
    assert.equal(c.floored, true);
  });

  test("never goes below the 5-minute floor even at very high d or short distance", () => {
    assert.equal(cooldownAt(100, 0).seconds, 300);
    assert.equal(cooldownAt(99.9, 100).seconds, 300);
  });
});

describe("valueMaxForLevel", () => {
  test("golden values matching real-account crafting level 56 items", () => {
    // golden: 10 * (1.3 + 0.56) * rarityMult * level
    assert.equal(valueMaxForLevel(56, "legendary", 90), 3348); // weapon/shield
    assert.equal(valueMaxForLevel(56, "legendary", 62), 2306); // engine (and sensors if recrafted)
    assert.equal(valueMaxForLevel(56, "legendary", 60), 2232); // sensors, current level
    assert.equal(valueMaxForLevel(56, "legendary", 86), 3199); // laser/probes
  });

  test("rarity multiplier scales linearly", () => {
    const normal = valueMaxForLevel(0, "normal", 100);
    const legendary = valueMaxForLevel(0, "legendary", 100);
    assert.equal(legendary, normal * 2); // legendary mult 2 vs normal mult 1
  });
});

// Minimal synthetic ship state builder - only the fields planShipItems reads.
function makeState(overrides) {
  const base = {
    craft: { crafting_level: 50 },
    skillLevels: { battling: 50, gathering: 50, exploring: 50 },
    ship: {
      weapon_slot: { name: "W", level: 50, rarity: "rare", value: 100, bonuses: ["kinetic"], enhanced: false, anomaly: false, crafted: true },
      shield_slot: { name: "S", level: 50, rarity: "rare", value: 100, bonuses: [], enhanced: false, anomaly: false, crafted: true },
      engine_slot: { name: "E", level: 50, rarity: "rare", value: 100, bonuses: [], enhanced: false, anomaly: false, crafted: true },
      sensors_slot: { name: "Se", level: 50, rarity: "rare", value: 100, bonuses: [], enhanced: false, anomaly: false, crafted: true },
      laser_slot: { name: "L", level: 50, rarity: "rare", value: 100, bonuses: [], enhanced: false, anomaly: false, crafted: true },
      probes_slot: { name: "P", level: 50, rarity: "rare", value: 100, bonuses: [], enhanced: false, anomaly: false, crafted: true },
    },
    droids: [{ maneuverability: 20 }],
    pets: { pets: [], petSlots: [] },
  };
  return Object.assign({}, base, overrides);
}

describe("planShipItems: levels-behind recommendation", () => {
  test("flags an item >= 5 levels behind its matching skill", () => {
    const state = makeState({
      skillLevels: { battling: 55, gathering: 50, exploring: 50 },
    });
    state.ship.weapon_slot.level = 50; // battling is 55 -> 5 behind
    const si = planShipItems(state);
    const weapon = si.items.find(i => i.slot === "weapon_slot");
    assert.equal(weapon.levelsBehind, 5);
    assert.ok(weapon.recommendations.some(r => r.includes("levels behind battling")));
    assert.ok(weapon.recommendations.some(r => r.includes("recrafting now would cap value at")));
  });

  test("does not flag an item under the 5-level threshold", () => {
    const state = makeState({ skillLevels: { battling: 54, gathering: 50, exploring: 50 } });
    const si = planShipItems(state);
    const weapon = si.items.find(i => i.slot === "weapon_slot");
    assert.equal(weapon.levelsBehind, 4);
    assert.ok(!weapon.recommendations.some(r => r.includes("levels behind")));
  });
});

describe("planShipItems: cooldown-mod recommendation flips at the floor", () => {
  test("recommends adding a cooldown mod when not yet past the 10 ly floor", () => {
    const state = makeState();
    state.ship.engine_slot.value = 1000; // d = 10, well under the ~54.55 breakpoint
    const si = planShipItems(state);
    assert.equal(si.cooldown.withCooldownModAt10ly, true);
    const engine = si.items.find(i => i.slot === "engine_slot");
    assert.ok(engine.recommendations.some(r => r.includes("adding one would still help")));
  });

  test("recommends Scan reward boost instead once past the 10 ly floor", () => {
    const state = makeState();
    state.ship.engine_slot.value = 6000; // d = 60 >= breakpoint 54.55
    const si = planShipItems(state);
    assert.equal(si.cooldown.withCooldownModAt10ly, false);
    const engine = si.items.find(i => i.slot === "engine_slot");
    const sensors = si.items.find(i => i.slot === "sensors_slot");
    assert.ok(engine.recommendations.some(r => r.includes("prefer 'Scan reward boost'")));
    assert.ok(sensors.recommendations.some(r => r.includes("prefer 'Scan reward boost'")));
  });

  test("no cooldown recommendation once a cooldown mod is already present anywhere", () => {
    const state = makeState();
    state.ship.engine_slot.value = 1000;
    state.ship.sensors_slot.bonuses = ["Engine cooldown reduction"];
    const si = planShipItems(state);
    const engine = si.items.find(i => i.slot === "engine_slot");
    assert.ok(!engine.recommendations.some(r => r.includes("cooldown")));
  });
});

describe("planShipItems: droid-dodge mod vs the 100% dodge cap (exact)", () => {
  test("at maneuverability 90 with two dual mods only the first scheduled item is told to recraft", () => {
    const state = makeState({ droids: [{ maneuverability: 90 }] });
    state.ship.laser_slot.bonuses = ["Rare Resource drop chance", "Droids dodge chance"];
    state.ship.probes_slot.bonuses = ["Rare Resource drop chance", "Droids dodge chance"];
    const si = planShipItems(state);
    const laser = si.items.find(i => i.slot === "laser_slot");
    const probes = si.items.find(i => i.slot === "probes_slot");
    assert.ok(laser.recommendations.some(r => r.includes("adds nothing") && r.includes("recraft")));
    assert.ok(!probes.recommendations.some(r => r.includes("adds nothing")), "probes mod still needed until maneuverability 100");
    assert.ok(probes.recommendations.some(r => r.includes("still needed") && r.includes("At 100% maneuverability")), "probes gets the threshold note");
  });

  test("flags the mod as adding nothing once every droid is at 100% dodge without it", () => {
    // 50 + 100/2 = 100 already -> the +10 single mod cannot land at all
    const state = makeState({ droids: [{ maneuverability: 100 }, { maneuverability: 100 }] });
    state.ship.laser_slot.bonuses = ["Droids dodge chance"];
    const si = planShipItems(state);
    const laser = si.items.find(i => i.slot === "laser_slot");
    assert.ok(laser.recommendations.some(r => r.includes("Droids dodge chance") && r.includes("adds nothing")));
    assert.equal(si.droidDodge.avgDodge, 100);
  });

  test("flags a partially wasted mod when the cap clips it", () => {
    // 50 + 85/2 = 92.5 without the mod; with +10 -> 100 (capped): only 7.5 of 10 lands
    const state = makeState({ droids: [{ maneuverability: 85 }] });
    state.ship.laser_slot.bonuses = ["Droids dodge chance"];
    const si = planShipItems(state);
    const laser = si.items.find(i => i.slot === "laser_slot");
    assert.ok(laser.recommendations.some(r => r.includes("Droids dodge chance") && r.includes("7.5")));
  });

  test("while the whole mod still lands: no waste flag, only the threshold note", () => {
    const state = makeState({ droids: [{ maneuverability: 33 }] });
    state.ship.laser_slot.bonuses = ["Droids dodge chance"];
    const si = planShipItems(state);
    const laser = si.items.find(i => i.slot === "laser_slot");
    assert.ok(!laser.recommendations.some(r => r.includes("adds nothing") || r.includes("lands")));
    assert.ok(laser.recommendations.some(r => r.includes("still needed") && r.includes("At 100% maneuverability")));
    assert.equal(si.droidDodge.avgDodge, 76.5);
    assert.equal(si.droidDodge.modBonus, 10);
  });

  test("does not flag an item without the dodge mod even at capped maneuverability", () => {
    const state = makeState({ droids: [{ maneuverability: 100 }] });
    state.ship.laser_slot.bonuses = ["Rare Resource drop chance"];
    const si = planShipItems(state);
    const laser = si.items.find(i => i.slot === "laser_slot");
    assert.ok(!laser.recommendations.some(r => r.includes("Droids dodge chance")));
  });
});

describe("planShipItems: weapon/shield weakness coverage", () => {
  test("reports covered and uncovered NPC families for a single damage mod", () => {
    const state = makeState();
    state.ship.weapon_slot.bonuses = ["kinetic"]; // brutes, miners, scorchers (kinetic-weak)
    const si = planShipItems(state);
    const weapon = si.items.find(i => i.slot === "weapon_slot");
    const coverageLine = weapon.recommendations.find(r => r.startsWith("Damage mods"));
    assert.ok(coverageLine.includes("brutes"));
    assert.ok(coverageLine.includes("uncovered"));
    assert.ok(coverageLine.includes("spectres")); // spectres are energy/electromagnetic-weak, not kinetic
  });
});

describe("planShipItems: Korin and anomaly", () => {
  test("equipped Korin level contributes to the cooldown score d", () => {
    const state = makeState({
      pets: {
        pets: [{ _id: "korin1", name: "Korin", pet_type: "generator", level: 13 }],
        petSlots: [{ pet: "korin1" }],
      },
    });
    state.ship.engine_slot.value = 1976;
    const si = planShipItems(state);
    // d = 1976/100 + 0 mods + 13 korin = 32.76
    assert.equal(si.cooldown.d, 32.76);
    assert.equal(si.cooldown.componentBreakdown.korin, 13);
  });

  test("an unequipped Korin does not contribute to d", () => {
    const state = makeState({
      pets: {
        pets: [{ _id: "korin1", name: "Korin", pet_type: "generator", level: 13 }],
        petSlots: [], // not in any slot -> not equipped
      },
    });
    state.ship.engine_slot.value = 1976;
    const si = planShipItems(state);
    assert.equal(si.cooldown.componentBreakdown.korin, 0);
    assert.equal(si.cooldown.d, 19.76);
  });

  test("anomaly items note the 500k dust reroll", () => {
    const state = makeState();
    state.ship.laser_slot.anomaly = true;
    const si = planShipItems(state);
    const laser = si.items.find(i => i.slot === "laser_slot");
    assert.ok(laser.recommendations.some(r => r.includes("500,000 cosmic dust")));
  });
});

describe("planShipItems: scan reward multiplier", () => {
  test("real-account combo: sensors 2172, both engine+sensors single Scan reward boost mod", () => {
    const state = makeState();
    state.ship.sensors_slot.value = 2172;
    state.ship.engine_slot.bonuses = ["Scan reward boost"];
    state.ship.sensors_slot.bonuses = ["Scan reward boost"];
    const si = planShipItems(state);
    // multiplier = 1 + 2172/10000 + 20/100 = 1.4172
    assert.equal(si.scan.multiplier, 1.4172);
  });
});

describe("planShipItems: global Cooldown boost", () => {
  test("tier-5 boost adds +25 and floors the cooldown; mod advice defers to base d", () => {
    const state = makeState();
    state.ship.engine_slot.value = 1976;               // 19.76
    state.stateReadAt = 1000000;
    state.globalBoosts = { Cooldown: 1000000 + 3 * 24 * 3600 }; // >48h left => tier 5
    const si = planShipItems(state);
    assert.equal(si.cooldown.componentBreakdown.globalBoost, 25);
    assert.equal(si.cooldown.componentBreakdown.globalBoostTier, 5);
    assert.ok(si.cooldown.d > si.cooldown.dBase);
    // dBase under breakpoint => a mod still pays off long-term
    assert.equal(si.cooldown.withCooldownModAt10ly, si.cooldown.dBase < si.cooldown.breakpointD10ly);
  });

  test("expired boost contributes nothing", () => {
    const state = makeState();
    state.stateReadAt = 1000000;
    state.globalBoosts = { Cooldown: 999999 };
    const si = planShipItems(state);
    assert.equal(si.cooldown.componentBreakdown.globalBoost, 0);
    assert.equal(si.cooldown.d, si.cooldown.dBase);
  });

  test("tier scales with remaining time (5h left => tier 1 => +5)", () => {
    const state = makeState();
    state.stateReadAt = 1000000;
    state.globalBoosts = { Cooldown: 1000000 + 5 * 3600 };
    const si = planShipItems(state);
    assert.equal(si.cooldown.componentBreakdown.globalBoost, 5);
    assert.equal(si.cooldown.componentBreakdown.globalBoostTier, 1);
  });
});
