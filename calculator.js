/**
 * Saul Shaoul ES Key Levels Calculator
 * Methodology: multi-timeframe H/L, 50% midpoints, confluence scoring,
 * floor pivot, overnight/late-day extremes, Bollinger Bands
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

function v(id) {
  const val = parseFloat(document.getElementById(id).value);
  return isNaN(val) ? null : val;
}

function mid(h, l) {
  return Math.round((h + l) / 2);
}

/**
 * Floor pivot calculation (classic floor trader formula).
 * Returns pivot + R1/R2/R3 + S1/S2/S3
 */
function floorPivot(h, l, c, o = null, preCalcP = null) {
  // If pivot is pre-calculated, use it directly
  const p = preCalcP !== null ? preCalcP : Math.round((h + l + c) / 3);

  const r1 = Math.round(2 * p - l);
  const r2 = Math.round(p + (h - l));
  const r3 = Math.round(h + 2 * (p - l));
  const s1 = Math.round(2 * p - h);
  const s2 = Math.round(p - (h - l));
  const s3 = Math.round(l - 2 * (h - p));

  return { p, r1, r2, r3, s1, s2, s3 };
}

function round4(v) { return Math.round(v); }

// ─── Level builder ──────────────────────────────────────────────────────────

/**
 * Each level: { price, sources: [string], weight: number }
 * weight = sum of source weights (used for confluence scoring)
 */
function buildRawLevels(data) {
  const levels = [];

  function add(price, label, tagClass, weight = 1) {
    if (price === null || price === undefined || isNaN(price)) return;
    levels.push({ price, label, tagClass, weight });
  }

  // ── Multi-timeframe highs / lows ──────────────────────────────────────────
  const tfs = [
    { key: 'life',     label: 'Life High',     tagClass: 'tag-life',    weight: 5 },
    { key: 'life',     label: 'Life Low',      tagClass: 'tag-life',    weight: 5, isLow: true },
    { key: 'year',     label: 'Year High',     tagClass: 'tag-year',    weight: 4 },
    { key: 'year',     label: 'Year Low',      tagClass: 'tag-year',    weight: 4, isLow: true },
    { key: 'quarter',  label: 'Qtr High',      tagClass: 'tag-quarter', weight: 3 },
    { key: 'quarter',  label: 'Qtr Low',       tagClass: 'tag-quarter', weight: 3, isLow: true },
    { key: 'month',    label: 'Month High',    tagClass: 'tag-month',   weight: 3 },
    { key: 'month',    label: 'Month Low',     tagClass: 'tag-month',   weight: 3, isLow: true },
    { key: 'week',     label: 'Week High',     tagClass: 'tag-week',    weight: 2 },
    { key: 'week',     label: 'Week Low',      tagClass: 'tag-week',    weight: 2, isLow: true },
    { key: 'prevday',  label: 'Prev Day High', tagClass: 'tag-prevday', weight: 2 },
    { key: 'prevday',  label: 'Prev Day Low',  tagClass: 'tag-prevday', weight: 2, isLow: true },
  ];

  for (const tf of tfs) {
    const price = tf.isLow ? data[tf.key + 'Low'] : data[tf.key + 'High'];
    add(price, tf.label, tf.tagClass, tf.weight);
  }

  // ── 50% midpoints ─────────────────────────────────────────────────────────
  const midRanges = [
    { hKey: 'lifeHigh',    lKey: 'lifeLow',    label: 'Life 50%',    tagClass: 'tag-50pct', weight: 5 },
    { hKey: 'yearHigh',    lKey: 'yearLow',    label: 'Year 50%',    tagClass: 'tag-50pct', weight: 4 },
    { hKey: 'quarterHigh', lKey: 'quarterLow', label: 'Qtr 50%',     tagClass: 'tag-50pct', weight: 3 },
    { hKey: 'monthHigh',   lKey: 'monthLow',   label: 'Month 50%',   tagClass: 'tag-50pct', weight: 3 },
    { hKey: 'weekHigh',    lKey: 'weekLow',    label: 'Week 50%',    tagClass: 'tag-50pct', weight: 2 },
    { hKey: 'prevdayHigh', lKey: 'prevdayLow', label: 'PrevDay 50%', tagClass: 'tag-50pct', weight: 2 },
  ];

  for (const r of midRanges) {
    const h = data[r.hKey], l = data[r.lKey];
    if (h !== null && l !== null) {
      add(mid(h, l), r.label, r.tagClass, r.weight);
    }
  }

  // ── Overnight / late-day extremes ─────────────────────────────────────────
  add(data.overnightHigh, 'ON High',       'tag-overnight', 2);
  add(data.overnightLow,  'ON Low',        'tag-overnight', 2);
  add(data.latedayHigh,   'Late Day High', 'tag-lateday',   1);
  add(data.latedayLow,    'Late Day Low',  'tag-lateday',   1);

  // Overnight 50%
  if (data.overnightHigh !== null && data.overnightLow !== null) {
    add(mid(data.overnightHigh, data.overnightLow), 'ON 50%', 'tag-50pct', 2);
  }

  // ── Floor pivot ───────────────────────────────────────────────────────────
  // Use directly entered pivot if provided, otherwise calculate from late-day bars
  const directPivot = data.floorPivot;
  if (directPivot !== null) {
    // Use entered pivot directly with late-day H/L for R/S levels
    const h = data.latedayHigh ?? (directPivot + 10);
    const l = data.latedayLow  ?? (directPivot - 10);
    const pv = floorPivot(h, l, null, null, directPivot);
    add(pv.p,  'Pivot', 'tag-pivot',   4);
    add(pv.r1, 'R1',    'tag-pivot-r', 3);
    add(pv.r2, 'R2',    'tag-pivot-r', 3);
    add(pv.r3, 'R3',    'tag-pivot-r', 2);
    add(pv.s1, 'S1',    'tag-pivot-s', 3);
    add(pv.s2, 'S2',    'tag-pivot-s', 3);
    add(pv.s3, 'S3',    'tag-pivot-s', 2);
    data._pivot = pv.p;
  } else if (data.latedayHigh !== null && data.latedayLow !== null && data.latedayClose !== null) {
    const pv = floorPivot(data.latedayHigh, data.latedayLow, data.latedayClose);
    add(pv.p,  'Pivot', 'tag-pivot',   4);
    add(pv.r1, 'R1',    'tag-pivot-r', 3);
    add(pv.r2, 'R2',    'tag-pivot-r', 3);
    add(pv.r3, 'R3',    'tag-pivot-r', 2);
    add(pv.s1, 'S1',    'tag-pivot-s', 3);
    add(pv.s2, 'S2',    'tag-pivot-s', 3);
    add(pv.s3, 'S3',    'tag-pivot-s', 2);
    data._pivot = pv.p;
  }

  // ── Bollinger Bands ───────────────────────────────────────────────────────
  add(data.bbUpper,  'BB Upper',  'tag-bb', 1);
  add(data.bbMiddle, 'BB Middle', 'tag-bb', 2);
  add(data.bbLower,  'BB Lower',  'tag-bb', 1);

  return levels;
}

// ─── Confluence engine ───────────────────────────────────────────────────────

/**
 * Groups raw levels that fall within `window` points of each other.
 * Returns merged levels sorted by total weight (confluence score) descending.
 */
function mergeConfluences(rawLevels, window) {
  // Sort by price
  const sorted = [...rawLevels].sort((a, b) => a.price - b.price);
  const groups = [];

  for (const lvl of sorted) {
    // Try to find an existing group within window
    let placed = false;
    for (const g of groups) {
      if (Math.abs(lvl.price - g.centerPrice) <= window) {
        g.members.push(lvl);
        // Recalculate center as weighted average
        const totalW = g.members.reduce((s, m) => s + m.weight, 0);
        g.centerPrice = Math.round(
          (g.members.reduce((s, m) => s + m.price * m.weight, 0) / totalW) * 4
        ) / 4;
        g.totalWeight += lvl.weight;
        placed = true;
        break;
      }
    }
    if (!placed) {
      groups.push({
        centerPrice: lvl.price,
        members: [lvl],
        totalWeight: lvl.weight,
      });
    }
  }

  // Sort by total weight descending
  groups.sort((a, b) => b.totalWeight - a.totalWeight);
  return groups;
}

// ─── Render helpers ──────────────────────────────────────────────────────────

function tagHTML(label, tagClass) {
  return `<span class="tag ${tagClass}">${label}</span>`;
}

function scoreDotsHTML(weight, maxWeight) {
  const MAX_DOTS = 5;
  const filled = Math.min(MAX_DOTS, Math.round((weight / maxWeight) * MAX_DOTS));
  let cls = 'filled';
  if (filled >= 4) cls = 'filled critical';
  else if (filled >= 3) cls = 'filled high';

  let dots = '';
  for (let i = 0; i < MAX_DOTS; i++) {
    dots += `<span class="dot ${i < filled ? cls : ''}"></span>`;
  }
  return `<div class="confluence-score">
    <div class="score-dots">${dots}</div>
    <span class="score-num">${weight}</span>
  </div>`;
}

function isPivot(members) {
  return members.some(m => m.tagClass === 'tag-pivot' && m.label === 'Pivot');
}

// ─── Main calculate ──────────────────────────────────────────────────────────

function calculate() {
  const data = {
    lifeHigh:     v('life-high'),
    lifeLow:      v('life-low'),
    yearHigh:     v('year-high'),
    yearLow:      v('year-low'),
    quarterHigh:  v('quarter-high'),
    quarterLow:   v('quarter-low'),
    monthHigh:    v('month-high'),
    monthLow:     v('month-low'),
    weekHigh:     v('week-high'),
    weekLow:      v('week-low'),
    prevdayHigh:  v('prevday-high'),
    prevdayLow:   v('prevday-low'),
    prevdayOpen:  v('prevday-open'),
    overnightHigh: v('overnight-high'),
    overnightLow:  v('overnight-low'),
    latedayHigh:  v('lateday-high'),
    latedayLow:   v('lateday-low'),
    latedayClose: v('lateday-close'),
    floorPivot:   v('floor-pivot'),
    bbUpper:      v('bb-upper'),
    bbMiddle:     v('bb-middle'),
    bbLower:      v('bb-lower'),
    _pivot:       null,
  };

  const window = parseFloat(document.getElementById('confluence-window').value) || 3;
  const maxLevels = parseInt(document.getElementById('max-levels').value) || 15;

  const rawLevels = buildRawLevels(data);

  if (rawLevels.length === 0) {
    document.getElementById('levels-table-wrap').innerHTML =
      '<p class="placeholder-text">No valid data entered. Please fill in at least one timeframe.</p>';
    return;
  }

  // Anchor price: pivot if available
  const anchor = data._pivot
    ?? (data.overnightHigh && data.overnightLow ? mid(data.overnightHigh, data.overnightLow) : null)
    ?? data.prevdayClose;

  // Filter: keep pivot R/S levels always, keep multi-TF levels only within ±80 pts of anchor
  const RANGE = 80;
  const filteredLevels = anchor !== null
    ? rawLevels.filter(l =>
        l.tagClass === 'tag-pivot' ||
        l.tagClass === 'tag-pivot-r' ||
        l.tagClass === 'tag-pivot-s' ||
        Math.abs(l.price - anchor) <= RANGE
      )
    : rawLevels;

  const groups = mergeConfluences(filteredLevels, window);
  const maxWeight = groups[0]?.totalWeight || 1;

  // Ensure there is exactly one pivot group — merge any duplicates
  const pivotGroups = groups.filter(g => isPivot(g.members));
  if (pivotGroups.length > 1) {
    // Keep the first, merge others into it
    const primary = pivotGroups[0];
    for (let i = 1; i < pivotGroups.length; i++) {
      primary.members.push(...pivotGroups[i].members);
      primary.totalWeight += pivotGroups[i].totalWeight;
      // Remove the duplicate from groups
      const idx = groups.indexOf(pivotGroups[i]);
      if (idx > -1) groups.splice(idx, 1);
    }
    const totalW = primary.members.reduce((s, m) => s + m.weight, 0);
    primary.centerPrice = round4(
      primary.members.reduce((s, m) => s + m.price * m.weight, 0) / totalW
    );
  }

  // Split into above/at/below pivot groups
  const pivotPrice = data._pivot;
  let aboveGroups, pivotGroup, belowGroups;

  if (pivotPrice !== null) {
    pivotGroup = groups.find(g => isPivot(g.members));

    // Force pivot group centerPrice to exact pivot value
    if (pivotGroup) pivotGroup.centerPrice = pivotPrice;

    aboveGroups = groups.filter(g => g !== pivotGroup && g.centerPrice > pivotPrice)
                        .sort((a, b) => a.centerPrice - b.centerPrice);
    belowGroups = groups.filter(g => g !== pivotGroup && g.centerPrice < pivotPrice)
                        .sort((a, b) => b.centerPrice - a.centerPrice);

    const half = Math.floor((maxLevels - 1) / 2);
    aboveGroups = aboveGroups.slice(-half).reverse();
    belowGroups = belowGroups.slice(0, half);

    let topGroups = [...aboveGroups];
    if (pivotGroup) topGroups.push(pivotGroup);
    topGroups = topGroups.concat(belowGroups);
    var finalGroups = topGroups;
  } else {
    // No pivot — just take top N by weight, sort high→low
    var finalGroups = groups.slice(0, maxLevels).sort((a, b) => b.centerPrice - a.centerPrice);
  }

  // ── Debug panel ───────────────────────────────────────────────────────────
  const dbg = document.getElementById('debug-panel');
  dbg.classList.remove('hidden');
  if (data.latedayHigh !== null && data.latedayLow !== null && data.latedayClose !== null) {
    const pv = floorPivot(data.latedayHigh, data.latedayLow, data.latedayClose);
    dbg.innerHTML = `<strong>Late Day (2–4pm ET):</strong> H:${data.latedayHigh} L:${data.latedayLow} C:${data.latedayClose} &nbsp;|&nbsp; <strong>Formula:</strong> (H+L+C)/3 &nbsp;|&nbsp; <strong>Pivot:</strong> ${pv.p} &nbsp; R1:${pv.r1} R2:${pv.r2} R3:${pv.r3} &nbsp; S1:${pv.s1} S2:${pv.s2} S3:${pv.s3}`;
  } else {
    dbg.innerHTML = `<strong>Late Day data missing</strong> — fetch live data or enter Late Day H/L/C manually.`;
  }

  // ── Pivot badge & bias bar ────────────────────────────────────────────────
  const pivotBadge = document.getElementById('pivot-badge');
  const biasBar = document.getElementById('bias-bar');
  const biasText = document.getElementById('bias-text');

  if (data._pivot !== null) {
    pivotBadge.textContent = `Pivot: ${data._pivot.toFixed(2)}`;
    pivotBadge.classList.remove('hidden');

    const lastPrice = data.overnightHigh !== null && data.overnightLow !== null
      ? mid(data.overnightHigh, data.overnightLow) : null;
    if (lastPrice !== null) {
      biasBar.classList.remove('hidden', 'bullish', 'bearish', 'neutral');
      if (lastPrice > data._pivot + window) {
        biasBar.classList.add('bullish');
        biasText.textContent = `▲ Bullish bias — overnight midpoint (${lastPrice}) is above pivot (${data._pivot}). Favor longs on pullbacks.`;
      } else if (lastPrice < data._pivot - window) {
        biasBar.classList.add('bearish');
        biasText.textContent = `▼ Bearish bias — overnight midpoint (${lastPrice}) is below pivot (${data._pivot}). Favor shorts on rallies.`;
      } else {
        biasBar.classList.add('neutral');
        biasText.textContent = `◆ Neutral — overnight midpoint (${lastPrice}) is near pivot (${data._pivot}). Wait for direction.`;
      }
    } else {
      biasBar.classList.add('hidden');
    }
  } else {
    pivotBadge.classList.add('hidden');
    biasBar.classList.add('hidden');
  }

  // ── Main levels table ─────────────────────────────────────────────────────
  let tableHTML = `
    <table class="levels-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Price</th>
          <th>Confluence</th>
          <th>Sources</th>
        </tr>
      </thead>
      <tbody>
  `;

  finalGroups.forEach((g, i) => {
    const hasPivot = isPivot(g.members);
    const priceClass = hasPivot ? 'level-price pivot-price' : 'level-price';
    const tags = g.members.map(m => tagHTML(m.label, m.tagClass)).join('');
    tableHTML += `
      <tr>
        <td style="color:var(--muted);font-size:12px">${i + 1}</td>
        <td><span class="${priceClass}">${g.centerPrice.toFixed(2)}</span></td>
        <td>${scoreDotsHTML(g.totalWeight, maxWeight)}</td>
        <td><div class="tags">${tags}</div></td>
      </tr>
    `;
  });

  tableHTML += '</tbody></table>';
  document.getElementById('levels-table-wrap').innerHTML = tableHTML;

  // ── Confluence zones (multi-source only) ──────────────────────────────────
  const multiGroups = groups.filter(g => g.members.length > 1);
  const confSection = document.getElementById('confluence-section');
  const confList = document.getElementById('confluence-list');

  if (multiGroups.length > 0) {
    confSection.classList.remove('hidden');
    confList.innerHTML = multiGroups.slice(0, 10).map(g => {
      const tags = g.members.map(m => tagHTML(m.label, m.tagClass)).join('');
      return `<div class="confluence-zone">
        <span class="zone-price">${g.centerPrice.toFixed(2)}</span>
        <span class="zone-count">${g.members.length} sources</span>
        <div class="tags">${tags}</div>
      </div>`;
    }).join('');
  } else {
    confSection.classList.add('hidden');
  }

  // ── Raw levels ────────────────────────────────────────────────────────────
  const rawSection = document.getElementById('raw-section');
  const rawList = document.getElementById('raw-list');
  rawSection.classList.remove('hidden');

  const sortedRaw = [...filteredLevels].sort((a, b) => b.price - a.price);
  rawList.innerHTML = `<div class="raw-grid">` +
    sortedRaw.map(l => `
      <div class="raw-item">
        <span class="raw-item-price">${l.price.toFixed(2)}</span>
        <span class="raw-item-label">${l.label}</span>
      </div>
    `).join('') +
    `</div>`;
}


function clearAll() {
  document.querySelectorAll('.input-row input').forEach(el => {
    el.value = '';
    el.classList.remove('auto-filled');
  });
  document.getElementById('levels-table-wrap').innerHTML =
    '<p class="placeholder-text">Click "Fetch Live Data" to auto-fill, then "Calculate Key Levels"</p>';
  document.getElementById('confluence-section').classList.add('hidden');
  document.getElementById('raw-section').classList.add('hidden');
  document.getElementById('pivot-badge').classList.add('hidden');
  document.getElementById('bias-bar').classList.add('hidden');
  document.getElementById('auto-badge').classList.add('hidden');
  document.getElementById('fetch-status').textContent = '';
  document.getElementById('fetch-status').className = 'fetch-status';
  document.getElementById('pivot-preview').classList.add('hidden');
}

// ─── Event listeners ─────────────────────────────────────────────────────────

document.getElementById('calculate-btn').addEventListener('click', calculate);
document.getElementById('clear-btn').addEventListener('click', clearAll);

document.querySelectorAll('.input-row input').forEach(el => {
  el.addEventListener('keydown', e => { if (e.key === 'Enter') calculate(); });
});

// ── Live pivot preview as user types the RTH close ────────────────────────
function updatePivotPreview() {
  const h = v('lateday-high');
  const l = v('lateday-low');
  const c = v('lateday-close');
  const preview = document.getElementById('pivot-preview');
  if (!preview) return;

  if (h && l && c) {
    const pv = floorPivot(h, l, c);
    preview.classList.remove('hidden');
    preview.innerHTML = `Pivot → <strong>${pv.p.toFixed(2)}</strong>` +
      `&nbsp; R1:${pv.r1} R2:${pv.r2} R3:${pv.r3}` +
      `&nbsp; S1:${pv.s1} S2:${pv.s2} S3:${pv.s3}`;
  } else {
    preview.classList.add('hidden');
  }
}

['lateday-high','lateday-low','lateday-close'].forEach(id => {
  document.getElementById(id).addEventListener('input', updatePivotPreview);
});
