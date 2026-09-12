// Connection diagnostic. Run it when the advisor reports "game not found":
//
//   node diagnose-connection.js
//
// It walks the same stages lib/cdp.js does -- and reuses that module rather
// than reimplementing it, so it cannot drift from the real discovery -- and
// says which stage gave out and how to fix it.
//
// Written in old-style JS on purpose: on a too-old Node it still runs and
// reports the version problem instead of crashing on modern syntax.

var cdp = require("./lib/cdp.js");

function line(s) { console.log(s); }
function ok(s) { line("  [OK]   " + s); }
function bad(s) { line("  [FAIL] " + s); }
function info(s) { line("         " + s); }

var TIER_LABEL = {
  0: "process is named 'Stellar Odyssey'",
  1: "path/name mentions the game",
  2: "runs from steamapps",
  3: "some other windowed app",
};

line("");
line("=== Stellar Odyssey advisor - connection diagnostic ===");
line("");

// ---- Stage B: browser bridge ----------------------------------------
// Playing the web build in a browser? Then the state comes from
// bridge-extension/ through the running advisor server, not from a
// DevTools port, and the stages below are expected to fail. Asked first so
// that case is explained before the DevTools hunt starts.
async function bridgeStage() {
  line("Stage B: browser bridge (bridge-extension/ pushing into the advisor server)");
  var st = await cdp.fetchJson("http://127.0.0.1:8787/api/bridge/status");
  if (!st) {
    info("advisor server not reachable on 8787, so no bridge status to report.");
    info("(Only matters if you play at https://steam.stellarodyssey.app in a browser.)");
  } else if (st.attached) {
    ok("a browser with the bridge extension is attached (last push " +
      (st.lastPushAgeMs === null ? "never" : Math.round(st.lastPushAgeMs / 1000) + "s ago") +
      ", " + st.pushes + " pushes) - analyze will use it; the DevTools stages below are optional");
  } else {
    info("no browser bridge attached (" + st.pushes + " pushes so far). If you play in a");
    info("browser, load bridge-extension/ as an unpacked extension and open the game tab.");
  }
  line("");
}

// ---- Stage 0: Node runtime ------------------------------------------
line("Stage 0: Node runtime");
info("node " + process.version + "   platform=" + process.platform);
var wsOk = (typeof WebSocket !== "undefined");
if (wsOk) {
  ok("global WebSocket exists");
} else {
  bad("global WebSocket is MISSING -> lib/cdp.js throws 'WebSocket is not defined'");
  info("This Node is too old; the advisor needs Node 22 or newer. Install Node 22");
  info("LTS+ and retry. Stages below still run, but nothing that needs a socket");
  info("can succeed until this is fixed.");
}
line("");

// ---- Stage 1: enumerate listening ports -----------------------------
line("Stage 1: listening TCP ports and their owning processes");
var rows = cdp.listListeners();
if (rows.length) {
  ok(rows.length + " listening port(s) enumerated");
} else {
  bad("could not enumerate any listening port");
  info("PowerShell or Get-NetTCPConnection is blocked on this machine. The advisor");
  info("cannot find the game without it.");
}
line("");

// ---- Stage 2: rank the candidates -----------------------------------
line("Stage 2: candidates worth probing (discovery is NOT name-based)");
var candidates = [];
for (var i = 0; i < rows.length; i++) {
  var t = cdp.tierOf(rows[i]);
  if (t >= 0) {
    candidates.push({ row: rows[i], tier: t });
  }
}
candidates.sort(function (a, b) { return a.tier - b.tier || a.row.port - b.row.port; });
if (candidates.length) {
  ok(candidates.length + " candidate(s), best first:");
  for (var j = 0; j < candidates.length && j < 12; j++) {
    var c = candidates[j];
    info("   tier " + c.tier + "  port " + c.row.port + "  pid " + c.row.pid +
      "  " + (c.row.name || "?") + "   (" + TIER_LABEL[c.tier] + ")");
  }
  if (candidates.length > 12) { info("   ... and " + (candidates.length - 12) + " more"); }
  var named = candidates.filter(function (x) { return x.tier === 0; });
  if (!named.length) {
    info("");
    info("Note: nothing is named exactly 'Stellar Odyssey'. That is not fatal -");
    info("discovery confirms a candidate by asking the page whether it exposes the");
    info("game's Pinia stores, so a renamed exe still resolves.");
  }
} else {
  bad("no windowed application is listening on any TCP port");
  info("=> the game is not running, or its DevTools port is off.");
  info("The Steam build opens a DevTools port on its own, on a random port, with no");
  info("launch option needed - so first check the game is actually running.");
  info("If it is, pin a port: Steam launch options");
  info("     %command% --remote-debugging-port=8788");
  info("and start the game FROM STEAM - a desktop shortcut or a separate launcher");
  info("process does not inherit %command%.");
}
line("");

// ---- Stage 3: which candidates actually speak CDP -------------------
(async function () {
  await bridgeStage();
  line("Stage 3: which candidates answer the DevTools protocol");
  var anyCdp = false;
  var probed = 0;
  for (var k = 0; k < candidates.length && probed < 12; k++) {
    var cand = candidates[k];
    var targets = await cdp.fetchJson("http://127.0.0.1:" + cand.row.port + "/json/list");
    probed++;
    if (!Array.isArray(targets)) { continue; }
    anyCdp = true;
    ok("port " + cand.row.port + " (" + (cand.row.name || "?") + ") speaks CDP, " +
      targets.length + " target(s)");
    for (var m = 0; m < targets.length && m < 6; m++) {
      info("   - type=" + targets[m].type + "  url=" +
        String(targets[m].url || "").slice(0, 80));
    }
  }
  if (!anyCdp) {
    bad("no candidate answered /json/list - no debug port is open");
    info("Same fix as Stage 2: check the game is running, then pin a debug port.");
  }
  line("");

  // ---- Stage 4: the real thing --------------------------------------
  line("Stage 4: discovery + a live read (exactly what the advisor does)");
  var found = await cdp.discoverGame();
  if (!found.url) {
    bad("discoverGame() failed: " + found.reason);
    if (!wsOk) {
      info("With no WebSocket, only an exactly-named process can ever be matched,");
      info("so this result is expected until Node is upgraded (see Stage 0).");
    }
    return finish();
  }
  ok("game socket: " + found.url);

  try {
    var st = await cdp.readGameState();
    ok("state read OK - game version " + (st.gameVersion || "?") +
      ", crafting level " + (st.craft ? st.craft.crafting_level : "?") +
      ", " + (st.catalysts ? st.catalysts.length : 0) + " catalysts");
    line("");
    line("  ==> The whole connection path is healthy.");
  } catch (e) {
    bad("connected, but reading the state failed: " + e.message);
    info("Make sure you are logged in and past the loading screen, then retry.");
  }
  finish();
})();

function finish() {
  line("");
  line("=== end of diagnostic ===");
  line("");
}
