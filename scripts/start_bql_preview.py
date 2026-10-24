"""Open the production BQL preview with a temporary loopback connection."""
from pathlib import Path
import argparse
import json
import secrets
import subprocess
import sys
import time
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
SITE = 'https://creditbase02.github.io/rv-dashboard/bql.html'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bql-python', type=Path, default=ROOT / '.venv-bql/Scripts/python.exe')
    parser.add_argument('--provider', choices=('bql', 'polars-bloomberg'), default='polars-bloomberg')
    args = parser.parse_args()
    if not args.bql_python.is_file():
        parser.error('BQL Python is missing; follow BQL_DIAGNOSTICS.md setup first')
    token = secrets.token_hex(32)
    bridge = subprocess.Popen([
        sys.executable, str(ROOT/'scripts/bloomberg_bridge.py'), '--token', token,
        '--bql-python', str(args.bql_python.resolve()), '--provider', args.provider,
        '--supported-runtime-confirmed', '--enable-preview',
    ], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    try:
        time.sleep(1)
        if bridge.poll() is not None:
            raise RuntimeError('Port 8768 is in use. Stop the previous local lab or bridge first.')
        request = urllib.request.Request('http://127.0.0.1:8768/health', headers={
            'Origin': 'https://creditbase02.github.io', 'Authorization': f'Bearer {token}',
        })
        with urllib.request.urlopen(request, timeout=25) as response:
            status = json.load(response)
        if not status.get('ready') or not status.get('preview_enabled'):
            raise RuntimeError('Bloomberg environment unavailable; no market query was sent.')
        webbrowser.open(f'{SITE}#bbg-token={token}')
        print('BQL preview ready. Keep this window open; Ctrl+C stops the local bridge.')
        print('No market query is sent until you click the page button.')
        bridge.wait()
    except KeyboardInterrupt:
        pass
    finally:
        if bridge.poll() is None:
            bridge.terminate()
            bridge.wait(timeout=10)


if __name__ == '__main__':
    main()
