from __future__ import annotations

import http.client
import json
import threading
import unittest
from unittest.mock import patch

from scripts import bloomberg_bridge
from scripts.probe_bloomberg_luac import compare


class BloombergBridgeTests(unittest.TestCase):
    def setUp(self):
        self.server = bloomberg_bridge.ThreadingHTTPServer(("127.0.0.1", 0), bloomberg_bridge.Handler)
        self.server.token = "a" * 64
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)

    def tearDown(self):
        self.connection.close()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)

    def headers(self, authorized=True):
        result = {"Origin": "https://creditbase02.github.io", "Content-Type": "application/json"}
        if authorized:
            result["Authorization"] = f"Bearer {self.server.token}"
        return result

    def response(self):
        response = self.connection.getresponse()
        return response, json.loads(response.read() or b"{}")

    def test_health_requires_token_and_returns_no_terminal_data(self):
        self.connection.request("GET", "/health", headers=self.headers(False))
        response, body = self.response()
        self.assertEqual(response.status, 401)
        self.assertEqual(body, {"error": "unauthorized"})
        with patch.object(bloomberg_bridge, "health", return_value={"ready": True}):
            self.connection.request("GET", "/health", headers=self.headers())
            response, body = self.response()
        self.assertEqual(response.status, 200)
        self.assertEqual(body, {"ready": True})
        self.assertEqual(response.getheader("Access-Control-Allow-Origin"), "https://creditbase02.github.io")

    def test_private_network_preflight_and_probe_shape(self):
        self.connection.request("OPTIONS", "/probe", headers={"Origin": "https://creditbase02.github.io"})
        response = self.connection.getresponse()
        response.read()
        self.assertEqual(response.status, 204)
        self.assertEqual(response.getheader("Access-Control-Allow-Private-Network"), "true")
        expected = {"passed": False, "error_class": "comparison_failed"}
        with patch.object(bloomberg_bridge, "run_probe", return_value=expected) as run:
            body = json.dumps({"data": {}})
            self.connection.request("POST", "/probe", body=body, headers=self.headers())
            response, result = self.response()
        self.assertEqual(response.status, 200)
        self.assertEqual(result, expected)
        run.assert_called_once_with({})

    def test_probe_rejects_oversized_or_extra_payload(self):
        self.connection.request("POST", "/probe", body=b"", headers=self.headers())
        response, body = self.response()
        self.assertEqual(response.status, 413)
        self.assertEqual(body["error"], "payload_too_large")
        invalid = json.dumps({"data": {}, "filename": "forbidden.xlsx"})
        self.connection.request("POST", "/probe", body=invalid, headers=self.headers())
        response, body = self.response()
        self.assertEqual(response.status, 400)
        self.assertEqual(body["error"], "invalid_payload")

    def test_actual_requests_reject_untrusted_or_absent_origin(self):
        for origin in (None, 'https://untrusted.example'):
            headers = self.headers()
            if origin is None:
                headers.pop('Origin')
            else:
                headers['Origin'] = origin
            with patch.object(bloomberg_bridge, 'run_probe') as run:
                self.connection.request('POST', '/probe', body='{"data":{}}', headers=headers)
                response, body = self.response()
            self.assertEqual(response.status, 403)
            self.assertEqual(body, {'error':'origin_not_allowed'})
            run.assert_not_called()

    def test_preview_is_disabled_by_default_and_rejects_other_origins(self):
        for enabled,origin in ((False,'http://127.0.0.1:8767'),(False,'https://creditbase02.github.io'),(True,'https://untrusted.example')):
            headers=self.headers(); headers['Origin']=origin
            with patch.object(bloomberg_bridge,'PREVIEW_ENABLED',enabled),patch.object(bloomberg_bridge,'run_preview') as preview:
                self.connection.request('POST','/preview',body='{}',headers=headers)
                response,body=self.response()
                self.assertEqual(response.status,403)
                preview.assert_not_called()

    def test_production_preview_requires_opt_in_token_and_empty_body(self):
        with patch.object(bloomberg_bridge,'PREVIEW_ENABLED',True),patch.object(bloomberg_bridge,'run_preview',return_value={'ok':True}) as preview:
            self.connection.request('POST','/preview',body='{}',headers=self.headers(False))
            response,body=self.response()
            self.assertEqual(response.status,401)
            preview.assert_not_called()
            self.connection.request('POST','/preview',body='{}',headers=self.headers())
            response,body=self.response()
            self.assertEqual(response.status,200)
            preview.assert_called_once_with()

    def test_local_preview_requires_token_and_empty_body_and_has_no_publish_route(self):
        headers=self.headers(); headers['Origin']='http://127.0.0.1:8767'
        with patch.object(bloomberg_bridge,'PREVIEW_ENABLED',True),patch.object(bloomberg_bridge,'run_preview',return_value={'ok':True}) as preview:
            self.connection.request('POST','/preview',body='{}',headers=headers)
            response,body=self.response()
            self.assertEqual(response.status,200)
            preview.assert_called_once_with()
            self.connection.request('POST','/preview',body='{"filename":"private"}',headers=headers)
            response,body=self.response()
            self.assertEqual(response.status,400)
            self.assertEqual(preview.call_count,1)
            headers.pop('Authorization')
            self.connection.request('POST','/preview',body='{}',headers=headers)
            response,body=self.response()
            self.assertEqual(response.status,401)
            self.connection.request('POST','/publish/luac',body='{}',headers=headers)
            response,body=self.response()
            self.assertEqual(response.status,404)

    def test_malformed_payload_never_leaks_validation_details(self):
        for payload in ('[]', 'null', '{"data":{"private":"identifier"}}'):
            self.connection.request('POST', '/probe', body=payload, headers=self.headers())
            response, body = self.response()
            self.assertEqual(response.status, 400)
            self.assertEqual(body, {'error':'invalid_payload'})

    def test_comparison_reports_only_aggregate_thresholds(self):
        columns = ["id", "security_des", "issuer", "ticker", "maturity", "rating", "maturity_years", "oas_bp", "yield_pct", "industry", "flags"]
        baseline = {"schema_version": 2, "date": "2026-09-16", "columns": columns, "peer_definitions": [{"name": "Banks", "tickers": ["TK"]}], "records": [["ID1", "Bond", "Issuer", "TK", "2030-09-15", "A", 4, 100, 5, "Technology", []]]}
        candidate = json.loads(json.dumps(baseline))
        candidate["records"][0][7] = 100.4
        candidate["records"][0][8] = 5.009
        result = compare(candidate, baseline)
        self.assertTrue(result["eligible_for_api_planning"])
        self.assertAlmostEqual(result["max_oas_diff_bp"], 0.4)
        self.assertAlmostEqual(result["max_yield_diff_pct"], 0.009)
        self.assertNotIn("records", result)
        candidate["records"][0][9] = "Industrials"
        self.assertFalse(compare(candidate, baseline)["eligible_for_api_planning"])


if __name__ == "__main__":
    unittest.main()
