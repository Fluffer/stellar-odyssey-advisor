// ---- Crafting XP simulator ----
// Required XP comes from the crafting level curve (CraftMath.targetXp: each
// level costs 10% more than the last); the scrap half is the Craftron 3000
// module, which turns metal scraps into crafting XP at
// floor(scraps x (1 + bonus%/100)). Both live in public/craft-math.js so the
// engine and the GUI run the same math. Inputs are remembered in
// localStorage ('advisor-craft') and only the outputs are rewritten on
// change, so typing in a box does not lose focus.
function craftSaved() {
  try { return JSON.parse(localStorage.getItem('advisor-craft') || '{}') || {}; }
  catch { return {}; }
}
function craftSave(patch) {
  // v2 marks a save whose override boxes carry the live defaults; a v1 save
  // (or none) predates the auto-fill and its stored 0s must not mask them.
  const o = Object.assign(craftSaved(), { v: 2 }, patch);
  try { localStorage.setItem('advisor-craft', JSON.stringify(o)); } catch {}
  return o;
}
function craftNum(id, fallback) {
  const el = document.getElementById(id);
  if (!el || el.value === '') return fallback;
  const n = Number(el.value);
  return isFinite(n) ? n : fallback;
}
function renderCrafting(c) {
  if (!c) return '<div class="empty-note">' + t('craft.unavailable') + '</div>';
  const saved = craftSaved();
  // Live values the state can see prefill the override boxes (global XP
  // event, squadron Forge level, crafting dungeon bonus); a stored override
  // wins, and anything still unknown stays 0.
  const def = c.defaults || { forgeLevel: 0, dungeonBonus: 0, pvpBoost: 0, globalXpBoost: 0 };
  const honorOverrides = saved.v === 2;
  const pick = (field) => (honorOverrides && saved[field] !== undefined ? saved[field] : (def[field] !== undefined ? def[field] : 0));
  const v = {
    target: saved.target !== undefined ? saved.target : (c.level + 1),
    scraps: saved.scraps !== undefined ? saved.scraps : Math.floor(c.scrapStock),
    hours: saved.hours !== undefined ? saved.hours : 0,
    forgeLevel: pick('forgeLevel'),
    dungeonBonus: pick('dungeonBonus'),
    pvpBoost: pick('pvpBoost'),
    globalXpBoost: pick('globalXpBoost'),
  };
  // Outputs are built here, not only on input: the sandboxed render check and
  // a page load with stored values must show the numbers without a keypress.
  const out = craftOutputs(c, v);
  let html = '';
  html += '<div class="cards">';
  html += card(cardIcon(resIcon('crafting_level', 'mat-tile xs'), t('craft.card_level')),
    c.level + ' <span style="font-size:11px;color:var(--dim)">' +
    t('craft.card_level_detail', { cur: fmtC(c.currentXp), target: fmtC(c.nextLevelXp) }) + '</span>');
  html += card(cardIcon(matIcon('metal scrap'), t('craft.card_scrap_stock')), fmtC(c.scrapStock));
  html += card(cardIcon(matIcon('metal scrap'), t('craft.card_scrap_rate')), fmtC(c.scrapPerHour));
  html += card(t('craft.card_module_boost'),
    c.craftronUnlocked ? c.moduleBoost.toFixed(1) + '%' : '<span style="color:var(--dim)">' + t('craft.card_module_locked') + '</span>');
  html += '</div>';

  html += '<h2>' + t('craft.req_title') + '</h2>';
  html += '<div class="sub">' + t('craft.req_note') + '</div>';
  html += '<div class="list"><div class="row"><span style="min-width:150px"><b>' + t('craft.req_target') + '</b></span>' +
    '<input type="number" id="craftTarget" min="' + (c.level + 1) + '" step="1" value="' + esc(String(v.target)) +
    '" oninput="simCraft()" class="pet-input" style="width:110px"></div></div>';
  html += '<div id="craftReqOut" class="list" style="margin-top:10px">' + out.req + '</div>';

  html += '<h2>' + t('craft.scrap_title') + '</h2>';
  html += '<div class="sub">' + t('craft.scrap_note') + '</div>';
  html += '<div class="list">';
  html += '<div class="row"><span style="min-width:220px"><b>' + t('craft.scrap_amount') + '</b></span>' +
    '<input type="number" id="craftScraps" min="0" step="1" value="' + esc(String(v.scraps)) +
    '" oninput="simCraft()" class="pet-input" style="width:150px">' +
    '<button class="ghost" onclick="craftUseStock(' + Math.floor(c.scrapStock) + ')">' + t('craft.scrap_use_stock') + '</button></div>';
  html += '<div class="row"><span style="min-width:220px"><b>' + t('craft.scrap_hours') + '</b></span>' +
    '<input type="number" id="craftHours" min="0" step="1" value="' + esc(String(v.hours)) +
    '" oninput="simCraft()" class="pet-input" style="width:110px"></div>';
  html += '</div>';

  html += '<div class="sub" style="margin-top:8px">' + t('craft.override_title') + '</div>';
  const overrides = [
    ['forgeLevel', 'craft.override_forge'],
    ['dungeonBonus', 'craft.override_dungeon'],
    ['pvpBoost', 'craft.override_pvp'],
    ['globalXpBoost', 'craft.override_global'],
  ];
  html += '<div class="list">';
  for (const [field, key] of overrides) {
    html += '<div class="row"><span style="min-width:220px"><b>' + t(key) + '</b></span>' +
      '<input type="number" id="craft_' + field + '" min="0" step="1" value="' +
      esc(String(v[field])) + '" oninput="simCraft()" class="pet-input" style="width:110px"></div>';
  }
  html += '</div>';
  html += '<div id="craftScrapOut" style="margin-top:10px">' + out.scrap + '</div>';
  return html;
}
function craftUseStock(stock) {
  const el = document.getElementById('craftScraps');
  if (el) el.value = stock;
  simCraft();
}
// The bonus breakdown table: additive parts are percentages, the rest are
// multipliers, so each row shows the factor it contributes to the total.
function craftBonusRows(c, extra) {
  const CM = window.CraftMath;
  const b = CM.craftronBonus({
    craftingLevel: c.level,
    catalystCraftingXp: c.catalystCraftingXp,
    catPetLevel: c.catEquipped ? c.catPetLevel : 0,
    premium: c.premium,
    moduleBoost: c.moduleBoost,
    gasGiant: c.gasGiant,
    techBaseXpBoost: c.techBaseXpBoost,
    forgeLevel: extra.forgeLevel,
    dungeonBonus: extra.dungeonBonus,
    pvpBoost: extra.pvpBoost,
    globalXpBoost: extra.globalXpBoost,
  });
  const f = p => 1 + p / 100;
  return {
    bonus: b,
    rows: [
      { label: t('craft.bonus_additive'), value: '+' + b.additive.toFixed(1) + '%' },
      { label: t('craft.part_tech'), value: '&times;' + f(b.parts.tech).toFixed(3) },
      { label: t('craft.part_premium'), value: '&times;' + f(b.parts.premium).toFixed(3) },
      { label: t('craft.part_module'), value: '&times;' + f(b.parts.moduleBoost / 20).toFixed(3) },
      { label: t('craft.part_gas'), value: '&times;' + f(b.parts.gasGiant).toFixed(3) },
      { label: t('craft.part_forge'), value: '&times;' + f(b.parts.forgeBonus).toFixed(3) },
      { label: t('craft.part_dungeon'), value: '&times;' + f(b.parts.dungeon).toFixed(3) },
      { label: t('craft.part_highlevel'), value: '&times;' + b.highLevelFactor.toFixed(3) },
      { label: t('craft.bonus_total'), value: '<b>+' + b.total.toFixed(1) + '%</b>' },
    ],
  };
}
// Both halves of the tab as HTML, from a values object. Shared by the render
// and by simCraft so the input boxes and the stored-values path produce
// identical output.
function craftOutputs(c, values) {
  const CM = window.CraftMath;
  if (!CM) return { req: '', scrap: '' };
  const target = Math.max(c.level + 1, Math.floor(Number(values.target) || (c.level + 1)));
  const scraps = Math.max(0, Number(values.scraps) || 0);
  const hours = Math.max(0, Number(values.hours) || 0);
  const extra = {
    forgeLevel: Math.max(0, Number(values.forgeLevel) || 0),
    dungeonBonus: Math.max(0, Number(values.dungeonBonus) || 0),
    pvpBoost: Math.max(0, Number(values.pvpBoost) || 0),
    globalXpBoost: Math.max(0, Number(values.globalXpBoost) || 0),
  };

  // --- required crafting XP ---
  let req = '';
  if (target <= c.level) {
    req += '<div class="row">' + t('craft.req_done', { to: target }) + '</div>';
  } else {
    const needed = CM.xpToReach(c.level, c.currentXp, target);
    req += '<div class="row"><span>' + t('craft.req_needed') + ' <b>' + fmtC(needed) + '</b></span>' +
      '<span>' + t('craft.req_levels') + ' <b>' + (target - c.level) + '</b></span></div>';
    const rows = [];
    let cum = Math.max(0, CM.targetXp(c.level) - c.currentXp);
    let n = c.level;
    for (; n < target && (n - c.level) < 20; n++) {
      rows.push({ level: n, xp: CM.targetXp(n), cum });
      cum += CM.targetXp(n + 1);
    }
    req += '<h3>' + t('craft.req_curve_title') + '</h3>';
    req += tableHtml('tbl-craft-curve', rows, [
      { label: t('craft.col_level'), numeric: true, getValue: r => r.level, render: r => r.level },
      { label: t('craft.col_xp'), numeric: true, getValue: r => r.xp, render: r => fmtC(r.xp) },
      { label: t('craft.col_cumulative'), numeric: true, getValue: r => r.cum, render: r => fmtC(r.cum) },
    ]);
    if (target - n > 0) req += '<div class="sub">' + t('craft.req_more', { n: target - n }) + '</div>';
  }

  // --- Craftron 3000 scrap conversion ---
  const bb = craftBonusRows(c, extra);
  const totalScraps = scraps + c.scrapPerHour * hours;
  const xpGain = CM.scrapToXp(totalScraps, bb.bonus.total);
  const xpPerScrap = 1 + bb.bonus.total / 100;
  const after = CM.applyXp(c.level, c.currentXp, xpGain);

  let scrap = '<h3>' + t('craft.bonus_title') + '</h3>';
  scrap += tableHtml('tbl-craft-bonus', bb.rows, [
    { label: t('craft.bonus_title'), numeric: false, getValue: r => r.label, render: r => esc(r.label) },
    { label: t('craft.col_value'), numeric: true, getValue: r => r.value, render: r => r.value },
  ]);
  scrap += '<div class="row" style="margin-top:8px"><span>' + t('craft.scraps_used') + ' <b>' + fmtC(totalScraps) + '</b></span>' +
    '<span>' + t('craft.xp_per_scrap') + ' <b>' + xpPerScrap.toFixed(3) + '</b></span>' +
    '<span>' + t('craft.xp_gained') + ' <b>' + fmtC(xpGain) + '</b></span></div>';
  scrap += '<div class="row"><span>' + t('craft.result_level', { level: after.level }) +
    ' <span style="color:var(--dim)">' + t('craft.result_progress', { cur: fmtC(after.currentXp), target: fmtC(CM.targetXp(after.level)) }) + '</span></span>' +
    (after.gained > 0 ? '<span class="gain">' + t('craft.levels_gained', { n: after.gained }) + '</span>' : '') + '</div>';

  // What it takes to get from here to the target level.
  const startNeeded = CM.xpToReach(c.level, c.currentXp, target);
  if (target > c.level && startNeeded > 0) {
    const left = CM.xpToReach(after.level, after.currentXp, target);
    const pct = Math.max(0, Math.min(100, (1 - left / startNeeded) * 100)).toFixed(1);
    scrap += '<div class="row"><span>' + t('craft.to_target', { xp: fmtC(left), pct: pct, to: target }) + '</span></div>';
    scrap += '<div class="row"><span>' + t('craft.scraps_needed') + ' <b>' + fmtC(Math.ceil(left / xpPerScrap)) + '</b></span>';
    if (c.scrapPerHour > 0) {
      scrap += '<span>' + t('craft.hours_needed') + ' <b>' + fmtH(left / (c.scrapPerHour * xpPerScrap)) + '</b></span>';
    } else {
      scrap += '<span style="color:var(--dim)">' + matIcon('metal scrap') + t('craft.no_rate') + '</span>';
    }
    scrap += '</div>';
  }
  return { req, scrap };
}
function simCraft() {
  const d = window.lastData;
  if (!d || !d.craft || !window.CraftMath) return;
  const c = d.craft;
  const reqOut = document.getElementById('craftReqOut');
  const scrapOut = document.getElementById('craftScrapOut');
  if (!reqOut && !scrapOut) return;
  const values = {
    target: Math.max(c.level + 1, Math.floor(craftNum('craftTarget', c.level + 1))),
    scraps: Math.max(0, craftNum('craftScraps', c.scrapStock)),
    hours: Math.max(0, craftNum('craftHours', 0)),
    forgeLevel: Math.max(0, craftNum('craft_forgeLevel', 0)),
    dungeonBonus: Math.max(0, craftNum('craft_dungeonBonus', 0)),
    pvpBoost: Math.max(0, craftNum('craft_pvpBoost', 0)),
    globalXpBoost: Math.max(0, craftNum('craft_globalXpBoost', 0)),
  };
  const out = craftOutputs(c, values);
  craftSave(values);
  if (reqOut) reqOut.innerHTML = out.req;
  if (scrapOut) scrapOut.innerHTML = out.scrap;
}
