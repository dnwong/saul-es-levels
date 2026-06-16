"""
Local proxy server for ES Key Levels Calculator.
Fetches Yahoo Finance data server-side (no CORS issues).

Usage:
    python server.py

Then open http://localhost:8080 in your browser.
Debug raw Yahoo data: http://localhost:8080/debug?symbol=ES=F&interval=1d&range=1mo&prepost=false
"""

import json
import os
import urllib.request
import urllib.parse
from http.server import HTTPServer, SimpleHTTPRequestHandler

TWELVEDATA_KEY = os.environ.get('TWELVEDATA_API_KEY', '')

YAHOO_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        try:
            if int(args[1]) >= 400:
                print(f"[{args[0]}] {args[1]}")
        except (ValueError, IndexError):
            pass

    def do_GET(self):
        # ── Proxy endpoint ────────────────────────────────────────────────────
        if self.path.startswith("/proxy?"):
            parsed = urllib.parse.urlparse(self.path)
            params = urllib.parse.parse_qs(parsed.query)
            target = params.get("url", [None])[0]

            if not target or "finance.yahoo.com" not in target:
                self._respond(400, {"error": "Invalid or missing url param"})
                return

            try:
                req = urllib.request.Request(target, headers=YAHOO_HEADERS)
                with urllib.request.urlopen(req, timeout=15) as resp:
                    raw = resp.read()
                data = json.loads(raw)
                try:
                    r = data['chart']['result'][0]
                    meta = r.get('meta', {})
                    bars = r.get('timestamp', [])
                    q = r['indicators']['quote'][0]
                    # Log last bar OHLC for debugging
                    if bars:
                        import datetime
                        last_t = datetime.datetime.fromtimestamp(bars[-1], tz=datetime.timezone.utc).strftime('%Y-%m-%d')
                        prev_t = datetime.datetime.fromtimestamp(bars[-2], tz=datetime.timezone.utc).strftime('%Y-%m-%d') if len(bars) > 1 else '?'
                        print(f"[proxy] {meta.get('symbol')} {meta.get('dataGranularity')} "
                              f"bars={len(bars)} "
                              f"prev({prev_t}) H={q['high'][-2]:.2f} L={q['low'][-2]:.2f} "
                              f"C={q['close'][-2]:.2f} O={q['open'][-2]:.2f}")
                except Exception as e:
                    print(f"[proxy] log error: {e}")
                self._respond(200, data)
            except urllib.error.HTTPError as e:
                self._respond(e.code, {"error": str(e)})
            except Exception as e:
                self._respond(500, {"error": str(e)})
            return

        # ── TwelveData symbol search: /td-search?q=ES ────────────────────────
        if self.path.startswith("/td-search?"):
            if not TWELVEDATA_KEY:
                self._respond(503, {"error": "TWELVEDATA_API_KEY not configured"})
                return
            parsed = urllib.parse.urlparse(self.path)
            params = urllib.parse.parse_qs(parsed.query)
            q = params.get("q", ["ES"])[0]
            url = f"https://api.twelvedata.com/symbol_search?symbol={urllib.parse.quote(q)}&apikey={TWELVEDATA_KEY}"
            try:
                req = urllib.request.Request(url, headers={"Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=15) as resp:
                    raw = resp.read()
                data = json.loads(raw)
                # Filter to futures only
                futures = [d for d in data.get('data', []) if d.get('instrument_type') == 'Futures']
                self._respond(200, {"futures": futures[:20]})
            except Exception as e:
                self._respond(500, {"error": str(e)})
            return

        # ── TwelveData proxy: /td?symbol=ES/USD&interval=1day&outputsize=30 ─────
        if self.path.startswith("/td?"):
            if not TWELVEDATA_KEY:
                self._respond(503, {"error": "TWELVEDATA_API_KEY not configured"})
                return
            parsed = urllib.parse.urlparse(self.path)
            params = urllib.parse.parse_qs(parsed.query)
            # Build TwelveData URL, injecting the API key server-side
            qs = urllib.parse.urlencode({k: v[0] for k, v in params.items()})
            url = f"https://api.twelvedata.com/time_series?{qs}&apikey={TWELVEDATA_KEY}"
            try:
                req = urllib.request.Request(url, headers={"Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=15) as resp:
                    raw = resp.read()
                data = json.loads(raw)
                print(f"[td] {params.get('symbol',['?'])[0]} status={data.get('status','?')} code={data.get('code','')}")
                self._respond(200, data)
            except urllib.error.HTTPError as e:
                body = e.read().decode()
                print(f"[td] HTTP error {e.code}: {body[:200]}")
                self._respond(e.code, {"error": str(e), "detail": body[:500]})
            except Exception as e:
                print(f"[td] Error: {e}")
                self._respond(500, {"error": str(e)})
            return

        # ── Debug endpoint: /debug?symbol=ES=F&interval=1d&range=1mo&prepost=false
        if self.path.startswith("/debug?"):
            parsed = urllib.parse.urlparse(self.path)
            params = urllib.parse.parse_qs(parsed.query)
            symbol   = params.get("symbol",   ["ES=F"])[0]
            interval = params.get("interval", ["1d"])[0]
            range_   = params.get("range",    ["1mo"])[0]
            prepost  = params.get("prepost",  ["true"])[0]

            url = (f"https://query1.finance.yahoo.com/v8/finance/chart/"
                   f"{urllib.parse.quote(symbol)}"
                   f"?interval={interval}&range={range_}&includePrePost={prepost}")
            try:
                req = urllib.request.Request(url, headers=YAHOO_HEADERS)
                with urllib.request.urlopen(req, timeout=15) as resp:
                    raw = resp.read()
                data = json.loads(raw)
                r = data['chart']['result'][0]
                ts = r['timestamp']
                q  = r['indicators']['quote'][0]
                import datetime
                rows = []
                for i in range(max(0, len(ts)-10), len(ts)):
                    d = datetime.datetime.fromtimestamp(ts[i], tz=datetime.timezone.utc).strftime('%Y-%m-%d %H:%M')
                    rows.append({
                        "date": d,
                        "open":  round(q['open'][i] or 0, 2),
                        "high":  round(q['high'][i] or 0, 2),
                        "low":   round(q['low'][i]  or 0, 2),
                        "close": round(q['close'][i] or 0, 2),
                    })
                self._respond(200, {"symbol": symbol, "interval": interval,
                                    "range": range_, "prepost": prepost,
                                    "total_bars": len(ts), "last_10": rows})
            except Exception as e:
                self._respond(500, {"error": str(e)})
            return

        # ── Serve static files ────────────────────────────────────────────────
        super().do_GET()

    def _respond(self, status, payload):
        body = json.dumps(payload, indent=2).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 8080))
    host = os.environ.get("HOST", "0.0.0.0")
    print(f"Starting server on {host}:{port}")
    print("Press Ctrl+C to stop.\n")
    HTTPServer((host, port), Handler).serve_forever()
