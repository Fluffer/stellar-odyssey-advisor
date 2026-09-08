// Battle rating (only for battling-category catalysts in default groups).

const { ITEM_CATEGORY, BATTLING_NPCS } = require("./constants.js");
const { statCategory, itemGroups, catalystValue } = require("./value.js");
const battle = require("../advisor-battle.js");

// Aggregate equipped catalyst bonuses exactly like the game's
// getEquippedBonusesForShip: DEFAULT-activity catalysts only, summing
// values with the STORED halved flag (the same-stat penalty is applied by
// the game at install time, not during aggregation).
function equippedBonuses(ship) {
  const out = {};
  for (const slot of Object.keys(ITEM_CATEGORY)) {
    const item = ship[slot];
    if (!item) continue;
    const groups = itemGroups(slot, item);
    for (const c of groups.default || []) {
      out[c.stat] = (out[c.stat] || 0) + catalystValue(c);
    }
  }
  return out;
}

// Build the battle simulator player object from game state.
function battlePlayer(state) {
  const p = state.player;
  if (!p || !p.stats || !p.clones || !p.clones.length) return null;
  return {
    stats: p.stats,
    skills: p.skills || {},
    ship: state.ship,
    clones: p.clones,
  };
}

// Average max NPC level @ 98% WR across all NPC types (the game's own
// benchmark metric). Returns null if battle data unavailable.
function averageMaxLevel(playerObj, catalystBonuses, opts) {
  if (!playerObj) return null;
  let sum = 0, n = 0;
  for (const npc of BATTLING_NPCS) {
    const r = battle.maxLevelAtWinrate(playerObj, npc, catalystBonuses, opts || {});
    sum += r.level;
    n++;
  }
  return n ? Math.round((sum / n) * 10) / 10 : null;
}

// Per-NPC battle rating: for each NPC type, find max level @ 98% WR.
function perNpcMaxLevels(playerObj, catalystBonuses, opts) {
  const out = {};
  for (const npc of BATTLING_NPCS) {
    const r = battle.maxLevelAtWinrate(playerObj, npc, catalystBonuses, opts || {});
    out[npc.name] = r.level;
  }
  return out;
}

// Battle-rating caches. Base levels (one level search per NPC type) and
// per-action deltas cost seconds of simulation, so both are cached at
// module level and keyed by fingerprint: repeated analyze calls with
// unchanged battle inputs (player stats/skills/clones, ship catalysts,
// ssBoost) are instant.
const _baseLevelsCache = new Map();
const _ratingCache = new Map();
const RATING_CACHE_MAX = 500;

function battleStateFingerprint(state) {
  const p = state.player || {};
  return JSON.stringify({
    ssBoost: state.ssBattlingBoost || 0,
    stats: p.stats || null,
    skills: p.skills || null,
    clones: (p.clones || []).map(c => [c.critical_chance, c.critical_damage, c.dual_shot]),
    ship: Object.fromEntries(Object.entries(state.ship).map(([k, it]) => [
      k, it ? (it.catalysts || []).map(c => [c._id, c.stat, c.rarity, c.range, !!c.halved, c.activity || "default"]) : null
    ])),
  });
}

// Fingerprint for a (possibly hypothetical) player object against its state.
function battleStateFingerprintFor(playerObj, state, ssBoost) {
  const p = playerObj;
  return JSON.stringify({
    ssBoost,
    stats: p.stats || null,
    skills: p.skills || null,
    clones: (p.clones || []).map(c => [c.critical_chance, c.critical_damage, c.dual_shot]),
    ship: Object.fromEntries(Object.entries(state.ship).map(([k, it]) => [
      k, it ? (it.catalysts || []).map(c => [c._id, c.stat, c.rarity, c.range, !!c.halved, c.activity || "default"]) : null
    ])),
  });
}

// Battle validator used DURING install planning. Every default-tab action
// that touches battling stats is simulated BEFORE it is committed: for each
// NPC type we find the CURRENT max level @ >=98% WR (high-confidence runs,
// cached), then simulate the candidate setup AT THAT LEVEL and measure how
// many levels the change buys (or costs). If the winrate drops below the
// threshold for ANY NPC, the action is rejected on the spot — the greedy
// re-picks the next best candidate and the rejected catalyst stays in the
// pool for the specialized tabs. (The old post-hoc filter dropped actions
// AFTER their catalysts had already been consumed, which wasted them.)
function makeBattleValidator(state) {
  const p = battlePlayer(state);
  if (!p) return null;

  // Squadron Barracks boost (e.g. +77%) — the game's optimizer assumes
  // squadron building bonuses are active, so must we.
  const ssBoost = state.ssBattlingBoost || 0;
  const WR_THRESHOLD = 98;
  const BASE_OPTS = { threshold: WR_THRESHOLD, runs: 600, confirmRuns: 2500, hi: 2000, ssBoost };
  const CHECK_RUNS = 2500;

  const stateFp = battleStateFingerprint(state);
  const actionKey = (a) => [
    a.action, a.slot, a.activity, a.add._id ?? a.add.id, a.add.range,
    a.remove ? (a.remove._id ?? a.remove.id) : null,
  ].join("|");

  // 1. Current max level per NPC (cached across analyze calls).
  let baseLevels = _baseLevelsCache.get(stateFp);
  if (!baseLevels) {
    baseLevels = {};
    for (const npc of BATTLING_NPCS) {
      const r = battle.maxLevelAtWinrate(p, npc, equippedBonuses(state.ship), BASE_OPTS);
      baseLevels[npc.name] = r.level;
    }
    if (_baseLevelsCache.size >= 16) {
      _baseLevelsCache.delete(_baseLevelsCache.keys().next().value);
    }
    _baseLevelsCache.set(stateFp, baseLevels);
  }

  const touchesBattle = (a) =>
    a.activity === "default" &&
    (statCategory(a.add.stat) === "battling" ||
      (a.remove && statCategory(a.remove.stat) === "battling"));

  // Rate one action against the current ship (independent application).
  // Cached per (state, action) so repeated greedy picks and repeated
  // analyze calls never re-simulate the same change.
  function rate(a) {
    const key = stateFp + "|" + actionKey(a);
    const hit = _ratingCache.get(key);
    if (hit) return hit;

    const result = { npcDeltas: null, worstDelta: 0 };
    const ship2 = JSON.parse(JSON.stringify(state.ship));
    const item = ship2[a.slot];
    if (item) {
      if (!Array.isArray(item.catalysts)) item.catalysts = [];
      if (a.remove) {
        const idx = item.catalysts.findIndex(c => c._id === (a.remove._id ?? a.remove.id));
        if (idx !== -1) item.catalysts.splice(idx, 1);
      }
      // Predict the halved flag the game would assign: 2nd+ same-stat in the
      // target group gets halved at install time.
      const existingSame = item.catalysts.filter(c => c.stat === a.add.stat).length;
      item.catalysts.push({ ...a.add, activity: a.activity, halved: existingSame >= 1 });
      const candBonuses = equippedBonuses(ship2);

      // 2. Gate first: the change must hold the CURRENT base level for every
      //    NPC type. The first failure rejects the action immediately — the
      //    exact level loss is never displayed, so simulating the full
      //    descent would be wasted work (it was what made planning slow).
      let failed = false;
      for (const npc of BATTLING_NPCS) {
        const wr = battle.winrate(p, { npc, level: baseLevels[npc.name], catalystBonuses: candBonuses, ssBoost }, CHECK_RUNS);
        if (wr < WR_THRESHOLD) { failed = true; break; }
      }
      if (failed) {
        result.npcDeltas = null;
        result.worstDelta = -1;
      } else {
        // 3. Passed: measure how many levels above base the change buys per
        //    NPC type (display info for the plan).
        const npcDeltas = {};
        let worstDelta = 0;
        for (const npc of BATTLING_NPCS) {
          const baseLvl = baseLevels[npc.name];
          let delta = 0;
          let probe = baseLvl;
          while (delta < 10) {
            const wr = battle.winrate(p, { npc, level: probe + 1, catalystBonuses: candBonuses, ssBoost }, CHECK_RUNS);
            if (wr < WR_THRESHOLD) break;
            probe++;
            delta++;
          }
          npcDeltas[npc.name] = delta;
          if (delta < worstDelta) worstDelta = delta;
        }
        result.npcDeltas = npcDeltas;
        result.worstDelta = worstDelta;
      }
    }
    if (_ratingCache.size >= RATING_CACHE_MAX) {
      _ratingCache.delete(_ratingCache.keys().next().value);
    }
    _ratingCache.set(key, result);
    return result;
  }

  return {
    baseLevels,
    note: `Battle check: each change is simulated at your current max NPC level @ ${WR_THRESHOLD}%+ winrate (game's simulator port, ${CHECK_RUNS} runs, squadron boost +${ssBoost}%). Battle-degrading changes are rejected on the spot — their catalysts stay available for the specialized tabs.`,
    touchesBattle,
    // Gate for planInstalls: reject default-tab actions that would lower
    // ANY NPC type's max level.
    validate(a) {
      if (!touchesBattle(a)) return true;
      return rate(a).worstDelta >= 0;
    },
    // Display rating for an action (null if it does not touch battle).
    getRating(a) {
      if (!touchesBattle(a)) return null;
      return rate(a);
    },
  };
}

// What-if projection: apply every action in `actions` to a deep copy of
// state.ship (same halved-flag prediction the validator's rate() uses: 2nd+
// same-stat in the target group gets halved at install time), then compute
// per-NPC max levels @ 98% winrate for that hypothetical ship. Cached in
// _baseLevelsCache like the real baseline, keyed by a fingerprint of the
// hypothetical ship, so repeat analyze() calls with the same plan are instant.
function projectShip(state, actions, opts = {}) {
  const p = battlePlayer(state);
  if (!p) return null;
  const ssBoost = opts.ssBoost ?? (state.ssBattlingBoost || 0);
  const BASE_OPTS = { threshold: 98, runs: 600, confirmRuns: 2500, hi: 2000, ...opts, ssBoost };

  const ship2 = JSON.parse(JSON.stringify(state.ship));
  for (const a of actions) {
    const item = ship2[a.slot];
    if (!item) continue;
    if (!Array.isArray(item.catalysts)) item.catalysts = [];
    if (a.remove) {
      const idx = item.catalysts.findIndex(c => c._id === (a.remove._id ?? a.remove.id));
      if (idx !== -1) item.catalysts.splice(idx, 1);
    }
    const existingSame = item.catalysts.filter(c => c.stat === a.add.stat).length;
    item.catalysts.push({ ...a.add, activity: a.activity, halved: existingSame >= 1 });
  }

  const fp = battleStateFingerprintFor(p, { ship: ship2 }, ssBoost);
  let npcLevels = _baseLevelsCache.get(fp);
  if (!npcLevels) {
    const bonuses = equippedBonuses(ship2);
    npcLevels = {};
    for (const npc of BATTLING_NPCS) {
      const r = battle.maxLevelAtWinrate(p, npc, bonuses, BASE_OPTS);
      npcLevels[npc.name] = r.level;
    }
    if (_baseLevelsCache.size >= 16) {
      _baseLevelsCache.delete(_baseLevelsCache.keys().next().value);
    }
    _baseLevelsCache.set(fp, npcLevels);
  }
  return npcLevels;
}

module.exports = {
  equippedBonuses, battlePlayer, averageMaxLevel, perNpcMaxLevels,
  _baseLevelsCache, _ratingCache, RATING_CACHE_MAX,
  battleStateFingerprint, battleStateFingerprintFor, makeBattleValidator,
  projectShip,
};
