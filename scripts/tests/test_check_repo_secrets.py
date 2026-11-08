"""Regression tests for conservative, non-leaking secret detection."""

import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "check_repo_secrets.py"
spec = importlib.util.spec_from_file_location("check_repo_secrets", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SecretScanTests(unittest.TestCase):
    def test_detects_google_key_without_emitting_value(self):
        fake = "AI" + "za" + "A" * 35
        self.assertEqual(module.scan_text("value=" + fake), [(1, "google_api_key")])

    def test_detects_private_key_headers(self):
        self.assertEqual(
            module.scan_text("-----BEGIN " + "PRIVATE KEY-----"),
            [(1, "private_key_header")],
        )

    def test_ordinary_placeholders_are_not_secrets(self):
        self.assertEqual(module.scan_text("GEMINI_API_KEY=replace-with-your-key"), [])
        self.assertEqual(module.scan_text("sk-not-a-real-key"), [])


if __name__ == "__main__":
    unittest.main()
