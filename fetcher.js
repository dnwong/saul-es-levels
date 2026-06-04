/**
 * fetcher.js — Yahoo Finance data fetcher for ES Key Levels Calculator
 */

const LOCAL_PROXY = '/proxy?url=';

// ─── ET timezone helpers ──────────────────────────────────────────────────────

function getETOffsetMs() {
  const now = new Date();
  const jan = new Date(now.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(now.getFullYear(), 6, 1).getTimezoneOffset();
  const isDST = now.getTimezoneOffset() < Math.max(jan, jul);
  return (isDST ? 4 : 5) * 3600000;
}

function toET(utcMs)  { return utcMs - getETOffsetMs(); }
function fromET(etMs) { return etMs  + getETOffsetMs(); }

function etDateStr(utcMs) {
  const d = new Date(toET(utcMs));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}

function etMidnightUTC(utcMs) {
  const d = new Date(toET(utcMs));
  d.setUTCHours(0, 0, 0, 0);
  return fromET(d.getTime());
}

// ─── Fetch wrapper ────────────────────────────────────────────────────────────

async function yahooFetch(symbol, interval, range, prePost = true) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=${interval}&range=${range}&includePrePost=${prePost}`;
  const res = await fetch(LOCAL_PROXY + encodeURIComponent(url), {
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json?.error) throw new Error(json.error);
  if (!json?.chart?.result?.[0]) throw new Error(json?.chart?.error?.description || 'No data');
  return json.chart.result[0];
}

// ─── Parse OHLC ───────────────────────────────────────────────────────────────

function parseOHLC(result) {
  const ts = result.timestamp;
  const q  = result.indicators.quote[0];
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.open[i] == null) continue;
    bars.push({ t: ts[i] * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
  }
  return bars;
}

// ─── Bollinger Bands (20-period, 2σ) ─────────────────────────────────────────

function bollingerBands(closes, period = 20, mult = 2) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean  = slice.reduce((s, v) => s + v, 0) / period;
  const sd    = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
  return { upper: round4(mean + mult*sd), middle: round4(mean), lower: round4(mean - mult*sd) };
}

function round4(v) { return Math.round(v * 4) / 4; }

// ─── Date range helpers ───────────────────────────────────────────────────────

function startOfYear(d)    { return new Date(d.getFullYear(), 0, 1); }
function startOfQuarter(d) { return new Date(d.getFullYear(), Math.floor(d.getMonth()/3)*3, 1); }
function startOfMonth(d)   { return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfWeek(d) {
  const day = d.getDay();
  const m = new Date(d);
  m.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  m.setHours(0, 0, 0, 0);
  return m;
}

function rangeHL(bars) {
  if (!bars.length) return { h: null, l: null };
  return {
    h: round4(Math.max(...bars.map(b => b.h))),
    l: round4(Math.min(...bars.map(b => b.l))),
  };
}

// ─── Main fetch & fill ────────────────────────────────────────────────────────

async function fetchAndFill(symbol) {
  setStatus('loading', `Fetching ${symbol}…`);

  // ── 1. Daily bars (2 years — enough for life/year/quarter/month/week) ─────
  let dailyBars;
  try {
    const result = await yahooFetch(symbol, '1d', '2y', true);
    dailyBars = parseOHLC(result);
  } catch (e) {
    setStatus('error', `Fetch failed: ${e.message}`);
    return;
  }
  if (!dailyBars.length) { setStatus('error', 'No data returned.'); return; }

  // ── 2. Intraday 5m bars (5 days) for overnight/late-day ──────────────────
  let intraBars = [];
  try {
    const result = await yahooFetch(symbol, '5m', '5d', true);
    intraBars = parseOHLC(result);
  } catch (e) {
    console.warn('Intraday fetch failed:', e.message);
  }

  // ── Timeframe H/L from daily bars ─────────────────────────────────────────
  const now      = new Date();
  const yearBars = dailyBars.filter(b => b.t >= startOfYear(now).getTime());
  const qtrBars  = dailyBars.filter(b => b.t >= startOfQuarter(now).getTime());
  const monBars  = dailyBars.filter(b => b.t >= startOfMonth(now).getTime());
  const wkBars   = dailyBars.filter(b => b.t >= startOfWeek(now).getTime());

  const life    = rangeHL(dailyBars);
  const year    = rangeHL(yearBars);
  const quarter = rangeHL(qtrBars);
  const month   = rangeHL(monBars);
  const week    = rangeHL(wkBars);

  // ── Prev day bar ──────────────────────────────────────────────────────────
  // Always skip today's bar — we want the last fully completed session.
  const todayETStr = etDateStr(now.getTime());
  let prevDayBar = null;
  for (let i = dailyBars.length - 1; i >= 0; i--) {
    if (etDateStr(dailyBars[i].t) < todayETStr) { prevDayBar = dailyBars[i]; break; }
  }
  if (!prevDayBar) prevDayBar = dailyBars[dailyBars.length - 1];

  // ── Prev day RTH OHLC from 5m intraday bars ───────────────────────────────
  // Saul uses RTH-only H/L/O/C (9:30am–4:15pm ET), not the full Globex session.
  // This gives a narrower, more accurate range for pivot calculation.
  let prevRTHClose = null, prevRTHHigh = null, prevRTHLow = null, prevRTHOpen = null;
  if (intraBars.length > 0 && prevDayBar) {
    const prevDateStr = etDateStr(prevDayBar.t);
    const prevMidnightUTC = etMidnightUTC(prevDayBar.t);
    const rthStart = prevMidnightUTC + 9.5  * 3600000;
    const rthEnd   = prevMidnightUTC + 16.25 * 3600000;
    const rthBars  = intraBars
      .filter(b => etDateStr(b.t) === prevDateStr && b.t >= rthStart && b.t <= rthEnd)
      .sort((a, b) => a.t - b.t);
    if (rthBars.length >= 10) {
      prevRTHOpen  = round4(rthBars[0].o);
      prevRTHClose = round4(rthBars[rthBars.length - 1].c);
      prevRTHHigh  = round4(Math.max(...rthBars.map(b => b.h)));
      prevRTHLow   = round4(Math.min(...rthBars.map(b => b.l)));
    }
  }

  // ── Bollinger Bands ───────────────────────────────────────────────────────
  const bb = bollingerBands(dailyBars.map(b => b.c));

  // ── Overnight & late-day from intraday bars ───────────────────────────────
  const RTH_START = 9.5   * 3600000;  // 9:30am ET in ms
  const RTH_END   = 16.25 * 3600000;  // 4:15pm ET in ms

  // Group intraday bars by ET date, find last complete session
  const barsByDate = {};
  for (const b of intraBars) {
    const key = etDateStr(b.t);
    if (!barsByDate[key]) barsByDate[key] = [];
    barsByDate[key].push(b);
  }

  let prevRTHBars = [], prevSessionKey = null;
  for (const dateKey of Object.keys(barsByDate).sort().reverse()) {
    if (dateKey === todayETStr) continue;
    const midnight = etMidnightUTC(barsByDate[dateKey][0].t);
    const rth = barsByDate[dateKey].filter(b => {
      const off = b.t - midnight;
      return off >= RTH_START && off <= RTH_END;
    });
    console.log(`  ${dateKey}: ${barsByDate[dateKey].length} total, ${rth.length} RTH bars`);
    if (rth.length >= 5) { prevRTHBars = rth; prevSessionKey = dateKey; break; }
  }
  console.log('Today ET:', todayETStr, '| Prev session:', prevSessionKey);

  const todayMidnight = etMidnightUTC(now.getTime());
  const prevMidnight  = prevRTHBars.length ? etMidnightUTC(prevRTHBars[0].t) : todayMidnight - 86400000;

  const onBars = intraBars.filter(b => b.t > prevMidnight + RTH_END   && b.t <= todayMidnight + RTH_START);
  // Late day: PREVIOUS trading day 3:30pm–4:15pm ET (Saul's pivot window)
  const ldBars = intraBars.filter(b => b.t >= prevMidnight + 15.5*3600000 && b.t <= prevMidnight + 16.25*3600000);

  const overnight = rangeHL(onBars);
  const ldHL      = rangeHL(ldBars);
  // Late-day close = last bar at or before 4pm ET
  const ldClose   = ldBars.length ? round4(ldBars[ldBars.length - 1].c) : null;

  // ── Fill inputs ───────────────────────────────────────────────────────────
  const fields = {
    'life-high':      life.h,
    'life-low':       life.l,
    'year-high':      year.h,
    'year-low':       year.l,
    'quarter-high':   quarter.h,
    'quarter-low':    quarter.l,
    'month-high':     month.h,
    'month-low':      month.l,
    'week-high':      week.h,
    'week-low':       week.l,
    'prevday-high':   prevRTHHigh  ?? (prevDayBar ? round4(prevDayBar.h) : null),
    'prevday-low':    prevRTHLow   ?? (prevDayBar ? round4(prevDayBar.l) : null),
    'prevday-close':  null,   // must be entered manually — RTH close (4:15pm ET)
    'prevday-open':   prevRTHOpen  ?? (prevDayBar ? round4(prevDayBar.o) : null),
    'overnight-high': overnight.h,
    'overnight-low':  overnight.l,
    'lateday-high':   ldHL.h,
    'lateday-low':    ldHL.l,
    'lateday-close':  ldClose,
    'bb-upper':       bb ? bb.upper  : null,
    'bb-middle':      bb ? bb.middle : null,
    'bb-lower':       bb ? bb.lower  : null,
  };

  let filled = 0;
  for (const [id, val] of Object.entries(fields)) {
    const el = document.getElementById(id);
    if (el && val !== null) { el.value = val; el.classList.add('auto-filled'); filled++; }
  }

  document.getElementById('auto-badge').classList.remove('hidden');
  const rthNote = prevRTHHigh ? ` · RTH ${etDateStr(prevDayBar.t)}` : (prevDayBar ? ` · Globex ${etDateStr(prevDayBar.t)}` : '');
  const onNote  = onBars.length === 0 ? ' · overnight unavailable' : '';
  setStatus('ok', `Filled ${filled} fields${rthNote}${onNote} · enter RTH close to get pivot`);
}

// ─── Status & button ──────────────────────────────────────────────────────────

function setStatus(type, msg) {
  const el = document.getElementById('fetch-status');
  el.textContent = msg;
  el.className = 'fetch-status ' + type;
}

document.getElementById('fetch-btn').addEventListener('click', () => {
  fetchAndFill(document.getElementById('symbol-input').value.trim() || 'ES=F');
});
