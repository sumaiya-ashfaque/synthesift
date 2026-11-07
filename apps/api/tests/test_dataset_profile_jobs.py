
"""Persistence and idempotency tests for CSV profiling jobs."""

import json

import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from datasets.models import Dataset, DatasetProfile
from datasets.storage import save_upload, storage_path
from datasets.tasks import profile_csv
from identity.models import Workspace
from projects.models import Project


@pytest.fixture
def profile_source(db, tmp_path):
    user = get_user_model().objects.create_user(
        username="profile_job_owner",
        password="ExamplePassword2026!",
    )

    workspace = Workspace.objects.create(
        owner=user,
        name="Profile Jobs",
    )

    project = Project.objects.create(
        workspace=workspace,
        name="Quality Analysis",
    )

    with override_settings(DATASET_STORAGE_ROOT=tmp_path):

        def create(
            content: bytes,
            status: str = Dataset.Status.READY,
        ) -> Dataset:
            uploaded = SimpleUploadedFile(
                "source.csv",
                content,
            )

            key, checksum, size = save_upload(uploaded)

            return Dataset.objects.create(
                project=project,
                uploaded_by=user,
                filename="source.csv",
                storage_key=key,
                sha256=checksum,
                size_bytes=size,
                status=status,
            )

        yield create


def test_profile_result_is_persisted(profile_source):
    dataset = profile_source(
        b"name,age\n"
        b"Alice,28\n"
        b"Bob,34\n"
    )

    profile = DatasetProfile.objects.create(
        dataset=dataset,
    )

    result = profile_csv.run(str(dataset.pk))
    profile.refresh_from_db()

    assert result == "ready"
    assert profile.status == DatasetProfile.Status.READY
    assert profile.schema_version == 1
    assert profile.completed_at is not None
    assert profile.started_at is None

    assert profile.result["row_count"] == 2
    assert profile.result["column_count"] == 2

    columns = {
        item["name"]: item
        for item in profile.result["columns"]
    }

    assert columns["age"]["inferred_type"] == "integer"
    assert columns["age"]["numeric"]["mean"] == "31"

    persisted = DatasetProfile.objects.get(
        dataset=dataset,
    )

    assert persisted.result == profile.result
    assert "Alice" not in json.dumps(persisted.result)
    assert "Bob" not in json.dumps(persisted.result)


def test_duplicate_task_is_skipped(profile_source):
    dataset = profile_source(
        b"age\n28\n34\n"
    )

    profile = DatasetProfile.objects.create(
        dataset=dataset,
    )

    first = profile_csv.run(str(dataset.pk))
    second = profile_csv.run(str(dataset.pk))

    profile.refresh_from_db()

    assert first == "ready"
    assert second == "skipped"
    assert profile.status == DatasetProfile.Status.READY


def test_queued_dataset_is_not_profiled(profile_source):
    dataset = profile_source(
        b"name\nAlice\n",
        status=Dataset.Status.QUEUED,
    )

    profile = DatasetProfile.objects.create(
        dataset=dataset,
    )

    result = profile_csv.run(str(dataset.pk))
    profile.refresh_from_db()

    assert result == "skipped"
    assert profile.status == DatasetProfile.Status.QUEUED
    assert profile.result == {}


def test_corrupted_original_fails_profiling(profile_source):
    dataset = profile_source(
        b"name\nAlice\n"
    )

    profile = DatasetProfile.objects.create(
        dataset=dataset,
    )

    storage_path(dataset.storage_key).write_bytes(
        b"name\nOther\n"
    )

    result = profile_csv.run(str(dataset.pk))
    profile.refresh_from_db()

    assert result == "failed"
    assert profile.status == DatasetProfile.Status.FAILED
    assert profile.error_code == "integrity_mismatch"
    assert profile.result == {}


def test_missing_profile_is_skipped(profile_source):
    dataset = profile_source(
        b"name\nAlice\n"
    )

    result = profile_csv.run(str(dataset.pk))

    assert result == "skipped"
    assert DatasetProfile.objects.count() == 0


def test_profile_is_deleted_with_dataset(profile_source):
    dataset = profile_source(
        b"name\nAlice\n"
    )

    DatasetProfile.objects.create(
        dataset=dataset,
    )

    dataset.delete()

    assert DatasetProfile.objects.count() == 0
