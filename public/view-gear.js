const SHIP_SLOT_KEYS = ['weapon_slot', 'shield_slot', 'engine_slot',
  'sensors_slot', 'laser_slot', 'probes_slot'];
function shipSlotLabel(slot) { return SHIP_SLOT_KEYS.includes(slot) ? t('slot.' + slot) : slot; }

// Item advisor: sortable table + recommendations list + cooldown/scan cards.
// d.shipItems: { items: [...], cooldown: {...}, scan: {...} } (lib/ship-items.js).
function renderShipItemAdvisor(si) {
  if (!si) return '<div class="empty-note">' + t('ship.no_data') + '</div>';
  let html = '';
  const cols = [
    { label: t('ship.col_slot'), numeric: false, getValue: it => it.slot,
      render: it => '<span class="inv-stat">' + slotIcon(it.slot) + '<b>' + esc(shipSlotLabel(it.slot)) + '</b></span>' },
    { label: t('ship.col_item'), numeric: false, getValue: it => it.name,
      render: it => esc(it.name) + ' <span style="color:' + dotColor(it.rarity) + '">(' + esc(rarityLabel(it.rarity)) + ')</span>' +
        (it.enhanced ? ' <span class="badge b-ok">' + t('ship.enhanced') + '</span>' : '') +
        (it.anomaly ? ' <span class="badge b-warn">' + t('ship.anomaly') + '</span>' : '') },
    { label: t('ship.col_lvl'), numeric: true, getValue: it => it.level, render: it => it.level },
    { label: t('ship.col_skill_lvl'), numeric: true, getValue: it => it.skillLevel,
      render: it => esc(itemSkillLabel(it.matchingSkill)) + ' ' + it.skillLevel },
    { label: t('ship.col_behind'), numeric: true, getValue: it => it.levelsBehind,
      render: it => it.levelsBehind > 0
        ? ('<b style="color:' + (it.levelsBehind >= 5 ? 'var(--bad)' : 'var(--warn)') + '">' + it.levelsBehind + '</b>')
        : '0' },
    { label: t('ship.col_value'), numeric: true, getValue: it => it.value, render: it => it.value + ' / ' + it.valueMaxForLevel },
    { label: t('ship.col_pct_of_max'), numeric: true, getValue: it => it.valuePctOfMax, render: it => it.valuePctOfMax + '%' },
    { label: t('ship.col_mods'), numeric: false, getValue: it => it.bonuses.join(','),
      render: it => it.bonuses.map(b => esc(modLabel(b))).join(', ') || '<span style="color:var(--dim)">' + t('common.none') + '</span>' },
  ];
  html += tableHtml('tbl-ship-items', si.items, cols);

  html += '<h3 style="font-size:14px;color:var(--accent);margin:14px 0 8px">' + t('ship.recommendations') + '</h3><div class="list">';
  let any = false;
  for (const it of si.items) {
    for (const r of it.recommendations) {
      any = true;
      html += '<div class="row">' + slotIcon(it.slot, 'mat-tile xs') + '<b>' + esc(shipSlotLabel(it.slot)) + '</b><span>' + esc(r) + '</span></div>';
    }
  }
  if (!any) html += '<div class="empty-note">' + t('ship.no_recommendations') + '</div>';
  html += '</div>';

  const c = si.cooldown;
  html += '<h3 style="font-size:14px;color:var(--accent);margin:14px 0 8px">' + t('ship.engine_cooldown') + '</h3><div class="cards">';
  html += card(t('ship.total_reduction'), c.d + '%' + (c.componentBreakdown.globalBoost ? ' <span style="font-size:11px;color:var(--dim)">' + t('ship.wo_boost_pct', {n: c.dBase}) + '</span>' : ''));
  html += card(cardIcon(slotIcon('engine_slot', 'mat-tile xs'), t('ship.engine_value')), (c.componentBreakdown.engineValue / 100).toFixed(2) + '% <span style="font-size:11px;color:var(--dim)">' + t('ship.value_raw', {n: c.componentBreakdown.engineValue}) + '</span>');
  html += card(t('ship.cooldown_mods'), '+' + c.componentBreakdown.mods + '%');
  html += card(cardIcon(petIcon('Korin', 'mat-tile xs'), t('ship.korin_equipped')), '+' + c.componentBreakdown.korin + '%');
  if (c.componentBreakdown.globalBoost) {
    html += card(t('ship.global_boost'), '+' + c.componentBreakdown.globalBoost + '% <span style="font-size:11px;color:var(--dim)">' + t('ship.boost_tier_left', {tier: c.componentBreakdown.globalBoostTier, hours: c.componentBreakdown.globalBoostHoursLeft}) + '</span>');
  }
  html += card(t('ship.at_10ly'), t('ship.seconds', {n: c.at10ly.seconds}) + (c.at10ly.floored ? ' <span class="badge b-warn">' + t('ship.floor') + '</span>' : '') +
    (c.componentBreakdown.globalBoost ? ' <span style="font-size:11px;color:var(--dim)">' + t('ship.secs_wo_boost', {n: c.at10lyNoBoost.seconds}) + '</span>' : ''));
  html += card(t('ship.at_50ly'), t('ship.seconds', {n: c.at50ly.seconds}) + (c.at50ly.floored ? ' <span class="badge b-warn">' + t('ship.floor') + '</span>' : ''));
  html += card(t('ship.at_100ly'), t('ship.seconds', {n: c.at100ly.seconds}) + (c.at100ly.floored ? ' <span class="badge b-warn">' + t('ship.floor') + '</span>' : ''));
  html += '</div>';
  html += '<div class="sub">' + t('ship.cooldown_formula', {pct: c.breakpointD10ly}) +
    (c.flooredNowAt10ly ? t('ship.floored_up_to', {ly: c.flooredUpToLy}) : '') + ' &mdash; ' +
    (c.withCooldownModAt10ly
      ? (c.flooredNowAt10ly
        ? t('ship.cd_boost_pins_floor')
        : t('ship.cd_mod_helps'))
      : t('ship.cd_floored_without_boost')) +
    '</div>';

  const s = si.scan;
  html += '<h3 style="font-size:14px;color:var(--accent);margin:14px 0 8px">' + t('ship.scan_reward') + '</h3><div class="cards">';
  html += card(t('ship.multiplier'), '&times;' + s.multiplier.toFixed(4));
  html += card(t('ship.sensors_component'), '+' + (s.sensorsComponent * 100).toFixed(2) + '%');
  html += card(t('ship.mod_component'), '+' + (s.modComponent * 100).toFixed(2) + '%');
  html += '</div>';

  return html;
}

function renderGear(gear) {
  let html = '<div class="sub">' + t('gear.inherit_note') + '</div>';
  html += '<div class="grid">';
  for (const it of gear) {
    if (it.empty) {
      html += '<div class="item"><h3><span class="inv-stat">' + slotIcon(it.slot) + '<span>' + esc(gearSlotLabel(it.slot)) + '</span></span></h3>' +
        '<div class="meta">' + t('gear.no_item_equipped') + '</div></div>';
      continue;
    }
    html += '<div class="item"><h3><span class="inv-stat">' + slotIcon(it.slot) + '<span>' + esc(it.name) + '</span></span></h3>';
    html += '<div class="meta">' + esc(gearSlotLabel(it.slot)) + ' &middot; ' + esc(statCatLabel(it.category)) + ' &middot; ' + t('gear.lvl_n', {n: it.level}) + ' ' + esc(rarityLabel(it.rarity)) + '</div>';
    for (const g of it.groups) {
      const full = g.filled >= g.slots;
      const style = g.inherited ? ' style="opacity:0.55"' : '';
      html += '<div class="group"' + style + '><div class="group-head"><span>' + actIcon(g.activity, 'mat-tile xs') +
        esc(actLabel(g.activity, it.slot)) + '</span>';
      if (g.inherited) {
        html += '<span class="badge b-empty">' + t('gear.inherits_from', {name: esc(actLabel(g.inheritedFrom, it.slot))}) + '</span></div>';
      } else {
        const cls = g.filled === 0 ? 'b-empty' : (full ? 'b-ok' : 'b-warn');
        html += '<span class="badge ' + cls + '">' + g.filled + '/' + g.slots + '</span></div>';
        for (const c of g.catalysts) {
          html += '<div class="cat">' + catIcon(c.stat, c.rarity, null, true);
          html += '<span class="rar" style="color:' + dotColor(c.rarity) + '">' + esc(statLabel(c.stat)) + '</span>';
          html += '<span>' + c.range + '%</span>';
          if (c.halved) html += '<span style="color:var(--dim)">' + t('gear.halved') + '</span>';
          if (c.sameCount > 1) html += '<span style="color:var(--dim)">' + t('gear.same_count', {n: c.sameCount}) + '</span>';
          html += '<span class="info">' + t('gear.eff', {v: esc(c.effText)}) + '</span></div>';
        }
      }
      if (g.poolCount > 0 && !full) html += '<div class="info" style="color:var(--dim);font-size:11px">' + t('gear.matching_in_inventory', {n: g.poolCount}) + '</div>';
      html += '</div>';
    }
    html += '</div>';
  }
  return html + '</div>';
}

// Stable identity for one install/replace action, used for the "done"
// checkmark and the new-since-last-analyze highlight.
function installKey(variant, a) {
  return 'i|' + variant + '|' + a.item + '|' + a.activity + '|' + (a.add.id || a.add.text) +
    '|' + (a.remove ? (a.remove.id || a.remove.text) : '');
}

// Group install actions by activity tab.
function renderInstalls(installs, freed, battleNote, gear, variant, doneSet, prevKeys) {
  let html = '';
  if (battleNote) html += '<div class="sub">' + esc(battleNote) + '</div>';

  const byAct = {};
  const order = ['default', 'exploring', 'crafting', 'galaxyboss', 'dungeons', 'voyager'];
  for (const a of installs) {
    (byAct[a.activity] = byAct[a.activity] || []).push(a);
  }
  // Which tabs exist on the equipped gear (all variants share the same tabs)?
  const tabsInUse = new Set();
  if (gear) {
    for (const it of gear) {
      if (it.empty || !it.groups) continue;
      for (const g of it.groups) tabsInUse.add(g.activity);
    }
  }
  const acts = order.filter(a => byAct[a] || tabsInUse.has(a))
    .concat(Object.keys(byAct).filter(a => !order.includes(a)));
  for (const act of acts) {
    html += '<div class="plan-group"><h3>' + actIcon(act, 'mat-tile xs') +
      t('installs.act_tab', {name: esc(actLabel(act))}) + '</h3><div class="list">';
    if (byAct[act] && byAct[act].length) {
      byAct[act].forEach(a => {
        const key = installKey(variant, a);
        const isDone = doneSet.has(key);
        const isNew = !!prevKeys && !prevKeys.has(key);
        html += '<div class="row' + (isDone ? ' done' : '') + (isNew ? ' new-row' : '') + '">';
        html += '<input type="checkbox" class="donecheck" ' + (isDone ? 'checked' : '') +
          ' onchange="toggleDone(' + jsStr(key) + ', this.checked)">';
        html += '<span class="num">' + a.n + '.</span>';
        html += slotIcon(a.slot, 'mat-tile xs') + '<b>' + esc(a.item) + '</b> ';
        if (a.action === 'install') {
          html += t('installs.install') + ' ';
        } else {
          html += t('installs.replace_with', {old: '<span style="color:var(--dim)">' + catText(a.remove) + '</span>'}) + ' ';
        }
        html += '<span style="color:' + dotColor(a.add.rarity) + ';font-weight:600">' + catText(a.add) + '</span>';
        if (a.add.projected) html += '<span class="badge b-warn">' + t('installs.from_merge') + '</span>';
        if (isNew) html += '<span class="new-badge">' + t('installs.new') + '</span>';
        if (a.capInfo) {
          const ci = a.capInfo;
          const tone = capTone(ci.after, ci.cap);
          html += '<span class="captag" title="' + t('installs.cap_title', {stat: esc(statLabel(a.add.stat).replaceAll('_', ' '))}) + '">' +
            '<span class="dimtext">' + esc(ci.beforeText) + ' &rarr; </span>' +
            '<b style="color:' + tone.color + '">' + esc(ci.afterText) + '</b>' +
            '<span class="dimtext"> / ' + esc(ci.capText) + '</span>' +
            (ci.over ? '<span class="wasted">' + t('installs.over_cap') + '</span>' : '') + '</span>';
        }
        if (a.npcDeltas) {
          const parts = Object.keys(a.npcDeltas).map(npc => {
            const d = a.npcDeltas[npc];
            const col = d > 0 ? 'var(--good)' : (d < 0 ? 'var(--bad)' : 'var(--dim)');
            return '<span style="color:' + col + '">' + esc(npcLabel(npc)) + ' ' + (d >= 0 ? '+' : '') + d + '</span>';
          });
          html += '<span class="battle" style="font-size:11px">' + parts.join(' &middot; ') + '</span>';
        }
        html += '<span class="gain">+' + esc(a.gainText) + '</span></div>';
      });
    } else {
      html += '<div class="empty-note">' + t('installs.no_changes') + '</div>';
    }
    html += '</div></div>';
  }
  if (freed && freed.length) {
    html += '<div class="sub">' + t('installs.freed', {items: freed.map(catTextFromString).join(', ')}) + '</div>';
  }
  return html;
}

// One card per NPC: current battle-benchmark level -> projected level if
// every action in the Full-explore plan above were applied, plus an avg card.
function renderProjection(proj, battleBase) {
  let html = '<h3 style="font-size:14px;color:var(--accent);margin:0 0 8px">' + t('proj.title') + '</h3>';
  html += '<div class="cards">';
  for (const npc of Object.keys(proj.npcLevels)) {
    const base = battleBase ? battleBase[npc] : null;
    const lvl = proj.npcLevels[npc];
    const d = proj.deltas[npc];
    const col = d > 0 ? 'var(--good)' : (d < 0 ? 'var(--bad)' : 'var(--dim)');
    html += '<div class="card"><div class="k">' + cardIcon(npcIcon(npc, 'mat-tile xs'), esc(npcLabel(npc))) + '</div><div class="v">' +
      (base !== null && base !== undefined ? base : '?') + ' &rarr; ' + lvl +
      ' <span style="font-size:12px;color:' + col + '">(' + (d >= 0 ? '+' : '') + d + ')</span></div></div>';
  }
  const avgCol = proj.avgDelta > 0 ? 'var(--good)' : (proj.avgDelta < 0 ? 'var(--bad)' : 'var(--dim)');
  html += '<div class="card"><div class="k">' + t('proj.avg_delta') + '</div><div class="v" style="color:' + avgCol + '">' +
    (proj.avgDelta >= 0 ? '+' : '') + proj.avgDelta + '</div></div>';
  html += '</div>';
  html += '<div class="sub">' + t('proj.note') + '</div>';
  return html;
}

// d.overrideLosses entries: { item, slot, activity, currentText, inheritedText, lostText }.
// A non-empty specialized group REPLACES (not adds to) whatever the item
// would otherwise inherit in that context - these are cases where the
// specialized group is worth less than what it overrides, so the player
// would be better off emptying it instead.
function renderOverrideLosses(list) {
  if (!list || !list.length) return '';
  let html = '<h2>' + t('gear.override_losses_title') + '</h2><div class="list warnlist">';
  for (const o of list) {
    html += '<div class="row">' + slotIcon(o.slot, 'mat-tile xs') + '<b>' + esc(o.item) + '</b> &mdash; ' +
      t('gear.override_loss', {act: esc(actLabel(o.activity)), cur: esc(o.currentText), inh: esc(o.inheritedText)}) +
      ' &mdash; <span style="color:var(--bad)">' + t('gear.losing', {v: esc(o.lostText)}) + '</span>' +
      '</div>';
  }
  return html + '</div>';
}

// Per-activity stat panel (like the game's player-page bonus display):
// what is active during each activity, with the cap where one exists.
// d.contextTotals: { ctx: [{ stat, category, total, totalText, cap, capText, relevant }] }
function renderContextTotals(ct, hideStats) {
  if (!ct) return '';
  const order = ['default', 'exploring', 'crafting', 'galaxyboss', 'dungeons', 'voyager'];
  const catOrder = ['battling', 'boost', 'utility'];
  let html = '<div class="ctxgrid">';
  for (const ctx of order) {
    // Only what actually does something during this activity; inherited
    // stats with no effect here are noise.
    const rows = ct[ctx] && ct[ctx].filter(r => r.relevant && !(hideStats && hideStats.has(r.stat)));
    if (!rows) continue;
    html += '<div class="item"><h3 style="text-transform:capitalize"><span class="inv-stat">' + actIcon(ctx) +
      '<span>' + esc(actLabel(ctx)) + '</span></span></h3>';
    if (!rows.length) {
      html += '<div class="empty-note">' + t('gear.no_bonuses_active') + '</div></div>';
      continue;
    }
    const byCat = {};
    for (const r of rows) (byCat[r.category || 'other'] = byCat[r.category || 'other'] || []).push(r);
    const cats = catOrder.filter(c => byCat[c]).concat(Object.keys(byCat).filter(c => !catOrder.includes(c)));
    for (const cat of cats) {
      html += '<div class="group-head" style="margin-top:6px"><span>' + esc(statCatLabel(cat)) + '</span></div>';
      for (const r of byCat[cat]) {
        const zero = r.total <= 0.0001;
        html += '<div class="ctxstat' + (zero ? ' zero' : '') + '">';
        html += '<div class="ctxstat-line"><span>' + esc(statLabel(r.stat).replaceAll('_', ' ')) + '</span>';
        if (r.cap === null) {
          html += '<span class="info"><b>' + esc(r.totalText) + '</b></span></div>';
        } else {
          const tone = capTone(r.total, r.cap);
          html += '<span class="info"><b style="color:' + tone.color + '">' + esc(r.totalText) + '</b>' +
            '<span class="dimtext"> / ' + esc(r.capText) + '</span>' +
            (r.wastedText ? '<span class="wasted">' + t('gear.wasted', {v: esc(r.wastedText)}) + '</span>' : '') + '</span></div>';
          html += '<span class="minibar"><span class="minibar-fill" style="width:' + tone.width + '%;background:' + tone.color + '"></span></span>';
        }
        html += '</div>';
      }
    }
    html += '</div>';
  }
  return html + '</div>';
}

// Stable identity for one merge group, used for the "done" checkmark and
// the new-since-last-analyze highlight.
function mergeKey(plan, step, group) {
  return 'm|' + plan.stat + '|' + plan.activity + '|' + step.from + '|' + group.ids.join(',');
}

function renderMerges(plans, player, reqs, doneSet, prevKeys) {
  let html = '<div class="sub">' + t('merges.craft_header', {lvl: player.craftLevel, bonus: player.rangeBonus, success: player.successBonus.toFixed(1)}) + '</div>';
  if (reqs && reqs.length) {
    html += '<div class="sub">' + t('merges.tier_reqs', {list:
      reqs.map(m => t('merges.tier_req_item', {rarity: esc(rarityLabel(m.rarity)), n: m.resultNeeded})).join(' &middot; ')}) + '</div>';
  }
  if (!plans.length) return html + '<div class="empty-note">' + t('merges.none_possible') + '</div>';
  for (const p of plans) {
    const endTier = p.steps.length ? p.steps[p.steps.length - 1].to : null;
    html += '<div class="merge-plan"><h3><span class="inv-stat">' + catIcon(p.stat, endTier, null, true) +
      '<span>' + esc(statLabel(p.stat)) + ' <span style="color:var(--dim)">(' +
      actIcon(p.activity, 'mat-tile xs') + esc(actLabel(p.activity)) + ')</span>' +
      (p.chainGoal ? ' &mdash; ' + t('merges.goal', {goal: '<span style="color:var(--warn)">&rarr; ' + chainGoalText(p.chainGoal) +
        (p.chainGoalValue ? ' <span class="dimtext">(' + t('merges.eff', {v: esc(p.chainGoalValue)}) + ')</span>' : '') + '</span>'}) : '') + '</span></span></h3>';
    for (const step of p.steps) {
      const sameTier = step.from === step.to ? t('merges.range_perfection') : '';
      html += '<div class="step"><div class="head"><b>' + esc(rarityLabel(step.from)) + ' &rarr; ' + esc(rarityLabel(step.to)) + sameTier + '</b>' +
        t('merges.step_info', {chance: step.chance, qc: step.qcPerMerge, protect: step.qcProtectPerMerge}) +
        (step.recommendProtect ? ' &middot; <span class="protect">' + t('merges.protect_recommended') + '</span>' : '') + '</div>';
      for (const g of step.groups) {
        const perfect = step.to === 'legendary' && g.result >= 100;
        const key = mergeKey(p, step, g);
        const isDone = doneSet.has(key);
        const isNew = !!prevKeys && !prevKeys.has(key);
        html += '<span class="merge-item' + (isDone ? ' done' : '') + (isNew ? ' new-row' : '') + '">';
        html += '<input type="checkbox" class="donecheck" ' + (isDone ? 'checked' : '') +
          ' onchange="toggleDone(' + jsStr(key) + ', this.checked)">';
        html += '<span class="merge">[' + g.inputs.join(', ') + '] <span class="arrow">&rarr;</span> ' +
          '<span class="res' + (perfect ? ' perfect' : '') + '">' + esc(rarityLabel(step.to)) + ' ' + g.result + (perfect ? t('merges.perfect') : '') + '</span>' +
          (g.valueText ? ' <span class="dimtext">(' + t('merges.eff', {v: esc(g.valueText)}) + ')</span>' : '');
        if (g.pulled && g.pulled.length) {
          for (const pu of g.pulled) {
            html += ' <span style="color:var(--warn)">' + t('merges.pull_first', {cat: catTextFromString(pu.text), item: esc(pu.item), act: esc(actIdLabel(pu.activity)), eff: esc(pu.reinstallText)}) + '</span>';
          }
        }
        html += '</span>';
        if (isNew) html += '<span class="new-badge">' + t('merges.new') + '</span>';
        html += '</span>';
      }
      html += '</div>';
    }
    if (p.projectedLegendaries.length) {
      html += '<div class="proj">' + t('merges.projected_legendaries', {list: esc(p.projectedLegendaries.join(', ')), n: p.perfectCount}) + '</div>';
    }
    html += '</div>';
  }
  return html;
}

// Walk lastData / prevData with the same key functions used above, so the
// installs/merges tabs can flag rows that did not exist in the prior fetch.
function computeInstallKeySet(data, variant) {
  if (!data) return null;
  const list = variant === 'full' ? data.installs
    : variant === 'resources' ? data.installsResources
    : data.installsMerged;
  const set = new Set();
  (list || []).forEach(a => set.add(installKey(variant, a)));
  return set;
}
function computeMergeKeySet(data) {
  if (!data) return null;
  const set = new Set();
  (data.mergePlans || []).forEach(plan => {
    (plan.steps || []).forEach(step => {
      (step.groups || []).forEach(group => set.add(mergeKey(plan, step, group)));
    });
  });
  return set;
}
