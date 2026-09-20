// ---- Base planner ----
function baseLevels() {
  try { const v = JSON.parse(localStorage.getItem('advisor-base-levels') || 'null'); if (v && typeof v === 'object') return v; } catch {}
  return {};
}
function setBaseLevel(name, v) {
  const levels = baseLevels();
  const n = Math.max(0, Math.floor(Number(v) || 0));
  levels[name] = n;
  try { localStorage.setItem('advisor-base-levels', JSON.stringify(levels)); } catch {}
  if (window.lastData) render(window.lastData);
}
function fmtDays(d) {
  if (d === null || d === undefined || !isFinite(d)) return '?';
  if (d < 1) return t('base.time_h', { n: Math.round(d * 24) });
  return t('base.time_d', { n: d.toFixed(1) });
}
// Recompute the plan client-side from the payload input with the stored
// level boxes applied.
// The Quantum server emulator's scenario is laid over the plan too: its
// module-efficiency skill level lifts every module's boost at target, and
// its tier is the Quantum server's. `planLive` is the plan at the live
// values, for the figures that describe now rather than the scenario.
function basePlanFor(b) {
  const BM = window.BaseMath;
  const levels = Object.assign({}, b.input.levels || {}, baseLevels());
  const qc = baseQcEmuState(b);
  const emulated = qc.efficiency !== qc.now.efficiency || qc.tier !== qc.now.tier;
  const modules = (b.input.modules || []).map(m => m.name === 'Quantum server' ? Object.assign({}, m, { tier: qc.tier }) : m);
  const input = Object.assign({}, b.input, { levels, modules, efficiencyBoost: qc.efficiency });
  const plan = BM.planBase(input);
  return { plan, levels, planLive: emulated ? BM.planBase(Object.assign({}, b.input, { levels })) : plan, qc, emulated };
}
function baseShortfallCount(b) {
  if (!b || !b.plan) return 0;
  return basePlanFor(b).plan.stockpile.filter(s => s.short > 0).length;
}
function renderBase(b) {
  if (!b) return '<div class="empty-note">' + t('base.empty') + '</div>';
  const BM = window.BaseMath;
  const { plan, planLive, qc, emulated } = basePlanFor(b);
  setTabCount('base', plan.stockpile.filter(s => s.short > 0).length, true);
  let html = '';
  // The bundle the formulas were read from is only worth showing when the game has moved past it.
  html += '<div class="sub">' + (b.provenance.drift ? '<span class="drift">' + t('base.drift', { bundle: esc(String(b.provenance.liveBundle)), from: esc(String(b.provenance.bundle)) }) + '</span> ' : '') +
    t('base.income_note') + '</div>';

  // --- cards ---
  html += '<div class="cards">';
  html += card(t('base.card_phase'), b.phase === 'live' ? '<span style="color:var(--good)">' + t('base.phase_live') + '</span>' : t('base.phase_pre'));
  // Founding readiness only matters before the base exists.
  if (b.phase !== 'live' && b.founding) {
    const readyCount = b.founding.bundle.filter(x => x.have >= x.units).length;
    html += card(t('base.card_founding_materials'), (readyCount === b.founding.bundle.length ? '<span style="color:var(--good)">' : '<span style="color:var(--warn)">') + readyCount + ' / ' + b.founding.bundle.length + '</span>');
  }
  if (b.live && b.live.bodyType) {
    // Founded: the site is fixed, show the body and the XP it grants.
    html += card(t('base.card_body'), esc(b.live.bodyType) + (b.live.bodyActivity ? ' &rarr; +10% ' + esc(itemSkillLabel(b.live.bodyActivity)) : ''));
  }
  // The game's own drop rate: 1 + boost/100 per drop, one drop every 5 h.
  html += card(cardIcon(resIcon('stellarium', 'mat-tile xs'), t('base.card_stellarium_day')),
    plan.stellariumPerDay.toFixed(1) +
    '<span class="est">' + t('base.drop_rate_chip', { n: plan.dropRate.guaranteed, p: plan.dropRate.chance }) +
    t('base.stellarium_est', { days: fmtDays(plan.daysToAllUnlocks) }) +
    t('base.stellarium_left', { n: plan.totalStellariumLeft }) + '</span>');
  const up = plan.upkeep;
  const inc = b.income || null;
  // Affordability is measured against the OBSERVED income rate. The share of
  // the billing basis is NOT a verdict: upkeep is linear in that basis, so the
  // ratio cancels it out and reads the same at any income -- it is a constant
  // of the chosen target levels, not a statement about affording them.
  const basis = function (u, unlocked) {
    const observed = inc && inc.recent ? inc.recent.perDay : 0;
    const share = observed > 0
      ? t('base.share_observed', { pct: (u.perDay / observed * 100).toFixed(1), rate: fmtC(observed) })
      : (u.shareOfIncome !== null
        ? t('base.share_basis', { pct: (u.shareOfIncome * 100).toFixed(0), rate: fmtC(b.input.avgDaily) })
        : t('base.income_unknown'));
    const quests = u.questsKnown === false
      ? t('base.quests_unknown')
      : t('base.quests_coverage', { pct: (u.coverage * 100).toFixed(0) });
    const passive = t(unlocked ? 'base.passive_modules_unlocked' : 'base.passive_modules', { n: u.passiveCount });
    return '<span class="est"> ' + share + ' &middot; ' + passive
      + ' &middot; ' + quests + t('base.net_per_day', { n: fmtC(u.netPerDay) }) + '</span>';
  };
  if (b.live && planLive.upkeepNow) {
    // "Now" is the live bill, whatever the emulator's scenario says.
    html += card(t('base.card_upkeep_now'), fmtC(planLive.upkeepNow.perDay) + basis(planLive.upkeepNow, true));
  }
  html += card(t('base.card_upkeep_targets'), fmtC(up.perDay) + basis(up, false));
  html += '</div>';
  if (inc) {
    let note = t('base.upkeep_basis', { counter: fmtC(inc.lifetimeCredits), days: (inc.accountDays || 0).toFixed(1), basis: fmtC(inc.avgDaily) });
    if (inc.recent) {
      note += t('base.observed_since', {
        when: esc(new Date(inc.recent.since).toLocaleString()),
        rate: fmtC(inc.recent.perDay),
        days: inc.recent.days.toFixed(1),
        extra: inc.avgDaily > 0 ? t('base.observed_vs_avg', { x: (inc.recent.perDay / inc.avgDaily).toFixed(2) }) : '',
      });
    } else {
      note += t('base.observed_pending');
    }
    html += '<div class="sub">' + note + '</div>';
  }
  if (up.questsKnown === false) html += '<div class="sub">' + t('base.quests_hint') + '</div>';
  if (b.labPanelHint) html += '<div class="sub">' + t('base.lab_panel_hint') + '</div>';
  // Which body to found on: moot once the base sits on one.
  if (!b.live && b.location.bodies.length) html += '<div class="sub">' + t('base.body_xp', { list: b.location.bodies.map(x =>
    bodyIcon(x.type, 'mat-tile xs') + esc(bodyLabel(x.type)) + (x.activity ? ' &rarr; ' + esc(itemSkillLabel(x.activity)) : '')).join(', ') }) + '</div>';
  html += baseSystemsHtml(b);
  html += baseStellariumHtml(b);

  // --- live block ---
  if (b.live) {
    html += '<h2>' + t('base.h_base', { name: esc(b.live.name) }) + '</h2><div class="cards">';
    if (b.live.nextUnlock) {
      // ETA counts guaranteed drops from the next tick (computed here so a
      // snapshot from before the tick timestamp was recorded still gets it);
      // the daily-rate estimate is the fallback without a tick timestamp.
      const nu = b.live.nextUnlock;
      const { drops, etaTick } = BM.unlockEta(nu.cost, b.live.stellarium, b.stellarium ? b.stellarium.minerBoost : 0, b.live.nextStellariumTick);
      const eta = drops === 0 ? t('base.affordable_now')
        : etaTick ? t(drops === 1 ? 'base.eta_next_drop' : 'base.eta_drops', { n: drops, time: fmtTick(etaTick) })
        : t('base.eta_in', { days: fmtDays(nu.etaDays) });
      html += card(t('base.card_next_unlock'), esc(moduleLabel(nu.name)) + '<span class="est">' + t('base.next_unlock_note', { cost: nu.cost, eta }) + '</span>');
    }
    html += '</div>';
    html += tableHtml('tbl-base-live', b.live.modules.filter(m => m.unlocked), [
      { label: t('base.col_module'), numeric: false, getValue: r => r.name, render: r => '<b>' + esc(moduleLabel(r.name)) + '</b>' + (r.active ? '' : ' <span style="color:var(--bad)">' + t('base.off') + '</span>') },
      { label: t('common.level'), numeric: true, getValue: r => r.level, render: r => String(r.level) },
      { label: t('base.col_tier'), numeric: true, getValue: r => r.tier, render: r => String(r.tier) },
      { label: t('base.col_boost'), numeric: true, getValue: r => r.boost, render: r => r.boost.toFixed(1) + '%' },
      { label: t('base.col_output_tick'), numeric: true, getValue: r => r.output, render: r => fmtOutput(r.output) + (r.guaranteed !== undefined && r.extraChance > 0 ? ' <span style="color:var(--dim)">' + t('base.output_split', { g: fmtOutput(r.guaranteed), pct: r.extraChance.toFixed(1) }) + '</span>' : '') },
      { label: t('base.col_produces'), numeric: false, getValue: r => (r.selection || []).join(', '), render: r => r.name === 'Stellarium miner' ? '<span class="inv-stat">' + matIcon('stellarium') + esc(materialLabel('stellarium')) + '</span>' : ((r.selection || []).length ? r.selection.map(p => '<span class="inv-stat">' + matIcon(p) + esc(materialLabel(p)) + '</span>').join(', ') + (r.selection.length > 1 ? ' <span style="color:var(--dim)">' + t('base.produces_split', { n: r.selection.length }) + '</span>' : '') : '<span style="color:var(--dim)">' + t('base.produces_none') + '</span>') },
      { label: t('base.col_output_hour'), numeric: true, getValue: r => r.tickHours ? r.output / r.tickHours : r.output, render: r => fmtOutput(r.tickHours ? r.output / r.tickHours : r.output) + (r.tickHours && r.tickHours !== 1 ? ' <span style="color:var(--dim)">' + t('base.tick_every_h', { h: r.tickHours }) + '</span>' : '') },
      { label: t('base.col_next_level'), numeric: true, getValue: r => r.nextLevelCost, render: r => fmtC(r.nextLevelCost) + t('base.of_each_colon', { list: r.materials.map(m => esc(materialLabel(m))).join(', ') }) },
      { label: t('base.col_next_tier'), numeric: true, getValue: r => r.nextTierCost, render: r => t('base.stellarium_amount', { n: r.nextTierCost }) },
    ]);
  }

  // --- modules / targets ---
  html += '<h2>' + t('base.h_modules') + '</h2><div class="sub">' + t('base.modules_note') + '</div>';
  if (emulated) html += '<div class="sub" style="color:var(--warn)">' + t('base.modules_emulated', { eff: qc.efficiency, live: qc.now.efficiency, tier: qc.tier, live_tier: qc.now.tier }) + '</div>';
  const rows = plan.unlocks.map(u => Object.assign({}, BM.MODULES.find(m => m.name === u.name) || {}, u, plan.targets.find(t => t.name === u.name) || {}));
  // A row without a target (founded: a locked module with no level set) has no cost to show.
  const targeted = r => r.to !== undefined;
  html += tableHtml('tbl-base-modules', rows, [
    { label: t('base.col_module'), numeric: false, getValue: r => r.name, render: r => '<b>' + esc(moduleLabel(r.name)) + '</b>' + (r.unlocked ? ' <span style="color:var(--good)">' + t('base.unlocked') + '</span>' : '') },
    { label: t('base.col_type'), numeric: false, getValue: r => r.type || '', render: r => esc(moduleTypeLabel(r.type || '')) },
    { label: t('base.col_unlock'), numeric: true, getValue: r => r.cost, render: r => r.unlocked ? '-' : r.cost + '<span class="est">' + t('base.unlock_est', { cum: r.cumulative, days: fmtDays(r.daysToUnlock) }) + '</span>' },
    { label: t('base.col_materials'), numeric: false, getValue: r => (r.materials || []).join(','), render: r => (r.materials || []).map(m => esc(materialLabel(m))).join(', ') },
    { label: t('base.col_target_level'), numeric: true, getValue: r => r.to || 0, render: r => '<input class="pet-input base-input" type="number" min="0" value="' + (r.to || 0) + '" onchange="setBaseLevel(' + esc(jsStr(r.name)) + ', this.value)">' + (r.from ? '<span class="est">' + t('base.from_level', { n: r.from }) + '</span>' : '') },
    { label: t('base.col_cost_to_target'), numeric: true, getValue: r => r.perMaterial || 0, render: r => targeted(r) ? fmtN(r.perMaterial || 0) + t('base.of_each') : '-' },
    { label: t('base.col_boost_at_target'), numeric: true, getValue: r => r.boostAtTarget || 0, render: r => targeted(r) ? (r.boostAtTarget || 0).toFixed(0) + '%' : '-' },
    { label: t('base.col_output_at_target'), numeric: true, getValue: r => r.outputAtTarget || 0, render: r => (r.outputAtTarget === undefined ? '-' : r.outputAtTarget.toFixed(2)) },
    { label: t('base.col_upkeep_at_target'), numeric: true, getValue: r => r.upkeepPerHourAtTarget || 0, render: r => (r.type === 'active' || (b.live && !r.unlocked)) ? '-' : fmtC(r.upkeepPerHourAtTarget || 0) },
  ]);

  // --- Quantum server emulator: output at another level / tier / efficiency and the cost of each lever ---
  html += baseQcEmuSection(b);

  // --- stockpile ---
  html += '<h2>' + t('base.h_stockpile') + '</h2>';
  if (!plan.stockpile.length) return html + '<div class="sub">' + t('base.stockpile_none') + '</div>';
  html += '<div class="sub">' + t('base.stockpile_note') + '</div>';
  if (plan.buyFirst.length) html += '<div class="sub" style="color:var(--warn)">' + t('base.buy_first', { list: plan.buyFirst.map(n => esc(moduleLabel(n))).join(', ') }) + '</div>';
  html += tableHtml('tbl-base-stock', plan.stockpile, [
    { label: t('base.col_material'), numeric: false, getValue: r => r.material,
      render: r => '<span class="inv-stat">' + matIcon(r.material) + '<b>' + esc(materialLabel(r.material)) + '</b></span>' },
    { label: t('base.col_needed'), numeric: true, getValue: r => r.needed, render: r => fmtN(r.needed) },
    { label: t('base.col_stock'), numeric: true, getValue: r => r.stock, render: r => fmtN(r.stock) },
    { label: t('common.short'), numeric: true, getValue: r => r.short, render: r => r.short > 0 ? '<span style="color:var(--bad)">' + fmtN(r.short) + '</span>' : '<span style="color:var(--good)">0</span>' },
    { label: t('base.col_for'), numeric: false, getValue: r => r.modules.length, render: r => r.modules.map(n => esc(moduleLabel(n))).join(', ') },
    { label: t('base.col_produced_by'), numeric: false, getValue: r => r.building || '', render: r => r.bought ? esc(moduleLabel(r.building || '')) : '<span style="color:var(--warn)">' + t('base.buy_building_first', { name: esc(moduleLabel(r.building || '?')) }) + '</span><span class="est">' + t('base.consumes', { list: r.inputs.map(m => esc(materialLabel(m))).join(', ') }) + '</span>' },
    { label: t('base.col_chain_time'), numeric: true, getValue: r => r.hoursPipelined === null ? -1 : r.hoursPipelined, render: r => r.hoursPipelined === null ? '-' : fmtHours(r.hoursPipelined) + (r.binding ? '<span style="color:var(--bad)">' + t('base.binding_pct', { name: esc(materialLabel(r.binding.name)), pct: (r.binding.coverage * 100).toFixed(0) }) + '</span>' : '') },
  ]);
  return html;
}

// ---- Quantum server emulator ----
// "What does the Quantum server pay at a higher level, tier or module-
// efficiency skill level, and what does each lever cost?" The math is
// window.BaseMath.emulateModule, the same file the server-side planner
// uses. The scenario (level, tier, efficiency) is remembered in this
// browser; a stored value the game has already passed is lifted to the
// live one, and efficiency stops at the skill's 100 cap.
const BASE_QC_EMU_KEY = 'advisor-base-qc-emu';
function baseQcEmuStore() {
  try {
    const v = JSON.parse(localStorage.getItem(BASE_QC_EMU_KEY) || 'null');
    if (v && typeof v === 'object') return v;
  } catch {}
  return {};
}
function baseQcEmuSave(store) {
  try { localStorage.setItem(BASE_QC_EMU_KEY, JSON.stringify(store)); } catch {}
}
// Where the server stands now: the normalized module (level 0, locked before
// founding) and the module-efficiency skill level from the tech tree.
function baseQcEmuNow(b) {
  const m = ((b.input && b.input.modules) || []).find(x => x.name === 'Quantum server') || {};
  return {
    level: Math.max(0, Math.floor(m.level || 0)), tier: Math.max(0, Math.floor(m.tier || 0)),
    efficiency: Math.min(window.BaseMath.EFFICIENCY_MAX, Math.max(0, Math.floor((b.input && b.input.efficiencyBoost) || 0))),
    unlocked: !!m.unlocked, active: !!m.active,
  };
}
function baseQcEmuState(b) {
  const s = baseQcEmuStore();
  const now = baseQcEmuNow(b);
  const pick = (key, hi) => {
    const v = Math.floor(Number(s[key]));
    if (!isFinite(v)) return now[key];
    return Math.min(hi === undefined ? Infinity : hi, Math.max(now[key], v));
  };
  return { now, level: pick('level'), tier: pick('tier'), efficiency: pick('efficiency', window.BaseMath.EFFICIENCY_MAX) };
}
function setBaseQcEmu(field, value) {
  if (!['level', 'tier', 'efficiency'].includes(field)) return;
  const store = baseQcEmuStore();
  store[field] = Math.max(0, Math.floor(Number(value) || 0));
  baseQcEmuSave(store);
  drawBaseQcEmu();
}
function bumpBaseQcEmu(field, delta) {
  const b = window.lastData && window.lastData.base;
  if (!b) return;
  setBaseQcEmu(field, baseQcEmuState(b)[field] + delta);
}
function resetBaseQcEmu() {
  try { localStorage.removeItem(BASE_QC_EMU_KEY); } catch {}
  drawBaseQcEmu();
}
// The scenario also drives the targets table and the cards above it, so a
// change redraws the whole tab (the same way a target box does).
function drawBaseQcEmu() {
  if (window.lastData) render(window.lastData);
}
function baseQcEmuSection(b) {
  return headIcon(resIcon('quantum_cores'), t('base.qc_title')) +
    '<div class="sub">' + t('base.qc_note') + '</div>' +
    '<div id="base-qc-emu">' + baseQcEmuHtml(b) + '</div>';
}
function baseQcEmuHtml(b) {
  const BM = window.BaseMath;
  const st = baseQcEmuState(b);
  const tech = window.lastData && window.lastData.tech;
  const coresHeld = tech ? (Number(tech.quantumCores) || 0) : 0;
  const inc = tech && tech.maxOut ? tech.maxOut.income : null;
  const battling = inc && inc.battlingPerHour != null ? inc.battlingPerHour : null;
  const emu = BM.emulateModule({
    module: 'Quantum server', level: st.now.level, tier: st.now.tier, efficiency: st.now.efficiency,
    toLevel: st.level, toTier: st.tier, toEfficiency: st.efficiency, steps: 5,
  });
  const stocks = (b.input && b.input.stocks) || {};
  const material = emu.materials[0];
  const materialStock = stocks[material] || 0;
  const stellariumHeld = b.live ? (b.live.stellarium || 0) : 0;
  const changed = emu.cost.levels.n > 0 || emu.cost.tiers.n > 0 || emu.cost.efficiency.n > 0;
  const n = emu.now, s = emu.scenario;
  const arrow = (a, z, fmt) => a === z ? fmt(a)
    : '<span class="dimtext">' + fmt(a) + '</span> &rarr; <span style="color:' + (z > a ? 'var(--good)' : 'inherit') + '">' + fmt(z) + '</span>';

  let html = '';
  if (!st.now.unlocked) html += '<div class="sub" style="color:var(--warn)">' + t('base.qc_locked') + '</div>';
  else if (!st.now.active) html += '<div class="sub" style="color:var(--warn)">' + t('base.qc_off') + '</div>';

  // --- scenario controls: level, tier, efficiency, each "now -> box" plus bump buttons ---
  const ctl = (key, label, hi, bumps) => '<span>' + label + ' <span class="dimtext">' + st.now[key] + ' &rarr;</span> ' +
    '<input class="pet-input base-input" type="number" min="' + st.now[key] + '"' + (hi ? ' max="' + hi + '"' : '') + ' value="' + st[key] + '"' +
    ' onchange="setBaseQcEmu(' + jsStr(key) + ', this.value)"> ' +
    bumps.map(d => '<button class="ghost" onclick="bumpBaseQcEmu(' + jsStr(key) + ', ' + d + ')">+' + d + '</button>').join(' ') +
    (hi ? ' <button class="ghost" onclick="setBaseQcEmu(' + jsStr(key) + ', ' + hi + ')">' + t('base.qc_max_btn') + '</button>' : '') + '</span>';
  html += '<div class="row" style="gap:14px;flex-wrap:wrap">' +
    ctl('level', t('base.qc_level'), null, [10, 50, 100]) +
    ctl('tier', t('base.qc_tier'), null, [1, 5, 10]) +
    ctl('efficiency', t('base.qc_efficiency'), BM.EFFICIENCY_MAX, [5, 10]) +
    '<span><button class="ghost" onclick="resetBaseQcEmu()">' + t('units.reset') + '</button></span></div>';

  // --- headline: what the tick pays now and in the scenario, what the scenario costs ---
  html += '<div class="cards">';
  html += card(cardIcon(resIcon('quantum_cores', 'mat-tile xs'), t('base.qc_card_per_hour')),
    arrow(n.perHour, s.perHour, v => v.toFixed(2)) +
    '<span class="est">' + t('base.output_split', { g: fmtN(s.guaranteed), pct: s.extraChance.toFixed(1) }) +
    t('base.qc_boost_at', { boost: s.boost.toFixed(1) }) + '</span>');
  html += card(cardIcon(resIcon('quantum_cores', 'mat-tile xs'), t('base.qc_card_per_day')),
    arrow(n.perDay, s.perDay, v => v.toFixed(1)) +
    (battling !== null ? '<span class="est">' + (n.perHour === s.perHour
      ? t('base.qc_with_battling_same', { a: (battling + n.perHour).toFixed(2) })
      : t('base.qc_with_battling', { a: (battling + n.perHour).toFixed(2), b: (battling + s.perHour).toFixed(2) })) + '</span>' : ''));
  const costCard = (label, icon, amount, have, count, noteKey, extra) => card(cardIcon(icon, label),
    amount > 0
      ? '<span style="color:' + (amount <= have ? 'inherit' : 'var(--bad)') + '">' + fmtN(amount) + '</span>' +
        '<span class="est">' + t(noteKey, { n: count, have: fmtN(have) }) + (extra || '') + '</span>'
      : '<span style="color:var(--dim)">' + (changed ? '&mdash;' : t('base.qc_no_changes')) + '</span>');
  html += costCard(t('base.qc_card_levels_cost', { mat: esc(materialLabel(material)) }), matIcon(material), emu.cost.levels.perMaterial, materialStock, emu.cost.levels.n, 'base.qc_levels_n');
  html += costCard(t('base.qc_card_tiers_cost'), resIcon('stellarium', 'mat-tile xs'), emu.cost.tiers.stellarium, stellariumHeld, emu.cost.tiers.n, 'base.qc_tiers_n');
  const payback = emu.paybackDays === null ? ''
    : (isFinite(emu.paybackDays) ? t('base.qc_payback', { days: fmtDays(emu.paybackDays) }) : t('base.qc_no_payback'));
  html += costCard(t('base.qc_card_eff_cost'), resIcon('quantum_cores', 'mat-tile xs'), emu.cost.efficiency.cores, coresHeld, emu.cost.efficiency.n, 'base.qc_eff_n', payback);
  html += '</div>';

  // --- the next steps of the sure amount, one lever at a time, from the scenario ---
  html += '<div class="sub" style="margin:14px 0 4px">' + t('base.qc_steps_note', { boost: s.boost.toFixed(1), sure: fmtN(s.guaranteed) }) + '</div>';
  const dash = '<span style="color:var(--dim)">&mdash;</span>';
  html += tableHtml('tbl-base-qc-steps', emu.steps, [
    { label: t('base.qc_col_sure'), numeric: true, getValue: r => r.sure, render: r => '<b>' + fmtN(r.sure) + '</b>' },
    { label: t('base.qc_col_boost_needed'), numeric: true, getValue: r => r.boostNeeded, render: r => r.boostNeeded + '%' },
    { label: t('base.qc_col_via_levels'), numeric: true, getValue: r => r.viaLevels.perMaterial,
      render: r => t('base.qc_via_level', { n: r.viaLevels.level, d: r.viaLevels.delta, cost: fmtN(r.viaLevels.perMaterial), mat: esc(materialLabel(material)) }) },
    { label: t('base.qc_col_via_tiers'), numeric: true, getValue: r => r.viaTiers ? r.viaTiers.stellarium : -1,
      render: r => r.viaTiers ? t('base.qc_via_tier', { n: r.viaTiers.tier, d: r.viaTiers.delta, cost: fmtN(r.viaTiers.stellarium) }) : dash },
    { label: t('base.qc_col_via_eff'), numeric: true, getValue: r => r.viaEfficiency ? r.viaEfficiency.cores : -1,
      render: r => r.viaEfficiency ? t('base.qc_via_eff', { n: r.viaEfficiency.level, d: r.viaEfficiency.delta, cost: fmtN(r.viaEfficiency.cores) })
        : '<span style="color:var(--dim)">' + t('base.qc_beyond_cap') + '</span>' },
  ]);
  return html;
}

// ---- base tab: known systems with coordinates, and the Stellarium section ----
function fmtCoords(c) {
  if (!c) return '';
  return '[' + fmtN(c.x) + ', ' + fmtN(c.y) + (c.z !== null && c.z !== undefined ? ', ' + fmtN(c.z) : '') + ']';
}
function fmtLy(d) { return d === null || d === undefined ? '-' : fmtN(Math.round(d)) + ' LY'; }
// A game timestamp (seconds or milliseconds) as a local time plus "in Xh Ym".
function fmtTick(ts) {
  const n = Number(ts);
  if (!isFinite(n) || n <= 0) return '-';
  const ms = n < 1e12 ? n * 1000 : n;
  const left = Math.max(0, ms - Date.now());
  const h = Math.floor(left / 3600000), m = Math.round((left % 3600000) / 60000);
  return new Date(ms).toLocaleTimeString() + ' <span style="color:var(--dim)">(' + t('base.in_time', { time: h + 'h ' + m + 'm' }) + ')</span>';
}

function baseSystemsHtml(b) {
  const systems = [b.location.current].concat(b.location.bookmarks).filter(s => s && (s.name || s.star));
  if (!systems.length) return '';
  const rows = systems.map((s, i) => Object.assign({ isCurrent: i === 0 }, s));
  let html = '<h2>' + t('base.h_systems') + '</h2>';
  html += '<div class="sub">' + t('base.systems_note') + '</div>';
  html += tableHtml('tbl-base-systems', rows, [
    { label: t('base.col_system'), numeric: false, getValue: r => r.name || '', render: r => '<b>' + esc(r.name || '?') + '</b>' +
      (r.isCurrent ? ' <span style="color:var(--good)">' + t('base.here') + '</span>' : '') +
      (r.isStarter ? ' <span style="color:var(--dim)">' + t('base.starter') + '</span>' : '') },
    { label: t('base.col_star'), numeric: false, getValue: r => r.star || '', render: r => esc(r.star || '?') },
    { label: t('base.col_coords'), numeric: false, getValue: r => r.coords ? r.coords.x : '', render: r => r.coords ? fmtCoords(r.coords) : '<span style="color:var(--dim)">' + t('base.coords_unknown') + '</span>' },
    { label: t('base.col_from_here'), numeric: true, getValue: r => r.fromCurrent === null ? -1 : r.fromCurrent, render: r => fmtLy(r.fromCurrent) },
    { label: t('base.col_nearest_starter'), numeric: true, getValue: r => r.starterDistance === null ? -1 : r.starterDistance,
      render: r => r.nearestStarter ? esc(r.nearestStarter) + ' &middot; ' + fmtLy(r.starterDistance) : '-' },
  ]);
  return html;
}

function baseStellariumHtml(b) {
  const st = b.stellarium;
  if (!st) return '';
  let html = '<h2>' + t('base.h_stellarium') + '</h2>';
  html += '<div class="sub">' + t('base.stellarium_rules', { hours: st.tickHours, ticks: st.ticksPerDay.toFixed(1) }) + '</div>';
  html += '<div class="cards">';
  if (b.live) {
    html += card(cardIcon(resIcon('stellarium', 'mat-tile xs'), t('base.card_stellarium_held')), String(st.held));
    html += card(t('base.card_next_tick'), fmtTick(st.nextTick));
  }
  // A snapshot saved before the drop-rate chip existed has no dropRate;
  // /api/last serves such a snapshot until the next analyze, so derive it.
  const drop = st.dropRate || window.BaseMath.ESTIMATES.dropRate(st.minerBoost || 0);
  html += card(cardIcon(resIcon('stellarium', 'mat-tile xs'), t('base.card_per_tick')), drop.guaranteed + ' + ' + drop.chance + '%' +
    '<span class="est">' + t('base.per_tick_note', { exp: st.perTick.toFixed(2), boost: st.minerBoost.toFixed(0) }) + '</span>');
  html += card(cardIcon(resIcon('stellarium', 'mat-tile xs'), t('base.card_stellarium_day')), st.perDay.toFixed(1));
  if (st.observed) {
    html += card(cardIcon(resIcon('stellarium', 'mat-tile xs'), t('base.card_observed_drop')), fmtN(st.observed.last) +
      '<span class="est">' + t('base.observed_drop_note', { count: st.observed.count, mean: st.observed.mean.toFixed(2) }) + '</span>');
  }
  html += card(t('base.card_unlocked'), st.unlockedCount + ' / ' + (st.unlockedCount + st.lockedModules.length) +
    '<span class="est">' + t('base.unlock_left_note', { n: st.totalLeft }) + '</span>');
  html += '</div>';

  html += '<div class="sub">' + t('base.unlock_curve_note') + '</div>';
  html += '<div class="sub">' + st.unlockCurve.map(u => t('base.unlock_curve_item', { n: u.unlocked, cost: u.cost })).join(' &middot; ') + '</div>';
  html += '<div class="sub">' + t('base.tier_curve_note') + ' ' + st.tierCurve.map(x => t('base.tier_curve_item', { tier: x.tier, cost: x.cost })).join(' &middot; ') + '</div>';
  return html;
}
