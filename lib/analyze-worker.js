// Persistent analyze worker. Runs the CPU-heavy readGameState + analyze
// pipeline off the main thread so the HTTP server's event loop stays
// responsive during the 30-90s battle simulation. advisor-core.js is
// required once at module load, so its module-level caches (lib/battle-rating.js)
// live in this worker and persist warm across requests, same as they did
// in-process before this file existed.
//
// A message may carry a `state` already read elsewhere (the browser bridge,
// lib/bridge.js); then the DevTools read is skipped and that state is
// analyzed instead.
"use strict";
const { parentPort } = require("node:worker_threads");
const core = require("../advisor-core.js");

parentPort.on("message", async (msg) => {
  const { id } = msg;
  try {
    const state = msg.state || await core.readGameState();
    const data = core.analyze(state);
    parentPort.postMessage({ id, data });
  } catch (e) {
    parentPort.postMessage({ id, error: e.message });
  }
});
