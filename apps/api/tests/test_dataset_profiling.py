
"""Tests for deterministic, aggregate-only CSV profiling."""

import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from datasets.ingestion import AdmissionError
from datasets.models import Dataset
from datasets.profiling import profile_dataset
from datasets.storage import save_upload, storage_path
from identity.models import Workspace
from projects.models import Project


@pytest.fixture
def profile_source(db, tmp_path):
    user = get_user_model().objects.create_user(
        username="profile_owner",
        password="ExamplePassword2026!",
    )

    workspace = Workspace.objects.create(
        owner=user,
        name="Profiling Tests",
    )

    project = Project.objects.create(
        workspace=workspace,
        name="Profiles",
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


def test_column_types_missingness_and_numeric_summary(
    profile_source,
):
    dataset = profile_source(
        b"age,spend,active,joined,note\n"
        b"28,10.50,true,2026-01-01,x\n"
        b",7.50,false,2026-01-02,\n"
        b"40,,true,2026-01-03,x\n"
    )

    summary = profile_dataset(dataset)

    columns = {
        column["name"]: column
        for column in summary["columns"]
    }

    assert summary["row_count"] == 3
    assert summary["column_count"] == 5
    assert summary["missing_cells"] == 3

    assert columns["age"]["inferred_type"] == "integer"
    assert columns["age"]["missing_count"] == 1
    assert columns["age"]["missing_percent"] == 33.33
    assert columns["age"]["distinct_count"] == 2

    assert columns["spend"]["inferred_type"] == "decimal"
    assert columns["spend"]["numeric"] == {
        "min": "7.50",
        "max": "10.50",
        "mean": "9.00",
    }

    assert columns["active"]["inferred_type"] == "boolean"
    assert columns["joined"]["inferred_type"] == "date"
    assert columns["note"]["inferred_type"] == "text"
    assert columns["note"]["distinct_count"] == 1


def test_whitespace_is_missing_and_empty_column_is_distinguished(
    profile_source,
):
    dataset = profile_source(
        b"blank,value\n"
        b" , A \n"
        b", B\n"
    )

    summary = profile_dataset(dataset)

    blank, value = summary["columns"]

    assert blank["inferred_type"] == "empty"
    assert blank["missing_count"] == 2
    assert blank["missing_percent"] == 100

    assert value["inferred_type"] == "text"
    assert value["distinct_count"] == 2


def test_distinct_counter_is_bounded(profile_source):
    dataset = profile_source(
        b"value\n"
        b"a\n"
        b"b\n"
        b"c\n"
    )

    with override_settings(DATASET_PROFILE_DISTINCT_LIMIT=2):
        column = profile_dataset(dataset)["columns"][0]

    assert column["distinct_count"] is None
    assert column["distinct_count_exact"] is False


def test_invalid_number_literals_are_not_numeric(profile_source):
    dataset = profile_source(
        b"value\n"
        b"NaN\n"
        b"Infinity\n"
    )

    column = profile_dataset(dataset)["columns"][0]

    assert column["inferred_type"] == "text"
    assert column["numeric"] is None


def test_profile_rejects_queued_dataset(profile_source):
    dataset = profile_source(
        b"name\nAlice\n",
        status=Dataset.Status.QUEUED,
    )

    with pytest.raises(
        ValueError,
        match="Only ready datasets",
    ):
        profile_dataset(dataset)


def test_profile_rechecks_checksum(profile_source):
    dataset = profile_source(b"name\nAlice\n")

    storage_path(dataset.storage_key).write_bytes(
        b"name\nOther\n"
    )

    with pytest.raises(AdmissionError) as error:
        profile_dataset(dataset)

    assert error.value.code == "integrity_mismatch"


def test_leading_zero_identifiers_remain_text(profile_source):
    dataset = profile_source(
        b"customer_id\n"
        b"00123\n"
        b"00456\n"
    )

    column = profile_dataset(dataset)["columns"][0]

    assert column["inferred_type"] == "text"
    assert column["numeric"] is None
