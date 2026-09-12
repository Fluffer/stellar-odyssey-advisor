// Registers the native messaging host with Edge and Chrome for the current
// user (HKCU, no admin rights). Run once:
//
//   node bridge-extension/native-host/install.js [extension-id]
//   node bridge-extension/native-host/install.js --uninstall
//
// The browser only lets the extension talk to the host if the extension's
// ID is in the host manifest. An unpacked extension's ID is derived from
// its folder path, and that derivation is reproduced here so the ID need
// not be typed; pass it explicitly (edge://extensions shows it) if the
// computed one turns out wrong, which the extension reports as badge "id".
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const HOST_NAME = "com.stellar_odyssey.advisor_launcher";
const HERE = __dirname;
const EXT_DIR = path.resolve(HERE, "..");
const MANIFEST = path.join(HERE, HOST_NAME + ".json");
const CMD = path.join(HERE, "advisor-launcher.cmd");
// Built with join() rather than literal backslashes: the escapes are easy
// to get wrong across the shells that touch this file.
const REG_KEYS = [
  ["HKCU", "Software", "Microsoft", "Edge", "NativeMessagingHosts", HOST_NAME].join(path.win32.sep),
  ["HKCU", "Software", "Google", "Chrome", "NativeMessagingHosts", HOST_NAME].join(path.win32.sep),
];

// Chromium: id = first 16 bytes of SHA-256 over the absolute path, hex,
// with 0-9a-f mapped onto a-p. On Windows the path is hashed as UTF-16LE
// with only the drive letter forced to upper case; the rest keeps its case
// (crx_file/id_util.cc, GenerateIdForPath + MaybeNormalizePath).
function unpackedExtensionId(dir) {
  let p = path.resolve(dir);
  let bytes;
  if (process.platform === "win32") {
    if (/^[a-z]:/.test(p)) p = p[0].toUpperCase() + p.slice(1);
    bytes = Buffer.from(p, "utf16le");
  } else {
    bytes = Buffer.from(p, "utf8");
  }
  const hex = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 32);
  return hex.replace(/[0-9a-f]/g, (c) => String.fromCharCode("a".charCodeAt(0) + parseInt(c, 16)));
}

function reg(args) {
  return execFileSync("reg", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function install(extensionId) {
  const manifest = {
    name: HOST_NAME,
    description: "Starts the Stellar Odyssey advisor server for the bridge extension",
    path: CMD,
    type: "stdio",
    allowed_origins: ["chrome-extension://" + extensionId + "/"],
  };
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  for (const key of REG_KEYS) reg(["add", key, "/ve", "/t", "REG_SZ", "/d", MANIFEST, "/f"]);
  return manifest;
}

function uninstall() {
  for (const key of REG_KEYS) { try { reg(["delete", key, "/f"]); } catch (_) {} }
  try { fs.unlinkSync(MANIFEST); } catch (_) {}
}

if (require.main === module) {
  const arg = process.argv[2];
  if (arg === "--uninstall") {
    uninstall();
    console.log("native host unregistered");
  } else {
    const id = (arg && /^[a-p]{32}$/.test(arg)) ? arg : unpackedExtensionId(EXT_DIR);
    const m = install(id);
    console.log("native host registered for extension " + id);
    console.log("  manifest: " + MANIFEST);
    console.log("  host:     " + m.path);
    console.log("If edge://extensions shows a different ID for the bridge extension, rerun with that ID.");
  }
}

module.exports = { unpackedExtensionId, install, uninstall, HOST_NAME, MANIFEST };
