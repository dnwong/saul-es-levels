/**
 * calculator.js — Saul Shaoul ES Key Levels
 * Pivot: (H+L+C)/3 from user-entered broker data
 * Multi-TF: year/quarter/month/week H·L + 50% midpoints + overnight
 * All levels rounded to whole numbers
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────

function g(id) {
  const v = parseFloat(document.getElementById(id)?.value);
  return isNaN(v) ? null : Math.round(v);
}

function mid(h, l) { return Math.round((h + l) / 2); }

// ─── Floor pivot ─────────────────────────────────────────────────────────────

function pivot(h, l, c) {
  const p  = Math.round((h + l + c) / 3);
  const r1 = Math.round(2*p - l);
  const r2 = Math.round(p + (h - l));
  const r3 = Math.round(h + 2*(p - l));
  const s1 = Math.round(2*p - h);
  const s2 = Math.round(p - (h - l));
  const s3 = Math.round(l - 2*(h - p));
  return { p, r1, r2, r3, s1, s2, s3 };
}

// ─── Live pivot preview ───────────────────────────────────────────────────────

function updatePreview() {
  const h = g('pivot-h'), l = g('pivot-l'), c = g('pivot-c');
  const el = document.getElementById('pivot-preview');
  if (h !== null && l !== null && c !== null) {
    const pv = pivot(h, l, c);
    el.innerHTML = `<strong>${pv.p}</strong> &nbsp; R1:${pv.r1} R2:${pv.r2} R3:${pv.r3} &nbsp; S1:${pv.s1} S2:${pv.s2} S3:${pv.s3}`;
  } else {
    el.innerHTML = '';
  }
}

['pivot-h','pivot-l','pivot-c'].forEach(id =>
  document.getElementById(id)?.addEventListener('input', updatePreview)
);

// ─── Build raw levels ─────────────────────────────────────────────────────────

function buildLevels(d) {
  const levels = [];

  function add(price, label, tag, weight) {
    if (price == null || isNaN(price)) return;
    levels.push({ price: Math.round(price), label, tag, weight });
  }

  // Multi-timeframe H/L
  add(d.yearH,    'Year High',    'tag-year',  4); add(d.yearL,    'Year Low',    'tag-year',  4);
  add(d.qtrH,     'Qtr High',     'tag-qtr',   3); add(d.qtrL,     'Qtr Low',     'tag-qtr',   3);
  add(d.monthH,   'Month High',   'tag-month', 3); add(d.monthL,   'Month Low',   'tag-month', 3);
  add(d.weekH,    'Week High',    'tag-week',  2); add(d.weekL,    'Week Low',    'tag-week',  2);
  add(d.pdH,      'Prev Day High','tag-pd',    2); add(d.pdL,      'Prev Day Low','tag-pd',    2);

  // Overnight
  add(d.onH, 'ON High', 'tag-on', 2); add(d.onL, 'ON Low', 'tag-on', 2);

  // 50% midpoints
  if (d.yearH  && d.yearL)  add(mid(d.yearH,  d.yearL),  'Year 50%',  'tag-50', 4);
  if (d.qtrH   && d.qtrL)   add(mid(d.qtrH,   d.qtrL),   'Qtr 50%',   'tag-50', 3);
  if (d.monthH && d.monthL) add(mid(d.monthH, d.monthL), 'Month 50%', 'tag-50', 3);
  if (d.weekH  && d.weekL)  add(mid(d.weekH,  d.weekL),  'Week 50%',  'tag-50', 2);
  if (d.pdH    && d.pdL)    add(mid(d.pdH,    d.pdL),    'PrevDay 50%','tag-50', 2);
  if (d.onH    && d.onL)    add(mid(d.onH,    d.onL),    'ON 50%',    'tag-50', 2);

  // Pivot R/S levels
  if (d.pvH !== null && d.pvL !== null && d.pvC !== null) {
    const pv = pivot(d.pvH, d.pvL, d.pvC);
    add(pv.p,  'Pivot', 'tag-pivot', 5);
    add(pv.r1, 'R1',    'tag-r',     3); add(pv.r2, 'R2', 'tag-r', 3); add(pv.r3, 'R3', 'tag-r', 2);
    add(pv.s1, 'S1',    'tag-s',     3); add(pv.s2, 'S2', 'tag-s', 3); add(pv.s3, 'S3', 'tag-s', 2);
    d._pivot = pv.p;
  }

  return levels;
}

// ─── Confluence merge ─────────────────────────────────────────────────────────

function merge(levels, win) {
  const sorted = [...levels].sort((a, b) => a.price - b.price);
  const groups = [];

  for (const lv of sorted) {
    const g = groups.find(g => Math.abs(lv.price - g.price) <= win);
    if (g) {
      g.members.push(lv);
      g.weight += lv.weight;
      // weighted average price
      const tw = g.members.reduce((s,m) => s+m.weight, 0);
      g.price  = Math.round(g.members.reduce((s,m) => s+m.price*m.weight, 0) / tw);
    } else {
      groups.push({ price: lv.price, members: [lv], weight: lv.weight });
    }
  }

  return groups.sort((a, b) => b.weight - a.weight);
}

// ─── Render ───────────────────────────────────────────────────────────────────

function tag(label, cls) { return `<span class="tag ${cls}">${label}</span>`; }

function dots(w, max) {
  const n = 5, filled = Math.min(n, Math.round(w/max*n));
  const cls = filled >= 4 ? 'on top' : filled >= 3 ? 'on hi' : 'on';
  return '<div class="conf-dots">' +
    Array.from({length: n}, (_, i) => `<span class="dot ${i < filled ? cls : ''}"></span>`).join('') +
    '</div>';
}

// ─── Main calculate ───────────────────────────────────────────────────────────

function calculate() {
  const d = {
    yearH:  g('year-high'),    yearL:  g('year-low'),
    qtrH:   g('quarter-high'), qtrL:   g('quarter-low'),
    monthH: g('month-high'),   monthL: g('month-low'),
    weekH:  g('week-high'),    weekL:  g('week-low'),
    pdH:    g('pd-high'),      pdL:    g('pd-low'),
    onH:    g('on-high'),      onL:    g('on-low'),
    pvH:    g('pivot-h'),      pvL:    g('pivot-l'), pvC: g('pivot-c'),
    _pivot: null,
  };

  const win      = parseInt(document.getElementById('conf-window').value) || 2;
  const maxLvls  = parseInt(document.getElementById('max-levels').value)  || 15;

  const raw    = buildLevels(d);
  const anchor = d._pivot ?? d.onH ?? d.pdH;

  // Filter to ±60 pts of anchor, always keep pivot R/S
  const pivotTags = new Set(['tag-pivot','tag-r','tag-s']);
  const filtered = anchor !== null
    ? raw.filter(l => pivotTags.has(l.tag) || Math.abs(l.price - anchor) <= 60)
    : raw;

  const groups  = merge(filtered, win);
  const maxW    = groups[0]?.weight || 1;

  // Pin pivot group
  const pivotGroup = groups.find(g => g.members.some(m => m.tag === 'tag-pivot'));
  if (pivotGroup && d._pivot !== null) pivotGroup.price = d._pivot;

  // Split above/below pivot for balanced display
  let final;
  if (d._pivot !== null && pivotGroup) {
    const above = groups.filter(g => g !== pivotGroup && g.price > d._pivot)
                        .sort((a, b) => a.price - b.price);
    const below = groups.filter(g => g !== pivotGroup && g.price < d._pivot)
                        .sort((a, b) => b.price - a.price);
    const half  = Math.floor((maxLvls - 1) / 2);
    final = [
      ...above.slice(-half).reverse(),
      pivotGroup,
      ...below.slice(0, half),
    ];
  } else {
    final = groups.slice(0, maxLvls).sort((a, b) => b.price - a.price);
  }

  // Bias bar
  const biasBar = document.getElementById('bias-bar');
  if (d._pivot !== null && d.onH !== null && d.onL !== null) {
    const onMid = mid(d.onH, d.onL);
    biasBar.classList.remove('hidden', 'bull', 'bear', 'neut');
    if (onMid > d._pivot + 3)      { biasBar.classList.add('bull'); biasBar.textContent = `▲ Bullish — ON midpoint ${onMid} above pivot ${d._pivot}. Favor longs on pullbacks.`; }
    else if (onMid < d._pivot - 3) { biasBar.classList.add('bear'); biasBar.textContent = `▼ Bearish — ON midpoint ${onMid} below pivot ${d._pivot}. Favor shorts on rallies.`; }
    else                           { biasBar.classList.add('neut'); biasBar.textContent = `◆ Neutral — ON midpoint ${onMid} near pivot ${d._pivot}.`; }
  } else {
    biasBar.classList.add('hidden');
  }

  // Table
  let html = `<table class="levels-table">
    <thead><tr><th>#</th><th>Price</th><th>Strength</th><th>Sources</th></tr></thead><tbody>`;

  final.forEach((g, i) => {
    const isPvt = g.members.some(m => m.tag === 'tag-pivot');
    const tags  = g.members.map(m => tag(m.label, m.tag)).join('');
    html += `<tr>
      <td style="color:var(--muted);font-size:11px">${i+1}</td>
      <td><span class="price${isPvt ? ' is-pivot' : ''}">${g.price}</span></td>
      <td>${dots(g.weight, maxW)}</td>
      <td><div class="tags">${tags}</div></td>
    </tr>`;
  });

  html += '</tbody></table>';
  document.getElementById('levels-out').innerHTML = html;
}

// ─── Clear ────────────────────────────────────────────────────────────────────

function clearAll() {
  document.querySelectorAll('input[type=number]').forEach(el => {
    el.value = ''; el.classList.remove('filled');
  });
  document.getElementById('levels-out').innerHTML = '<p class="placeholder">Fetch data, enter pivot H·L·C, then Calculate.</p>';
  document.getElementById('bias-bar').classList.add('hidden');
  document.getElementById('auto-badge').classList.add('hidden');
  document.getElementById('fetch-status').textContent = '';
  document.getElementById('fetch-status').className = 'status';
  document.getElementById('pivot-preview').innerHTML = '';
}

// ─── Wire up ──────────────────────────────────────────────────────────────────

document.getElementById('calc-btn').addEventListener('click', calculate);
document.getElementById('clear-btn').addEventListener('click', clearAll);
document.querySelectorAll('input[type=number]').forEach(el =>
  el.addEventListener('keydown', e => { if (e.key === 'Enter') calculate(); })
);
