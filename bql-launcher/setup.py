"""Explicit first-run setup; installs into this extracted folder only."""
from pathlib import Path
import platform
import subprocess
import sys
import venv

ROOT = Path(__file__).resolve().parent


def main():
    if sys.version_info[:2] != (3, 12) or platform.architecture()[0] != '64bit' or sys.platform != 'win32':
        raise RuntimeError('Use Windows with Python 3.12 64-bit. See https://www.python.org/downloads/windows/')
    print('Setting up a local BQL environment. No market query will be sent.', flush=True)
    environment = ROOT / '.venv-bql'
    if not (environment/'Scripts/python.exe').is_file():
        venv.EnvBuilder(with_pip=True).create(environment)
    python = str(environment/'Scripts/python.exe')
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
        main()
    except Exception as error:
        print(f'Setup stopped: {error}', file=sys.stderr)
        sys.exit(1)
