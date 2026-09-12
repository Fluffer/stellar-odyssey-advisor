// Materials advisor: blueprint material requirements vs stock, with NPC
// farming guidance for drop-only materials.
//
// Need is "to use up all my blueprints": each blueprint's per-craft cost is
// weighted by (quantity * charges) — quantity copies owned, each good for
// `charges` uses. That is the only number a farmer cares about, so it is the
// only one reported.

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
  "microcircuits", "fusion cells", "enhanced warp capsule",
]);

function sourceOf(material) {
  if (NPC_MATERIAL_SOURCES[material]) return "npc";
  if (LAB_MATERIALS.has(material)) return "laboratory";
  return "other";
}

function planMaterials(state) {
  const blueprints = state.blueprints || [];
  const stockByName = new Map();
  // The store has been an array so far, but a non-array shape here used to
  // throw "object is not iterable" and take the whole analysis down.
  for (const m of (Array.isArray(state.materials) ? state.materials : [])) {
    if (m && m.name) stockByName.set(m.name, m.quantity || 0);
  }

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
      allUses.set(name, (allUses.get(name) || 0) + amt * uses);
    }
    if (b.scraps_use) scrapsNeededAllUses += b.scraps_use * uses;
    for (const cu of (b.currency_use || [])) {
      currencyNeeded[cu.normalCurrency] = (currencyNeeded[cu.normalCurrency] || 0) + cu.amount * uses;
    }
  }

  // Every material that shows up in a blueprint, is farmable from an NPC, or
  // is actually in stock. Without the last one, lab output and gathered
  // materials that no blueprint consumes never appeared, and the
  // laboratory/other tables sat empty while the player held thousands.
  // Zero-stock, zero-need names (base-tier products before a base exists)
  // are left out as noise.
  const names = new Set([...allUses.keys(), ...Object.keys(NPC_MATERIAL_SOURCES)]);
  for (const [name, qty] of stockByName) if (qty > 0) names.add(name);

  const npcDrops = [], labMaterials = [], other = [];
  let deficitCount = 0;

  // Gathered resources (the 16 common currencies and the 4 rare ones) live
  // in their own store, not in the materials list, and blueprints charge
  // them through currency_use rather than material_use. Same stock / need /
  // deficit shape as the material rows. Absent when nothing was captured.
  const gathered = [];
  const norm = (k) => String(k).toLowerCase().replace(/_/g, " ");
  const needByCurrency = {};
  for (const [k, v] of Object.entries(currencyNeeded)) needByCurrency[norm(k)] = v;
  for (const src of [state.commonResources, state.rareCurrencies]) {
    if (!src || typeof src !== "object") continue;
    for (const [k, v] of Object.entries(src)) {
      const material = norm(k);
      const stock = Number(v) || 0;
      const neededAllUses = needByCurrency[material] || 0;
      const deficit = Math.max(0, neededAllUses - stock);
      if (deficit > 0) deficitCount++;
      gathered.push({ material, stock, neededAllUses, deficit, source: "gathered" });
    }
  }
  for (const material of names) {
    const stock = stockByName.get(material) || 0;
    const neededAllUses = allUses.get(material) || 0;
    const deficit = Math.max(0, neededAllUses - stock);
    if (deficit > 0) deficitCount++;
    const source = sourceOf(material);
    const entry = { material, stock, neededAllUses, deficit, source };
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
  gathered.sort(sortByDeficit);

  return {
    npcDrops, labMaterials, gathered, other,
    totals: { deficitCount, scrapsNeededAllUses, currencyNeeded, blueprintsIncluded },
  };
}

module.exports = { planMaterials, NPC_MATERIAL_SOURCES, LAB_MATERIALS };
