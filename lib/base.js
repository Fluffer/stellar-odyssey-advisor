// Base planner adapter: turns raw game state into BaseMath.planBase input
// and the `base` block of the analyze payload. The browser re-runs
// BaseMath.planBase on `input` when level boxes or the star selector change.
const BaseMath = require("../public/base-math.js");
const { stocksFromState } = require("./lab.js");
const { statTotalsByContext } = require("./installs.js");

function starInfo(name) {
  const s = BaseMath.STAR_BONUSES[name];
  return s ? { star: name, rate: s.rate, efficiency: s.efficiency, rare: s.rare } : { star: name || null, rate: 0, efficiency: 0, rare: false };
}

function buildBaseInput(state, opts) {
  opts = opts || {};
  const live = BaseMath.normalizeBase(state.base);
  const modules = live ? live.modules : BaseMath.defaultModules();
  const account = state.account || {};
  const now = opts.now || Math.floor(Date.now() / 1000);
  const avgDaily = BaseMath.avgDailyIncome(account.lifetimeCredits, account.registered, now);
  let upkeepReduction = 0;
  try {
    const totals = state.ship ? statTotalsByContext(state.ship) : {};
    upkeepReduction = (totals.default || {}).base_upkeep_reduction || 0;
  } catch (e) { upkeepReduction = 0; }
  if (live && live.upkeepReduction) upkeepReduction = live.upkeepReduction;
  const chainBuildings = [
    ...((state.lab && Array.isArray(state.lab.buildings)) ? state.lab.buildings : []),
    ...((state.baseLab && Array.isArray(state.baseLab.buildings)) ? state.baseLab.buildings : []),
  ];
  const queueSlots = state.lab ? (state.lab.queueSlots || 0) : 0;
  const queueInUse = state.lab && Array.isArray(state.lab.queue) ? state.lab.queue.length : 0;
  const cur = state.currentSystem || {};
  const chosenStar = opts.star || cur.star || null;
  return {
    modules, founded: !!live, stellarium: live ? live.stellarium : 0,
    levels: opts.levels || {},
    starName: chosenStar, starRate: starInfo(chosenStar).rate,
    stocks: stocksFromState(state),
    chainBuildings, freeSlots: Math.max(0, queueSlots - queueInUse),
    avgDaily, efficiencyBoost: (state.player && state.player.skills && state.player.skills.base_module_efficiency_boost) || 0,
    upkeepReduction, pvpBaseBoost: 0,
    // `|| fallback` would swallow an explicit 0 from the GUI box and silently
    // restore the stale store value -- understating net upkeep. Test for the
    // key the same way questsKnown does two lines down.
    questsClaimed: opts.questsClaimed !== undefined
      ? Number(opts.questsClaimed) || 0
      : (state.dailyQuests ? Number(state.dailyQuests.claimed) || 0 : 0),
    // The store only populates once the daily quests panel has been opened
    // in-game; an empty list is "unknown", not "nothing claimed".
    questsKnown: opts.questsClaimed !== undefined
      ? true
      : !!(state.dailyQuests && Number(state.dailyQuests.total) > 0),
  };
}

function planBaseFromState(state, opts) {
  opts = opts || {};
  const live = BaseMath.normalizeBase(state.base);
  const input = buildBaseInput(state, opts);
  const plan = BaseMath.planBase(input);
  const account = state.account || {};
  const now = opts.now || Math.floor(Date.now() / 1000);

  const stocks = input.stocks;
  const bundle = BaseMath.FOUNDING_BUNDLE.map(b => ({ product: b.product, units: b.units, have: stocks[b.product] || 0 }));
  const founding = { bundle, ready: bundle.every(b => b.have >= b.units) };

  const cur = state.currentSystem || {};
  const current = { name: cur.name || null, ...starInfo(cur.star) };
  const bookmarks = (state.bookmarks || []).map(b => ({ name: b.name || null, ...starInfo(b.star) }));
  const candidates = [current, ...bookmarks].filter(c => c.rate > 0);
  const best = candidates.length ? candidates.reduce((a, b) => (b.rate > a.rate ? b : a)) : null;
  const chosenBookmark = bookmarks.find(b => b.star === input.starName);
  const chosenName = input.starName === cur.star ? current.name : (chosenBookmark ? chosenBookmark.name : null);
  const chosen = { name: chosenName, ...starInfo(input.starName) };
  const bodies = (cur.bodies || []).map(type => ({ type, activity: BaseMath.BODY_BONUSES[type] || null }));
  const location = { current, bookmarks, best, chosen, bodies };

  let liveBlock = null;
  if (live) {
    const eff = input.efficiencyBoost;
    const modules = live.modules.map(m => ({
      name: m.name, unlocked: m.unlocked, level: m.level, tier: m.tier, active: m.active,
      boost: BaseMath.moduleBoost(m, eff), output: BaseMath.expectedOutputPerTick(m, eff),
      nextLevelCost: BaseMath.levelCost(m.level + 1), nextTierCost: BaseMath.tierCost(m.tier), materials: m.materials,
    }));
    const next = plan.unlocks.find(u => !u.unlocked) || null;
    const perDay = plan.stellariumPerDay;
    liveBlock = {
      name: live.name, stellarium: live.stellarium, nextStellariumTick: live.nextStellariumTick, modules,
      nextUnlock: next ? { name: next.name, cost: next.cost, etaDays: next.cost <= live.stellarium ? 0 : (perDay > 0 ? (next.cost - live.stellarium) / perDay : Infinity), estimate: true } : null,
    };
  }

  const baseLab = state.baseLab || {};
  const labPanelHint = !(Array.isArray(baseLab.buildings) && baseLab.buildings.length) && !(baseLab.nextBaseCost > 0);
  const liveVersion = state.gameVersion || null;
  const liveBundle = state.clientBundle || null;
  return {
    phase: live ? "live" : "pre",
    // Drift = the page loaded a different client bundle than the one the
    // formulas were extracted from. patchVersion is server-side and changes
    // without a client update, so it is shown but never used for drift.
    provenance: { client: BaseMath.PROVENANCE.client, bundle: BaseMath.PROVENANCE.bundle, live: liveVersion, liveBundle, drift: !!(liveBundle && liveBundle !== BaseMath.PROVENANCE.bundle) },
    founding, location, input, plan, live: liveBlock, labPanelHint,
    // What avgDaily is actually made of. It is NOT a recent or battle-only
    // income figure: the game's own base upkeep card divides lifetime credits
    // earned by the age of the account, and the advisor mirrors that exactly.
    // `recent`, when present, is filled in by the server from the history log
    // (see recentIncome in advisor-server.js) and is the observed rate.
    income: {
      lifetimeCredits: Number(account.lifetimeCredits) || 0,
      registered: Number(account.registered) || 0,
      accountDays: Math.max(0, (now - (Number(account.registered) || now)) / 86400),
      avgDaily: input.avgDaily,
      recent: null,
    },
  };
}

module.exports = { buildBaseInput, planBaseFromState };
