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
for (const f of ["app.js", "i18n.js", "pet-math.js", "lab-math.js", "base-math.js", "unit-math.js"]) {
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

let I18N = null;
try {
  I18N = require(path.join(PUBLIC_DIR, "i18n.js"));
  if (typeof I18N.t !== "function") throw new Error("t missing");
  console.log("  ok: i18n.js loads as a module");
} catch (e) {
  fail("i18n.js does not load: " + e.message);
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

// 4. index.html must reference the stylesheet and all scripts.
const html = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");
for (const ref of ["/style.css", "/i18n.js", "/pet-math.js", "/lab-math.js", "/base-math.js", "/unit-math.js", "/app.js"]) {
  if (html.includes(ref)) console.log("  ok: index.html references " + ref);
  else fail("index.html does not reference " + ref);
}

process.exit(failed ? 1 : 0);
