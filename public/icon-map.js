// Which SVG symbol the GUI draws for each kind of game thing. Two sprites
// hold them: public/icons.svg, which extract-icons.js copies out of the
// game's own 2.7 MB sprite in your local install, and public/icons-local.svg,
// the handful the advisor draws itself for things the game ships no artwork
// for. This file is the single list of WHICH symbols those are and which
// sprite each lives in, so the extractor and the page can never disagree --
// an id the page asks for but neither sprite has is a blank on screen, and
// check-page.js reports exactly that.
//
// Loaded twice, like pet-math.js: as window.IconMap by a <script> tag, and
// via require() by extract-icons.js and check-page.js.
//
// Catalyst and material icons are NOT listed here. Their ids are derived --
// catalyst_<stat> from lib/constants.js, materials from the material.*
// vocabulary in i18n.js -- and the extractor already builds them from those
// sources, which is what stops the list drifting as the game grows.
//
// Most entries below are the game's OWN choice, read out of its UI code:
//   ship parts   <use href="#${item.type}">        -> weapon, shield, ...
//   pets         <use href="#pet_${name}">         -> pet_cat, pet_korin
//   NPC factions <use href="#${name}_avatar">      -> brutes_avatar, ...
//   currencies   <use href="#credits">, #cosmic_dust, #quantum_cores, ...
//   clone count  <use href="#Clones">
// The exceptions are marked OURS: the six activity tabs and the technology
// skills, which the game labels with words only, so the pick is editorial;
// and advisor_droid, which is not the game's artwork at all -- see LOCAL_IDS.

// Gear/ship slots. The game keys the slot "weapon_slot" and the icon
// "weapon" -- the same word without the suffix, for all six.
const SLOT_ICONS = {
  weapon_slot: "weapon", shield_slot: "shield", engine_slot: "engine",
  sensors_slot: "sensors", laser_slot: "laser", probes_slot: "probes",
};

// OURS. The game prints "Default / Exploring / Crafting / Galaxy Boss /
// Voyager / Dungeons" as plain tab labels, so these are our picks from its
// sprite: the sidebar glyph for the three that have one, the galaxy and
// portal glyphs the Voyager page uses for its own galaxy/portal counters.
const ACTIVITY_ICONS = {
  default: "sidebar_stats",
  exploring: "sidebar_exploring",
  crafting: "sidebar_crafting",
  galaxyboss: "exploring_galaxy",
  dungeons: "sidebar_dungeon",
  voyager: "portal",
};

// The four skills an item or a planet can be matched to.
const SKILL_ICONS = {
  battling: "sidebar_battling", gathering: "sidebar_gathering",
  exploring: "sidebar_exploring", crafting: "sidebar_crafting",
};

// Planet/body types. The game spells the id without the space.
const BODY_ICONS = {
  "Rocky Planet": "RockyPlanet", "Icy Planet": "IcyPlanet",
  "Gas Planet": "GasPlanet", "Crystal Planet": "CrystalPlanet",
  Asteroid: "Asteroid", Comet: "Comet", Nebula: "Nebula", Belt: "Belt",
};

const NPCS = ["brutes", "spectres", "glacials", "machiners",
  "scorchers", "toxoids", "miners", "dusters"];

// Pet bodies, plus Korin -- a named pet the game ships its own icon for.
const PETS = ["Cat", "Dog", "Dragon", "Owl", "Drone", "Humanoid",
  "Quadruped", "Roller", "Korin", "Selyn", "Velari", "Darnex"];

// OURS. Technology skills are a list of words in the game's tech tree; these
// map each one onto the glyph of the thing it boosts, so the Technology tab
// reads at a glance. The four battling stat glyphs (stat-power for weapon,
// stat-hull, stat-precision, stat-evasion) are the ones the game's own
// player page uses for those same four stats.
const TECH_ICONS = {
  battling_weapon_boost: "stat-power",
  battling_hull_boost: "stat-hull",
  battling_precision_boost: "stat-precision",
  battling_evasion_boost: "stat-evasion",
  battling_base_xp_boost: "sidebar_battling",
  gathering_base_xp_boost: "sidebar_gathering",
  gathering_rare_base_drop: "inverntory_gathering_resources",
  gathering_common_base_drop: "inverntory_gathering_resources",
  exploring_cosmic_dust_boost: "cosmic_dust",
  crafting_base_xp_boost: "sidebar_crafting",
  pets_base_xp_boost: "pet_food",
  voyager_reward_boost: "portal",
  gb_damage_boost: "gb_damage",
  gb_defense_boost: "gb_defense",
  gb_reward_boost: "gb_reward_weight",
  base_module_efficiency_boost: "sidebar_base",
  dungeon_battle_boost: "sidebar_dungeon",
  dungeon_gather_boost: "sidebar_dungeon",
  dungeon_craft_boost: "sidebar_dungeon",
  dungeon_explore_boost: "sidebar_dungeon",
  dungeon_reward_boost: "rewardChest",
};

// Currencies and counters the advisor puts on summary cards. Keyed by what
// the advisor calls them, not by the sprite id, so a card asks for what it
// shows.
const RESOURCE_ICONS = {
  credits: "credits",
  dust: "cosmic_dust",
  quantum_cores: "quantum_cores",
  catalyst_parts: "inverntory_catalyst",
  stellarium: "stellarium",
  fuel: "fuel",
  pet_food: "pet_food",
  clones: "Clones",
  // The game ships no droid artwork -- no sprite symbol, no asset in the
  // archive -- and Droids sitting blank beside an iconned Clones was the one
  // hole this map could not fill from the game. advisor_droid is ours, drawn
  // from the Clones palette in public/icons-local.svg. See LOCAL_IDS below.
  droids: "advisor_droid",
  warp_capsule: "warp_capsule",
  crafting_level: "sidebar_crafting",
  base: "sidebar_base",
};

// Ids the advisor draws itself, in public/icons-local.svg, rather than
// copying out of the game's sprite. They ship with the repo -- they are our
// artwork, not the game's -- so extract-icons.js must not go looking for
// them and check-page.js must check them against the right file.
const LOCAL_IDS = new Set(["advisor_droid"]);

const lookup = (map, key) => (key && Object.prototype.hasOwnProperty.call(map, key)) ? map[key] : null;

const IconMap = {
  SLOT_ICONS, ACTIVITY_ICONS, SKILL_ICONS, BODY_ICONS, TECH_ICONS,
  RESOURCE_ICONS, NPCS, PETS,
  slot: (s) => lookup(SLOT_ICONS, s),
  activity: (a) => lookup(ACTIVITY_ICONS, a),
  skill: (s) => lookup(SKILL_ICONS, s),
  body: (b) => lookup(BODY_ICONS, b),
  tech: (k) => lookup(TECH_ICONS, k),
  res: (k) => lookup(RESOURCE_ICONS, k),
  // The game's own spellings: "#brutes_avatar", "#pet_cat".
  npc: (n) => (n ? String(n).toLowerCase() + "_avatar" : null),
  pet: (n) => (n ? "pet_" + String(n).toLowerCase() : null),
  LOCAL_IDS,
  // Every id the GUI can ask for, from both files.
  ids() {
    const out = new Set();
    for (const map of [SLOT_ICONS, ACTIVITY_ICONS, SKILL_ICONS, BODY_ICONS, TECH_ICONS, RESOURCE_ICONS]) {
      for (const id of Object.values(map)) out.add(id);
    }
    for (const n of NPCS) out.add(IconMap.npc(n));
    for (const p of PETS) out.add(IconMap.pet(p));
    return [...out];
  },
  // The split the two files need: extract-icons.js copies gameIds() out of
  // the game sprite, localIds() are already in the repo.
  gameIds: () => IconMap.ids().filter(id => !LOCAL_IDS.has(id)),
  localIds: () => IconMap.ids().filter(id => LOCAL_IDS.has(id)),
};

if (typeof module !== "undefined" && module.exports) module.exports = IconMap;
if (typeof window !== "undefined") window.IconMap = IconMap;
