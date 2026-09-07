"""HTTP contract tests; never contact Tripo or load a real API key."""
import importlib.util
import io
import os
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

with patch.dict(os.environ, {"TRIPO_API_KEY": "test-key"}):
    spec = importlib.util.spec_from_file_location("tripo", os.path.join(os.path.dirname(__file__), "tripo.py"))
    tripo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tripo)


class TripoHttpTests(unittest.TestCase):
    def test_authenticated_get_and_post_identify_the_application(self):
        for body, method in [(None, "GET"), ({}, "POST"), ({"type": "animate_rig"}, "POST")]:
            with self.subTest(method=method, body=body):
                with patch.object(tripo.urllib.request, "urlopen", return_value=io.BytesIO(b'{"code":0}')) as send:
                    self.assertEqual(tripo.http(tripo.BASE + "/task", body), {"code": 0})
                    req, data = send.call_args.args
                    self.assertEqual(req.get_method(), method)
                    self.assertEqual(req.get_header("User-agent"), tripo.USER_AGENT)
                    self.assertEqual(req.get_header("Authorization"), "Bearer test-key")
                    if body is not None:
                        self.assertEqual(tripo.json.loads(data), body)
                        self.assertEqual(req.get_header("Content-type"), "application/json")
                    else:
                        self.assertIsNone(data)

    def test_edge_block_is_not_blindly_retried(self):
        url = tripo.BASE + "/task"
        error = HTTPError(url, 403, "Forbidden", {}, io.BytesIO(b"error code: 1010"))
        with patch.object(tripo.urllib.request, "urlopen", side_effect=error) as send:
            with self.assertRaisesRegex(RuntimeError, "HTTP 403.*1010"):
                tripo.http(url, {"type": "image_to_model"})
            self.assertEqual(send.call_count, 1)


if __name__ == "__main__":
    unittest.main()
