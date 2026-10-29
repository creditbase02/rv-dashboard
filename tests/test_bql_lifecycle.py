"""Real bridge lifecycle checks without Bloomberg or market queries."""
import http.client
import json
from pathlib import Path
import socket
import subprocess
import sys
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]


class LifecycleTests(unittest.TestCase):
    def start_bridge(self):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        process = subprocess.Popen([
            sys.executable, str(ROOT/'scripts/bloomberg_bridge.py'),
            '--token', 'a'*64, '--port', str(port), '--launcher-managed',
        ], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.addCleanup(self.cleanup, process)
        for _ in range(100):
            try:
                with socket.create_connection(('127.0.0.1', port), timeout=.1):
                    return process, port
            except OSError:
                if process.poll() is not None:
                    self.fail('Bridge exited before startup')
                time.sleep(.05)
        self.fail('Bridge did not listen')

    @staticmethod
    def cleanup(process):
        if process.stdin and not process.stdin.closed:
            process.stdin.close()
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=10)

    def request(self, port, token, body=b'{}', origin='https://creditbase02.github.io'):
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
        connection.request('POST', '/launcher/stop', body=body,
                           headers={'Origin':origin, 'Authorization':'Bearer '+token})
        response = connection.getresponse()
        status = response.status
        response.read()
        connection.close()
        return status

    def test_launcher_exit_closes_bridge(self):
        process, _ = self.start_bridge()
        process.stdin.close()
        self.assertEqual(process.wait(timeout=10), 0)

    def test_reset_requires_correct_token_origin_and_empty_object(self):
        process, port = self.start_bridge()
        self.assertEqual(self.request(port, 'b'*64, body=b''), 401)
        self.assertIsNone(process.poll())
        self.assertEqual(self.request(port, 'a'*64, body=b'', origin='https://untrusted.example'), 403)
        self.assertEqual(self.request(port, 'a'*64, body=b'[]'), 400)
        self.assertIsNone(process.poll())
        self.assertEqual(self.request(port, 'a'*64), 200)
        self.assertEqual(process.wait(timeout=10), 0)
