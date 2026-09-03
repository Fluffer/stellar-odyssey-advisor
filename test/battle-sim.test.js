// Behavior locks for advisor-battle.js — the port of the game's
// simulateBattle. simulateBattle accepts an injectable opts.rng so its
// outcome is fully deterministic for a given seed; winrate() always uses
// Math.random internally (it spreads {...opts, rng: Math.random}), so it
// is tested only statistically, at trivial/absurd levels.
"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const battle = require("../advisor-battle.js");

// Simple deterministic PRNG (mulberry32) seeded per call so two runs with
// the same seed produce identical rng sequences.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const player = {
  stats: { power: 100, precision: 50, evasion: 50, hull: 200 },
  skills: {},
  ship: {
    weapon_slot: { value: 1000, bonuses: ["kinetic"] },
    shield_slot: { value: 1000, bonuses: [] },
  },
  clones: [
    { name: "clone1", critical_chance: 10, critical_damage: 20, dual_shot: 0 },
    { name: "clone2", critical_chance: 10, critical_damage: 20, dual_shot: 0 },
  ],
};
const npc = { name: "brutes", weakness: ["kinetic", "explosive"] };

describe("simulateBattle", () => {
  test("same seed produces the same outcome", () => {
    const r1 = battle.simulateBattle(player, { npc, level: 5, rng: mulberry32(42) });
    const r2 = battle.simulateBattle(player, { npc, level: 5, rng: mulberry32(42) });
    assert.equal(r1, r2);
    // golden: locks current formula/outcome for this fixture at seed 42
    assert.equal(r1, "player");
  });

  test("low level favors the player, absurdly high level favors the mob", () => {
    const low = battle.simulateBattle(player, { npc, level: 1, rng: mulberry32(1) });
    const high = battle.simulateBattle(player, { npc, level: 100000, rng: mulberry32(1) });
    assert.equal(low, "player");
    assert.equal(high, "mob");
  });
});

describe("winrate", () => {
  test("trivial level -> ~100% winrate, absurd level -> ~0% winrate", () => {
    // winrate() ignores the injected rng and always uses Math.random, so
    // this is a statistical check, not a determinism check. runs=50 keeps
    // it fast; the gap between trivial and absurd levels is large enough
    // that flakiness is not a practical concern.
    const trivial = battle.winrate(player, { npc, level: 1 }, 50);
    const absurd = battle.winrate(player, { npc, level: 100000 }, 50);
    assert.equal(trivial, 100);
    assert.equal(absurd, 0);
  });
});
