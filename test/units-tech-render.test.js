// Gates on the Droids & Clones and Technology tabs: advice must match the
// state it is rendered from (past break-even -> buy, not "keep upgrading";
// all combat skills maxed -> no empty "optimal spend" section).
"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { sandbox } = require("../lib/gui-render.js");

// Frozen slice (player, units, tech, base.phase) of a 2026-09-13 analysis.
const snapshot = () => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "units-tech-state.json"), "utf8"));
const text = html => html.replace(/<[^>]+>/g, "");

describe("units tab recommendation gates", () => {
  test("below break-even: keep upgrading, skill order follows damage per credit", () => {
    const d = snapshot();
    const out = text(sandbox(d).render("units"));
    assert.match(out, /keep upgrading/);
    assert.match(out, /upgrade until 40\.8%/);
    // dual shot has the highest marginal damage per credit in the snapshot
    assert.match(out, /Raise dual shot first/);
  });

  test("at or past break-even the advice flips to buying the next unit", () => {
    const d = snapshot();
    d.units.droids.breakEvenLevel = 0.1;
    d.units.clones.damageBreakEvenLevel = d.units.clones.rows[0].level;
    d.units.clones.damage.perPctBuyCost = d.units.clones.damage.perPctUpgradeCost / 2;
    const out = text(sandbox(d).render("units"));
    assert.doesNotMatch(out, /keep upgrading/);
    assert.doesNotMatch(out, /upgrade until/);
    assert.match(out, /Droids:.*past break-even/);
    assert.match(out, /8th clone \(100\.00B\) now gives more damage per credit/);
    assert.match(out, /buying is 2\.0x more efficient/);
  });

  test("recommendation rows are numbered consecutively when some are skipped", () => {
    const d = snapshot();
    d.units.clones.nextPrice = null;
    const html = sandbox(d).render("units");
    const nums = [...html.matchAll(/<span class="num">(\d+)<\/span><span><b>(Droids|Droid skill order)/g)].map(m => Number(m[1]));
    assert.deepEqual(nums, [1, 2]);
  });
});

describe("tech tab optimal-spend gates", () => {
  test("all four combat skills maxed: says so instead of an empty section", () => {
    const d = snapshot();
    d.tech.battle.rows = [];
    d.tech.allocation = [];
    const out = text(sandbox(d).render("tech"));
    assert.match(out, /All four combat skills are at the 100 cap/);
    assert.doesNotMatch(out, /Not enough cores/);
  });

  test("no battle simulation: says why instead of an empty section", () => {
    const d = snapshot();
    d.tech.battle = null;
    d.tech.allocation = [];
    const out = text(sandbox(d).render("tech"));
    assert.match(out, /No combat ranking/);
  });

  test("shows QC assigned and the total needed to max the unlocked skills", () => {
    const d = snapshot();
    const out = text(sandbox(d).render("tech"));
    assert.match(out, /QC assigned72\.4k/);
    assert.match(out, /QC max needed151\.5k/);
    assert.match(out, /4\/15 maxed/);
  });
});
describe("base tab Quantum server emulator", () => {
  const { planBaseFromState } = require("../lib/base.js");
  // A founded base with the server at level 69 / tier 0 and the efficiency
  // skill at 75 (the 2026-09-13 state), laid over the frozen tech slice so
  // the emulator can read the core pile and battling drops from it.
  const founded = () => {
    const d = snapshot();
    const s = {
      lab: { buildings: [], queue: [], queueSlots: 10 }, baseLab: { buildings: [] },
      account: { registered: 1786174949, lifetimeCredits: 5.4e9 },
      currentSystem: { name: "Torvornir", star: "A type", bodies: [] }, bookmarks: [],
      gameVersion: "1.2.0", clientBundle: "index-CfS9fhKw.js",
      commonResources: {}, rareCurrencies: {},
      materials: [{ name: "microcircuits", quantity: 12000 }],
      ship: {}, player: { skills: { base_module_efficiency_boost: 75 } },
      base: { _id: "b1", name: "Fluffystan", stellarium: 40, nextStellariumTick: 1789270723, bodyType: "icy", stellariumHourly: 5,
        modules: [
          { _id: "m1", name: "Stellarium miner", type: "passive", unlocked: true, level: 166, tier: 0, active: true },
          { _id: "m3", name: "Quantum server", type: "passive", unlocked: true, level: 69, tier: 0, active: true },
        ] },
    };
    d.base = planBaseFromState(s, { now: 1786174949 + 35 * 86400 });
    d.tech.quantumCores = 3000;
    d.tech.maxOut.income = { battlingLevel: 60, battlingPerHour: 18, quantumServer: null, ratePerHour: 22.6 };
    return d;
  };

  test("no scenario: live output, no costs, and the breakpoint table from the live boost", () => {
    const out = text(sandbox(founded()).render("base"));
    assert.match(out, /Quantum server emulator/);
    assert.match(out, /Cores \/ h from the server4\.604 sure \+ 60\.4% one more/);
    assert.match(out, /with battling drops: 22\.60 \/ h/);
    assert.match(out, /Levels \(microcircuits\)no changes yet/);
    // Next sure core from boost 60.4: level 115 alone, tier 66 alone, efficiency cannot.
    assert.match(out, /level 115 \(\+46\).*4,255 microcircuits/);
    assert.match(out, /tier 66 \(\+66\).*2,211 stellarium/);
    assert.match(out, /beyond the 100 cap/);
  });

  test("a stored scenario: output now -> scenario, each lever's cost against the pile, payback", () => {
    const storage = { "advisor-base-qc-emu": JSON.stringify({ level: 200, tier: 10, efficiency: 100 }) };
    const out = text(sandbox(founded(), { storage }).render("base"));
    assert.match(out, /4\.60.*6\.20/);
    assert.match(out, /6 sure \+ 20\.0% one more.*boost 220\.0%/);
    assert.match(out, /with battling drops: 22\.60.*24\.20 \/ h/);
    assert.match(out, /Levels \(microcircuits\)17,685\+131 lvl.*12,000 in stock/);
    assert.match(out, /Tiers \(stellarium\)55\+10 tier.*40 held/);
    assert.match(out, /Efficiency \(cores\)4,400\+25 lvl.*3,000 held.*repay it in 114\.9 d/);
    // The steps start from the scenario, and efficiency is maxed so that lever is gone.
    assert.match(out, /7300%level 273 \(\+73\)/);
  });

  test("a stored scenario the game has passed is lifted to the live values", () => {
    const storage = { "advisor-base-qc-emu": JSON.stringify({ level: 10, tier: 0, efficiency: 5 }) };
    const out = text(sandbox(founded(), { storage }).render("base"));
    assert.match(out, /Levels \(microcircuits\)no changes yet/);
    assert.match(out, /Efficiency \(cores\)no changes yet/);
  });

  test("before the server is unlocked the emulation says so and starts at level 0", () => {
    const d = founded();
    const qs = d.base.input.modules.find(m => m.name === "Quantum server");
    qs.unlocked = false; qs.active = false; qs.level = 0;
    const out = text(sandbox(d).render("base"));
    assert.match(out, /Quantum server is not unlocked yet/);
    // Level 0 still pays the base 1 plus the flat 3 the game adds to every tick.
    assert.match(out, /Cores \/ h from the server4\.004 sure \+ 0\.0% one more/);
  });
});

describe("base tab targets follow the Quantum server emulator", () => {
  const { planBaseFromState } = require("../lib/base.js");
  const state = () => ({
    lab: { buildings: [], queue: [], queueSlots: 10 }, baseLab: { buildings: [] },
    account: { registered: 1786174949, lifetimeCredits: 5.4e9 },
    currentSystem: { name: "Torvornir", star: "A type", bodies: [] }, bookmarks: [],
    gameVersion: "1.2.0", clientBundle: "index-CfS9fhKw.js",
    commonResources: {}, rareCurrencies: {}, materials: [],
    ship: {}, player: { skills: { base_module_efficiency_boost: 81 } },
    base: { _id: "b1", name: "Fluffystan", stellarium: 0, nextStellariumTick: 1789270723, bodyType: "icy", stellariumHourly: 5,
      modules: [
        { _id: "m1", name: "Stellarium miner", type: "passive", unlocked: true, level: 188, tier: 0, active: true },
        { _id: "m3", name: "Quantum server", type: "passive", unlocked: true, level: 101, tier: 0, active: true },
      ] },
  });
  const page = storage => {
    const d = snapshot();
    d.base = planBaseFromState(state(), { now: 1786174949 + 35 * 86400 });
    return text(sandbox(d, { storage }).render("base"));
  };

  test("the emulated efficiency and tier change boost and output at target, not the live upkeep", () => {
    const live = page();
    // Quantum server target defaults to its level 101: boost 101/2 x 1.81 = 91.4%.
    assert.match(live, /Quantum server unlockedpassive-microcircuits from 1010 of each91%4\.91/);
    assert.doesNotMatch(live, /follow the emulator below/);
    const emu = page({ "advisor-base-qc-emu": JSON.stringify({ level: 101, tier: 10, efficiency: 100 }) });
    assert.match(emu, /follow the emulator below: module efficiency skill 100% \(live 81%\), Quantum server tier 10 \(live 0\)/);
    // 101/2 x 1.1 x 2 = 111.1% -> 5 sure + 11.1%: 5.11 expected.
    assert.match(emu, /Quantum server unlockedpassive-microcircuits from 1010 of each111%5\.11/);
    // The miner's target boost rises with the skill too: 188 x 2 = 376%.
    assert.match(emu, /Stellarium miner unlockedpassive-microcircuits, fusion cells from 1880 of each376%/);
    // "Upkeep / day now" is the live bill in both renders.
    const nowBill = s => (s.match(/Upkeep \/ day now([\d.]+[kMB]?)/) || [])[1];
    assert.ok(nowBill(live), "live bill present");
    assert.equal(nowBill(emu), nowBill(live));
  });
});
