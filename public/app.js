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
    : '<tr><td colspan="' + columns.length + '" style="color:var(--dim);font-style:italic">' + t('common.nothing_to_show') + '</td></tr>';
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

const RARITIES = ['normal', 'uncommon', 'rare', 'unique', 'epic', 'legendary'];
// The palette lives in style.css as --rarity-* (taken from the game's own
// stylesheet). Returning the variable rather than a literal keeps ONE source
// of truth -- this used to be a second, different hardcoded palette.
function dotColor(r) { return RARITIES.includes(r) ? 'var(--rarity-' + r + ')' : '#888'; }
function rarityBg(r) { return RARITIES.includes(r) ? 'var(--rarity-bg-' + r + ')' : 'var(--panel2)'; }
function rarityBorder(r) { return RARITIES.includes(r) ? 'var(--rarity-bd-' + r + ')' : 'var(--border)'; }

// ---- catalyst stat icons -------------------------------------------------
// public/icons.svg holds the game's own <symbol> for each catalyst stat,
// extracted from the local install by extract-icons.js. It is loaded once and
// injected into the page, so <use href="#id"> resolves same-document (an
// external-file reference does not work in every browser). Until it loads --
// and forever, if the file was never extracted -- catIcon falls back to the
// coloured dot, so the GUI never depends on game artwork being present.
window.__iconsReady = false;
function catIcon(stat, rarity, range, small) {
  const tile = 'background:' + rarityBg(rarity) + ';border:1px solid ' + rarityBorder(rarity);
  if (!window.__iconsReady || !window.__iconIds || !window.__iconIds.has('catalyst_' + stat)) {
    return '<span class="dot" style="background:' + dotColor(rarity) + '"></span>';
  }
  return '<span class="cat-tile' + (small ? ' sm' : '') + '" style="' + tile + '">' +
    '<svg aria-hidden="true"><use href="#catalyst_' + esc(stat) + '"></use></svg>' +
    (range === undefined || range === null ? '' : '<span class="rng">' + esc(range) + '</span>') +
    '</span>';
}
function loadIcons() {
  return fetch('/icons.svg').then(r => (r.ok ? r.text() : null)).then(svg => {
    if (!svg) return;
    const holder = document.createElement('div');
    holder.style.display = 'none';
    holder.innerHTML = svg;
    document.body.insertBefore(holder, document.body.firstChild);
    window.__iconIds = new Set(Array.from(holder.querySelectorAll('symbol')).map(n => n.id));
    window.__iconsReady = true;
    if (window.lastData) render(window.lastData);
  }).catch(() => {});
}
// Looked up per call, not frozen at load: the language can change after load.
// Anything the game invents that we do not know a label for falls back to the
// raw activity id, exactly as the old map did.
// Optional `slot`: on the two BOOST items the exploring profile is also what
// a Voyager expedition reads, and the game labels that tab "Exploring &
// Voyager" rather than "Exploring". Mirroring it here is the only place the
// GUI can tell you your dust catalysts are working on expeditions too.
const BOOST_SLOTS = ['laser_slot', 'probes_slot'];
function actLabel(a, slot) {
  const known = ['default', 'exploring', 'crafting', 'galaxyboss', 'dungeons', 'voyager'];
  if (a === 'exploring' && BOOST_SLOTS.includes(slot)) return t('act.exploring_voyager');
  return known.includes(a) ? t('act.' + a) : a;
}

const SHIP_SLOT_KEYS = ['weapon_slot', 'shield_slot', 'engine_slot',
  'sensors_slot', 'laser_slot', 'probes_slot'];
function shipSlotLabel(slot) { return SHIP_SLOT_KEYS.includes(slot) ? t('slot.' + slot) : slot; }

// ---- engine vocabulary -------------------------------------------------
// lib/ is language-free: it emits rarities, stat ids, NPC types, module types
// and tech skill keys as data and the GUI used to print them verbatim, which
// left English words on the Chinese page. These resolvers translate at the
// display site. Like actLabel above they look the key up PER CALL (the
// language can change after load) and fall back to the raw engine value, so
// a stat or module a game update adds still renders instead of a bare key.
// The English catalogue maps every one of these to its own raw value, which
// is what keeps the English page byte-identical.
function engLookup(prefix, value, fallback) {
  if (!value) return fallback !== undefined ? fallback : value;
  const key = prefix + value;
  const s = t(key);
  return s === key ? (fallback !== undefined ? fallback : value) : s;
}
function rarityLabel(r) { return engLookup('rarity.', r); }
function statLabel(s) { return engLookup('stat.', s); }
function statCatLabel(c) { return engLookup('statcat.', c); }
function npcLabel(n) { return engLookup('npc.', n); }
function gearSlotLabel(slot) { return engLookup('gearslot.', slot); }
function itemSkillLabel(s) { return engLookup('itemskill.', s); }
// Activity as the engine embeds it in a sentence: lower-case id, not the
// Title-Case tab label that actLabel returns.
function actIdLabel(a) { return engLookup('actid.', a); }
function moduleTypeLabel(ty) { return engLookup('moduletype.', ty); }
function bodyLabel(b) { return engLookup('body.', b); }
// Tech skills are keyed by the skill's own key. The engine renders the same
// skill three ways in English (short label, key-with-spaces, description) and
// none of them may change, so each rendering gets its own namespace.
function techNameLabel(key, raw) { return engLookup('techname.', key, raw); }
function techBoostLabel(key) { return engLookup('techboost.', key, String(key).replaceAll('_', ' ')); }
function techDescLabel(key, raw) { return engLookup('techskill.', key, raw); }
// Game proper nouns the engine carries as data. Same rules as above: looked
// up per call, keyed by the value exactly as the engine emits it, and any
// name the catalogue does not know (a material or module a patch adds, a
// named pet like Korin) renders as it arrives.
function materialLabel(m) { return engLookup('material.', m); }
// Base modules AND laboratory buildings: one vocabulary of built things.
// Only the printed name is translated - base-math.js keeps keying levels,
// prerequisites and the stored target boxes by the English name.
function moduleLabel(n) { return engLookup('module.', n); }
function petSlotLabel(s) { return engLookup('petslot.', s); }
function petBodyLabel(n) { return engLookup('petbody.', n); }
function modLabel(m) { return engLookup('mod.', m); }

// The engine composes a catalyst description in English ("uncommon
// gathering_yield 86% (halved)") and ships the structured fields next to it,
// so the GUI recomposes the sentence itself. Returns escaped HTML: the frame
// is ours, every piece of game data still goes through esc() exactly as the
// verbatim print did.
function catText(c) {
  if (!c || !c.rarity || !c.stat || c.range === null || c.range === undefined) {
    return esc(c && c.text ? c.text : '');
  }
  return t('cat.text', {
    rarity: esc(rarityLabel(c.rarity)),
    stat: esc(statLabel(c.stat)),
    range: esc(String(c.range)),
  }) + (c.halved ? t('cat.halved') : '');
}
// The freed list and the merge "pull this out first" note only carry the
// composed string, so parse it back into the same fields. Anything that does
// not parse (a stat shape the engine grows later) is printed as it arrives.
const CAT_TEXT_RE = /^(\w+) (\w+) (\d+(?:\.\d+)?)%( \(halved\))?$/;
function catTextFromString(s) {
  const m = CAT_TEXT_RE.exec(s == null ? '' : String(s));
  if (!m) return esc(s);
  return catText({ rarity: m[1], stat: m[2], range: m[3], halved: !!m[4] });
}
// Merge chain goal: "<rarity> <stat> <n>", optionally prefixed "perfect ".
const CHAIN_GOAL_RE = /^(perfect )?(\w+) (\w+) (\d+(?:\.\d+)?)$/;
function chainGoalText(g) {
  const m = CHAIN_GOAL_RE.exec(g == null ? '' : String(g));
  if (!m) return esc(g);
  return t(m[1] ? 'merges.chain_goal_perfect' : 'merges.chain_goal', {
    rarity: esc(rarityLabel(m[2])), stat: esc(statLabel(m[3])), n: m[4],
  });
}

// Item advisor: sortable table + recommendations list + cooldown/scan cards.
// d.shipItems: { items: [...], cooldown: {...}, scan: {...} } (lib/ship-items.js).
function renderShipItemAdvisor(si) {
  if (!si) return '<div class="empty-note">' + t('ship.no_data') + '</div>';
  let html = '';
  const cols = [
    { label: t('ship.col_slot'), numeric: false, getValue: it => it.slot,
      render: it => '<b>' + esc(shipSlotLabel(it.slot)) + '</b>' },
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
      html += '<div class="row"><b>' + esc(shipSlotLabel(it.slot)) + '</b><span>' + esc(r) + '</span></div>';
    }
  }
  if (!any) html += '<div class="empty-note">' + t('ship.no_recommendations') + '</div>';
  html += '</div>';

  const c = si.cooldown;
  html += '<h3 style="font-size:14px;color:var(--accent);margin:14px 0 8px">' + t('ship.engine_cooldown') + '</h3><div class="cards">';
  html += card(t('ship.total_reduction'), c.d + '%' + (c.componentBreakdown.globalBoost ? ' <span style="font-size:11px;color:var(--dim)">' + t('ship.wo_boost_pct', {n: c.dBase}) + '</span>' : ''));
  html += card(t('ship.engine_value'), (c.componentBreakdown.engineValue / 100).toFixed(2) + '% <span style="font-size:11px;color:var(--dim)">' + t('ship.value_raw', {n: c.componentBreakdown.engineValue}) + '</span>');
  html += card(t('ship.cooldown_mods'), '+' + c.componentBreakdown.mods + '%');
  html += card(t('ship.korin_equipped'), '+' + c.componentBreakdown.korin + '%');
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
      html += '<div class="item"><h3>' + esc(gearSlotLabel(it.slot)) + '</h3><div class="meta">' + t('gear.no_item_equipped') + '</div></div>';
      continue;
    }
    html += '<div class="item"><h3>' + esc(it.name) + '</h3>';
    html += '<div class="meta">' + esc(gearSlotLabel(it.slot)) + ' &middot; ' + esc(statCatLabel(it.category)) + ' &middot; ' + t('gear.lvl_n', {n: it.level}) + ' ' + esc(rarityLabel(it.rarity)) + '</div>';
    for (const g of it.groups) {
      const full = g.filled >= g.slots;
      const style = g.inherited ? ' style="opacity:0.55"' : '';
      html += '<div class="group"' + style + '><div class="group-head"><span>' + esc(actLabel(g.activity, it.slot)) + '</span>';
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
    html += '<div class="plan-group"><h3>' + t('installs.act_tab', {name: esc(actLabel(act))}) + '</h3><div class="list">';
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
          html += t('installs.install') + ' ';
        } else {
          html += t('installs.replace_with', {old: '<span style="color:var(--dim)">' + catText(a.remove) + '</span>'}) + ' ';
        }
        html += '<span style="color:' + dotColor(a.add.rarity) + ';font-weight:600">' + catText(a.add) + '</span>';
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
    html += '<div class="card"><div class="k">' + esc(npcLabel(npc)) + '</div><div class="v">' +
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
    html += '<div class="row"><b>' + esc(o.item) + '</b> &mdash; ' +
      t('gear.override_loss', {act: esc(actLabel(o.activity)), cur: esc(o.currentText), inh: esc(o.inheritedText)}) +
      ' &mdash; <span style="color:var(--bad)">' + t('gear.losing', {v: esc(o.lostText)}) + '</span>' +
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
  if (!plans.length) return '<div class="empty-note">' + t('merges.none_possible') + '</div>';
  let html = '<div class="sub">' + t('merges.craft_header', {lvl: player.craftLevel, bonus: player.rangeBonus, success: player.successBonus.toFixed(1)}) + '</div>';
  if (reqs && reqs.length) {
    html += '<div class="sub">' + t('merges.tier_reqs', {list:
      reqs.map(m => t('merges.tier_req_item', {rarity: esc(rarityLabel(m.rarity)), n: m.resultNeeded})).join(' &middot; ')}) + '</div>';
  }
  for (const p of plans) {
    html += '<div class="merge-plan"><h3>' + esc(statLabel(p.stat)) + ' <span style="color:var(--dim)">(' + esc(actLabel(p.activity)) + ')</span>' +
      (p.chainGoal ? ' &mdash; ' + t('merges.goal', {goal: '<span style="color:var(--warn)">&rarr; ' + chainGoalText(p.chainGoal) + '</span>'}) : '') + '</h3>';
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
          '<span class="res' + (perfect ? ' perfect' : '') + '">' + esc(rarityLabel(step.to)) + ' ' + g.result + (perfect ? t('merges.perfect') : '') + '</span>';
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
  html += card(t('units.credits'), fmtC(u.credits));
  const priceNote = g => ' <span style="font-size:11px;color:var(--dim)">' + t('units.next_price', { c: fmtC(g.nextPrice) }) +
    (g.priceSource === 'extrapolated' ? ' <span title="' + t('units.curve_title') + '">' + t('units.curve') + '</span>' : '') + '</span>';
  html += card(t('units.droids'), u.droids.count + priceNote(u.droids));
  html += card(t('units.clones'), u.clones.count + priceNote(u.clones));
  html += '</div>';

  // --- droid survival ---
  const sv = u.droids.survival;
  if (sv && sv.count) {
    const bd = sv.perDroid[0].breakdown;
    const uneven = sv.perDroid.some(d => d.dodge !== sv.perDroid[0].dodge);
    const tone = capTone(sv.avgDodge, 100);
    html += '<h2>' + t('units.h_droid_survival') + '</h2>';
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
  if (u.clones.nextPrice !== null && cd.perPctUpgradeCost && cd.perPctBuyCost) {
    const ratio = cd.perPctBuyCost / cd.perPctUpgradeCost;
    html += '<div class="row"><span class="num">1</span><span>' + t('units.rec_clones', {
      upg: fmtC(cd.perPctUpgradeCost), n: u.clones.count + 1, buy: fmtC(cd.perPctBuyCost), ratio: ratio.toFixed(1)
    }) + '</span></div>';
    if (u.clones.damageBreakEvenLevel !== null) {
      html += '<div class="row"><span class="num">2</span><span>' + t('units.rec_break_even', {
        lvl: u.clones.damageBreakEvenLevel, at: u.clones.rows[0].level,
        extra: u.clones.nextPrice > u.credits ? t('units.rec_break_even_cost', { n: u.clones.count + 1, c: fmtC(u.clones.nextPrice) }) : ''
      }) + '</span></div>';
    }
  }
  if (u.droids.nextPrice !== null && u.droids.breakEvenLevel !== null) {
    html += '<div class="row"><span class="num">3</span><span>' + t('units.rec_droids', {
      lvl: u.droids.breakEvenLevel, at: u.droids.rows[0].level, n: u.droids.count + 1,
      price: fmtC(u.droids.nextPrice), catchup: fmtC(u.droids.catchUpCost)
    }) + '</span></div>';
  }
  if (u.droids.bestSkill && u.droids.rows.length) {
    const rows = u.droids.rows.filter(r => r.creditsPerPctYield !== null).sort((a, b) => a.creditsPerPctYield - b.creditsPerPctYield);
    const capped = u.droids.rows.filter(r => r.creditsPerPctYield === null);
    html += '<div class="row"><span class="num">4</span><span>' + t('units.rec_skill_order', {
      list: rows.map((r, i) => (i === 0 ? '<b>' : '') + esc(skillLabel(r.skill)) + (i === 0 ? '</b>' : '') +
        ' (' + t('units.per_pct_yield', { c: fmtC(r.creditsPerPctYield) }) + ')').join(t('units.then_sep')),
      capped: capped.length
        ? t('units.rec_skill_capped', {
          names: capped.map(r => esc(skillLabel(r.skill))).join(t('units.list_sep')),
          n: (u.droids.survival ? u.droids.survival.noModsCap : 100)
        })
        : t('units.rec_skill_uncapped')
    }) + '</span></div>';
  }
  html += '</div>';

  // --- clone damage impact ---
  html += '<h2>' + t('units.h_clone_damage') + '</h2><div class="cards">';
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
  html += '<h2>' + t('units.h_clone_skills', { n: u.clones.count }) + '</h2><div class="sub">' + t('units.clone_skills_note') + '</div>';
  html += tableHtml('tbl-clone-skills', u.clones.rows, unitSkillColumns(true, false));
  html += unitEmuSection('clones');
  html += '<h2>' + t('units.h_droid_skills', { n: u.droids.count }) + '</h2><div class="sub">' + t('units.droid_skills_note') + '</div>';
  html += tableHtml('tbl-droid-skills', u.droids.rows, unitSkillColumns(false, true));
  html += unitEmuSection('droids');

  // --- unit lists ---
  const list = (title, units, skills) => {
    let t = '<h2>' + title + '</h2><div class="list">';
    for (const un of units) {
      t += '<div class="row"><span style="min-width:110px"><b>' + esc(un.name) + '</b></span>';
      for (const s of skills) t += '<span>' + esc(skillLabel(s)) + ' <b>' + un[s] + '%</b></span>';
      t += '</div>';
    }
    return t + '</div>';
  };
  html += list(t('units.your_clones'), u.clones.list, ['critical_chance', 'critical_damage', 'dual_shot']);
  html += list(t('units.your_droids'), u.droids.list, ['efficiency', 'storage', 'maneuverability']);
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
// still falls back to the raw kind, exactly as before.
function unitGroupWord(kind, form) {
  const w = UNIT_GROUP_LABEL[kind];
  return w ? t('units.group_' + w + (form ? '_' + form : '')) : kind;
}
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
  if (!UM || !units.length) return '<div class="empty-note">' + t('units.emu_none', { kind: unitGroupWord(kind, 'many') }) + '</div>';
  const skills = UNIT_GROUP_SKILLS[kind];
  const credits = u.credits || 0;
  const targets = {};
  skills.forEach(s => { targets[s] = unitEmuTarget(kind, s, units); });
  const emu = UM.emulateGroup(units, skills, targets, credits);
  const label = unitGroupWord(kind);

  // --- headline: what the whole plan costs against the credit pile ---
  let html = '<div class="cards">';
  html += card(t('units.emu_all_card', { n: units.length, kind: unitGroupWord(kind, 'many') }),
    '<span title="' + t('units.n_credits', { n: fmtN(emu.total) }) + '">' + fmtC(emu.total) + '</span>');
  html += card(t('units.credits'), fmtC(credits));
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
    { label: label, numeric: false, getValue: r => r.name, render: r => '<b>' + esc(r.name) + '</b>' },
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
  return '<h2>' + t('units.emu_title', { label: label }) + '</h2>' +
    '<div class="sub">' + t('units.emu_note') + '</div>' +
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
  if (gap <= 0) { out.textContent = t('qc.done'); return; }
  if (perDay <= 0) { out.textContent = t('qc.never'); return; }
  const days = gap / perDay;
  out.textContent = days >= 2 ? t('qc.dur_dh', { d: Math.floor(days), h: Math.round((days % 1) * 24) }) : Math.round(days * 24) + t('common.hours');
}

// NOTE: the parameter shadows the global t() helper, so this function reaches
// the catalogue through I18n.t instead. Renaming the parameter would be a
// refactor; this keeps the change to string externalisation only.
function renderTech(t) {
  let html = '';
  html += '<h2>' + I18n.t('tech.title') + '</h2>';
  html += '<div class="sub">' + I18n.t('tech.cost_note') + '</div>';
  html += '<div class="cards">';
  html += card(I18n.t('tech.card_quantum_cores'), t.quantumCores.toLocaleString());
  if (t.battle) html += card(I18n.t('tech.card_avg_npc_level'), t.battle.baselineAvg);
  if (t.maxOut) {
    html += card(I18n.t('tech.card_qc_to_max_all'), fmtC(t.maxOut.coresToMaxAll) + ' <span style="font-size:11px;color:var(--dim)">' + I18n.t('tech.maxed_of', { n: t.maxOut.maxedCount, total: t.maxOut.unlockedCount }) + '</span>');
    html += card(I18n.t('tech.card_gap_after_stock'), fmtC(t.maxOut.coresGap));
    html += '<div class="card"><div class="k">' + I18n.t('tech.time_to_cover_gap') + '</div><div class="v" id="qcGapTime">&mdash;</div>' +
      '<div style="font-size:11px;color:var(--dim);margin-top:4px">' +
      '<input type="number" id="qcRate" value="18" min="0" style="width:44px" onchange="calcQcGap()" oninput="calcQcGap()"> ' + I18n.t('tech.per_hour') + ' + ' +
      '<input type="number" id="qcDaily" value="150" min="0" style="width:52px" onchange="calcQcGap()" oninput="calcQcGap()"> ' + I18n.t('common.per_day') + '</div></div>';
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
      { label: I18n.t('tech.col_skill'), numeric: false, getValue: r => r.key, render: r => '<b>' + esc(techBoostLabel(r.key)) + '</b>' },
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
      html += '<div class="row"><span><b>' + esc(techBoostLabel(a.key)) + '</b>: ' + a.from + ' &rarr; ' + a.to + '</span><span class="gain">' + I18n.t('tech.qc_amount', { n: a.cost }) + '</span></div>';
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
  }

  html += '<h2>' + I18n.t('tech.all_skills') + '</h2>';
  const skillCols = [
    { label: I18n.t('tech.col_skill'), numeric: false, getValue: s => s.label, render: s => '<b>' + esc(techNameLabel(s.key, s.label)) + '</b>' },
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

function fmtH(h) {
  if (h === null || h === undefined) return '-';
  if (h === Infinity) return t('pets.never');
  if (h < 48) return h + t('common.hours');
  return t('pets.dur_dh', { d: Math.floor(h / 24), h: h % 24 });
}

function renderPets(p) {
  let html = '';
  html += '<h2>' + t('pets.title') + '</h2>';
  html += '<div class="sub">' + t('pets.xp_formula') + '</div>';
  html += '<div class="cards">';
  html += card(t('pets.card_xp_tech'), p.techSkill + (p.techSkill >= 100 ? ' <span class="badge b-ok">' + t('pets.badge_max') + '</span>' : ''));
  html += card(t('pets.card_premium'), p.premiumActive ? t('pets.premium_active') + ' <span style="font-size:11px;color:var(--dim)">' + t('pets.premium_bonus') + '</span>' : t('pets.premium_inactive'));
  html += card(t('pets.card_food_stock'), p.petFood.toLocaleString() + ' <span style="font-size:11px;color:var(--dim)">' + t('pets.food_burn', { n: p.petFoodPerDay, days: p.petFoodDays !== null ? t('pets.days_short', { n: p.petFoodDays }) : '-' }) + '</span>');
  html += card(t('pets.card_equipped'), p.pets.filter(function (x) { return x.equipped; }).length + ' / ' + p.pets.length);
  html += '</div>';

  if (p.korin) html += renderKorin(p.korin);

  html += '<h2>' + t('pets.all_pets') + '</h2>';
  const petCols = [
    { label: t('pets.col_pet'), numeric: false, getValue: pet => pet.name, render: pet => '<b>' + esc(petBodyLabel(pet.name)) + '</b>' },
    { label: t('pets.col_slot'), numeric: false, getValue: pet => pet.equipped ? pet.slotType : '~unequipped',
      render: pet => pet.equipped ? esc(petSlotLabel(pet.slotType)) : '<span class="badge b-empty">' + t('pets.badge_unequipped') + '</span>' },
    { label: t('pets.col_lvl'), numeric: true, getValue: pet => pet.level, render: pet => pet.level },
    { label: t('pets.col_xp'), numeric: true, getValue: pet => pet.currentXp, render: pet => pet.currentXp + '/' + pet.targetXp },
    { label: t('pets.col_boost'), numeric: true, getValue: pet => pet.boost, render: pet => pet.boost },
    { label: t('pets.col_food'), numeric: true, getValue: pet => pet.food, render: pet => pet.food + '%' + (pet.equipped ? ' <span style="color:var(--dim)">' + t('pets.avg_food', { n: pet.avgFood }) + '</span>' : '') },
    { label: t('pets.col_xp_per_hour'), numeric: true, getValue: pet => pet.equipped ? pet.xpPerHourNow : -1,
      render: pet => pet.equipped ? '<b>' + pet.xpPerHourNow + '</b>' : '-' },
    { label: t('pets.col_next_lvl'), numeric: true, getValue: pet => pet.equipped ? (pet.hoursToLevel === Infinity ? 1e15 : pet.hoursToLevel) : 1e16,
      render: pet => pet.equipped ? '<b style="color:var(--good)">' + fmtH(pet.hoursToLevel) + '</b>' : '-' },
    { label: t('pets.col_plus_one_boost'), numeric: true, getValue: pet => pet.equipped ? (pet.hoursSavedPlusOne || 0) : -1,
      render: pet => pet.equipped ? (fmtH(pet.hoursToLevelPlusOne) + ' (' + (pet.hoursSavedPlusOne !== null ? '-' + pet.hoursSavedPlusOne + t('common.hours') : '-') + ')') : '-' },
    { label: t('pets.col_boost_cost'), numeric: true, getValue: pet => pet.costNextBoost,
      render: pet => fmtC(pet.costNextBoost) + ' &times;16' + (pet.affordableBoost ? ' <span class="badge b-ok">' + t('pets.badge_affordable') + '</span>' : ' <span class="badge b-warn">' + t('pets.badge_short', { n: fmtC(pet.costNextBoost - pet.minResource) }) + '</span>') },
  ];
  html += tableHtml('tbl-all-pets', p.pets, petCols);

  html += '<h2>' + t('sim.title') + '</h2>';
  html += '<div class="sub">' + t('sim.note') + '</div>';
  const eq = p.pets.filter(function (x) { return x.equipped; });
  html += '<div class="list">';
  html += '<div class="row"><span style="min-width:90px"><b>' + t('sim.pet') + '</b></span><select id="petSelect" onchange="simPet()" class="pet-input">';
  for (const pet of eq) html += '<option value="' + esc(pet.id) + '">' + t('sim.pet_option', { name: esc(petBodyLabel(pet.name)), boost: pet.boost, food: pet.food }) + '</option>';
  html += '</select></div>';
  html += '<div class="row"><span style="min-width:90px"><b>' + t('sim.boost') + '</b></span><input type="range" id="petBoost" min="0" max="45" value="0" oninput="simPet()" style="width:260px"> <span id="petBoostVal" style="min-width:110px;display:inline-block"></span></div>';
  html += '<div class="row"><span style="min-width:90px"><b>' + t('sim.autofeed') + '</b></span><input type="range" id="petFeed" min="50" max="100" step="5" value="50" oninput="simPet()" style="width:260px"> <span id="petFeedVal" style="min-width:110px;display:inline-block"></span></div>';
  html += '</div>';
  html += '<div id="petSimOut" class="list" style="margin-top:10px"></div>';
  return html;
}

// Korin (pet_type 'generator'): converts normal warp capsules into enhanced
// warp capsules. See lib/pets.js for the underlying formulas.
function renderKorin(k) {
  const dustLimited = k.dustCostPerCapsule > 0 ? Math.floor(k.dust / k.dustCostPerCapsule) : 0;
  const limitedBy = k.capsules <= dustLimited ? t('korin.limited_capsule_stock') : t('korin.limited_dust');
  let html = '<h2>' + t('korin.title') + '</h2>';
  html += '<div class="cards">';
  html += card(t('korin.card_level'), k.level);
  html += card(t('korin.card_cost_per_capsule'), fmtC(k.dustCostPerCapsule) + ' <span style="font-size:11px;color:var(--dim)">' + t('korin.dust') + '</span>');
  html += card(t('korin.card_capsule_stock'), k.capsules.toLocaleString() +
    ' <span style="font-size:11px;color:var(--dim)">' + t('korin.stock_split', { n: k.enhancedCapsules.toLocaleString() }) + '</span>');
  html += card(t('korin.card_affordable_now'), k.affordableNow.toLocaleString() +
    ' <span style="font-size:11px;color:var(--dim)">' + t('korin.limited_by', { what: limitedBy }) + '</span>');
  html += card(t('korin.card_fuel_per_enhanced'), (k.fuelPerEnhanced !== null ? k.fuelPerEnhanced.toLocaleString() : '?') +
    ' ' + t('korin.fuel') + ' <span style="font-size:11px;color:var(--dim)">' + t('korin.fuel_multiplier', { x: k.fuelMultiplier.toFixed(1) }) + '</span>');
  html += card(t('korin.card_engine_cooldown'), '&minus;' + k.cooldownReductionPct + '%');
  html += '</div>';
  html += '<div class="sub">' + t('korin.next_level', { cost: fmtC(k.nextLevel.dustCostPerCapsule), mult: k.nextLevel.fuelMultiplier.toFixed(1) }) + '</div>';
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
  document.getElementById('petBoostVal').textContent = boost + (boost === pet.boost ? ' ' + t('sim.current') : ' (+' + (boost - pet.boost) + ')');
  document.getElementById('petFeedVal').textContent = limit + '%' + (limit === pet.autofeedLimit ? ' ' + t('sim.current') : '');

  if (!pet.equipped) {
    out.innerHTML = '<div class="row">' + t('sim.not_equipped', { name: esc(petBodyLabel(pet.name)) }) + '</div>';
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
  html += '<div class="row"><span>' + t('sim.level_line', { name: esc(petBodyLabel(pet.name)), from: pet.level, to: pet.level + 1 }) + '</span>';
  html += '<span>' + t('sim.xp_now', { food: pet.food }) + ' <b>' + PetMath.petXpPerHour(pet.level, boost, pet.food, p.techSkill, p.premiumActive) + '</b></span>';
  html += '<span>' + t('sim.avg_food') + ' <b>' + ((100 + limit) / 2) + '%</b></span>';
  html += '<span>' + t('sim.time_to_next') + ' <b style="color:var(--good)">' + fmtH(hours) + '</b>' + (saved !== null && saved !== 0 ? ' <span class="gain">' + (saved > 0 ? '-' + fmtH(saved) : '+' + fmtH(-saved)) + ' ' + t('sim.vs_current') + '</span>' : '') + '</span></div>';

  html += '<div class="row"><span>' + t('sim.boost_cost') + ' <b>' + (cost > 0 ? t('sim.of_each_resource', { n: fmtC(cost), total: entries.length }) : '-') + '</b>';
  if (cost > 0) {
    if (!short.length) html += ' <span class="badge b-ok">' + t('sim.affordable_all', { total: entries.length }) + '</span>';
    else html += ' <span class="badge b-warn">' + t('sim.resources_short', { n: short.length, total: entries.length }) + '</span> <span style="color:var(--dim)">' + short.map(function (e) { return t('sim.short_item', { name: materialLabel(e[0]), have: fmtC(e[1]), need: fmtC(cost - e[1]) }); }).join(', ') + '</span>';
  }
  html += '</div>';

  html += '<div class="row"><span>' + t('sim.pet_food') + ' <b>' + t('sim.pets_burn', { n: count, rate: perDay.toFixed(1) }) + '</b>' + (p.petFoodPerDay !== undefined && Math.abs(perDay - p.petFoodPerDay) > 0.05 ? ' <span style="color:var(--dim)">' + t('sim.currently_per_day', { rate: p.petFoodPerDay.toFixed(1) }) + '</span>' : '') + '</span>';
  html += '<span style="color:var(--dim)">' + t('sim.stocked', { n: p.petFood.toLocaleString(), days: days === Infinity ? t('sim.no_consumption') : Math.floor(days) + ' ' + t('common.days') }) + '</span></div>';
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
  if (it.locked) return '<span class="badge b-empty">' + t('inv.badge_locked') + '</span>';
  if (it.onMarket) return '<span class="badge b-empty">' + t('inv.badge_market') + '</span>';
  if (it.plannedUse === 'install') return '<span class="badge b-ok">' + t('inv.badge_install') + '</span>';
  if (it.plannedUse === 'merge') return '<span class="badge b-warn">' + t('inv.badge_merge') + '</span>';
  return '<span class="badge b-empty">-</span>';
}

function renderInventory(inv) {
  const f = window.invFilter = window.invFilter || { text: '', rarity: 'all', activity: 'all', sellOnly: false };
  let html = '<div class="cards">';
  html += card(t('common.total'), inv.counts.total);
  html += card(t('inv.card_planned_installs'), inv.counts.planned);
  html += card(t('inv.card_merge_fodder'), inv.counts.mergeFodder);
  html += card(t('inv.card_sell_candidates'), inv.counts.sellCandidates);
  html += '</div>';

  html += '<div class="toolbar" style="margin-bottom:10px">';
  html += '<input type="text" placeholder="' + t('inv.filter_placeholder') + '" value="' + esc(f.text) +
    '" onchange="setInvFilter(&quot;text&quot;, this.value)" style="padding:7px 10px;border-radius:8px;' +
    'border:1px solid var(--border);background:var(--panel2);color:var(--text);font-size:13px">';
  html += '<select class="pet-input" onchange="setInvFilter(&quot;rarity&quot;, this.value)">';
  html += '<option value="all"' + (f.rarity === 'all' ? ' selected' : '') + '>' + t('inv.all_rarities') + '</option>';
  INV_RARITIES.forEach(r => {
    html += '<option value="' + r + '"' + (f.rarity === r ? ' selected' : '') + '>' + esc(rarityLabel(r)) + '</option>';
  });
  html += '</select>';
  html += '<select class="pet-input" onchange="setInvFilter(&quot;activity&quot;, this.value)">';
  html += '<option value="all"' + (f.activity === 'all' ? ' selected' : '') + '>' + t('inv.all_activities') + '</option>';
  INV_ACTIVITIES.forEach(a => {
    html += '<option value="' + a + '"' + (f.activity === a ? ' selected' : '') + '>' + esc(actLabel(a)) + '</option>';
  });
  html += '</select>';
  html += '<label style="color:var(--dim);font-size:12px"><input type="checkbox" ' +
    (f.sellOnly ? 'checked' : '') + ' onchange="setInvFilter(&quot;sellOnly&quot;, this.checked)"> ' + t('inv.sell_candidates_only') + '</label>';
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
    { label: t('inv.col_stat'), numeric: false, getValue: it => it.stat,
      render: it => '<span class="inv-stat">' + catIcon(it.stat, it.rarity, it.range) +
        '<b>' + esc(statLabel(it.stat).replaceAll('_', ' ')) + '</b></span>' },
    { label: t('inv.col_rarity'), numeric: false, getValue: it => it.rarity,
      render: it => '<span style="color:' + dotColor(it.rarity) + ';font-weight:600">' +
        esc(rarityLabel(it.rarity)) + '</span>' },
    { label: t('inv.col_range'), numeric: true, getValue: it => it.range, render: it => it.range + '%' },
    { label: t('inv.col_activity'), numeric: false, getValue: it => it.activity, render: it => esc(actLabel(it.activity)) },
    { label: t('inv.col_category'), numeric: false, getValue: it => it.category, render: it => esc(statCatLabel(it.category)) },
    { label: t('inv.col_value'), numeric: true, getValue: it => it.value, render: it => it.value.toFixed(2) },
    { label: t('inv.col_use'), numeric: false, getValue: it => it.plannedUse || (it.locked ? 'locked' : (it.onMarket ? 'market' : '')),
      render: it => invUseBadge(it) },
    { label: t('inv.col_sell'), numeric: false, getValue: it => it.sellCandidate ? 1 : 0,
      render: it => it.sellCandidate ? '<span class="badge b-warn" title="' + esc(it.sellReason) + '">' + t('inv.badge_sell') + '</span>' : '' },
  ];
  html += tableHtml('tbl-inventory', items, cols);
  return html;
}

// ---- Materials tab: blueprint material requirements vs stock ----
function materialCols(showFarm) {
  const cols = [
    { label: t('mat.col_material'), numeric: false, getValue: r => r.material, render: r => '<b>' + esc(materialLabel(r.material)) + '</b>' },
    { label: t('mat.col_stock'), numeric: true, getValue: r => r.stock, render: r => r.stock.toLocaleString() },
    { label: t('mat.col_need_per_craft'), numeric: true, getValue: r => r.neededPerCraftAll, render: r => r.neededPerCraftAll.toLocaleString() },
    { label: t('mat.col_need_all_uses'), numeric: true, getValue: r => r.neededAllUses, render: r => r.neededAllUses.toLocaleString() },
    { label: t('mat.col_deficit'), numeric: true, getValue: r => r.deficit,
      render: r => r.deficit > 0 ? '<b style="color:var(--bad)">' + r.deficit.toLocaleString() + '</b>' : '0' },
  ];
  if (showFarm) {
    cols.push({ label: t('mat.col_farm'), numeric: false, getValue: r => r.npc || '',
      render: r => r.npc ? (esc(npcLabel(r.npc)) + ' (' + esc(bodyLabel(r.location)) + ')') : '-' });
  }
  return cols;
}

function renderMaterials(m) {
  let html = '';
  html += '<div class="cards">';
  html += card(t('mat.card_materials_in_deficit'), m.totals.deficitCount);
  html += card(t('mat.card_scraps_needed'), fmtC(m.totals.scrapsNeededAllUses));
  html += card(t('mat.card_blueprints_included'), m.totals.blueprintsIncluded);
  html += '</div>';

  html += '<h2>' + t('mat.npc_drops_title') + '</h2>';
  html += '<div class="sub">' + t('mat.npc_drops_note') + '</div>';
  html += tableHtml('tbl-mat-npc', m.npcDrops, materialCols(true));

  html += '<h2>' + t('mat.lab_title') + '</h2>';
  html += '<div class="sub">' + t('mat.lab_note') + '</div>';
  html += tableHtml('tbl-mat-lab', m.labMaterials, materialCols(false));

  html += '<h2>' + t('mat.other_title') + '</h2>';
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
  if (h < 1 / 60) return t('lab.time_lt_1_min');
  if (h < 1) return t('lab.time_min', { n: Math.round(h * 60) });
  if (h < 48) return t('lab.time_h', { n: h.toFixed(1) });
  return t('lab.time_d', { n: (h / 24).toFixed(1) });
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
    return '<div class="empty-note">' + t('lab.empty') + '</div>';
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

  let html = '<div class="sub">' + t('lab.intro') + '</div>';

  // --- cards ---
  html += '<div class="cards">';
  html += card(t('lab.card_capsule_target'), '<input class="pet-input lab-input" type="number" min="1" value="' + capsules + '" onchange="setLabCapsules(this.value)"> ' + t('lab.capsules_in_stock', { n: fmtC(lab.capsulesInStock || 0) }));
  html += card(t('lab.card_chain_time'), fmtHours(plan.hoursPipelined) +
    '<span style="font-size:11px;color:var(--dim)">' + t('lab.chain_time_note', { n: fmtHours(plan.hoursSequential) }) + '</span>');
  if (plan.binding) {
    html += card(t('lab.card_binding'), '<span style="color:var(--bad)">' + esc(materialLabel(plan.binding.name)) + '</span> ' + covBar(plan.binding.coverage) +
      '<span style="font-size:11px;color:var(--dim)">' + t('lab.pct_covered', { n: (plan.binding.coverage * 100).toFixed(0) }) + '</span>');
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

  // --- raw currencies ---
  html += '<h2>' + t('lab.raw_resources') + '</h2>';
  html += tableHtml('tbl-lab-raw', plan.raw, [
    { label: t('lab.col_resource'), numeric: false, getValue: r => r.name, render: r => '<b>' + esc(materialLabel(r.name)) + '</b>' },
    { label: t('lab.col_needed'), numeric: true, getValue: r => r.needed, render: r => fmtC(r.needed) },
    { label: t('lab.col_stock'), numeric: true, getValue: r => r.stock, render: r => fmtC(r.stock) },
    { label: t('lab.col_coverage'), numeric: true, getValue: r => r.coverage, render: r => covBar(r.coverage) + (r.coverage * 100).toFixed(0) + '%' },
    { label: t('lab.col_capsules_supported'), numeric: true, getValue: r => r.unitsSupported, render: r => String(r.unitsSupported) },
  ]);

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

  // --- base founding ---
  html += '<h2>' + t('lab.h_base_founding') + '</h2><div class="cards">';
  const bundleRows = lab.foundingBundle.map(b => ({ name: b.product, need: b.units, have: lab.stocks[b.product] || 0 }));
  const shortRows = bundleRows.filter(b => b.have < b.need);
  html += card(t('lab.card_bundle'), shortRows.length ? '<span style="color:var(--warn)">' + t('lab.ready_count', { have: bundleRows.length - shortRows.length, total: bundleRows.length }) + '</span>' : '<span style="color:var(--good)">' + t('lab.ready_count', { have: 5, total: 5 }) + '</span>');
  html += card(t('lab.card_founding_time'), founding.ready ? t('lab.ready') : fmtHours(founding.hoursPipelined));
  html += card(t('lab.card_after_founding'), fmtHours(after.hoursPipelined) + (after.binding ? '<span style="font-size:11px;color:var(--bad)">' + t('lab.binding_note', { name: esc(materialLabel(after.binding.name)) }) + '</span>' : ''));
  html += '</div>';
  if (shortRows.length) {
    html += '<div class="list">' + shortRows.map(b => '<div class="row"><span><b>' + esc(materialLabel(b.name)) + '</b> ' + fmtC(b.have) + ' / ' + fmtC(b.need) + '</span></div>').join('') + '</div>';
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
  if (d < 1) return t('base.time_h', { n: Math.round(d * 24) });
  return t('base.time_d', { n: d.toFixed(1) });
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
  if (!b) return '<div class="empty-note">' + t('base.empty') + '</div>';
  const BM = window.BaseMath;
  const { plan, starName, rate } = basePlanFor(b);
  setTabCount('base', plan.stockpile.filter(s => s.short > 0).length, true);
  let html = '';
  html += '<div class="sub">' + t('base.formulas_from', { bundle: esc(b.provenance.bundle), patch: esc(String(b.provenance.live || b.provenance.client)) }) +
    (b.provenance.drift ? ' <span class="drift">' + t('base.drift', { bundle: esc(String(b.provenance.liveBundle)) }) + '</span>' : '') +
    t('base.income_note') + '</div>';

  // --- cards ---
  html += '<div class="cards">';
  html += card(t('base.card_phase'), b.phase === 'live' ? '<span style="color:var(--good)">' + t('base.phase_live') + '</span>' : t('base.phase_pre'));
  const readyCount = b.founding.bundle.filter(x => x.have >= x.units).length;
  html += card(t('base.card_founding_materials'), (readyCount === b.founding.bundle.length ? '<span style="color:var(--good)">' : '<span style="color:var(--warn)">') + readyCount + ' / ' + b.founding.bundle.length + '</span>');
  const stars = [b.location.current].concat(b.location.bookmarks).filter(s => s.star);
  const seen = {}; const options = [];
  for (const s of stars) { if (seen[s.star]) continue; seen[s.star] = true; options.push(s); }
  html += card(t('base.card_star'), '<select class="pet-input" onchange="setBaseStar(this.value)">' +
    options.map(s => '<option value="' + esc(s.star) + '"' + (s.star === starName ? ' selected' : '') + '>' + esc(s.star) + t('base.star_option_rate', { n: s.rate }) + (s.name ? ' &middot; ' + esc(s.name) : '') + '</option>').join('') +
    '</select>' + (b.location.best && b.location.best.rate > rate ? '<span class="est">' + t('base.best_known', { star: esc(b.location.best.star), rate: b.location.best.rate }) + (b.location.best.name ? t('base.best_known_at', { name: esc(b.location.best.name) }) : '') + '</span>' : ''));
  // Two formulas disagree by the star rate; show the range rather than pick a
  // side the client cannot settle. See ESTIMATES in public/base-math.js.
  html += card(t('base.card_stellarium_day'),
    plan.stellariumPerDay.toFixed(1) +
    (plan.stellariumPerDayClient && plan.stellariumPerDayClient < plan.stellariumPerDay
      ? ' <span style="color:var(--warn)">&ndash; ' + plan.stellariumPerDayClient.toFixed(1) + '?</span>' : '') +
    '<span class="est">' + t('base.stellarium_est', { days: fmtDays(plan.daysToAllUnlocks) }) +
    (plan.daysToAllUnlocksClient && plan.daysToAllUnlocksClient > plan.daysToAllUnlocks
      ? ' &ndash; ' + fmtDays(plan.daysToAllUnlocksClient) : '') +
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
  if (b.live && plan.upkeepNow) {
    html += card(t('base.card_upkeep_now'), fmtC(plan.upkeepNow.perDay) + basis(plan.upkeepNow, true));
  }
  html += card(t('base.card_upkeep_targets'), fmtC(up.perDay) + basis(up, false));
  html += '</div>';
  if (inc) {
    const wallet = window.lastData && window.lastData.units ? window.lastData.units.credits : 0;
    let note = t('base.upkeep_basis', { counter: fmtC(inc.lifetimeCredits), wallet: fmtC(wallet) });
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
  if (plan.stellariumPerDayClient && plan.stellariumPerDayClient < plan.stellariumPerDay) {
    html += '<div class="sub">' + t('base.contested', {
      advisor: plan.stellariumPerDay.toFixed(1),
      client: plan.stellariumPerDayClient.toFixed(1),
      days: fmtDays(plan.daysToAllUnlocks),
      daysClient: fmtDays(plan.daysToAllUnlocksClient),
    }) + '</div>';
  }
  if (up.questsKnown === false) html += '<div class="sub">' + t('base.quests_hint') + '</div>';
  if (b.labPanelHint) html += '<div class="sub">' + t('base.lab_panel_hint') + '</div>';
  if (b.location.bodies.length) html += '<div class="sub">' + t('base.body_xp', { list: b.location.bodies.map(x => esc(bodyLabel(x.type)) + (x.activity ? ' &rarr; ' + esc(itemSkillLabel(x.activity)) : '')).join(', ') }) + '</div>';

  // --- live block ---
  if (b.live) {
    html += '<h2>' + t('base.h_base', { name: esc(b.live.name) }) + '</h2><div class="cards">';
    html += card(t('base.card_stellarium_held'), String(b.live.stellarium));
    if (b.live.nextUnlock) html += card(t('base.card_next_unlock'), esc(moduleLabel(b.live.nextUnlock.name)) + '<span class="est">' + t('base.next_unlock_note', { cost: b.live.nextUnlock.cost, eta: b.live.nextUnlock.etaDays === 0 ? t('base.affordable_now') : t('base.eta_in', { days: fmtDays(b.live.nextUnlock.etaDays) }) }) + '</span>');
    html += '</div>';
    html += tableHtml('tbl-base-live', b.live.modules.filter(m => m.unlocked), [
      { label: t('base.col_module'), numeric: false, getValue: r => r.name, render: r => '<b>' + esc(moduleLabel(r.name)) + '</b>' + (r.active ? '' : ' <span style="color:var(--bad)">' + t('base.off') + '</span>') },
      { label: t('common.level'), numeric: true, getValue: r => r.level, render: r => String(r.level) },
      { label: t('base.col_tier'), numeric: true, getValue: r => r.tier, render: r => String(r.tier) },
      { label: t('base.col_boost'), numeric: true, getValue: r => r.boost, render: r => r.boost.toFixed(1) + '%' },
      { label: t('base.col_output_tick'), numeric: true, getValue: r => r.output, render: r => r.output.toFixed(2) },
      { label: t('base.col_next_level'), numeric: true, getValue: r => r.nextLevelCost, render: r => fmtC(r.nextLevelCost) + t('base.of_each_colon', { list: r.materials.map(m => esc(materialLabel(m))).join(', ') }) },
      { label: t('base.col_next_tier'), numeric: true, getValue: r => r.nextTierCost, render: r => t('base.stellarium_amount', { n: r.nextTierCost }) },
    ]);
  }

  // --- modules / targets ---
  html += '<h2>' + t('base.h_modules') + '</h2><div class="sub">' + t('base.modules_note') + '</div>';
  const rows = plan.unlocks.map(u => Object.assign({}, u, plan.targets.find(t => t.name === u.name) || {}));
  html += tableHtml('tbl-base-modules', rows, [
    { label: t('base.col_module'), numeric: false, getValue: r => r.name, render: r => '<b>' + esc(moduleLabel(r.name)) + '</b>' + (r.unlocked ? ' <span style="color:var(--good)">' + t('base.unlocked') + '</span>' : '') },
    { label: t('base.col_type'), numeric: false, getValue: r => r.type || '', render: r => esc(moduleTypeLabel(r.type || '')) },
    { label: t('base.col_unlock'), numeric: true, getValue: r => r.cost, render: r => r.unlocked ? '-' : r.cost + '<span class="est">' + t('base.unlock_est', { cum: r.cumulative, days: fmtDays(r.daysToUnlock) }) + '</span>' },
    { label: t('base.col_materials'), numeric: false, getValue: r => (r.materials || []).join(','), render: r => (r.materials || []).map(m => esc(materialLabel(m))).join(', ') },
    { label: t('base.col_target_level'), numeric: true, getValue: r => r.to || 0, render: r => '<input class="pet-input base-input" type="number" min="0" value="' + (r.to || 0) + '" onchange="setBaseLevel(' + esc(jsStr(r.name)) + ', this.value)">' + (r.from ? '<span class="est">' + t('base.from_level', { n: r.from }) + '</span>' : '') },
    { label: t('base.col_cost_to_target'), numeric: true, getValue: r => r.perMaterial || 0, render: r => fmtN(r.perMaterial || 0) + t('base.of_each') },
    { label: t('base.col_boost_at_target'), numeric: true, getValue: r => r.boostAtTarget || 0, render: r => (r.boostAtTarget || 0).toFixed(0) + '%' },
    { label: t('base.col_output_at_target'), numeric: true, getValue: r => r.outputAtTarget || 0, render: r => (r.outputAtTarget === undefined ? '-' : r.outputAtTarget.toFixed(2)) },
    { label: t('base.col_upkeep_at_target'), numeric: true, getValue: r => r.upkeepPerHourAtTarget || 0, render: r => (r.type === 'active' || (b.live && !r.unlocked)) ? '-' : fmtC(r.upkeepPerHourAtTarget || 0) },
  ]);

  // --- stockpile ---
  html += '<h2>' + t('base.h_stockpile') + '</h2>';
  html += '<div class="sub">' + t('base.stockpile_note') + '</div>';
  if (plan.buyFirst.length) html += '<div class="sub" style="color:var(--warn)">' + t('base.buy_first', { list: plan.buyFirst.map(n => esc(moduleLabel(n))).join(', ') }) + '</div>';
  html += tableHtml('tbl-base-stock', plan.stockpile, [
    { label: t('base.col_material'), numeric: false, getValue: r => r.material, render: r => '<b>' + esc(materialLabel(r.material)) + '</b>' },
    { label: t('base.col_needed'), numeric: true, getValue: r => r.needed, render: r => fmtN(r.needed) },
    { label: t('base.col_stock'), numeric: true, getValue: r => r.stock, render: r => fmtN(r.stock) },
    { label: t('common.short'), numeric: true, getValue: r => r.short, render: r => r.short > 0 ? '<span style="color:var(--bad)">' + fmtN(r.short) + '</span>' : '<span style="color:var(--good)">0</span>' },
    { label: t('base.col_for'), numeric: false, getValue: r => r.modules.length, render: r => r.modules.map(n => esc(moduleLabel(n))).join(', ') },
    { label: t('base.col_produced_by'), numeric: false, getValue: r => r.building || '', render: r => r.bought ? esc(moduleLabel(r.building || '')) : '<span style="color:var(--warn)">' + t('base.buy_building_first', { name: esc(moduleLabel(r.building || '?')) }) + '</span><span class="est">' + t('base.consumes', { list: r.inputs.map(m => esc(materialLabel(m))).join(', ') }) + '</span>' },
    { label: t('base.col_chain_time'), numeric: true, getValue: r => r.hoursPipelined === null ? -1 : r.hoursPipelined, render: r => r.hoursPipelined === null ? '-' : fmtHours(r.hoursPipelined) + (r.binding ? '<span style="color:var(--bad)">' + t('base.binding_pct', { name: esc(materialLabel(r.binding.name)), pct: (r.binding.coverage * 100).toFixed(0) }) + '</span>' : '') },
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
  return card(t('summary.crafting_lvl'), p.craftLevel + ' <span style="font-size:11px;color:var(--dim)">' + t('summary.xp', { cur: p.currentXp, target: p.targetXp }) + '</span>') +
    card(t('summary.dust'), p.dust.toLocaleString() + delta('dust')) +
    card(t('summary.catalyst_parts'), p.parts.toLocaleString() + delta('parts')) +
    card(t('summary.quantum_cores'), p.qc.toLocaleString() + delta('qc')) +
    card(t('summary.installed'), p.installedCount) +
    card(t('summary.unequipped'), p.unequippedCount);
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
    html = '<div class="empty-note">' + t('history.loading') + '</div>';
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
    html += '<h2>' + t('view.item_advisor') + '</h2>' + renderShipItemAdvisor(d.shipItems);
    html += '<h2>' + t('view.equipped_gear') + '</h2>' + renderGear(d.gear);
  } else if (tab === 'battle') {
    if (d.battleTrusted === false) {
      html += '<div class="row" style="border-color:rgba(224,91,91,.4)"><span>' + t('view.squadron_unknown') + '</span></div>';
    }
    if (d.battleBase) {
      html += '<h2>' + t('view.battle_benchmark') + '</h2><div class="sub">' + t('view.battle_benchmark_sub') + '</div>';
      html += '<div class="cards">' + Object.entries(d.battleBase).map(([npc, lvl]) =>
        '<div class="card"><div class="k">' + esc(npcLabel(npc)) + '</div><div class="v">' + lvl + '</div></div>').join('') + '</div>';
    }
    html += '<h2>' + t('view.active_bonuses') + '</h2>';
    html += '<div class="sub">' + t('view.active_bonuses_sub') + '</div>';
    html += renderContextTotals(d.contextTotals);
    html += renderOverrideLosses(d.overrideLosses);
  } else if (tab === 'installs') {
    const labels = {
      full: t('view.variant_full_label'),
      resources: t('view.variant_resources_label'),
    };
    html += '<h2>' + t('view.install_plan_heading', { variant: labels[variant] }) + '</h2>';
    if (d.projection) html += renderProjection(d.projection, d.battleBase);
    html += '<div class="toolbar" style="margin-bottom:6px">' +
      '<button class="ghost ' + (variant === 'full' ? 'active' : '') + '" onclick="setVariant(&quot;full&quot;)">' + t('view.variant_full_btn') + '</button>' +
      '<button class="ghost ' + (variant === 'resources' ? 'active' : '') + '" onclick="setVariant(&quot;resources&quot;)">' + t('view.variant_resources_btn') + '</button>' +
      '<button class="ghost" style="margin-left:auto" onclick="resetDone()">' + t('view.reset_checkmarks') + '</button></div>';
    const planList = variant === 'full' ? d.installs
      : d.installsResources;
    const prevInstallKeys = computeInstallKeySet(window.prevData, variant);
    html += renderInstalls(planList, d.freedTexts, d.battleNote, d.gear, variant, doneSet, prevInstallKeys);
  } else if (tab === 'merges') {
    html += '<h2>' + t('view.merge_plan') + '</h2>';
    html += '<div class="toolbar" style="margin-bottom:6px"><button class="ghost" onclick="resetDone()">' + t('view.reset_checkmarks') + '</button></div>';
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
    html += '<h2>' + t('view.catalyst_inventory') + '</h2>' + renderInventory(d.inventory);
  } else if (tab === 'materials') {
    html += '<h2>' + t('tab.materials') + '</h2>' + renderMaterials(d.materials);
  } else if (tab === 'lab') {
    html += '<h2>' + t('view.lab_planner') + '</h2>' + renderLab(d.lab);
  } else if (tab === 'base') {
    html += '<h2>' + t('view.base_planner') + '</h2>' + renderBase(d.base);
  }
  } catch (e) {
    console.error('render(' + tab + ') failed', e);
    html = '<div class="row" style="border-color:rgba(224,91,91,.4)"><span>' +
      '<b style="color:var(--bad)">' + t('common.render_failed', { msg: esc(String(e && e.message || e)) }) + '</b>' +
      '<br><span style="color:var(--dim)">' + t('view.render_failed_hint') + '</span></span></div>';
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
  status.textContent = t('view.reading_state');
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
    if (d.error) { status.textContent = t('status.error', { msg: d.error }); status.style.color = 'var(--bad)'; }
    else {
      window.lastData = d;
      try { render(d); status.textContent = t('status.updated', { time: new Date().toLocaleTimeString(), secs: ((Date.now() - t0) / 1000).toFixed(1) }); status.style.color = ''; }
      catch (e) { status.textContent = t('status.render_error', { msg: e.message }); status.style.color = 'var(--bad)'; console.error(e); }
    }
  } catch (e) {
    status.textContent = t('status.failed', { msg: e.name === 'AbortError' ? t('status.timed_out') : e.message });
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
      const when = d.capturedAt ? new Date(d.capturedAt).toLocaleString() : t('status.unknown_time');
      status.textContent = t('status.snapshot', { when: when });
      status.style.color = 'var(--warn)';
      // Named capturedMs, not t: a local `const t` here would shadow the i18n
      // t() helper for the whole block and put the calls above in its TDZ.
      const capturedMs = Number(new Date(d.capturedAt));
      return Number.isFinite(capturedMs) ? capturedMs : null; // when the shown snapshot was taken
    }
  } catch (e) { /* no snapshot yet -- keep the "Click Analyze now" empty-note */ }
  return null;
}

const HISTORY_METRICS = [
  { key: 'battleAvg', labelKey: 'chart.battle_avg_level', fmt: v => String(v) },
  { key: 'craftLevel', labelKey: 'chart.craft_level', fmt: v => String(v) },
  { key: 'dust', labelKey: 'chart.cosmic_dust', fmt: fmtC },
  { key: 'qc', labelKey: 'chart.quantum_cores', fmt: fmtC },
  { key: 'credits', labelKey: 'chart.credits', fmt: fmtC },
  { key: 'parts', labelKey: 'chart.catalyst_parts', fmt: fmtC },
  { key: 'installedCount', labelKey: 'chart.installed_catalysts', fmt: v => String(v) },
  { key: 'unequippedCount', labelKey: 'chart.unequipped_catalysts', fmt: v => String(v) },
  { key: 'petLevelSum', labelKey: 'chart.pet_level_sum', fmt: v => String(v) },
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
    ? '<div class="chart-single">' + esc(m.fmt(latest)) + '</div><div class="sub" style="margin:2px 0 0">' + t('chart.need_more_snapshots') + '</div>'
    : svgChart(points, m.fmt);
  return '<div class="chart-card"><div class="chart-head"><span class="chart-label">' + t(m.labelKey) + '</span>' +
    '<span class="chart-value">' + esc(m.fmt(latest)) + '</span>' +
    (deltaText ? '<span class="chart-delta" style="color:' + deltaColor + '">' + esc(deltaText) + '</span>' : '') +
    '</div>' + body + '</div>';
}

function renderHistory(entries) {
  if (!entries.length) return '<div class="empty-note">' + t('history.no_snapshots') + '</div>';
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
    content.innerHTML = '<div class="empty-note">' + t('history.load_failed', { msg: esc(e.message) }) + '</div>';
    return;
  }
  content.innerHTML = '<h2>' + t('tab.history') + '</h2>' + renderHistory(entries);
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

// The catalyst icons are optional artwork: fetch them once, and re-render if
// they arrive after the first paint.
loadIcons();

// ---- language ----
// i18n.js has already picked the catalogue (stored preference, else the
// browser's language) before this file ran. This puts that choice on screen:
// the static markup in index.html gets its translations and the toolbar
// selector shows which language is active. Switching later goes through
// I18n.setLang, which re-applies the static markup and re-renders.
(function initLang() {
  const sel = document.getElementById('lang');
  if (sel) sel.value = I18n.lang;
  I18n.applyStatic();
})();

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
