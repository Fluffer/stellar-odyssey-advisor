// Time to earn the remaining cores for maxing every unlocked skill, from
// the user-tunable income rate (cores/hour from battling + daily bonus).
function calcQcGap() {
  const out = document.getElementById('qcGapTime');
  const rateEl = document.getElementById('qcRate');
  const dailyEl = document.getElementById('qcDaily');
  const d = window.lastData;
  if (!out || !rateEl || !dailyEl || !d || !d.tech || !d.tech.maxOut) return;
  try {
    const saved = JSON.parse(localStorage.getItem('advisor-qc-rate') || 'null');
    if (saved && !calcQcGap._loaded) {
      calcQcGap._loaded = true;
      // A typed rate is kept only while the computed default it overrode is
      // unchanged; once the game state moves the rate, the new default wins.
      if (saved.base === d.tech.maxOut.defaultRatePerHour) rateEl.value = saved.rate;
      dailyEl.value = saved.daily;
    }
  } catch {}
  const rate = parseFloat(rateEl.value) || 0;
  const daily = parseFloat(dailyEl.value) || 0;
  try { localStorage.setItem('advisor-qc-rate', JSON.stringify({ rate: rateEl.value, daily: dailyEl.value, base: d.tech.maxOut.defaultRatePerHour })); } catch {}
  const gap = d.tech.maxOut.coresGap;
  const perDay = rate * 24 + daily;
  if (gap <= 0) { out.textContent = t('qc.done'); return; }
  if (perDay <= 0) { out.textContent = t('qc.no_rate'); return; }
  const days = gap / perDay;
  out.textContent = days >= 2 ? t('qc.dur_dh', { d: Math.floor(days), h: Math.round((days % 1) * 24) }) : Math.round(days * 24) + t('common.hours');
}

// Where the hourly core rate comes from: battling drops by level, plus the
// base's Quantum server tick when one is running.
function techIncomeHtml(inc) {
  if (!inc) return '';
  const parts = [];
  parts.push(inc.battlingPerHour == null
    ? I18n.t('tech.income_battling_unknown')
    : I18n.t('tech.income_battling', { n: inc.battlingPerHour, lvl: inc.battlingLevel }));
  if (inc.quantumServer) {
    const q = inc.quantumServer;
    parts.push(I18n.t('tech.income_quantum_server', { lvl: q.level, n: q.guaranteedPerHour, pct: q.extraChance.toFixed(1), exp: q.expectedPerHour.toFixed(2) }));
  } else {
    parts.push(I18n.t('tech.income_no_quantum_server'));
  }
  return '<div style="font-size:11px;color:var(--dim);margin-top:4px">' + parts.join(' &middot; ') + '</div>';
}

// NOTE: the parameter shadows the global t() helper, so this function reaches
// the catalogue through I18n.t instead.
function renderTech(t) {
  let html = '';
  html += '<h2>' + I18n.t('tech.title') + '</h2>';
  html += '<div class="sub">' + I18n.t('tech.cost_note') + '</div>';
  html += '<div class="cards">';
  html += card(cardIcon(resIcon('quantum_cores', 'mat-tile xs'), I18n.t('tech.card_quantum_cores')), t.quantumCores.toLocaleString());
  if (t.battle) html += card(I18n.t('tech.card_avg_npc_level'), t.battle.baselineAvg);
  if (t.maxOut) {
    html += card(I18n.t('tech.card_qc_assigned'), fmtC(t.maxOut.coresAssigned) + ' <span style="font-size:11px;color:var(--dim)">' + I18n.t('tech.maxed_of', { n: t.maxOut.maxedCount, total: t.maxOut.unlockedCount }) + '</span>');
    html += card(I18n.t('tech.card_qc_max_needed'), fmtC(t.maxOut.coresMaxTotal));
    html += card(I18n.t('tech.card_qc_to_max_all'), fmtC(t.maxOut.coresToMaxAll));
    html += card(I18n.t('tech.card_gap_after_stock'), fmtC(t.maxOut.coresGap));
    html += '<div class="card"><div class="k">' + I18n.t('tech.time_to_cover_gap') + '</div><div class="v" id="qcGapTime">&mdash;</div>' +
      '<div style="font-size:11px;color:var(--dim);margin-top:4px">' +
      '<input type="number" id="qcRate" value="' + t.maxOut.defaultRatePerHour + '" min="0" step="0.1" style="width:52px" onchange="calcQcGap()" oninput="calcQcGap()"> ' + I18n.t('tech.per_hour') + ' + ' +
      '<input type="number" id="qcDaily" value="' + t.maxOut.defaultDailyBonus + '" min="0" style="width:52px" onchange="calcQcGap()" oninput="calcQcGap()"> ' + I18n.t('common.per_day') + '</div>' +
      techIncomeHtml(t.maxOut.income) + '</div>';
  }
  html += '</div>';

  if (t.battle && t.battle.rows.length) {
    html += '<h2>' + I18n.t('tech.combat_ranking_title') + '</h2>';
    html += '<div class="sub">' +
      (t.battle.winratePointsPerLevel
        ? I18n.t('tech.winrate_metric_converted', { pts: t.battle.winratePointsPerLevel })
        : I18n.t('tech.winrate_metric')) + ' ' +
      I18n.t('tech.no_measurable_gain_note', { n: t.battle.probeLevels ? Object.keys(t.battle.probeLevels).length : 8 }) + '</div>';
    const combatCols = [
      { label: I18n.t('tech.col_skill'), numeric: false, getValue: r => r.key,
        render: r => '<span class="inv-stat">' + techIcon(r.key) + '<b>' + esc(techBoostLabel(r.key)) + '</b></span>' },
      { label: I18n.t('common.level'), numeric: true, getValue: r => r.level, render: r => r.level },
      { label: I18n.t('tech.col_next_qc'), numeric: true, getValue: r => r.cost, render: r => I18n.t('tech.qc_amount', { n: r.cost }) },
      { label: I18n.t('tech.col_winrate'), numeric: true, getValue: r => r.winrateDelta || 0,
        render: r => r.winrateDelta > 0 ? '+' + r.winrateDelta.toFixed(3) + '%' : (r.winrateDelta < 0 ? r.winrateDelta.toFixed(3) + '%' : '<span style="color:var(--dim)">' + I18n.t('common.none') + '</span>') },
      { label: I18n.t('tech.col_gain'), numeric: true, getValue: r => r.avgDelta,
        render: r => r.avgDelta > 0 ? '<b style="color:var(--good)">' + I18n.t('tech.lvls_plus', { n: r.avgDelta }) + '</b>' : '<span style="color:var(--dim)">' + (r.avgDelta < 0 ? I18n.t('tech.lvls', { n: r.avgDelta }) : I18n.t('tech.no_measurable_gain')) + '</span>' },
      { label: I18n.t('tech.col_lvls_per_core'), numeric: true, getValue: r => r.levelsPerCore,
        render: r => r.levelsPerCore > 0 ? '<span class="gain">' + r.levelsPerCore + '</span>' : '<span style="color:var(--dim)">&mdash;</span>' },
    ];
    html += tableHtml('tbl-combat-ranking', t.battle.rows, combatCols);
  }

  html += '<h2>' + I18n.t('tech.optimal_spend', { n: t.quantumCores }) + '</h2>';
  if (t.allocation.length) {
    html += '<div class="list">';
    for (const a of t.allocation) {
      html += '<div class="row">' + techIcon(a.key, 'mat-tile xs') + '<span><b>' + esc(techBoostLabel(a.key)) + '</b>: ' + a.from + ' &rarr; ' + a.to + '</span><span class="gain">' + I18n.t('tech.qc_amount', { n: a.cost }) + '</span></div>';
    }
    html += '<div class="sub">' + I18n.t('tech.leftover', { n: t.leftoverCores }) + '</div></div>';
  } else if (t.battle && t.battle.rows.length) {
    const best = t.battle.rows[0];
    // Two different reasons for an empty plan: nothing helps, or nothing is
    // affordable. Saying "not enough cores" when the real answer is "no skill
    // measurably helps" would send the player off to farm cores for nothing.
    if (!(best.avgDelta > 0)) {
      html += '<div class="row"><span>' + I18n.t('tech.plan_no_skill_helps') + '</span></div>';
    } else {
      html += '<div class="row"><span>' + I18n.t('tech.plan_not_affordable', { name: esc(techBoostLabel(best.key)), n: best.cost }) + '</span></div>';
    }
  } else if (t.battle) {
    // The ranking skips skills at the 100 cap, so no rows = all four maxed.
    html += '<div class="row"><span>' + I18n.t('tech.plan_all_maxed') + '</span></div>';
  } else {
    html += '<div class="row"><span>' + I18n.t('tech.plan_no_sim') + '</span></div>';
  }

  html += '<h2>' + I18n.t('tech.all_skills') + '</h2>';
  const skillCols = [
    { label: I18n.t('tech.col_skill'), numeric: false, getValue: s => s.label,
      render: s => '<span class="inv-stat">' + techIcon(s.key) + '<b>' + esc(techNameLabel(s.key, s.label)) + '</b></span>' },
    { label: I18n.t('common.level'), numeric: true, getValue: s => s.level, render: s => s.level + (s.maxed ? ' <span class="badge b-ok">' + I18n.t('tech.badge_max') + '</span>' : '') },
    { label: I18n.t('tech.col_next_cost'), numeric: true, getValue: s => (s.locked || s.maxed) ? -1 : (s.costNext || 0),
      render: s => s.locked ? '-' : (s.maxed ? '-' : '<b>' + I18n.t('tech.qc_amount', { n: s.costNext }) + '</b>') },
    { label: I18n.t('tech.col_to_max'), numeric: true, getValue: s => s.coresToMax === null ? -1 : s.coresToMax,
      render: s => s.coresToMax === null ? '-' : (s.coresToMax === 0 ? '-' : I18n.t('tech.qc_amount', { n: fmtC(s.coresToMax) })) },
    { label: I18n.t('tech.col_status'), numeric: false, getValue: s => s.locked ? 'locked' : (s.maxed ? 'max' : (s.affordable ? 'affordable' : '')),
      render: s => s.locked ? '<span class="badge b-empty">' + I18n.t('tech.badge_locked_steam') + '</span>' :
        (s.maxed ? '<span class="badge b-ok">' + I18n.t('tech.badge_max') + '</span>' : (s.affordable ? '<span class="badge b-ok">' + I18n.t('tech.badge_affordable') + '</span>' : '')) },
    { label: I18n.t('tech.col_description'), numeric: false, getValue: s => s.desc, render: s => '<span style="color:var(--dim);font-size:12px">' + esc(techDescLabel(s.key, s.desc)) + '</span>' },
  ];
  html += tableHtml('tbl-all-skills', t.skills, skillCols);
  return html;
}
