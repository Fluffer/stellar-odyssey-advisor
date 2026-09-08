// Behavior locks for planInstalls (the greedy catalyst install/replace
// planner) in advisor-core.js. No opts.validateDefault is passed in any of
// these fixtures, so the battle simulator is never invoked here — purely
// the greedy stat-value logic. Goldens were produced by running the CURRENT
// implementation against synthetic ships/pools and hardcoding the result.
"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../advisor-core.js");

function cat(id, stat, rarity, range, opts) {
  return Object.assign({ _id: id, stat, rarity, range }, opts || {});
}

describe("planInstalls", () => {
  test("fills up to 4 per group, caps same-stat at 2, halves the 2nd same-stat, and respects stat caps", () => {
    const ship = {
      laser_slot: { name: "Test Laser", level: 1, rarity: "normal", catalysts: [] },
      weapon_slot: { name: "Test Weapon", level: 1, rarity: "normal", catalysts: [] },
    };
    // 3 identical gathering_yield candidates (boost category, laser_slot):
    // only 2 should ever be used (MAX_SAME_STAT=2).
    // 2 identical defense candidates (battling category, weapon_slot,
    // cap=50): each legendary/range-100 is worth 40, so the 2nd's gain must
    // be capped down to the remaining headroom (50-40=10).
    const pool = [
      cat("gy1", "gathering_yield", "legendary", 100),
      cat("gy2", "gathering_yield", "legendary", 100),
      cat("gy3", "gathering_yield", "legendary", 100),
      cat("def1", "defense", "legendary", 100),
      cat("def2", "defense", "legendary", 100),
    ];

    const res = core.planInstalls(ship, pool, {});

    // golden: locks current greedy pick order and gain values
    assert.deepEqual(
      res.actions.map(a => ({ id: a.add._id, gain: a.gain, sameCount: a.sameCount })),
      [
        { id: "def1", gain: 40, sameCount: 1 },
        { id: "gy1", gain: 40, sameCount: 1 },
        { id: "gy2", gain: 20, sameCount: 2 },
        { id: "def2", gain: 10, sameCount: 2 },
      ]
    );

    // never more than 2 same-stat per group: the 3rd gathering_yield
    // candidate is never used.
    assert.ok(!res.used.has("gy3"));

    // stat cap respected: total defense gain (40 + 10) never exceeds the
    // cap (50) minus whatever was already installed (0 here).
    const defenseGain = res.actions.filter(a => a.add.stat === "defense").reduce((s, a) => s + a.gain, 0);
    assert.equal(defenseGain, core.STAT_CAPS.defense);
  });

  test("gains below MIN_WORTHWHILE_GAIN are skipped for the default tab", () => {
    // Existing default group (shield_slot, battling) is full (4/4): a
    // halved defense catalyst (range 87) sits alongside an unhalved
    // defense catalyst (range 99) and two unrelated stats. A fresh
    // candidate (range 88) would replace the halved one, but because the
    // sibling stat is still present the candidate is halved too, making
    // the raw gain only 0.05 - below MIN_WORTHWHILE_GAIN (0.1).
    const ship = {
      shield_slot: {
        name: "Test Shield", level: 1, rarity: "normal",
        catalysts: [
          cat("d0", "defense", "normal", 99, { halved: false }),
          cat("d1", "defense", "normal", 87, { halved: true }),
          cat("p0", "precision", "normal", 50, { halved: false }),
          cat("e0", "evasion", "normal", 50, { halved: false }),
        ],
      },
    };
    const pool = [cat("d2", "defense", "normal", 88)];
    const res = core.planInstalls(ship, pool, {});

    const defaultActions = res.actions.filter(a => a.activity === "default");
    assert.equal(defaultActions.length, 0, "the tiny-gain replace must not be suggested for the default tab");
  });

  test("does NOT suggest a weak first specialized catalyst when the inherited default group is stronger in relevant stats", () => {
    // Weapon's default group is FULL (4/4) with strong battling stats -
    // getEquippedOn(weapon, 'galaxyboss') currently falls through to this
    // default group (galaxyboss group is empty). Overriding it with a weak
    // first galaxyboss catalyst would REPLACE all 140 worth of relevant
    // battling value with a single 0.5-value precision catalyst - a huge
    // net loss that must never be suggested.
    const ship = {
      weapon_slot: {
        name: "Test Weapon", level: 1, rarity: "legendary",
        catalysts: [
          cat("d1", "defense", "legendary", 100, { activity: "default" }),            // 40
          cat("d2", "defense", "legendary", 100, { activity: "default", halved: true }), // 20
          cat("ap1", "armor_penetration", "legendary", 100, { activity: "default" }), // 40
          cat("st1", "stun", "legendary", 100, { activity: "default" }),              // 40
        ],
      },
    };
    const pool = [cat("weak-precision", "precision", "normal", 10)]; // raw value 0.5
    const res = core.planInstalls(ship, pool, {});
    assert.equal(res.actions.length, 0, "no action should touch the full default group or the empty galaxyboss/dungeons groups");
  });

  test("DOES suggest a first specialized catalyst when the default group holds only stats irrelevant to that activity", () => {
    // Laser's default group holds gathering_yield, which does NOTHING
    // during exploring (ACTIVITY_RELEVANT_STATS.exploring is exploring_xp /
    // cosmic_dust_bonus only) - overriding the (empty) exploring group costs
    // nothing in relevant value, so even a weak exploring_xp catalyst is a
    // pure win and must be suggested. A second candidate for a different
    // stat then lands in the now-non-empty group with plain additive gain
    // (no further inherited-replacement penalty).
    const ship = {
      laser_slot: {
        name: "Test Laser", level: 1, rarity: "normal",
        catalysts: [cat("gy1", "gathering_yield", "legendary", 100, { activity: "default" })],
      },
    };
    const pool = [
      cat("ex1", "exploring_xp", "normal", 10),      // raw value 1.0
      cat("cd1", "cosmic_dust_bonus", "normal", 10), // raw value 1.0
    ];
    const res = core.planInstalls(ship, pool, {});
    const exploring = res.actions.filter(a => a.activity === "exploring");
    assert.equal(exploring.length, 2, "both exploring candidates should be installed");
    assert.ok(exploring.every(a => Math.abs(a.gain - 1.0) < 0.001), "no inherited-replacement penalty once the group already has a catalyst");
  });
});

describe("statTotalsByContext (chain semantics)", () => {
  test("item with default + galaxyboss groups: galaxyboss context uses ONLY the galaxyboss group for that item", () => {
    const ship = {
      weapon_slot: {
        name: "Test Weapon", level: 1, rarity: "legendary",
        catalysts: [
          cat("d1", "defense", "legendary", 100, { activity: "default" }),      // 40
          cat("p1", "precision", "legendary", 100, { activity: "galaxyboss" }), // 20
        ],
      },
    };
    const totals = core.statTotalsByContext(ship);
    assert.equal(totals.default.defense, 40);
    assert.equal(totals.default.precision, undefined);
    // galaxyboss group is non-empty -> it REPLACES default, so defense must
    // NOT leak in from the default group.
    assert.equal(totals.galaxyboss.precision, 20);
    assert.equal(totals.galaxyboss.defense, undefined);
  });

  test("item with only a default group: the default group is inherited everywhere", () => {
    const ship = {
      weapon_slot: {
        name: "Test Weapon", level: 1, rarity: "legendary",
        catalysts: [cat("d1", "defense", "legendary", 100, { activity: "default" })], // 40
      },
    };
    const totals = core.statTotalsByContext(ship);
    assert.equal(totals.default.defense, 40);
    assert.equal(totals.galaxyboss.defense, 40);
    assert.equal(totals.dungeons.defense, 40);
  });

  test("voyager inherits exploring before default (chain = [voyager, exploring, default])", () => {
    const ship = {
      engine_slot: {
        name: "Test Engine", level: 1, rarity: "rare",
        catalysts: [
          cat("f1", "fuel_efficiency", "legendary", 100, { activity: "default" }),   // 20
          cat("f2", "fuel_efficiency", "rare", 50, { activity: "exploring" }),       // 5
        ],
      },
    };
    const totals = core.statTotalsByContext(ship);
    assert.equal(totals.default.fuel_efficiency, 20);
    assert.equal(totals.exploring.fuel_efficiency, 5);
    // voyager's own group is empty -> falls to exploring (NOT default).
    assert.equal(totals.voyager.fuel_efficiency, 5);
  });
});

describe("planInstalls replace bookkeeping", () => {
  // Default group: 4 legendary/100 catalysts worth 40 each - no candidate
  // below can beat any of them, so phase 1 never touches it.
  const strongDefault = [
    cat("dd", "defense", "legendary", 100, { activity: "default" }),
    cat("da", "armor_penetration", "legendary", 100, { activity: "default" }),
    cat("ds", "stun", "legendary", 100, { activity: "default" }),
    cat("db", "block", "legendary", 100, { activity: "default" }),
  ];
  // Full galaxyboss group of uncommon ~98% catalysts (14.1 - 14.7 each).
  const gbGroup = (defRange = 98) => [
    cat("gb-block", "block", "uncommon", 94, { activity: "galaxyboss" }),           // 14.10
    cat("gb-ap", "armor_penetration", "uncommon", 98, { activity: "galaxyboss" }),  // 14.70
    cat("gb-def", "defense", "uncommon", defRange, { activity: "galaxyboss" }),     // 14.70 at 98
    cat("gb-dot", "dot", "uncommon", 97, { activity: "galaxyboss" }),               // 14.55
  ];

  test("replacing the only same-stat catalyst does NOT mark the newcomer halved, and the plan never replaces a catalyst it just installed", () => {
    const ship = {
      weapon_slot: { name: "Test Weapon", level: 1, rarity: "legendary", catalysts: [...strongDefault, ...gbGroup()] },
    };
    const pool = [
      cat("dot90", "dot", "rare", 90),     // 18.00 -> replaces gb-dot (14.55), gain 3.45
      cat("stun85", "stun", "uncommon", 85), // 12.75 -> weaker than everything in the group after that
    ];
    const res = core.planInstalls(ship, pool, {});
    const gb = res.actions.filter(a => a.activity === "galaxyboss");
    assert.equal(gb.length, 1, "only the dot upgrade is worthwhile");
    assert.equal(gb[0].add._id, "dot90");
    assert.equal(gb[0].remove._id, "gb-dot");
    assert.equal(gb[0].sameCount, 1, "gb-dot leaves the group, so dot90 is the only dot");
    assert.ok(Math.abs(gb[0].gain - 3.45) < 0.001);
    const addedIds = new Set(res.actions.map(a => a.add._id));
    assert.ok(!res.actions.some(a => a.remove && addedIds.has(a.remove._id)), "no action removes a catalyst the plan itself installed");
  });

  test("replace keeps context totals honest so a capped stat is not filled twice", () => {
    // Shield default: legendary defense 75 = 30, inherited into galaxyboss.
    // Weapon galaxyboss defense (uncommon 60 = 9.00) -> galaxyboss defense
    // total 39.00, cap 50. One legendary defense 100 (40) replacing gb-def
    // (same stat!) brings the total to 70 (capped 50: real gain 11.00). A
    // SECOND identical candidate can add nothing - it must not be suggested.
    const ship = {
      weapon_slot: { name: "Test Weapon", level: 1, rarity: "legendary", catalysts: [...strongDefault, ...gbGroup(60)] },
      shield_slot: {
        name: "Test Shield", level: 1, rarity: "legendary",
        catalysts: [
          cat("sd", "defense", "legendary", 75, { activity: "default" }), // 30
          cat("sa", "armor_penetration", "legendary", 100, { activity: "default" }),
          cat("ss", "stun", "legendary", 100, { activity: "default" }),
          cat("sb", "block", "legendary", 100, { activity: "default" }),
        ],
      },
    };
    const pool = [
      cat("bigdef1", "defense", "legendary", 100),
      cat("bigdef2", "defense", "legendary", 100),
    ];
    const res = core.planInstalls(ship, pool, {});
    const defActions = res.actions.filter(a => a.add.stat === "defense");
    assert.equal(defActions.length, 1, "defense is capped after the first replacement");
    assert.equal(defActions[0].remove._id, "gb-def");
    assert.ok(Math.abs(defActions[0].gain - 11) < 0.001);
  });
});

describe("cap context on actions and in contextTotals", () => {
  test("each action whose stat is capped in its tab carries context total before/after and the per-context cap", () => {
    const ship = {
      weapon_slot: { name: "Test Weapon", level: 1, rarity: "normal", catalysts: [] },
    };
    const pool = [
      cat("def1", "defense", "legendary", 100), // 40 -> total 0 -> 40
      cat("def2", "defense", "legendary", 100), // halved 20, clamped to headroom 10 -> 40 -> 50
      cat("blk1", "block", "legendary", 100),   // 40, block has no flat cap: default cap 40, galaxyboss 25
    ];
    const res = core.planInstalls(ship, pool, {});
    const byId = Object.fromEntries(res.actions.map(a => [a.add._id, a]));
    assert.deepEqual(
      { before: byId.def1.capTotalBefore, after: byId.def1.capTotalAfter, cap: byId.def1.cap },
      { before: 0, after: 40, cap: 50 }
    );
    assert.deepEqual(
      { before: byId.def2.capTotalBefore, after: byId.def2.capTotalAfter, cap: byId.def2.cap },
      { before: 40, after: 50, cap: 50 }
    );
    // block: per-context cap table (default 40) even though STAT_CAPS has no entry
    assert.equal(byId.blk1.cap, 40);
    assert.equal(byId.blk1.capTotalAfter, 40);
  });

  test("buildContextTotals lists every capped stat relevant to the activity, at zero too, and flags waste", () => {
    const ship = {
      weapon_slot: {
        name: "Test Weapon", level: 1, rarity: "legendary",
        catalysts: [
          cat("b1", "block", "legendary", 100, { activity: "default" }),  // 40
          cat("b2", "block", "legendary", 100, { activity: "default" }),  // 40 (not halved in fixture) -> 80 > cap 40
        ],
      },
    };
    const ct = core.buildContextTotals(core.statTotalsByContext(ship));
    const gb = Object.fromEntries(ct.galaxyboss.map(r => [r.stat, r]));
    // relevant capped stats present even with zero investment
    assert.equal(gb.lifesteal.total, 0);
    assert.equal(gb.lifesteal.cap, 36);
    assert.equal(gb.stun.total, 0);
    // galaxyboss block cap is 25, inherited 80 -> wasted 55
    assert.equal(gb.block.cap, 25);
    assert.equal(gb.block.wastedText, "55.00%");
    // utility caps do nothing in galaxy boss -> not listed as zero rows
    assert.equal(gb.fuel_efficiency, undefined);
    // crafting: block is not relevant there -> present only as inherited, marked irrelevant
    const cr = Object.fromEntries(ct.crafting.map(r => [r.stat, r]));
    assert.equal(cr.block.relevant, false);
    assert.equal(cr.stun, undefined);
  });
});

describe("restrictDefault still allows same-stat upgrades", () => {
  test("resources variant: upgrading an installed battling_xp is suggested, a fresh battling_xp into a free slot is not", () => {
    const ship = {
      probes_slot: {
        name: "Test Probes", level: 1, rarity: "legendary",
        catalysts: [
          cat("bx83", "battling_xp", "uncommon", 83, { activity: "default" }),      // 12.45
          cat("gy1", "gathering_yield", "uncommon", 90, { activity: "default" }),  // 13.5
        ], // 2 of 4 slots used
      },
    };
    const pool = [
      cat("bx92", "battling_xp", "uncommon", 92),   // 13.8 -> same-stat upgrade, +1.35
      cat("bx70", "battling_xp", "uncommon", 70),   // 10.5 -> would only fit a free slot (halved), must be blocked
    ];
    const res = core.planInstalls(ship, pool, {
      statWeights: { battling_xp: 0.01, gathering_yield: 3 },
      restrictDefault: ["gathering_yield", "gathering_xp", "catalyst_drop_chance", "fuel_efficiency"],
    });
    const def = res.actions.filter(a => a.activity === "default");
    const up = def.find(a => a.add._id === "bx92");
    assert.ok(up, "same-stat upgrade must be suggested");
    assert.equal(up.action, "replace");
    assert.equal(up.remove._id, "bx83");
    assert.ok(Math.abs(up.gain - 1.35) < 0.001);
    assert.ok(!def.some(a => a.add._id === "bx70"), "a new battling_xp in a free default slot stays blocked");
  });
});

describe("context-only stat caps", () => {
  // `block` is the one stat whose cap lives ONLY in STAT_CAPS_BY_CONTEXT
  // (40 normally, 25 in galaxy boss). A bare STAT_CAPS lookup left it
  // undefined, so every headroom guard in the planner was skipped and it
  // recommended block catalysts past the cap while the warnings tab flagged
  // the very same total as over.
  test("block stops at its context cap instead of filling the group", () => {
    const ship = { weapon_slot: { name: "W", level: 1, rarity: "normal", catalysts: [] } };
    const pool = [
      cat("b1", "block", "legendary", 100),
      cat("b2", "block", "legendary", 100),
      cat("b3", "block", "legendary", 100),
    ];
    const res = core.planInstalls(ship, pool, {});
    // one legendary/range-100 block is worth 40 = the whole default cap, so
    // the second (which would otherwise land at a halved 20) is refused.
    assert.deepEqual(res.actions.map(a => a.add._id), ["b1"]);
    assert.equal(res.actions[0].gain, 40);
    assert.ok(!res.used.has("b2"));
  });

  test("a capped stat that IS in STAT_CAPS still behaves the same", () => {
    const ship = { weapon_slot: { name: "W", level: 1, rarity: "normal", catalysts: [] } };
    const pool = [cat("d1", "defense", "legendary", 100), cat("d2", "defense", "legendary", 100)];
    const res = core.planInstalls(ship, pool, {});
    // defense cap 50: first takes 40, second is capped down to the last 10.
    assert.deepEqual(res.actions.map(a => [a.add._id, a.gain]), [["d1", 40], ["d2", 10]]);
  });
});

describe("analyze() end to end", () => {
  // Nothing used to call analyze() in the tests, so a typo in the top-level
  // assembly (a stray `state` instead of `s`) reached the running server as a
  // 500 with "state is not defined" and only a live request caught it.
  const minimalState = () => ({
    ship: {}, catalysts: [], craft: { crafting_level: 10, crafting_current_xp: 0, crafting_target_xp: 100 },
    dust: 0, catalyst_parts: 0, quantum_cores: 10, credits: 1000,
    commonResources: {}, rareCurrencies: {}, pets: { pets: [], slots: [] }, droids: [],
    prices: {}, blueprints: [], materials: [], voyager: {}, lab: null, base: null, baseLab: null,
    account: {}, dailyQuests: null, currentSystem: null, bookmarks: [],
    gameVersion: "test", clientBundle: "test", skillLevels: {},
    ssBattlingBoost: 0, ssBattlingBoostKnown: true, gatherLast: null, globalBoosts: {},
    stateReadAt: Date.now(), player: { stats: null, skills: {}, clones: [] },
  });

  test("runs on a minimal state and returns the documented blocks", () => {
    const r = core.analyze(minimalState());
    for (const key of ["player", "gear", "warnings", "installs", "mergePlans", "inventory",
                       "units", "tech", "pets", "materials", "shipItems", "lab", "base"]) {
      assert.ok(key in r, "analyze() result is missing " + key);
    }
  });

  test("an unhydrated store does not abort the whole analysis", () => {
    // Collection-shaped fields are normalized at the entry point, so a store
    // that arrives null (or as some other shape after a game update) costs
    // that one section, not every tab.
    for (const key of ["materials", "catalysts", "droids", "blueprints", "ship", "player", "craft"]) {
      for (const bad of [null, undefined, {}, 0]) {
        const st = minimalState();
        st[key] = bad;
        assert.doesNotThrow(() => core.analyze(st), key + " = " + JSON.stringify(bad));
      }
    }
  });

  test("a missing squadron boost marks the battle numbers untrusted", () => {
    const st = minimalState();
    st.ssBattlingBoostKnown = false;
    assert.equal(core.analyze(st).battleTrusted, false);
    assert.equal(core.analyze(minimalState()).battleTrusted, true);
  });
});

// A Voyager expedition reads the EXPLORING profile of the laser and probes:
// boost items have no voyager tab, so the chain voyager -> exploring ->
// default lands on their exploring group. The game confirms it twice -- the
// install dialog labels that tab "Exploring & Voyager" on those two items and
// lists its Cosmic Dust Bonus under "Current bonuses (Exploring & Voyager)".
// Getting this wrong makes an expedition look far less rewarding than it is.
describe("voyager inherits the exploring profile of boost items", () => {
  const { ACTIVITY_RELEVANT_STATS, ITEM_ACTIVITIES, activityChain } = require("../lib/constants.js");

  test("the resolution chain is voyager -> exploring -> default", () => {
    assert.deepEqual(activityChain("voyager"), ["voyager", "exploring", "default"]);
  });

  test("boost items have no voyager tab, so they can only inherit", () => {
    for (const slot of ["laser_slot", "probes_slot"]) {
      assert.ok(!ITEM_ACTIVITIES[slot].includes("voyager"), slot + " must not have a voyager tab");
      assert.ok(ITEM_ACTIVITIES[slot].includes("exploring"), slot + " must have an exploring tab");
    }
  });

  test("the dust catalyst does NOT multiply expedition dust", () => {
    // Measured, not assumed. Expedition to Zilsynkyxbal on 2026-09-09:
    // K star (10) + 3 bodies (60) + 17,956.78 ly = raw 18,026.78, and the
    // voyager paid 17,044 kept + 5,681 taxed = 22,725 gross. That is
    // x1.2606, i.e. owl 14% x premium 10% = 1.254 and nothing more. Had the
    // +54.9% cosmic dust catalyst applied it would have paid ~35,000.
    // The game's "Exploring & Voyager" tab names the shared PROFILE; it does
    // not mean the dust bonus reaches the expedition reward.
    const raw = 10 + 3 * 20 + 17956.78;
    const measured = (17044 + 5681) / raw;
    assert.ok(Math.abs(measured - 1.14 * 1.10) < 0.01,
      "owl x premium should explain the whole multiplier, got " + measured);
    assert.ok(Math.abs(measured - 1.14 * 1.10 * 1.549) > 0.5,
      "and the catalyst-inclusive model should be far off");
    assert.ok(!ACTIVITY_RELEVANT_STATS.voyager.includes("cosmic_dust_bonus"),
      "so cosmic_dust_bonus must not be listed as doing something on an expedition");
  });

  test("the voyager-only utility stats are the relevant ones", () => {
    assert.deepEqual([...ACTIVITY_RELEVANT_STATS.voyager].sort(),
      ["catalyst_drop_chance", "fuel_efficiency", "voyager_jumps_bonus"]);
  });
});
