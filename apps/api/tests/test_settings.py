from unittest.mock import patch

from django.core.exceptions import ImproperlyConfigured

from config.settings import env_bool, env_csv


def test_boolean_configuration_rejects_ambiguous_values():
    with patch.dict("os.environ", {"TEST_BOOLEAN": "sometimes"}):
        try:
            env_bool("TEST_BOOLEAN")
        except ImproperlyConfigured:
            pass
        else:
            raise AssertionError("Ambiguous flag must fail closed")


def test_csv_configuration_ignores_empty_elements():
    with patch.dict("os.environ", {"TEST_HOSTS": " a.example, , b.example "}):
        assert env_csv("TEST_HOSTS") == ["a.example", "b.example"]
