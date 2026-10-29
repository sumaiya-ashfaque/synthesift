"""Contract validation must reject an unreviewed public route."""

import unittest

from scripts.check_contract import operations


class ContractSurfaceTests(unittest.TestCase):
    def test_operations_ignore_schema_metadata(self):
        self.assertEqual(
            operations({"paths": {"/api/v1/meta": {"get": {}, "parameters": []}}}),
            {("/api/v1/meta", "get")},
        )

    def test_unreviewed_route_changes_surface(self):
        approved = {"paths": {"/api/v1/meta": {"get": {}}}}
        proposed = {"paths": {**approved["paths"], "/api/v1/projects": {"post": {}}}}
        self.assertNotEqual(operations(approved), operations(proposed))


if __name__ == "__main__":
    unittest.main()
