// Service worker half of the bridge. Two jobs:
//  1. every 30 s (chrome.alarms, the MV3 minimum) read the game tab and
//     POST the state to the advisor;
//  2. keep a long-poll open on /api/bridge/poll so an "Analyze now" in the
//     advisor GUI can ask for a read right away instead of waiting for the
//     next alarm.
// MV3 service workers are shut down when idle, so the alarm also restarts
// the poll loop; the server answers a poll within 25 s for that reason.
"use strict";
const SERVER = "http://localhost:8787";
const GAME_URL = "https://steam.stellarodyssey.app/*";

function badge(text, color) {
  try {
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color });
  } catch (_) {}
}

async function gameTab() {
  const tabs = await chrome.tabs.query({ url: GAME_URL });
  return tabs[0] || null;
}

async function readState(tab) {
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: "so-advisor-read" });
  } catch (e) {
    return { error: "no content script in the game tab (reload the tab): " + e.message };
  }
}

// Manifest content scripts only reach tabs opened AFTER the extension is
// loaded. A game tab that was already open when the extension was installed
// or reloaded gets both halves injected here instead, so nobody has to
// reload the game and log in again.
async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: GAME_URL });
  for (const tab of tabs) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["page.js"], world: "MAIN" });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    } catch (e) {
      console.warn("[so-advisor] inject failed for tab", tab.id, e.message);
    }
  }
  return tabs.length;
}

async function post(body) {
  return fetch(SERVER + "/api/bridge/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function push(reason) {
  const tab = await gameTab();
  if (!tab) { badge("tab", "#666"); return false; }
  let state = await readState(tab);
  if (state == null) state = { error: "empty answer from the game tab" };
  try {
    // A failed read is posted too, so the advisor's log says why instead of
    // the extension failing silently on the user's side.
    const r = await post({ state, url: tab.url, at: Date.now(), reason });
    const ok = r.ok && !(typeof state === "object" && state.error);
    badge(ok ? "on" : "err", ok ? "#2a7" : "#a33");
    if (!ok) console.warn("[so-advisor] read failed:", state && state.error);
    return ok;
  } catch (e) {
    badge("srv", "#a33"); // advisor server not running
    return false;
  }
}

// Server not running? Ask the native messaging host (native-host/) to start
// it. The host must be registered once with native-host/install.js; until
// then the badge says "host" (not registered) or "id" (registered for a
// different extension ID). Tried at most once a minute.
const HOST_NAME = "com.stellar_odyssey.advisor_launcher";
let lastStartAttempt = 0;
async function serverReachable() {
  try {
    const r = await fetch(SERVER + "/api/bridge/status", { cache: "no-store" });
    return r.ok;
  } catch (_) { return false; }
}
async function ensureServer() {
  if (await serverReachable()) return true;
  if (Date.now() - lastStartAttempt < 60 * 1000) return false;
  lastStartAttempt = Date.now();
  try {
    const reply = await chrome.runtime.sendNativeMessage(HOST_NAME, { cmd: "start", port: 8787 });
    if (reply && reply.ok) {
      console.log("[so-advisor] advisor server " + (reply.started ? "started (pid " + reply.pid + ")" : "already running"));
      return true;
    }
    console.warn("[so-advisor] launcher failed:", reply && reply.error);
    badge("srv", "#a33");
  } catch (e) {
    const m = String(e && e.message || e);
    if (/not found/i.test(m)) badge("host", "#a33");        // host not registered
    else if (/forbidden/i.test(m)) badge("id", "#a33");     // registered for another extension ID
    else badge("srv", "#a33");
    console.warn("[so-advisor] native host:", m);
  }
  return false;
}

let polling = false;
async function pollLoop() {
  if (polling) return;
  polling = true;
  try {
    for (;;) {
      let r;
      try { r = await fetch(SERVER + "/api/bridge/poll"); } catch (_) { break; }
      if (!r.ok) break;
      const j = await r.json();
      if (j && j.read) await push("request");
    }
  } finally {
    polling = false;
  }
}

// The advisor GUI tab. Opened once the server answers, on extension load
// and browser start (never on the 30-second check, so a tab you closed
// stays closed); clicking the extension icon opens or focuses it.
const GUI_URL = "http://localhost:8787/";
async function advisorTab() {
  const tabs = await chrome.tabs.query({ url: ["http://localhost:8787/*", "http://127.0.0.1:8787/*"] });
  return tabs[0] || null;
}
async function openAdvisor(focus) {
  const tab = await advisorTab();
  if (tab) {
    if (focus) {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    return;
  }
  await chrome.tabs.create({ url: GUI_URL, active: !!focus });
}

async function kick(reason, open) {
  if (!(await ensureServer())) return;
  if (open) await openAdvisor(open === "focus");
  push(reason);
  pollLoop();
}

chrome.alarms.create("so-advisor-push", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "so-advisor-push") kick("alarm"); });
chrome.runtime.onInstalled.addListener(async () => { await injectIntoOpenTabs(); kick("install", "open"); });
chrome.runtime.onStartup.addListener(() => kick("startup", "open"));
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (info.status === "complete" && tab.url && tab.url.startsWith("https://steam.stellarodyssey.app/")) {
    setTimeout(() => kick("tab"), 3000);
  }
});
chrome.action.onClicked.addListener(() => kick("click", "focus"));
