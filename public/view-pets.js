function petEffectText(e) {
  const label = esc(t('peteffect.' + e.key));
  if (e.pct !== undefined) {
    // Korin's cooldown is the one negative: print a real minus, not a hyphen.
    const v = e.pct < 0 ? '&minus;' + Math.abs(e.pct) : '+' + e.pct;
    return t('pets.eff_pct', { label: label, v: v });
  }
  if (e.mult !== undefined) return t('pets.eff_mult', { label: label, v: e.mult.toFixed(2) });
  if (e.flat !== undefined) return t('pets.eff_flat', { label: label, v: (e.flat < 0 ? '&minus;' : '+') + fmtN(Math.abs(e.flat)) });
  return label;
}
// The whole Bonus cell. A pet that is not equipped grants nothing, so its
// bonuses are dimmed rather than hidden -- you still want to see what you
// would get for equipping it.
function petEffectCell(pet) {
  const eff = pet.effects || [];
  if (!eff.length) return '<span style="color:var(--dim)">' + t('common.none') + '</span>';
  const text = eff.map(petEffectText).join('<span class="dimtext"> &middot; </span>');
  if (pet.equipped) return text;
  return '<span style="opacity:.45" title="' + t('pets.bonus_inactive_title') + '">' + text + '</span>';
}

function renderPets(p) {
  let html = '';
  html += '<h2>' + t('pets.title') + '</h2>';
  html += '<div class="sub">' + t('pets.xp_formula') + '</div>';
  html += '<div class="cards">';
  html += card(t('pets.card_xp_tech'), p.techSkill + (p.techSkill >= 100 ? ' <span class="badge b-ok">' + t('pets.badge_max') + '</span>' : ''));
  html += card(t('pets.card_premium'), p.premiumActive ? t('pets.premium_active') + ' <span style="font-size:11px;color:var(--dim)">' + t('pets.premium_bonus') + '</span>' : t('pets.premium_inactive'));
  html += card(cardIcon(resIcon('pet_food', 'mat-tile xs'), t('pets.card_food_stock')), p.petFood.toLocaleString() + ' <span style="font-size:11px;color:var(--dim)">' + t('pets.food_burn', { n: p.petFoodPerDay, days: p.petFoodDays !== null ? t('pets.days_short', { n: p.petFoodDays }) : '-' }) + '</span>');
  html += card(t('pets.card_equipped'), p.pets.filter(function (x) { return x.equipped; }).length + ' / ' + p.pets.length);
  html += '</div>';

  if (p.korin) html += renderKorin(p.korin);

  html += '<h2>' + t('pets.all_pets') + '</h2>';
  html += '<div class="sub">' + t('pets.bonus_note') + '</div>';
  const petCols = [
    { label: t('pets.col_pet'), numeric: false, getValue: pet => pet.name,
      render: pet => '<span class="inv-stat">' + petIcon(pet.name) + '<b>' + esc(petBodyLabel(pet.name)) + '</b></span>' },
    { label: t('pets.col_slot'), numeric: false, getValue: pet => pet.equipped ? pet.slotType : '~unequipped',
      render: pet => pet.equipped ? esc(petSlotLabel(pet.slotType)) : '<span class="badge b-empty">' + t('pets.badge_unequipped') + '</span>' },
    { label: t('pets.col_bonus'), numeric: false,
      getValue: pet => (pet.effects && pet.effects[0] ? pet.effects[0].key : '~'),
      render: petEffectCell },
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
  let html = headIcon(petIcon('Korin'), t('korin.title'));
  html += '<div class="cards">';
  html += card(cardIcon(petIcon('Korin', 'mat-tile xs'), t('korin.card_level')), k.level);
  html += card(cardIcon(resIcon('dust', 'mat-tile xs'), t('korin.card_cost_per_capsule')), fmtC(k.dustCostPerCapsule) + ' <span style="font-size:11px;color:var(--dim)">' + t('korin.dust') + '</span>');
  html += card(cardIcon(resIcon('warp_capsule', 'mat-tile xs'), t('korin.card_capsule_stock')), k.capsules.toLocaleString() +
    ' <span style="font-size:11px;color:var(--dim)">' + t('korin.stock_split', { n: k.enhancedCapsules.toLocaleString() }) + '</span>');
  html += card(t('korin.card_affordable_now'), k.affordableNow.toLocaleString() +
    ' <span style="font-size:11px;color:var(--dim)">' + t('korin.limited_by', { what: limitedBy }) + '</span>');
  html += card(cardIcon(resIcon('fuel', 'mat-tile xs'), t('korin.card_fuel_per_enhanced')), (k.fuelPerEnhanced !== null ? k.fuelPerEnhanced.toLocaleString() : '?') +
    ' ' + t('korin.fuel') + ' <span style="font-size:11px;color:var(--dim)">' + t('korin.fuel_multiplier', { x: k.fuelMultiplier.toFixed(1) }) + '</span>');
  html += card(t('korin.card_engine_cooldown'), '&minus;' + k.cooldownReductionPct + '%');
  html += '</div>';
  if (k.equipped === false) html += '<div class="sub"><span class="badge b-warn">' + t('korin.unequipped') + '</span></div>';
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

  // Pet food: every auto-fed equipped pet feeds from the same stock (without
  // auto-feed food sits at the floor and nothing is consumed). The selected
  // pet uses the simulated threshold, the others their current one.
  const cycleH = function (l) { return (100 - l) / 5 + 1; };
  let perDay = 0, count = 0;
  for (const q of p.pets) {
    if (!q.equipped || !q.autofeed) continue;
    count++;
    perDay += 24 / cycleH(q.id === pet.id ? limit : q.autofeedLimit);
  }
  const days = perDay > 0 ? p.petFood / perDay : Infinity;

  let html = '';
  if (!pet.autofeed) html += '<div class="row"><span class="badge b-warn">' + t('sim.autofeed_off') + '</span></div>';
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
