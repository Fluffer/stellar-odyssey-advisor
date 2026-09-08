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

// Only the catalyst stat icons, which is what the advisor displays. Each is a
// self-contained <symbol> with no url(#..) or href references out of itself.
const symbols = [];
for (const m of svg.matchAll(/<symbol\b[^>]*\bid="(catalyst_[^"]+)"[^>]*>/g)) {
  const start = m.index;
  const end = svg.indexOf("</symbol>", start);
  if (end < 0) continue;
  symbols.push({ id: m[1], xml: svg.slice(start, end + "</symbol>".length) });
}
if (!symbols.length) fail("no catalyst_* symbols found in the sprite");

const out = '<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">\n' +
  symbols.map(s => s.xml).join("\n") + "\n</svg>\n";
const dest = path.join(__dirname, "public", "icons.svg");
fs.writeFileSync(dest, out);
console.log("wrote public/icons.svg — " + symbols.length + " icons, " +
  (out.length / 1024).toFixed(0) + " KB");
console.log("  " + symbols.map(s => s.id.replace("catalyst_", "")).join(", "));
