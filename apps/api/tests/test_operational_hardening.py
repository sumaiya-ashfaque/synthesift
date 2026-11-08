"""Read-only audits and conservative stale analysis recovery checks."""

import hashlib
import io
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import override_settings
from django.utils import timezone

from ai_remediation.models import AIReport
from core.operational_checks import (
    deployment_findings,
    stale_report_reason,
    verify_stored_file,
)
from datasets.models import Dataset
from identity.models import Workspace
from projects.models import Project


def test_storage_verifier_checks_bytes_digest_and_path(tmp_path):
    identifier = "ab" + "1" * 30
    key = f"ab/{identifier}.csv"
    content = b"name\nAlice\n"
    target = tmp_path / "ab" / f"{identifier}.csv"
    target.parent.mkdir()
    target.write_bytes(content)
    digest = hashlib.sha256(content).hexdigest()
    assert verify_stored_file(tmp_path, key, digest, len(content), 1024) == "ok"
    assert verify_stored_file(tmp_path, key, "0" * 64, len(content), 1024) == "sha256_mismatch"
    assert verify_stored_file(tmp_path, key, digest, len(content) - 1, 1024) == "size_mismatch"
    assert verify_stored_file(tmp_path, "../outside.csv", digest, len(content), 1024) == "invalid_storage_key"
    target.unlink()
    assert verify_stored_file(tmp_path, key, digest, len(content), 1024) == "missing_file"


def test_storage_verifier_rejects_symlink_escape(tmp_path):
    outside = tmp_path.parent / "outside.csv"
    content = b"private data\n"
    outside.write_bytes(content)
    identifier = "cd" + "1" * 30
    target = tmp_path / "cd" / f"{identifier}.csv"
    target.parent.mkdir()
    try:
        target.symlink_to(outside)
    except OSError:
        pytest.skip("Symlink creation unavailable")
    assert verify_stored_file(
        tmp_path, f"cd/{identifier}.csv", hashlib.sha256(content).hexdigest(), len(content), 1024,
    ) == "storage_escape"


def test_stale_recovery_never_selects_ready_or_recent():
    now = timezone.now()
    old = now - timedelta(hours=2)
    recent = now - timedelta(minutes=1)
    common = dict(now=now, queued_minutes=90, processing_minutes=20)
    assert stale_report_reason(status="queued", created_at=old, started_at=None, **common) == "stale_queued"
    assert stale_report_reason(status="processing", created_at=old, started_at=old, **common) == "stale_processing"
    assert stale_report_reason(status="processing", created_at=old, started_at=recent, **common) is None
    assert stale_report_reason(status="ready", created_at=old, started_at=old, **common) is None


def test_deployment_findings_do_not_disclose_credentials():
    config = SimpleNamespace(
        APP_ENV="production", DEBUG=False, SECRET_KEY="a-private-value",
        ALLOWED_HOSTS=["example.com"], SESSION_COOKIE_SECURE=True,
        CSRF_COOKIE_SECURE=True, SECURE_CONTENT_TYPE_NOSNIFF=True,
        SECURE_SSL_REDIRECT=True, GEMINI_API_KEY="secret-value",
        DATASET_STORAGE_ROOT=Path("/data/datasets"),
    )
    assert deployment_findings(config) == []
    config.DEBUG = True
    config.SECRET_KEY = "unsafe-development"
    result = deployment_findings(config)
    assert {code for _, code, _ in result} >= {"debug_enabled", "development_secret"}
    assert "secret-value" not in str(result)


@pytest.fixture
def operational_dataset(db):
    owner = get_user_model().objects.create_user(
        username="ops_owner", password="strong-testing-passphrase"
    )
    workspace = Workspace.objects.create(owner=owner, name="Operational Review")
    project = Project.objects.create(workspace=workspace, name="Audits")
    dataset = Dataset.objects.create(
        project=project, uploaded_by=owner, filename="sample.csv",
        storage_key="ab/" + "ab" + "1" * 30 + ".csv",
        sha256="0" * 64, size_bytes=8, status=Dataset.Status.READY,
    )
    return owner, dataset


@pytest.mark.django_db
def test_dataset_integrity_command_read_only_and_nonleaking(operational_dataset, tmp_path):
    _, dataset = operational_dataset
    data = b"key\nval\n"
    dataset.sha256 = hashlib.sha256(data).hexdigest()
    dataset.size_bytes = len(data)
    dataset.save(update_fields=["sha256", "size_bytes"])
    target = tmp_path / dataset.storage_key
    target.parent.mkdir()
    target.write_bytes(data)
    with override_settings(DATASET_STORAGE_ROOT=tmp_path, DATASET_MAX_UPLOAD_BYTES=1024):
        output = io.StringIO()
        call_command("audit_dataset_storage", limit=10, stdout=output)
        assert "integrity findings: 0" in output.getvalue()
        assert "val" not in output.getvalue()
        target.write_bytes(b"changed")
        with pytest.raises(CommandError):
            call_command("audit_dataset_storage", fail_on_error=True, stdout=io.StringIO())


@pytest.mark.django_db
def test_recovery_defaults_dry_run_and_never_resends(operational_dataset):
    owner, dataset = operational_dataset
    report = AIReport.objects.create(
        dataset=dataset, requested_by=owner, technique="few_shot",
        model="gemini-3.5-flash-lite", thinking_level="low",
        max_output_tokens=3072, profile_digest="0" * 64,
        consent_at=timezone.now(),
    )
    AIReport.objects.filter(pk=report.pk).update(
        created_at=timezone.now() - timedelta(hours=3)
    )
    call_command("recover_ai_reports", stdout=io.StringIO())
    report.refresh_from_db()
    assert report.status == AIReport.Status.QUEUED
    call_command("recover_ai_reports", apply=True, stdout=io.StringIO())
    report.refresh_from_db()
    assert report.status == AIReport.Status.FAILED
    assert report.error_code == "stale_queued"
    assert report.completed_at is not None
