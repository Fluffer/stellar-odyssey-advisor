// check-page.js — sanity check for the GUI files in public/.
// Syntax-checks the browser scripts and verifies index.html wires them up.
// Useful after editing the GUI code. Exit code 0 = all good.
//
// Usage: node check-page.js

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const PUBLIC_DIR = path.join(__dirname, "public");
let failed = false;

function fail(msg) {
  console.error("  FAIL: " + msg);
  failed = true;
}

// 1. Syntax-check every script the page loads.
for (const f of ["app.js", "i18n.js", "icon-map.js", "pet-math.js", "lab-math.js", "base-math.js", "unit-math.js"]) {
  const file = path.join(PUBLIC_DIR, f);
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    console.log("  ok: " + f + " parses");
  } catch (e) {
    fail(f + " has a syntax error:\n" + e.stderr.toString());
  }
}

// 2. pet-math.js must load as a CommonJS module too (shared with the engine).
try {
  const pm = require(path.join(PUBLIC_DIR, "pet-math.js"));
  if (typeof pm.petXpTarget !== "function") throw new Error("petXpTarget missing");
  console.log("  ok: pet-math.js loads as a module");
} catch (e) {
  fail("pet-math.js does not load: " + e.message);
}

try {
  const lm = require(path.join(PUBLIC_DIR, "lab-math.js"));
  if (typeof lm.planTarget !== "function") throw new Error("planTarget missing");
  console.log("  ok: lab-math.js loads as a module");
} catch (e) {
  fail("lab-math.js does not load: " + e.message);
}

try {
  const bm = require(path.join(PUBLIC_DIR, "base-math.js"));
  if (typeof bm.planBase !== "function") throw new Error("planBase missing");
  console.log("  ok: base-math.js loads as a module");
} catch (e) {
  fail("base-math.js does not load: " + e.message);
}

try {
  const um = require(path.join(PUBLIC_DIR, "unit-math.js"));
  if (typeof um.emulateGroup !== "function") throw new Error("emulateGroup missing");
  console.log("  ok: unit-math.js loads as a module");
} catch (e) {
  fail("unit-math.js does not load: " + e.message);
}

let ICON_MAP = null;
try {
  ICON_MAP = require(path.join(PUBLIC_DIR, "icon-map.js"));
  if (typeof ICON_MAP.ids !== "function") throw new Error("ids missing");
  console.log("  ok: icon-map.js loads as a module (" + ICON_MAP.ids().length + " declared icons)");
} catch (e) {
  fail("icon-map.js does not load: " + e.message);
}

let I18N = null;
try {
  I18N = require(path.join(PUBLIC_DIR, "i18n.js"));
  if (typeof I18N.t !== "function") throw new Error("t missing");
  console.log("  ok: i18n.js loads as a module");
} catch (e) {
  fail("i18n.js does not load: " + e.message);
}

// 2b. The page loads every script as a classic <script>, so they all share
// ONE global scope: a top-level `function levelCost` in two files is not two
// functions but one overwriting the other, at call time, with no error.
// (base-math's module-level curve once replaced lab-math's 1.15M x level
// this way and the Lab tab's ROI costs were silently wrong.) The shared
// math files are wrapped in a function for that reason; this fails if a
// top-level name is ever declared in more than one script.
{
  const DECL = /^(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
  const SHARED = ["pet-math.js", "lab-math.js", "base-math.js", "unit-math.js"];
  const wrapped = SHARED.filter(f => !/^\(function \(\) \{$/m.test(fs.readFileSync(path.join(PUBLIC_DIR, f), "utf8")));
  // A wrapped file's column-0 declarations sit inside its function, so only
  // the scripts that really run at top level are scanned for collisions.
  const owner = {};
  const dupes = [];
  for (const f of ["i18n.js", "icon-map.js", "app.js"].concat(wrapped)) {
    const src = fs.readFileSync(path.join(PUBLIC_DIR, f), "utf8");
    for (const m of src.matchAll(DECL)) {
      if (owner[m[1]] && owner[m[1]] !== f) dupes.push(m[1] + " (" + owner[m[1]] + " and " + f + ")");
      owner[m[1]] = owner[m[1]] || f;
    }
  }
  if (dupes.length) fail("top-level names declared by more than one GUI script (they overwrite each other in the browser): " + dupes.join(", "));
  else console.log("  ok: no top-level name is declared by two GUI scripts");
  if (wrapped.length) fail("shared math file(s) not wrapped in a function, their internals leak into the page's global scope: " + wrapped.join(", "));
  else console.log("  ok: the shared math files keep their internals out of the global scope");
}

// 3. Every t("key") the GUI calls must exist in the English catalogue, and
// every English key must have a Chinese translation. A typo'd key renders as
// the raw key text on the page, which is easy to miss by eye.
if (I18N) {
  const { scan } = require("./lib/i18n-scan.js");
  const sources = ["app.js", "index.html"]
    .map(f => fs.readFileSync(path.join(PUBLIC_DIR, f), "utf8"));
  const r = scan(sources, I18N.CATALOG.en);

  if (r.unknown.length) fail("keys used but not in the English catalogue: " + r.unknown.join(", "));
  else console.log("  ok: all " + r.used.size + " i18n keys used by the GUI exist");

  if (r.emptyPrefixes.length) fail("key prefixes the code builds on but the catalogue never fills: " + r.emptyPrefixes.join(", "));
  else if (r.prefixes.size) console.log("  ok: " + r.prefixes.size + " concatenated key prefixes resolve (" + [...r.prefixes].join(", ") + ")");

  const untranslated = I18N.missing("zh");
  if (untranslated.length) fail("English keys with no Chinese translation: " + untranslated.join(", "));
  else console.log("  ok: all " + Object.keys(I18N.CATALOG.en).length + " keys are translated to zh");

  const stale = I18N.extra("zh");
  if (stale.length) fail("Chinese keys with no English original: " + stale.join(", "));

  if (r.unused.length) console.log("  note: " + r.unused.length + " catalogue keys are not referenced: " + r.unused.slice(0, 8).join(", ") + (r.unused.length > 8 ? " ..." : ""));
}

// Catalyst/material icons are optional game artwork extracted by
// extract-icons.js into public/icons.svg (gitignored). Report what is there:
// after a game update the sprite filename changes and it must be re-run, and
// a stat with no icon silently falls back to a coloured dot.
const ICONS = path.join(PUBLIC_DIR, "icons.svg");
if (!fs.existsSync(ICONS)) {
  console.log("  note: public/icons.svg missing - icons fall back to dots. " +
    "Run: node extract-icons.js");
} else {
  const svg = fs.readFileSync(ICONS, "utf8");
  const ids = new Set([...svg.matchAll(/<symbol[^>]*id="([^"]+)"/g)].map(m => m[1]));
  const stats = Object.keys(require("./lib/constants.js").STAT_BASES || {});
  const noIcon = stats.filter(st => !ids.has("catalyst_" + st));
  console.log("  ok: icons.svg has " + ids.size + " icons (" +
    (Math.round(svg.length / 1024)) + " KB)");
  if (stats.length && noIcon.length)
    console.log("  note: no icon for " + noIcon.join(", ") +
      " - re-run extract-icons.js after a game update");
  // Every GAME id public/icon-map.js declares must be in the sprite too. An
  // id the page asks for but the extractor never copied draws nothing at all,
  // which is the one icon failure that is invisible on screen.
  if (ICON_MAP) {
    const undrawn = ICON_MAP.gameIds().filter(id => !ids.has(id));
    if (undrawn.length)
      console.log("  note: icon-map.js asks for " + undrawn.length +
        " game icon(s) icons.svg does not have: " + undrawn.join(", ") +
        " - re-run extract-icons.js");
    else console.log("  ok: all " + ICON_MAP.gameIds().length + " game icons the GUI asks for by name are present");
  }
}

// public/icons-local.svg holds what the advisor draws itself for things the
// game ships no artwork for. Unlike icons.svg it is in the repo, so anything
// missing from it is a bug and not a "run the extractor" note.
const LOCAL_ICONS = path.join(PUBLIC_DIR, "icons-local.svg");
if (!fs.existsSync(LOCAL_ICONS)) {
  fail("public/icons-local.svg is missing (it is committed, not generated)");
} else {
  const svg = fs.readFileSync(LOCAL_ICONS, "utf8");
  const ids = new Set([...svg.matchAll(/<symbol[^>]*id="([^"]+)"/g)].map(m => m[1]));
  const missing = ICON_MAP ? ICON_MAP.localIds().filter(id => !ids.has(id)) : [];
  const stray = [...ids].filter(id => !ICON_MAP || !ICON_MAP.LOCAL_IDS.has(id));
  if (missing.length) fail("icons-local.svg has no symbol for: " + missing.join(", "));
  else console.log("  ok: icons-local.svg draws all " + ids.size + " advisor icon(s) (" +
    Math.round(svg.length / 1024) + " KB)");
  if (stray.length) fail("icons-local.svg has symbols icon-map.js does not declare: " + stray.join(", "));
}

// Render every tab offline (lib/gui-render.js) and check three things the
// static checks above cannot see:
//
//   1. the tab renders at all, in both languages;
//   2. every <use href="#id"> resolves to a symbol one of the sprites has --
//      an id nothing provides draws NOTHING, silently, which is the icon
//      failure you cannot spot by looking at the page;
//   3. no label NAMES a thing we have an icon for while drawing no icon.
//
// (3) is what stops a new table quietly reintroducing the bare-text rows the
// icon sweep set out to remove. It looks only where a name IS the label --
// card labels, the first cell of a table row, the leading name of a list row.
// Headings are section furniture and prose is prose; an icon belongs on a
// label, so neither is checked.
//
// Snapshots are gitignored, so a fresh clone has no data to render: that is a
// note and not a failure, exactly like a missing icons.svg.
const SNAP_DIR = path.join(__dirname, "snapshots");
const snapshots = fs.existsSync(SNAP_DIR)
  ? fs.readdirSync(SNAP_DIR).filter(f => /^\d.*\.json$/.test(f)).sort()
  : [];
if (!snapshots.length) {
  console.log("  note: no snapshots/ to render - skipping the tab render and icon-label checks");
} else if (!I18N) {
  console.log("  note: i18n.js did not load - skipping the tab render checks");
} else {
  const { sandbox, TABS } = require("./lib/gui-render.js");
  const snapshot = snapshots[snapshots.length - 1];
  const data = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, snapshot), "utf8"));

  // --- 1 + 2: every tab renders, and every icon it asks for exists ---
  // Also with the sprites taken away: the GUI must never depend on artwork
  // that a fresh clone does not have.
  // The three states a real install can be in. "Only the advisor's own" is
  // what a fresh clone looks like before anyone runs extract-icons.js.
  const LOCAL_ONLY = ICON_MAP ? new Set(ICON_MAP.localIds()) : new Set();
  const STATES = [
    ["with both sprites", undefined],
    ["with only the advisor's own sprite", LOCAL_ONLY],
    ["with no sprite at all", null],
  ];
  let renderFailures = 0;
  const drawn = new Set();
  for (const [what, iconIds] of STATES) {
    let gui;
    try {
      gui = sandbox(data, iconIds === undefined ? {} : { iconIds });
    } catch (e) {
      fail("the GUI does not load " + what + ": " + e.message);
      renderFailures++;
      continue;
    }
    for (const lang of ["en", "zh"]) {
      gui.setLang(lang);
      for (const tab of TABS) {
        let html;
        try {
          html = gui.render(tab);
        } catch (e) {
          fail(tab + " (" + lang + ", " + what + ") threw: " + e.message);
          renderFailures++;
          continue;
        }
        // render() catches its own errors and prints a banner instead.
        if (/class="row" style="border-color:rgba\(224,91,91/.test(html)) {
          fail(tab + " (" + lang + ", " + what + ") rendered its failure banner");
          renderFailures++;
        }
        const used = [...html.matchAll(/<use href="#([^"]+)"/g)].map(m => m[1]);
        used.forEach(id => drawn.add(id));
        // gameIcon()/catIcon()/matIcon() all check the id before drawing, so
        // this cannot fire today. It is here for the next <use> that gets
        // written without going through them.
        const unresolved = [...new Set(used.filter(id => !gui.iconIds || !gui.iconIds.has(id)))];
        if (unresolved.length) {
          fail(tab + " (" + lang + ", " + what + ") draws icons nothing provides: " + unresolved.join(", "));
          renderFailures++;
        }
      }
    }
  }
  if (!renderFailures) {
    console.log("  ok: all " + TABS.length + " tabs render in en and zh, in each of the " +
      STATES.length + " sprite states");
    console.log("  ok: " + drawn.size + " distinct icons drawn, all resolve to a symbol");
  }

  // --- 3: labels that name an iconable thing but draw nothing ---
  const en = I18N.CATALOG.en;
  const vocab = new Set();
  const addNamespace = pre => Object.keys(en)
    .filter(k => k.startsWith(pre))
    .forEach(k => vocab.add(en[k].toLowerCase()));
  ["gearslot.", "act.", "npc.", "petbody.", "body.", "material.", "itemskill."].forEach(addNamespace);
  ["droid", "droids", "clone", "clones", "credits", "quantum cores", "cosmic dust",
    "stellarium", "warp capsule", "pet food", "catalyst parts", "fuel", "korin"]
    .forEach(w => vocab.add(w));
  const TERMS = [...vocab].filter(w => w && w.length > 2).sort((a, b) => b.length - a.length);

  // Base and laboratory buildings read as materials because a material is in
  // the building's name ("Stellarium miner", "Fuel facility"). The game ships
  // no module artwork at all, so they are not a gap.
  const MODULES = new Set(Object.keys(en)
    .filter(k => k.startsWith("module."))
    .map(k => en[k].toLowerCase()));
  // Labels that name something iconable and stay plain on purpose.
  const PLAIN_ON_PURPOSE = [
    // Cards under an already-iconned "Clone damage impact" heading: repeating
    // one glyph down a card row is noise, not information.
    /^\+\d+(st|nd|rd|th) clone @/i,
  ];

  const isWord = c => c >= "a" && c <= "z";
  const namesSomething = (txt) => {
    const hay = " " + txt.toLowerCase() + " ";
    return TERMS.find(term => {
      let i = hay.indexOf(term);
      while (i >= 0) {
        if (!isWord(hay[i - 1]) && !isWord(hay[i + term.length])) return true;
        i = hay.indexOf(term, i + 1);
      }
      return false;
    });
  };
  const textOf = h => h.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();

  const REGIONS = [
    ["card label", /<div class="k">([\s\S]*?)<\/div>/g],
    ["table cell", /<td[^>]*>([\s\S]*?)<\/td>/g],
    ["list row", /<div class="row[^"]*">([\s\S]*?)(?=<\/div>)/g],
  ];
  const gaps = new Map();
  const guiEn = sandbox(data, {});
  guiEn.setLang("en");
  for (const tab of TABS) {
    let html;
    try { html = guiEn.render(tab); } catch (e) { continue; }
    for (const [kind, re] of REGIONS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(html))) {
        const inner = m[1];
        if (inner.includes("<use href=")) continue;             // already drawn
        if (kind === "table cell" && !inner.includes("<b>")) continue; // a value, not a name
        const txt = textOf(inner);
        if (!txt || txt.length > 70) continue;
        if (MODULES.has(txt.toLowerCase())) continue;
        if (PLAIN_ON_PURPOSE.some(rx => rx.test(txt))) continue;
        const term = namesSomething(txt);
        if (!term) continue;
        const key = tab + " " + kind + ' "' + txt + '"';
        if (!gaps.has(key)) gaps.set(key, term);
      }
    }
  }
  if (gaps.size) {
    fail("labels that name something the GUI has an icon for, but draw none:\n" +
      [...gaps].map(([where, term]) => "        " + where + "  [" + term + "]").join("\n"));
  } else {
    console.log("  ok: every card, row and named cell that could carry an icon does");
  }
}

// 4. index.html must reference the stylesheet and all scripts.
const html = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");
for (const ref of ["/style.css", "/i18n.js", "/icon-map.js", "/pet-math.js", "/lab-math.js", "/base-math.js", "/unit-math.js", "/app.js"]) {
  if (html.includes(ref)) console.log("  ok: index.html references " + ref);
  else fail("index.html does not reference " + ref);
}

process.exit(failed ? 1 : 0);
