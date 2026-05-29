/**
 * fetcher.js — Yahoo Finance data fetcher for ES Key Levels Calculator
 *
 * Uses Yahoo Finance v8 chart API via allorigins CORS proxy.
 * Fetches:
 *   - 5y daily bars  → year, quarter, month, prev-day OHLC + life H/L + Bollinger Bands
 *   - 5d 5m bars     → overnight H/L and late-day (2–4 pm ET) H/L
 */

// Local proxy server (server.py) — no rate limits, no CORS issues
const LOCAL_PROXY = '/proxy?url=';

// ─── Fetch wrapper ────────────────────────────────────────────────────────────

async function yahooFetch(symbol, interval, range, prePost = true) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=${interval}&range=${range}&includePrePost=${prePost}`;

  const res = await fetch(LOCAL_PROXY + encodeURIComponent(url), {
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();

  if (json?.error) throw new Error(json.error);
  if (!json?.chart?.result?.[0]) {
    throw new Error(json?.chart?.error?.description || 'No data returned');
  }
  return json.chart.result[0];
}

// ─── Parse OHLC arrays from Yahoo result ─────────────────────────────────────

function parseOHLC(result) {
  const ts    = result.timestamp;
  const q     = result.indicators.quote[0];
  const bars  = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.open[i] == null) continue;
    bars.push({
      t: ts[i] * 1000,          // ms
      o: q.open[i],
      h: q.high[i],
      l: q.low[i],
      c: q.close[i],
    });
  }
  return bars;
}

// ─── Bollinger Bands (20-period, 2σ) on close prices ─────────────────────────

function bollingerBands(closes, period = 20, mult = 2) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean  = slice.reduce((s, v) => s + v, 0) / period;
  const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return {
    upper:  round4(mean + mult * sd),
    middle: round4(mean),
    lower:  round4(mean - mult * sd),
  };
}

function round4(v) { return Math.round(v * 4) / 4; }

// ─── Date helpers ─────────────────────────────────────────────────────────────

function startOfYear(d)    { return new Date(d.getFullYear(), 0, 1); }
function startOfQuarter(d) { return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1); }
function startOfMonth(d)   { return new Date(d.getFullYear(), d.getMonth(), 1); }

/** Monday of the week containing d */
function startOfWeek(d) {
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(d);
  m.setDate(d.getDate() + diff);
  m.setHours(0, 0, 0, 0);
  return m;
}

// ─── Main fetch & fill ────────────────────────────────────────────────────────

async function fetchAndFill(symbol) {
  setStatus('loading', `Fetching ${symbol} (trying proxies…)`);

  let dailyBars, intraBars;

  // ── 1. Daily bars (5 years) ───────────────────────────────────────────────
  try {
    const dailyResult = await yahooFetch(symbol, '1d', '5y');
    dailyBars = parseOHLC(dailyResult);
  } catch (e) {
    setStatus('error', `Fetch failed: ${e.message}. Check your internet connection or try again.`);
    return;
  }

  if (dailyBars.length === 0) {
    setStatus('error', 'No daily bars returned. Check symbol.');
    return;
  }

  // ── 2. Intraday 5m bars — RTH only, 1 month range for reliable prev session
  try {
    const intraResult = await yahooFetch(symbol, '5m', '1mo', false);
    intraBars = parseOHLC(intraResult);
  } catch (e) {
    intraBars = [];
    console.warn('Intraday fetch failed:', e.message);
  }

  // ── Derive timeframe H/L from daily bars ──────────────────────────────────
  const now   = new Date();
  const yrStart  = startOfYear(now).getTime();
  const qtrStart = startOfQuarter(now).getTime();
  const moStart  = startOfMonth(now).getTime();
  const wkStart  = startOfWeek(now).getTime();

  const yearBars    = dailyBars.filter(b => b.t >= yrStart);
  const quarterBars = dailyBars.filter(b => b.t >= qtrStart);
  const monthBars   = dailyBars.filter(b => b.t >= moStart);
  const weekBars    = dailyBars.filter(b => b.t >= wkStart);

  // Previous trading day = last completed bar
  // (last bar may be today's partial — use second-to-last if today is a trading day)
  const todayStr = now.toDateString();
  let prevDayBar = null;
  for (let i = dailyBars.length - 1; i >= 0; i--) {
    const barDate = new Date(dailyBars[i].t).toDateString();
    if (barDate !== todayStr) { prevDayBar = dailyBars[i]; break; }
  }
  // Fallback: just use last bar
  if (!prevDayBar) prevDayBar = dailyBars[dailyBars.length - 1];

  function rangeHL(bars) {
    if (!bars.length) return { h: null, l: null };
    return {
      h: round4(Math.max(...bars.map(b => b.h))),
      l: round4(Math.min(...bars.map(b => b.l))),
    };
  }

  const life    = rangeHL(dailyBars);
  const year    = rangeHL(yearBars);
  const quarter = rangeHL(quarterBars);
  const month   = rangeHL(monthBars);
  const week    = rangeHL(weekBars);

  // ── Bollinger Bands from daily closes ─────────────────────────────────────
  const closes = dailyBars.map(b => b.c);
  const bb = bollingerBands(closes);

  // ── Overnight & late-day from intraday bars ───────────────────────────────
  // ET offset: detect DST
  const janOffset = new Date(now.getFullYear(), 0, 1).getTimezoneOffset();
  const julOffset = new Date(now.getFullYear(), 6, 1).getTimezoneOffset();
  const isDST = now.getTimezoneOffset() < Math.max(janOffset, julOffset);
  const ET_OFFSET_MS = (isDST ? 4 : 5) * 3600 * 1000;

  function toET(ms) { return ms - ET_OFFSET_MS; }
  function fromET(etMs) { return etMs + ET_OFFSET_MS; }

  // RTH = 9:30am–4:15pm ET (in ms from midnight)
  const RTH_START_MS = 9.5   * 3600000;
  const RTH_END_MS   = 16.25 * 3600000;

  // Group intraday bars by ET calendar date
  function etDateKey(utcMs) {
    const d = new Date(toET(utcMs));
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function etMidnightUTC(utcMs) {
    const d = new Date(toET(utcMs));
    d.setHours(0, 0, 0, 0);
    return fromET(d.getTime());
  }

  const barsByDate = {};
  for (const b of intraBars) {
    const key = etDateKey(b.t);
    if (!barsByDate[key]) barsByDate[key] = [];
    barsByDate[key].push(b);
  }

  const nowDateKey = etDateKey(now.getTime());
  const sortedDates = Object.keys(barsByDate).sort().reverse(); // newest first

  // Find last complete RTH session (not today, at least 20 bars in RTH window)
  let prevRTHBars = [];
  let prevSessionKey = null;

  for (const dateKey of sortedDates) {
    if (dateKey === nowDateKey) continue;
    const bars = barsByDate[dateKey];
    const midnight = etMidnightUTC(bars[0].t);
    const rth = bars.filter(b => {
      const off = b.t - midnight;
      return off >= RTH_START_MS && off <= RTH_END_MS;
    });
    if (rth.length >= 20) {
      prevRTHBars = rth;
      prevSessionKey = dateKey;
      break;
    }
  }

  // Overnight: prev session close (4:15pm ET) → today open (9:30am ET)
  const todayMidnightUTC = etMidnightUTC(now.getTime());
  const onEnd   = todayMidnightUTC + RTH_START_MS;
  const onStart = prevRTHBars.length > 0
    ? etMidnightUTC(prevRTHBars[0].t) + RTH_END_MS
    : todayMidnightUTC - 86400000 + RTH_END_MS;

  // Late day: prev session 2:00pm–4:00pm ET
  const ldStart = prevRTHBars.length > 0
    ? etMidnightUTC(prevRTHBars[0].t) + 14 * 3600000
    : todayMidnightUTC - 86400000 + 14 * 3600000;
  const ldEnd = prevRTHBars.length > 0
    ? etMidnightUTC(prevRTHBars[0].t) + 16 * 3600000
    : todayMidnightUTC - 86400000 + 16 * 3600000;

  const onBars = intraBars.filter(b => b.t > onStart && b.t <= onEnd);
  const ldBars = intraBars.filter(b => b.t >= ldStart && b.t <= ldEnd);

  const overnight = rangeHL(onBars);
  const lateday   = rangeHL(ldBars);

  // ── Prev day RTH OHLC (for accurate pivot calculation) ────────────────────
  let prevH, prevL, prevC, prevO;
  if (prevRTHBars.length > 0) {
    prevH = round4(Math.max(...prevRTHBars.map(b => b.h)));
    prevL = round4(Math.min(...prevRTHBars.map(b => b.l)));
    prevO = round4(prevRTHBars[0].o);
    prevC = round4(prevRTHBars[prevRTHBars.length - 1].c);
  } else {
    // Fallback to daily bar
    prevH = prevDayBar ? round4(prevDayBar.h) : null;
    prevL = prevDayBar ? round4(prevDayBar.l) : null;
    prevC = prevDayBar ? round4(prevDayBar.c) : null;
    prevO = prevDayBar ? round4(prevDayBar.o) : null;
  }

  // ── Fill inputs ───────────────────────────────────────────────────────────
  const fields = {
    'life-high':     life.h,
    'life-low':      life.l,
    'year-high':     year.h,
    'year-low':      year.l,
    'quarter-high':  quarter.h,
    'quarter-low':   quarter.l,
    'month-high':    month.h,
    'month-low':     month.l,
    'week-high':     week.h,
    'week-low':      week.l,
    'prevday-high':  prevH,
    'prevday-low':   prevL,
    'prevday-close': prevC,
    'prevday-open':  prevO,
    'overnight-high': overnight.h,
    'overnight-low':  overnight.l,
    'lateday-high':  lateday.h,
    'lateday-low':   lateday.l,
    'bb-upper':  bb ? bb.upper  : null,
    'bb-middle': bb ? bb.middle : null,
    'bb-lower':  bb ? bb.lower  : null,
  };

  let filled = 0;
  for (const [id, val] of Object.entries(fields)) {
    const el = document.getElementById(id);
    if (el && val !== null) {
      el.value = val;
      el.classList.add('auto-filled');
      filled++;
    }
  }

  document.getElementById('auto-badge').classList.remove('hidden');

  const onNote = onBars.length === 0 ? ' (overnight unavailable)' : '';
  const rthNote = prevSessionKey ? ` · RTH ${prevSessionKey}` : ' · daily bar fallback';
  setStatus('ok', `Filled ${filled} fields from Yahoo Finance${rthNote}${onNote}`);
}

// ─── Status helper ────────────────────────────────────────────────────────────

function setStatus(type, msg) {
  const el = document.getElementById('fetch-status');
  el.textContent = msg;
  el.className = 'fetch-status ' + type;
}

// ─── Wire up button ───────────────────────────────────────────────────────────

document.getElementById('fetch-btn').addEventListener('click', () => {
  const sym = document.getElementById('symbol-input').value.trim() || 'ES=F';
  fetchAndFill(sym);
});
