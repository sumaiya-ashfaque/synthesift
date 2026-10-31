
"""Project-scoped CSV admission tests."""

import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APIClient

from datasets.models import Dataset
from datasets.storage import storage_path
from identity.models import Workspace, WorkspaceMembership
from projects.models import Project


@pytest.fixture
def admission(db, tmp_path):
    user_model = get_user_model()
    users = {
        role: user_model.objects.create_user(
            username=role,
            password="SafeExample2026!",
        )
        for role in ("owner", "editor", "viewer", "outsider")
    }

    workspace = Workspace.objects.create(
        owner=users["owner"],
        name="Research",
    )

    for role in ("editor", "viewer"):
        WorkspaceMembership.objects.create(
            workspace=workspace,
            user=users[role],
            role=role,
        )

    project = Project.objects.create(
        workspace=workspace,
        name="Customers",
    )

    path = (
        f"/api/v1/workspaces/{workspace.pk}"
        f"/projects/{project.pk}/datasets"
    )

    with override_settings(DATASET_STORAGE_ROOT=tmp_path):
        yield users, workspace, project, path


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def csv_file(
    content=b"name,age\nAlex,24\n",
    name="people.csv",
):
    return SimpleUploadedFile(
        name,
        content,
        content_type="text/csv",
    )


@pytest.mark.django_db
def test_owner_can_upload(admission):
    users, _, project, path = admission

    response = client_for(users["owner"]).post(
        path,
        {"file": csv_file()},
        format="multipart",
    )

    assert response.status_code == 201, response.content
    data = response.json()

    assert data["project"] == str(project.pk)
    assert data["status"] == "queued"
    assert data["filename"] == "people.csv"
    assert data["row_count"] is None

    dataset = Dataset.objects.get(pk=data["id"])

    assert storage_path(dataset.storage_key).read_bytes() == (
        b"name,age\nAlex,24\n"
    )
    assert "storage_key" not in data


@pytest.mark.django_db
def test_editor_can_upload_viewer_cannot(admission):
    users, _, _, path = admission

    editor = client_for(users["editor"])
    viewer = client_for(users["viewer"])

    response = editor.post(
        path,
        {"file": csv_file()},
        format="multipart",
    )
    assert response.status_code == 201

    assert viewer.get(path).status_code == 200

    assert viewer.post(
        path,
        {"file": csv_file()},
        format="multipart",
    ).status_code == 403

    assert Dataset.objects.count() == 1


@pytest.mark.django_db
def test_outsider_cannot_access_project(admission):
    users, _, _, path = admission
    outsider = client_for(users["outsider"])

    assert outsider.get(path).status_code == 404

    assert outsider.post(
        path,
        {"file": csv_file()},
        format="multipart",
    ).status_code == 404

    assert APIClient().get(path).status_code == 401


@pytest.mark.django_db
def test_dataset_cannot_be_accessed_from_another_project(admission):
    users, workspace, _, path = admission
    client = client_for(users["owner"])

    response = client.post(
        path,
        {"file": csv_file()},
        format="multipart",
    )

    dataset_id = response.json()["id"]

    another = Project.objects.create(
        workspace=workspace,
        name="Invoices",
    )

    other_path = (
        f"/api/v1/workspaces/{workspace.pk}"
        f"/projects/{another.pk}/datasets"
    )

    assert client.get(
        f"{other_path}/{dataset_id}"
    ).status_code == 404


@pytest.mark.django_db
def test_invalid_upload_rejected(admission):
    users, _, _, path = admission
    client = client_for(users["owner"])

    assert client.post(
        path, {}, format="multipart"
    ).status_code == 400

    assert client.post(
        path,
        {"file": csv_file(name="notes.txt")},
        format="multipart",
    ).status_code == 400

    assert Dataset.objects.count() == 0


@pytest.mark.django_db
def test_upload_size_limit(admission):
    users, _, _, path = admission

    with override_settings(DATASET_MAX_UPLOAD_BYTES=5):
        response = client_for(users["owner"]).post(
            path,
            {"file": csv_file()},
            format="multipart",
        )

    assert response.status_code == 413
    assert Dataset.objects.count() == 0


@pytest.mark.django_db
def test_duplicate_uploads_are_separate_records(admission):
    users, _, _, path = admission
    client = client_for(users["owner"])

    first = client.post(
        path, {"file": csv_file()}, format="multipart"
    ).json()

    second = client.post(
        path, {"file": csv_file()}, format="multipart"
    ).json()

    assert first["id"] != second["id"]
    assert first["sha256"] == second["sha256"]
    assert Dataset.objects.count() == 2

    listing = client.get(path).json()
    assert listing["count"] == 2
    assert len(listing["results"]) == 2


@pytest.mark.django_db
def test_storage_failure_returns_503(admission, monkeypatch):
    users, _, _, path = admission

    def unavailable(uploaded):
        raise OSError("Storage unavailable")

    monkeypatch.setattr(
        "datasets.api.save_upload",
        unavailable,
    )

    response = client_for(users["owner"]).post(
        path,
        {"file": csv_file()},
        format="multipart",
    )

    assert response.status_code == 503
    assert Dataset.objects.count() == 0


@pytest.mark.django_db
def test_upload_requires_csrf_for_session_auth(admission):
    users, _, _, path = admission

    client = APIClient(enforce_csrf_checks=True)
    client.force_login(users["owner"])

    response = client.post(
        path,
        {"file": csv_file()},
        format="multipart",
    )

    assert response.status_code == 403
    assert Dataset.objects.count() == 0
