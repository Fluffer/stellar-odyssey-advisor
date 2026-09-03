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
for (const f of ["app.js", "pet-math.js"]) {
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

// 3. index.html must reference the stylesheet and both scripts.
const html = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");
for (const ref of ["/style.css", "/pet-math.js", "/app.js"]) {
  if (html.includes(ref)) console.log("  ok: index.html references " + ref);
  else fail("index.html does not reference " + ref);
}

process.exit(failed ? 1 : 0);
