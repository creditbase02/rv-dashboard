from pathlib import Path
import io
import json
import os
import runpy
import ssl
import urllib.error
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile
from contextlib import ExitStack

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
                self.assertEqual(len(names), 13)
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

    def test_known_ca_error_retries_with_chain_and_hostname_verification(self):
        error = urllib.error.URLError(ssl.SSLCertVerificationError(
            1, 'Basic Constraints of CA cert not marked critical'))
        response = io.BytesIO(b'[]')
        with patch.object(start_bql_preview.urllib.request, 'urlopen', side_effect=[error, response]) as fetch:
            self.assertIs(start_bql_preview.open_peer_mapping(), response)
        self.assertEqual(fetch.call_count, 2)
        self.assertNotIn('context', fetch.call_args_list[0].kwargs)
        context = fetch.call_args.kwargs['context']
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(context.check_hostname)
        self.assertFalse(context.verify_flags & ssl.VERIFY_X509_STRICT)
        self.assertEqual(context.verify_flags, ssl.create_default_context().verify_flags & ~ssl.VERIFY_X509_STRICT)

    def test_other_download_errors_never_retry(self):
        for reason in [ssl.SSLCertVerificationError(1, message) for message in (
                'certificate has expired', 'hostname mismatch', 'unable to get local issuer certificate')
                ] + [OSError('network unavailable'), 'Basic Constraints of CA cert not marked critical']:
            error = urllib.error.URLError(reason)
            with self.subTest(reason=reason), patch.object(start_bql_preview.urllib.request, 'urlopen', side_effect=error) as fetch:
                with self.assertRaises(urllib.error.URLError):
                    start_bql_preview.open_peer_mapping()
                fetch.assert_called_once()

    def test_failed_fallback_is_not_retried_again(self):
        error = urllib.error.URLError(ssl.SSLCertVerificationError(
            1, 'Basic Constraints of CA cert not marked critical'))
        with patch.object(start_bql_preview.urllib.request, 'urlopen', side_effect=error) as fetch:
            with self.assertRaises(urllib.error.URLError):
                start_bql_preview.open_peer_mapping()
            self.assertEqual(fetch.call_count, 2)

    def test_mapping_failures_stop_before_bridge_start(self):
        cases = [(urllib.error.URLError('TLS failure'), 'mapping_download_failed'),
                 (ValueError('invalid mapping'), 'mapping_validation_failed')]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'standalone-launcher.txt').touch()
            python = root / 'python.exe'
            python.touch()
            for error, label in cases:
                with self.subTest(label=label), patch.object(start_bql_preview, 'ROOT', root), patch.object(sys, 'argv', ['launcher', '--bql-python', str(python)]), patch.object(start_bql_preview, 'bundle_peer_mapping', side_effect=error), patch.object(start_bql_preview.subprocess, 'Popen') as spawn:
                    with self.assertRaisesRegex(RuntimeError, label):
                        start_bql_preview.main()
                    spawn.assert_not_called()

    def test_start_reuses_authenticated_session_without_mapping_or_spawn(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(start_bql_preview, 'ROOT', Path(directory)), patch.object(sys, 'argv', ['launcher']), patch.object(start_bql_preview, 'port_in_use', return_value=True), patch.object(start_bql_preview, 'read_session', return_value='a'*64), patch.object(start_bql_preview, 'local_request', return_value={'launcher_managed':True,'ready':True,'preview_enabled':True}), patch.object(start_bql_preview.webbrowser, 'open') as browser, patch.object(start_bql_preview, 'bundle_peer_mapping') as mapping, patch.object(start_bql_preview.subprocess, 'Popen') as spawn:
            start_bql_preview.main()
            browser.assert_called_once_with(start_bql_preview.SITE+'#bbg-token='+'a'*64)
            mapping.assert_not_called()
            spawn.assert_not_called()

    def test_reset_authenticates_and_waits_for_port_release(self):
        with patch.object(start_bql_preview, 'port_in_use', side_effect=[True,True,False]), patch.object(start_bql_preview, 'read_session', return_value='a'*64), patch.object(start_bql_preview, 'local_request', side_effect=[{'launcher_managed':True},{'stopping':True}]) as request, patch.object(start_bql_preview.time, 'sleep'):
            self.assertFalse(start_bql_preview.existing_session(reset=True))
            self.assertEqual(request.call_args_list[1].kwargs, {'stop':True})

    def test_unknown_or_legacy_service_is_never_stopped(self):
        for status in ({}, {'ready':True}, urllib.error.HTTPError('local',401,'unauthorized',{},None)):
            with self.subTest(status=status), patch.object(start_bql_preview, 'port_in_use', return_value=True), patch.object(start_bql_preview, 'read_session', return_value='a'*64), patch.object(start_bql_preview, 'local_request', **({'side_effect':status} if isinstance(status,Exception) else {'return_value':status})) as request:
                with self.assertRaisesRegex(RuntimeError, 'port_in_use'):
                    start_bql_preview.existing_session(reset=True)
                request.assert_called_once_with('a'*64)

    def test_loopback_request_explicitly_disables_proxy(self):
        from unittest.mock import MagicMock
        response=MagicMock()
        response.__enter__.return_value=io.BytesIO(b'{"ready":true}')
        with patch.object(start_bql_preview.urllib.request, 'ProxyHandler') as proxy, patch.object(start_bql_preview.urllib.request, 'build_opener') as opener:
            opener.return_value.open.return_value=response
            self.assertEqual(start_bql_preview.local_request('a'*64), {'ready':True})
            proxy.assert_called_once_with({})
            self.assertEqual(opener.return_value.open.call_args.args[0].get_header('Authorization'),'Bearer '+'a'*64)

    def test_repair_preserves_previous_environment_before_creating_new_one(self):
        setup=runpy.run_path(str(Path(__file__).resolve().parents[1]/'bql-launcher/setup.py'))
        main=setup['main']
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            old=root/'.venv-bql'
            old.mkdir()
            (old/'marker').write_text('previous installation')
            with patch.dict(main.__globals__,{'ROOT':root,'ensure_runtime':lambda:None}), patch.object(setup['venv'],'EnvBuilder') as builder, patch.object(setup['subprocess'],'run'):
                main(repair=True)
                builder.return_value.create.assert_called_once_with(old)
                backups=list(root.glob('.venv-bql-backup-*'))
                self.assertEqual(len(backups),1)
                self.assertEqual((backups[0]/'marker').read_text(),'previous installation')

    @unittest.skipUnless(sys.platform == 'win32', 'CMD regression runs in Windows CI')
    def test_setup_skips_false_success_and_selects_installed_314(self):
        source=Path(__file__).resolve().parents[1]/'bql-launcher/Setup.cmd'
        for installation_exit in (0, 1):
            with self.subTest(installation_exit=installation_exit), tempfile.TemporaryDirectory() as directory:
                root=Path(directory)
                (root/'Setup.cmd').write_bytes(source.read_bytes())
                (root/'setup.py').write_text(
                    "import sys\nfrom pathlib import Path\n"
                    "if '--check-runtime' in sys.argv: print('Compatible Python 3.14 (Windows x64).')\n"
                    "else:\n Path('installed').write_text('3.14')\n sys.exit("+str(installation_exit)+")\n")
                (root/'py.cmd').write_text(
                    '@echo off\n'
                    'if not "%~1"=="-3.14" goto missing\n'
                    '"'+sys.executable+'" "%~2" %3\n'
                    'exit /b %errorlevel%\n'
                    ':missing\n'
                    'echo No runtime installed that matches 3.12\n'
                    'exit /b 0\n')
                result=subprocess.run(['cmd','/c','Setup.cmd'], cwd=root, input='\n', capture_output=True,text=True,timeout=30)
                self.assertTrue((root/'installed').exists(),result.stdout+result.stderr)
                self.assertEqual(result.returncode,installation_exit,result.stdout+result.stderr)
                self.assertNotIn('No runtime installed',result.stdout)

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

    def test_runtime_guard_accepts_standard_x64_versions_only(self):
        setup=runpy.run_path(str(Path(__file__).resolve().parents[1]/'bql-launcher/setup.py'))
        cases=[((3,minor),64,'win-amd64','CPython',None,True) for minor in (12,13,14)]
        cases += [((3,minor),64,'win-amd64','CPython',None,False) for minor in (4,10,11,15)]
        cases += [((3,13),32,'win32','CPython',None,False),
                  ((3,13),64,'win-arm64','CPython',None,False),
                  ((3,13),64,'win-amd64','PyPy',None,False),
                  ((3,14),64,'win-amd64','CPython',1,False)]
        for version,bits,target,implementation,free_threaded,accepted in cases:
            with self.subTest(version=version,bits=bits,target=target,implementation=implementation,free_threaded=free_threaded),ExitStack() as stack:
                stack.enter_context(patch.object(setup['sys'],'version_info',version))
                stack.enter_context(patch.object(setup['sys'],'platform','win32'))
                stack.enter_context(patch.object(setup['struct'],'calcsize',return_value=bits//8))
                stack.enter_context(patch.object(setup['platform'],'python_implementation',return_value=implementation))
                stack.enter_context(patch.object(setup['sysconfig'],'get_platform',return_value=target))
                stack.enter_context(patch.object(setup['sysconfig'],'get_config_var',return_value=free_threaded))
                if accepted:
                    setup['ensure_runtime']()
                else:
                    with self.assertRaisesRegex(RuntimeError,'unsupported'):
                        setup['ensure_runtime']()

    def test_incompatible_existing_environment_stops_before_pip(self):
        setup=runpy.run_path(str(Path(__file__).resolve().parents[1]/'bql-launcher/setup.py'))
        main=setup['main']
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            python=root/'.venv-bql/Scripts/python.exe'
            python.parent.mkdir(parents=True)
            python.touch()
            with patch.dict(main.__globals__,{'ROOT':root,'ensure_runtime':lambda:None}),patch.object(setup['subprocess'],'run',side_effect=subprocess.CalledProcessError(1,'runtime check')) as run:
                with self.assertRaises(subprocess.CalledProcessError):
                    main()
                run.assert_called_once()
                self.assertIn('--check-runtime',run.call_args.args[0])


if __name__=='__main__':
    unittest.main()
