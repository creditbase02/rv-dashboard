from pathlib import Path
import io
import json
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from scripts.build_bql_launcher import build
from scripts import bloomberg_bridge, start_bql_preview


class BqlLauncherTests(unittest.TestCase):
    def test_download_is_standalone_and_contains_no_runtime_or_market_data(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = build(root/'launcher.zip')
            self.assertEqual(package.read_bytes(), build(root/'second.zip').read_bytes())
            with zipfile.ZipFile(package) as archive:
                names = archive.namelist()
                self.assertEqual(len(names), 11)
                self.assertTrue(all(name.startswith('RV-BQL-Launcher/') for name in names))
                self.assertFalse(any(name.endswith(('.json','.xlsx','.dll','.exe')) for name in names))
                self.assertNotIn('bbg-token=', '\n'.join(archive.read(name).decode() for name in names if name.endswith('.cmd')))
                archive.extractall(root)
            extracted = root/'RV-BQL-Launcher'
            result = subprocess.run([sys.executable,'-c','import scripts.bloomberg_bridge, scripts.probe_bloomberg_luac, scripts.start_bql_preview'],cwd=extracted,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertIn(b'\r\n',(extracted/'Start.cmd').read_bytes())

    def test_bundle_downloads_only_validated_public_mapping_once(self):
        definitions = [{'name':'Banks','tickers':['TK']}]
        with tempfile.TemporaryDirectory() as directory, patch.object(start_bql_preview,'ROOT',Path(directory)):
            for body,valid in ((json.dumps(definitions).encode(),True),(b'{"records":[]}',False),(b'x'*(256*1024+1),False)):
                with self.subTest(valid=valid),patch.object(start_bql_preview.urllib.request,'urlopen',return_value=io.BytesIO(body)) as fetch:
                    if valid:
                        path=start_bql_preview.bundle_peer_mapping()
                        self.assertEqual(json.loads(path.read_text(encoding='utf-8')),definitions)
                    else:
                        with self.assertRaises((ValueError,TypeError)):
                            start_bql_preview.bundle_peer_mapping()
                    fetch.assert_called_once()
                    self.assertTrue(fetch.call_args.args[0].endswith('/assets/luac-peer-definitions.json'))

    def test_standalone_bridge_uses_mapping_without_a_quote_snapshot(self):
        definitions = [{'name':'Banks','tickers':['TK']}]
        with tempfile.TemporaryDirectory() as directory:
            mapping=Path(directory)/'peers.json'
            mapping.write_text(json.dumps(definitions),encoding='utf-8')
            with patch.object(bloomberg_bridge,'PEER_DEFINITIONS_PATH',mapping),patch.object(bloomberg_bridge,'SUPPORTED_RUNTIME_CONFIRMED',True),patch.object(bloomberg_bridge,'PREVIEW_ENABLED',True),patch.object(bloomberg_bridge,'worker',return_value={'ok':False,'error_class':'query_timeout'}) as worker:
                result=bloomberg_bridge.run_preview()
                worker.assert_called_once_with('--preview',{'peer_definitions':definitions})
                self.assertFalse(result['ok'])

    def test_setup_rejects_unsupported_python_before_any_install(self):
        setup=runpy.run_path(str(Path(__file__).resolve().parents[1]/'bql-launcher/setup.py'))
        with patch.object(setup['subprocess'],'run') as run,patch.object(setup['sys'],'version_info',(3,11)):
            with self.assertRaisesRegex(RuntimeError,'Python 3.12'):
                setup['main']()
            run.assert_not_called()


if __name__=='__main__':
    unittest.main()
