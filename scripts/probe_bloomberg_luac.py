"""Read-only BQL worker. No ReferenceData fallback or snapshot publication."""
from __future__ import annotations
import argparse
import contextlib
import importlib.util
import io
import json
import re
import socket
import sys
from datetime import date, datetime
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from luac_data import COLUMNS, SCHEMA_VERSION, quality_flags, validate_luac

UNIVERSE = "intersect(bondsuniv('active',CONSOLIDATEDUPLICATES='N'),members(['LUACTRUU Index']))"
FIELDS = {
    'security_des': 'SECURITY_DES()', 'issuer': 'LONG_COMP_NAME()',
    'ticker': 'TICKER()', 'maturity': 'MATURITY()', 'rating': 'BB_COMPOSITE()',
    'maturity_years': 'MTY_YEARS_TDY()',
    'oas_bp': "SPREAD(ST='OAS',PRICING_SOURCE=BVAL,SIDE=BID)",
    'yield_pct': 'YIELD(YT=CONVENTION,PRICING_SOURCE=BVAL,SIDE=BID)',
    'industry': 'CLASSIFICATION_NAME(BICS,1,TYPE=ISSUER)',
}
class ProbeError(Exception):
    pass

def classify(error):
    if isinstance(error, ProbeError): return str(error)
    if isinstance(error, TimeoutError): return 'query_timeout'
    if isinstance(error, ImportError): return 'bql_runtime_unavailable'
    message = str(error).lower()
    if any(w in message for w in ('permission', 'authorization', 'entitlement', 'not authorized')): return 'not_authorized'
    if any(w in message for w in ('connect', 'session', 'login', 'log in')): return 'terminal_connection'
    return 'bql_query_failed'

def health(provider='bql'):
    modules = ('polars_bloomberg','blpapi') if provider == 'polars-bloomberg' else ('bql',)
    available = all(importlib.util.find_spec(module) is not None for module in modules)
    with socket.socket() as connection:
        connection.settimeout(1)
        try: terminal = connection.connect_ex(('127.0.0.1',8194)) == 0
        except OSError: terminal = False
    return {'ready': available, 'provider':provider, 'bql_available': available, 'terminal_port_open': terminal,
            'entitlement_verified': False, 'error_class': None if available else 'bql_runtime_unavailable'}

def query_text(security=None):
    universe = UNIVERSE
    if security is not None:
        if not isinstance(security,str) or not re.fullmatch(r'[A-Za-z0-9 /_.:@+\-]{1,64}',security):
            raise ProbeError('invalid_security_id')
        universe = "['" + security + "']"
    definitions = ';'.join(f'#{name}={expression}' for name,expression in FIELDS.items())
    return f"let({definitions};) get({','.join('#'+name for name in FIELDS)}) for({universe})"

def iso_date(value):
    if isinstance(value,datetime): value=value.date()
    if isinstance(value,date): return value.isoformat()
    if isinstance(value,str):
        try: return date.fromisoformat(value).isoformat()
        except ValueError: pass
    raise ProbeError('market_date_unverified')

def read_response(response):
    # DATE must be returned on both market items; never infer it from a clock or Excel date.
    records, dates, seen = {}, set(), set()
    for item in response:
        frame=item.df().reset_index() if hasattr(item,'df') else item
        columns={str(c).lower():c for c in frame.columns}
        aliases=[name for name in FIELDS if '#'+name in columns]
        if len(aliases)!=1 or 'id' not in columns: raise ProbeError('bql_response_shape')
        name=aliases[0]
        if name in seen: raise ProbeError('duplicate_field')
        seen.add(name)
        ids=set()
        rows=frame.to_dicts() if hasattr(frame,'to_dicts') else frame.to_dict('records')
        for row in rows:
            identifier=row[columns['id']]
            if not isinstance(identifier,str) or not identifier.strip(): raise ProbeError('invalid_security_id')
            if identifier in ids: raise ProbeError('duplicate_id')
            ids.add(identifier)
            value=row[columns['#'+name]]
            if value is None or (isinstance(value,str) and not value.strip()): raise ProbeError('missing_fields')
            if name=='maturity': value=iso_date(value)
            records.setdefault(identifier,{})[name]=value
            if name in ('oas_bp','yield_pct'):
                if 'date' not in columns: raise ProbeError('market_date_unverified')
                dates.add(iso_date(row[columns['date']]))
    if seen!=set(FIELDS) or not records or any(set(row)!=set(FIELDS) for row in records.values()):
        raise ProbeError('partial_response')
    if len(dates)!=1: raise ProbeError('mixed_market_dates')
    return records, dates.pop()

def snapshot(records, as_of, peer_definitions):
    rows=[]
    for identifier,v in records.items():
        if set(v)!=set(FIELDS): raise ProbeError('missing_fields')
        years,oas,yld=(v[k] for k in ('maturity_years','oas_bp','yield_pct'))
        rows.append([identifier,v['security_des'],v['issuer'],v['ticker'],v['maturity'],v['rating'],
                     years,oas,yld,v['industry'],quality_flags(years,oas,yld)])
    result={'schema_version':SCHEMA_VERSION,'date':as_of,'columns':list(COLUMNS),
            'peer_definitions':peer_definitions,'records':rows}
    try: validate_luac(result)
    except (ValueError,TypeError): raise ProbeError('invalid_snapshot') from None
    return result

def compare(candidate, baseline):
    validate_luac(candidate)
    validate_luac(baseline)
    new={r[0]:r for r in candidate['records']}; old={r[0]:r for r in baseline['records']}
    ids_match=set(new)==set(old); common=set(new)&set(old)
    max_oas=max((abs(new[k][7]-old[k][7]) for k in common),default=None)
    max_yield=max((abs(new[k][8]-old[k][8]) for k in common),default=None)
    static=sum(any(new[k][i]!=old[k][i] for i in (1,2,3,4,5)) for k in common)
    industry=sum(new[k][9]!=old[k][9] for k in common)
    dates=candidate['date']==baseline['date']
    oas_ok=max_oas is not None and max_oas<=0.5
    yield_ok=max_yield is not None and max_yield<=0.01
    return {'ids_match':ids_match,'date_match':dates,'industry_match':ids_match and industry==0,
            'static_mismatch_count':static,'industry_mismatch_count':industry,
            'max_oas_diff_bp':max_oas,'max_yield_diff_pct':max_yield,
            'oas_within_0_5_bp':oas_ok,'yield_within_0_01_pct_point':yield_ok,
            'eligible_for_api_planning':ids_match and dates and static==0 and industry==0 and oas_ok and yield_ok}

def run_probe(baseline, service_factory=None, provider='bql'):
    d={'connected':False,'reference_ok':False,'universe_ok':False,'count':0,
       'required_field_coverage_pct':0,'passed':False,'error_class':None}
    manager = None
    entered = False
    try:
        validate_luac(baseline)
        if service_factory is None:
            if provider == 'polars-bloomberg':
                from polars_bloomberg import BQuery
                manager=BQuery(host='127.0.0.1',port=8194,timeout=120000,debug=False)
                manager.__enter__()
                entered=True
                service=manager
            else:
                import bql
                service=bql.Service()
        else:
            service=service_factory()
        execute=service.bql if provider == 'polars-bloomberg' else service.execute
        d['connected']=True
        known=baseline['records'][0][0]
        single,single_date=read_response(execute(query_text(known)))
        if set(single)!={known}: raise ProbeError('single_security_mismatch')
        snapshot(single,single_date,baseline['peer_definitions']); d['reference_ok']=True
        records,market_date=read_response(execute(query_text()))
        if single_date!=market_date: raise ProbeError('mixed_market_dates')
        candidate=snapshot(records,market_date,baseline['peer_definitions'])
        d.update(universe_ok=True,count=len(records),required_field_coverage_pct=100)
        comparison=compare(candidate,baseline); d.update(comparison)
        d['passed']=comparison['eligible_for_api_planning']
        if not d['passed']: d['error_class']='comparison_failed'
    except Exception as error: d['error_class']=classify(error)
    finally:
        if entered:
            try: manager.__exit__(None,None,None)
            except Exception:
                d['passed']=False
                d['error_class']='bql_query_failed'
    return d

def run_preview(peer_definitions, service_factory=None, provider='bql'):
    """One full query, validated for local preview only; never an approval."""
    manager = None
    entered = False
    try:
        if service_factory is not None:
            service = service_factory()
        elif provider == 'polars-bloomberg':
            from polars_bloomberg import BQuery
            manager = BQuery(host='127.0.0.1', port=8194, timeout=120000, debug=False)
            manager.__enter__()
            entered = True
            service = manager
        else:
            import bql
            service = bql.Service()
        execute = service.bql if provider == 'polars-bloomberg' else service.execute
        records, market_date = read_response(execute(query_text()))
        data = snapshot(records, market_date, peer_definitions)
        if len(json.dumps(data, ensure_ascii=False).encode('utf-8')) > 4 * 1024 * 1024:
            raise ProbeError('snapshot_too_large')
        result = {'ok': True, 'validation': 'schema_only', 'comparison': 'not_verified', 'data': data}
    except Exception as error:
        result = {'ok': False, 'error_class': classify(error)}
    finally:
        if entered:
            try:
                manager.__exit__(None, None, None)
            except Exception:
                result = {'ok': False, 'error_class': 'bql_query_failed'}
    return result


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--health',action='store_true'); p.add_argument('--stdin',action='store_true')
    p.add_argument('--preview',action='store_true')
    p.add_argument('--provider',choices=('bql','polars-bloomberg'),default='bql')
    a=p.parse_args()
    if sum((a.health,a.stdin,a.preview))!=1: p.error('choose one of --health, --stdin or --preview')
    try:
        # Vendor output may contain private identifiers. Never forward SDK logs.
        with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
            if a.health:
                result = health(a.provider)
            elif a.preview:
                result = run_preview(json.load(sys.stdin)['peer_definitions'],provider=a.provider)
            else:
                result = run_probe(json.load(sys.stdin),provider=a.provider)
    except Exception as error: result={'ready':False,'passed':False,'error_class':classify(error)}
    print(json.dumps(result,allow_nan=False,separators=(',',':')))
if __name__=='__main__': main()
