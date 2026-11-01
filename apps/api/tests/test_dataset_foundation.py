import hashlib

import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.exceptions import ValidationError

from datasets.models import Dataset
from datasets.storage import (
    UploadTooLarge,
    save_upload,
    storage_path,
)
from identity.models import Workspace
from projects.models import Project


def test_upload_storage_preserves_content(tmp_path):
    content = b"name,age\nAlex,24\nSam,31\n"

    with override_settings(DATASET_STORAGE_ROOT=tmp_path):
        uploaded = SimpleUploadedFile("people.csv", content)

        key, checksum, size = save_upload(uploaded)

        assert storage_path(key).read_bytes() == content
        assert checksum == hashlib.sha256(content).hexdigest()
        assert size == len(content)


def test_repeated_upload_creates_distinct_files(tmp_path):
    content = b"name\nAlex\n"

    with override_settings(DATASET_STORAGE_ROOT=tmp_path):
        first = save_upload(
            SimpleUploadedFile("first.csv", content)
        )

        second = save_upload(
            SimpleUploadedFile("second.csv", content)
        )

        assert first[0] != second[0]
        assert first[1] == second[1]

        assert storage_path(first[0]).read_bytes() == content
        assert storage_path(second[0]).read_bytes() == content


def test_empty_upload_is_rejected(tmp_path):
    with override_settings(DATASET_STORAGE_ROOT=tmp_path):
        uploaded = SimpleUploadedFile("empty.csv", b"")

        with pytest.raises(ValidationError):
            save_upload(uploaded)

        assert not list(tmp_path.rglob("*.csv"))


def test_oversized_upload_is_rejected(tmp_path):
    with override_settings(
        DATASET_STORAGE_ROOT=tmp_path,
        DATASET_MAX_UPLOAD_BYTES=10,
    ):
        uploaded = SimpleUploadedFile(
            "large.csv",
            b"name\n" + b"A" * 20,
        )

        with pytest.raises(UploadTooLarge):
            save_upload(uploaded)

        assert not list(tmp_path.rglob("*.csv"))


@pytest.mark.parametrize(
    "key",
    [
        "../private.csv",
        "/etc/passwd",
        "invalid.csv",
        "aa/../../private.csv",
        "aa/not-a-valid-identifier.csv",
    ],
)
def test_storage_rejects_untrusted_paths(key):
    with pytest.raises(ValueError):
        storage_path(key)


@pytest.mark.django_db
def test_dataset_is_associated_with_project():
    user = get_user_model().objects.create_user(
        username="dataset_owner",
        password="ExamplePassword2026!",
    )

    workspace = Workspace.objects.create(
        owner=user,
        name="Data Engineering",
    )

    project = Project.objects.create(
        workspace=workspace,
        name="Customer Records",
    )

    dataset = Dataset.objects.create(
        project=project,
        uploaded_by=user,
        filename="customers.csv",
        storage_key="ab/" + "ab" + "0" * 30 + ".csv",
        sha256="0" * 64,
        size_bytes=128,
    )

    assert dataset.status == Dataset.Status.QUEUED
    assert dataset.project == project
    assert dataset.uploaded_by == user
    assert project.datasets.count() == 1