"""Worker verification is an operator-only command, never a public route."""

from io import StringIO
from unittest.mock import Mock, patch

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError


def test_verify_worker_accepts_expected_task_result():
    result = Mock()
    result.get.return_value = {"status": "ok", "worker": "synthesift-worker"}
    output = StringIO()
    with patch("core.management.commands.verify_worker.worker_ping.apply_async", return_value=result):
        call_command("verify_worker", stdout=output)
    assert "succeeded" in output.getvalue().lower()


def test_verify_worker_rejects_unexpected_task_result():
    result = Mock()
    result.get.return_value = {"status": "unknown"}
    with patch("core.management.commands.verify_worker.worker_ping.apply_async", return_value=result):
        with pytest.raises(CommandError, match="unexpected"):
            call_command("verify_worker")
