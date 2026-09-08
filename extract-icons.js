// extract-icons.js — pull the catalyst stat icons out of your own game install
// so the GUI can show the same icons the game does.
//
// The icons are the game's artwork, so they are NOT committed to this repo:
// this script reads them from your local app.asar and writes public/icons.svg,
// which .gitignore excludes. Run it once (and again after a game update):
//
//   node extract-icons.js
//   node extract-icons.js "D:/Steam/steamapps/common/Stellar Odyssey/resources/app.asar"
//
// The GUI works fine without it — every icon falls back to the coloured dot
// the advisor used before.

const fs = require("fs");
const path = require("path");

const DEFAULT_PATHS = [
  "C:/Program Files (x86)/Steam/steamapps/common/Stellar Odyssey/resources/app.asar",
  "C:/Program Files/Steam/steamapps/common/Stellar Odyssey/resources/app.asar",
  "D:/Steam/steamapps/common/Stellar Odyssey/resources/app.asar",
  "D:/SteamLibrary/steamapps/common/Stellar Odyssey/resources/app.asar",
  "E:/SteamLibrary/steamapps/common/Stellar Odyssey/resources/app.asar",
];

function findAsar() {
  const given = process.argv[2] || process.env.STELLAR_ASAR;
  if (given) {
    if (fs.existsSync(given)) return given;
    fail("no app.asar at " + given);
  }
  for (const p of DEFAULT_PATHS) if (fs.existsSync(p)) return p;
  fail("could not find app.asar. Pass its path:\n" +
    '  node extract-icons.js "<steam>/steamapps/common/Stellar Odyssey/resources/app.asar"');
}

function fail(msg) {
  console.error("FAILED: " + msg);
  process.exit(1);
}

// asar layout: [8 byte pickle header][json header][file data]. The data base
// is 8 + the size field at byte 4 — omitting it is what makes research/
// asar-extract.js produce misaligned output, so it is spelled out here.
function readAsar(file) {
  const buf = fs.readFileSync(file);
  const jsonSize = buf.readUInt32LE(12);
  const header = JSON.parse(buf.slice(16, 16 + jsonSize).toString("utf8"));
  const dataOffset = 8 + buf.readUInt32LE(4);
  const files = [];
  (function walk(node, prefix) {
    for (const [name, child] of Object.entries(node.files || {})) {
      if (child.files) walk(child, prefix + name + "/");
      else files.push({ path: prefix + name, node: child });
    }
  })(header, "");
  const read = (entry) => buf.slice(dataOffset + Number(entry.node.offset),
    dataOffset + Number(entry.node.offset) + entry.node.size);
  return { files, read };
}

const asar = findAsar();
console.log("reading " + asar);
const { files, read } = readAsar(asar);

const sprite = files.find(f => /assets\/icons_sprite-.*\.svg$/.test(f.path));
if (!sprite) fail("no icons_sprite-*.svg in the archive (did the game update change its layout?)");
const svg = read(sprite).toString("utf8");
console.log("found " + sprite.path + " (" + (svg.length / 1024 / 1024).toFixed(1) + " MB)");

// Pull out only what the advisor displays, so the sprite stays ~100 KB rather
// than the game's 2.7 MB. Each symbol is self-contained: no url(#..) and no
// href references out of itself, verified across the set.
const all = new Map();
for (const m of svg.matchAll(/<symbol\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
  const start = m.index;
  const end = svg.indexOf("</symbol>", start);
  if (end >= 0) all.set(m[1], svg.slice(start, end + "</symbol>".length));
}

const symbols = [];
for (const [id, xml] of all) if (id.startsWith("catalyst_")) symbols.push({ id, xml });
if (!symbols.length) fail("no catalyst_* symbols found in the sprite");

// Materials and resources: rather than hardcode a list that drifts, take the
// vocabulary the GUI already knows (the material.* keys in the catalogue) and
// keep whichever of them the game ships an icon for. The two spell names
// differently only in spacing, so match on a normalised form.
const norm = x => String(x).toLowerCase().replace(/[\s_-]+/g, "");
const byNorm = new Map();
for (const id of all.keys()) if (!byNorm.has(norm(id))) byNorm.set(norm(id), id);

let materials = 0;
const missing = [];
try {
  const I18n = require(path.join(__dirname, "public", "i18n.js"));
  const names = Object.keys(I18n.CATALOG.en)
    .filter(k => k.startsWith("material."))
    .map(k => k.slice("material.".length));
  for (const name of names) {
    const id = byNorm.get(norm(name));
    if (!id) { missing.push(name); continue; }
    if (!symbols.some(sym => sym.id === id)) { symbols.push({ id, xml: all.get(id) }); materials++; }
  }
} catch (e) {
  console.error("  note: could not read the material vocabulary (" + e.message + ")");
}
if (missing.length) console.log("  no icon in the game for: " + missing.join(", "));

const out = '<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">\n' +
  symbols.map(s => s.xml).join("\n") + "\n</svg>\n";
const dest = path.join(__dirname, "public", "icons.svg");
fs.writeFileSync(dest, out);
console.log("wrote public/icons.svg — " + symbols.length + " icons (" +
  (symbols.length - materials) + " catalyst stats, " + materials + " materials), " +
  (out.length / 1024).toFixed(0) + " KB");
