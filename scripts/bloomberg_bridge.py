"""Bounded local BQL service. Diagnostic summaries or opt-in local preview."""
from __future__ import annotations
import argparse
import hmac
import hashlib
import json
import os
import platform
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from luac_data import validate_luac
from peer_data import validate_peer_definitions
MAX_BODY=4*1024*1024
ALLOWED_ORIGINS={'https://creditbase02.github.io','http://127.0.0.1:8766','http://localhost:8766'}
PREVIEW_ORIGINS={'https://creditbase02.github.io','http://127.0.0.1:8767','http://localhost:8767'}
BQL_PYTHON=sys.executable
PROVIDER='bql'
SUPPORTED_RUNTIME_CONFIRMED=False
PROBE_LOCK=threading.Lock()
PREVIEW_ENABLED=False
PEER_DEFINITIONS_PATH=None
QUALIFICATION_PATH=None

def qualification_version():
    digest=hashlib.sha256((PROVIDER+str(sys.version_info[:2])).encode())
    # Local binding is hashed only into private approval evidence, never returned.
    digest.update(str(ROOT.resolve()).encode())
    digest.update(platform.node().encode())
    for path in (ROOT/'scripts/probe_bloomberg_luac.py',ROOT/'luac_data.py'):
        digest.update(path.read_bytes())
    setup=ROOT/'setup.py'
    if not setup.is_file(): setup=ROOT/'bql-launcher/setup.py'
    digest.update(setup.read_bytes())
    return digest.hexdigest()


def api_qualified():
    if QUALIFICATION_PATH is None: return False
    try:
        approval=json.loads(QUALIFICATION_PATH.read_text(encoding='utf-8'))
        return approval.get('version')==qualification_version() and approval.get('passed') is True
    except (OSError,ValueError,TypeError,AttributeError): return False


def record_qualification(result,baseline):
    if QUALIFICATION_PATH is None: return
    if result.get('passed') is not True:
        QUALIFICATION_PATH.unlink(missing_ok=True)
        return
    # Only aggregate comparison evidence stays on this computer.
    approval={'version':qualification_version(),'passed':True,'date':baseline['date'],
              'count':result.get('count'),'max_oas_diff_bp':result.get('max_oas_diff_bp'),
              'max_yield_diff_pct':result.get('max_yield_diff_pct')}
    temporary=QUALIFICATION_PATH.with_suffix('.tmp')
    temporary.write_text(json.dumps(approval,allow_nan=False),encoding='utf-8')
    temporary.replace(QUALIFICATION_PATH)


def worker(mode,data=None):
    try:
        result=subprocess.run([BQL_PYTHON,str(ROOT/'scripts/probe_bloomberg_luac.py'),mode,'--provider',PROVIDER],
            input=json.dumps(data) if data is not None else None,capture_output=True,text=True,
            encoding='utf-8',timeout=15 if mode=='--health' else 270,
            creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        if result.returncode: return {'ready':False,'passed':False,'error_class':'bql_runtime_failed'}
        body=json.loads(result.stdout)
        if not isinstance(body,dict): raise ValueError()
        return body
    except subprocess.TimeoutExpired:
        return {'ready':False,'passed':False,'error_class':'query_timeout'}
    except (OSError,ValueError):
        return {'ready':False,'passed':False,'error_class':'bql_runtime_failed'}

def health():
    result=worker('--health')
    result['supported_runtime_confirmed']=SUPPORTED_RUNTIME_CONFIRMED
    result['preview_enabled']=PREVIEW_ENABLED
    result['api_qualified']=api_qualified()
    result['ready']=bool(result.get('ready') and SUPPORTED_RUNTIME_CONFIRMED)
    if not SUPPORTED_RUNTIME_CONFIRMED and not result.get('error_class'):
        result['error_class']='supported_runtime_unconfirmed'
    return result

def run_probe(baseline):
    validate_luac(baseline)
    if not SUPPORTED_RUNTIME_CONFIRMED:
        return {'passed':False,'error_class':'supported_runtime_unconfirmed'}
    if not PROBE_LOCK.acquire(blocking=False):
        return {'passed':False,'error_class':'probe_busy'}
    try:
        result=worker('--stdin',baseline)
        record_qualification(result,baseline)
        result['api_qualified']=api_qualified()
        return result
    finally: PROBE_LOCK.release()


def run_preview():
    if not PREVIEW_ENABLED or not SUPPORTED_RUNTIME_CONFIRMED:
        return {'ok':False,'error_class':'preview_disabled'}
    if not PROBE_LOCK.acquire(blocking=False):
        return {'ok':False,'error_class':'probe_busy'}
    try:
        if PEER_DEFINITIONS_PATH is not None:
            definitions=json.loads(PEER_DEFINITIONS_PATH.read_text(encoding='utf-8'))
            validate_peer_definitions(definitions)
        else:
            current=json.loads((ROOT/'assets/luac-bonds.json').read_text(encoding='utf-8'))
            validate_luac(current)
            definitions=current['peer_definitions']
        result=worker('--preview',{'peer_definitions':definitions})
        if result.get('ok'):
            validate_luac(result['data'])
            result['api_qualified']=api_qualified()
            if result.get('validation')!='schema_only' or result.get('comparison')!='not_verified':
                raise ValueError('invalid_preview')
        return result
    finally:
        PROBE_LOCK.release()

class Handler(BaseHTTPRequestHandler):
    server_version='LUACBQLBridge/2'
    def log_message(self,*args): pass
    def _origin(self):
        origin=self.headers.get('Origin')
        allowed=ALLOWED_ORIGINS | (PREVIEW_ORIGINS if PREVIEW_ENABLED else set())
        return origin if origin in allowed else None
    def _headers(self,status,origin=None):
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control','no-store')
        if origin:
            self.send_header('Access-Control-Allow-Origin',origin)
            self.send_header('Vary','Origin')
            self.send_header('Access-Control-Allow-Headers','Authorization, Content-Type')
            self.send_header('Access-Control-Allow-Methods','GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Private-Network','true')
        self.end_headers()
    def _json(self,status,value):
        self._headers(status,self._origin())
        self.wfile.write(json.dumps(value,allow_nan=False,separators=(',',':')).encode())
    def _authorized(self):
        return hmac.compare_digest(self.headers.get('Authorization',''),f'Bearer {self.server.token}')
    def do_OPTIONS(self):
        if not self._origin(): self._json(403,{'error':'origin_not_allowed'}); return
        self._headers(204,self._origin())
    def access(self):
        if not self._origin(): self._json(403,{'error':'origin_not_allowed'}); return False
        if not self._authorized(): self._json(401,{'error':'unauthorized'}); return False
        return True
    def do_GET(self):
        if self.path!='/health': self._json(404,{'error':'not_found'}); return
        if self.access():
            result=health()
            if getattr(self.server,'launcher_managed',False): result['launcher_managed']=True
            self._json(200,result)
    def do_POST(self):
        if self.path=='/launcher/stop' and getattr(self.server,'launcher_managed',False):
            if not self.access(): return
            if self.headers.get('Content-Length')!='2':
                self._json(400,{'error':'invalid_payload'}); return
            self.connection.settimeout(5)
            if self.rfile.read(2)!=b'{}':
                self._json(400,{'error':'invalid_payload'}); return
            self._json(200,{'stopping':True})
            threading.Thread(target=self.server.shutdown,daemon=True).start()
            return
        if self.path not in ('/probe','/preview'): self._json(404,{'error':'not_found'}); return
        if self.path=='/preview' and (not PREVIEW_ENABLED or self.headers.get('Origin') not in PREVIEW_ORIGINS):
            self._json(403,{'error':'preview_disabled'}); return
        if not self.access(): return
        try:
            self.connection.settimeout(10)
            length=int(self.headers.get('Content-Length','0'))
            if not 1<=length<=MAX_BODY:
                self._json(413,{'error':'payload_too_large'}); return
            payload=json.loads(self.rfile.read(length))
            if self.path=='/preview':
                if payload!={}: raise ValueError()
                self._json(200,run_preview())
            else:
                if not isinstance(payload,dict) or set(payload)!={'data'}: raise ValueError()
                self._json(200,run_probe(payload['data']))
        except (ValueError,TypeError,KeyError,TimeoutError):
            self._json(400,{'error':'invalid_payload'})
        except Exception:
            self._json(500,{'error':'diagnostic_failed'})

def main():
    global BQL_PYTHON,SUPPORTED_RUNTIME_CONFIRMED,PROVIDER,PREVIEW_ENABLED,PEER_DEFINITIONS_PATH,QUALIFICATION_PATH
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--token',required=True); p.add_argument('--port',type=int,default=8768)
    p.add_argument('--bql-python',default=sys.executable)
    p.add_argument('--provider',choices=('bql','polars-bloomberg'),default='bql')
    p.add_argument('--supported-runtime-confirmed',action='store_true')
    p.add_argument('--enable-preview',action='store_true',help='Allow token-authenticated read-only preview from the RV site or local lab')
    p.add_argument('--peer-definitions',type=Path,help='Validated mapping-only file for standalone launcher')
    p.add_argument('--launcher-managed',action='store_true',help='Stop on launcher stdin EOF; enable authenticated local stop')
    p.add_argument('--qualification-file',type=Path,help='Local aggregate evidence from a successful Excel comparison')
    a=p.parse_args()
    if len(a.token)<32: p.error('token must contain at least 32 characters')
    BQL_PYTHON=a.bql_python; SUPPORTED_RUNTIME_CONFIRMED=a.supported_runtime_confirmed; PROVIDER=a.provider
    PREVIEW_ENABLED=a.enable_preview
    PEER_DEFINITIONS_PATH=a.peer_definitions
    QUALIFICATION_PATH=a.qualification_file
    server=ThreadingHTTPServer(('127.0.0.1',a.port),Handler); server.token=a.token
    server.launcher_managed=a.launcher_managed
    if a.launcher_managed: server.daemon_threads=True
    if a.launcher_managed:
        def watch_launcher():
            while os.read(sys.stdin.fileno(), 4096):
                pass
            server.shutdown()
        threading.Thread(target=watch_launcher,daemon=True).start()
    print(f'BQL diagnostic bridge: http://127.0.0.1:{a.port}. No publishing endpoints.')
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()
if __name__=='__main__': main()
