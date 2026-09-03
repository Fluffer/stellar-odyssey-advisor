// Stellar Odyssey catalyst & gear advisor (CLI).
// Read-only analysis of gear, catalysts, installs and merges.
// All shared logic lives in advisor-core.js.
//
// Usage: node advisor.js

const core = require("./advisor-core.js");

function printPlan(list) {
  if (!list.length) {
    console.log("  No improving installs or replacements found with current inventory.");
    return;
  }
  list.forEach(a => {
    const loc = `[${a.item} / ${a.activity}]`;
    let battle = "";
    if (a.npcDeltas) {
      const deltas = Object.keys(a.npcDeltas)
        .map(npc => `${npc}:${a.npcDeltas[npc] >= 0 ? "+" : ""}${a.npcDeltas[npc]}`)
        .join(" ");
      battle = ` | battle ${deltas}`;
    }
    if (a.action === "install") {
      console.log(`  ${a.n}. ${loc} INSTALL ${a.add.text} => +${a.gainText}${battle}`);
    } else {
      console.log(`  ${a.n}. ${loc} REPLACE ${a.remove.text} WITH ${a.add.text} => +${a.gainText}${battle}`);
    }
  });
}

function fmtC(n) {
  if (n === null || n === undefined) return "?";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(Math.round(n));
}

const SKILL_LABELS = {
  efficiency: "Efficiency", storage: "Storage", maneuverability: "Maneuverability",
  critical_chance: "Critical chance", critical_damage: "Critical damage", dual_shot: "Dual shot",
};

function printUnits(u) {
  const c = u.clones, dr = u.droids, cd = c.damage;
  const nextTxt = (p) => (p !== null ? fmtC(p) : "unknown - open the trainer page in-game");
  console.log("\n=== DROIDS & CLONES ===");
  console.log(`  Credits: ${fmtC(u.credits)} | Droids: ${dr.count} (next: ${nextTxt(dr.nextPrice)}) | Clones: ${c.count} (next: ${nextTxt(c.nextPrice)})`);
  console.log("  Upgrade cost: 5000 x level x e^(0.15xlevel) credits per +0.1% step, per unit, per skill. New units start at 0%.");
  console.log("\n  Recommendation:");
  if (c.nextPrice !== null && cd.perPctUpgradeCost && cd.perPctBuyCost) {
    const ratio = cd.perPctBuyCost / cd.perPctUpgradeCost;
    console.log(`    Clones: skill upgrades currently give damage at ${fmtC(cd.perPctUpgradeCost)} per +1%, buying the ${c.count + 1}th clone (incl. catch-up) at ${fmtC(cd.perPctBuyCost)} per +1% — upgrades are ${ratio.toFixed(1)}x more efficient. Raise dual shot first (highest damage per credit), then critical chance, then critical damage.`);
    if (c.damageBreakEvenLevel !== null) {
      const anyway = c.nextPrice > u.credits ? ` (the ${c.count + 1}th clone costs ${fmtC(c.nextPrice)} anyway)` : "";
      console.log(`    Clone break-even: ${c.damageBreakEvenLevel}% — above this level an extra clone would give more damage per credit. You are at ${c.rows[0].level}%, so keep upgrading${anyway}.`);
    }
  } else {
    console.log("    Clone prices unknown — open the Battling trainer page in-game once so the advisor can capture them.");
  }
  if (dr.nextPrice !== null && dr.breakEvenLevel !== null) {
    console.log(`    Droids: upgrade until ${dr.breakEvenLevel}% (you are at ${dr.rows[0].level}%) before the ${dr.count + 1}th droid (${fmtC(dr.nextPrice)} + ${fmtC(dr.catchUpCost)} catch-up) becomes better value per skill point.`);
  } else if (dr.nextPrice === null) {
    console.log("    Droid prices unknown — open the Gathering trainer page in-game once.");
  }
  console.log("\n  Clone damage impact:");
  console.log(`    Total multiplier: ${cd.totalMultiplier.toFixed(3)} | +1% all skills: +${cd.plusOnePctAll}% dmg | ${c.count + 1}th clone at 0%: +${cd.eighthAtZero}% dmg | ${c.count + 1}th clone at parity: +${cd.eighthAtParity}% dmg`);
  const table = (title, sub, rows, count, withDamage) => {
    console.log(`\n  ${title} (${count}) — ${sub}`);
    for (const r of rows) {
      const uneven = r.uneven ? " (units differ)" : "";
      const dmg = withDamage && r.marginalDamage !== null ? ` | +${r.marginalDamage} dmg mult/+0.1%` : "";
      console.log(`    ${SKILL_LABELS[r.skill] || r.skill}: level ${r.level}%${uneven} | +0.1% all: ${fmtC(r.costStepAll)} | +1% all: ${fmtC(r.costPlusOneAll)} | affordable: +${(r.affordableStepsAll / 10).toFixed(1)}%${dmg}`);
    }
  };
  table("Clone skills", "per-skill upgrade costs across all clones (apply-to-all)", c.rows, c.count, true);
  table("Droid skills", "per-skill upgrade costs across all droids (apply-to-all)", dr.rows, dr.count, false);
  const list = (title, units, skills) => {
    console.log(`\n  ${title}`);
    for (const un of units) {
      console.log(`    ${un.name}: ${skills.map(s => `${SKILL_LABELS[s] || s} ${un[s]}%`).join(" | ")}`);
    }
  };
  list("Your clones", c.list, ["critical_chance", "critical_damage", "dual_shot"]);
  list("Your droids", dr.list, ["efficiency", "storage", "maneuverability"]);
}

async function main() {
  const s = await core.readGameState();
  const d = core.analyze(s);
  const p = d.player;

  console.log("\n=== PLAYER ===");
  console.log(`Crafting level: ${p.craftLevel} (XP ${p.currentXp}/${p.targetXp})`);
  console.log(`Merge range bonus: +${p.rangeBonus} | Merge success bonus: +${p.successBonus.toFixed(1)}%`);
  console.log(`Cosmic dust: ${p.dust.toLocaleString()}  Catalyst parts: ${p.parts}`);
  console.log(`Catalysts: ${p.totalCatalysts} total | ${p.installedCount} installed | ${p.unequippedCount} unequipped`);

  console.log("\n=== EQUIPPED GEAR (activity groups of 4) ===");
  for (const it of d.gear) {
    if (it.empty) { console.log(`\n${it.slot} (${it.category}): (empty)`); continue; }
    console.log(`\n${it.slot} (${it.category}): ${it.name} (lvl ${it.level}, ${it.rarity})`);
    for (const g of it.groups) {
      const tag = g.filled === 0 ? " (empty)" : "";
      console.log(`  [${g.activity}] ${g.filled}/${g.slots}${tag}`);
      for (const c of g.catalysts) {
        const dup = c.sameCount > 1 ? ` (x${c.sameCount} in group)` : "";
        const h = c.halved ? " (halved)" : "";
        console.log(`    - ${c.rarity} ${c.stat} ${c.range}%${h}  => eff ${c.effText}${dup}`);
      }
      if (g.filled < g.slots && g.poolCount > 0) {
        console.log(`    (inventory has ${g.poolCount} matching ${g.activity} ${it.category} catalysts)`);
      }
    }
  }

  if (d.warnings.length) {
    console.log("\n=== CAP WARNINGS ===");
    d.warnings.forEach(w => console.log(`  ! ${w.stat} (${w.ctx}) total ${w.totalText} exceeds cap ${w.capText} — wasted ${w.wastedText}`));
  } else {
    console.log("\n=== CAP WARNINGS: none ===");
  }

  if (d.battleBase) {
    console.log("\n=== CURRENT BATTLE BENCHMARK (max NPC level @ >=98% winrate) ===");
    console.log("  " + Object.entries(d.battleBase).map(([npc, lvl]) => `${npc}: ${lvl}`).join("  "));
  }

  console.log("\n=== INSTALL / REPLACE PLAN — VARIANT A: FULL EXPLORE ===");
  console.log("  (engine/sensors voyager tab left empty -> voyager inherits default bonuses)");
  printPlan(d.installs);
  if (d.freedTexts.length) {
    console.log(`  Freed back to inventory: ${d.freedTexts.join(", ")}`);
    console.log(`  (only merge these after applying the replacements above)`);
  }
  console.log("\n=== INSTALL / REPLACE PLAN — VARIANT: FULL RESOURCES ===");
  printPlan(d.installsResources);

  if (d.projection) {
    console.log("\n=== PROJECTED AFTER FULL PLAN ===");
    for (const npc of Object.keys(d.projection.npcLevels)) {
      const base = d.battleBase[npc];
      const proj = d.projection.npcLevels[npc];
      const delta = d.projection.deltas[npc];
      console.log(`  ${npc}: ${base} -> ${proj} (${delta >= 0 ? "+" : ""}${delta})`);
    }
    console.log(`  avg: ${d.projection.avgDelta >= 0 ? "+" : ""}${d.projection.avgDelta}`);
  }

  console.log("\n=== MERGE PLAN (per stat + activity, only perfect-legendary paths) ===");
  console.log(`  Crafting lvl ${p.craftLevel} -> merge bonus +${p.rangeBonus} | success bonus +${p.successBonus.toFixed(1)}%`);
  console.log("  Tier requirements (to stay on the perfect-legendary path):");
  d.mergeRequirements.forEach(m => console.log(`    ${m.rarity}: result >= ${m.resultNeeded} (inputs avg >= ${m.inputAvgNeeded})`));
  if (!d.mergePlans.length) {
    console.log("  No merges possible (need 5 of the same stat + rarity + activity).");
  }
  for (const pl of d.mergePlans) {
    console.log(`\n  ${pl.stat} (${pl.activity})${pl.chainGoal ? ` -> goal: ${pl.chainGoal}` : ""}:`);
    for (const step of pl.steps) {
      const sameTier = step.from === step.to ? " (range perfection)" : "";
      const prot = step.recommendProtect ? "PROTECT recommended" : "no protection needed";
      console.log(`    ${step.from} -> ${step.to}${sameTier} | ${step.chance}% success | ${step.qcPerMerge} quantum cores/merge (+${step.qcProtectPerMerge} protect) | ${prot}`);
      step.groups.forEach(g => {
        const perfect = step.to === "legendary" && g.result >= 100 ? "  *** PERFECT LEGENDARY ***" : "";
        console.log(`      merge [${g.inputs.join(", ")}] => ${step.to} ${g.result}${perfect}`);
        if (g.pulled && g.pulled.length) {
          g.pulled.forEach(pu => {
            console.log(`        >>> TAKE ${pu.text} OUT OF ${pu.item} (${pu.activity} tab) first - reinstall result there (${pu.reinstallText} eff)`);
          });
        }
      });
    }
    if (pl.projectedLegendaries.length) {
      console.log(`    => projected legendaries: ${pl.projectedLegendaries.join(", ")} (${pl.perfectCount} perfect)`);
    }
  }

  printUnits(d.units);
  printTech(d.tech);
  printPets(d.pets);
  printMaterials(d.materials);
  printShipItems(d.shipItems);

  console.log("\n=== INVENTORY ===");
  const inv = d.inventory;
  console.log(`  total ${inv.counts.total} | planned installs ${inv.counts.planned} | merge fodder ${inv.counts.mergeFodder} | sell candidates ${inv.counts.sellCandidates}`);
  const sellList = inv.items.filter(i => i.sellCandidate);
  sellList.slice(0, 15).forEach(i => {
    console.log(`  ${i.stat} ${i.rarity} ${i.range}% (${i.activity}) — ${i.sellReason}`);
  });
  if (sellList.length > 15) console.log(`  ... and ${sellList.length - 15} more`);
}

function fmtH(h) {
  if (h === null || h === undefined) return "-";
  if (h === Infinity) return "never";
  if (h < 48) return h + "h";
  return Math.floor(h / 24) + "d " + (h % 24) + "h";
}

function printPets(p) {
  if (!p) return;
  console.log("\n=== PETS ===");
  console.log(`  Pet XP tech: ${p.techSkill}${p.techSkill >= 100 ? " (MAX)" : ""} | premium: ${p.premiumActive ? "active (+10% XP)" : "inactive"} | pet food: ${p.petFood.toLocaleString()} (burn ${p.petFoodPerDay}/day = ${p.petFoodDays !== null ? p.petFoodDays + "d" : "-"})`);
  console.log("  XP/h = ceil((5+boost) * (1+tech/100) * (1+level/10) * (1+premium/100) * food/100)");
  console.log("  Food: -5%/h while equipped (floor 50%); auto-feed refills to 100% below slot threshold. Unequipped: frozen, no XP.");
  console.log("  Boost upgrade cost = 7.5m * 1.5^(b-1) of the SAME amount of EVERY one of the 16 common resources.");
  for (const pet of p.pets) {
    const eq = pet.equipped ? `${pet.slotType} slot` : "UNEQUIPPED (no XP)";
    console.log(`\n  ${pet.name} [${pet.type}] - ${eq}`);
    console.log(`    lvl ${pet.level}  xp ${pet.currentXp}/${pet.targetXp}  boost ${pet.boost}  food ${pet.food}%${pet.equipped ? ` (avg ${pet.avgFood}%, auto-feed @ ${pet.autofeedLimit}%)` : ""}`);
    if (pet.equipped) {
      console.log(`    now: ${pet.xpPerHourNow} xp/h -> next level in ${fmtH(pet.hoursToLevel)}`);
      const scarcest = p.scarcest ? `; scarcest ${p.scarcest.name}: ${fmtC(p.scarcest.amount)}` : "";
      console.log(`    +1 boost (${fmtC(pet.costNextBoost)} of each of 16 resources${scarcest}): ${fmtH(pet.hoursToLevelPlusOne)} (saves ${pet.hoursSavedPlusOne}h)`);
    }
  }
  if (p.korin) {
    const k = p.korin;
    console.log(`\n  Korin (lvl ${k.level}) - warp capsule enhancement:`);
    console.log(`    cost/capsule: ${fmtC(k.dustCostPerCapsule)} dust | stock: ${k.capsules} normal / ${k.enhancedCapsules} enhanced | affordable now: ${k.affordableNow}`);
    console.log(`    fuel/enhanced: ${k.fuelPerEnhanced !== null ? k.fuelPerEnhanced : "?"} (${k.fuelMultiplier.toFixed(1)}x max) | engine cooldown -${k.cooldownReductionPct}%`);
    console.log(`    next level: cost ${fmtC(k.nextLevel.dustCostPerCapsule)}/capsule, ${k.nextLevel.fuelMultiplier.toFixed(1)}x fuel`);
  }
}

function printMaterials(m) {
  if (!m) return;
  console.log("\n=== MATERIALS (for all blueprint uses) ===");
  const all = [...m.npcDrops, ...m.labMaterials, ...m.other]
    .filter(x => x.deficit > 0)
    .sort((a, b) => b.deficit - a.deficit);
  if (!all.length) {
    console.log("  No material deficits across all blueprint uses.");
  } else {
    for (const x of all) {
      const farm = x.source === "npc" ? `farm ${x.npc} (${x.location})` : x.source;
      console.log(`  ${x.material}: need ${x.neededAllUses}, have ${x.stock}, short ${x.deficit} — ${farm}`);
    }
  }
  console.log(`  Scraps needed (all uses): ${fmtC(m.totals.scrapsNeededAllUses)} | blueprints included: ${m.totals.blueprintsIncluded}`);
}

const SHIP_SLOT_LABELS = {
  weapon_slot: "Weapon", shield_slot: "Shield", engine_slot: "Engine",
  sensors_slot: "Sensors", laser_slot: "Laser", probes_slot: "Probes",
};

function printShipItems(si) {
  if (!si) return;
  console.log("\n=== SHIP ITEMS ===");
  for (const it of si.items) {
    const label = SHIP_SLOT_LABELS[it.slot] || it.slot;
    const tags = [it.enhanced ? "enhanced" : null, it.anomaly ? "anomaly" : null].filter(Boolean).join(", ");
    console.log(`  ${label}: ${it.name} lvl ${it.level} ${it.rarity}${tags ? ` (${tags})` : ""}`);
    console.log(`    ${it.matchingSkill} skill lvl ${it.skillLevel} | behind ${it.levelsBehind} | value ${it.value}/${it.valueMaxForLevel} (${it.valuePctOfMax}%) | mods: ${it.bonuses.join(", ") || "none"}`);
    it.recommendations.forEach(r => console.log(`    -> ${r}`));
  }
  const c = si.cooldown;
  console.log(`  Engine cooldown: d=${c.d} (engine ${c.componentBreakdown.engineValue}/100 + mods ${c.componentBreakdown.mods} + Korin ${c.componentBreakdown.korin})`);
  console.log(`    @10ly: ${c.at10ly.seconds}s${c.at10ly.floored ? " (floor)" : ""} | @50ly: ${c.at50ly.seconds}s${c.at50ly.floored ? " (floor)" : ""} | @100ly: ${c.at100ly.seconds}s${c.at100ly.floored ? " (floor)" : ""}`);
  console.log(`    floor breakpoint @10ly: d >= ${c.breakpointD10ly} — ${c.withCooldownModAt10ly ? "a +10 cooldown mod would still help at 10 ly" : "cooldown is already floored at 10 ly; cooldown mods are wasted there"}`);
  const s = si.scan;
  console.log(`  Scan reward multiplier: x${s.multiplier.toFixed(4)} (sensors +${(s.sensorsComponent * 100).toFixed(2)}% + mods +${(s.modComponent * 100).toFixed(2)}%)`);
}

function printTech(t) {
  if (!t) return;
  console.log("\n=== TECHNOLOGY (SKILLS) ===");
  console.log(`  Quantum cores: ${t.quantumCores} | upgrade cost: L -> L+1 costs 2*(L+1) cores | cap 100`);
  if (t.battle && t.battle.rows.length) {
    console.log(`  Combat skill ranking (simulated, baseline avg max NPC level ${t.battle.baselineAvg}):`);
    t.battle.rows.forEach(r =>
      console.log(`    ${r.key.padEnd(26)} L=${String(r.level).padStart(3)}  next=${String(r.cost).padStart(3)} QC  +${r.avgDelta} avg lvls  (${r.levelsPerCore} lvls/core)`));
  }
  if (t.allocation.length) {
    console.log(`  Optimal spend of ${t.quantumCores} QC:`);
    t.allocation.forEach(a => console.log(`    ${a.key}: ${a.from} -> ${a.to}  (${a.cost} QC)`));
    console.log(`    leftover: ${t.leftoverCores} QC`);
  } else if (t.battle && t.battle.rows.length) {
    const best = t.battle.rows[0];
    console.log(`  Not enough cores for a combat skill (best pick ${best.key} costs ${best.cost} QC) - keep saving.`);
  }
  const cats = {};
  for (const s of t.skills) (cats[s.category] = cats[s.category] || []).push(s);
  for (const [cat, list] of Object.entries(cats)) {
    console.log(`  [${cat}]`);
    for (const s of list) {
      const status = s.locked ? "locked (Steam)" : s.maxed ? "MAX" : `next=${s.costNext} QC${s.affordable ? " <=affordable" : ""}`;
      console.log(`    ${s.key.padEnd(30)} L=${String(s.level).padStart(3)}  ${status}`);
    }
  }
}

main().catch((e) => {
  console.error("[advisor] fatal:", e.message);
  process.exit(1);
});