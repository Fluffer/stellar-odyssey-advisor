// Advisor GUI server. Serves a dashboard at http://localhost:8787
// that shows gear, catalysts, install/replace suggestions and merge plans.
//
// The CPU-heavy analysis (readGameState + the Monte-Carlo battle sim) runs
// in a persistent worker thread (lib/analyze-worker.js) so this process's
// event loop stays responsive to other requests while an analyze is in
// flight.
//
// Usage: node advisor-server.js [port]

// Fail loudly and early on an old runtime. package.json's "engines" is only
// advisory here (there is no npm install step to enforce it), and the real
// symptom otherwise is a bare "WebSocket is not defined" from lib/cdp.js at
// the first analyze -- the global WebSocket it uses only exists from Node 22.
if (typeof WebSocket === "undefined") {
  console.error(
    "This advisor needs Node 22 or newer (it uses the built-in WebSocket).\n" +
    "You are running " + process.version + ". Install Node 22 LTS or newer and retry.\n" +
    "Run `node diagnose-connection.js` for a full check."
  );
  process.exit(1);
}

const http = require("http");
const fs = require("fs");
const path = require("path");
const { Worker } = require("node:worker_threads");
const { recentIncome, observedStellariumDrops } = require("./lib/income.js");
const { Bridge } = require("./lib/bridge.js");

const PORT = Number(process.argv[2]) || 8787;
const PUBLIC_DIR = path.join(__dirname, "public");
const SNAP_DIR = path.join(__dirname, "snapshots");
fs.mkdirSync(SNAP_DIR, { recursive: true });

function json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// Browser bridge (lib/bridge.js): state pushed by bridge-extension/ from a
// browser tab running the web build. A pushed state is a few hundred KB;
// the limit only guards against something else hitting the endpoint.
const bridge = new Bridge();
const BRIDGE_BODY_LIMIT = 32 * 1024 * 1024;
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Whitelist of servable static files -> [filename in public/, Content-Type].
// No generic path-joining of req.url: only these exact routes are served,
// so path traversal isn't possible. Read fresh per request (fs.readFile,
// not cached) so editing public/ files takes effect without a restart --
// these files are tiny, so the per-request read cost is negligible.
const STATIC = {
  "/": ["index.html", "text/html"],
  "/style.css": ["style.css", "text/css"],
  "/app.js": ["app.js", "application/javascript"],
  "/i18n.js": ["i18n.js", "application/javascript"],
  "/icon-map.js": ["icon-map.js", "application/javascript"],
  "/icons.svg": ["icons.svg", "image/svg+xml"],
  "/icons-local.svg": ["icons-local.svg", "image/svg+xml"],
  "/pet-math.js": ["pet-math.js", "application/javascript"],
  "/lab-math.js": ["lab-math.js", "application/javascript"],
  "/base-math.js": ["base-math.js", "application/javascript"],
  "/unit-math.js": ["unit-math.js", "application/javascript"],
  "/voyager-math.js": ["voyager-math.js", "application/javascript"],
};

function serveStatic(res, url) {
  const [file, type] = STATIC[url];
  fs.readFile(path.join(PUBLIC_DIR, file), (err, data) => {
    if (err) {
      res.writeHead(500);
      res.end("failed to read " + file);
      return;
    }
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
}

// Snapshot persistence: every successful analyze is saved to snapshots/ so
// the GUI can show the last result on load (/api/last) and chart trends
// over time (/api/history). A snapshot failure must never fail the API
// response, so every step here swallows and logs its own errors.
function historyMetrics(data) {
  const p = data.player || {};
  // An analysis that ran without the squadron boost produces battle numbers
  // ~45% low. Writing those to history plots a collapse that never happened,
  // so record nothing rather than something wrong.
  const battleBase = (data.battleTrusted === false) ? null : (data.battleBase || null);
  let battleAvg = null;
  if (battleBase) {
    const vals = Object.values(battleBase);
    if (vals.length) battleAvg = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  }
  let petLevelSum = null;
  if (data.pets && Array.isArray(data.pets.pets)) {
    petLevelSum = data.pets.pets.reduce((s, x) => s + (x.level || 0), 0);
  }
  return {
    craftLevel: p.craftLevel ?? null,
    dust: p.dust ?? null,
    parts: p.parts ?? null,
    qc: p.qc ?? null,
    credits: (data.units && data.units.credits) ?? null,
    // Lifetime credits EARNED (statistics), as opposed to `credits` above,
    // which is the spendable wallet and drops whenever the player buys
    // something. Only this one can yield an income rate. See recentIncome().
    lifetimeCredits: (data.base && data.base.income) ? (data.base.income.lifetimeCredits ?? null) : null,
    // Stellarium HELD on the founded base, null before founding. A rise
    // between two lines is a miner drop; see observedStellariumDrops().
    stellarium: (data.base && data.base.live) ? (data.base.live.stellarium ?? null) : null,
    installedCount: p.installedCount ?? null,
    unequippedCount: p.unequippedCount ?? null,
    battleAvg,
    battleBase,
    petLevelSum,
  };
}

// Keep only the newest 50 snapshot files. Filenames are the ISO capturedAt
// stamp (":" and "." replaced with "-"), so lexicographic sort == chrono sort.
async function pruneSnapshots() {
  const files = (await fs.promises.readdir(SNAP_DIR)).filter(f => f.endsWith(".json")).sort();
  const excess = files.length - 50;
  if (excess <= 0) return;
  for (const f of files.slice(0, excess)) {
    await fs.promises.unlink(path.join(SNAP_DIR, f)).catch(() => {});
  }
}

// Append one history line, deduping against the last line so idle periods
// (auto-refresh with no game-state change) don't bloat the trend log.
async function appendHistory(entry) {
  const file = path.join(SNAP_DIR, "history.jsonl");
  let lastMetrics = null;
  try {
    const lines = (await fs.promises.readFile(file, "utf8")).split("\n").filter(Boolean);
    if (lines.length) {
      const { capturedAt, ...rest } = JSON.parse(lines[lines.length - 1]);
      lastMetrics = rest;
    }
  } catch (_) { /* missing or corrupt: nothing to dedupe against */ }
  const { capturedAt, ...rest } = entry;
  if (lastMetrics && JSON.stringify(lastMetrics) === JSON.stringify(rest)) return;
  await fs.promises.appendFile(file, JSON.stringify(entry) + "\n");
}

// Observed income rate, from lib/income.js (kept there so it is unit-testable
// without starting this server).
async function attachRecentIncome(data) {
  if (!data || !data.base || !data.base.income) return;
  let lines = [];
  try {
    lines = (await fs.promises.readFile(path.join(SNAP_DIR, "history.jsonl"), "utf8")).split("\n").filter(Boolean);
  } catch (_) { return; /* no history yet */ }
  data.base.income.recent = recentIncome(lines, Date.now(), Number(data.base.income.lifetimeCredits));
  if (data.base.stellarium) {
    const heldNow = data.base.live ? Number(data.base.live.stellarium) : NaN;
    data.base.stellarium.observed = observedStellariumDrops(lines, Date.now(), heldNow);
  }
}

async function saveSnapshot(data) {
  try {
    data.capturedAt = new Date().toISOString();
    // Before appending this run's own line, so the rate spans a real interval.
    await attachRecentIncome(data);
    const stamp = data.capturedAt.replace(/[:.]/g, "-");
    await fs.promises.writeFile(path.join(SNAP_DIR, stamp + ".json"), JSON.stringify(data));
    await pruneSnapshots();
    await appendHistory({ capturedAt: data.capturedAt, ...historyMetrics(data) });
  } catch (e) {
    console.log("[advisor] snapshot save failed: " + e.message);
  }
}

// Analyze worker: one persistent Worker thread runs core.readGameState() +
// core.analyze() (lib/analyze-worker.js) so THIS process's event loop stays
// responsive while the Monte-Carlo battle sim runs. Spawned lazily on first
// use and kept alive between requests -- its module-level caches
// (lib/battle-rating.js) stay warm across analyzes, same as in-process
// before. If it errors or exits, every pending request is rejected and the
// reference is cleared so the next request respawns a fresh worker.
const ANALYZE_WORKER_PATH = path.join(__dirname, "lib", "analyze-worker.js");
const ANALYZE_TIMEOUT_MS = 150000;
let analyzeWorker = null;
let nextRequestId = 1;
const pendingRequests = new Map(); // id -> { resolve, reject, timer }

function failAllPending(err) {
  for (const [, p] of pendingRequests) {
    clearTimeout(p.timer);
    p.reject(err);
  }
  pendingRequests.clear();
}

function getAnalyzeWorker() {
  if (analyzeWorker) return analyzeWorker;
  const worker = new Worker(ANALYZE_WORKER_PATH);
  worker.on("message", ({ id, data, error }) => {
    const p = pendingRequests.get(id);
    if (!p) return;
    pendingRequests.delete(id);
    clearTimeout(p.timer);
    if (error) p.reject(new Error(error));
    else p.resolve(data);
  });
  worker.on("error", (err) => {
    console.log("[advisor] analyze worker error, respawning: " + err.message);
    failAllPending(err);
    analyzeWorker = null;
  });
  worker.on("exit", (code) => {
    if (analyzeWorker !== worker) return; // already handled by 'error'
    console.log("[advisor] analyze worker exited (code " + code + "), respawning on next request");
    failAllPending(new Error("analyze worker exited (code " + code + ")"));
    analyzeWorker = null;
  });
  analyzeWorker = worker;
  return worker;
}

// `state` is optional: when given (browser bridge) the worker analyzes it
// instead of reading the Steam client over DevTools.
function runInWorker(state) {
  return new Promise((resolve, reject) => {
    const worker = getAnalyzeWorker();
    const id = nextRequestId++;
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error("analyze timed out"));
    }, ANALYZE_TIMEOUT_MS);
    pendingRequests.set(id, { resolve, reject, timer });
    worker.postMessage({ id, state: state || null });
  });
}

// Where the state comes from, in order:
//  1. a browser with the bridge extension attached: ask it for a fresh read
//     (or take a push from the last minute) -- the player is playing there;
//  2. the Steam client over DevTools;
//  3. if that fails, a bridge push from the last five minutes, rather than
//     nothing at all.
const BRIDGE_FRESH_TIMEOUT_MS = 8000;
const BRIDGE_RECENT_MS = 60 * 1000;
const BRIDGE_STALE_OK_MS = 5 * 60 * 1000;
async function analyzeFromBestSource() {
  const fresh = (await bridge.requestFresh(BRIDGE_FRESH_TIMEOUT_MS)) || bridge.freshest(BRIDGE_RECENT_MS);
  if (fresh) {
    const data = await runInWorker(fresh.state);
    data.source = "browser";
    data.sourceAgeMs = Date.now() - fresh.at;
    return data;
  }
  try {
    const data = await runInWorker(null);
    data.source = "steam";
    return data;
  } catch (e) {
    const stale = bridge.freshest(BRIDGE_STALE_OK_MS);
    if (!stale) {
      throw new Error(e.message + " (no browser bridge attached either: see bridge-extension/README.md to play in a browser)");
    }
    console.log("[advisor] DevTools read failed (" + e.message + "); using a browser push from " +
      Math.round((Date.now() - stale.at) / 1000) + "s ago");
    const data = await runInWorker(stale.state);
    data.source = "browser";
    data.sourceAgeMs = Date.now() - stale.at;
    return data;
  }
}

// Single-flight: concurrent /api/analyze calls (auto-refresh + manual clicks)
// share ONE running analyze instead of piling up CPU-heavy work that would
// block the event loop and make every request appear stuck.
let analyzeInFlight = null;
async function runAnalyze() {
  if (!analyzeInFlight) {
    analyzeInFlight = (async () => {
      const t0 = Date.now();
      const data = await analyzeFromBestSource();
      console.log("[advisor] analyze ok in " + ((Date.now() - t0) / 1000).toFixed(1) + "s via " + data.source);
      await saveSnapshot(data);
      return data;
    })().finally(() => { analyzeInFlight = null; });
  }
  return analyzeInFlight;
}

const server = http.createServer(async (req, res) => {
  const url = (req.url === "/index.html" || req.url.startsWith("/index")) ? "/" : req.url;
  if (Object.prototype.hasOwnProperty.call(STATIC, url)) {
    serveStatic(res, url);
    return;
  }
  if (req.url.startsWith("/api/analyze")) {
    try {
      const data = await runAnalyze();
      json(res, 200, data);
    } catch (e) {
      console.log("[advisor] analyze FAILED: " + e.message);
      json(res, 500, { error: e.message });
    }
    return;
  }
  if (req.url.startsWith("/api/last")) {
    try {
      const files = (await fs.promises.readdir(SNAP_DIR)).filter(f => f.endsWith(".json")).sort();
      if (!files.length) { json(res, 200, { empty: true }); return; }
      const data = await fs.promises.readFile(path.join(SNAP_DIR, files[files.length - 1]), "utf8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(data);
    } catch (e) {
      json(res, 200, { empty: true });
    }
    return;
  }
  if (req.url.startsWith("/api/history")) {
    try {
      const content = await fs.promises.readFile(path.join(SNAP_DIR, "history.jsonl"), "utf8");
      const entries = [];
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try { entries.push(JSON.parse(line)); } catch (_) { /* skip corrupt line */ }
      }
      json(res, 200, { entries });
    } catch (e) {
      json(res, 200, { entries: [] });
    }
    return;
  }
  if (req.url.startsWith("/api/bridge/state")) {
    if (req.method !== "POST") { json(res, 405, { error: "POST only" }); return; }
    try {
      const body = JSON.parse(await readBody(req, BRIDGE_BODY_LIMIT));
      const got = bridge.push(body.state, { url: body.url });
      json(res, 200, { ok: true, at: got.at });
    } catch (e) {
      console.log("[advisor] bridge push rejected: " + e.message);
      json(res, 400, { error: e.message });
    }
    return;
  }
  if (req.url.startsWith("/api/bridge/poll")) {
    json(res, 200, await bridge.waitForPoll());
    return;
  }
  if (req.url.startsWith("/api/bridge/status")) {
    json(res, 200, bridge.status());
    return;
  }
  // Debug: a slice of the latest pushed state, e.g. /api/bridge/peek?path=voyager
  if (req.url.startsWith("/api/bridge/peek")) {
    const q = new URL(req.url, "http://localhost").searchParams.get("path") || "";
    let v = bridge.latest ? bridge.latest.state : null;
    for (const seg of q.split(".").filter(Boolean)) v = (v && typeof v === "object") ? v[seg] : undefined;
    json(res, 200, { path: q, at: bridge.latest ? bridge.latest.at : null, value: v === undefined ? null : v });
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => {
  console.log("[advisor] GUI: http://localhost:" + PORT);
});