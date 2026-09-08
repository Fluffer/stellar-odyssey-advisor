let autoTimer = null;   // repeating auto-refresh interval
let autoKickoff = null; // one-shot timer for the first run after a restore
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// ---- localStorage-backed "done" checkmarks (installs & merges rows) ----
function loadDone() {
  try { return new Set(JSON.parse(localStorage.getItem('advisor-done') || '[]')); }
  catch (e) { return new Set(); }
}
function saveDone(set) {
  try { localStorage.setItem('advisor-done', JSON.stringify(Array.from(set))); } catch (e) {}
}
function toggleDone(key, checked) {
  const set = loadDone();
  if (checked) set.add(key); else set.delete(key);
  saveDone(set);
  if (window.lastData) render(window.lastData);
}
function resetDone() {
  try { localStorage.removeItem('advisor-done'); } catch (e) {}
  if (window.lastData) render(window.lastData);
}
// Safely embed a string as a single-quoted JS literal inside an
// HTML attribute that itself uses double quotes (e.g. onchange="...").
function jsStr(s) {
  return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

// ---- generic sortable-table helper (click a <th> to sort) ----
window.__tableRegistry = window.__tableRegistry || {};
window.__tableSort = window.__tableSort || {};
function tableRows(id) {
  const reg = window.__tableRegistry[id];
  if (!reg) return [];
  let rows = reg.data.slice();
  const sort = window.__tableSort[id];
  if (sort) {
    const col = reg.columns[sort.col];
    rows.sort((a, b) => {
      const av = col.getValue(a), bv = col.getValue(b);
      if (av < bv) return sort.dir === 'asc' ? -1 : 1;
      if (av > bv) return sort.dir === 'asc' ? 1 : -1;
      return 0;
    });
  }
  return rows;
}
function tbodyHtml(columns, rows) {
  let html = '';
  for (const row of rows) {
    html += '<tr>';
    for (const c of columns) html += '<td' + (c.numeric ? ' class="num"' : '') + '>' + c.render(row) + '</td>';
    html += '</tr>';
  }
  return html;
}
function tableHtml(id, data, columns) {
  window.__tableRegistry[id] = { data, columns };
  const rows = tableRows(id);
  const sort = window.__tableSort[id];
  let html = '<div style="overflow-x:auto"><table class="tbl" id="' + id + '"><thead><tr>';
  columns.forEach((c, i) => {
    const active = sort && sort.col === i;
    const arrow = active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
    html += '<th class="' + (c.numeric ? 'num' : '') + '" onclick="sortTable(' + jsStr(id) + ',' + i + ')">' + esc(c.label) + arrow + '</th>';
  });
  // A header with no body reads as a broken table, not as "nothing here".
  // Several tables (raw lab resources, empty material groups) are legitimately
  // empty in most captures.
  const body = rows.length
    ? tbodyHtml(columns, rows)
    : '<tr><td colspan="' + columns.length + '" style="color:var(--dim);font-style:italic">nothing to show</td></tr>';
  html += '</tr></thead><tbody>' + body + '</tbody></table></div>';
  return html;
}
function sortTable(id, col) {
  const cur = window.__tableSort[id];
  let dir = 'asc';
  if (cur && cur.col === col) dir = cur.dir === 'asc' ? 'desc' : 'asc';
  window.__tableSort[id] = { col, dir };
  const reg = window.__tableRegistry[id];
  const table = document.getElementById(id);
  if (!reg || !table) return;
  const rows = tableRows(id);
  table.querySelector('tbody').innerHTML = tbodyHtml(reg.columns, rows);
  table.querySelectorAll('th').forEach((th, i) => {
    th.textContent = reg.columns[i].label + (i === col ? (dir === 'asc' ? ' ▲' : ' ▼') : '');
  });
}

// ---- tab count badges (small <span class="tabcount"> inside maintabs buttons) ----
function setTabCount(tab, n, tint) {
  const btn = document.querySelector('.maintabs button[data-tab="' + tab + '"]');
  if (!btn) return;
  let span = btn.querySelector('.tabcount');
  if (!n) { if (span) span.remove(); return; }
  if (!span) {
    span = document.createElement('span');
    span.className = 'tabcount';
    btn.appendChild(span);
  }
  span.textContent = n;
  span.classList.toggle('bad', !!tint);
}

function dotColor(r) {
  const m = { normal:'#9aa4b5', uncommon:'#4fc36a', rare:'#4f9cf5',
    unique:'#a06cf0', epic:'#e0863c', legendary:'#e0b23c' };
  return m[r] || '#888';
}
function actLabel(a) {
  const m = { default: 'Default', exploring: 'Exploring', crafting: 'Crafting',
    galaxyboss: 'Galaxy Boss', dungeons: 'Dungeons', voyager: 'Voyager' };
  return m[a] || a;
}

const SHIP_SLOT_LABELS = {
  weapon_slot: 'Weapon', shield_slot: 'Shield', engine_slot: 'Engine',
  sensors_slot: 'Sensors', laser_slot: 'Laser', probes_slot: 'Probes'
};
function shipSlotLabel(slot) { return SHIP_SLOT_LABELS[slot] || slot; }

// Item advisor: sortable table + recommendations list + cooldown/scan cards.
// d.shipItems: { items: [...], cooldown: {...}, scan: {...} } (lib/ship-items.js).
function renderShipItemAdvisor(si) {
  if (!si) return '<div class="empty-note">No ship item data.</div>';
  let html = '';
  const cols = [
    { label: 'Slot', numeric: false, getValue: it => it.slot,
      render: it => '<b>' + esc(shipSlotLabel(it.slot)) + '</b>' },
    { label: 'Item', numeric: false, getValue: it => it.name,
      render: it => esc(it.name) + ' <span style="color:' + dotColor(it.rarity) + '">(' + esc(it.rarity) + ')</span>' +
        (it.enhanced ? ' <span class="badge b-ok">enhanced</span>' : '') +
        (it.anomaly ? ' <span class="badge b-warn">anomaly</span>' : '') },
    { label: 'Lvl', numeric: true, getValue: it => it.level, render: it => it.level },
    { label: 'Skill lvl', numeric: true, getValue: it => it.skillLevel,
      render: it => esc(it.matchingSkill) + ' ' + it.skillLevel },
    { label: 'Behind', numeric: true, getValue: it => it.levelsBehind,
      render: it => it.levelsBehind > 0
        ? ('<b style="color:' + (it.levelsBehind >= 5 ? 'var(--bad)' : 'var(--warn)') + '">' + it.levelsBehind + '</b>')
        : '0' },
    { label: 'Value', numeric: true, getValue: it => it.value, render: it => it.value + ' / ' + it.valueMaxForLevel },
    { label: '% of max', numeric: true, getValue: it => it.valuePctOfMax, render: it => it.valuePctOfMax + '%' },
    { label: 'Mods', numeric: false, getValue: it => it.bonuses.join(','),
      render: it => it.bonuses.map(b => esc(b)).join(', ') || '<span style="color:var(--dim)">none</span>' },
  ];
  html += tableHtml('tbl-ship-items', si.items, cols);

  html += '<h3 style="font-size:14px;color:var(--accent);margin:14px 0 8px">Recommendations</h3><div class="list">';
  let any = false;
  for (const it of si.items) {
    for (const r of it.recommendations) {
      any = true;
      html += '<div class="row"><b>' + esc(shipSlotLabel(it.slot)) + '</b><span>' + esc(r) + '</span></div>';
    }
  }
  if (!any) html += '<div class="empty-note">No item recommendations.</div>';
  html += '</div>';

  const c = si.cooldown;
  html += '<h3 style="font-size:14px;color:var(--accent);margin:14px 0 8px">Engine cooldown</h3><div class="cards">';
  html += card('Total reduction', c.d + '%' + (c.componentBreakdown.globalBoost ? ' <span style="font-size:11px;color:var(--dim)">(' + c.dBase + '% w/o boost)</span>' : ''));
  html += card('Engine value', (c.componentBreakdown.engineValue / 100).toFixed(2) + '% <span style="font-size:11px;color:var(--dim)">(value ' + c.componentBreakdown.engineValue + ')</span>');
  html += card('Cooldown mods', '+' + c.componentBreakdown.mods + '%');
  html += card('Korin (equipped)', '+' + c.componentBreakdown.korin + '%');
  if (c.componentBreakdown.globalBoost) {
    html += card('Global boost', '+' + c.componentBreakdown.globalBoost + '% <span style="font-size:11px;color:var(--dim)">tier ' + c.componentBreakdown.globalBoostTier + ', ~' + c.componentBreakdown.globalBoostHoursLeft + 'h left</span>');
  }
  html += card('@10 ly', c.at10ly.seconds + 's' + (c.at10ly.floored ? ' <span class="badge b-warn">floor</span>' : '') +
    (c.componentBreakdown.globalBoost ? ' <span style="font-size:11px;color:var(--dim)">(' + c.at10lyNoBoost.seconds + 's w/o boost)</span>' : ''));
  html += card('@50 ly', c.at50ly.seconds + 's' + (c.at50ly.floored ? ' <span class="badge b-warn">floor</span>' : ''));
  html += card('@100 ly', c.at100ly.seconds + 's' + (c.at100ly.floored ? ' <span class="badge b-warn">floor</span>' : ''));
  html += '</div>';
  html += '<div class="sub">Cooldown = 10 min &times; (1 + ly/100) &times; (1 &minus; total reduction%), hard floor 5 min. Floor breakpoint @10 ly: reduction &ge; ' + c.breakpointD10ly + '%' +
    (c.flooredNowAt10ly ? ' &mdash; currently floored up to ~' + c.flooredUpToLy + ' ly' : '') + ' &mdash; ' +
    (c.withCooldownModAt10ly
      ? (c.flooredNowAt10ly
        ? 'the global boost pins the floor for now; a cooldown mod only pays off once the boost lapses'
        : 'a +10 cooldown mod would still help at 10 ly')
      : 'cooldown is floored at 10 ly even without the boost; cooldown mods are wasted there, prefer scan reward') +
    '</div>';

  const s = si.scan;
  html += '<h3 style="font-size:14px;color:var(--accent);margin:14px 0 8px">Scan reward</h3><div class="cards">';
  html += card('Multiplier', '&times;' + s.multiplier.toFixed(4));
  html += card('Sensors component', '+' + (s.sensorsComponent * 100).toFixed(2) + '%');
  html += card('Mod component', '+' + (s.modComponent * 100).toFixed(2) + '%');
  html += '</div>';

  return html;
}

function renderGear(gear) {
  let html = '<div class="sub">A non-empty activity group replaces the default group for that activity; empty groups inherit (voyager &larr; exploring &larr; default).</div>';
  html += '<div class="grid">';
  for (const it of gear) {
    if (it.empty) {
      html += '<div class="item"><h3>' + esc(it.slot) + '</h3><div class="meta">(no item equipped)</div></div>';
      continue;
    }
    html += '<div class="item"><h3>' + esc(it.name) + '</h3>';
    html += '<div class="meta">' + esc(it.slot) + ' &middot; ' + esc(it.category) + ' &middot; lvl ' + it.level + ' ' + esc(it.rarity) + '</div>';
    for (const g of it.groups) {
      const full = g.filled >= g.slots;
      const style = g.inherited ? ' style="opacity:0.55"' : '';
      html += '<div class="group"' + style + '><div class="group-head"><span>' + esc(actLabel(g.activity)) + '</span>';
      if (g.inherited) {
        html += '<span class="badge b-empty">inherits ' + esc(actLabel(g.inheritedFrom)) + '</span></div>';
      } else {
        const cls = g.filled === 0 ? 'b-empty' : (full ? 'b-ok' : 'b-warn');
        html += '<span class="badge ' + cls + '">' + g.filled + '/' + g.slots + '</span></div>';
        for (const c of g.catalysts) {
          html += '<div class="cat"><span class="dot" style="background:' + dotColor(c.rarity) + '"></span>';
          html += '<span class="rar" style="color:' + dotColor(c.rarity) + '">' + esc(c.stat) + '</span>';
          html += '<span>' + c.range + '%</span>';
          if (c.halved) html += '<span style="color:var(--dim)">(halved)</span>';
          if (c.sameCount > 1) html += '<span style="color:var(--dim)">x' + c.sameCount + '</span>';
          html += '<span class="info">' + esc(c.effText) + ' eff</span></div>';
        }
      }
      if (g.poolCount > 0 && !full) html += '<div class="info" style="color:var(--dim);font-size:11px">' + g.poolCount + ' matching in inventory</div>';
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
    html += '<div class="plan-group"><h3>' + esc(actLabel(act)) + ' tab</h3><div class="list">';
    if (byAct[act] && byAct[act].length) {
      byAct[act].forEach(a => {
        const key = installKey(variant, a);
        const isDone = doneSet.has(key);
        const isNew = !!prevKeys && !prevKeys.has(key);
        html += '<div class="row' + (isDone ? ' done' : '') + (isNew ? ' new-row' : '') + '">';
        html += '<input type="checkbox" class="donecheck" ' + (isDone ? 'checked' : '') +
          ' onchange="toggleDone(' + jsStr(key) + ', this.checked)">';
        html += '<span class="num">' + a.n + '.</span>';
        html += '<b>' + esc(a.item) + '</b> ';
        if (a.action === 'install') {
          html += 'INSTALL ';
        } else {
          html += 'REPLACE <span style="color:var(--dim)">' + esc(a.remove.text) + '</span> WITH ';
        }
        html += '<span style="color:' + dotColor(a.add.rarity) + ';font-weight:600">' + esc(a.add.text) + '</span>';
        if (isNew) html += '<span class="new-badge">new</span>';
        if (a.capInfo) {
          const ci = a.capInfo;
          const tone = capTone(ci.after, ci.cap);
          html += '<span class="captag" title="' + esc(a.add.stat.replaceAll('_', ' ')) + ' total in this tab before &rarr; after / cap">' +
            '<span class="dimtext">' + esc(ci.beforeText) + ' &rarr; </span>' +
            '<b style="color:' + tone.color + '">' + esc(ci.afterText) + '</b>' +
            '<span class="dimtext"> / ' + esc(ci.capText) + '</span>' +
            (ci.over ? '<span class="wasted">over cap</span>' : '') + '</span>';
        }
        if (a.npcDeltas) {
          const parts = Object.keys(a.npcDeltas).map(npc => {
            const d = a.npcDeltas[npc];
            const col = d > 0 ? 'var(--good)' : (d < 0 ? 'var(--bad)' : 'var(--dim)');
            return '<span style="color:' + col + '">' + esc(npc) + ' ' + (d >= 0 ? '+' : '') + d + '</span>';
          });
          html += '<span class="battle" style="font-size:11px">' + parts.join(' &middot; ') + '</span>';
        }
        html += '<span class="gain">+' + esc(a.gainText) + '</span></div>';
      });
    } else {
      html += '<div class="empty-note">No changes needed &mdash; already optimal with current inventory.</div>';
    }
    html += '</div></div>';
  }
  if (freed && freed.length) {
    html += '<div class="sub">Freed back to inventory: ' + esc(freed.join(', ')) + '</div>';
  }
  return html;
}

// One card per NPC: current battle-benchmark level -> projected level if
// every action in the Full-explore plan above were applied, plus an avg card.
function renderProjection(proj, battleBase) {
  let html = '<h3 style="font-size:14px;color:var(--accent);margin:0 0 8px">Projected after full plan</h3>';
  html += '<div class="cards">';
  for (const npc of Object.keys(proj.npcLevels)) {
    const base = battleBase ? battleBase[npc] : null;
    const lvl = proj.npcLevels[npc];
    const d = proj.deltas[npc];
    const col = d > 0 ? 'var(--good)' : (d < 0 ? 'var(--bad)' : 'var(--dim)');
    html += '<div class="card"><div class="k">' + esc(npc) + '</div><div class="v">' +
      (base !== null && base !== undefined ? base : '?') + ' &rarr; ' + lvl +
      ' <span style="font-size:12px;color:' + col + '">(' + (d >= 0 ? '+' : '') + d + ')</span></div></div>';
  }
  const avgCol = proj.avgDelta > 0 ? 'var(--good)' : (proj.avgDelta < 0 ? 'var(--bad)' : 'var(--dim)');
  html += '<div class="card"><div class="k">Avg delta</div><div class="v" style="color:' + avgCol + '">' +
    (proj.avgDelta >= 0 ? '+' : '') + proj.avgDelta + '</div></div>';
  html += '</div>';
  html += '<div class="sub">projection assumes every Full-explore action is applied</div>';
  return html;
}

// d.overrideLosses entries: { item, slot, activity, currentText, inheritedText, lostText }.
// A non-empty specialized group REPLACES (not adds to) whatever the item
// would otherwise inherit in that context - these are cases where the
// specialized group is worth less than what it overrides, so the player
// would be better off emptying it instead.
function renderOverrideLosses(list) {
  if (!list || !list.length) return '';
  let html = '<h2>Activity overrides losing value</h2><div class="list warnlist">';
  for (const o of list) {
    html += '<div class="row"><b>' + esc(o.item) + '</b> &mdash; ' + esc(actLabel(o.activity)) +
      ' group (' + esc(o.currentText) + ') replaces its inherited ' + esc(o.inheritedText) +
      ' &mdash; <span style="color:var(--bad)">losing ' + esc(o.lostText) + '</span>' +
      '</div>';
  }
  return html + '</div>';
}

// Per-activity stat panel (like the game's player-page bonus display):
// what is active during each activity, with the cap where one exists.
// d.contextTotals: { ctx: [{ stat, category, total, totalText, cap, capText, relevant }] }
function renderContextTotals(ct) {
  if (!ct) return '';
  const order = ['default', 'exploring', 'crafting', 'galaxyboss', 'dungeons', 'voyager'];
  const catOrder = ['battling', 'boost', 'utility'];
  let html = '<div class="ctxgrid">';
  for (const ctx of order) {
    // Only what actually does something during this activity; inherited
    // stats with no effect here are noise.
    const rows = ct[ctx] && ct[ctx].filter(r => r.relevant);
    if (!rows) continue;
    html += '<div class="item"><h3 style="text-transform:capitalize">' + esc(actLabel(ctx)) + '</h3>';
    if (!rows.length) {
      html += '<div class="empty-note">no bonuses active</div></div>';
      continue;
    }
    const byCat = {};
    for (const r of rows) (byCat[r.category || 'other'] = byCat[r.category || 'other'] || []).push(r);
    const cats = catOrder.filter(c => byCat[c]).concat(Object.keys(byCat).filter(c => !catOrder.includes(c)));
    for (const cat of cats) {
      html += '<div class="group-head" style="margin-top:6px"><span>' + esc(cat) + '</span></div>';
      for (const r of byCat[cat]) {
        const zero = r.total <= 0.0001;
        html += '<div class="ctxstat' + (zero ? ' zero' : '') + '">';
        html += '<div class="ctxstat-line"><span>' + esc(r.stat.replaceAll('_', ' ')) + '</span>';
        if (r.cap === null) {
          html += '<span class="info"><b>' + esc(r.totalText) + '</b></span></div>';
        } else {
          const tone = capTone(r.total, r.cap);
          html += '<span class="info"><b style="color:' + tone.color + '">' + esc(r.totalText) + '</b>' +
            '<span class="dimtext"> / ' + esc(r.capText) + '</span>' +
            (r.wastedText ? '<span class="wasted">wasted ' + esc(r.wastedText) + '</span>' : '') + '</span></div>';
          html += '<span class="minibar"><span class="minibar-fill" style="width:' + tone.width + '%;background:' + tone.color + '"></span></span>';
        }
        html += '</div>';
      }
    }
    html += '</div>';
  }
  return html + '</div>';
}

// Colour + fill width for a capped stat: green under 80%, amber near the
// cap, red over it. Shared by the activity cards and the install rows.
function capTone(total, cap) {
  const ratio = cap > 0 ? total / cap * 100 : 0;
  const color = ratio > 100.01 ? 'var(--bad)' : (ratio >= 80 ? 'var(--warn)' : 'var(--good)');
  return { color, width: Math.min(100, ratio) };
}

// Stable identity for one merge group, used for the "done" checkmark and
// the new-since-last-analyze highlight.
function mergeKey(plan, step, group) {
  return 'm|' + plan.stat + '|' + plan.activity + '|' + step.from + '|' + group.ids.join(',');
}

function renderMerges(plans, player, reqs, doneSet, prevKeys) {
  if (!plans.length) return '<div class="empty-note">No merges possible (need 5 of the same stat + rarity + activity).</div>';
  let html = '<div class="sub">Crafting lvl ' + player.craftLevel + ' &rarr; merge bonus +' + player.rangeBonus +
    ' &middot; success = base + ' + player.successBonus.toFixed(1) + '%</div>';
  if (reqs && reqs.length) {
    html += '<div class="sub">Tier requirements (perfect-legendary path): ' +
      reqs.map(m => '<b>' + esc(m.rarity) + '</b> result &ge; ' + m.resultNeeded).join(' &middot; ') + '</div>';
  }
  for (const p of plans) {
    html += '<div class="merge-plan"><h3>' + esc(p.stat) + ' <span style="color:var(--dim)">(' + esc(actLabel(p.activity)) + ')</span>' +
      (p.chainGoal ? ' &mdash; goal: <span style="color:var(--warn)">&rarr; ' + esc(p.chainGoal) + '</span>' : '') + '</h3>';
    for (const step of p.steps) {
      const sameTier = step.from === step.to ? ' (range perfection)' : '';
      html += '<div class="step"><div class="head"><b>' + esc(step.from) + ' &rarr; ' + esc(step.to) + sameTier + '</b>' +
        ' &middot; ' + step.chance + '% success &middot; ' + step.qcPerMerge + ' quantum cores/merge' +
        ' (+' + step.qcProtectPerMerge + ' protect)' +
        (step.recommendProtect ? ' &middot; <span class="protect">PROTECT recommended</span>' : '') + '</div>';
      for (const g of step.groups) {
        const perfect = step.to === 'legendary' && g.result >= 100;
        const key = mergeKey(p, step, g);
        const isDone = doneSet.has(key);
        const isNew = !!prevKeys && !prevKeys.has(key);
        html += '<span class="merge-item' + (isDone ? ' done' : '') + (isNew ? ' new-row' : '') + '">';
        html += '<input type="checkbox" class="donecheck" ' + (isDone ? 'checked' : '') +
          ' onchange="toggleDone(' + jsStr(key) + ', this.checked)">';
        html += '<span class="merge">[' + g.inputs.join(', ') + '] <span class="arrow">&rarr;</span> ' +
          '<span class="res' + (perfect ? ' perfect' : '') + '">' + step.to + ' ' + g.result + (perfect ? ' PERFECT' : '') + '</span>';
        if (g.pulled && g.pulled.length) {
          for (const pu of g.pulled) {
            html += ' <span style="color:var(--warn)">TAKE ' + esc(pu.text) + ' OUT OF ' + esc(pu.item) +
              ' (' + esc(pu.activity) + ' tab) first &mdash; reinstall result there (' + esc(pu.reinstallText) + ' eff)</span>';
          }
        }
        html += '</span>';
        if (isNew) html += '<span class="new-badge">new</span>';
        html += '</span>';
      }
      html += '</div>';
    }
    if (p.projectedLegendaries.length) {
      html += '<div class="proj">projected legendaries: ' + esc(p.projectedLegendaries.join(', ')) +
        ' (' + p.perfectCount + ' perfect)</div>';
    }
    html += '</div>';
  }
  return html;
}

// Walk lastData / prevData with the same key functions used above, so the
// installs/merges tabs can flag rows that did not exist in the prior fetch.
function computeInstallKeySet(data, variant) {
  if (!data) return null;
  const list = variant === 'full' ? data.installs : data.installsResources;
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

function fmtC(n) {
  if (n === null || n === undefined) return '?';
  // Upgrade costs on the units tab run into the trillions; without a T step
  // they read as a four-digit pile of "B".
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}
// Exact integer, comma-grouped (no k/M/B abbreviation) for material counts
// where the reader needs to compare against an in-game exact quantity.
function fmtN(n) { return Math.round(Number(n) || 0).toLocaleString('en-US'); }
const SKILL_LABELS = {
  efficiency: 'Efficiency', storage: 'Storage', maneuverability: 'Maneuverability',
  critical_chance: 'Critical chance', critical_damage: 'Critical damage', dual_shot: 'Dual shot'
};

function renderUnits(u) {
  let html = '';
  html += '<h2>Droids &amp; clones</h2>';
  html += '<div class="sub">Upgrade cost: 5000 &times; level &times; e^(0.15&times;level) credits per +0.1% step, per unit, per skill. New units start at 0%. Unit purchase price: 10&times; per unit, 8th = 100B (10^(n+3) credits).</div>';
  html += '<div class="cards">';
  html += card('Credits', fmtC(u.credits));
  const priceNote = g => ' <span style="font-size:11px;color:var(--dim)">next: ' + fmtC(g.nextPrice) +
    (g.priceSource === 'extrapolated' ? ' <span title="10x per unit, 8th = 100B; the game confirms it when the trainer page is opened">(curve)</span>' : '') + '</span>';
  html += card('Droids', u.droids.count + priceNote(u.droids));
  html += card('Clones', u.clones.count + priceNote(u.clones));
  html += '</div>';

  // --- droid survival ---
  const sv = u.droids.survival;
  if (sv && sv.count) {
    const bd = sv.perDroid[0].breakdown;
    const uneven = sv.perDroid.some(d => d.dodge !== sv.perDroid[0].dodge);
    const tone = capTone(sv.avgDodge, 100);
    html += '<h2>Droid survival</h2>';
    html += '<div class="sub">dodge = 50% base + maneuverability &divide; 2 + &quot;Droids dodge chance&quot; mods on laser/probes (additive, all droids), capped at 100%. A destroyed droid brings nothing back that action.</div>';
    html += '<div class="cards">';
    html += card('Dodge chance' + (uneven ? ' (avg)' : ''), '<span style="color:' + tone.color + '">' + sv.avgDodge.toFixed(1) + '%</span>' +
      '<span style="font-size:11px;color:var(--dim)"> = ' + bd.base + ' + ' + bd.maneuverability.toFixed(1) + ' + ' + bd.mods + '</span>');
    html += card('Expected alive / action', sv.expectedAlive.toFixed(2) + ' / ' + sv.count);
    if (sv.lastAction) {
      const la = sv.lastAction;
      const col = la.alive < la.total ? 'var(--warn)' : 'var(--good)';
      html += card('Last action', '<span style="color:' + col + '">' + la.alive + ' / ' + la.total + '</span> alive');
    }
    html += card('Target maneuverability', sv.noModsCap + '%' +
      '<span style="font-size:11px;color:var(--dim)"> = 100% dodge with no mods' + (sv.cappedCount ? ' &middot; ' + sv.cappedCount + ' droid(s) already at 100% dodge' : '') + '</span>');
    html += '</div>';
    // Road to the no-mods end state: dodge mods on laser/probes go one at a
    // time, each freed slot becomes a single rare-drop mod (+10 vs +5).
    if (sv.modPlan && sv.modPlan.length) {
      const slotName = { laser_slot: 'Laser', probes_slot: 'Probes' };
      html += '<div class="list">';
      sv.modPlan.forEach((p, i) => {
        const done = p.removableNow;
        html += '<div class="row"><span class="num">' + (i + 1) + '</span><span>' +
          (done ? '<b style="color:var(--good)">Now:</b> ' : '<b>At ' + p.removableAt + '% maneuverability</b> (weakest droid): ') +
          '<b>' + (slotName[p.slot] || p.slot) + '</b> no longer needs its +' + p.value + ' &quot;Droids dodge chance&quot; mod &mdash; recraft it with a single &quot;Rare Resource drop chance&quot; mod' +
          (p.value < 10 ? ' (+10 rare instead of +5)' : '') + '. Dodge stays 100% with the remaining mods.</span></div>';
      });
      html += '<div class="row"><span class="num">' + (sv.modPlan.length + 1) + '</span><span>With current mods dodge already hits 100% at <b>' + sv.maneuverabilityCap + '%</b> maneuverability; the steps above are what turns the spare dodge into rare-resource drops.</span></div>';
      html += '</div>';
    }
  }

  // --- recommendation ---
  html += '<h2>Recommendation</h2><div class="list">';
  const cd = u.clones.damage;
  if (u.clones.nextPrice !== null && cd.perPctUpgradeCost && cd.perPctBuyCost) {
    const ratio = cd.perPctBuyCost / cd.perPctUpgradeCost;
    html += '<div class="row"><span class="num">1</span><span><b>Clones:</b> skill upgrades currently give damage at <b>' + fmtC(cd.perPctUpgradeCost) + '</b> per +1%, buying the ' + (u.clones.count + 1) + 'th clone (incl. catch-up) at <b>' + fmtC(cd.perPctBuyCost) + '</b> per +1% &mdash; upgrades are <b style="color:var(--good)">' + ratio.toFixed(1) + 'x more efficient</b>. Raise <b>dual shot</b> first (highest damage per credit), then critical chance, then critical damage.</span></div>';
    if (u.clones.damageBreakEvenLevel !== null) {
      html += '<div class="row"><span class="num">2</span><span><b>Clone break-even: ' + u.clones.damageBreakEvenLevel + '%</b> &mdash; above this level an extra clone would give more damage per credit. You are at ' + u.clones.rows[0].level + '%, so <b>keep upgrading</b>' + (u.clones.nextPrice > u.credits ? ' (the ' + (u.clones.count + 1) + 'th clone costs ' + fmtC(u.clones.nextPrice) + ' anyway)' : '') + '.</span></div>';
    }
  }
  if (u.droids.nextPrice !== null && u.droids.breakEvenLevel !== null) {
    html += '<div class="row"><span class="num">3</span><span><b>Droids:</b> upgrade until <b>' + u.droids.breakEvenLevel + '%</b> (you are at ' + u.droids.rows[0].level + '%) before the ' + (u.droids.count + 1) + 'th droid (' + fmtC(u.droids.nextPrice) + ' + ' + fmtC(u.droids.catchUpCost) + ' catch-up) becomes better value per skill point.</span></div>';
  }
  if (u.droids.bestSkill && u.droids.rows.length) {
    const rows = u.droids.rows.filter(r => r.creditsPerPctYield !== null).sort((a, b) => a.creditsPerPctYield - b.creditsPerPctYield);
    const capped = u.droids.rows.filter(r => r.creditsPerPctYield === null);
    html += '<div class="row"><span class="num">4</span><span><b>Droid skill order:</b> ' +
      rows.map((r, i) => (i === 0 ? '<b>' : '') + esc(SKILL_LABELS[r.skill] || r.skill) + (i === 0 ? '</b>' : '') + ' (' + fmtC(r.creditsPerPctYield) + ' per +1% yield)').join(', then ') +
      (capped.length ? '. <span style="color:var(--dim)">' + capped.map(r => esc(SKILL_LABELS[r.skill] || r.skill)).join(', ') + ': no value while the dodge mods stay on &mdash; drop a mod first (see schedule above), then maneuverability pays again up to ' + (u.droids.survival ? u.droids.survival.noModsCap : 100) + '%.</span>' : '.') +
      ' Maneuverability lifts both common and rare yield through survival; efficiency/storage lift common yield only.</span></div>';
  }
  html += '</div>';

  // --- clone damage impact ---
  html += '<h2>Clone damage impact</h2><div class="cards">';
  html += card('Total multiplier', cd.totalMultiplier.toFixed(3));
  html += card('+1% all skills', '+' + cd.plusOnePctAll + '% dmg');
  html += card('+' + (u.clones.count + 1) + 'th clone @ 0%', '+' + cd.eighthAtZero + '% dmg');
  html += card('+' + (u.clones.count + 1) + 'th clone @ parity', '+' + cd.eighthAtParity + '% dmg');
  html += '</div>';

  // --- tables (real <table>s, click a header to sort) ---
  const unitSkillColumns = (withDamage, withYield) => {
    const cols = [
      { label: 'Skill', numeric: false, getValue: r => SKILL_LABELS[r.skill] || r.skill,
        render: r => '<b>' + esc(SKILL_LABELS[r.skill] || r.skill) + '</b>' + (r.uneven ? ' <span style="color:var(--warn)">(units differ)</span>' : '') },
      { label: 'Level', numeric: true, getValue: r => r.level, render: r => r.level + '%' },
      { label: '+0.1% all', numeric: true, getValue: r => r.costStepAll, render: r => fmtC(r.costStepAll) },
      { label: '+1% all', numeric: true, getValue: r => r.costPlusOneAll, render: r => fmtC(r.costPlusOneAll) },
      { label: 'Affordable', numeric: true, getValue: r => r.affordableStepsAll, render: r => '+' + (r.affordableStepsAll / 10).toFixed(1) + '%' },
    ];
    if (withDamage) {
      cols.push({ label: '+dmg/0.1%', numeric: true, getValue: r => r.marginalDamage || 0,
        render: r => r.marginalDamage !== null ? '+' + r.marginalDamage : '-' });
    }
    if (withYield) {
      cols.push({ label: '+yield/0.1%', numeric: true, getValue: r => r.marginalYield || 0,
        render: r => r.marginalYield ? '+' + r.marginalYield.toFixed(4) + '%' : '<span style="color:var(--dim)">capped</span>' });
      cols.push({ label: 'credits / +1% yield', numeric: true, getValue: r => r.creditsPerPctYield === null ? Infinity : r.creditsPerPctYield,
        render: r => r.creditsPerPctYield === null ? '-' : fmtC(r.creditsPerPctYield) });
    }
    return cols;
  };
  html += '<h2>Clone skills (' + u.clones.count + ')</h2><div class="sub">per-skill upgrade costs across all clones (apply-to-all)</div>';
  html += tableHtml('tbl-clone-skills', u.clones.rows, unitSkillColumns(true, false));
  html += unitEmuSection('clones');
  html += '<h2>Droid skills (' + u.droids.count + ')</h2><div class="sub">per-skill upgrade costs across all droids (apply-to-all)</div>';
  html += tableHtml('tbl-droid-skills', u.droids.rows, unitSkillColumns(false, true));
  html += unitEmuSection('droids');

  // --- unit lists ---
  const list = (title, units, skills) => {
    let t = '<h2>' + title + '</h2><div class="list">';
    for (const un of units) {
      t += '<div class="row"><span style="min-width:110px"><b>' + esc(un.name) + '</b></span>';
      for (const s of skills) t += '<span>' + esc(SKILL_LABELS[s] || s) + ' <b>' + un[s] + '%</b></span>';
      t += '</div>';
    }
    return t + '</div>';
  };
  html += list('Your clones', u.clones.list, ['critical_chance', 'critical_damage', 'dual_shot']);
  html += list('Your droids', u.droids.list, ['efficiency', 'storage', 'maneuverability']);
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
const UNIT_GROUP_LABEL = { droids: 'Droid', clones: 'Clone' };
const UNIT_EMU_KEY = 'advisor-unit-targets';

function unitEmuStore() {
  try {
    const v = JSON.parse(localStorage.getItem(UNIT_EMU_KEY) || 'null');
    if (v && typeof v === 'object') return v;
  } catch (e) {}
  return {};
}
function unitEmuSave(store) {
  try { localStorage.setItem(UNIT_EMU_KEY, JSON.stringify(store)); } catch (e) {}
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
  if (!UM || !units.length) return '<div class="empty-note">No ' + kind + ' in the last analysis.</div>';
  const skills = UNIT_GROUP_SKILLS[kind];
  const credits = u.credits || 0;
  const targets = {};
  skills.forEach(s => { targets[s] = unitEmuTarget(kind, s, units); });
  const emu = UM.emulateGroup(units, skills, targets, credits);
  const label = UNIT_GROUP_LABEL[kind] || kind;

  // --- headline: what the whole plan costs against the credit pile ---
  let html = '<div class="cards">';
  html += card('All ' + units.length + ' ' + kind + ', all 3 skills',
    '<span title="' + fmtN(emu.total) + ' credits">' + fmtC(emu.total) + '</span>');
  html += card('Credits', fmtC(credits));
  html += card(emu.affordable ? 'Left over' : 'Short by',
    '<span style="color:' + (emu.affordable ? 'var(--good)' : 'var(--bad)') + '">' + fmtC(Math.abs(emu.leftover)) + '</span>' +
    (credits > 0 ? '<span style="font-size:11px;color:var(--dim)"> plan = ' + Math.round(emu.total / credits * 100) + '% of credits</span>' : ''));
  html += '</div>';

  // --- controls ---
  // The "all skills" box only shows a number when the three targets agree;
  // otherwise it would claim a target two of the skills do not have.
  const common = skills.every(s => targets[s] === targets[skills[0]]) ? String(targets[skills[0]]) : '';
  html += '<div class="row" style="gap:14px">' +
    '<span>Set every skill target to <input class="pet-input base-input" type="number" min="0" max="500" step="0.1" ' +
    'value="' + common + '" placeholder="mixed" onchange="setUnitEmuAll(' + jsStr(kind) + ', this.value)">%</span>' +
    '<span>' +
    '<button class="ghost" onclick="bumpUnitEmu(' + jsStr(kind) + ', 1)">+1</button> ' +
    '<button class="ghost" onclick="bumpUnitEmu(' + jsStr(kind) + ', 5)">+5</button> ' +
    '<button class="ghost" onclick="bumpUnitEmu(' + jsStr(kind) + ', -1)">&minus;1</button> ' +
    '<button class="ghost" onclick="resetUnitEmu(' + jsStr(kind) + ')">reset</button>' +
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
    { label: 'Skill', numeric: false, getValue: r => SKILL_LABELS[r.skill] || r.skill,
      render: r => '<b>' + esc(SKILL_LABELS[r.skill] || r.skill) + '</b>' },
    { label: 'Now', numeric: true, getValue: r => r.from,
      render: r => (r.from === r.fromMax ? r.from + '%' : r.from + '&ndash;' + r.fromMax + '%') },
    { label: 'Target', numeric: true, getValue: r => r.target,
      render: r => '<input class="pet-input base-input" type="number" min="0" max="500" step="0.1" value="' + r.target +
        '" onchange="setUnitEmuTarget(' + jsStr(kind) + ', ' + jsStr(r.skill) + ', this.value)">' +
        ' <button class="ghost" style="padding:2px 8px;font-size:11px" title="Highest target these credits cover if every credit went into this one skill"' +
        ' onclick="maxUnitEmu(' + jsStr(kind) + ', ' + jsStr(r.skill) + ')">max ' + r.maxTarget + '%</button>' },
    { label: 'Steps', numeric: true, getValue: r => r.steps,
      render: r => r.steps ? '+' + (r.steps / 10).toFixed(1) + '%' : '&mdash;' },
    { label: 'Cost, one unit', numeric: true, getValue: r => r.one,
      render: r => !r.paying ? '<span style="color:var(--dim)">at target</span>'
        : (r.one === r.oneMax ? '<span title="' + fmtN(r.one) + '">' + fmtC(r.one) + '</span>'
          : fmtC(r.one) + '&ndash;' + fmtC(r.oneMax)) },
    { label: 'Cost, all ' + units.length, numeric: true, getValue: r => r.total,
      render: r => r.total ? '<b title="' + fmtN(r.total) + '">' + fmtC(r.total) + '</b>' : '<span style="color:var(--dim)">&mdash;</span>' },
    { label: '% of credits', numeric: true, getValue: r => r.total,
      render: r => credits > 0 ? (r.total / credits * 100).toFixed(1) + '%' : '?' },
  ]);

  // --- per unit: what each individual one costs to reach those targets ---
  const unitCols = [
    { label: label, numeric: false, getValue: r => r.name, render: r => '<b>' + esc(r.name) + '</b>' },
  ].concat(skills.map(s => ({
    label: SKILL_LABELS[s] || s, numeric: true, getValue: r => r.costs[s],
    render: r => r.costs[s] ? '<span title="' + fmtN(r.costs[s]) + '">' + fmtC(r.costs[s]) + '</span>'
      : '<span style="color:var(--dim)">&mdash;</span>',
  }))).concat([
    { label: 'Unit total', numeric: true, getValue: r => r.total,
      render: r => r.total ? '<b title="' + fmtN(r.total) + '">' + fmtC(r.total) + '</b>' : '<span style="color:var(--dim)">&mdash;</span>' },
  ]);
  html += '<div class="sub" style="margin:14px 0 4px">Per unit &mdash; each one pays its own way up from where it stands, so a unit already at the target pays nothing.</div>';
  html += tableHtml('tbl-emu-units-' + kind, emu.perUnit, unitCols);

  // --- buying one more and catching it up to the same targets ---
  const price = u[kind].nextPrice;
  if (price !== null && price !== undefined) {
    const catchUp = skills.reduce((s, sk) => s + UM.cumulativeUnitCost(0, targets[sk]), 0);
    html += '<div class="list" style="margin-top:10px"><div class="row"><span>' +
      'An extra <b>' + (units.length + 1) + 'th ' + label.toLowerCase() + '</b> at these same targets: <b>' + fmtC(price) +
      '</b> purchase + <b>' + fmtC(catchUp) + '</b> to bring a 0% unit up = <b style="color:var(--warn)">' + fmtC(price + catchUp) + '</b>' +
      ' <span style="color:var(--dim)">(against ' + fmtC(emu.total) + ' to lift the ' + units.length + ' you already own)</span>' +
      '</span></div></div>';
  }
  return html;
}

function unitEmuSection(kind) {
  const label = UNIT_GROUP_LABEL[kind] || kind;
  return '<h2>' + label + ' cost emulator</h2>' +
    '<div class="sub">Set a target % per skill and see what it costs, per individual unit and for the whole group. ' +
    'Each +0.1% step costs 5000 &times; level &times; e^(0.15&times;level) credits, charged per unit and per skill, so the cost climbs steeply with level. Targets are remembered in this browser.</div>' +
    '<div id="emu-' + kind + '">' + unitEmuHtml(kind) + '</div>';
}

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
      rateEl.value = saved.rate;
      dailyEl.value = saved.daily;
    }
  } catch (e) {}
  const rate = parseFloat(rateEl.value) || 0;
  const daily = parseFloat(dailyEl.value) || 0;
  try { localStorage.setItem('advisor-qc-rate', JSON.stringify({ rate: rateEl.value, daily: dailyEl.value })); } catch (e) {}
  const gap = d.tech.maxOut.coresGap;
  const perDay = rate * 24 + daily;
  if (gap <= 0) { out.textContent = 'done'; return; }
  if (perDay <= 0) { out.textContent = 'never'; return; }
  const days = gap / perDay;
  out.textContent = days >= 2 ? Math.floor(days) + 'd ' + Math.round((days % 1) * 24) + 'h' : Math.round(days * 24) + 'h';
}

function renderTech(t) {
  let html = '';
  html += '<h2>Technology (skills)</h2>';
  html += '<div class="sub">Upgrades cost quantum cores: level L &rarr; L+1 costs 2&times;(L+1) cores (cumulative L&times;(L+1)). Cap 100. A full reset costs 50 stellar tokens (premium) &mdash; avoid.</div>';
  html += '<div class="cards">';
  html += card('Quantum cores', t.quantumCores.toLocaleString());
  if (t.battle) html += card('Avg max NPC level', t.battle.baselineAvg);
  if (t.maxOut) {
    html += card('QC to max all', fmtC(t.maxOut.coresToMaxAll) + ' <span style="font-size:11px;color:var(--dim)">' + t.maxOut.maxedCount + '/' + t.maxOut.unlockedCount + ' maxed</span>');
    html += card('Gap after stock', fmtC(t.maxOut.coresGap));
    html += '<div class="card"><div class="k">Time to cover gap</div><div class="v" id="qcGapTime">&mdash;</div>' +
      '<div style="font-size:11px;color:var(--dim);margin-top:4px">' +
      '<input type="number" id="qcRate" value="18" min="0" style="width:44px" onchange="calcQcGap()" oninput="calcQcGap()"> /h + ' +
      '<input type="number" id="qcDaily" value="150" min="0" style="width:52px" onchange="calcQcGap()" oninput="calcQcGap()"> /day</div></div>';
  }
  html += '</div>';

  if (t.battle && t.battle.rows.length) {
    html += '<h2>Combat skill ranking (battle-simulated)</h2>';
    html += '<div class="sub">+1 level of each skill, measured as the <b>winrate gain at a fixed probe level</b> &mdash; the level where your current build wins about half its fights, the most sensitive part of the curve. ' +
      'Both builds run the same seeded battles, so the comparison carries no simulation noise' +
      (t.battle.winratePointsPerLevel ? ', and the gain is converted to equivalent NPC levels at ' + t.battle.winratePointsPerLevel + ' winrate points per level' : '') + '. ' +
      'A skill reading 0 showed <b>no measurable gain</b> over ' + (t.battle.probeLevels ? Object.keys(t.battle.probeLevels).length : 8) + ' NPC types &mdash; it is not bought.</div>';
    const combatCols = [
      { label: 'Skill', numeric: false, getValue: r => r.key, render: r => '<b>' + esc(r.key.replaceAll('_', ' ')) + '</b>' },
      { label: 'Level', numeric: true, getValue: r => r.level, render: r => r.level },
      { label: 'Next QC', numeric: true, getValue: r => r.cost, render: r => r.cost + ' QC' },
      { label: '+winrate', numeric: true, getValue: r => r.winrateDelta || 0,
        render: r => r.winrateDelta > 0 ? '+' + r.winrateDelta.toFixed(3) + '%' : (r.winrateDelta < 0 ? r.winrateDelta.toFixed(3) + '%' : '<span style="color:var(--dim)">none</span>') },
      { label: 'Gain', numeric: true, getValue: r => r.avgDelta,
        render: r => r.avgDelta > 0 ? '<b style="color:var(--good)">+' + r.avgDelta + ' lvls</b>' : '<span style="color:var(--dim)">' + (r.avgDelta < 0 ? r.avgDelta + ' lvls' : 'no measurable gain') + '</span>' },
      { label: 'Lvls/core', numeric: true, getValue: r => r.levelsPerCore,
        render: r => r.levelsPerCore > 0 ? '<span class="gain">' + r.levelsPerCore + '</span>' : '<span style="color:var(--dim)">&mdash;</span>' },
    ];
    html += tableHtml('tbl-combat-ranking', t.battle.rows, combatCols);
  }

  html += '<h2>Optimal spend of ' + t.quantumCores + ' QC</h2>';
  if (t.allocation.length) {
    html += '<div class="list">';
    for (const a of t.allocation) {
      html += '<div class="row"><span><b>' + esc(a.key.replaceAll('_', ' ')) + '</b>: ' + a.from + ' &rarr; ' + a.to + '</span><span class="gain">' + a.cost + ' QC</span></div>';
    }
    html += '<div class="sub">leftover: ' + t.leftoverCores + ' QC</div></div>';
  } else if (t.battle && t.battle.rows.length) {
    const best = t.battle.rows[0];
    // Two different reasons for an empty plan: nothing helps, or nothing is
    // affordable. Saying "not enough cores" when the real answer is "no skill
    // measurably helps" would send the player off to farm cores for nothing.
    if (!(best.avgDelta > 0)) {
      html += '<div class="row"><span>No combat skill shows a measurable winrate gain at the probe level for your build, so none is worth cores right now. Spend them on merges instead, or re-check after your gear changes.</span></div>';
    } else {
      html += '<div class="row"><span>Not enough cores for any combat skill (best pick <b>' + esc(best.key.replaceAll('_', ' ')) + '</b> costs ' + best.cost + ' QC). Keep saving &mdash; cores come from battling drops and merges.</span></div>';
    }
  }

  html += '<h2>All skills</h2>';
  const skillCols = [
    { label: 'Skill', numeric: false, getValue: s => s.label, render: s => '<b>' + esc(s.label) + '</b>' },
    { label: 'Level', numeric: true, getValue: s => s.level, render: s => s.level + (s.maxed ? ' <span class="badge b-ok">MAX</span>' : '') },
    { label: 'Next cost', numeric: true, getValue: s => (s.locked || s.maxed) ? -1 : (s.costNext || 0),
      render: s => s.locked ? '-' : (s.maxed ? '-' : '<b>' + s.costNext + ' QC</b>') },
    { label: 'To max', numeric: true, getValue: s => s.coresToMax === null ? -1 : s.coresToMax,
      render: s => s.coresToMax === null ? '-' : (s.coresToMax === 0 ? '-' : fmtC(s.coresToMax) + ' QC') },
    { label: 'Status', numeric: false, getValue: s => s.locked ? 'locked' : (s.maxed ? 'max' : (s.affordable ? 'affordable' : '')),
      render: s => s.locked ? '<span class="badge b-empty">locked (Steam)</span>' :
        (s.maxed ? '<span class="badge b-ok">MAX</span>' : (s.affordable ? '<span class="badge b-ok">affordable</span>' : '')) },
    { label: 'Description', numeric: false, getValue: s => s.desc, render: s => '<span style="color:var(--dim);font-size:12px">' + esc(s.desc) + '</span>' },
  ];
  html += tableHtml('tbl-all-skills', t.skills, skillCols);
  return html;
}

function fmtH(h) {
  if (h === null || h === undefined) return '-';
  if (h === Infinity) return 'never';
  if (h < 48) return h + 'h';
  return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
}

function renderPets(p) {
  let html = '';
  html += '<h2>Pets</h2>';
  html += '<div class="sub">XP/h = ceil((5 + boost) &times; (1 + tech/100) &times; (1 + level/10) &times; (1 + premium/100) &times; food/100). Food drops 5%/h while equipped (floor 50%); auto-feed refills to 100% when the next drop would fall below the slot threshold. Unequipped pets: food frozen, no XP.</div>';
  html += '<div class="cards">';
  html += card('Pet XP tech', p.techSkill + (p.techSkill >= 100 ? ' <span class="badge b-ok">MAX</span>' : ''));
  html += card('Premium', p.premiumActive ? 'active <span style="font-size:11px;color:var(--dim)">+10% pet XP</span>' : 'inactive');
  html += card('Pet food stock', p.petFood.toLocaleString() + ' <span style="font-size:11px;color:var(--dim)">burn ' + p.petFoodPerDay + '/day = ' + (p.petFoodDays !== null ? p.petFoodDays + 'd' : '-') + '</span>');
  html += card('Equipped', p.pets.filter(function (x) { return x.equipped; }).length + ' / ' + p.pets.length);
  html += '</div>';

  if (p.korin) html += renderKorin(p.korin);

  html += '<h2>All pets</h2>';
  const petCols = [
    { label: 'Pet', numeric: false, getValue: pet => pet.name, render: pet => '<b>' + esc(pet.name) + '</b>' },
    { label: 'Slot', numeric: false, getValue: pet => pet.equipped ? pet.slotType : '~unequipped',
      render: pet => pet.equipped ? esc(pet.slotType) : '<span class="badge b-empty">unequipped</span>' },
    { label: 'Lvl', numeric: true, getValue: pet => pet.level, render: pet => pet.level },
    { label: 'XP', numeric: true, getValue: pet => pet.currentXp, render: pet => pet.currentXp + '/' + pet.targetXp },
    { label: 'Boost', numeric: true, getValue: pet => pet.boost, render: pet => pet.boost },
    { label: 'Food', numeric: true, getValue: pet => pet.food, render: pet => pet.food + '%' + (pet.equipped ? ' <span style="color:var(--dim)">(avg ' + pet.avgFood + '%)</span>' : '') },
    { label: 'XP/h', numeric: true, getValue: pet => pet.equipped ? pet.xpPerHourNow : -1,
      render: pet => pet.equipped ? '<b>' + pet.xpPerHourNow + '</b>' : '-' },
    { label: 'Next lvl', numeric: true, getValue: pet => pet.equipped ? (pet.hoursToLevel === Infinity ? 1e15 : pet.hoursToLevel) : 1e16,
      render: pet => pet.equipped ? '<b style="color:var(--good)">' + fmtH(pet.hoursToLevel) + '</b>' : '-' },
    { label: '+1 boost', numeric: true, getValue: pet => pet.equipped ? (pet.hoursSavedPlusOne || 0) : -1,
      render: pet => pet.equipped ? (fmtH(pet.hoursToLevelPlusOne) + ' (' + (pet.hoursSavedPlusOne !== null ? '-' + pet.hoursSavedPlusOne + 'h' : '-') + ')') : '-' },
    { label: 'Boost cost', numeric: true, getValue: pet => pet.costNextBoost,
      render: pet => fmtC(pet.costNextBoost) + ' &times;16' + (pet.affordableBoost ? ' <span class="badge b-ok">affordable</span>' : ' <span class="badge b-warn">short ' + fmtC(pet.costNextBoost - pet.minResource) + '</span>') },
  ];
  html += tableHtml('tbl-all-pets', p.pets, petCols);

  html += '<h2>Simulator</h2>';
  html += '<div class="sub">Pick a pet and drag the sliders to simulate raising its XP boost and the slot auto-feed threshold (sliders start at the current values of the pet). A boost upgrade costs the SAME amount of EVERY one of the 16 common resources (copper, gold, platinum, silver, carbon, nitrogen, sulfur, water, ammonia, helium, hydrogen, methane, diamond, emerald, ruby, sapphire).</div>';
  const eq = p.pets.filter(function (x) { return x.equipped; });
  html += '<div class="list">';
  html += '<div class="row"><span style="min-width:90px"><b>Pet</b></span><select id="petSelect" onchange="simPet()" class="pet-input">';
  for (const pet of eq) html += '<option value="' + esc(pet.id) + '">' + esc(pet.name) + ' (boost ' + pet.boost + ', food ' + pet.food + '%)</option>';
  html += '</select></div>';
  html += '<div class="row"><span style="min-width:90px"><b>Boost</b></span><input type="range" id="petBoost" min="0" max="45" value="0" oninput="simPet()" style="width:260px"> <span id="petBoostVal" style="min-width:110px;display:inline-block"></span></div>';
  html += '<div class="row"><span style="min-width:90px"><b>Auto-feed</b></span><input type="range" id="petFeed" min="50" max="100" step="5" value="50" oninput="simPet()" style="width:260px"> <span id="petFeedVal" style="min-width:110px;display:inline-block"></span></div>';
  html += '</div>';
  html += '<div id="petSimOut" class="list" style="margin-top:10px"></div>';
  return html;
}

// Korin (pet_type 'generator'): converts normal warp capsules into enhanced
// warp capsules. See lib/pets.js for the underlying formulas.
function renderKorin(k) {
  const dustLimited = k.dustCostPerCapsule > 0 ? Math.floor(k.dust / k.dustCostPerCapsule) : 0;
  const limitedBy = k.capsules <= dustLimited ? 'capsule stock' : 'dust';
  let html = '<h2>Korin &mdash; warp capsule enhancement</h2>';
  html += '<div class="cards">';
  html += card('Korin level', k.level);
  html += card('Cost/capsule', fmtC(k.dustCostPerCapsule) + ' <span style="font-size:11px;color:var(--dim)">dust</span>');
  html += card('Capsule stock', k.capsules.toLocaleString() +
    ' <span style="font-size:11px;color:var(--dim)">normal / ' + k.enhancedCapsules.toLocaleString() + ' enhanced</span>');
  html += card('Affordable now', k.affordableNow.toLocaleString() +
    ' <span style="font-size:11px;color:var(--dim)">(' + limitedBy + ' limited)</span>');
  html += card('Fuel per enhanced', (k.fuelPerEnhanced !== null ? k.fuelPerEnhanced.toLocaleString() : '?') +
    ' fuel <span style="font-size:11px;color:var(--dim)">(' + k.fuelMultiplier.toFixed(1) + 'x max)</span>');
  html += card('Engine cooldown', '&minus;' + k.cooldownReductionPct + '%');
  html += '</div>';
  html += '<div class="sub">next level: cost ' + fmtC(k.nextLevel.dustCostPerCapsule) + '/capsule, ' +
    k.nextLevel.fuelMultiplier.toFixed(1) + 'x fuel</div>';
  return html;
}

function simPet() {
  const d = window.lastData;
  if (!d || !d.pets) return;
  const p = d.pets;
  const sel = document.getElementById('petSelect');
  const boostEl = document.getElementById('petBoost');
  const feedEl = document.getElementById('petFeed');
  const out = document.getElementById('petSimOut');
  if (!sel || !out || !boostEl || !feedEl) return;
  const pet = p.pets.find(function (x) { return x.id === sel.value; });
  if (!pet) return;
  // When switching pets (or first render) sync the sliders to the current
  // boost / auto-feed threshold of that pet. The boost slider can never go
  // below the current boost - simulating a downgrade makes no sense.
  // Update the slider bounds BEFORE assigning the value: a range input
  // clamps assignments to its current min/max, so setting the value first
  // would clamp it to the PREVIOUS pet's range when switching pets.
  boostEl.min = pet.boost;
  boostEl.max = pet.boost + 15;
  if (window.petSimId !== sel.value) {
    window.petSimId = sel.value;
    boostEl.value = pet.boost;
    feedEl.value = pet.autofeedLimit;
  }
  if (parseInt(boostEl.value, 10) < pet.boost) boostEl.value = pet.boost;
  const boost = parseInt(boostEl.value, 10);
  const limit = parseInt(feedEl.value, 10);
  document.getElementById('petBoostVal').textContent = boost + (boost === pet.boost ? ' (current)' : ' (+' + (boost - pet.boost) + ')');
  document.getElementById('petFeedVal').textContent = limit + '%' + (limit === pet.autofeedLimit ? ' (current)' : '');

  if (!pet.equipped) {
    out.innerHTML = '<div class="row">' + esc(pet.name) + ' is not equipped - it earns no XP and its food is frozen.</div>';
    return;
  }
  const hours = PetMath.petHoursToNextLevel(pet.level, pet.currentXp, boost, pet.food, pet.autofeed, limit, p.techSkill, p.premiumActive);
  const hoursNow = pet.hoursToLevel;
  const saved = hoursNow !== null ? hoursNow - hours : null;

  // Boost cost: the SAME amount of EVERY common resource.
  const cost = boost > pet.boost ? PetMath.petXpBoostCostCumulative(pet.boost, boost) : 0;
  const entries = Object.entries(p.resources || {});
  const short = cost > 0 ? entries.filter(function (e) { return e[1] < cost; }) : [];

  // Pet food: every equipped pet auto-feeds from the same stock. The
  // selected pet uses the simulated threshold, the others their current one.
  const cycleH = function (l) { return (100 - l) / 5 + 1; };
  let perDay = 0, count = 0;
  for (const q of p.pets) {
    if (!q.equipped) continue;
    count++;
    perDay += 24 / cycleH(q.id === pet.id ? limit : q.autofeedLimit);
  }
  const days = perDay > 0 ? p.petFood / perDay : Infinity;

  let html = '';
  html += '<div class="row"><span><b>' + esc(pet.name) + '</b> lvl ' + pet.level + ' &rarr; ' + (pet.level + 1) + '</span>';
  html += '<span>XP/h right now (food ' + pet.food + '%): <b>' + PetMath.petXpPerHour(pet.level, boost, pet.food, p.techSkill, p.premiumActive) + '</b></span>';
  html += '<span>avg food over cycle: <b>' + ((100 + limit) / 2) + '%</b></span>';
  html += '<span>time to next level: <b style="color:var(--good)">' + fmtH(hours) + '</b>' + (saved !== null && saved !== 0 ? ' <span class="gain">' + (saved > 0 ? '-' + fmtH(saved) : '+' + fmtH(-saved)) + ' vs current</span>' : '') + '</span></div>';

  html += '<div class="row"><span>boost upgrade cost: <b>' + (cost > 0 ? fmtC(cost) + ' of EACH of the ' + entries.length + ' resources' : '-') + '</b>';
  if (cost > 0) {
    if (!short.length) html += ' <span class="badge b-ok">affordable - all ' + entries.length + ' resources have enough</span>';
    else html += ' <span class="badge b-warn">' + short.length + ' of ' + entries.length + ' resources short:</span> <span style="color:var(--dim)">' + short.map(function (e) { return e[0] + ' (' + fmtC(e[1]) + ' / need ' + fmtC(cost - e[1]) + ' more)'; }).join(', ') + '</span>';
  }
  html += '</div>';

  html += '<div class="row"><span>pet food: <b>' + count + ' equipped pets burn ' + perDay.toFixed(1) + '/day</b>' + (p.petFoodPerDay !== undefined && Math.abs(perDay - p.petFoodPerDay) > 0.05 ? ' <span style="color:var(--dim)">(currently ' + p.petFoodPerDay.toFixed(1) + '/day)</span>' : '') + '</span>';
  html += '<span style="color:var(--dim)">' + p.petFood.toLocaleString() + ' stocked = ' + (days === Infinity ? 'no consumption' : Math.floor(days) + ' days') + '</span></div>';
  out.innerHTML = html;
}

const INV_RARITIES = ['normal', 'uncommon', 'rare', 'unique', 'epic', 'legendary'];
const INV_ACTIVITIES = ['default', 'exploring', 'crafting', 'galaxyboss', 'dungeons', 'voyager'];

// Filter state lives on window so it survives re-renders (tab switches,
// refresh) the same way window.planVariant / window.activeTab do.
function setInvFilter(field, value) {
  window.invFilter = window.invFilter || { text: '', rarity: 'all', activity: 'all', sellOnly: false };
  window.invFilter[field] = value;
  if (window.lastData) render(window.lastData);
}

function invUseBadge(it) {
  if (it.locked) return '<span class="badge b-empty">locked</span>';
  if (it.onMarket) return '<span class="badge b-empty">market</span>';
  if (it.plannedUse === 'install') return '<span class="badge b-ok">install</span>';
  if (it.plannedUse === 'merge') return '<span class="badge b-warn">merge</span>';
  return '<span class="badge b-empty">-</span>';
}

function renderInventory(inv) {
  const f = window.invFilter = window.invFilter || { text: '', rarity: 'all', activity: 'all', sellOnly: false };
  let html = '<div class="cards">';
  html += card('Total', inv.counts.total);
  html += card('Planned installs', inv.counts.planned);
  html += card('Merge fodder', inv.counts.mergeFodder);
  html += card('Sell candidates', inv.counts.sellCandidates);
  html += '</div>';

  html += '<div class="toolbar" style="margin-bottom:10px">';
  html += '<input type="text" placeholder="filter stat..." value="' + esc(f.text) +
    '" onchange="setInvFilter(&quot;text&quot;, this.value)" style="padding:7px 10px;border-radius:8px;' +
    'border:1px solid var(--border);background:var(--panel2);color:var(--text);font-size:13px">';
  html += '<select class="pet-input" onchange="setInvFilter(&quot;rarity&quot;, this.value)">';
  html += '<option value="all"' + (f.rarity === 'all' ? ' selected' : '') + '>All rarities</option>';
  INV_RARITIES.forEach(r => {
    html += '<option value="' + r + '"' + (f.rarity === r ? ' selected' : '') + '>' + r + '</option>';
  });
  html += '</select>';
  html += '<select class="pet-input" onchange="setInvFilter(&quot;activity&quot;, this.value)">';
  html += '<option value="all"' + (f.activity === 'all' ? ' selected' : '') + '>All activities</option>';
  INV_ACTIVITIES.forEach(a => {
    html += '<option value="' + a + '"' + (f.activity === a ? ' selected' : '') + '>' + esc(actLabel(a)) + '</option>';
  });
  html += '</select>';
  html += '<label style="color:var(--dim);font-size:12px"><input type="checkbox" ' +
    (f.sellOnly ? 'checked' : '') + ' onchange="setInvFilter(&quot;sellOnly&quot;, this.checked)"> sell candidates only</label>';
  html += '</div>';

  let items = inv.items;
  if (f.text) {
    const q = f.text.toLowerCase();
    items = items.filter(it => it.stat.toLowerCase().includes(q));
  }
  if (f.rarity !== 'all') items = items.filter(it => it.rarity === f.rarity);
  if (f.activity !== 'all') items = items.filter(it => it.activity === f.activity);
  if (f.sellOnly) items = items.filter(it => it.sellCandidate);

  const cols = [
    { label: 'Stat', numeric: false, getValue: it => it.stat,
      render: it => '<b>' + esc(it.stat.replaceAll('_', ' ')) + '</b>' },
    { label: 'Rarity', numeric: false, getValue: it => it.rarity,
      render: it => '<span class="dot" style="background:' + dotColor(it.rarity) +
        ';display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px"></span>' +
        '<span style="color:' + dotColor(it.rarity) + '">' + esc(it.rarity) + '</span>' },
    { label: 'Range', numeric: true, getValue: it => it.range, render: it => it.range + '%' },
    { label: 'Activity', numeric: false, getValue: it => it.activity, render: it => esc(actLabel(it.activity)) },
    { label: 'Category', numeric: false, getValue: it => it.category, render: it => esc(it.category) },
    { label: 'Value', numeric: true, getValue: it => it.value, render: it => it.value.toFixed(2) },
    { label: 'Use', numeric: false, getValue: it => it.plannedUse || (it.locked ? 'locked' : (it.onMarket ? 'market' : '')),
      render: it => invUseBadge(it) },
    { label: 'Sell', numeric: false, getValue: it => it.sellCandidate ? 1 : 0,
      render: it => it.sellCandidate ? '<span class="badge b-warn" title="' + esc(it.sellReason) + '">sell</span>' : '' },
  ];
  html += tableHtml('tbl-inventory', items, cols);
  return html;
}

// ---- Materials tab: blueprint material requirements vs stock ----
function materialCols(showFarm) {
  const cols = [
    { label: 'Material', numeric: false, getValue: r => r.material, render: r => '<b>' + esc(r.material) + '</b>' },
    { label: 'Stock', numeric: true, getValue: r => r.stock, render: r => r.stock.toLocaleString() },
    { label: 'Need/craft', numeric: true, getValue: r => r.neededPerCraftAll, render: r => r.neededPerCraftAll.toLocaleString() },
    { label: 'Need all uses', numeric: true, getValue: r => r.neededAllUses, render: r => r.neededAllUses.toLocaleString() },
    { label: 'Deficit', numeric: true, getValue: r => r.deficit,
      render: r => r.deficit > 0 ? '<b style="color:var(--bad)">' + r.deficit.toLocaleString() + '</b>' : '0' },
  ];
  if (showFarm) {
    cols.push({ label: 'Farm', numeric: false, getValue: r => r.npc || '',
      render: r => r.npc ? (esc(r.npc) + ' (' + esc(r.location) + ')') : '-' });
  }
  return cols;
}

function renderMaterials(m) {
  let html = '';
  html += '<div class="cards">';
  html += card('Materials in deficit', m.totals.deficitCount);
  html += card('Scraps needed (all uses)', fmtC(m.totals.scrapsNeededAllUses));
  html += card('Blueprints included', m.totals.blueprintsIncluded);
  html += '</div>';

  html += '<h2>NPC drop materials</h2>';
  html += '<div class="sub">farm the listed NPC at the listed location; per-kill drop amounts are not modeled &mdash; only stock vs need is shown</div>';
  html += tableHtml('tbl-mat-npc', m.npcDrops, materialCols(true));

  html += '<h2>Laboratory materials</h2>';
  html += '<div class="sub">produced in the laboratory/base, not farmed from NPCs</div>';
  html += tableHtml('tbl-mat-lab', m.labMaterials, materialCols(false));

  html += '<h2>Other</h2>';
  html += tableHtml('tbl-mat-other', m.other, materialCols(false));

  return html;
}

// ---- Lab bottleneck planner ----
function labCapsuleTarget(fallback) {
  try {
    const v = parseInt(localStorage.getItem('advisor-lab-capsules') || '', 10);
    if (v > 0) return v;
  } catch (e) {}
  return fallback || 10;
}
function setLabCapsules(v) {
  const n = Math.max(1, Math.floor(Number(v) || 0));
  try { localStorage.setItem('advisor-lab-capsules', String(n)); } catch (e) {}
  if (window.lastData) render(window.lastData);
}
function fmtHours(h) {
  if (h === null || h === undefined) return '?';
  if (h < 1 / 60) return '< 1 min';
  if (h < 1) return Math.round(h * 60) + ' min';
  if (h < 48) return h.toFixed(1) + ' h';
  return (h / 24).toFixed(1) + ' d';
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
function renderLab(lab) {
  if (!lab || !lab.available) {
    setTabCount('lab', 0, true);
    return '<div class="empty-note">No laboratory buildings found in the game state.</div>';
  }
  const LM = window.LabMath;
  const capsules = labCapsuleTarget(lab.capsulesDefault);
  const chain = LM.buildChain(lab.chain);
  const opts = { freeSlots: lab.freeSlots };
  const capsuleOpts = Object.assign({ netTopLevel: false }, opts);
  const demand = [{ product: 'warp capsule', units: capsules }];
  const { plan, count: shortfallCount } = labShortfallCount(lab);
  setTabCount('lab', shortfallCount, true);
  const afterStocks = LM.stocksAfterBundle(lab.stocks, lab.foundingBundle);
  const after = LM.planCore(chain, demand, afterStocks, capsuleOpts);
  const founding = lab.targets.baseFounding;

  let html = '<div class="sub">Chain from the live Laboratory: each unit consumes its building\'s input of EVERY listed resource; timer = base &minus; 0.1 s per level (floor 5 s); level k costs 1.15M &times; k credits. Queued units are not counted; stocks are treated as static. The capsule target is ADDITIONAL capsules on top of what you hold; both targets share the same stock.</div>';

  // --- cards ---
  html += '<div class="cards">';
  html += card('Warp capsule target', '<input class="pet-input lab-input" type="number" min="1" value="' + capsules + '" onchange="setLabCapsules(this.value)"> capsules <span class="dimtext">(' + fmtC(lab.capsulesInStock || 0) + ' in stock)</span>');
  html += card('Chain time (pipelined)', fmtHours(plan.hoursPipelined) +
    '<span style="font-size:11px;color:var(--dim)"> claim &amp; re-queue every 10 min &middot; sequential ' + fmtHours(plan.hoursSequential) + '</span>');
  if (plan.binding) {
    html += card('Binding resource', '<span style="color:var(--bad)">' + esc(plan.binding.name) + '</span> ' + covBar(plan.binding.coverage) +
      '<span style="font-size:11px;color:var(--dim)">' + (plan.binding.coverage * 100).toFixed(0) + '% covered</span>');
  } else {
    // plan.raw only ever holds resources the chain CANNOT produce, and in
    // every capture so far it is empty -- so an unqualified "all covered"
    // read as "no bottleneck" while the per-building table below showed
    // inputs at 0%. Scope the claim, and name what is actually binding.
    const producing = [];
    for (const b of plan.buildings || []) {
      for (const i of b.inputs || []) if (i.coverage < 1) producing.push(i.name);
    }
    html += card('Raw resources', '<span style="color:var(--good)">all covered</span>' +
      '<span style="font-size:11px;color:var(--dim)"> nothing to gather or buy' +
      (producing.length
        ? ' &middot; ' + producing.length + ' input' + (producing.length > 1 ? 's' : '') + ' must be produced first (' + esc(producing.slice(0, 3).join(', ')) + ')'
        : '') + '</span>');
  }
  html += card('Queue slots', lab.freeSlots + ' free / ' + lab.queueSlots);
  html += card('Critical building' + (plan.criticalGroup.length > 1 ? 's (tied)' : ''), plan.criticalGroup.length ? '<span class="crit">' + plan.criticalGroup.map(esc).join(', ') + '</span>' : '-');
  html += '</div>';

  // --- per building ---
  const rows = plan.buildings.filter(b => b.unitsToRun > 0);
  html += '<h2>Per building</h2><div class="sub">buildings with nothing to run are hidden; a building runs one queue, so its time is serial</div>';
  html += tableHtml('tbl-lab-buildings', rows, [
    { label: 'Building', numeric: false, getValue: r => r.name, render: r => (plan.criticalGroup.includes(r.name) ? '<span class="crit">' : '<b>') + esc(r.name) + (plan.criticalGroup.includes(r.name) ? ' &#9650;</span>' : '</b>') },
    { label: 'Stage', numeric: true, getValue: r => r.stage, render: r => String(r.stage) },
    { label: 'Units', numeric: true, getValue: r => r.unitsToRun, render: r => String(r.unitsToRun) },
    { label: 'Timer', numeric: true, getValue: r => r.timerNow, render: r => r.timerNow.toFixed(1) + ' s (lvl ' + r.level + ')' },
    { label: 'Time', numeric: true, getValue: r => r.hours, render: r => fmtHours(r.hours) },
    { label: 'Inputs needed / stock', numeric: false, getValue: r => r.inputs.length,
      render: r => r.inputs.map(i => '<span style="white-space:nowrap;' + (i.coverage < 1 && i.kind === 'currency' ? 'color:var(--bad)' : '') + '">' +
        esc(i.name) + ' ' + fmtC(i.needed) + '<span class="dimtext"> / ' + fmtC(i.stock) + '</span></span>').join(' &middot; ') },
  ]);

  // --- raw currencies ---
  html += '<h2>Raw resources</h2>';
  html += tableHtml('tbl-lab-raw', plan.raw, [
    { label: 'Resource', numeric: false, getValue: r => r.name, render: r => '<b>' + esc(r.name) + '</b>' },
    { label: 'Needed', numeric: true, getValue: r => r.needed, render: r => fmtC(r.needed) },
    { label: 'Stock', numeric: true, getValue: r => r.stock, render: r => fmtC(r.stock) },
    { label: 'Coverage', numeric: true, getValue: r => r.coverage, render: r => covBar(r.coverage) + (r.coverage * 100).toFixed(0) + '%' },
    { label: 'Capsules supported', numeric: true, getValue: r => r.unitsSupported, render: r => String(r.unitsSupported) },
  ]);

  // --- upgrade ROI ---
  html += '<h2>Upgrade ROI</h2><div class="sub">credits per hour saved on the pipelined chain time, +1 level each. Buildings tied at the top must be upgraded together: one alone saves nothing.</div><div class="list">';
  let roiIndex = 0;
  if (plan.groupRoi && plan.groupRoi.buildings.length > 1) {
    roiIndex++;
    html += '<div class="row"><span class="num">' + roiIndex + '</span><span><b>' + plan.groupRoi.buildings.map(esc).join(' + ') + '</b> (tied at the top) +1 level each: ' +
      fmtC(plan.groupRoi.cost) + (plan.groupRoi.creditsPerHourSaved !== null
        ? ' saves ' + fmtHours(plan.groupRoi.hoursSaved) + ' &mdash; <b>' + fmtC(plan.groupRoi.creditsPerHourSaved) + '</b> per hour saved'
        : ' saves nothing (next stage bounds the chain)') + '</span></div>';
  }
  const roi = plan.upgradeRoi.filter(r => r.creditsPerHourSaved !== null).slice(0, 5);
  if (!roi.length && !(plan.groupRoi && plan.groupRoi.creditsPerHourSaved !== null)) html += '<div class="row"><span>No level upgrade shortens the chain (nothing on the critical path to speed up).</span></div>';
  roi.forEach((r) => {
    roiIndex++;
    html += '<div class="row"><span class="num">' + roiIndex + '</span><span><b>' + esc(r.name) + '</b> lvl ' + r.level + ' &rarr; ' + (r.level + 1) +
      ': ' + fmtC(r.nextLevelCost) + ' saves ' + fmtHours(r.hoursSaved) + ' &mdash; <b>' + fmtC(r.creditsPerHourSaved) + '</b> per hour saved' +
      (r.levelsToFloor ? '<span class="dimtext"> &middot; ' + r.levelsToFloor + ' levels to the 5 s floor (' + fmtC(r.costToFloor) + ')</span>' : '<span class="dimtext"> &middot; at the floor</span>') +
      '</span></div>';
  });
  html += '</div>';

  // --- speed multiplier ---
  if (plan.speed) {
    const best = plan.speed.options.filter(o => o.affordable && o.hoursSaved > 0).sort((a, b) => b.hoursSaved - a.hoursSaved)[0];
    html += '<h2>Speed multiplier</h2><div class="list">';
    if (best) {
      html += '<div class="row"><span><b>' + plan.speed.buildings.map(esc).join(' + ') + '</b> at <b>x' + best.x + '</b>' + (plan.speed.buildings.length > 1 ? ' (all of them, they are tied)' : '') + ': chain ' + fmtHours(best.hours) + ' (saves ' + fmtHours(best.hoursSaved) + '), inputs &times;' + best.inputMult +
        ' &mdash; extra ' + best.extraInputs.map(e => esc(e.name) + ' ' + fmtC(e.extra)).join(', ') + '. Costs resources, not credits; compare with the level upgrades above by hours saved.</span></div>';
    } else {
      html += '<div class="row"><span>No speed multiplier on <b>' + plan.speed.buildings.map(esc).join(' + ') + '</b> is affordable from stock.</span></div>';
    }
    html += '</div>';
  }

  // --- base founding ---
  html += '<h2>Base founding</h2><div class="cards">';
  const bundleRows = lab.foundingBundle.map(b => ({ name: b.product, need: b.units, have: lab.stocks[b.product] || 0 }));
  const shortRows = bundleRows.filter(b => b.have < b.need);
  html += card('Bundle', shortRows.length ? '<span style="color:var(--warn)">' + (bundleRows.length - shortRows.length) + ' / ' + bundleRows.length + ' ready</span>' : '<span style="color:var(--good)">5 / 5 ready</span>');
  html += card('Chain time to complete', founding.ready ? 'ready' : fmtHours(founding.hoursPipelined));
  html += card('Capsules after founding', fmtHours(after.hoursPipelined) + (after.binding ? '<span style="font-size:11px;color:var(--bad)"> binding ' + esc(after.binding.name) + '</span>' : ''));
  html += '</div>';
  if (shortRows.length) {
    html += '<div class="list">' + shortRows.map(b => '<div class="row"><span><b>' + esc(b.name) + '</b> ' + fmtC(b.have) + ' / ' + fmtC(b.need) + '</span></div>').join('') + '</div>';
  }
  return html;
}

// ---- Base planner ----
function baseLevels() {
  try { const v = JSON.parse(localStorage.getItem('advisor-base-levels') || 'null'); if (v && typeof v === 'object') return v; } catch (e) {}
  return {};
}
function setBaseLevel(name, v) {
  const levels = baseLevels();
  const n = Math.max(0, Math.floor(Number(v) || 0));
  levels[name] = n;
  try { localStorage.setItem('advisor-base-levels', JSON.stringify(levels)); } catch (e) {}
  if (window.lastData) render(window.lastData);
}
// validOptions, when given, restricts the stored star to one the selector
// actually offers (current system + bookmarks) so the dropdown and the
// rate always agree; a stale/unknown stored value falls back to `fallback`.
function baseStar(fallback, validOptions) {
  try {
    const v = localStorage.getItem('advisor-base-star');
    if (v && (!validOptions || validOptions.indexOf(v) !== -1)) return v;
  } catch (e) {}
  return fallback;
}
function setBaseStar(v) {
  try { localStorage.setItem('advisor-base-star', v); } catch (e) {}
  if (window.lastData) render(window.lastData);
}
function fmtDays(d) {
  if (d === null || d === undefined || !isFinite(d)) return '?';
  if (d < 1) return Math.round(d * 24) + ' h';
  return d.toFixed(1) + ' d';
}
// Recompute the plan client-side from the payload input with the stored
// level boxes and star selector applied.
function basePlanFor(b) {
  const BM = window.BaseMath;
  const levels = Object.assign({}, b.input.levels || {}, baseLevels());
  const starOptions = [b.location.current].concat(b.location.bookmarks).filter(s => s.star).map(s => s.star);
  const starName = baseStar(b.input.starName, starOptions);
  const rate = (BM.STAR_BONUSES[starName] || { rate: b.input.starRate || 0 }).rate;
  const input = Object.assign({}, b.input, { levels, starName, starRate: rate });
  return { plan: BM.planBase(input), starName, rate, levels };
}
function baseShortfallCount(b) {
  if (!b || !b.plan) return 0;
  return basePlanFor(b).plan.stockpile.filter(s => s.short > 0).length;
}
function renderBase(b) {
  if (!b) return '<div class="empty-note">No base data in the game state.</div>';
  const BM = window.BaseMath;
  const { plan, starName, rate } = basePlanFor(b);
  setTabCount('base', plan.stockpile.filter(s => s.short > 0).length, true);
  let html = '';
  html += '<div class="sub">Formulas from the game client bundle ' + esc(b.provenance.bundle) + ' (patch ' + esc(String(b.provenance.live || b.provenance.client)) + ')' +
    (b.provenance.drift ? ' <span class="drift">(the game now runs ' + esc(String(b.provenance.liveBundle)) + ' &mdash; re-check formulas)</span>' : '') +
    '. Stellarium income is an estimate (star rate &times; miner boost every 5 h); everything else is exact. Level cost is charged from EACH of a module\'s materials.</div>';

  // --- cards ---
  html += '<div class="cards">';
  html += card('Phase', b.phase === 'live' ? '<span style="color:var(--good)">base founded</span>' : 'pre-founding');
  const readyCount = b.founding.bundle.filter(x => x.have >= x.units).length;
  html += card('Founding materials', (readyCount === b.founding.bundle.length ? '<span style="color:var(--good)">' : '<span style="color:var(--warn)">') + readyCount + ' / ' + b.founding.bundle.length + '</span>');
  const stars = [b.location.current].concat(b.location.bookmarks).filter(s => s.star);
  const seen = {}; const options = [];
  for (const s of stars) { if (seen[s.star]) continue; seen[s.star] = true; options.push(s); }
  html += card('Stellarium star', '<select class="pet-input" onchange="setBaseStar(this.value)">' +
    options.map(s => '<option value="' + esc(s.star) + '"' + (s.star === starName ? ' selected' : '') + '>' + esc(s.star) + ' (rate ' + s.rate + ')' + (s.name ? ' &middot; ' + esc(s.name) : '') + '</option>').join('') +
    '</select>' + (b.location.best && b.location.best.rate > rate ? '<span class="est"> best known: ' + esc(b.location.best.star) + ' rate ' + b.location.best.rate + (b.location.best.name ? ' at ' + esc(b.location.best.name) : '') + '</span>' : ''));
  // Two formulas disagree by the star rate; show the range rather than pick a
  // side the client cannot settle. See ESTIMATES in public/base-math.js.
  html += card('Stellarium / day',
    plan.stellariumPerDay.toFixed(1) +
    (plan.stellariumPerDayClient && plan.stellariumPerDayClient < plan.stellariumPerDay
      ? ' <span style="color:var(--warn)">&ndash; ' + plan.stellariumPerDayClient.toFixed(1) + '?</span>' : '') +
    '<span class="est"> estimate &middot; all unlocks in ' + fmtDays(plan.daysToAllUnlocks) +
    (plan.daysToAllUnlocksClient && plan.daysToAllUnlocksClient > plan.daysToAllUnlocks
      ? ' &ndash; ' + fmtDays(plan.daysToAllUnlocksClient) : '') +
    ' (' + plan.totalStellariumLeft + ' left)</span>');
  const up = plan.upkeep;
  const inc = b.income || null;
  // Affordability is measured against the OBSERVED income rate. The share of
  // the billing basis is NOT a verdict: upkeep is linear in that basis, so the
  // ratio cancels it out and reads the same at any income -- it is a constant
  // of the chosen target levels, not a statement about affording them.
  const basis = function (u, unlockedWord) {
    const observed = inc && inc.recent ? inc.recent.perDay : 0;
    const share = observed > 0
      ? '<b>' + (u.perDay / observed * 100).toFixed(1) + '%</b> of your observed ' + fmtC(observed) + '/day'
      : (u.shareOfIncome !== null
        ? (u.shareOfIncome * 100).toFixed(0) + '% of the ' + fmtC(b.input.avgDaily) + '/day billing basis (observed rate not measured yet)'
        : 'income unknown');
    const quests = u.questsKnown === false
      ? 'daily quests not loaded, no coverage applied'
      : 'dailies claimed today cover ' + (u.coverage * 100).toFixed(0) + '%';
    return '<span class="est"> ' + share + ' &middot; ' + u.passiveCount + ' passive modules' + unlockedWord
      + ' &middot; ' + quests + ' &rarr; net ' + fmtC(u.netPerDay) + '</span>';
  };
  if (b.live && plan.upkeepNow) {
    html += card('Upkeep / day now', fmtC(plan.upkeepNow.perDay) + basis(plan.upkeepNow, ' unlocked'));
  }
  html += card('Upkeep / day at targets', fmtC(up.perDay) + basis(up, ''));
  html += '</div>';
  if (inc) {
    const wallet = window.lastData && window.lastData.units ? window.lastData.units.credits : 0;
    let note = 'Upkeep is billed hourly, on the game\'s <b>statistics.credits</b> counter divided by the age of the account &mdash; the game\'s own formula. That counter is <b>not</b> everything you have earned: it reads ' + fmtC(inc.lifetimeCredits) + ' while your wallet holds ' + fmtC(wallet) + ', so it misses whole sources. The bill rises as the counter does.';
    if (inc.recent) {
      note += ' Observed since ' + esc(new Date(inc.recent.since).toLocaleString()) + ': <b>' + fmtC(inc.recent.perDay) + '/day</b> over ' + inc.recent.days.toFixed(1) + ' d of history'
        + (inc.avgDaily > 0 ? ' (' + (inc.recent.perDay / inc.avgDaily).toFixed(2) + '&times; the lifetime average)' : '') + '.';
    } else {
      note += ' The observed recent rate needs at least an hour between two analyses before it can be shown.';
    }
    html += '<div class="sub">' + note + '</div>';
  }
  if (plan.stellariumPerDayClient && plan.stellariumPerDayClient < plan.stellariumPerDay) {
    html += '<div class="sub"><b style="color:var(--warn)">The stellarium rate is contested.</b> The advisor scales the miner yield by the star rate (' +
      plan.stellariumPerDay.toFixed(1) + '/day here), but the drop-rate display in the client itself is <code>1 + boost/100</code> with no star rate in it (' +
      plan.stellariumPerDayClient.toFixed(1) + '/day) &mdash; and nothing in the bundle reads the star rate for stellarium, so it may only apply server-side. ' +
      'Every unlock ETA on this tab inherits the gap (' + fmtDays(plan.daysToAllUnlocks) + ' vs ' + fmtDays(plan.daysToAllUnlocksClient) + ' for all unlocks). ' +
      'Founding the base settles it: once <code>statistics.stellariumObtained</code> starts moving, the observed rate replaces both.</div>';
  }
  if (up.questsKnown === false) html += '<div class="sub">Daily quest coverage is unknown: the game only fills DailyQuestsStore once you open the daily quests panel in-game. Open it, then analyze again &mdash; claimed dailies cut upkeep by 15% each, up to 75%.</div>';
  if (b.labPanelHint) html += '<div class="sub">Base-tier lab buildings (Aeroforge, Cryovault, Ferric Mill, Prism Nexus, Rare Material Facility) and their price only show up after you open the Laboratory panel in-game once.</div>';
  if (b.location.bodies.length) html += '<div class="sub">Body XP bonus (+10%, permanent) in the current system: ' + b.location.bodies.map(x => esc(x.type) + (x.activity ? ' &rarr; ' + esc(x.activity) : '')).join(', ') + '.</div>';

  // --- live block ---
  if (b.live) {
    html += '<h2>Base: ' + esc(b.live.name) + '</h2><div class="cards">';
    html += card('Stellarium held', String(b.live.stellarium));
    if (b.live.nextUnlock) html += card('Next unlock', esc(b.live.nextUnlock.name) + '<span class="est"> ' + b.live.nextUnlock.cost + ' stellarium &middot; ' + (b.live.nextUnlock.etaDays === 0 ? 'affordable now' : 'in ' + fmtDays(b.live.nextUnlock.etaDays) + ' (estimate)') + '</span>');
    html += '</div>';
    html += tableHtml('tbl-base-live', b.live.modules.filter(m => m.unlocked), [
      { label: 'Module', numeric: false, getValue: r => r.name, render: r => '<b>' + esc(r.name) + '</b>' + (r.active ? '' : ' <span style="color:var(--bad)">(off)</span>') },
      { label: 'Level', numeric: true, getValue: r => r.level, render: r => String(r.level) },
      { label: 'Tier', numeric: true, getValue: r => r.tier, render: r => String(r.tier) },
      { label: 'Boost', numeric: true, getValue: r => r.boost, render: r => r.boost.toFixed(1) + '%' },
      { label: 'Output / tick', numeric: true, getValue: r => r.output, render: r => r.output.toFixed(2) },
      { label: 'Next level', numeric: true, getValue: r => r.nextLevelCost, render: r => fmtC(r.nextLevelCost) + ' of each: ' + r.materials.map(esc).join(', ') },
      { label: 'Next tier', numeric: true, getValue: r => r.nextTierCost, render: r => r.nextTierCost + ' stellarium' },
    ]);
  }

  // --- modules / targets ---
  html += '<h2>Modules and targets</h2><div class="sub">unlock order follows the needs tree; set the level you want to reach in each box (saved in this browser)</div>';
  const rows = plan.unlocks.map(u => Object.assign({}, u, plan.targets.find(t => t.name === u.name) || {}));
  html += tableHtml('tbl-base-modules', rows, [
    { label: 'Module', numeric: false, getValue: r => r.name, render: r => '<b>' + esc(r.name) + '</b>' + (r.unlocked ? ' <span style="color:var(--good)">unlocked</span>' : '') },
    { label: 'Type', numeric: false, getValue: r => r.type || '', render: r => esc(r.type || '') },
    { label: 'Unlock', numeric: true, getValue: r => r.cost, render: r => r.unlocked ? '-' : r.cost + '<span class="est"> (' + r.cumulative + ' cum. &middot; ' + fmtDays(r.daysToUnlock) + ')</span>' },
    { label: 'Materials', numeric: false, getValue: r => (r.materials || []).join(','), render: r => (r.materials || []).map(esc).join(', ') },
    { label: 'Target level', numeric: true, getValue: r => r.to || 0, render: r => '<input class="pet-input base-input" type="number" min="0" value="' + (r.to || 0) + '" onchange="setBaseLevel(' + esc(jsStr(r.name)) + ', this.value)">' + (r.from ? '<span class="est"> from ' + r.from + '</span>' : '') },
    { label: 'Cost to target', numeric: true, getValue: r => r.perMaterial || 0, render: r => fmtN(r.perMaterial || 0) + ' of each' },
    { label: 'Boost at target', numeric: true, getValue: r => r.boostAtTarget || 0, render: r => (r.boostAtTarget || 0).toFixed(0) + '%' },
    { label: 'Output / tick at target', numeric: true, getValue: r => r.outputAtTarget || 0, render: r => (r.outputAtTarget === undefined ? '-' : r.outputAtTarget.toFixed(2)) },
    { label: 'Upkeep / h at target', numeric: true, getValue: r => r.upkeepPerHourAtTarget || 0, render: r => (r.type === 'active' || (b.live && !r.unlocked)) ? '-' : fmtC(r.upkeepPerHourAtTarget || 0) },
  ]);

  // --- stockpile ---
  html += '<h2>Stockpile for the targets</h2>';
  html += '<div class="sub">chain times are per material and each assumes the full raw stock; shared raw resources (silicon, cobalt, argon&hellip;) are not split between rows</div>';
  if (plan.buyFirst.length) html += '<div class="sub" style="color:var(--warn)">Buy these base-tier lab buildings first: ' + plan.buyFirst.map(esc).join(', ') + '.</div>';
  html += tableHtml('tbl-base-stock', plan.stockpile, [
    { label: 'Material', numeric: false, getValue: r => r.material, render: r => '<b>' + esc(r.material) + '</b>' },
    { label: 'Needed', numeric: true, getValue: r => r.needed, render: r => fmtN(r.needed) },
    { label: 'Stock', numeric: true, getValue: r => r.stock, render: r => fmtN(r.stock) },
    { label: 'Short', numeric: true, getValue: r => r.short, render: r => r.short > 0 ? '<span style="color:var(--bad)">' + fmtN(r.short) + '</span>' : '<span style="color:var(--good)">0</span>' },
    { label: 'For', numeric: false, getValue: r => r.modules.length, render: r => r.modules.map(esc).join(', ') },
    { label: 'Produced by', numeric: false, getValue: r => r.building || '', render: r => r.bought ? esc(r.building || '') : '<span style="color:var(--warn)">buy ' + esc(r.building || '?') + ' first</span><span class="est"> &middot; consumes ' + r.inputs.map(esc).join(', ') + '</span>' },
    { label: 'Chain time', numeric: true, getValue: r => r.hoursPipelined === null ? -1 : r.hoursPipelined, render: r => r.hoursPipelined === null ? '-' : fmtHours(r.hoursPipelined) + (r.binding ? '<span style="color:var(--bad)"> binding ' + esc(r.binding.name) + ' ' + (r.binding.coverage * 100).toFixed(0) + '%</span>' : '') },
  ]);
  return html;
}

function renderSummary(p, prevP) {
  const delta = key => {
    if (!prevP || prevP[key] === undefined || prevP[key] === null) return '';
    const d = p[key] - prevP[key];
    if (!d) return '';
    const col = d > 0 ? 'var(--good)' : 'var(--bad)';
    const txt = (d > 0 ? '+' : '-') + fmtC(Math.abs(d));
    return ' <span style="color:' + col + ';font-size:11px;font-weight:700">' + txt + '</span>';
  };
  return card('Crafting lvl', p.craftLevel + ' <span style="font-size:11px;color:var(--dim)">' + p.currentXp + '/' + p.targetXp + ' xp</span>') +
    card('Dust', p.dust.toLocaleString() + delta('dust')) +
    card('Catalyst parts', p.parts.toLocaleString() + delta('parts')) +
    card('Quantum cores', p.qc.toLocaleString() + delta('qc')) +
    card('Installed', p.installedCount) +
    card('Unequipped', p.unequippedCount);
}
function card(k, v) { return '<div class="card"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>'; }

function render(d) {
  const variant = window.planVariant || 'full';
  const tab = window.activeTab || 'gear';
  const doneSet = loadDone();
  if (d) {
    // Summary and badges are decoration: a game patch that renames one nested
    // field must not take out all twelve tabs. Each piece fails on its own.
    const guard = (what, fn) => { try { fn(); } catch (e) { console.warn('render: ' + what + ' failed', e); } };
    guard('summary', () => {
      document.getElementById('summary').innerHTML = renderSummary(d.player, window.prevData ? window.prevData.player : null);
    });
    guard('badges', () => {
      setTabCount('battle', (d.warnings || []).length, true);
      const curList = variant === 'full' ? d.installs : d.installsResources;
      setTabCount('installs', (curList || []).length, false);
      setTabCount('merges', (d.mergePlans || []).length, false);
      setTabCount('inventory', d.inventory && d.inventory.counts ? d.inventory.counts.sellCandidates : 0, true);
      setTabCount('materials', d.materials && d.materials.totals ? d.materials.totals.deficitCount : 0, true);
      // When the lab tab is active, renderLab() computes the plan itself and
      // sets this badge from it (avoids computing the plan twice per render).
      if (tab !== 'lab') setTabCount('lab', d.lab && d.lab.available ? labShortfallCount(d.lab).count : 0, true);
      // Same story for base: renderBase() computes the plan itself and sets
      // this badge from it when the tab is active.
      if (tab !== 'base') setTabCount('base', baseShortfallCount(d.base), true);
    });
  }
  let html = '';
  if (tab === 'history') {
    html = '<div class="empty-note">Loading history...</div>';
    document.getElementById('content').innerHTML = html;
    document.querySelectorAll('.maintabs button').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    loadHistory();
    return;
  }
  // One render function throwing used to leave #content untouched: the page
  // looked un-analyzed, every tab button did nothing, and no message said why.
  // Fail loudly, in the tab, and keep the rest of the app alive.
  try {
  if (tab === 'gear') {
    html += '<h2>Item advisor</h2>' + renderShipItemAdvisor(d.shipItems);
    html += '<h2>Equipped gear</h2>' + renderGear(d.gear);
  } else if (tab === 'battle') {
    if (d.battleTrusted === false) {
      html += '<div class="row" style="border-color:rgba(224,91,91,.4)"><span><b style="color:var(--bad)">Squadron boost unknown</b> &mdash; ' +
        'squadronStore had not populated when this analysis ran, so every battle number below is missing the squadron multiplier ' +
        '(roughly 45% low) and nothing was written to the history chart. Open the squadron panel in-game, then analyze again.</span></div>';
    }
    if (d.battleBase) {
      html += '<h2>Current battle benchmark</h2><div class="sub">max NPC level @ &ge;98% winrate (squadron boost included)</div>';
      html += '<div class="cards">' + Object.entries(d.battleBase).map(([npc, lvl]) =>
        '<div class="card"><div class="k">' + esc(npc) + '</div><div class="v">' + lvl + '</div></div>').join('') + '</div>';
    }
    html += '<h2>Active bonuses per activity</h2>';
    html += '<div class="sub">what actually applies during each activity (a non-empty activity group replaces the default group for that item; empty groups inherit). Every capped stat that matters here is listed, current / cap &mdash; red means over the cap and wasted.</div>';
    html += renderContextTotals(d.contextTotals);
    html += renderOverrideLosses(d.overrideLosses);
  } else if (tab === 'installs') {
    const labels = {
      full: 'Variant A: full explore <span style="font-weight:400">(default: general stats; all specialized tabs filled)</span>',
      resources: 'Variant B: full resources <span style="font-weight:400">(default slots = gathering only; all specialized tabs filled)</span>',
    };
    html += '<h2>Install / replace plan &mdash; ' + labels[variant] + '</h2>';
    if (d.projection) html += renderProjection(d.projection, d.battleBase);
    html += '<div class="toolbar" style="margin-bottom:6px">' +
      '<button class="ghost ' + (variant === 'full' ? 'active' : '') + '" onclick="setVariant(&quot;full&quot;)">Full explore</button>' +
      '<button class="ghost ' + (variant === 'resources' ? 'active' : '') + '" onclick="setVariant(&quot;resources&quot;)">Full resources</button>' +
      '<button class="ghost" style="margin-left:auto" onclick="resetDone()">Reset checkmarks</button></div>';
    const planList = variant === 'full' ? d.installs
      : d.installsResources;
    const prevInstallKeys = computeInstallKeySet(window.prevData, variant);
    html += renderInstalls(planList, d.freedTexts, d.battleNote, d.gear, variant, doneSet, prevInstallKeys);
  } else if (tab === 'merges') {
    html += '<h2>Merge plan</h2>';
    html += '<div class="toolbar" style="margin-bottom:6px"><button class="ghost" onclick="resetDone()">Reset checkmarks</button></div>';
    const prevMergeKeys = computeMergeKeySet(window.prevData);
    html += renderMerges(d.mergePlans, d.player, d.mergeRequirements, doneSet, prevMergeKeys);
  } else if (tab === 'units') {
    html += renderUnits(d.units);
  } else if (tab === 'tech') {
    html += renderTech(d.tech);
    setTimeout(calcQcGap, 0);
  } else if (tab === 'pets') {
    html += renderPets(d.pets);
    setTimeout(simPet, 0);
  } else if (tab === 'inventory') {
    html += '<h2>Catalyst inventory</h2>' + renderInventory(d.inventory);
  } else if (tab === 'materials') {
    html += '<h2>Materials</h2>' + renderMaterials(d.materials);
  } else if (tab === 'lab') {
    html += '<h2>Lab bottleneck planner</h2>' + renderLab(d.lab);
  } else if (tab === 'base') {
    html += '<h2>Base planner</h2>' + renderBase(d.base);
  }
  } catch (e) {
    console.error('render(' + tab + ') failed', e);
    html = '<div class="row" style="border-color:rgba(224,91,91,.4)"><span>' +
      '<b style="color:var(--bad)">This tab could not be rendered.</b> ' +
      esc(String(e && e.message || e)) +
      '<br><span style="color:var(--dim)">The analysis data is missing a field this tab needs &mdash; usually a game update that renamed something. ' +
      'The other tabs still work; the browser console has the stack.</span></span></div>';
  }
  document.getElementById('content').innerHTML = html;
  document.querySelectorAll('.maintabs button').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
}

async function refresh() {
  const btn = document.getElementById('refresh');
  const status = document.getElementById('status');
  if (window.lastData) window.prevData = window.lastData;
  btn.disabled = true;
  status.textContent = ' reading game state...';
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const to = setTimeout(function () { ctrl.abort(); }, 90000);
    const r = await fetch('/api/analyze', { signal: ctrl.signal });
    clearTimeout(to);
    const d = await r.json();
    // A failure must never render in the same colour as a success: an
    // overnight auto-refresh that quietly died left hours-old numbers on
    // screen looking freshly analyzed.
    if (d.error) { status.textContent = ' error: ' + d.error; status.style.color = 'var(--bad)'; }
    else {
      window.lastData = d;
      try { render(d); status.textContent = ' updated ' + new Date().toLocaleTimeString() + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)'; status.style.color = ''; }
      catch (e) { status.textContent = ' render error: ' + e.message; status.style.color = 'var(--bad)'; console.error(e); }
    }
  } catch (e) {
    status.textContent = ' failed: ' + (e.name === 'AbortError' ? 'timed out after 90s' : e.message);
    status.style.color = 'var(--bad)';
  }
  btn.disabled = false;
}
// ---- auto-refresh interval (minutes, localStorage-backed) ----
// The interval is remembered; the checkbox deliberately is not, so opening the
// page never starts analyzing on its own.
const AUTO_MINS_DEFAULT = 60;
const AUTO_MINS_MAX = 1440; // 24h

function autoMins() {
  try {
    const v = parseInt(localStorage.getItem('advisor-auto-mins') || '', 10);
    if (Number.isFinite(v) && v >= 1 && v <= AUTO_MINS_MAX) return v;
  } catch (e) {}
  return AUTO_MINS_DEFAULT;
}

// Clamp whatever was typed, write the accepted value back into the field so the
// GUI never claims an interval it is not using, and reschedule a running timer.
function setAutoMins(raw) {
  let n = parseInt(raw, 10);
  if (!Number.isFinite(n)) n = AUTO_MINS_DEFAULT;
  n = Math.min(AUTO_MINS_MAX, Math.max(1, n));
  const el = document.getElementById('autoMins');
  if (el) el.value = n;
  try { localStorage.setItem('advisor-auto-mins', String(n)); } catch (e) {}
  if (autoTimer) { clearInterval(autoTimer); autoTimer = setInterval(refresh, n * 60000); }
  return n;
}

function autoOn() {
  try { return localStorage.getItem('advisor-auto-on') === '1'; } catch (e) { return false; }
}

function clearAuto() {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  if (autoKickoff) { clearTimeout(autoKickoff); autoKickoff = null; }
}

// firstDelayMs = 0 means analyze straight away (the user just ticked the box).
// A positive delay is the page-load case: the snapshot already on screen counts
// as elapsed time, so a reload neither re-analyzes needlessly nor lets the data
// go a full extra interval stale.
function startAuto(firstDelayMs) {
  clearAuto();
  const wait = Math.max(0, Math.min(firstDelayMs || 0, autoMins() * 60000));
  const begin = function () {
    autoKickoff = null;
    refresh();
    autoTimer = setInterval(refresh, autoMins() * 60000);
  };
  if (wait === 0) begin();
  else autoKickoff = setTimeout(begin, wait);
}

function toggleAuto(on) {
  try { localStorage.setItem('advisor-auto-on', on ? '1' : '0'); } catch (e) {}
  if (on) startAuto(0); else clearAuto();
}
function setTab(t) {
  window.activeTab = t;
  // The history tab has no dependency on an analyze result, so it must
  // render even before the user has ever clicked "Analyze now".
  if (window.lastData || t === 'history') render(window.lastData || null);
}
function setVariant(v) {
  window.planVariant = v;
  if (window.lastData) render(window.lastData);
}

async function loadLast() {
  const status = document.getElementById('status');
  try {
    const r = await fetch('/api/last');
    const d = await r.json();
    if (d && !d.empty && !d.error) {
      window.lastData = d;
      render(d);
      const when = d.capturedAt ? new Date(d.capturedAt).toLocaleString() : 'unknown time';
      status.textContent = ' showing snapshot from ' + when + ' — click "Analyze now" for fresh data';
      status.style.color = 'var(--warn)';
      const t = Number(new Date(d.capturedAt));
      return Number.isFinite(t) ? t : null; // when the shown snapshot was taken
    }
  } catch (e) { /* no snapshot yet -- keep the "Click Analyze now" empty-note */ }
  return null;
}

const HISTORY_METRICS = [
  { key: 'battleAvg', label: 'Battle avg level', fmt: v => String(v) },
  { key: 'craftLevel', label: 'Craft level', fmt: v => String(v) },
  { key: 'dust', label: 'Cosmic dust', fmt: fmtC },
  { key: 'qc', label: 'Quantum cores', fmt: fmtC },
  { key: 'credits', label: 'Credits', fmt: fmtC },
  { key: 'parts', label: 'Catalyst parts', fmt: fmtC },
  { key: 'installedCount', label: 'Installed catalysts', fmt: v => String(v) },
  { key: 'unequippedCount', label: 'Unequipped catalysts', fmt: v => String(v) },
  { key: 'petLevelSum', label: 'Pet levels (sum)', fmt: v => String(v) },
];

function svgChart(points, fmt) {
  const W = 280, H = 80, PAD = 8;
  const times = points.map(p => new Date(p.t).getTime());
  const t0 = times[0], t1 = times[times.length - 1];
  const tSpan = t1 - t0 || 1;
  const vals = points.filter(p => p.v !== null && p.v !== undefined).map(p => p.v);
  const vMin = Math.min.apply(null, vals), vMax = Math.max.apply(null, vals);
  const flat = vMax === vMin;
  const x = i => PAD + (times[i] - t0) / tSpan * (W - 2 * PAD);
  const y = v => flat ? H / 2 : (H - PAD) - (v - vMin) / (vMax - vMin) * (H - 2 * PAD);

  // Null values break the line into separate polylines instead of
  // interpolating across a missing data point.
  const segments = [];
  let cur = [];
  points.forEach((p, i) => {
    if (p.v === null || p.v === undefined) {
      if (cur.length) segments.push(cur);
      cur = [];
    } else {
      cur.push(x(i).toFixed(1) + ',' + y(p.v).toFixed(1));
    }
  });
  if (cur.length) segments.push(cur);

  let svg = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">';
  for (const seg of segments) {
    svg += '<polyline points="' + seg.join(' ') + '" fill="none" stroke="var(--accent)" stroke-width="2"/>';
  }
  if (flat) {
    svg += '<text x="' + (W - 2) + '" y="' + (H / 2 - 4) + '" font-size="10" fill="var(--dim)" text-anchor="end">' + esc(fmt(vMax)) + '</text>';
  } else {
    svg += '<text x="' + (W - 2) + '" y="10" font-size="10" fill="var(--dim)" text-anchor="end">' + esc(fmt(vMax)) + '</text>';
    svg += '<text x="' + (W - 2) + '" y="' + (H - 2) + '" font-size="10" fill="var(--dim)" text-anchor="end">' + esc(fmt(vMin)) + '</text>';
  }
  svg += '</svg>';
  const firstDate = new Date(points[0].t).toLocaleDateString();
  const lastDate = new Date(points[points.length - 1].t).toLocaleDateString();
  return '<div class="chart-svg-wrap">' + svg + '</div>' +
    '<div class="chart-dates"><span>' + esc(firstDate) + '</span><span>' + esc(lastDate) + '</span></div>';
}

function chartCard(m, entries) {
  const points = entries.map(e => ({ t: e.capturedAt, v: e[m.key] === undefined ? null : e[m.key] }));
  const nonNull = points.filter(p => p.v !== null && p.v !== undefined);
  if (!nonNull.length) return '';
  const latest = nonNull[nonNull.length - 1].v;
  const first = nonNull[0].v;
  const delta = latest - first;
  const deltaColor = delta > 0 ? 'var(--good)' : (delta < 0 ? 'var(--bad)' : 'var(--dim)');
  const deltaText = nonNull.length < 2 ? '' : (delta >= 0 ? '+' : '') + (Number.isInteger(delta) ? delta : delta.toFixed(1));
  const body = nonNull.length < 2
    ? '<div class="chart-single">' + esc(m.fmt(latest)) + '</div><div class="sub" style="margin:2px 0 0">need more snapshots for a trend</div>'
    : svgChart(points, m.fmt);
  return '<div class="chart-card"><div class="chart-head"><span class="chart-label">' + esc(m.label) + '</span>' +
    '<span class="chart-value">' + esc(m.fmt(latest)) + '</span>' +
    (deltaText ? '<span class="chart-delta" style="color:' + deltaColor + '">' + esc(deltaText) + '</span>' : '') +
    '</div>' + body + '</div>';
}

function renderHistory(entries) {
  if (!entries.length) return '<div class="empty-note">No snapshots yet &mdash; click "Analyze now" to capture the first one.</div>';
  let html = '<div class="charts">';
  for (const m of HISTORY_METRICS) html += chartCard(m, entries);
  html += '</div>';
  return html;
}

async function loadHistory() {
  const content = document.getElementById('content');
  if (!content) return;
  let entries;
  try {
    const r = await fetch('/api/history');
    const d = await r.json();
    entries = d.entries || [];
  } catch (e) {
    content.innerHTML = '<div class="empty-note">Failed to load history: ' + esc(e.message) + '</div>';
    return;
  }
  content.innerHTML = '<h2>History</h2>' + renderHistory(entries);
}

// Keyboard shortcuts: 1-9 then 0 switch tabs (maintabs button order, 0 = 10th
// tab), - selects the 11th tab, r = analyze. Disabled while focus is in an
// input/select/textarea (e.g. pet sim sliders).
document.addEventListener('keydown', function (e) {
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (e.key >= '1' && e.key <= '9') {
    const buttons = document.querySelectorAll('.maintabs button');
    const btn = buttons[Number(e.key) - 1];
    if (btn) btn.click();
  } else if (e.key === '0') {
    const buttons = document.querySelectorAll('.maintabs button');
    const btn = buttons[9];
    if (btn) btn.click();
  } else if (e.key === '-') {
    const buttons = document.querySelectorAll('.maintabs button');
    const btn = buttons[10];
    if (btn) btn.click();
  } else if (e.key === 'r' || e.key === 'R') {
    refresh();
  }
});

// Restore the remembered interval and checkbox before anything can use them.
(function initAuto() {
  const el = document.getElementById('autoMins');
  if (el) el.value = autoMins();
  const box = document.getElementById('auto');
  if (box) box.checked = autoOn();
})();

// Auto-refresh restored from a previous session starts once the last snapshot
// is on screen: its age counts towards the interval, so a page reload only
// analyzes immediately when one was already due.
loadLast().then(function (capturedAt) {
  if (!autoOn()) return;
  const every = autoMins() * 60000;
  const age = capturedAt === null ? Infinity : Date.now() - capturedAt;
  startAuto(age >= every ? 0 : every - age);
});
