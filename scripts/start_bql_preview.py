"""Open the production BQL preview with a temporary loopback connection."""
from pathlib import Path
import argparse
import json
import secrets
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
SITE = 'https://creditbase02.github.io/rv-dashboard/bql.html'
PEER_MAPPING_URL = 'https://creditbase02.github.io/rv-dashboard/assets/luac-peer-definitions.json'


def open_peer_mapping():
    """Retry only the known enterprise CA strict-mode incompatibility."""
    try:
        return urllib.request.urlopen(PEER_MAPPING_URL, timeout=25)
    except urllib.error.URLError as error:
        reason = error.reason
        if (not isinstance(reason, ssl.SSLCertVerificationError)
                or 'Basic Constraints of CA cert not marked critical' not in str(reason)
                or not hasattr(ssl, 'VERIFY_X509_STRICT')):
            raise
        context = ssl.create_default_context()
        context.verify_flags &= ~ssl.VERIFY_X509_STRICT
        return urllib.request.urlopen(PEER_MAPPING_URL, context=context, timeout=25)


def bundle_peer_mapping():
    """Fetch public classifications once; never fetch a quote snapshot."""
    sys.path.insert(0, str(ROOT))
    from peer_data import validate_peer_definitions
    with open_peer_mapping() as response:
        raw = response.read(256 * 1024 + 1)
    if len(raw) > 256 * 1024:
        raise ValueError('Peer mapping exceeds size limit')
    definitions = json.loads(raw)
    validate_peer_definitions(definitions)
    path = ROOT / 'assets/peer-definitions.json'
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(definitions, ensure_ascii=False), encoding='utf-8')
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bql-python', type=Path, default=ROOT / '.venv-bql/Scripts/python.exe')
    parser.add_argument('--provider', choices=('bql', 'polars-bloomberg'), default='polars-bloomberg')
    args = parser.parse_args()
    if not args.bql_python.is_file():
        parser.error('BQL Python is missing. Run Setup.cmd first, then Start.cmd.')
    mapping_args = []
    if (ROOT / 'standalone-launcher.txt').is_file():
        try:
            mapping = bundle_peer_mapping()
        except (urllib.error.URLError, TimeoutError) as error:
            raise RuntimeError('mapping_download_failed: Could not download public Peer Group mapping; check network and TLS certificates. Bridge has not started.') from error
        except (ValueError, TypeError) as error:
            raise RuntimeError('mapping_validation_failed: Public Peer Group mapping is invalid. Bridge has not started.') from error
        mapping_args = ['--peer-definitions', str(mapping)]
    token = secrets.token_hex(32)
    bridge = subprocess.Popen([
        sys.executable, str(ROOT/'scripts/bloomberg_bridge.py'), '--token', token,
        '--bql-python', str(args.bql_python.resolve()), '--provider', args.provider,
        '--supported-runtime-confirmed', '--enable-preview',
    ] + mapping_args, cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
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
