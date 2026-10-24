"""Launch the local BQL lab; no market query occurs until a page button click."""
from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import secrets
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import webbrowser

from build import build, DIST, ROOT


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--no-open', action='store_true')
    parser.add_argument('--bql-python', type=Path, default=ROOT / '.venv-bql/Scripts/python.exe')
    args = parser.parse_args()
    if not args.bql_python.is_file():
        parser.error('BQL Python environment is missing; follow BQL_DIAGNOSTICS.md installation steps')
    build()
    server = ThreadingHTTPServer(('127.0.0.1', 8767), partial(Handler, directory=str(DIST)))
    token = secrets.token_hex(32)
    bridge = subprocess.Popen([
        sys.executable, str(ROOT / 'scripts/bloomberg_bridge.py'), '--port', '8768',
        '--token', token, '--bql-python', str(args.bql_python.resolve()),
        '--provider', 'polars-bloomberg', '--supported-runtime-confirmed', '--enable-preview',
    ], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    try:
        time.sleep(1)
        if bridge.poll() is not None:
            raise RuntimeError('Bridge could not start; another service may be using port 8768')
        request = urllib.request.Request('http://127.0.0.1:8768/health', headers={
            'Authorization': f'Bearer {token}', 'Origin': 'http://127.0.0.1:8767',
        })
        with urllib.request.urlopen(request, timeout=25) as response:
            health = json.load(response)
        if not health.get('ready') or not health.get('preview_enabled'):
            raise RuntimeError('BQL environment is unavailable; no market query was sent')
        url = f'http://127.0.0.1:8767/#bbg-token={token}'
        print('BQL_LAB_SESSION=' + json.dumps({'url': url, 'bridge_pid': bridge.pid}), flush=True)
        if not args.no_open:
            webbrowser.open(url)
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        if bridge.poll() is None:
            bridge.terminate()
            bridge.wait(timeout=10)


if __name__ == '__main__':
    main()
