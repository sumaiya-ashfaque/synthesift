"""Authorization, dispatch, and profile-state tests for the profiling API."""

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from datasets.models import Dataset, DatasetProfile
from identity.models import Workspace, WorkspaceMembership
from projects.models import Project


@pytest.fixture
def context(db):
    user_model = get_user_model()
    users = {
        role: user_model.objects.create_user(
            username=f"profile_{role}",
            password="ExamplePassword2026!",
        )
        for role in ("owner", "editor", "viewer", "outsider")
    }

    workspace = Workspace.objects.create(
        owner=users["owner"],
        name="Profile API Tests",
    )
    for role in ("editor", "viewer"):
        WorkspaceMembership.objects.create(
            workspace=workspace,
            user=users[role],
            role=role,
        )

    project = Project.objects.create(workspace=workspace, name="Research")
    dataset = Dataset.objects.create(
        project=project,
        uploaded_by=users["owner"],
        filename="records.csv",
        storage_key="ab/" + "ab" + "0" * 30 + ".csv",
        sha256="0" * 64,
        size_bytes=32,
        status=Dataset.Status.READY,
    )
    endpoint = (
        f"/api/v1/workspaces/{workspace.pk}"
        f"/projects/{project.pk}/datasets/{dataset.pk}/profile"
    )
    return users, workspace, project, dataset, endpoint


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def test_owner_queues_profile(context, monkeypatch, django_capture_on_commit_callbacks):
    users, _, _, dataset, endpoint = context
    dispatched = []
    monkeypatch.setattr(
        "datasets.profile_api.profile_csv.delay", dispatched.append
    )

    with django_capture_on_commit_callbacks(execute=True):
        response = client_for(users["owner"]).post(endpoint)

    assert response.status_code == 202
    assert DatasetProfile.objects.count() == 1
    assert dispatched == [str(dataset.pk)]
    assert DatasetProfile.objects.get(dataset=dataset).status == "queued"


def test_repeated_post_does_not_republish(
    context, monkeypatch, django_capture_on_commit_callbacks
):
    users, _, _, dataset, endpoint = context
    dispatched = []
    monkeypatch.setattr(
        "datasets.profile_api.profile_csv.delay", dispatched.append
    )
    client = client_for(users["owner"])
    with django_capture_on_commit_callbacks(execute=True):
        first = client.post(endpoint)
        second = client.post(endpoint)
    assert first.status_code == 202
    assert second.status_code == 202
    assert DatasetProfile.objects.count() == 1
    assert dispatched == [str(dataset.pk)]


def test_completed_profile_is_not_republished(context, monkeypatch):
    users, _, _, dataset, endpoint = context
    DatasetProfile.objects.create(
        dataset=dataset,
        status=DatasetProfile.Status.READY,
        result={"row_count": 2, "column_count": 1, "columns": []},
    )

    def unexpected_dispatch(_dataset_id):
        pytest.fail("Completed profiles must not be dispatched again")

    monkeypatch.setattr(
        "datasets.profile_api.profile_csv.delay", unexpected_dispatch
    )
    response = client_for(users["owner"]).post(endpoint)
    assert response.status_code == 200
    assert response.json()["result"]["row_count"] == 2


def test_viewer_cannot_start_profiling(context):
    users, _, _, _, endpoint = context
    assert client_for(users["viewer"]).post(endpoint).status_code == 403
    assert DatasetProfile.objects.count() == 0


def test_viewer_can_read_profile(context):
    users, _, _, dataset, endpoint = context
    DatasetProfile.objects.create(
        dataset=dataset,
        status=DatasetProfile.Status.READY,
        result={"row_count": 2},
    )
    response = client_for(users["viewer"]).get(endpoint)
    assert response.status_code == 200
    assert response.json()["result"]["row_count"] == 2


def test_outsider_cannot_access_profile(context):
    users, _, _, dataset, endpoint = context
    DatasetProfile.objects.create(dataset=dataset)
    outsider = client_for(users["outsider"])
    assert outsider.get(endpoint).status_code == 404
    assert outsider.post(endpoint).status_code == 404


def test_profile_not_found_returns_404(context):
    users, _, _, _, endpoint = context
    assert client_for(users["owner"]).get(endpoint).status_code == 404


def test_non_ready_dataset_returns_conflict(context):
    users, _, _, dataset, endpoint = context
    dataset.status = Dataset.Status.PROCESSING
    dataset.save(update_fields=["status"])
    assert client_for(users["owner"]).post(endpoint).status_code == 409
    assert DatasetProfile.objects.count() == 0


def test_failed_profile_can_be_retried(
    context, monkeypatch, django_capture_on_commit_callbacks
):
    users, _, _, dataset, endpoint = context
    profile = DatasetProfile.objects.create(
        dataset=dataset,
        status=DatasetProfile.Status.FAILED,
        error_code="queue_unavailable",
    )
    dispatched = []
    monkeypatch.setattr(
        "datasets.profile_api.profile_csv.delay", dispatched.append
    )
    with django_capture_on_commit_callbacks(execute=True):
        response = client_for(users["editor"]).post(endpoint)
    profile.refresh_from_db()
    assert response.status_code == 202
    assert profile.status == DatasetProfile.Status.QUEUED
    assert profile.error_code == ""
    assert dispatched == [str(dataset.pk)]


def test_broker_failure_marks_profile_failed(
    context, monkeypatch, django_capture_on_commit_callbacks
):
    users, _, _, dataset, endpoint = context

    def fail_dispatch(_dataset_id):
        raise ConnectionError("Broker unavailable")

    monkeypatch.setattr(
        "datasets.profile_api.profile_csv.delay", fail_dispatch
    )
    with django_capture_on_commit_callbacks(execute=True):
        client_for(users["owner"]).post(endpoint)
    profile = DatasetProfile.objects.get(dataset=dataset)
    assert profile.status == DatasetProfile.Status.FAILED
    assert profile.error_code == "queue_unavailable"
    assert profile.completed_at is not None


def test_project_isolation(context):
    users, workspace, _, dataset, _ = context
    another_project = Project.objects.create(
        workspace=workspace,
        name="Other Research",
    )
    wrong_endpoint = (
        f"/api/v1/workspaces/{workspace.pk}"
        f"/projects/{another_project.pk}/datasets/{dataset.pk}/profile"
    )
    assert client_for(users["owner"]).post(wrong_endpoint).status_code == 404
    assert DatasetProfile.objects.count() == 0


def test_session_post_requires_csrf(context):
    users, _, _, _, endpoint = context
    client = APIClient(enforce_csrf_checks=True)
    client.force_login(users["owner"])
    assert client.post(endpoint).status_code == 403
    assert DatasetProfile.objects.count() == 0
