// Technology (skill) upgrade advisor.

const { BATTLING_NPCS } = require("./constants.js");
const { battlePlayer, equippedBonuses, _baseLevelsCache, battleStateFingerprintFor } = require("./battle-rating.js");
const battle = require("../advisor-battle.js");

// Skill upgrade costs are paid in QUANTUM CORES. From the game source:
//   getSkillCost(L) = L*(L+1)          cumulative cores invested at level L
//   cost of L -> L+1   = 2*(L+1)       (difference of the cumulative)
//   MAX_SKILL_LEVEL = 100, reset costs 50 stellar tokens (premium - avoid).
// On the Steam realm these skills are LOCKED (not purchasable):
const TECH_LOCKED_SKILLS = new Set([
  "base_module_efficiency_boost",
  "dungeon_reward_boost", "dungeon_battle_boost", "dungeon_gather_boost",
  "dungeon_craft_boost", "dungeon_explore_boost",
]);

const TECH_SKILLS = [
  { key: "battling_weapon_boost", cat: "battling", desc: "Weapon damage +1% per level" },
  { key: "battling_hull_boost", cat: "battling", desc: "Hull +1% per level" },
  { key: "battling_precision_boost", cat: "battling", desc: "Precision (hit chance) +1% per level" },
  { key: "battling_evasion_boost", cat: "battling", desc: "Evasion (dodge) +1% per level" },
  { key: "battling_base_xp_boost", cat: "battling", desc: "Battling XP +1% per level" },
  { key: "gathering_base_xp_boost", cat: "gathering", desc: "Gathering XP +1% per level" },
  { key: "gathering_rare_base_drop", cat: "gathering", desc: "Rare material drop chance" },
  { key: "gathering_common_base_drop", cat: "gathering", desc: "Common material drop chance" },
  { key: "exploring_cosmic_dust_boost", cat: "exploring", desc: "Cosmic dust from exploring" },
  { key: "crafting_base_xp_boost", cat: "crafting", desc: "Crafting XP +1% per level - every 10 craft levels = +1 merge range bonus" },
  { key: "pets_base_xp_boost", cat: "pets", desc: "Pet XP" },
  { key: "voyager_reward_boost", cat: "voyager", desc: "Voyager rewards +1% per level" },
  { key: "gb_damage_boost", cat: "galaxyboss", desc: "Galaxy boss damage +1% per level" },
  { key: "gb_defense_boost", cat: "galaxyboss", desc: "Galaxy boss defense +1% per level" },
  { key: "gb_reward_boost", cat: "galaxyboss", desc: "Galaxy boss rewards +1% per level" },
  { key: "base_module_efficiency_boost", cat: "base", desc: "Base module efficiency (locked on Steam)" },
  { key: "dungeon_battle_boost", cat: "dungeons", desc: "Dungeon battling (locked on Steam)" },
  { key: "dungeon_gather_boost", cat: "dungeons", desc: "Dungeon gathering (locked on Steam)" },
  { key: "dungeon_craft_boost", cat: "dungeons", desc: "Dungeon crafting (locked on Steam)" },
  { key: "dungeon_explore_boost", cat: "dungeons", desc: "Dungeon exploring (locked on Steam)" },
  { key: "dungeon_reward_boost", cat: "dungeons", desc: "Dungeon rewards (locked on Steam)" },
];

const TECH_MAX_LEVEL = 100;
// The four combat-stat skills the battle simulator models exactly.
const TECH_BATTLE_SIM_SKILLS = [
  "battling_weapon_boost", "battling_hull_boost",
  "battling_precision_boost", "battling_evasion_boost",
];

function techSkillCostNext(level) {
  return 2 * (level + 1);
}

// Rank the four combat skills by simulated max-NPC-level gain per core.
// Results are cached per state fingerprint (the scenario states carry the
// modified skills, so each gets its own cache entry).
function techBattleRanking(state) {
  const p = battlePlayer(state);
  if (!p) return null;
  const ssBoost = state.ssBattlingBoost || 0;
  const OPTS = { threshold: 98, runs: 600, confirmRuns: 2500, hi: 2000, ssBoost };
  const cats = equippedBonuses(state.ship);

  const maxLevelsOf = (playerObj) => {
    const fp = battleStateFingerprintFor(playerObj, state, ssBoost);
    let levels = _baseLevelsCache.get(fp);
    if (!levels) {
      levels = {};
      for (const npc of BATTLING_NPCS) {
        levels[npc.name] = battle.maxLevelAtWinrate(playerObj, npc, cats, OPTS).level;
      }
      if (_baseLevelsCache.size >= 16) {
        _baseLevelsCache.delete(_baseLevelsCache.keys().next().value);
      }
      _baseLevelsCache.set(fp, levels);
    }
    return levels;
  };

  const base = maxLevelsOf(p);
  const baselineAvg = Object.values(base).reduce((s, v) => s + v, 0) / Object.keys(base).length;

  // Ranking metric: winrate delta at a fixed level. maxLevelAtWinrate()
  // reseeds per level (advisor-battle.js:215), so differencing two max-level
  // searches would measure noise; holding the level fixed makes both builds
  // run the SAME rng stream (common random numbers).
  //
  // The probe level is where the CURRENT build wins about half its fights:
  // the steepest, most discriminating part of the curve. At the 98% threshold
  // every skill is squashed against the ceiling.
  const PROBE_RUNS = 3000;
  const probeLevelFor = (npc) => {
    let lo = 1, hi = Math.max(2, Math.round(base[npc.name] * 1.6)), mid = lo;
    for (let i = 0; i < 12 && lo < hi - 1; i++) {
      mid = Math.floor((lo + hi) / 2);
      if (battle.winrate(p, { npc, level: mid, ssBoost, catalystBonuses: cats }, 400) >= 50) lo = mid;
      else hi = mid;
    }
    return Math.max(1, lo);
  };
  const probes = {};
  for (const npc of BATTLING_NPCS) probes[npc.name] = probeLevelFor(npc);

  // Mean winrate across the probe levels, one seeded stream per (npc, level).
  const probeWinrate = (playerObj) => {
    let sum = 0;
    for (const npc of BATTLING_NPCS) {
      sum += battle.winrate(playerObj, { npc, level: probes[npc.name], ssBoost, catalystBonuses: cats }, PROBE_RUNS);
    }
    return sum / BATTLING_NPCS.length;
  };
  // Winrate points per NPC level near the probe, so a winrate delta can be
  // reported as equivalent NPC levels. Measured on the same streams,
  // symmetrically around each probe level.
  const slopePerLevel = (() => {
    let sum = 0, n = 0;
    for (const npc of BATTLING_NPCS) {
      const L = probes[npc.name];
      const d = Math.max(1, Math.round(L * 0.08));
      const below = battle.winrate(p, { npc, level: Math.max(1, L - d), ssBoost, catalystBonuses: cats }, PROBE_RUNS);
      const above = battle.winrate(p, { npc, level: L + d, ssBoost, catalystBonuses: cats }, PROBE_RUNS);
      const span = (L + d) - Math.max(1, L - d);
      if (span > 0 && below > above) { sum += (below - above) / span; n++; }
    }
    return n ? sum / n : 0;
  })();

  const baseWr = probeWinrate(p);

  const rows = [];
  for (const key of TECH_BATTLE_SIM_SKILLS) {
    const level = (state.player.skills || {})[key] ?? 0;
    if (level >= TECH_MAX_LEVEL) continue;
    const s2 = JSON.parse(JSON.stringify(state));
    // cdp.js emits `skills: p.skills || null`, so a state that has not
    // hydrated yet arrives with skills === null and this assignment throws.
    if (!s2.player.skills) s2.player.skills = {};
    s2.player.skills[key] = level + 1;
    const p2 = battlePlayer(s2);
    const wrDelta = probeWinrate(p2) - baseWr;
    // Equivalent NPC levels for the Gain column.
    const avgDelta = slopePerLevel > 0 ? wrDelta / slopePerLevel : 0;
    const cost = techSkillCostNext(level);
    rows.push({
      key, level, cost,
      winrateDelta: Math.round(wrDelta * 1000) / 1000,
      avgDelta: Math.round(avgDelta * 100) / 100,
      levelsPerCore: Math.round((avgDelta / cost) * 10000) / 10000,
    });
  }
  rows.sort((a, b) => b.levelsPerCore - a.levelsPerCore);
  return {
    baselineAvg: Math.round(baselineAvg * 10) / 10,
    probeLevels: probes,
    winratePointsPerLevel: Math.round(slopePerLevel * 1000) / 1000,
    rows,
  };
}

// Full technology plan: current levels, costs, battle-sim ranking, and the
// optimal way to spend the quantum cores on hand.
function planTech(state) {
  const qc = state.quantum_cores || 0;
  const skills = (state.player && state.player.skills) || {};

  const rows = TECH_SKILLS.map(s => {
    const level = skills[s.key] ?? 0;
    const locked = TECH_LOCKED_SKILLS.has(s.key);
    const maxed = level >= TECH_MAX_LEVEL;
    const costNext = techSkillCostNext(level);
    return {
      key: s.key,
      label: s.key.replaceAll("_", " ").replace(" boost", ""),
      category: s.cat,
      desc: s.desc,
      level,
      locked,
      maxed,
      costNext,
      cumulativeSpent: level * (level + 1),
      // Cores from the current level all the way to the 100 cap: cumulative
      // cost at level L is L*(L+1), so the remainder is 100*101 - L*(L+1).
      coresToMax: locked ? null : TECH_MAX_LEVEL * (TECH_MAX_LEVEL + 1) - level * (level + 1),
      affordable: !locked && !maxed && costNext <= qc,
    };
  });

  // Account-wide max-out totals (unlocked skills only) and the gap after
  // the cores on hand. Income defaults (user-supplied, level ~60): ~18
  // cores/hour from battling drops + 150 from the daily; the GUI lets the
  // user tune both.
  const coresToMaxAll = rows.reduce((sum, r) => sum + (r.coresToMax || 0), 0);
  const coresGap = Math.max(0, coresToMaxAll - qc);
  const maxOut = {
    coresToMaxAll,
    coresGap,
    unlockedCount: rows.filter(r => !r.locked).length,
    maxedCount: rows.filter(r => !r.locked && r.maxed).length,
    defaultRatePerHour: 18,
    defaultDailyBonus: 150,
  };

  const battle = techBattleRanking(state);

  // Optimal allocation of the cores on hand: greedily buy combat skill
  // levels ranked by simulated level-gain per core (each further level on
  // the same skill costs 2 more cores, so re-rank after every purchase).
  const allocation = [];
  if (battle) {
    let left = qc;
    const levels = {};
    for (const r of battle.rows) levels[r.key] = r.level;
    const avgDelta = {};
    for (const r of battle.rows) avgDelta[r.key] = r.avgDelta;
    for (;;) {
      let best = null;
      for (const key of Object.keys(levels)) {
        if (levels[key] >= TECH_MAX_LEVEL) continue;
        const cost = techSkillCostNext(levels[key]);
        if (cost > left) continue;
        const perCore = avgDelta[key] / cost;
        // A skill that does not measurably help is not worth cores. Without
        // this, a round where every row measured <= 0 still allocated the
        // whole balance, picking by iteration order.
        if (!(perCore > 0)) continue;
        if (!best || perCore > best.perCore) best = { key, cost, perCore };
      }
      if (!best) break;
      allocation.push({ key: best.key, from: levels[best.key], to: levels[best.key] + 1, cost: best.cost });
      left -= best.cost;
      levels[best.key] += 1;
    }
    return {
      quantumCores: qc,
      skills: rows,
      battle,
      allocation,
      leftoverCores: left,
      maxOut,
    };
  }
  return { quantumCores: qc, skills: rows, battle: null, allocation: [], leftoverCores: qc, maxOut };
}

module.exports = {
  TECH_LOCKED_SKILLS, TECH_SKILLS, TECH_MAX_LEVEL, TECH_BATTLE_SIM_SKILLS,
  techSkillCostNext, techBattleRanking, planTech,
};
