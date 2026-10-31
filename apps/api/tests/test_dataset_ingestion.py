
"""Tests for bounded CSV validation and asynchronous admission."""

import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from datasets.models import Dataset
from datasets.storage import save_upload, storage_path
from datasets.tasks import ingest_dataset
from identity.models import Workspace
from projects.models import Project


@pytest.fixture
def create_dataset(db, tmp_path):
    user = get_user_model().objects.create_user(
        username="ingestion_owner",
        password="ExamplePassword2026!",
    )

    workspace = Workspace.objects.create(
        owner=user,
        name="Ingestion Tests",
    )

    project = Project.objects.create(
        workspace=workspace,
        name="CSV Project",
    )

    with override_settings(DATASET_STORAGE_ROOT=tmp_path):

        def create(content):
            uploaded = SimpleUploadedFile(
                "source.csv",
                content,
                content_type="text/csv",
            )

            key, checksum, size = save_upload(uploaded)

            return Dataset.objects.create(
                project=project,
                uploaded_by=user,
                filename="source.csv",
                storage_key=key,
                sha256=checksum,
                size_bytes=size,
            )

        yield create


def test_valid_csv_is_admitted(create_dataset):
    dataset = create_dataset(
        b"\xef\xbb\xbfname,notes\n"
        b'Alex,"hello, world"\n'
        b'Sam,"two\nlines"\n'
    )

    result = ingest_dataset.run(str(dataset.pk))
    dataset.refresh_from_db()

    assert result == "ready"
    assert dataset.status == Dataset.Status.READY
    assert dataset.row_count == 2
    assert dataset.column_count == 2
    assert dataset.columns == ["name", "notes"]
    assert dataset.completed_at is not None


@pytest.mark.parametrize(
    ("content", "expected_code"),
    [
        (b"name,name\nAlex,Sam\n", "duplicate_header"),
        (b"name,age\nAlex\n", "inconsistent_columns"),
        (b"name,age\nAlex,24,extra\n", "inconsistent_columns"),
        (b"name,age\n", "no_data_rows"),
        (b"name,age\nAlex,\xff\n", "invalid_utf8"),
        (b"name,age\nAlex,\x00\n", "invalid_cell"),
        (b",age\nAlex,24\n", "invalid_header"),
        (b"name,age\nAlex,\"unfinished\n", "malformed_csv"),
    ],
)
def test_invalid_csv_is_rejected(
    create_dataset,
    content,
    expected_code,
):
    dataset = create_dataset(content)

    result = ingest_dataset.run(str(dataset.pk))
    dataset.refresh_from_db()

    assert result == "failed"
    assert dataset.status == Dataset.Status.FAILED
    assert dataset.error_code == expected_code
    assert dataset.completed_at is not None


def test_tampered_file_fails_integrity(create_dataset):
    dataset = create_dataset(b"name\nAlex\n")

    storage_path(dataset.storage_key).write_bytes(
        b"name\nOther\n"
    )

    result = ingest_dataset.run(str(dataset.pk))
    dataset.refresh_from_db()

    assert result == "failed"
    assert dataset.error_code == "integrity_mismatch"


def test_duplicate_processing_is_idempotent(create_dataset):
    dataset = create_dataset(b"name\nAlex\n")

    first = ingest_dataset.run(str(dataset.pk))
    second = ingest_dataset.run(str(dataset.pk))

    assert first == "ready"
    assert second == "skipped"


def test_row_limit_is_enforced(create_dataset):
    dataset = create_dataset(b"name\nAlex\nSam\n")

    with override_settings(DATASET_MAX_ROWS=1):
        result = ingest_dataset.run(str(dataset.pk))

    dataset.refresh_from_db()

    assert result == "failed"
    assert dataset.error_code == "too_many_rows"


def test_column_limit_is_enforced(create_dataset):
    dataset = create_dataset(b"a,b,c\n1,2,3\n")

    with override_settings(DATASET_MAX_COLUMNS=2):
        result = ingest_dataset.run(str(dataset.pk))

    dataset.refresh_from_db()

    assert result == "failed"
    assert dataset.error_code == "too_many_columns"
