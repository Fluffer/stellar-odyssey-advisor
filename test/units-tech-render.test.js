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
});
