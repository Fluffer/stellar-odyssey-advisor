// ---- Lab bottleneck planner ----
function labCapsuleTarget(fallback) {
  try {
    const v = parseInt(localStorage.getItem('advisor-lab-capsules') || '', 10);
    if (v > 0) return v;
  } catch {}
  return fallback || 10;
}
function setLabCapsules(v) {
  const n = Math.max(1, Math.floor(Number(v) || 0));
  try { localStorage.setItem('advisor-lab-capsules', String(n)); } catch {}
  if (window.lastData) render(window.lastData);
}

function covBar(coverage) {
  const tone = coverage >= 1 ? { color: 'var(--good)', width: 100 } : capTone(coverage * 100, 100);
  if (coverage < 1) tone.color = coverage >= 0.8 ? 'var(--warn)' : 'var(--bad)';
  return '<span class="covbar"><span class="covbar-fill" style="width:' + Math.min(100, coverage * 100).toFixed(0) + '%;background:' + tone.color + '"></span></span>';
}
// Builds the client-side capsule-target plan and counts short raw inputs,
// shared by the tab badge (render()) and renderLab() so the plan is
// computed once per render, not three times.
function labShortfallCount(lab) {
  const LM = window.LabMath;
  const capsules = labCapsuleTarget(lab.capsulesDefault);
  const chain = LM.buildChain(lab.chain);
  const capsuleOpts = { freeSlots: lab.freeSlots, netTopLevel: false };
  const demand = [{ product: 'warp capsule', units: capsules }];
  const plan = LM.planTarget(chain, demand, lab.stocks, capsuleOpts);
  return { plan, count: plan.raw.filter(r => r.coverage < 1).length };
}
function renderLab(lab, base) {
  if (!lab || !lab.available) {
    setTabCount('lab', 0, true);
    return '<div class="empty-note">' + t('lab.empty') + '</div>';
  }
  const baseRates = lab.baseProduction || {};
  const LM = window.LabMath;
  const capsules = labCapsuleTarget(lab.capsulesDefault);
  const chain = LM.buildChain(lab.chain);
  const opts = { freeSlots: lab.freeSlots };
  const capsuleOpts = Object.assign({ netTopLevel: false }, opts);
  const demand = [{ product: 'warp capsule', units: capsules }];
  const { plan, count: shortfallCount } = labShortfallCount(lab);
  setTabCount('lab', shortfallCount, true);
  // Founding readiness only while there is a base left to found: the server
  // drops the bundle and the founding target once the base is live, and the
  // base block's phase is the same fact seen from the other side.
  const founded = !!lab.founded || !!(base && base.phase === 'live');
  const founding = !founded && Array.isArray(lab.foundingBundle) && lab.foundingBundle.length && lab.targets ? lab.targets.baseFounding : null;
  const after = founding ? LM.planCore(chain, demand, LM.stocksAfterBundle(lab.stocks, lab.foundingBundle), capsuleOpts) : null;

  let html = '<div class="sub">' + t('lab.intro') + (founding ? ' ' + t('lab.intro_two_targets') : '') + '</div>';

  // --- cards ---
  html += '<div class="cards">';
  html += card(cardIcon(resIcon('warp_capsule', 'mat-tile xs'), t('lab.card_capsule_target')), '<input class="pet-input lab-input" type="number" min="1" value="' + capsules + '" onchange="setLabCapsules(this.value)"> ' + t('lab.capsules_in_stock', { n: fmtC(lab.capsulesInStock || 0) }));
  html += card(t('lab.card_chain_time'), fmtHours(plan.hoursPipelined) +
    '<span style="font-size:11px;color:var(--dim)">' + t('lab.chain_time_note', { n: fmtHours(plan.hoursSequential) }) + '</span>');
  if (plan.binding) {
    html += card(t('lab.card_binding'), '<span style="color:var(--bad)">' + esc(materialLabel(plan.binding.name)) + '</span> ' + covBar(plan.binding.coverage) +
      '<span style="font-size:11px;color:var(--dim)">' + t('lab.pct_covered', { n: (plan.binding.coverage * 100).toFixed(0) }) +
      ((baseRates[plan.binding.name] || 0) > 0 ? ' &middot; ' + t('lab.base_makes', { rate: fmtOutput(baseRates[plan.binding.name]) }) : '') + '</span>');
  } else {
    // plan.raw only ever holds resources the chain CANNOT produce, and in
    // every capture so far it is empty -- so an unqualified "all covered"
    // read as "no bottleneck" while the per-building table below showed
    // inputs at 0%. Scope the claim, and name what is actually binding.
    const producing = [];
    for (const b of plan.buildings || []) {
      for (const i of b.inputs || []) if (i.coverage < 1) producing.push(i.name);
    }
    html += card(t('lab.raw_resources'), '<span style="color:var(--good)">' + t('lab.all_covered') + '</span>' +
      '<span style="font-size:11px;color:var(--dim)">' + t('lab.nothing_to_gather') +
      (producing.length
        ? t(producing.length > 1 ? 'lab.inputs_first_many' : 'lab.inputs_first_one', { n: producing.length, names: esc(producing.slice(0, 3).map(m => materialLabel(m)).join(', ')) })
        : '') + '</span>');
  }
  html += card(t('lab.card_queue_slots'), t('lab.slots_free', { free: lab.freeSlots, total: lab.queueSlots }));
  html += card(t(plan.criticalGroup.length > 1 ? 'lab.card_critical_many' : 'lab.card_critical_one'), plan.criticalGroup.length ? '<span class="crit">' + plan.criticalGroup.map(n => esc(moduleLabel(n))).join(', ') + '</span>' : '-');
  html += '</div>';

  // --- per building ---
  const rows = plan.buildings.filter(b => b.unitsToRun > 0);
  html += '<h2>' + t('lab.h_per_building') + '</h2><div class="sub">' + t('lab.per_building_note') + '</div>';
  html += tableHtml('tbl-lab-buildings', rows, [
    { label: t('lab.col_building'), numeric: false, getValue: r => r.name, render: r => (plan.criticalGroup.includes(r.name) ? '<span class="crit">' : '<b>') + esc(moduleLabel(r.name)) + (plan.criticalGroup.includes(r.name) ? ' &#9650;</span>' : '</b>') },
    { label: t('lab.col_stage'), numeric: true, getValue: r => r.stage, render: r => String(r.stage) },
    { label: t('lab.col_units'), numeric: true, getValue: r => r.unitsToRun, render: r => String(r.unitsToRun) },
    { label: t('lab.col_timer'), numeric: true, getValue: r => r.timerNow, render: r => t('lab.timer_value', { s: r.timerNow.toFixed(1), lvl: r.level }) },
    { label: t('lab.col_time'), numeric: true, getValue: r => r.hours, render: r => fmtHours(r.hours) },
    { label: t('lab.col_inputs'), numeric: false, getValue: r => r.inputs.length,
      render: r => r.inputs.map(i => '<span style="white-space:nowrap;' + (i.coverage < 1 && i.kind === 'currency' ? 'color:var(--bad)' : '') + '">' +
        esc(materialLabel(i.name)) + ' ' + fmtC(i.needed) + '<span class="dimtext"> / ' + fmtC(i.stock) + '</span></span>').join(' &middot; ') },
  ]);

  // --- raw currencies (only when the chain has some it cannot produce) ---
  if (plan.raw.length) {
  html += '<h2>' + t('lab.raw_resources') + '</h2>';
  html += tableHtml('tbl-lab-raw', plan.raw, [
    { label: t('lab.col_resource'), numeric: false, getValue: r => r.name,
      render: r => '<span class="inv-stat">' + matIcon(r.name) + '<b>' + esc(materialLabel(r.name)) + '</b></span>' },
    { label: t('lab.col_needed'), numeric: true, getValue: r => r.needed, render: r => fmtC(r.needed) },
    { label: t('lab.col_stock'), numeric: true, getValue: r => r.stock, render: r => fmtC(r.stock) },
    { label: t('lab.col_coverage'), numeric: true, getValue: r => r.coverage, render: r => covBar(r.coverage) + (r.coverage * 100).toFixed(0) + '%' },
    { label: t('lab.col_capsules_supported'), numeric: true, getValue: r => r.unitsSupported, render: r => String(r.unitsSupported) },
  ].concat(plan.raw.some(r => (baseRates[r.name] || 0) > 0) ? [
    { label: t('mat.col_base_rate'), numeric: true, getValue: r => baseRates[r.name] || 0,
      render: r => baseRateCell(baseRates[r.name], (baseRates[r.name] || 0) > 0 && r.needed > r.stock ? (r.needed - r.stock) / baseRates[r.name] : null) },
  ] : []));
  }

  // --- upgrade ROI ---
  html += '<h2>' + t('lab.h_upgrade_roi') + '</h2><div class="sub">' + t('lab.upgrade_roi_note') + '</div><div class="list">';
  let roiIndex = 0;
  if (plan.groupRoi && plan.groupRoi.buildings.length > 1) {
    roiIndex++;
    html += '<div class="row"><span class="num">' + roiIndex + '</span><span>' +
      t('lab.roi_group', { names: plan.groupRoi.buildings.map(n => esc(moduleLabel(n))).join(' + '), cost: fmtC(plan.groupRoi.cost) }) +
      (plan.groupRoi.creditsPerHourSaved !== null
        ? t('lab.roi_saves', { hours: fmtHours(plan.groupRoi.hoursSaved), rate: fmtC(plan.groupRoi.creditsPerHourSaved) })
        : t('lab.roi_saves_nothing')) + '</span></div>';
  }
  const roi = plan.upgradeRoi.filter(r => r.creditsPerHourSaved !== null).slice(0, 5);
  if (!roi.length && !(plan.groupRoi && plan.groupRoi.creditsPerHourSaved !== null)) html += '<div class="row"><span>' + t('lab.roi_none') + '</span></div>';
  roi.forEach((r) => {
    roiIndex++;
    html += '<div class="row"><span class="num">' + roiIndex + '</span><span>' +
      t('lab.roi_row', { name: esc(moduleLabel(r.name)), from: r.level, to: r.level + 1, cost: fmtC(r.nextLevelCost) }) +
      t('lab.roi_saves', { hours: fmtHours(r.hoursSaved), rate: fmtC(r.creditsPerHourSaved) }) +
      (r.levelsToFloor ? '<span class="dimtext">' + t('lab.roi_to_floor', { n: r.levelsToFloor, cost: fmtC(r.costToFloor) }) + '</span>' : '<span class="dimtext">' + t('lab.roi_at_floor') + '</span>') +
      '</span></div>';
  });
  html += '</div>';

  // --- speed multiplier ---
  if (plan.speed) {
    const best = plan.speed.options.filter(o => o.affordable && o.hoursSaved > 0).sort((a, b) => b.hoursSaved - a.hoursSaved)[0];
    html += '<h2>' + t('lab.h_speed') + '</h2><div class="list">';
    if (best) {
      html += '<div class="row"><span>' + t('lab.speed_best', {
        names: plan.speed.buildings.map(n => esc(moduleLabel(n))).join(' + '),
        x: best.x,
        tied: plan.speed.buildings.length > 1 ? t('lab.speed_tied') : '',
        hours: fmtHours(best.hours),
        saved: fmtHours(best.hoursSaved),
        mult: best.inputMult,
        extra: best.extraInputs.map(e => esc(materialLabel(e.name)) + ' ' + fmtC(e.extra)).join(', '),
      }) + '</span></div>';
    } else {
      html += '<div class="row"><span>' + t('lab.speed_none', { names: plan.speed.buildings.map(n => esc(moduleLabel(n))).join(' + ') }) + '</span></div>';
    }
    html += '</div>';
  }

  // --- production emulator ---
  html += labEmuSection(lab);

  // --- base-tier buildings ---
  html += labBaseTierHtml(lab, base);

  // --- base founding (unfounded base only) ---
  if (!founding) return html;
  html += '<h2>' + t('lab.h_base_founding') + '</h2><div class="cards">';
  const bundleRows = lab.foundingBundle.map(b => ({ name: b.product, need: b.units, have: lab.stocks[b.product] || 0 }));
  const shortRows = bundleRows.filter(b => b.have < b.need);
  html += card(t('lab.card_bundle'), shortRows.length ? '<span style="color:var(--warn)">' + t('lab.ready_count', { have: bundleRows.length - shortRows.length, total: bundleRows.length }) + '</span>' : '<span style="color:var(--good)">' + t('lab.ready_count', { have: 5, total: 5 }) + '</span>');
  html += card(t('lab.card_founding_time'), founding.ready ? t('lab.ready') : fmtHours(founding.hoursPipelined));
  html += card(t('lab.card_after_founding'), fmtHours(after.hoursPipelined) + (after.binding ? '<span style="font-size:11px;color:var(--bad)">' + t('lab.binding_note', { name: esc(materialLabel(after.binding.name)) }) + '</span>' : ''));
  html += '</div>';
  if (shortRows.length) {
    html += '<div class="list">' + shortRows.map(b => '<div class="row">' + matIcon(b.name) + '<span><b>' + esc(materialLabel(b.name)) + '</b> ' + fmtC(b.have) + ' / ' + fmtC(b.need) + '</span></div>').join('') + '</div>';
  }
  return html;
}

// The five base-tier buildings (Aeroforge ... Rare Material Facility): what
// each makes from what, whether it is bought, its timer at the live level,
// and how many units the raw stock pays for right now. They are also in the
// chain, so the emulator above can time any of their products. When the base
// planner has a stockpile (what the base's module targets need of each
// material), a "Base needs" column shows it against the product stock.
function labBaseTierHtml(lab, base) {
  const bt = lab.baseTier;
  if (!bt || !bt.rows || !bt.rows.length) return '';
  let html = '<h2>' + t('lab.h_base_tier') + '</h2>';
  const locked = bt.rows.filter(r => r.status === 'locked');
  const allBought = bt.rows.every(r => r.bought || r.status === 'locked');
  const needs = {};
  for (const s of (base && base.plan && Array.isArray(base.plan.stockpile)) ? base.plan.stockpile : []) if (s && s.material) needs[s.material] = s;
  const hasNeeds = Object.keys(needs).length > 0;
  html += '<div class="sub">' + t(allBought ? 'lab.base_tier_note_bought' : 'lab.base_tier_note') +
    (!bt.panelOpened ? ' ' + t('lab.base_tier_panel_hint')
      : (bt.nextBase ? ' ' + t('lab.base_tier_next_cost', { name: esc(moduleLabel(bt.nextBase)), cost: fmtC(bt.nextBaseCost) }) : '')) +
    (locked.length ? ' ' + t('lab.base_tier_locked_note', { names: locked.map(r => esc(moduleLabel(r.building))).join(', ') }) : '') + '</div>';
  const needCol = hasNeeds ? [{ label: t('lab.col_base_needs'), numeric: true, getValue: r => needs[r.product] ? needs[r.product].needed || 0 : -1,
    render: r => {
      const s = needs[r.product];
      if (!s) return '-';
      const short = Math.max(0, Number(s.short) || 0);
      return fmtN(s.needed || 0) + (short > 0 ? ' <span style="color:var(--bad)">' + t('lab.base_needs_short', { n: fmtN(short) }) + '</span>' : ' <span style="color:var(--good)">' + t('lab.ready') + '</span>');
    } }] : [];
  html += tableHtml('tbl-lab-base-tier', bt.rows, [
    { label: t('lab.col_building'), numeric: false, getValue: r => r.building, render: r => '<b>' + esc(moduleLabel(r.building)) + '</b>' },
    { label: t('lab.col_product'), numeric: false, getValue: r => r.product, render: r => '<span class="inv-stat">' + matIcon(r.product) + esc(materialLabel(r.product)) + '</span>' },
    { label: t('lab.col_status'), numeric: false, getValue: r => r.status || (r.bought ? 'bought' : 'unknown'), render: r => {
      const s = r.status || (r.bought ? 'bought' : 'unknown');
      if (s === 'bought') return '<span style="color:var(--good)">' + t('lab.bought') + '</span>';
      if (s === 'next') return '<span style="color:var(--warn)">' + t('lab.status_next', { cost: fmtC(bt.nextBaseCost) }) + '</span>';
      if (s === 'locked') return '<span style="color:var(--dim)">' + t('lab.status_locked') + '</span>';
      return '<span style="color:var(--warn)">' + t('lab.not_bought') + '</span>';
    } },
    { label: t('common.level'), numeric: true, getValue: r => r.level === null ? -1 : r.level, render: r => r.level === null ? '-' : String(r.level) },
    { label: t('lab.col_timer'), numeric: true, getValue: r => r.timerNow === null ? -1 : r.timerNow, render: r => r.timerNow === null ? '-' : t('lab.timer_value', { s: r.timerNow.toFixed(1), lvl: r.level }) },
    { label: t('lab.col_per_unit'), numeric: false, getValue: r => r.perUnit === null ? -1 : r.perUnit,
      render: r => (r.perUnit === null ? '<span class="dimtext">' + t('lab.per_unit_unknown') + '</span> ' : fmtC(r.perUnit) + ' &times; ') +
        r.inputs.map(n => '<span style="white-space:nowrap;' + (r.perUnit !== null && (lab.stocks[n] || 0) < r.perUnit ? 'color:var(--bad)' : '') + '">' + esc(materialLabel(n)) + '<span class="dimtext"> ' + fmtC(lab.stocks[n] || 0) + '</span></span>').join(', ') },
    { label: t('lab.col_units_hour'), numeric: true, getValue: r => r.unitsPerHour === null ? -1 : r.unitsPerHour, render: r => r.unitsPerHour === null ? '-' : r.unitsPerHour.toFixed(0) },
    { label: t('lab.col_units_from_stock'), numeric: true, getValue: r => r.unitsFromStock === null ? -1 : r.unitsFromStock, render: r => r.unitsFromStock === null ? '-' : fmtN(r.unitsFromStock) },
    { label: t('lab.col_product_stock'), numeric: true, getValue: r => r.stock, render: r => fmtN(r.stock) },
  ].concat(needCol));
  return html;
}

// ---- lab production emulator ----
// "How long does a given amount of a product take, and what do building
// levels and speed multipliers do to that time?" The chain math is
// window.LabMath (public/lab-math.js), the same module the server-side
// planner uses. A scenario is a level per building and a speed per building
// laid over the live chain; the baseline is the live chain as it stands.
// Product, amount, levels and speeds are remembered in this browser.
const LAB_EMU_KEY = 'advisor-lab-emu';
const LAB_EMU_DEFAULT_PRODUCT = 'warp capsule';
const LAB_EMU_DEFAULT_UNITS = 100;

function labEmuStore() {
  try {
    const v = JSON.parse(localStorage.getItem(LAB_EMU_KEY) || 'null');
    if (v && typeof v === 'object') return v;
  } catch {}
  return {};
}
function labEmuSave(store) {
  try { localStorage.setItem(LAB_EMU_KEY, JSON.stringify(store)); } catch {}
}
function labEmuLab() {
  return window.lastData && window.lastData.lab && window.lastData.lab.available ? window.lastData.lab : null;
}
function labEmuCredits() {
  const u = window.lastData && window.lastData.units;
  return (u && u.credits) || 0;
}
// The stored scenario, validated against the live chain: a product the
// chain no longer makes falls back to the default, levels are clamped to
// [live level, floor level] by the math itself.
function labEmuState(chain) {
  const s = labEmuStore();
  const products = chain.list.map(b => b.product);
  let product = typeof s.product === 'string' ? s.product : LAB_EMU_DEFAULT_PRODUCT;
  if (!products.includes(product)) product = products.includes(LAB_EMU_DEFAULT_PRODUCT) ? LAB_EMU_DEFAULT_PRODUCT : (products[0] || '');
  const units = Math.max(1, Math.floor(Number(s.units) || LAB_EMU_DEFAULT_UNITS));
  return {
    product, units,
    useStock: s.useStock !== false,
    levels: (s.levels && typeof s.levels === 'object') ? s.levels : {},
    speeds: (s.speeds && typeof s.speeds === 'object') ? s.speeds : {},
    budget: (typeof s.budget === 'number' && isFinite(s.budget)) ? s.budget : null,
  };
}
function setLabEmu(field, value) {
  const store = labEmuStore();
  if (field === 'units') store.units = Math.max(1, Math.floor(Number(value) || 0));
  else if (field === 'useStock') store.useStock = !!value;
  else if (field === 'product') store.product = String(value);
  else if (field === 'budget') store.budget = Math.max(0, Number(value) || 0);
  labEmuSave(store);
  drawLabEmu();
}
function setLabEmuLevel(name, v) {
  const store = labEmuStore();
  store.levels = Object.assign({}, store.levels);
  store.levels[name] = Math.max(0, Math.floor(Number(v) || 0));
  labEmuSave(store);
  drawLabEmu();
}
function setLabEmuSpeed(name, x) {
  const store = labEmuStore();
  store.speeds = Object.assign({}, store.speeds);
  const xi = Math.min(10, Math.max(1, Math.floor(Number(x) || 1)));
  if (xi > 1) store.speeds[name] = xi; else delete store.speeds[name];
  labEmuSave(store);
  drawLabEmu();
}
// Every building to the level where its timer hits the 5 s floor: the
// "what is the fastest this chain can ever be" scenario.
function labEmuAllFloor() {
  const lab = labEmuLab();
  if (!lab) return;
  const LM = window.LabMath;
  const chain = LM.buildChain(lab.chain);
  const store = labEmuStore();
  const running = labEmuRunning(lab, chain);
  store.levels = Object.assign({}, store.levels);
  for (const b of chain.list) if (running.includes(b.name)) store.levels[b.name] = LM.floorLevel(b.timer);
  labEmuSave(store);
  drawLabEmu();
}
// The buildings the current product actually runs: the rows on screen, and
// the only ones the all-at-once buttons touch.
function labEmuRunning(lab, chain) {
  const st = labEmuState(chain);
  const stocks = st.useStock ? lab.stocks : window.LabMath.stripIntermediates(chain, lab.stocks);
  const core = window.LabMath.planCore(chain, [{ product: st.product, units: st.units }], stocks, { freeSlots: lab.freeSlots, netTopLevel: false });
  return core.buildings.filter(b => b.unitsToRun > 0).map(b => b.name);
}
// Shift every running building's scenario level by `delta` from where it stands.
function bumpLabEmu(delta) {
  const lab = labEmuLab();
  if (!lab) return;
  const LM = window.LabMath;
  const chain = LM.buildChain(lab.chain);
  const store = labEmuStore();
  const cur = LM.clampScenarioLevels(chain, store.levels || {});
  const running = labEmuRunning(lab, chain);
  store.levels = Object.assign({}, store.levels);
  for (const b of chain.list) if (running.includes(b.name)) store.levels[b.name] = Math.max(b.level || 0, cur[b.name] + delta);
  labEmuSave(store);
  drawLabEmu();
}
// Spend the budget on the critical path, on top of the current scenario.
function spendLabEmu() {
  const lab = labEmuLab();
  if (!lab) return;
  const LM = window.LabMath;
  const chain = LM.buildChain(lab.chain);
  const st = labEmuState(chain);
  const budget = st.budget === null ? labEmuCredits() : st.budget;
  const stocks = st.useStock ? lab.stocks : LM.stripIntermediates(chain, lab.stocks);
  const opts = { freeSlots: lab.freeSlots, netTopLevel: false };
  const res = LM.spendOnChain(chain, [{ product: st.product, units: st.units }], stocks, opts, budget, st.levels, st.speeds);
  const store = labEmuStore();
  store.levels = res.levels;
  labEmuSave(store);
  drawLabEmu();
}
function resetLabEmu() {
  const store = labEmuStore();
  delete store.levels;
  delete store.speeds;
  labEmuSave(store);
  drawLabEmu();
}
function drawLabEmu() {
  const el = document.getElementById('lab-emu');
  const lab = labEmuLab();
  if (el && lab) el.innerHTML = labEmuHtml(lab);
}
function labEmuSection(lab) {
  return '<h2>' + t('lab.emu_title') + '</h2>' +
    '<div class="sub">' + t('lab.emu_note') + '</div>' +
    '<div id="lab-emu">' + labEmuHtml(lab) + '</div>';
}

function labEmuHtml(lab) {
  const LM = window.LabMath;
  const chain = LM.buildChain(lab.chain);
  if (!LM || !chain.list.length) return '<div class="empty-note">' + t('lab.empty') + '</div>';
  const st = labEmuState(chain);
  const credits = labEmuCredits();
  const budget = st.budget === null ? credits : st.budget;
  const opts = { freeSlots: lab.freeSlots, netTopLevel: false };
  const demand = [{ product: st.product, units: st.units }];
  const emu = LM.emulateProduction(chain, demand, lab.stocks, { levels: st.levels, speeds: st.speeds, useStock: st.useStock }, opts);
  const changed = emu.upgradeCost > 0 || Object.keys(emu.speeds).length > 0;
  const inStock = lab.stocks[st.product] || 0;

  // --- what to make ---
  const productOptions = chain.list.map(b =>
    '<option value="' + esc(b.product) + '"' + (b.product === st.product ? ' selected' : '') + '>' + esc(materialLabel(b.product)) + '</option>').join('');
  let html = '<div class="row" style="gap:14px;flex-wrap:wrap">' +
    '<span>' + t('lab.emu_product') + ' <select class="pet-input" onchange="setLabEmu(\'product\', this.value)">' + productOptions + '</select></span>' +
    '<span>' + t('lab.emu_amount') + ' <input class="pet-input lab-input" type="number" min="1" value="' + st.units + '" onchange="setLabEmu(\'units\', this.value)">' +
    ' <span class="dimtext">' + t('lab.emu_in_stock', { n: fmtC(inStock) }) + '</span></span>' +
    '<span><label><input type="checkbox"' + (st.useStock ? ' checked' : '') + ' onchange="setLabEmu(\'useStock\', this.checked)"> ' + t('lab.emu_use_stock') + '</label></span>' +
    '</div>';

  // --- headline: time now, time in the scenario, what the scenario costs ---
  html += '<div class="cards">';
  html += card(t('lab.emu_card_time_now'), fmtHours(emu.hoursNow) +
    '<span style="font-size:11px;color:var(--dim)">' + t('lab.emu_sequential', { n: fmtHours(emu.hoursSequentialNow) }) + '</span>');
  html += card(t('lab.emu_card_time_scenario'),
    '<span style="color:' + (emu.hoursSaved > 0 ? 'var(--good)' : 'inherit') + '">' + fmtHours(emu.hours) + '</span>' +
    '<span style="font-size:11px;color:var(--dim)">' + t('lab.emu_sequential', { n: fmtHours(emu.hoursSequential) }) + '</span>');
  html += card(t('lab.emu_card_saved'), changed
    ? (emu.hoursSaved > 0
      ? '<span style="color:var(--good)">' + fmtHours(emu.hoursSaved) + '</span>' +
        '<span style="font-size:11px;color:var(--dim)">' + t('lab.emu_saved_pct', { n: Math.round(emu.hoursSaved / emu.hoursNow * 100) }) + '</span>'
      : '<span style="color:var(--warn)">' + t('lab.emu_saves_nothing') + '</span>')
    : '<span style="color:var(--dim)">' + t('lab.emu_no_changes') + '</span>');
  html += card(cardIcon(resIcon('credits', 'mat-tile xs'), t('lab.emu_card_cost')),
    (emu.upgradeCost > 0
      ? '<span title="' + fmtN(emu.upgradeCost) + '" style="color:' + (emu.upgradeCost <= credits ? 'inherit' : 'var(--bad)') + '">' + fmtC(emu.upgradeCost) + '</span>' +
        '<span style="font-size:11px;color:var(--dim)">' +
        (credits > 0 ? t('lab.emu_cost_pct', { n: Math.round(emu.upgradeCost / credits * 100), credits: fmtC(credits) }) : '') +
        (emu.creditsPerHourSaved !== null ? t('lab.emu_cost_per_hour', { rate: fmtC(emu.creditsPerHourSaved) }) : '') +
        '</span>'
      : '<span style="color:var(--dim)">&mdash;</span>'));
  if (emu.binding) {
    html += card(t('lab.card_binding'), '<span style="color:var(--bad)">' + esc(materialLabel(emu.binding.name)) + '</span> ' + covBar(emu.binding.coverage) +
      '<span style="font-size:11px;color:var(--dim)">' + t('lab.pct_covered', { n: (emu.binding.coverage * 100).toFixed(0) }) +
      (((window.lastData && window.lastData.lab && window.lastData.lab.baseProduction || {})[emu.binding.name] || 0) > 0 ? ' &middot; ' + t('lab.base_makes', { rate: fmtOutput(window.lastData.lab.baseProduction[emu.binding.name]) }) : '') + '</span>');
  }
  html += '</div>';

  // --- scenario controls ---
  html += '<div class="row" style="gap:14px;flex-wrap:wrap">' +
    '<span>' + t('lab.emu_budget') + ' <input class="pet-input" style="width:120px" type="number" min="0" step="1000000" value="' + Math.round(budget) + '"' +
    ' title="' + t('lab.emu_budget_title') + '" onchange="setLabEmu(\'budget\', this.value)">' +
    ' <button class="ghost" onclick="spendLabEmu()" title="' + t('lab.emu_spend_title') + '">' + t('lab.emu_spend_btn') + '</button></span>' +
    '<span>' +
    '<button class="ghost" onclick="bumpLabEmu(10)">+10</button> ' +
    '<button class="ghost" onclick="bumpLabEmu(50)">+50</button> ' +
    '<button class="ghost" onclick="bumpLabEmu(-10)">&minus;10</button> ' +
    '<button class="ghost" onclick="labEmuAllFloor()" title="' + t('lab.emu_floor_title') + '">' + t('lab.emu_floor_btn') + '</button> ' +
    '<button class="ghost" onclick="resetLabEmu()">' + t('units.reset') + '</button>' +
    '</span></div>';

  // --- per building: level and speed inputs, time before -> after ---
  const rows = emu.buildings.filter(b => b.unitsToRun > 0);
  const speedSel = (r) => {
    let s = '<select class="pet-input" onchange="setLabEmuSpeed(' + jsStr(r.name) + ', this.value)">';
    for (let x = 1; x <= 10; x++) {
      s += '<option value="' + x + '"' + (x === r.speedX ? ' selected' : '') + ' title="' + t('lab.emu_speed_title', { mult: LM.SPEED_INPUT_MULT[x - 1] }) + '">x' + x +
        (x > 1 ? ' (' + t('lab.emu_speed_inputs', { mult: LM.SPEED_INPUT_MULT[x - 1] }) + ')' : '') + '</option>';
    }
    return s + '</select>';
  };
  const arrow = (a, b, fmt, better) => a === b ? fmt(a)
    : '<span class="dimtext">' + fmt(a) + '</span> &rarr; <span style="color:' + (better ? 'var(--good)' : 'inherit') + '">' + fmt(b) + '</span>';
  html += '<div class="sub" style="margin:14px 0 4px">' + t('lab.emu_per_building_note') + '</div>';
  html += tableHtml('tbl-lab-emu', rows, [
    { label: t('lab.col_building'), numeric: false, getValue: r => r.name,
      render: r => (r.critical ? '<span class="crit">' : '<b>') + esc(moduleLabel(r.name)) + (r.critical ? ' &#9650;</span>' : '</b>') },
    { label: t('lab.col_stage'), numeric: true, getValue: r => r.stage, render: r => String(r.stage) },
    { label: t('lab.col_units'), numeric: true, getValue: r => r.unitsToRun, render: r => fmtN(r.unitsToRun) },
    { label: t('lab.emu_col_level'), numeric: true, getValue: r => r.level,
      render: r => '<span class="dimtext">' + r.levelNow + ' &rarr;</span> <input class="pet-input base-input" type="number" min="' + r.levelNow + '" max="' + Math.max(r.levelNow, r.floorLevel) +
        '" value="' + r.level + '" onchange="setLabEmuLevel(' + jsStr(r.name) + ', this.value)">' +
        ' <span class="dimtext">' + (r.level >= r.floorLevel ? t('lab.roi_at_floor') : t('lab.emu_floor_at', { n: r.floorLevel })) + '</span>' },
    { label: t('lab.emu_col_upgrade_cost'), numeric: true, getValue: r => r.upgradeCost,
      render: r => r.upgradeCost > 0
        ? '<span title="' + fmtN(r.upgradeCost) + '">' + fmtC(r.upgradeCost) + '</span> <span class="dimtext">' + t('lab.emu_levels_bought', { n: r.levelsBought }) + '</span>'
        : '<span style="color:var(--dim)">&mdash;</span>' },
    { label: t('lab.emu_col_speed'), numeric: true, getValue: r => r.speedX, render: speedSel },
    { label: t('lab.col_timer'), numeric: true, getValue: r => r.timer / r.speedX,
      render: r => arrow(r.timerNow, r.timer, v => v.toFixed(1) + ' s', r.timer < r.timerNow) +
        (r.speedX > 1 ? ' <span class="dimtext">&divide; ' + r.speedX + '</span>' : '') },
    { label: t('lab.col_time'), numeric: true, getValue: r => r.hours,
      render: r => arrow(r.hoursNow, r.hours, fmtHours, r.hours < r.hoursNow) },
    { label: t('lab.col_inputs'), numeric: false, getValue: r => r.inputs.length,
      render: r => r.inputs.map(i => '<span style="white-space:nowrap;' + (i.coverage < 1 ? 'color:var(--bad)' : '') + '">' +
        esc(materialLabel(i.name)) + ' ' + fmtC(i.needed) + '<span class="dimtext"> / ' + fmtC(i.stock) + '</span></span>').join(' &middot; ') },
  ]);

  // --- what the speed multipliers add to the bill ---
  const extra = {};
  for (const b of rows) for (const e of b.extraInputs) extra[e.name] = (extra[e.name] || 0) + e.extra;
  const extraNames = Object.keys(extra);
  if (extraNames.length) {
    html += '<div class="list" style="margin-top:10px"><div class="row"><span>' +
      t('lab.emu_speed_extra', { extra: extraNames.map(n => esc(materialLabel(n)) + ' ' + fmtC(extra[n])).join(', ') }) +
      '</span></div></div>';
  }
  return html;
}
