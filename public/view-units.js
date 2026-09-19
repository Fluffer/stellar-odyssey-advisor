// 'droids' and 'clones' are the keys IconMap already uses for the two unit
// groups, so a kind is its own icon key.
function unitIcon(kind, cls) { return resIcon(kind, cls); }

const SKILL_LABELS = {
  efficiency: 'skill.efficiency', storage: 'skill.storage', maneuverability: 'skill.maneuverability',
  critical_chance: 'skill.critical_chance', critical_damage: 'skill.critical_damage', dual_shot: 'skill.dual_shot'
};
// Resolved at call time, not at load time: the language can be switched after
// the page has rendered. Unknown skills still fall back to their raw id.
function skillLabel(skill) { return SKILL_LABELS[skill] ? t(SKILL_LABELS[skill]) : skill; }

function renderUnits(u) {
  let html = '';
  html += '<h2>' + t('units.h_droids_clones') + '</h2>';
  html += '<div class="sub">' + t('units.cost_note') + '</div>';
  html += '<div class="cards">';
  html += card(cardIcon(resIcon('credits', 'mat-tile xs'), t('units.credits')), fmtC(u.credits));
  const priceNote = g => ' <span style="font-size:11px;color:var(--dim)">' + t('units.next_price', { c: fmtC(g.nextPrice) }) +
    (g.priceSource === 'extrapolated' ? ' <span title="' + t('units.curve_title') + '">' + t('units.curve') + '</span>' : '') + '</span>';
  html += card(cardIcon(resIcon('droids', 'mat-tile xs'), t('units.droids')), u.droids.count + priceNote(u.droids));
  html += card(cardIcon(resIcon('clones', 'mat-tile xs'), t('units.clones')), u.clones.count + priceNote(u.clones));
  html += '</div>';

  // --- droid survival ---
  const sv = u.droids.survival;
  if (sv && sv.count) {
    const bd = sv.perDroid[0].breakdown;
    const uneven = sv.perDroid.some(d => d.dodge !== sv.perDroid[0].dodge);
    const tone = capTone(sv.avgDodge, 100);
    html += headIcon(unitIcon('droids'), t('units.h_droid_survival'));
    html += '<div class="sub">' + t('units.survival_note') + '</div>';
    html += '<div class="cards">';
    html += card(uneven ? t('units.dodge_chance_avg') : t('units.dodge_chance'), '<span style="color:' + tone.color + '">' + sv.avgDodge.toFixed(1) + '%</span>' +
      '<span style="font-size:11px;color:var(--dim)"> = ' + bd.base + ' + ' + bd.maneuverability.toFixed(1) + ' + ' + bd.mods + '</span>');
    html += card(t('units.expected_alive'), sv.expectedAlive.toFixed(2) + ' / ' + sv.count);
    if (sv.lastAction) {
      const la = sv.lastAction;
      const col = la.alive < la.total ? 'var(--warn)' : 'var(--good)';
      html += card(t('units.last_action'), t('units.alive_count', { n: '<span style="color:' + col + '">' + la.alive + ' / ' + la.total + '</span>' }));
    }
    html += card(t('units.target_maneuverability'), sv.noModsCap + '%' +
      '<span style="font-size:11px;color:var(--dim)">' + t('units.no_mods_dodge') + (sv.cappedCount ? t('units.already_capped', { n: sv.cappedCount }) : '') + '</span>');
    html += '</div>';
    // Road to the no-mods end state: dodge mods on laser/probes go one at a
    // time, each freed slot becomes a single rare-drop mod (+10 vs +5).
    if (sv.modPlan && sv.modPlan.length) {
      const slotName = { laser_slot: 'units.slot_laser', probes_slot: 'units.slot_probes' };
      html += '<div class="list">';
      sv.modPlan.forEach((p, i) => {
        const done = p.removableNow;
        html += '<div class="row"><span class="num">' + (i + 1) + '</span><span>' +
          (done ? '<b style="color:var(--good)">' + t('units.now') + '</b> ' : t('units.at_maneuverability', { n: p.removableAt })) +
          t('units.mod_plan_step', { slot: (slotName[p.slot] ? t(slotName[p.slot]) : p.slot), value: p.value }) +
          (p.value < 10 ? t('units.mod_plan_rare10') : '') + t('units.mod_plan_tail') + '</span></div>';
      });
      html += '<div class="row"><span class="num">' + (sv.modPlan.length + 1) + '</span><span>' + t('units.mod_plan_summary', { n: sv.maneuverabilityCap }) + '</span></div>';
      html += '</div>';
    }
  }

  // --- recommendation ---
  html += '<h2>' + t('units.h_recommendation') + '</h2><div class="list">';
  const cd = u.clones.damage;
  let recNo = 0;
  const recRow = body => '<div class="row"><span class="num">' + (++recNo) + '</span><span>' + body + '</span></div>';
  if (u.clones.nextPrice !== null && cd.perPctUpgradeCost && cd.perPctBuyCost) {
    const ratio = cd.perPctBuyCost / cd.perPctUpgradeCost;
    // Skill order by damage per credit at the current levels.
    const order = u.clones.rows.filter(r => r.marginalDamage > 0 && r.costStepAll > 0)
      .sort((a, b) => b.marginalDamage / b.costStepAll - a.marginalDamage / a.costStepAll)
      .map((r, i) => (i === 0 ? '<b>' : '') + esc(skillLabel(r.skill)).toLowerCase() + (i === 0 ? '</b>' : ''));
    const args = { upg: fmtC(cd.perPctUpgradeCost), n: u.clones.count + 1, buy: fmtC(cd.perPctBuyCost) };
    html += recRow(ratio >= 1
      ? t('units.rec_clones', Object.assign(args, { ratio: ratio.toFixed(1), first: order[0] || '', rest: order.slice(1).join(t('units.then_sep')) }))
      : t('units.rec_clones_buy', Object.assign(args, { ratio: (1 / ratio).toFixed(1) })));
    if (u.clones.damageBreakEvenLevel !== null) {
      const at = u.clones.rows[0].level;
      html += recRow(at < u.clones.damageBreakEvenLevel
        ? t('units.rec_break_even', {
          lvl: u.clones.damageBreakEvenLevel, at: at,
          extra: u.clones.nextPrice > u.credits ? t('units.rec_break_even_cost', { n: u.clones.count + 1, c: fmtC(u.clones.nextPrice) }) : ''
        })
        : t('units.rec_break_even_past', { lvl: u.clones.damageBreakEvenLevel, at: at, n: u.clones.count + 1, c: fmtC(u.clones.nextPrice) }));
    }
  }
  if (u.droids.nextPrice !== null && u.droids.breakEvenLevel !== null) {
    const at = u.droids.rows[0].level;
    const args = { lvl: u.droids.breakEvenLevel, at: at, n: u.droids.count + 1, price: fmtC(u.droids.nextPrice), catchup: fmtC(u.droids.catchUpCost) };
    html += recRow(at < u.droids.breakEvenLevel ? t('units.rec_droids', args) : t('units.rec_droids_buy', args));
  }
  if (u.droids.bestSkill && u.droids.rows.length) {
    const rows = u.droids.rows.filter(r => r.creditsPerPctYield !== null).sort((a, b) => a.creditsPerPctYield - b.creditsPerPctYield);
    const capped = u.droids.rows.filter(r => r.creditsPerPctYield === null);
    html += recRow(t('units.rec_skill_order', {
      list: rows.map((r, i) => (i === 0 ? '<b>' : '') + esc(skillLabel(r.skill)) + (i === 0 ? '</b>' : '') +
        ' (' + t('units.per_pct_yield', { c: fmtC(r.creditsPerPctYield) }) + ')').join(t('units.then_sep')),
      capped: capped.length
        ? t('units.rec_skill_capped', {
          names: capped.map(r => esc(skillLabel(r.skill))).join(t('units.list_sep')),
          n: (u.droids.survival ? u.droids.survival.noModsCap : 100)
        })
        : t('units.rec_skill_uncapped')
    }));
  }
  html += '</div>';

  // --- clone damage impact ---
  html += headIcon(unitIcon('clones'), t('units.h_clone_damage')) + '<div class="cards">';
  html += card(t('units.total_multiplier'), cd.totalMultiplier.toFixed(3));
  html += card(t('units.plus1_all_skills'), t('units.pct_dmg', { n: cd.plusOnePctAll }));
  html += card(t('units.nth_clone_zero', { n: u.clones.count + 1 }), t('units.pct_dmg', { n: cd.eighthAtZero }));
  html += card(t('units.nth_clone_parity', { n: u.clones.count + 1 }), t('units.pct_dmg', { n: cd.eighthAtParity }));
  html += '</div>';

  // --- tables (real <table>s, click a header to sort) ---
  const unitSkillColumns = (withDamage, withYield) => {
    const cols = [
      { label: t('units.col_skill'), numeric: false, getValue: r => skillLabel(r.skill),
        render: r => '<b>' + esc(skillLabel(r.skill)) + '</b>' + (r.uneven ? ' <span style="color:var(--warn)">' + t('units.units_differ') + '</span>' : '') },
      { label: t('common.level'), numeric: true, getValue: r => r.level, render: r => r.level + '%' },
      { label: t('units.col_step_all'), numeric: true, getValue: r => r.costStepAll, render: r => fmtC(r.costStepAll) },
      { label: t('units.col_plus1_all'), numeric: true, getValue: r => r.costPlusOneAll, render: r => fmtC(r.costPlusOneAll) },
      { label: t('units.col_affordable'), numeric: true, getValue: r => r.affordableStepsAll, render: r => '+' + (r.affordableStepsAll / 10).toFixed(1) + '%' },
    ];
    if (withDamage) {
      cols.push({ label: t('units.col_dmg_per_step'), numeric: true, getValue: r => r.marginalDamage || 0,
        render: r => r.marginalDamage !== null ? '+' + r.marginalDamage : '-' });
    }
    if (withYield) {
      cols.push({ label: t('units.col_yield_per_step'), numeric: true, getValue: r => r.marginalYield || 0,
        render: r => r.marginalYield ? '+' + r.marginalYield.toFixed(4) + '%' : '<span style="color:var(--dim)">' + t('units.capped') + '</span>' });
      cols.push({ label: t('units.col_credits_per_yield'), numeric: true, getValue: r => r.creditsPerPctYield === null ? Infinity : r.creditsPerPctYield,
        render: r => r.creditsPerPctYield === null ? '-' : fmtC(r.creditsPerPctYield) });
    }
    return cols;
  };
  html += headIcon(unitIcon('clones'), t('units.h_clone_skills', { n: u.clones.count })) +
    '<div class="sub">' + t('units.clone_skills_note') + '</div>';
  html += tableHtml('tbl-clone-skills', u.clones.rows, unitSkillColumns(true, false));
  html += unitEmuSection('clones');
  html += headIcon(unitIcon('droids'), t('units.h_droid_skills', { n: u.droids.count })) +
    '<div class="sub">' + t('units.droid_skills_note') + '</div>';
  html += tableHtml('tbl-droid-skills', u.droids.rows, unitSkillColumns(false, true));
  html += unitEmuSection('droids');

  // --- unit lists ---
  const list = (title, kind, units, skills) => {
    let t = headIcon(unitIcon(kind), title) + '<div class="list">';
    for (const un of units) {
      t += '<div class="row">' + unitIcon(kind, 'mat-tile xs') +
        '<span style="min-width:110px"><b>' + esc(un.name) + '</b></span>';
      for (const s of skills) t += '<span>' + esc(skillLabel(s)) + ' <b>' + un[s] + '%</b></span>';
      t += '</div>';
    }
    return t + '</div>';
  };
  html += list(t('units.your_clones'), 'clones', u.clones.list, ['critical_chance', 'critical_damage', 'dual_shot']);
  html += list(t('units.your_droids'), 'droids', u.droids.list, ['efficiency', 'storage', 'maneuverability']);
  return html;
}

// ---- droid / clone upgrade cost emulator ----
// "What does it cost to take this group to X%?" - per individual unit and
// for the whole group, for each of the three skills. All the money math is
// window.UnitMath (public/unit-math.js), the same module the server-side
// advisor uses, so the emulator charges exactly what the game charges.
const UNIT_GROUP_SKILLS = {
  droids: ['efficiency', 'storage', 'maneuverability'],
  clones: ['critical_chance', 'critical_damage', 'dual_shot'],
};
const UNIT_GROUP_LABEL = { droids: 'droid', clones: 'clone' };
// Group nouns come from the catalogue at call time (form '' = title-case
// singular, 'lc' = lowercase singular, 'many' = plural); an unknown kind
// falls back to the raw kind.
function unitGroupWord(kind, form) {
  const w = UNIT_GROUP_LABEL[kind];
  return w ? t('units.group_' + w + (form ? '_' + form : '')) : kind;
}
const UNIT_EMU_KEY = 'advisor-unit-targets';

function unitEmuStore() {
  try {
    const v = JSON.parse(localStorage.getItem(UNIT_EMU_KEY) || 'null');
    if (v && typeof v === 'object') return v;
  } catch {}
  return {};
}
function unitEmuSave(store) {
  try { localStorage.setItem(UNIT_EMU_KEY, JSON.stringify(store)); } catch {}
}
// Levels only ever sit on the game's 0.1 grid; keep targets there too.
function unitEmuClamp(v) {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return Math.min(500, Math.max(0, Math.round(n * 10) / 10));
}
// Stored target, or a default of "5% above the highest unit" so the panel
// opens on a meaningful number instead of a no-op.
function unitEmuTarget(kind, skill, units) {
  const stored = (unitEmuStore()[kind] || {})[skill];
  if (typeof stored === 'number' && isFinite(stored)) return unitEmuClamp(stored);
  const top = units.length ? Math.max.apply(null, units.map(u => u[skill] || 0)) : 0;
  return unitEmuClamp(top + 5);
}
function setUnitEmuTarget(kind, skill, v) {
  const store = unitEmuStore();
  store[kind] = Object.assign({}, store[kind]);
  store[kind][skill] = unitEmuClamp(v);
  unitEmuSave(store);
  drawUnitEmu(kind);
}
function setUnitEmuAll(kind, v) {
  const store = unitEmuStore();
  const t = unitEmuClamp(v);
  store[kind] = {};
  UNIT_GROUP_SKILLS[kind].forEach(s => { store[kind][s] = t; });
  unitEmuSave(store);
  drawUnitEmu(kind);
}
// Shift every target by `delta` from where it currently stands.
function bumpUnitEmu(kind, delta) {
  const units = unitEmuUnits(kind);
  const store = unitEmuStore();
  store[kind] = Object.assign({}, store[kind]);
  UNIT_GROUP_SKILLS[kind].forEach(s => {
    store[kind][s] = unitEmuClamp(unitEmuTarget(kind, s, units) + delta);
  });
  unitEmuSave(store);
  drawUnitEmu(kind);
}
// Highest target the credit pile covers for ONE skill (spent on that skill
// alone - the three "max" answers cannot all be bought together).
function maxUnitEmu(kind, skill) {
  const units = unitEmuUnits(kind);
  const credits = (window.lastData && window.lastData.units ? window.lastData.units.credits : 0) || 0;
  const best = window.UnitMath.maxAffordableTarget(units, skill, credits);
  setUnitEmuTarget(kind, skill, best.target);
}
function resetUnitEmu(kind) {
  const store = unitEmuStore();
  delete store[kind];
  unitEmuSave(store);
  drawUnitEmu(kind);
}
function unitEmuUnits(kind) {
  const u = window.lastData && window.lastData.units;
  return (u && u[kind] && u[kind].list) ? u[kind].list : [];
}
function drawUnitEmu(kind) {
  const el = document.getElementById('emu-' + kind);
  if (el) el.innerHTML = unitEmuHtml(kind);
}

function unitEmuHtml(kind) {
  const UM = window.UnitMath;
  const u = window.lastData && window.lastData.units;
  const units = unitEmuUnits(kind);
  if (!UM || !units.length) return '<div class="empty-note">' + t('units.emu_none', { kind: unitGroupWord(kind, 'many') }) + '</div>';
  const skills = UNIT_GROUP_SKILLS[kind];
  const credits = u.credits || 0;
  const targets = {};
  skills.forEach(s => { targets[s] = unitEmuTarget(kind, s, units); });
  const emu = UM.emulateGroup(units, skills, targets, credits);
  const label = unitGroupWord(kind);

  // --- headline: what the whole plan costs against the credit pile ---
  let html = '<div class="cards">';
  html += card(cardIcon(unitIcon(kind, 'mat-tile xs'), t('units.emu_all_card', { n: units.length, kind: unitGroupWord(kind, 'many') })),
    '<span title="' + t('units.n_credits', { n: fmtN(emu.total) }) + '">' + fmtC(emu.total) + '</span>');
  html += card(cardIcon(resIcon('credits', 'mat-tile xs'), t('units.credits')), fmtC(credits));
  html += card(emu.affordable ? t('units.left_over') : t('units.short_by'),
    '<span style="color:' + (emu.affordable ? 'var(--good)' : 'var(--bad)') + '">' + fmtC(Math.abs(emu.leftover)) + '</span>' +
    (credits > 0 ? '<span style="font-size:11px;color:var(--dim)">' + t('units.plan_pct', { n: Math.round(emu.total / credits * 100) }) + '</span>' : ''));
  html += '</div>';

  // --- controls ---
  // The "all skills" box only shows a number when the three targets agree;
  // otherwise it would claim a target two of the skills do not have.
  const common = skills.every(s => targets[s] === targets[skills[0]]) ? String(targets[skills[0]]) : '';
  html += '<div class="row" style="gap:14px">' +
    '<span>' + t('units.set_all_target') + '<input class="pet-input base-input" type="number" min="0" max="500" step="0.1" ' +
    'value="' + common + '" placeholder="' + t('units.mixed') + '" onchange="setUnitEmuAll(' + jsStr(kind) + ', this.value)">%</span>' +
    '<span>' +
    '<button class="ghost" onclick="bumpUnitEmu(' + jsStr(kind) + ', 1)">+1</button> ' +
    '<button class="ghost" onclick="bumpUnitEmu(' + jsStr(kind) + ', 5)">+5</button> ' +
    '<button class="ghost" onclick="bumpUnitEmu(' + jsStr(kind) + ', -1)">&minus;1</button> ' +
    '<button class="ghost" onclick="resetUnitEmu(' + jsStr(kind) + ')">' + t('units.reset') + '</button>' +
    '</span></div>';

  // --- per skill: cost for one unit and for the whole group ---
  const skillRows = emu.bySkill.map(r => {
    const paying = r.perUnit.filter(p => p.cost > 0).map(p => p.cost);
    const levels = units.map(x => x[r.skill] || 0);
    return {
      skill: r.skill,
      from: Math.min.apply(null, levels),
      fromMax: Math.max.apply(null, levels),
      target: r.target,
      steps: Math.max.apply(null, r.perUnit.map(p => p.steps)),
      one: paying.length ? Math.min.apply(null, paying) : 0,
      oneMax: paying.length ? Math.max.apply(null, paying) : 0,
      paying: paying.length,
      total: r.total,
      maxTarget: UM.maxAffordableTarget(units, r.skill, credits).target,
    };
  });
  html += tableHtml('tbl-emu-' + kind, skillRows, [
    { label: t('units.col_skill'), numeric: false, getValue: r => skillLabel(r.skill),
      render: r => '<b>' + esc(skillLabel(r.skill)) + '</b>' },
    { label: t('units.col_now'), numeric: true, getValue: r => r.from,
      render: r => (r.from === r.fromMax ? r.from + '%' : r.from + '&ndash;' + r.fromMax + '%') },
    { label: t('units.col_target'), numeric: true, getValue: r => r.target,
      render: r => '<input class="pet-input base-input" type="number" min="0" max="500" step="0.1" value="' + r.target +
        '" onchange="setUnitEmuTarget(' + jsStr(kind) + ', ' + jsStr(r.skill) + ', this.value)">' +
        ' <button class="ghost" style="padding:2px 8px;font-size:11px" title="' + t('units.max_title') + '"' +
        ' onclick="maxUnitEmu(' + jsStr(kind) + ', ' + jsStr(r.skill) + ')">' + t('units.max_btn', { n: r.maxTarget }) + '</button>' },
    { label: t('units.col_steps'), numeric: true, getValue: r => r.steps,
      render: r => r.steps ? '+' + (r.steps / 10).toFixed(1) + '%' : '&mdash;' },
    { label: t('units.col_cost_one'), numeric: true, getValue: r => r.one,
      render: r => !r.paying ? '<span style="color:var(--dim)">' + t('units.at_target') + '</span>'
        : (r.one === r.oneMax ? '<span title="' + fmtN(r.one) + '">' + fmtC(r.one) + '</span>'
          : fmtC(r.one) + '&ndash;' + fmtC(r.oneMax)) },
    { label: t('units.col_cost_all', { n: units.length }), numeric: true, getValue: r => r.total,
      render: r => r.total ? '<b title="' + fmtN(r.total) + '">' + fmtC(r.total) + '</b>' : '<span style="color:var(--dim)">&mdash;</span>' },
    { label: t('units.col_pct_credits'), numeric: true, getValue: r => r.total,
      render: r => credits > 0 ? (r.total / credits * 100).toFixed(1) + '%' : '?' },
  ]);

  // --- per unit: what each individual one costs to reach those targets ---
  const unitCols = [
    { label: label, numeric: false, getValue: r => r.name,
      render: r => '<span class="inv-stat">' + unitIcon(kind) + '<b>' + esc(r.name) + '</b></span>' },
  ].concat(skills.map(s => ({
    label: skillLabel(s), numeric: true, getValue: r => r.costs[s],
    render: r => r.costs[s] ? '<span title="' + fmtN(r.costs[s]) + '">' + fmtC(r.costs[s]) + '</span>'
      : '<span style="color:var(--dim)">&mdash;</span>',
  }))).concat([
    { label: t('units.col_unit_total'), numeric: true, getValue: r => r.total,
      render: r => r.total ? '<b title="' + fmtN(r.total) + '">' + fmtC(r.total) + '</b>' : '<span style="color:var(--dim)">&mdash;</span>' },
  ]);
  html += '<div class="sub" style="margin:14px 0 4px">' + t('units.per_unit_note') + '</div>';
  html += tableHtml('tbl-emu-units-' + kind, emu.perUnit, unitCols);

  // --- buying one more and catching it up to the same targets ---
  const price = u[kind].nextPrice;
  if (price !== null && price !== undefined) {
    const catchUp = skills.reduce((s, sk) => s + UM.cumulativeUnitCost(0, targets[sk]), 0);
    html += '<div class="list" style="margin-top:10px"><div class="row"><span>' +
      t('units.emu_extra', {
        n: units.length + 1, label: unitGroupWord(kind, 'lc'), price: fmtC(price), catchup: fmtC(catchUp),
        total: fmtC(price + catchUp), owned: units.length, owned_cost: fmtC(emu.total)
      }) +
      '</span></div></div>';
  }
  return html;
}

function unitEmuSection(kind) {
  const label = unitGroupWord(kind);
  return headIcon(unitIcon(kind), t('units.emu_title', { label: label })) +
    '<div class="sub">' + t('units.emu_note') + '</div>' +
    '<div id="emu-' + kind + '">' + unitEmuHtml(kind) + '</div>';
}
