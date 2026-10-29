"""Explicit first-run setup; installs into this extracted folder only."""
from pathlib import Path
import platform
import uuid
import argparse
import struct
import sysconfig
import subprocess
import sys
import venv

ROOT = Path(__file__).resolve().parent
SUPPORTED_VERSIONS = ((3, 12), (3, 13), (3, 14))


def ensure_runtime():
    version = sys.version_info[:2]
    if (version not in SUPPORTED_VERSIONS or struct.calcsize('P') != 8
            or sys.platform != 'win32' or platform.python_implementation() != 'CPython'
            or sysconfig.get_platform() != 'win-amd64'
            or sysconfig.get_config_var('Py_GIL_DISABLED')):
        raise RuntimeError('Use standard 64-bit CPython 3.12, 3.13 or 3.14 on Windows x64. '
                           'Python 3.11 and older, ARM64, 32-bit and free-threaded builds are unsupported. '
                           'See https://www.python.org/downloads/windows/')


def main(repair=False):
    ensure_runtime()
    print('Using Python '+sys.version.split()[0]+' (Windows x64).', flush=True)
    print('Setting up a local BQL environment. No market query will be sent.', flush=True)
    environment = ROOT / '.venv-bql'
    if repair and environment.exists():
        backup = ROOT / ('.venv-bql-backup-' + uuid.uuid4().hex[:12])
        environment.rename(backup)
        print('Previous environment preserved in a local backup folder.', flush=True)
    if not (environment/'Scripts/python.exe').is_file():
        venv.EnvBuilder(with_pip=True).create(environment)
    python = str(environment/'Scripts/python.exe')
    # Check the existing environment too; never install into an incompatible one.
    subprocess.run([python, str(Path(__file__).resolve()), '--check-runtime'], check=True, timeout=20)
    commands = [
        [python, '-m', 'pip', 'install', '--retries', '0', '--timeout', '30', '--index-url',
         'https://blpapi.bloomberg.com/repository/releases/python/simple/', 'blpapi==3.26.9.1'],
        [python, '-m', 'pip', 'install', '--retries', '0', '--timeout', '30', '--index-url',
         'https://pypi.org/simple', 'polars-bloomberg==0.6.0', 'polars==2.0.0'],
        [python, '-m', 'pip', 'check'],
        [python, '-c', 'import blpapi, polars_bloomberg'],
    ]
    for command in commands:
        subprocess.run(command, check=True, timeout=600)
    print('Setup complete. Log in to Bloomberg Terminal and double-click Start.cmd.', flush=True)


if __name__ == '__main__':
    try:
        parser = argparse.ArgumentParser(description=__doc__)
        parser.add_argument('--check-runtime', action='store_true')
        parser.add_argument('--repair', action='store_true')
        args = parser.parse_args()
        if args.check_runtime:
            ensure_runtime()
            if args.repair and Path(sys.prefix).resolve() == (ROOT / '.venv-bql').resolve():
                raise RuntimeError('Repair requires a system Python outside this environment.')
            print('Compatible Python '+sys.version.split()[0]+' (Windows x64).')
        else:
            main(repair=args.repair)
    except Exception as error:
        print(f'Setup stopped: {error}', file=sys.stderr)
        sys.exit(1)
