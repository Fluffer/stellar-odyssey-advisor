// gui-render.js — run public/app.js outside a browser and get each tab's HTML.
//
// The GUI builds pages by string concatenation into #content, so nothing about
// a tab is testable without either a browser or a stand-in for one. This is
// the stand-in: a vm context with just enough DOM for the render functions,
// the same public/*.js files index.html loads, and one analysis snapshot as
// the data. It lives in lib/, next to i18n-scan.js, so check-page.js and
// anything in test/ can share one definition of "render the GUI".
//
// It is deliberately NOT a DOM implementation. render() only ever assigns
// innerHTML on #content and #summary and toggles classes on the tab buttons,
// so those are what the shim provides; anything else returns an inert stub.
// If a future render function starts reading real layout back out of the DOM,
// this will throw rather than quietly report a passing check.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
// The order index.html loads them in: app.js closes over the others.
const SCRIPTS = ["i18n.js", "icon-map.js", "pet-math.js", "lab-math.js",
  "base-math.js", "unit-math.js", "voyager-math.js", "app.js"];
const TABS = ["gear", "battle", "installs", "merges", "units", "tech", "pets",
  "inventory", "materials", "lab", "base", "voyager"];

function stubElement() {
  return {
    innerHTML: "", textContent: "", value: "", checked: false,
    style: {}, dataset: {},
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    appendChild() {}, addEventListener() {}, querySelectorAll: () => [],
  };
}

// Which sprite symbols exist. Both files are optional: icons.svg is extracted
// from the local game install and icons-local.svg ships with the repo, and the
// GUI is required to survive either being absent.
function spriteIds() {
  const ids = new Set();
  for (const f of ["icons.svg", "icons-local.svg"]) {
    const file = path.join(PUBLIC_DIR, f);
    if (!fs.existsSync(file)) continue;
    const svg = fs.readFileSync(file, "utf8");
    for (const m of svg.matchAll(/<symbol[^>]*id="([^"]+)"/g)) ids.add(m[1]);
  }
  return ids;
}

// Returns { render(tab) -> html, setLang(lang), iconIds }.
// `iconIds` overrides what the page believes is loaded, so a caller can test
// the degraded states (no sprite at all, or only the advisor's own) without
// deleting files.
function sandbox(data, opts) {
  const options = opts || {};
  const store = {};
  const ctx = {
    console, Date, Math, JSON,
    setTimeout, clearTimeout, setInterval, clearInterval,
    // Nothing may reach the network: the icons are injected directly below.
    fetch: () => Promise.resolve({ ok: false }),
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
    navigator: { language: "en" },
    document: {
      getElementById: () => stubElement(),
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => stubElement(),
      documentElement: stubElement(),
      body: { insertBefore() {}, firstChild: null },
      addEventListener() {},
    },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of SCRIPTS) {
    vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, f), "utf8"), ctx, { filename: f });
  }

  const ids = options.iconIds === undefined ? spriteIds() : options.iconIds;
  ctx.window.__iconIds = ids;
  ctx.window.__iconsReady = !!ids;
  ctx.window.lastData = data;

  let content = "";
  let summary = "";
  ctx.document.getElementById = (id) => {
    const el = stubElement();
    if (id === "content") Object.defineProperty(el, "innerHTML", { set(v) { content = v; }, get: () => content });
    if (id === "summary") Object.defineProperty(el, "innerHTML", { set(v) { summary = v; }, get: () => summary });
    return el;
  };

  return {
    iconIds: ids,
    setLang: (lang) => ctx.I18n.setLang(lang),
    // The summary cards live outside #content but are on every tab, so they
    // are appended here -- a caller asking "what does this tab draw" means
    // everything on screen.
    render(tab) {
      content = "";
      ctx.window.activeTab = tab;
      ctx.render(data);
      return content + summary;
    },
  };
}

module.exports = { sandbox, spriteIds, TABS, SCRIPTS, PUBLIC_DIR };
