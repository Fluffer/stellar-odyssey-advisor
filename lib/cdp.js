// CDP access.

const http = require("http");
const { execSync } = require("child_process");

class CDP {
  constructor(url) {
    this.url = url;
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        clearTimeout(timer);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    };
  }
  open() {
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error("CDP connect timeout")), 8000);
      this.ws.onopen = () => { clearTimeout(timer); res(); };
      this.ws.onerror = () => { clearTimeout(timer); rej(new Error("WS error")); };
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      // Hard timeout: without it a hung DevTools target would leave
      // /api/analyze pending forever ("stuck on refresh" in the GUI).
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("CDP timeout: " + method));
      }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() {
    try { this.ws.close(); } catch (_) {}
  }
}

async function evalInPage(cdp, expression) {
  const res = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    includeCommandLineAPI: true,
    timeout: 8000,
  });
  if (res.exceptionDetails) {
    return { error: res.exceptionDetails.text || "exception" };
  }
  return { value: res.result.value };
}

const READ_ALL = `(() => {
  const el = [...document.querySelectorAll('*')].find(e => e.__vue_app__);
  if (!el) return { error: 'no vue app' };
  const pinia = el.__vue_app__.config.globalProperties.$pinia;
  const get = (id) => {
    const s = [...pinia._s.entries()].find(([k]) => k === id);
    return s ? JSON.parse(JSON.stringify(s[1].$state)) : null;
  };
  const ship = get('ShipStore');
  const cats = get('CatalystStore');
  const craft = get('CraftStore');
  const cur = get('CurrencyStore');
  const user = get('UserStore');
  const sq = get('squadronStore');
  const petsS = get('PetsStore');
  const prem = get('PremiumStore');
  const mat = get('MaterialsStore');
  const voy = get('Voyager');
  const battleS = get('BattleStore');
  const gatherS = get('GatherStore');
  const exploreS = get('ExploreStore');
  const gboosts = get('GlobalBoostsStore');
  const lab = get('LaboratoryStore');
  const baseS = get('BaseBuildingStore');
  const gameS = get('GameStore');
  const dq = get('DailyQuestsStore');
  if (!ship || !cats) return { error: 'missing stores' };
  const p = user && user.player ? user.player : null;
  // Self-healing price listener: the game's trainer pages request
  // getNextDroidPrice / getNextClonePrice when opened; responses arrive on
  // the event bus. Cache them so the advisor can read the current prices.
  let prices = {};
  try {
    if (!window.__priceCacheInstalled) {
      const gp = el.__vue_app__.config.globalProperties;
      window.__priceCache = {};
      window.__priceCacheInstalled = true;
      gp.$eventBus.$on('socketMessage', (msg) => {
        try {
          const s = JSON.stringify(msg);
          if (s.includes('getNextDroidPrice')) window.__priceCache.droid = msg.value !== undefined ? msg.value : undefined;
          if (s.includes('getNextClonePrice')) window.__priceCache.clone = msg.value !== undefined ? msg.value : undefined;
        } catch (e) {}
      });
    }
    prices = window.__priceCache || {};
  } catch (e) { prices = {}; }
  return JSON.stringify({
    ship: {
      weapon_slot: ship.weapon_slot, shield_slot: ship.shield_slot,
      engine_slot: ship.engine_slot, sensors_slot: ship.sensors_slot,
      laser_slot: ship.laser_slot, probes_slot: ship.probes_slot,
    },
    catalysts: cats.catalysts || [],
    craft: {
      crafting_level: craft ? craft.crafting_level : 1,
      crafting_current_xp: craft ? craft.crafting_current_xp : 0,
      crafting_target_xp: craft ? craft.crafting_target_xp : 0,
    },
    dust: cur ? cur.cosmic_dust : 0,
    catalyst_parts: cur ? cur.catalyst_parts : 0,
    quantum_cores: cur ? cur.quantum_cores : 0,
    credits: cur ? cur.credits : 0,
    commonResources: cur ? {
      copper: cur.copper, gold: cur.gold, platinum: cur.platinum, silver: cur.silver,
      carbon: cur.carbon, nitrogen: cur.nitrogen, sulfur: cur.sulfur, water: cur.water,
      ammonia: cur.ammonia, helium: cur.helium, hydrogen: cur.hydrogen, methane: cur.methane,
      diamond: cur.diamond, emerald: cur.emerald, ruby: cur.ruby, sapphire: cur.sapphire,
    } : null,
    // Rare gathering currencies consumed by the lab (Circuit Integration
    // Facility, Energetic Fusion Center).
    rareCurrencies: cur ? {
      silicon: cur.silicon, cobalt: cur.cobalt, argon: cur.argon, dark_matter: cur.dark_matter,
    } : null,
    pets: petsS ? {
      pets: petsS.pets || [],
      petSlots: petsS.petSlots || [],
      premiumActive: prem ? !!prem.active : false,
      petFood: (mat && mat.materialsList)
        ? (((mat.materialsList.filter(function (x) { return x.item && x.item.name === 'pet food'; })[0]) || {}).quantity || 0)
        : 0,
    } : null,
    droids: p && p.droids ? p.droids : [],
    prices: { droid: prices.droid, clone: prices.clone },
    blueprints: (craft && craft.blueprints) ? craft.blueprints.map(function (b) {
      const item = b.item || {};
      return {
        name: item.name, rarity: item.rarity, category_type: item.category_type,
        currency_use: item.currency_use || [], material_use: item.material_use || [],
        scraps_use: item.scraps_use, charges: item.charges,
        quantity: b.quantity, locked: !!item.locked, enhanced: !!item.enhanced,
      };
    }) : [],
    materials: (mat && mat.materialsList) ? mat.materialsList.map(function (m) {
      return { name: m.item && m.item.name, quantity: m.quantity };
    }) : [],
    voyager: voy ? { max_fuel: voy.max_fuel, max_jumps: voy.max_jumps, current_fuel: voy.current_fuel } : null,
    // Laboratory: live building chain (inputs, per-unit input amount,
    // output, base timer, level), the running queues, and the queue-slot
    // pool (4 standard, 6 premium, plus purchased extra slots).
    lab: lab ? {
      buildings: (lab.buildings || []).map(function (b) {
        return {
          building: b.building, level: b.level || 0,
          currency_use: b.currency_use || [], material_use: b.material_use || [],
          produce: b.produce || [], input: b.input, output: b.output || 1, timer: b.timer,
        };
      }),
      queue: lab.labQueue || [],
      queueSlots: ((prem && prem.active) ? 6 : 4) + ((user && user.additionalQueueSlots) || 0),
    } : null,
    // Base building (null until a base is founded) and the base-tier lab
    // buildings (Aeroforge etc.; the list and nextBaseCost only populate
    // after the in-game Laboratory panel has been opened once).
    base: baseS && baseS.base ? baseS.base : null,
    baseLab: {
      buildings: (lab && Array.isArray(lab.base)) ? lab.base.map(function (b) {
        return {
          building: b.building, level: b.level || 0,
          currency_use: b.currency_use || [], material_use: b.material_use || [],
          produce: b.produce || [], input: b.input, output: b.output || 1, timer: b.timer,
        };
      }) : [],
      nextBaseCost: lab ? (lab.nextBaseCost || 0) : 0,
      nextBuildingCost: lab ? (lab.nextBuildingCost || 0) : 0,
    },
    // Lifetime credits earned + registration time: the base upkeep formula
    // divides one by the other.
    account: {
      registered: user ? (user.registered || 0) : 0,
      lifetimeCredits: (p && p.statistics && p.statistics.credits && p.statistics.credits.$numberDecimal !== undefined)
        ? Number(p.statistics.credits.$numberDecimal) : ((p && p.statistics && typeof p.statistics.credits === 'number') ? p.statistics.credits : 0),
    },
    // Daily quests: how many are claimed today (feeds the upkeep coverage
    // estimate) vs merely completed but unclaimed.
    dailyQuests: dq && Array.isArray(dq.quests) ? { claimed: dq.quests.filter(function (q) { return q && q.claimed; }).length, completed: dq.quests.filter(function (q) { return q && q.completed; }).length, total: dq.quests.length } : null,
    currentSystem: (exploreS && exploreS.currentSystem) ? {
      name: exploreS.currentSystem.name, star: exploreS.currentSystem.star,
      bodies: (exploreS.currentSystem.bodies || []).map(function (b) { return b.type; }),
    } : null,
    bookmarks: (exploreS && Array.isArray(exploreS.bookmarks)) ? exploreS.bookmarks
      .filter(function (b) { return b && b.system; })
      .map(function (b) {
        return { name: b.system.name, star: b.system.star, bodies: (b.system.bodies || []).map(function (x) { return x.type; }) };
      }) : [],
    gameVersion: gameS ? (gameS.patchVersion || null) : null,
    // Basename of the client bundle the page actually loaded: the formula
    // provenance check compares it with the bundle the constants came from.
    clientBundle: (function () {
      try {
        var srcs = Array.prototype.map.call(document.scripts, function (sc) { return sc.src || ""; });
        var hit = srcs.filter(function (u) { return /index-[A-Za-z0-9_-]+\.js/.test(u); })[0];
        return hit ? hit.split("/").pop() : null;
      } catch (e) { return null; }
    })(),
    skillLevels: {
      battling: battleS ? battleS.battling_level : null,
      gathering: gatherS ? gatherS.gathering_level : null,
      exploring: exploreS ? exploreS.exploring_level : null,
    },
    ssBattlingBoost: (sq && typeof sq.effectiveSSBattlingBoost === "number") ? sq.effectiveSSBattlingBoost : 0,
    // squadronStore is not always populated. Substituting 0 silently strips
    // the squadron multiplier from every battle number, which looks exactly
    // like a real collapse -- and used to be written to history as one.
    ssBattlingBoostKnown: !!(sq && typeof sq.effectiveSSBattlingBoost === "number"),
    // Last gathering action: how many droids came back alive (per-droid
    // statistics on the last reward), to sanity-check the dodge formula.
    gatherLast: (gatherS && gatherS.lastReward && Array.isArray(gatherS.lastReward.statistics)) ? {
      alive: gatherS.lastReward.statistics.filter(function (d) { return d && d.alive; }).length,
      total: gatherS.lastReward.statistics.length,
    } : null,
    // Global boost timers (epoch seconds) by boost name, e.g. Cooldown/XP/
    // Income/'Drop chance'. Tier and bonus are derived from remaining time.
    globalBoosts: (gboosts && gboosts.currentBoosts) ? Object.fromEntries(
      gboosts.currentBoosts
        .filter(function (b) { return b && b.boost && b.boost.name; })
        .map(function (b) { return [b.boost.name, b.timer || 0]; })
    ) : {},
    stateReadAt: Math.floor(Date.now() / 1000),
    player: p ? {
      stats: p.stats || null,
      skills: p.skills || null,
      clones: (p.clones || []).map(c => ({
        name: c.name, critical_chance: c.critical_chance,
        critical_damage: c.critical_damage, dual_shot: c.dual_shot,
      })),
    } : null,
  });
})()`;

// Discovery is deliberately NOT keyed on the process name alone. The game is a
// single Electron build that switches language in-app (vue-i18n; the Chinese
// sidebar title is 恒星奥德赛), so the exe stays "Stellar Odyssey.exe" whatever
// language you play in -- but a renamed exe, a repack or a non-Steam copy would
// still defeat an exact-name match. So: enumerate every listening port with its
// owning process, try the most game-like candidates first, and confirm a
// candidate by asking the page itself whether it is the game.

// One PowerShell round-trip: every listening TCP port joined to its owning
// process. Lines are "port|pid|name|hasWindow|path".
const PS_LISTENERS =
  'powershell -NoProfile -Command "' +
  "$c=Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue; " +
  "$m=@{}; foreach($p in Get-Process){ $m[[int]$p.Id]=$p }; " +
  "foreach($x in $c){ $p=$m[[int]$x.OwningProcess]; if($p){ " +
  "$pa=''; try{ $pa=$p.Path }catch{}; $w=0; if($p.MainWindowTitle){ $w=1 }; " +
  "Write-Output ('{0}|{1}|{2}|{3}|{4}' -f $x.LocalPort,$p.Id,$p.ProcessName,$w,$pa) } }" +
  '"';

function listListeners() {
  let out = "";
  try {
    out = execSync(PS_LISTENERS, { encoding: "utf8", timeout: 15000 });
  } catch (_) { return []; }
  const seen = new Set();
  const rows = [];
  for (const raw of out.split(/\r?\n/)) {
    const parts = raw.trim().split("|");
    if (parts.length < 5) continue;
    const port = parseInt(parts[0], 10);
    if (!port || seen.has(port)) continue;
    seen.add(port);
    rows.push({
      port,
      pid: parts[1],
      name: parts[2] || "",
      hasWindow: parts[3] === "1",
      path: parts.slice(4).join("|"),
    });
  }
  return rows;
}

// Lower tier == more likely to be the game. Tier 0 is the historical exact-name
// match and is trusted without a page-content check; every other tier has to
// prove itself (see pageIsGame) before we hand its socket back.
function tierOf(row) {
  if (/^stellar odyssey$/i.test(row.name)) return 0;
  if (/stellar[ _-]*odyssey/i.test(row.path) || /stellar[ _-]*odyssey/i.test(row.name)) return 1;
  if (/[\\/]steamapps[\\/]/i.test(row.path)) return 2;
  if (row.hasWindow && /\.exe$/i.test(row.path)) return 3;
  return -1; // headless service: never probed
}

// Ask a candidate page whether it is the game: same Vue-app + Pinia handle the
// real read uses, so anything that answers this is something READ_ALL can read.
async function pageIsGame(wsUrl) {
  let cdp = null;
  try {
    cdp = new CDP(wsUrl);
    await cdp.open();
    const r = await evalInPage(cdp, "(()=>{try{" +
      "const el=[...document.querySelectorAll('*')].find(e=>e.__vue_app__);" +
      "if(!el)return false;" +
      "const pinia=el.__vue_app__.config.globalProperties.$pinia;if(!pinia)return false;" +
      "const ids=[...pinia._s.keys()];" +
      "return ids.includes('ShipStore')&&ids.includes('CatalystStore');" +
      "}catch(e){return false}})()");
    return r.value === true;
  } catch (_) {
    return false;
  } finally {
    if (cdp) cdp.close();
  }
}

// Returns { url, reason }. url is null on failure; reason says which stage gave
// out, so the caller can report something better than "game not found".
async function discoverGame() {
  const rows = listListeners();
  if (!rows.length) {
    return { url: null, reason: "could not enumerate listening ports (PowerShell/Get-NetTCPConnection blocked?)" };
  }

  const candidates = rows
    .map(r => ({ ...r, tier: tierOf(r) }))
    .filter(r => r.tier >= 0)
    .sort((a, b) => a.tier - b.tier || a.port - b.port)
    .slice(0, 32); // bound the scan; the game is never buried this deep

  if (!candidates.length) {
    return { url: null, reason: "no windowed application is listening on a TCP port (is the game running with --remote-debugging-port?)" };
  }

  let sawCdp = false;
  for (const c of candidates) {
    const targets = await fetchJson(`http://127.0.0.1:${c.port}/json/list`);
    if (!Array.isArray(targets)) continue;
    sawCdp = true;
    for (const page of targets.filter(t => t.type === "page" && t.webSocketDebuggerUrl)) {
      if (c.tier === 0) return { url: page.webSocketDebuggerUrl, reason: null };
      if (await pageIsGame(page.webSocketDebuggerUrl)) return { url: page.webSocketDebuggerUrl, reason: null };
    }
  }

  return {
    url: null,
    reason: sawCdp
      ? "a debug port is open but no page on it is the game (logged in and past the loading screen?)"
      : "no debug port found (the game opens one on its own - is it running? if it is, pin a port with %command% --remote-debugging-port=8788 in the Steam launch options)",
  };
}

async function discoverGameWsUrl() {
  return (await discoverGame()).url;
}

function fetchJson(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 3000 }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (_) { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

// Read raw game state. Throws on failure.
async function readGameState() {
  const { url, reason } = await discoverGame();
  if (!url) throw new Error("game not found: " + reason);
  const cdp = new CDP(url);
  await cdp.open();
  try {
    await cdp.send("Runtime.enable");
    const st = await evalInPage(cdp, READ_ALL);
    if (st.error) throw new Error("state error: " + st.error);
    return JSON.parse(st.value);
  } finally {
    cdp.close();
  }
}

module.exports = {
  CDP, evalInPage, READ_ALL, fetchJson, readGameState,
  discoverGame, discoverGameWsUrl,
  // Exported for diagnose-connection.js so the diagnostic reports on the same
  // enumeration and ranking the real discovery uses, instead of a copy of it.
  listListeners, tierOf, pageIsGame,
};
