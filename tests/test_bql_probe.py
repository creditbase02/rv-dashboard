from __future__ import annotations
import copy
import subprocess
import unittest
from unittest.mock import MagicMock, Mock, patch
from scripts import probe_bloomberg_luac as probe
from scripts import bloomberg_bridge as bridge

BASE={'schema_version':2,'date':'2026-10-16','columns':list(probe.COLUMNS),
      'peer_definitions':[{'name':'Banks','tickers':['TK']}],
      'records':[['ID1','Bond','Issuer','TK','2030-10-16','A',4,100,5,'Financials',[]]]}
VALUES=dict(zip(probe.FIELDS,BASE['records'][0][1:10]))

class Frame:
    def __init__(self,rows): self.rows=rows; self.columns=list(rows[0]) if rows else []
    def reset_index(self): return self
    def to_dict(self,kind): return self.rows
class Item:
    def __init__(self,rows): self.rows=rows
    def df(self): return Frame(self.rows)

class PolarsFrame:
    def __init__(self,rows): self.rows=rows; self.columns=list(rows[0])
    def to_dicts(self): return self.rows

def response():
    return [Item([{'ID':'ID1','#'+name:value,**({'DATE':'2026-10-16'} if name in ('oas_bp','yield_pct') else {})}])
            for name,value in VALUES.items()]

def service_with(*responses):
    service=Mock(); service.execute.side_effect=responses
    return service

class BqlProbeTests(unittest.TestCase):
    def test_local_preview_is_one_full_query_and_not_an_approval(self):
        service=service_with(response())
        result=probe.run_preview(BASE['peer_definitions'],lambda:service)
        self.assertTrue(result['ok'])
        self.assertEqual(result['validation'],'schema_only')
        self.assertEqual(result['comparison'],'not_verified')
        self.assertEqual(result['data'],BASE)
        service.execute.assert_called_once_with(probe.query_text())

    def test_failed_preview_has_no_partial_snapshot(self):
        service=service_with(response()[:-1])
        result=probe.run_preview(BASE['peer_definitions'],lambda:service)
        self.assertFalse(result['ok'])
        self.assertEqual(result['error_class'],'partial_response')
        self.assertNotIn('data',result)
        self.assertEqual(service.execute.call_count,1)

    def test_polars_provider_uses_bql_not_reference_data(self):
        frames=[PolarsFrame(item.rows) for item in response()]
        service=Mock()
        service.bql.side_effect=[frames,frames]
        result=probe.run_probe(BASE,lambda:service,provider='polars-bloomberg')
        self.assertTrue(result['passed'])
        self.assertEqual(service.bql.call_count,2)
        service.execute.assert_not_called()
        service.bdp.assert_not_called()

    def test_polars_session_is_closed_after_failure(self):
        import sys
        manager=MagicMock()
        manager.bql.side_effect=PermissionError('not authorized')
        module=Mock(); module.BQuery.return_value=manager
        with patch.dict(sys.modules,{'polars_bloomberg':module}):
            result=probe.run_probe(BASE,provider='polars-bloomberg')
        self.assertFalse(result['passed'])
        self.assertEqual(result['error_class'],'not_authorized')
        manager.__exit__.assert_called_once()
        module.BQuery.assert_called_once_with(host='127.0.0.1',port=8194,timeout=120000,debug=False)

    def test_exact_query_semantics_and_identifier_escaping(self):
        text=probe.query_text()
        for fragment in (probe.UNIVERSE,"CONSOLIDATEDUPLICATES='N'",'PRICING_SOURCE=BVAL,SIDE=BID',
                         'YT=CONVENTION','CLASSIFICATION_NAME(BICS,1,TYPE=ISSUER)'):
            self.assertIn(fragment,text)
        self.assertNotIn('OAS_SPREAD_BID',text)
        with self.assertRaises(probe.ProbeError): probe.query_text("x');get(foo)")

    def test_single_then_full_query_preserves_mapping_and_only_returns_summary(self):
        service=service_with(response(),response())
        with patch.object(probe,'snapshot',wraps=probe.snapshot) as snap:
            result=probe.run_probe(BASE,lambda:service)
        self.assertTrue(result['passed'])
        self.assertEqual(service.execute.call_count,2)
        self.assertIn("for(['ID1'])",service.execute.call_args_list[0].args[0])
        self.assertIn(probe.UNIVERSE,service.execute.call_args_list[1].args[0])
        self.assertEqual(snap.call_args.args[2],BASE['peer_definitions'])
        self.assertNotIn('ID1',str(result)); self.assertNotIn('records',result)

    def test_missing_permission_login_and_timeout_stop_before_full_query(self):
        for error,code in [(PermissionError('permission denied'),'not_authorized'),
                           (ConnectionError('not logged in session'),'terminal_connection'),
                           (TimeoutError(),'query_timeout')]:
            service=service_with(error)
            result=probe.run_probe(BASE,lambda:service)
            self.assertEqual(result['error_class'],code)
            self.assertFalse(result['passed']); self.assertEqual(service.execute.call_count,1)

    def test_rejects_partial_duplicate_missing_and_nonfinite_response(self):
        cases=[]
        partial=response()[:-1]; cases.append((partial,'partial_response'))
        duplicate=response(); duplicate[0].rows*=2; cases.append((duplicate,'duplicate_id'))
        missing=response(); missing[0].rows[0]['#security_des']=None; cases.append((missing,'missing_fields'))
        invalid=response(); invalid[6].rows[0]['#oas_bp']=float('nan'); cases.append((invalid,'invalid_snapshot'))
        for data,code in cases:
            service=service_with(data)
            result=probe.run_probe(BASE,lambda:service)
            self.assertEqual(result['error_class'],code); self.assertFalse(result['passed'])
            self.assertEqual(service.execute.call_count,1)

    def test_market_date_cannot_be_inferred(self):
        for field in ('oas_bp','yield_pct'):
            data=response()
            next(item for item in data if '#'+field in item.rows[0]).rows[0].pop('DATE')
            result=probe.run_probe(BASE,lambda:service_with(data))
            self.assertEqual(result['error_class'],'market_date_unverified')
        data=response(); data[7].rows[0]['DATE']='2026-10-15'
        self.assertEqual(probe.run_probe(BASE,lambda:service_with(data))['error_class'],'mixed_market_dates')

    def test_all_acceptance_gates(self):
        for index,value in [(0,'OTHER'),(1,'Changed'),(2,'Changed'),(3,'OTHER'),(4,'2031-01-01'),
                            (5,'BBB'),(7,100.501),(8,5.0101),(9,'Technology')]:
            data=copy.deepcopy(BASE); data['records'][0][index]=value
            self.assertFalse(probe.compare(data,BASE)['eligible_for_api_planning'])
        data=copy.deepcopy(BASE); data['date']='2026-10-15'
        self.assertFalse(probe.compare(data,BASE)['eligible_for_api_planning'])
        data=copy.deepcopy(BASE); data['records'][0][7]=100.5
        self.assertTrue(probe.compare(data,BASE)['eligible_for_api_planning'])

    def test_runtime_confirmation_and_timeout(self):
        with patch.object(bridge,'SUPPORTED_RUNTIME_CONFIRMED',False),patch.object(bridge,'worker') as worker:
            self.assertEqual(bridge.run_probe(BASE)['error_class'],'supported_runtime_unconfirmed')
            worker.assert_not_called()
        with patch.object(bridge.subprocess,'run',side_effect=subprocess.TimeoutExpired('private',270)) as run:
            result=bridge.worker('--stdin',BASE)
            self.assertEqual(run.call_args.kwargs['timeout'],270)
        self.assertEqual(result['error_class'],'query_timeout'); self.assertNotIn('private',str(result))

    def test_busy_and_no_health_queries(self):
        with patch.object(bridge,'SUPPORTED_RUNTIME_CONFIRMED',True):
            bridge.PROBE_LOCK.acquire()
            try: self.assertEqual(bridge.run_probe(BASE)['error_class'],'probe_busy')
            finally: bridge.PROBE_LOCK.release()
        with patch.object(probe.importlib.util,'find_spec',return_value=None):
            result=probe.health()
        self.assertFalse(result['ready']); self.assertFalse(result['entitlement_verified'])

if __name__=='__main__': unittest.main()
