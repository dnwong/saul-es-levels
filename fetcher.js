/**
 * fetcher.js — fetches multi-timeframe OHLC from Yahoo Finance
 * Auto-fills: year/quarter/month/week/prevday/overnight H·L
 * User enters pivot H·L·C manually from their broker
 */

const PROXY = '/proxy?url=';

async function yFetch(symbol, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=${interval}&range=${range}&includePrePost=true`;
  const res = await fetch(PROXY + encodeURIComponent(url), { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (j?.error) throw new Error(j.error);
  if (!j?.chart?.result?.[0]) throw new Error(j?.chart?.error?.description || 'No data');
  return j.chart.result[0];
}

function parseBars(result) {
  const ts = result.timestamp;
  const q  = result.indicators.quote[0];
  return ts.reduce((acc, t, i) => {
    if (q.open[i] != null)
      acc.push({ t: t * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
    return acc;
  }, []);
}

function hl(bars) {
  if (!bars.length) return { h: null, l: null };
  return {
    h: Math.round(Math.max(...bars.map(b => b.h))),
    l: Math.round(Math.min(...bars.map(b => b.l))),
  };
}

// ET timezone helpers
function etOffset() {
  const now = new Date();
  const isDST = now.getTimezoneOffset() < Math.max(
    new Date(now.getFullYear(), 0, 1).getTimezoneOffset(),
    new Date(now.getFullYear(), 6, 1).getTimezoneOffset()
  );
  return (isDST ? 4 : 5) * 3600000;
}

function etDateStr(utcMs) {
  const d = new Date(utcMs - etOffset());
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}

function etMidnight(utcMs) {
  const off = etOffset();
  const d = new Date(utcMs - off);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() + off;
}

function startOf(type, now) {
  switch (type) {
    case 'year':    return new Date(now.getFullYear(), 0, 1).getTime();
    case 'quarter': return new Date(now.getFullYear(), Math.floor(now.getMonth()/3)*3, 1).getTime();
    case 'month':   return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    case 'week': {
      const d = new Date(now); const day = d.getDay();
      d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day)); d.setHours(0,0,0,0);
      return d.getTime();
    }
  }
}

function setField(id, val) {
  const el = document.getElementById(id);
  if (!el || val === null) return;
  el.value = val;
  el.classList.add('filled');
}

async function fetchData() {
  const sym = document.getElementById('symbol-input').value.trim() || 'ES=F';
  setStatus('loading', `Fetching ${sym}…`);

  let daily, intra;

  try {
    daily = parseBars(await yFetch(sym, '1d', '2y'));
  } catch(e) {
    setStatus('error', `Failed: ${e.message}`); return;
  }

  try {
    intra = parseBars(await yFetch(sym, '5m', '5d'));
  } catch(e) {
    intra = [];
  }

  const now   = new Date();
  const today = etDateStr(now.getTime());

  // Multi-timeframe H/L from daily bars
  const yr  = hl(daily.filter(b => b.t >= startOf('year',    now)));
  const qtr = hl(daily.filter(b => b.t >= startOf('quarter', now)));
  const mo  = hl(daily.filter(b => b.t >= startOf('month',   now)));
  const wk  = hl(daily.filter(b => b.t >= startOf('week',    now)));

  // Previous trading day bar (skip today's partial bar)
  let pdBar = null;
  for (let i = daily.length - 1; i >= 0; i--) {
    if (etDateStr(daily[i].t) < today) { pdBar = daily[i]; break; }
  }
  if (!pdBar) pdBar = daily[daily.length - 1];

  // Overnight: prev RTH close → today RTH open (18:00 ET prev → 09:30 ET today)
  const todayMid = etMidnight(now.getTime());
  const prevMid  = pdBar ? etMidnight(pdBar.t) : todayMid - 86400000;
  const onBars   = intra.filter(b => b.t > prevMid + 16.25*3600000 && b.t <= todayMid + 9.5*3600000);
  const on       = hl(onBars);

  // Fill fields
  setField('year-high',     yr.h);  setField('year-low',     yr.l);
  setField('quarter-high',  qtr.h); setField('quarter-low',  qtr.l);
  setField('month-high',    mo.h);  setField('month-low',    mo.l);
  setField('week-high',     wk.h);  setField('week-low',     wk.l);
  setField('pd-high',  pdBar ? Math.round(pdBar.h) : null);
  setField('pd-low',   pdBar ? Math.round(pdBar.l) : null);
  setField('on-high',  on.h);
  setField('on-low',   on.l);

  document.getElementById('auto-badge').classList.remove('hidden');

  const onNote = on.h ? '' : ' · overnight unavailable';
  const pdNote = pdBar ? ` · prev day ${etDateStr(pdBar.t)}` : '';
  setStatus('ok', `Filled${pdNote}${onNote} · enter pivot H·L·C`);
}

function setStatus(type, msg) {
  const el = document.getElementById('fetch-status');
  el.textContent = msg;
  el.className = 'status ' + type;
}

document.getElementById('fetch-btn').addEventListener('click', fetchData);
