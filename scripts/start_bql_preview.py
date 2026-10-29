"""Open the production BQL preview with a temporary loopback connection."""
from pathlib import Path
import argparse
import json
import os
import socket
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


def local_request(token, stop=False):
    """Loopback control must never go through a corporate proxy."""
    request = urllib.request.Request(
        'http://127.0.0.1:8768/launcher/stop' if stop else 'http://127.0.0.1:8768/health',
        data=b'{}' if stop else None,
        headers={'Origin': 'https://creditbase02.github.io',
                 'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=20) as response:
        return json.load(response)


def port_in_use():
    with socket.socket() as connection:
        connection.settimeout(1)
        return connection.connect_ex(('127.0.0.1', 8768)) == 0


def read_session():
    try:
        data = json.loads((ROOT / '.bql-session.json').read_text(encoding='utf-8'))
        token = data['token']
        if not isinstance(token, str) or len(token) != 64 or any(c not in '0123456789abcdef' for c in token):
            return None
        return token
    except (OSError, ValueError, KeyError, TypeError):
        return None


def existing_session(reset=False):
    if not port_in_use():
        return False
    token = read_session()
    try:
        status = local_request(token) if token else {}
    except (OSError, ValueError):
        status = {}
    if status.get('launcher_managed') is not True:
        raise RuntimeError('port_in_use: Another service or an older BQL launcher is using port 8768. '
                           'Close its window first. No unrelated process was stopped.')
    if reset:
        result = local_request(token, stop=True)
        if result != {'stopping': True}:
            raise RuntimeError('reset_failed: Existing connection could not be stopped.')
        for _ in range(50):
            if not port_in_use():
                return False
            time.sleep(0.1)
        raise RuntimeError('reset_busy: Connection is still stopping. Wait, then run Reset.cmd again.')
    if not status.get('ready') or not status.get('preview_enabled'):
        raise RuntimeError('environment_unavailable: Log in to Bloomberg Terminal, then run Reset.cmd. '
                           'If modules are missing, run Repair.cmd.')
    webbrowser.open(f'{SITE}#bbg-token={token}')
    print('Existing BQL connection opened. Keep its original launcher window open.')
    return True


def save_session(token):
    path = ROOT / '.bql-session.json'
    # Local connection credential only; never packaged or logged.
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
        json.dump({'token': token}, stream)


_STARTUP_LOCK = None


def acquire_startup_lock():
    global _STARTUP_LOCK
    stream = (ROOT / '.bql-launcher.lock').open('a+b')
    stream.seek(0, 2)
    if stream.tell() == 0:
        stream.write(b'0')
        stream.flush()
    for _ in range(100):
        stream.seek(0)
        try:
            if sys.platform == 'win32':
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            _STARTUP_LOCK = stream
            return
        except OSError:
            time.sleep(0.1)
    stream.close()
    raise RuntimeError('launcher_busy: Another launcher is starting. Wait and run Start.cmd again.')


def release_startup_lock():
    global _STARTUP_LOCK
    if _STARTUP_LOCK is not None:
        _STARTUP_LOCK.close()
        _STARTUP_LOCK = None


def _main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bql-python', type=Path, default=ROOT / '.venv-bql/Scripts/python.exe')
    parser.add_argument('--provider', choices=('bql', 'polars-bloomberg'), default='polars-bloomberg')
    parser.add_argument('--reset', action='store_true', help='Restart only this launcher connection')
    parser.add_argument('--stop', action='store_true', help='Stop only this launcher connection')
    args = parser.parse_args()
    acquire_startup_lock()
    if existing_session(reset=args.reset or args.stop):
        return
    if args.stop:
        print('BQL connection stopped. Installed packages were preserved.')
        return
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
        '--supported-runtime-confirmed', '--enable-preview', '--launcher-managed',
    ] + mapping_args, cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    try:
        status = None
        for _ in range(40):
            if bridge.poll() is not None:
                raise RuntimeError('bridge_start_failed: Port 8768 may be occupied. Close the previous launcher and retry.')
            try:
                status = local_request(token)
                break
            except urllib.error.HTTPError as error:
                if error.code == 401:
                    raise RuntimeError('connection_conflict: Another connection answered with a different token. '
                                       'Close the old launcher window and retry.') from None
                raise
            except urllib.error.URLError:
                time.sleep(0.25)
        if not status or not status.get('ready') or not status.get('preview_enabled'):
            raise RuntimeError('environment_unavailable: Check Bloomberg login. '
                               'Run Reset.cmd to reconnect, or Repair.cmd for missing packages. No market query was sent.')
        save_session(token)
        webbrowser.open(f'{SITE}#bbg-token={token}')
        print('BQL preview ready. Keep this window open; closing it or Ctrl+C stops the connection.')
        print('Use Reset.cmd for connection problems; Repair.cmd to rebuild installed packages.')
        print('No market query is sent until you click the page button.')
        release_startup_lock()
        bridge.wait()
    except KeyboardInterrupt:
        pass
    finally:
        if bridge.stdin:
            bridge.stdin.close()
        if bridge.poll() is None:
            bridge.terminate()
            bridge.wait(timeout=10)
        # Leave expired state for the next serialized startup to overwrite.
        # An older owner must not delete the replacement session after Reset.


def main():
    try:
        return _main()
    finally:
        release_startup_lock()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Startup stopped: {error}', file=sys.stderr)
        sys.exit(1)
    finally:
        release_startup_lock()
