"""Regression tests for aggregate-only profiling quality signals."""

from datetime import timedelta
from io import StringIO

import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone

from datasets.models import Dataset, DatasetProfile
from datasets.profile_jobs import process_profile
from datasets.profiling import profile_dataset
from datasets.quality import assess_quality
from datasets.storage import save_upload
from identity.models import Workspace
from projects.models import Project


@pytest.fixture
def source(db, tmp_path):
    user = get_user_model().objects.create_user(
        username="quality_owner", password="ExamplePassword2026!"
    )
    workspace = Workspace.objects.create(owner=user, name="Quality Tests")
    project = Project.objects.create(workspace=workspace, name="Data")

    with override_settings(DATASET_STORAGE_ROOT=tmp_path):
        def make(content):
            key, checksum, size = save_upload(SimpleUploadedFile("data.csv", content))
            return Dataset.objects.create(
                project=project, uploaded_by=user, filename="data.csv",
                storage_key=key, sha256=checksum, size_bytes=size,
                status=Dataset.Status.READY,
            )

        yield make


def test_duplicate_rows_are_exactly_counted(source):
    dataset = source(b"id,value\n001,alpha\n002,beta\n001,alpha\n002,beta\n")
    result = profile_dataset(dataset)
    assert result["duplicate_rows"] == 2
    assert result["columns"][0]["inferred_type"] == "text"


def test_quality_rule_severities_are_explainable():
    summary = {
        "row_count": 4, "column_count": 2, "missing_cells": 4,
        "duplicate_rows": 1,
        "columns": [
            {"name": "empty", "missing_count": 4, "populated_count": 0,
             "missing_percent": 100, "distinct_count": 0, "distinct_count_exact": True},
            {"name": "status", "missing_count": 0, "populated_count": 4,
             "missing_percent": 0, "distinct_count": 1, "distinct_count_exact": True},
        ],
    }
    quality = assess_quality(summary)
    assert quality["completeness_percent"] == 50
    assert quality["duplicate_percent"] == 25
    assert {f["code"] for f in quality["findings"]} == {
        "duplicate_rows", "empty_column", "constant_column"
    }
    assert quality["finding_counts"] == {"high": 1, "warning": 1, "info": 1}


def test_no_findings_on_complete_variable_data():
    result = assess_quality({
        "row_count": 3, "column_count": 1, "missing_cells": 0,
        "duplicate_rows": 0,
        "columns": [{"name": "x", "missing_count": 0, "populated_count": 3,
                     "missing_percent": 0, "distinct_count": 3,
                     "distinct_count_exact": True}],
    })
    assert result["completeness_percent"] == 100
    assert result["findings"] == []


def test_persisted_profile_contains_quality_and_no_raw_rows(source):
    dataset = source(b"name,age\nAlice,20\nBob,\nAlice,20\n")
    profile = DatasetProfile.objects.create(dataset=dataset)
    assert process_profile(str(dataset.pk)) == "ready"
    profile.refresh_from_db()
    assert profile.result["duplicate_rows"] == 1
    assert profile.result["quality"]["duplicate_rows"] == 1
    assert "Alice" not in str(profile.result)


def test_manual_recovery_only_changes_stale_profiles(source):
    first = source(b"name\nAlice\n")
    second = source(b"name\nBob\n")
    stale = DatasetProfile.objects.create(
        dataset=first, status=DatasetProfile.Status.PROCESSING,
        started_at=timezone.now() - timedelta(minutes=90),
    )
    current = DatasetProfile.objects.create(
        dataset=second, status=DatasetProfile.Status.PROCESSING,
        started_at=timezone.now() - timedelta(minutes=5),
    )
    out = StringIO()
    call_command("recover_dataset_profiles", "--older-than-minutes=60", stdout=out)
    stale.refresh_from_db()
    current.refresh_from_db()
    assert stale.status == DatasetProfile.Status.FAILED
    assert stale.error_code == "processing_interrupted"
    assert current.status == DatasetProfile.Status.PROCESSING


def test_manual_recovery_dry_run_is_read_only(source):
    dataset = source(b"name\nAlice\n")
    profile = DatasetProfile.objects.create(
        dataset=dataset, status=DatasetProfile.Status.PROCESSING,
        started_at=timezone.now() - timedelta(minutes=90),
    )
    call_command("recover_dataset_profiles", "--dry-run", stdout=StringIO())
    profile.refresh_from_db()
    assert profile.status == DatasetProfile.Status.PROCESSING
