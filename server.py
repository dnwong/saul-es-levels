"""
Local proxy server for ES Key Levels Calculator.
Fetches Yahoo Finance data server-side (no CORS issues).

Usage:
    python server.py

Then open http://localhost:8080 in your browser.
"""

import json
import urllib.request
import urllib.parse
from http.server import HTTPServer, SimpleHTTPRequestHandler

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
        # Suppress default access log noise; only print errors
        if int(args[1]) >= 400:
            print(f"[{args[0]}] {args[1]}")

    def do_GET(self):
        # ── Proxy endpoint: /proxy?url=<encoded_yahoo_url> ────────────────────
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
                self._respond(200, data)
            except urllib.error.HTTPError as e:
                self._respond(e.code, {"error": str(e)})
            except Exception as e:
                self._respond(500, {"error": str(e)})
            return

        # ── Serve static files (index.html, js, css) ─────────────────────────
        super().do_GET()

    def _respond(self, status, payload):
        body = json.dumps(payload).encode()
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
