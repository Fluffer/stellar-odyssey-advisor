// ---- Voyager upgrade emulator ----
// "What does it cost to buy N of each Voyager upgrade, and what does the
// Voyager do afterwards?" All the cost math is window.VoyagerMath
// (public/voyager-math.js), the same module the server-side planner uses,
// so the emulator charges exactly what the game charges. The plan (how many
// of each upgrade) is remembered in this browser.
const VOY_EMU_KEY = 'advisor-voyager-plan';
const VOY_UPGRADES = [
  { key: 'timer', currency: 'dust', labelKey: 'voy.up_timer' },
  { key: 'jumps', currency: 'qc', labelKey: 'voy.up_jumps' },
  { key: 'fuel', currency: 'qc', labelKey: 'voy.up_fuel', icon: 'fuel' },
  { key: 'reward', currency: 'credits', labelKey: 'voy.up_reward' },
];
const VOY_CURRENCY_ICON = { dust: 'dust', qc: 'quantum_cores', credits: 'credits' };

function voyPlan() {
  try {
    const v = JSON.parse(localStorage.getItem(VOY_EMU_KEY) || 'null');
    if (v && typeof v === 'object') return v;
  } catch {}
  return {};
}
function voySavePlan(plan) {
  try { localStorage.setItem(VOY_EMU_KEY, JSON.stringify(plan)); } catch {}
}
function setVoyPlan(key, value) {
  const plan = voyPlan();
  const n = Math.floor(Number(value));
  plan[key] = isFinite(n) && n > 0 ? n : 0;
  voySavePlan(plan);
  drawVoyEmu();
}
function maxVoyPlan(key) {
  const e = voyEmulate();
  if (e) setVoyPlan(key, e.maxAffordable[key]);
}
function resetVoyPlan() {
  voySavePlan({});
  drawVoyEmu();
}
function voyData() {
  return window.lastData && window.lastData.voyager && window.lastData.voyager.available
    ? window.lastData.voyager : null;
}
function voyEmulate() {
  const v = voyData();
  if (!v || !window.VoyagerMath) return null;
  return window.VoyagerMath.emulate(v.current, voyPlan(), v.stocks, v.bonuses);
}
function drawVoyEmu() {
  const el = document.getElementById('voy-emu');
  if (el) el.innerHTML = voyEmuHtml();
}
// Seconds as "Xh Ym" / "Xm Ys".
function fmtDur(sec) {
  const s = Math.round(sec);
  if (s >= 3600) return Math.floor(s / 3600) + 'h ' + Math.round((s % 3600) / 60) + 'm';
  return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
}
function voyCurrencyLabel(c) {
  return c === 'dust' ? t('voy.card_dust') : c === 'qc' ? t('voy.card_qc') : t('voy.card_credits');
}

// A detail line under a card's value, on its own line (nothing when empty).
function voySub(text) { return text ? '<div style="font-size:11px;color:var(--dim);font-weight:400;margin-top:2px">' + text + '</div>' : ''; }

function renderVoyager(v) {
  let html = '';
  if (!v || !v.available) {
    return '<div class="row"><span style="color:var(--dim)">' + t('voy.unavailable') + '</span></div>';
  }
  const c = v.current, st = v.stats, b = v.bonuses;
  html += '<div class="cards">';
  html += card(t('voy.card_travel'), fmtDur(st.travelSec) +
    voySub(t('voy.travel_detail', { bought: c.timer, max: v.caps.maxTimerUpgrade })));
  html += card(t('voy.card_jumps'), st.jumps +
    voySub(st.jumpsBonus > 0 ? t('voy.jumps_detail', { base: c.max_jumps, cap: v.caps.maxJumps, bonus: st.jumpsBonus })
      : t('voy.jumps_detail_nobonus', { base: c.max_jumps, cap: v.caps.maxJumps })));
  html += card(cardIcon(resIcon('fuel', 'mat-tile xs'), t('voy.card_tank')), fmtC(c.max_fuel) +
    voySub(t('voy.tank_detail', { cur: fmtC(c.current_fuel) })));
  html += card(t('voy.card_reward'), '+' + c.reward_bonus + '%' +
    voySub((v.techRewardLevel !== null ? t('voy.reward_detail', { n: v.techRewardLevel }) : '')));
  html += card(cardIcon(resIcon('dust', 'mat-tile xs'), t('voy.card_dust')), fmtC(v.stocks.dust));
  html += card(cardIcon(resIcon('quantum_cores', 'mat-tile xs'), t('voy.card_qc')), fmtC(v.stocks.qc));
  html += card(cardIcon(resIcon('credits', 'mat-tile xs'), t('voy.card_credits')), fmtC(v.stocks.credits));
  html += '</div>';
  html += '<div class="sub">' + t('voy.bonus_note', {
    jumps: st.jumpsBonus, fuel: Math.min(v.caps.fuelEffCap, b.fuelEfficiency).toFixed(1), drop: b.dropChance.toFixed(1),
  }) + '</div>';

  html += '<h2>' + t('voy.h_emulator') + '</h2>';
  html += '<div class="sub">' + t('voy.emu_note') + '</div>';
  html += '<div id="voy-emu">' + voyEmuHtml() + '</div>';
  return html;
}

function voyEmuHtml() {
  const v = voyData();
  const e = voyEmulate();
  if (!v || !e) return '';
  const c = v.current;
  const currentText = {
    timer: c.timer + ' / ' + v.caps.maxTimerUpgrade,
    jumps: c.max_jumps + ' / ' + v.caps.maxJumps,
    fuel: fmtC(c.max_fuel),
    reward: '+' + c.reward_bonus + '%',
  };
  const costOf = { timer: e.costs.dust, jumps: e.costs.qcJumps, fuel: e.costs.qcFuel, reward: e.costs.credits };
  const rows = VOY_UPGRADES.map(u => ({
    key: u.key, currency: u.currency, label: t(u.labelKey), icon: u.icon || null,
    current: currentText[u.key], next: e.nextCost[u.key], max: e.maxAffordable[u.key],
    plan: e.plan[u.key], cost: costOf[u.key],
  }));
  const cols = [
    { label: t('voy.col_upgrade'), numeric: false, getValue: r => r.label,
      render: r => '<span class="inv-stat">' + (r.icon ? resIcon(r.icon, 'mat-tile xs') : '') + '<b>' + esc(r.label) + '</b></span>' },
    { label: t('voy.col_current'), numeric: false, getValue: r => r.current, render: r => esc(r.current) },
    { label: t('voy.col_next'), numeric: true, getValue: r => r.next === null ? -1 : r.next,
      render: r => r.next === null ? '<span style="color:var(--dim)">' + t('voy.maxed') + '</span>'
        : '<span class="inv-stat">' + resIcon(VOY_CURRENCY_ICON[r.currency], 'mat-tile xs') + fmtC(r.next) + '</span>' },
    { label: t('voy.col_max_affordable'), numeric: true, getValue: r => r.max,
      render: r => r.next === null ? '-' : r.max === 0 ? '<span style="color:var(--dim)">' + t('common.none') + '</span>'
        : fmtC(r.max) + ' <button class="ghost" style="padding:1px 6px;font-size:11px" onclick="maxVoyPlan(' + jsStr(r.key) + ')">' + t('voy.max_btn') + '</button>' },
    { label: t('voy.col_plan'), numeric: true, getValue: r => r.plan,
      render: r => r.next === null ? '-' : '<input class="pet-input base-input" type="number" min="0" step="1" value="' + r.plan +
        '" onchange="setVoyPlan(' + jsStr(r.key) + ', this.value)">' },
    { label: t('voy.col_cost'), numeric: true, getValue: r => r.cost,
      render: r => r.cost > 0 ? '<span class="inv-stat">' + resIcon(VOY_CURRENCY_ICON[r.currency], 'mat-tile xs') + fmtC(r.cost) + '</span>' : '0' },
  ];
  let html = tableHtml('tbl-voy-plan', rows, cols);
  html += '<div class="toolbar" style="margin:6px 0"><button class="ghost" onclick="resetVoyPlan()">' + t('voy.reset_btn') + '</button></div>';

  // Plan cost per currency against the stock.
  html += '<h2>' + t('voy.h_total') + '</h2><div class="cards">';
  for (const cur of ['dust', 'qc', 'credits']) {
    const cost = e.costs[cur], stock = v.stocks[cur], ok = e.affordable[cur];
    html += card(cardIcon(resIcon(VOY_CURRENCY_ICON[cur], 'mat-tile xs'), voyCurrencyLabel(cur)),
      '<span style="color:' + (cost === 0 ? 'var(--dim)' : ok ? 'var(--good)' : 'var(--bad)') + '">' + fmtC(cost) + '</span>' +
      '<span style="font-size:11px;color:var(--dim)">' + t('voy.of_stock', { n: fmtC(stock) }) +
      (ok ? '' : ' &middot; ' + t('voy.not_affordable', { n: fmtC(cost - stock) })) + '</span>');
  }
  html += '</div>';

  // Before -> after.
  const B = e.before, A = e.after;
  const tank = s => s.tankCovers ? '<span style="color:var(--good)">' + t('voy.tank_ok', { n: s.jumpsTankCovers }) + '</span>'
    : '<span style="color:var(--bad)">' + t('voy.tank_short', { n: s.jumpsTankCovers }) + '</span>';
  const metrics = [
    { label: t('voy.m_travel'), before: fmtDur(B.travelSec), after: fmtDur(A.travelSec), changed: B.travelSec !== A.travelSec },
    { label: t('voy.m_jumps'), before: String(B.jumps), after: String(A.jumps), changed: B.jumps !== A.jumps },
    { label: t('voy.m_expedition'), before: fmtDur(B.expeditionSec), after: fmtDur(A.expeditionSec), changed: B.expeditionSec !== A.expeditionSec },
    { label: t('voy.m_fuel'), icon: 'fuel', before: fmtC(B.fuelPerExpedition), after: fmtC(A.fuelPerExpedition), changed: B.fuelPerExpedition !== A.fuelPerExpedition },
    { label: t('voy.m_tank'), before: tank(B), after: tank(A), changed: B.tankCovers !== A.tankCovers || B.jumpsTankCovers !== A.jumpsTankCovers, html: true },
    { label: t('voy.m_systems'), before: B.systemsPerDay.toFixed(1), after: A.systemsPerDay.toFixed(1), changed: B.systemsPerDay !== A.systemsPerDay },
    { label: t('voy.m_catalysts'), before: B.catalystsPerDay.toFixed(2), after: A.catalystsPerDay.toFixed(2), changed: B.catalystsPerDay !== A.catalystsPerDay },
    { label: t('voy.m_dust'), before: '&times;' + B.dustFactor.toFixed(2), after: '&times;' + A.dustFactor.toFixed(2), changed: B.dustFactor !== A.dustFactor, html: true },
  ];
  const mcols = [
    { label: t('voy.col_metric'), numeric: false, getValue: r => r.label,
      render: r => '<span class="inv-stat">' + (r.icon ? resIcon(r.icon, 'mat-tile xs') : '') + '<b>' + esc(r.label) + '</b></span>' },
    { label: t('voy.col_before'), numeric: false, getValue: r => r.before, render: r => r.html ? r.before : esc(r.before) },
    { label: t('voy.col_after'), numeric: false, getValue: r => r.after,
      render: r => (r.changed ? '<b style="color:var(--good)">' : '<span style="color:var(--dim)">') + (r.html ? r.after : esc(r.after)) + (r.changed ? '</b>' : '</span>') },
  ];
  html += '<h2>' + t('voy.h_result') + '</h2>';
  html += '<div class="sub">' + t('voy.result_note') + '</div>';
  html += tableHtml('tbl-voy-result', metrics, mcols);
  return html;
}
