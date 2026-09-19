let autoTimer = null;   // repeating auto-refresh interval
let autoKickoff = null; // one-shot timer for the first run after a restore
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// ---- localStorage-backed "done" checkmarks (installs & merges rows) ----
function loadDone() {
  try { return new Set(JSON.parse(localStorage.getItem('advisor-done') || '[]')); }
  catch { return new Set(); }
}
function saveDone(set) {
  try { localStorage.setItem('advisor-done', JSON.stringify(Array.from(set))); } catch {}
}
function toggleDone(key, checked) {
  const set = loadDone();
  if (checked) set.add(key); else set.delete(key);
  saveDone(set);
  if (window.lastData) render(window.lastData);
}
function resetDone() {
  try { localStorage.removeItem('advisor-done'); } catch {}
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
// Material and resource icons. The game's symbol ids and the engine's material
// names differ only in separators ("warp capsule" vs warp_capsule), so try the
// obvious spellings and fall back to no icon at all -- a missing material icon
// should cost the row nothing, unlike a catalyst where the tile IS the row.
function matIconId(name) {
  if (!window.__iconIds) return null;
  const raw = String(name || '');
  for (const cand of [raw, raw.toLowerCase().replace(/\s+/g, '_'),
                      raw.toLowerCase().replace(/[\s_-]+/g, '')]) {
    if (window.__iconIds.has(cand)) return cand;
  }
  return null;
}
function matIcon(name) {
  const id = window.__iconsReady ? matIconId(name) : null;
  if (!id) return '';
  return '<span class="mat-tile"><svg aria-hidden="true"><use href="#' + esc(id) + '"></use></svg></span>';
}

// Everything else the game has artwork for: ship slots, activity tabs, NPC
// factions, planet bodies, pets, technology skills and currencies.
// public/icon-map.js decides WHICH sprite symbol each one uses; all this
// does is turn an id into markup. Same rule as matIcon -- a missing sprite,
// or a thing the game ships no icon for (droids), renders as nothing rather
// than as a placeholder, because in every one of these places the icon sits
// next to a label that already says what it is.
function gameIcon(id, cls) {
  if (!window.__iconsReady || !window.__iconIds || !id || !window.__iconIds.has(id)) return '';
  return '<span class="' + (cls || 'mat-tile') + '"><svg aria-hidden="true"><use href="#' +
    esc(id) + '"></use></svg></span>';
}
const IM = () => window.IconMap || null;
function slotIcon(slot, cls) { return IM() ? gameIcon(IM().slot(slot), cls) : ''; }
function actIcon(act, cls) { return IM() ? gameIcon(IM().activity(act), cls) : ''; }
function npcIcon(npc, cls) { return IM() ? gameIcon(IM().npc(npc), cls) : ''; }
function bodyIcon(body, cls) { return IM() ? gameIcon(IM().body(body), cls) : ''; }
function petIcon(name, cls) { return IM() ? gameIcon(IM().pet(name), cls) : ''; }
function techIcon(key, cls) { return IM() ? gameIcon(IM().tech(key), cls) : ''; }
function resIcon(key, cls) { return IM() ? gameIcon(IM().res(key), cls) : ''; }
// A card label carries a smaller glyph than a table row: .k is 11px text.
function cardIcon(icon, label) { return icon ? icon + '<span class="k-label">' + label + '</span>' : label; }
// An <h2>/<h3> with a glyph in front of it. Wrapping the text in its own
// span is what keeps .inv-stat's gap between the two.
function headIcon(icon, label, tag) {
  const h = tag || 'h2';
  if (!icon) return '<' + h + '>' + label + '</' + h + '>';
  return '<' + h + '><span class="inv-stat">' + icon + '<span>' + label + '</span></span></' + h + '>';
}

// Two sprites: icons.svg is the game's artwork, extracted locally and absent
// until you run extract-icons.js; icons-local.svg is the handful the advisor
// draws itself and ships with the repo. Either can be missing without taking
// the other down, and the id set is their union.
function injectSprite(svg) {
  if (!svg) return [];
  const holder = document.createElement('div');
  holder.style.display = 'none';
  holder.innerHTML = svg;
  document.body.insertBefore(holder, document.body.firstChild);
  return Array.from(holder.querySelectorAll('symbol')).map(n => n.id);
}
function loadIcons() {
  const get = url => fetch(url).then(r => (r.ok ? r.text() : null)).catch(() => null);
  return Promise.all([get('/icons.svg'), get('/icons-local.svg')]).then(sprites => {
    const ids = [];
    for (const svg of sprites) ids.push(...injectSprite(svg));
    if (!ids.length) return;
    window.__iconIds = new Set(ids);
    window.__iconsReady = true;
    if (window.lastData) render(window.lastData);
  }).catch(() => {}); // icons are cosmetic: any failure here keeps the dot fallback
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

// Colour + fill width for a capped stat: green under 80%, amber near the
// cap, red over it. Shared by the activity cards and the install rows.
function capTone(total, cap) {
  const ratio = cap > 0 ? total / cap * 100 : 0;
  const color = ratio > 100.01 ? 'var(--bad)' : (ratio >= 80 ? 'var(--warn)' : 'var(--good)');
  return { color, width: Math.min(100, ratio) };
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
// Module output: whole numbers for bulk products, two decimals for the small ones.
function fmtOutput(n) { n = Number(n) || 0; return n >= 100 ? fmtN(n) : n.toFixed(2); }

function fmtH(h) {
  if (h === null || h === undefined) return '-';
  if (h === Infinity) return t('pets.never');
  if (h < 48) return h + t('common.hours');
  return t('pets.dur_dh', { d: Math.floor(h / 24), h: h % 24 });
}

// ---- Materials tab: blueprint material requirements vs stock ----
function baseRateCell(rate, hoursToCover) {
  if (!(rate > 0)) return '-';
  return fmtOutput(rate) + t('tech.per_hour') + (hoursToCover != null ? ' <span style="color:var(--dim)">' + t('mat.base_covers_in', { t: fmtHours(hoursToCover) }) + '</span>' : '');
}
function materialCols(showFarm, showBase) {
  const cols = [
    { label: t('mat.col_material'), numeric: false, getValue: r => r.material,
      render: r => '<span class="inv-stat">' + matIcon(r.material) + '<b>' + esc(materialLabel(r.material)) + '</b></span>' },
    { label: t('mat.col_stock'), numeric: true, getValue: r => r.stock, render: r => r.stock.toLocaleString() },
    { label: t('mat.col_need'), numeric: true, getValue: r => r.neededAllUses, render: r => r.neededAllUses.toLocaleString() },
    { label: t('mat.col_deficit'), numeric: true, getValue: r => r.deficit,
      render: r => r.deficit > 0 ? '<b style="color:var(--bad)">' + r.deficit.toLocaleString() + '</b>' : '0' },
  ];
  if (showFarm) {
    cols.push({ label: t('mat.col_farm'), numeric: false, getValue: r => r.npc || '',
      render: r => r.npc && r.deficit > 0
        ? ('<span class="inv-stat">' + npcIcon(r.npc, 'mat-tile xs') + '<span>' + esc(npcLabel(r.npc)) + '</span>' +
           bodyIcon(r.location, 'mat-tile xs') + '<span>' + esc(bodyLabel(r.location)) + '</span></span>')
        : '-' });
  }
  if (showBase) {
    cols.push({ label: t('mat.col_base_rate'), numeric: true, getValue: r => r.basePerHour || 0, render: r => baseRateCell(r.basePerHour, r.hoursToCover) });
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

  // A group with nothing in it gets no heading.
  const section = function (id, list, title, note, farm) {
    if (!list || !list.length) return '';
    const showBase = list.some(r => r.basePerHour > 0);
    return '<h2>' + title + '</h2>' + (note ? '<div class="sub">' + note + '</div>' : '') + tableHtml(id, list, materialCols(farm, showBase));
  };
  html += section('tbl-mat-npc', m.npcDrops, t('mat.npc_drops_title'), t('mat.npc_drops_note'), true);
  html += section('tbl-mat-lab', m.labMaterials, t('mat.lab_title'), t('mat.lab_note'), false);
  html += section('tbl-mat-gathered', m.gathered, t('mat.gathered_title'), t('mat.gathered_note'), false);
  html += section('tbl-mat-other', m.other, t('mat.other_title'), '', false);

  return html;
}

function fmtHours(h) {
  if (h === null || h === undefined) return '?';
  if (h < 1 / 60) return t('lab.time_lt_1_min');
  if (h < 1) return t('lab.time_min', { n: Math.round(h * 60) });
  if (h < 48) return t('lab.time_h', { n: h.toFixed(1) });
  return t('lab.time_d', { n: (h / 24).toFixed(1) });
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
  return card(cardIcon(resIcon('crafting_level', 'mat-tile xs'), t('summary.crafting_lvl')), p.craftLevel + ' <span style="font-size:11px;color:var(--dim)">' + t('summary.xp', { cur: p.currentXp, target: p.targetXp }) + '</span>') +
    card(cardIcon(resIcon('dust', 'mat-tile xs'), t('summary.dust')), p.dust.toLocaleString() + delta('dust')) +
    card(cardIcon(resIcon('catalyst_parts', 'mat-tile xs'), t('summary.catalyst_parts')), p.parts.toLocaleString() + delta('parts')) +
    card(cardIcon(resIcon('quantum_cores', 'mat-tile xs'), t('summary.quantum_cores')), p.qc.toLocaleString() + delta('qc')) +
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
      const curList = variant === 'full' ? d.installs
        : variant === 'resources' ? d.installsResources
        : d.installsMerged;
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
        '<div class="card"><div class="k">' + cardIcon(npcIcon(npc, 'mat-tile xs'), esc(npcLabel(npc))) +
        '</div><div class="v">' + lvl + '</div></div>').join('') + '</div>';
    }
    // The over-cap rows behind the tab badge.
    if (d.warnings && d.warnings.length) {
      html += '<h2>' + t('view.over_cap_title', {n: d.warnings.length}) + '</h2><div class="list warnlist">';
      for (const w of d.warnings) {
        html += '<div class="row">' + actIcon(w.ctx, 'mat-tile xs') + '<b>' + esc(actLabel(w.ctx)) + '</b> ' +
          t('view.over_cap_row', {stat: esc(statLabel(w.stat).replaceAll('_', ' ')), total: esc(w.totalText), cap: esc(w.capText)}) +
          ' <span style="color:var(--bad)">' + t('gear.wasted', {v: esc(w.wastedText)}) + '</span></div>';
      }
      html += '</div>';
    }
    html += '<h2>' + t('view.active_bonuses') + '</h2>';
    html += '<div class="sub">' + t('view.active_bonuses_sub') + '</div>';
    // Base upkeep reduction only does something once a base is founded.
    const baseLive = !!(d.base && d.base.phase === 'live');
    html += renderContextTotals(d.contextTotals, baseLive ? null : new Set(['base_upkeep_reduction']));
    html += renderOverrideLosses(d.overrideLosses);
  } else if (tab === 'installs') {
    const labels = {
      full: t('view.variant_full_label'),
      resources: t('view.variant_resources_label'),
      merged: t('view.variant_merged_label'),
    };
    const projection = variant === 'merged' ? d.projectionMerged : d.projection;
    html += '<h2>' + t('view.install_plan_heading', { variant: labels[variant] }) + '</h2>';
    if (projection) html += renderProjection(projection, d.battleBase);
    html += '<div class="toolbar" style="margin-bottom:6px">' +
      '<button class="ghost ' + (variant === 'full' ? 'active' : '') + '" onclick="setVariant(&quot;full&quot;)">' + t('view.variant_full_btn') + '</button>' +
      '<button class="ghost ' + (variant === 'resources' ? 'active' : '') + '" onclick="setVariant(&quot;resources&quot;)">' + t('view.variant_resources_btn') + '</button>' +
      '<button class="ghost ' + (variant === 'merged' ? 'active' : '') + '" onclick="setVariant(&quot;merged&quot;)">' + t('view.variant_merged_btn') + '</button>' +
      '<button class="ghost" style="margin-left:auto" onclick="resetDone()">' + t('view.reset_checkmarks') + '</button></div>';
    const planList = variant === 'full' ? d.installs
      : variant === 'resources' ? d.installsResources
      : d.installsMerged;
    const prevInstallKeys = computeInstallKeySet(window.prevData, variant);
    const freedList = variant === 'full' ? d.freedTexts
      : variant === 'resources' ? (d.freedTextsResources || d.freedTexts)
      : (d.freedTextsMerged || d.freedTexts);
    html += renderInstalls(planList, freedList, d.battleNote, d.gear, variant, doneSet, prevInstallKeys);
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
  } else if (tab === 'craft') {
    html += '<h2>' + t('craft.title') + '</h2><div class="sub">' + t('craft.intro') + '</div>' + renderCrafting(d.craft);
  } else if (tab === 'lab') {
    html += '<h2>' + t('view.lab_planner') + '</h2>' + renderLab(d.lab, d.base);
  } else if (tab === 'base') {
    html += '<h2>' + t('view.base_planner') + '</h2>' + renderBase(d.base);
  } else if (tab === 'voyager') {
    html += '<h2>' + t('view.voyager_planner') + '</h2>' + renderVoyager(d.voyager);
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
      try { render(d); status.textContent = t('status.updated', { time: new Date().toLocaleTimeString(), secs: ((Date.now() - t0) / 1000).toFixed(1) }) + (d.source === 'browser' ? t('status.via_browser') : ''); status.style.color = ''; }
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
  } catch {}
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
  try { localStorage.setItem('advisor-auto-mins', String(n)); } catch {}
  if (autoTimer) { clearInterval(autoTimer); autoTimer = setInterval(refresh, n * 60000); }
  return n;
}

function autoOn() {
  try { return localStorage.getItem('advisor-auto-on') === '1'; } catch { return false; }
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
  try { localStorage.setItem('advisor-auto-on', on ? '1' : '0'); } catch {}
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
  } catch { /* no snapshot yet -- keep the "Click Analyze now" empty-note */ }
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
  } else if (e.key === '=') {
    const buttons = document.querySelectorAll('.maintabs button');
    const btn = buttons[11];
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
