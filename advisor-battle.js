// Battle rating for the advisor: ports the game's own simulateBattle
// (from the battle module in index.js) so recommendations can be ranked
// by "max NPC level beaten at >=98% winrate" instead of raw stat value.
//
// Only the 'default' activity catalysts apply to regular NPC battling.
//
// winrate() runs on a seeded mulberry32 stream (one stream per call) instead
// of Math.random, deriving its seed from [npc.name, level, runs] (plus an
// optional opts.seed). Same npc/level/runs -> identical RNG stream, so
// different builds compared at the same level see noise-free, reproducible
// results; simulateBattle's injectable rng is unaffected.

const NPC = {
  DamageMultiplier: 7, PrecisionMultiplier: 1, EvasionMultiplier: 1,
  HullMultiplier: 1300, ArmorMultiplier: 1,
  ArmorScalingConstant: 170000,
  LifestealCap: 36, DefenseCap: 50, ArmorPenetrationCap: 50,
  BlockCapNpc: 40, BlockCapGb: 25, StunCap: 40,
  DotDamagePercent: 45, DotDuration: 5, StunDuration: 1,
  ClonesBaseCriticalDamage: 30,
};
// NPC build profiles used by the game's own optimal-build search.
const NPC_TARGETS = [
  { name: "aggressive", K: 7, S: 10, hit: 0.55, dodge: 0.35 },
  { name: "balanced",  K: 9, S: 12, hit: 0.50, dodge: 0.40 },
  { name: "tanky",     K: 11, S: 14, hit: 0.45, dodge: 0.45 },
];

// Port of the game's simulateBattle (synchronous, RNG injectable).
// player: { stats:{power,precision,evasion,hull}, ship:{weapon_slot,shield_slot...}, clones:[...] }
// opts:   { npc, level, ssBoost, catalystBonuses, rng }
function simulateBattle(player, opts) {
  const { npc, level, ssBoost = 0, catalystBonuses = {}, rng = Math.random } = opts;
  const C = 1 + ssBoost / 100;

  // Player damage
  let dmg = 7 * player.stats.power * (1 + (player.skills?.battling_weapon_boost ?? 0) / 100)
    + (player.ship.weapon_slot ? player.ship.weapon_slot.value : 0);
  // Weakness bonus
  const weaponBonuses = player.ship.weapon_slot?.bonuses || [];
  const shieldBonuses = player.ship.shield_slot?.bonuses || [];
  const dmgTypes = [], dmgTypes2 = [];
  if (weaponBonuses.length === 1) dmgTypes.push({ type: weaponBonuses[0], damage: 30 });
  else if (weaponBonuses.length > 1) {
    dmgTypes.push({ type: weaponBonuses[0], damage: 15 });
    dmgTypes.push({ type: weaponBonuses[1], damage: 15 });
  }
  if (shieldBonuses.length === 1) dmgTypes2.push({ type: shieldBonuses[0], damage: 30 });
  else if (shieldBonuses.length > 1) {
    dmgTypes2.push({ type: shieldBonuses[0], damage: 15 });
    dmgTypes2.push({ type: shieldBonuses[1], damage: 15 });
  }
  if (npc) {
    let wBonus = 0;
    const anomalyW = player.ship.weapon_slot?.anomaly === true;
    if (anomalyW) wBonus = 30;
    else {
      const match = dmgTypes.filter(d => npc.weakness.includes(d.type));
      if (dmgTypes.length === 1 && match.length === 1) wBonus = 30;
      else if (dmgTypes.length > 1 && match.length > 0) wBonus = 15 * match.length;
    }
    let sBonus = 0;
    const anomalyS = player.ship.shield_slot?.anomaly === true;
    if (anomalyS) sBonus = 30;
    else {
      const match2 = dmgTypes2.filter(d => npc.weakness.includes(d.type));
      if (dmgTypes2.length === 1 && match2.length === 1) sBonus = 30;
      else if (dmgTypes2.length > 1 && match2.length > 0) sBonus = 15 * match2.length;
    }
    const bonus = wBonus + sBonus;
    if (bonus !== 0) dmg *= 1 + bonus / 100;
  }
  const playerDamage = Math.ceil(dmg * C);

  // NPC stats (steam realm: plain multipliers at all levels)
  const mob = {
    damage: Math.floor(level * NPC.DamageMultiplier * 1.5),
    precision: Math.floor(level * NPC.PrecisionMultiplier),
    evasion: Math.floor(level * NPC.EvasionMultiplier),
    hull: Math.floor(Math.pow(level, 1.1) * NPC.HullMultiplier),
    armor: Math.floor(level * NPC.ArmorMultiplier),
  };

  // Player hull
  const playerHull = Math.floor(
    (7 * player.stats.hull * (1 + (player.skills?.battling_hull_boost ?? 0) / 100)
      + (player.ship.shield_slot ? player.ship.shield_slot.value : 0)) * C
  );

  const cb = catalystBonuses;
  const precB = cb.precision ?? 0, evaB = cb.evasion ?? 0;
  const playerEvasion = player.stats.evasion
    * (1 + (player.skills?.battling_evasion_boost ?? 0) / 100) * C * (1 + evaB / 100);
  const playerPrecision = player.stats.precision
    * (1 + (player.skills?.battling_precision_boost ?? 0) / 100) * C * (1 + precB / 100);

  mob.hitChance = Math.ceil(mob.precision / (mob.precision + playerEvasion) * 100);
  mob.dodgeChance = Math.ceil(mob.evasion / (mob.evasion + playerPrecision) * 100);
  mob.alive = true;
  mob.maxHull = mob.hull;

  const defense = Math.min(cb.defense ?? 0, NPC.DefenseCap);
  const originalDmg = mob.damage;
  if (defense > 0) mob.damage = Math.max(1, Math.floor(mob.damage * (1 - defense / 100)));

  const armorPen = Math.min(cb.armor_penetration ?? 0, NPC.ArmorPenetrationCap);
  const effArmor = mob.armor * (1 - armorPen / 100);
  const dmgReduction = effArmor / (effArmor + NPC.ArmorScalingConstant);

  const stun = Math.min(cb.stun ?? 0, NPC.StunCap);
  const block = Math.min(NPC.BlockCapNpc, cb.block ?? 0);
  const dot = cb.dot ?? 0;
  const lifesteal = cb.lifesteal ?? 0;

  const npcName = npc ? npc.name.slice(0, -1) : "npc";
  const clones = player.clones.map(cl => ({
    name: cl.name,
    damage: playerDamage,
    hp: playerHull,
    maxHp: playerHull,
    hitChance: Math.ceil(playerPrecision / (playerPrecision + mob.evasion) * 100),
    dodgeChance: Math.ceil(playerEvasion / (playerEvasion + mob.precision) * 100),
    alive: true,
    critical_chance: cl.critical_chance,
    critical_damage: cl.critical_damage,
    dual_shot: cl.dual_shot,
  }));

  const roll = (chancePercent, rng) => rng() < chancePercent / 100;

  const cloneAttack = (cl, log) => {
    if (!roll(cl.hitChance, rng)) { if (log) log.push({ type: "miss" }); return; }
    const crit = roll(cl.critical_chance, rng);
    let d = crit
      ? Math.ceil(cl.damage * (1 + (NPC.ClonesBaseCriticalDamage + cl.critical_damage) / 100))
      : Math.ceil(cl.damage);
    d = Math.max(1, Math.floor(d * (1 - dmgReduction)));
    mob.hull -= d;
    if (log) log.push({ type: "hit", damage: d, crit });
    if (lifesteal > 0 && cl.hp < cl.maxHp) {
      const healCap = Math.floor(cl.maxHp * NPC.LifestealCap / 100);
      const heal = Math.min(Math.floor(d * lifesteal / 100), cl.maxHp - cl.hp, healCap);
      if (heal > 0) cl.hp += heal;
    }
  };

  let stunLeft = 0, dotLeft = 0;
  for (let round = 1; round < 100; round++) {
    let roundDmg = 0;
    if (stun > 0 && stunLeft === 0 && roll(stun, rng)) stunLeft = NPC.StunDuration;
    if (stunLeft > 0) {
      stunLeft--;
    } else {
      for (const cl of clones.filter(c => c.alive)) {
        if (roll(mob.hitChance, rng)) {
          if (block > 0 && roll(block, rng)) {
            // blocked, no damage
          } else {
            cl.hp -= mob.damage;
          }
        }
        if (cl.hp <= 0) { cl.hp = 0; cl.alive = false; }
      }
    }
    if (!clones.some(c => c.alive)) return "mob";

    roundDmg = 0;
    for (const cl of clones.filter(c => c.alive)) {
      const before = mob.hull;
      cloneAttack(cl, null);
      roundDmg += before - mob.hull;
      if (cl.dual_shot && roll(cl.dual_shot, rng)) {
        const b2 = mob.hull;
        cloneAttack(cl, null);
        roundDmg += b2 - mob.hull;
      }
    }
    if (dot > 0 && dotLeft === 0 && roll(dot, rng)) dotLeft = NPC.DotDuration;
    if (dotLeft > 0) {
      dotLeft--;
      const dotDmg = Math.floor(roundDmg * NPC.DotDamagePercent / 100);
      if (dotDmg > 0) mob.hull -= dotDmg;
    }
    if (mob.hull <= 0) { mob.hull = 0; mob.alive = false; return "player"; }
  }
  return "mob"; // timeout = loss
}

// Standard mulberry32 PRNG: returns a () => [0,1) generator for a 32-bit seed.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Simple 32-bit string hash (FNV-1a) used to derive a winrate() seed.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Winrate over N runs, on ONE seeded mulberry32 stream per call. The seed is
// derived from [npc.name, level, runs] (plus opts.seed, if given) -- not from
// player/catalyst details -- so identical (npc, level, runs) calls are fully
// reproducible, and different builds compared at the same level are compared
// under the same RNG stream (noise-free comparisons).
function winrate(player, opts, runs) {
  const seed = fnv1a(JSON.stringify([opts.npc && opts.npc.name, opts.level, runs, opts.seed ?? 0]));
  const rng = mulberry32(seed);
  let wins = 0;
  for (let i = 0; i < runs; i++) {
    if (simulateBattle(player, { ...opts, rng }) === "player") wins++;
  }
  return 100 * wins / runs;
}

// Find max level with >= threshold winrate. Binary search + refine.
function maxLevelAtWinrate(player, npc, catalystBonuses, opts = {}) {
  const {
    threshold = 98, runs = 400, confirmRuns = 1500,
    lo = 1, hi = 2000, ssBoost = 0,
  } = opts;
  const test = (lvl, r) => winrate(player, { npc, level: lvl, ssBoost, catalystBonuses }, r);

  let low = lo, high = hi, best = lo;
  while (low < high - 1) {
    const mid = Math.floor((low + high) / 2);
    if (test(mid, runs) >= threshold) { best = mid; low = mid; }
    else high = mid;
  }
  // Confirm with more runs; walk down if it was noise.
  let wr = test(best, confirmRuns);
  let guard = 0;
  while (wr < threshold && best > 1 && guard < 10) {
    best = Math.max(1, Math.floor(best * 0.95));
    wr = test(best, confirmRuns);
    guard++;
  }
  return { level: best, winrate: Math.round(wr * 10) / 10 };
}

module.exports = { NPC, NPC_TARGETS, simulateBattle, winrate, maxLevelAtWinrate, mulberry32 };