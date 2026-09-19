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
