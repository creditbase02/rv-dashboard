"""Qualification is local, version-bound aggregate evidence, never market rows."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from scripts import bloomberg_bridge
from scripts.probe_bloomberg_luac import compare


class QualificationTests(unittest.TestCase):
    def baseline(self):
        root=Path(__file__).resolve().parents[1]
        data=json.loads((root/'assets/luac-bonds.json').read_text(encoding='utf-8'))
        data['records']=data['records'][:2]
        return data

    def test_only_successful_full_comparison_enables_later_api_updates(self):
        data=self.baseline()
        with tempfile.TemporaryDirectory() as directory, patch.object(bloomberg_bridge,'QUALIFICATION_PATH',Path(directory)/'approval.json'), patch.object(bloomberg_bridge,'SUPPORTED_RUNTIME_CONFIRMED',True):
            self.assertFalse(bloomberg_bridge.api_qualified())
            result={'passed':True,'count':len(data['records']),**compare(data,data)}
            with patch.object(bloomberg_bridge,'worker',return_value=result):
                response=bloomberg_bridge.run_probe(data)
            self.assertTrue(response['api_qualified'])
            approval=json.loads(bloomberg_bridge.QUALIFICATION_PATH.read_text())
            self.assertEqual(set(approval),{'version','passed','date','count','max_oas_diff_bp','max_yield_diff_pct'})
            self.assertNotIn(data['records'][0][0],json.dumps(approval))
            self.assertTrue(bloomberg_bridge.api_qualified(),'survives reconnect/reboot through local evidence')
            with patch.object(bloomberg_bridge,'qualification_version',return_value='new-query-version'):
                self.assertFalse(bloomberg_bridge.api_qualified())
            with patch.object(bloomberg_bridge,'worker',return_value={'passed':False,'error_class':'comparison_failed'}):
                self.assertFalse(bloomberg_bridge.run_probe(data)['api_qualified'])
            self.assertFalse(bloomberg_bridge.QUALIFICATION_PATH.exists())

    def test_unconfirmed_runtime_never_writes_approval(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(bloomberg_bridge,'QUALIFICATION_PATH',Path(directory)/'approval.json'), patch.object(bloomberg_bridge,'SUPPORTED_RUNTIME_CONFIRMED',False), patch.object(bloomberg_bridge,'worker') as worker:
            self.assertFalse(bloomberg_bridge.run_probe(self.baseline())['passed'])
            self.assertFalse(bloomberg_bridge.QUALIFICATION_PATH.exists())
            worker.assert_not_called()

    def test_maturity_years_difference_prevents_qualification(self):
        data=self.baseline()
        candidate=json.loads(json.dumps(data))
        candidate['records'][0][6]+=0.01
        self.assertFalse(compare(candidate,data)['eligible_for_api_planning'])
