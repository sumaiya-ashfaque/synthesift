"""Offline release-smoke tests; no live application required."""

import unittest
from unittest.mock import patch

from scripts.check_release import CHECKS, main, run_checks


class ReleaseSmokeTests(unittest.TestCase):
    @patch("scripts.check_release.check_endpoint")
    def test_success_checks_both_real_health_routes(self, mock_endpoint):
        mock_endpoint.return_value = {"ok": True, "status": 200, "error": None}
        result = run_checks("http://127.0.0.1:8000/")
        self.assertEqual(set(result["checks"]), set(CHECKS))
        self.assertEqual(mock_endpoint.call_count, 2)

    @patch("scripts.check_release.check_endpoint")
    def test_nonhealthy_dependency_gives_nonzero_exit(self, mock_endpoint):
        mock_endpoint.side_effect = [
            {"ok": True, "status": 200, "error": None},
            {"ok": False, "status": 503, "error": None},
        ]
        self.assertEqual(main(["--url", "http://localhost:8000"]), 2)


if __name__ == "__main__":
    unittest.main()
