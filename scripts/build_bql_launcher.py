"""Package an allowlisted, quote-free Windows launcher from reviewed source."""
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ('luac_data.py', 'peer_data.py', 'xlsx_table.py',
           'scripts/start_bql_preview.py', 'scripts/bloomberg_bridge.py',
           'scripts/probe_bloomberg_luac.py')
SUPPORT = ('Setup.cmd', 'Start.cmd', 'setup.py', 'README.txt')


def source_version():
    import hashlib
    digest = hashlib.sha256()
    for name in SOURCES:
        digest.update((ROOT/name).read_text(encoding='utf-8').encode())
    for name in SUPPORT:
        digest.update((ROOT/'bql-launcher'/name).read_text(encoding='utf-8').encode())
    return digest.hexdigest()[:12]


def build(output):
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        def add(name, text):
            info = zipfile.ZipInfo('RV-BQL-Launcher/'+name, date_time=(2020,1,1,0,0,0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, text)
        for name in SOURCES:
            add(name, (ROOT/name).read_text(encoding='utf-8'))
        for name in SUPPORT:
            text = (ROOT/'bql-launcher'/name).read_text(encoding='utf-8')
            if name.endswith('.cmd'):
                text = text.replace('\n', '\r\n')
            add(name, text)
        add('standalone-launcher.txt', '1\n')
    return output
