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

async function discoverGameWsUrl() {
  let pids = [];
  try {
    const out = execSync(
      'powershell -NoProfile -Command "Get-Process -Name \'Stellar Odyssey\' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id"',
      { encoding: "utf8", timeout: 10000 }
    );
    pids = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  } catch (_) { pids = []; }
  if (!pids.length) return null;

  let ports = [];
  try {
    const out = execSync(
      'powershell -NoProfile -Command "Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -in @(' + pids.join(",") + ') } | Select-Object -ExpandProperty LocalPort"',
      { encoding: "utf8", timeout: 10000 }
    );
    ports = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  } catch (_) { ports = []; }

  for (const port of ports) {
    const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    if (!targets) continue;
    const page = targets.find(t => t.type === "page" && t.webSocketDebuggerUrl);
    if (page) return page.webSocketDebuggerUrl;
  }
  return null;
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
  const url = await discoverGameWsUrl();
  if (!url) throw new Error("game not found (is Stellar Odyssey running?)");
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

module.exports = { CDP, evalInPage, READ_ALL, discoverGameWsUrl, fetchJson, readGameState };
