// Materials advisor: blueprint material requirements vs stock, with NPC
// farming guidance for drop-only materials.
//
// "To use all my blueprints" math weights each blueprint's per-craft cost by
// (quantity * charges) — quantity copies owned, each good for `charges` uses.
// The unweighted per-craft sum (one craft of each blueprint) is also kept so
// both views are available.

// NPC drop table (constant, from the game's drop tables): material -> where
// it farms. Per-kill drop amounts are server-side and not modeled here — we
// only report stock vs need, never invented kill counts.
const NPC_MATERIAL_SOURCES = {
  "bones": { npc: "brutes", location: "Belt" },
  "ectoplasm": { npc: "spectres", location: "Nebula" },
  "frost shard": { npc: "glacials", location: "Icy Planet" },
  "cog": { npc: "machiners", location: "Asteroid" },
  "flame": { npc: "scorchers", location: "Gas Planet" },
  "slime": { npc: "toxoids", location: "Crystal Planet" },
  "horn": { npc: "miners", location: "Rocky Planet" },
  "condensed sand": { npc: "dusters", location: "Comet" },
};

// Materials produced in the laboratory/base rather than farmed from NPCs.
const LAB_MATERIALS = new Set([
  "metal scrap", "unstable fuel", "warp capsule", "fuel cell casing", "ingots",
  "refined crystals", "high end crystals", "nanoconductors", "propulsors",
  "microcircuits", "fusion cells",
]);

function sourceOf(material) {
  if (NPC_MATERIAL_SOURCES[material]) return "npc";
  if (LAB_MATERIALS.has(material)) return "laboratory";
  return "other";
}

function planMaterials(state) {
  const blueprints = state.blueprints || [];
  const stockByName = new Map();
  for (const m of (state.materials || [])) {
    if (m && m.name) stockByName.set(m.name, m.quantity || 0);
  }

  const perCraft = new Map(); // material -> sum of amount, one craft per blueprint
  const allUses = new Map();  // material -> sum of amount * quantity * charges
  let scrapsNeededAllUses = 0;
  const currencyNeeded = {};  // currency -> amount, weighted by quantity*charges
  let blueprintsIncluded = 0;

  for (const b of blueprints) {
    if (!(b.material_use && b.material_use.length)) continue;
    const qty = b.quantity || 0;
    const charges = b.charges || 1;
    const uses = qty * charges;
    blueprintsIncluded++;
    for (const mu of b.material_use) {
      const name = mu.material;
      const amt = mu.amount || 0;
      perCraft.set(name, (perCraft.get(name) || 0) + amt);
      allUses.set(name, (allUses.get(name) || 0) + amt * uses);
    }
    if (b.scraps_use) scrapsNeededAllUses += b.scraps_use * uses;
    for (const cu of (b.currency_use || [])) {
      currencyNeeded[cu.normalCurrency] = (currencyNeeded[cu.normalCurrency] || 0) + cu.amount * uses;
    }
  }

  // Every material that shows up in a blueprint OR is farmable from an NPC.
  const names = new Set([...perCraft.keys(), ...Object.keys(NPC_MATERIAL_SOURCES)]);

  const npcDrops = [], labMaterials = [], other = [];
  let deficitCount = 0;
  for (const material of names) {
    const stock = stockByName.get(material) || 0;
    const neededPerCraftAll = perCraft.get(material) || 0;
    const neededAllUses = allUses.get(material) || 0;
    const deficit = Math.max(0, neededAllUses - stock);
    if (deficit > 0) deficitCount++;
    const source = sourceOf(material);
    const entry = { material, stock, neededPerCraftAll, neededAllUses, deficit, source };
    if (source === "npc") {
      const info = NPC_MATERIAL_SOURCES[material];
      entry.npc = info.npc;
      entry.location = info.location;
      npcDrops.push(entry);
    } else if (source === "laboratory") {
      labMaterials.push(entry);
    } else {
      other.push(entry);
    }
  }

  const sortByDeficit = (a, b) => b.deficit - a.deficit || a.material.localeCompare(b.material);
  npcDrops.sort(sortByDeficit);
  labMaterials.sort(sortByDeficit);
  other.sort(sortByDeficit);

  return {
    npcDrops, labMaterials, other,
    totals: { deficitCount, scrapsNeededAllUses, currencyNeeded, blueprintsIncluded },
  };
}

module.exports = { planMaterials, NPC_MATERIAL_SOURCES, LAB_MATERIALS };
