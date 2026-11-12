"""Deletion permissions, cascades, active-job safety and durable byte cleanup."""

import tempfile
import uuid
from pathlib import Path

import pytest
from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from ai_remediation.models import AIReport, RemediationRun
from datasets.deletion import cleanup_pending_storage
from datasets.models import Dataset, StoredFileDeletion
from datasets.storage import storage_path
from identity.models import Workspace, WorkspaceMembership
from projects.models import Project


@pytest.fixture
def tree():
    owner = get_user_model().objects.create_user(username="delete_owner", password="pass1234")
    viewer = get_user_model().objects.create_user(username="delete_viewer", password="pass1234")
    editor = get_user_model().objects.create_user(username="delete_editor", password="pass1234")
    workspace = Workspace.objects.create(name="Delete Tests", owner=owner)
    WorkspaceMembership.objects.create(workspace=workspace, user=viewer, role="viewer")
    WorkspaceMembership.objects.create(workspace=workspace, user=editor, role="editor")
    project = Project.objects.create(workspace=workspace, name="Main")
    with tempfile.TemporaryDirectory() as temp:
        with override_settings(DATASET_STORAGE_ROOT=temp):
            yield owner, viewer, editor, workspace, project


def _dataset(project, *, status="ready", filename="sample.csv"):
    key_id = uuid.uuid4().hex
    key = f"{key_id[:2]}/{key_id}.csv"
    file = storage_path(key)
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_bytes(b"name\nAlice\n")
    dataset = Dataset.objects.create(
        project=project, filename=filename, storage_key=key, sha256="a" * 64,
        size_bytes=11, status=status, columns=["name"], row_count=1, column_count=1,
    )
    return dataset, file


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _url(workspace, project=None, dataset=None):
    url = f"/api/v1/workspaces/{workspace.id}"
    if project is not None:
        url += f"/projects/{project.id}"
    if dataset is not None:
        url += f"/datasets/{dataset.id}"
    return url


@pytest.mark.django_db(transaction=True)
def test_dataset_delete_removes_db_rows_and_source_bytes(tree):
    owner, _viewer, _editor, workspace, project = tree
    dataset, file = _dataset(project)
    response = _client(owner).delete(_url(workspace, project, dataset))
    assert response.status_code == 204
    assert not Dataset.objects.filter(pk=dataset.pk).exists()
    assert not file.exists()
    assert StoredFileDeletion.objects.count() == 0


@pytest.mark.django_db(transaction=True)
def test_viewer_cannot_delete_and_active_upload_is_blocked(tree):
    owner, viewer, _editor, workspace, project = tree
    dataset, file = _dataset(project, status="processing")
    assert _client(viewer).delete(_url(workspace, project, dataset)).status_code == 403
    assert _client(owner).delete(_url(workspace, project, dataset)).status_code == 409
    assert file.is_file()
    assert Dataset.objects.filter(pk=dataset.pk).exists()


@pytest.mark.django_db(transaction=True)
def test_editor_can_delete_dataset_but_not_project_or_workspace(tree):
    _owner, _viewer, editor, workspace, project = tree
    dataset, file = _dataset(project)
    client = _client(editor)
    assert client.delete(_url(workspace, project)).status_code == 403
    assert client.delete(_url(workspace)).status_code == 403
    assert client.delete(_url(workspace, project, dataset)).status_code == 204
    assert not file.exists()


@pytest.mark.django_db(transaction=True)
def test_project_delete_removes_all_files(tree):
    owner, _viewer, _editor, workspace, project = tree
    one, file_one = _dataset(project, filename="one.csv")
    two, file_two = _dataset(project, filename="two.csv")
    response = _client(owner).delete(_url(workspace, project))
    assert response.status_code == 204
    assert not Project.objects.filter(pk=project.pk).exists()
    assert not Dataset.objects.filter(pk__in=[one.pk, two.pk]).exists()
    assert not file_one.exists() and not file_two.exists()


@pytest.mark.django_db(transaction=True)
def test_workspace_delete_removes_projects_and_files(tree):
    owner, _viewer, _editor, workspace, project = tree
    dataset, file = _dataset(project)
    response = _client(owner).delete(_url(workspace))
    assert response.status_code == 204
    assert not Workspace.objects.filter(pk=workspace.pk).exists()
    assert not Dataset.objects.filter(pk=dataset.pk).exists()
    assert not file.exists()


@pytest.mark.django_db(transaction=True)
def test_source_delete_cascades_derived_files_and_remediation_runs(tree):
    owner, _viewer, _editor, workspace, project = tree
    source, source_file = _dataset(project, filename="original.csv")
    derived, derived_file = _dataset(project, filename="cleaned.csv")
    report = AIReport.objects.create(
        dataset=source, requested_by=owner, technique="few_shot", model="test-provider",
        status="ready", profile_digest="0" * 64, consent_at=timezone.now(),
    )
    RemediationRun.objects.create(
        dataset=source, report=report, requested_by=owner, result_dataset=derived,
        status="applied", source_digest="a" * 64, profile_digest="0" * 64,
    )
    response = _client(owner).delete(_url(workspace, project, source))
    assert response.status_code == 204
    assert not Dataset.objects.filter(pk__in=[source.pk, derived.pk]).exists()
    assert not AIReport.objects.filter(pk=report.pk).exists()
    assert RemediationRun.objects.count() == 0
    assert not source_file.exists() and not derived_file.exists()


@pytest.mark.django_db(transaction=True)
def test_failed_filesystem_cleanup_can_be_retried(tree, monkeypatch):
    owner, _viewer, _editor, workspace, project = tree
    dataset, file = _dataset(project)
    original_unlink = Path.unlink
    attempts = {"count": 0}

    def fail_once(self, *args, **kwargs):
        if self == file and attempts["count"] == 0:
            attempts["count"] += 1
            raise OSError("simulated storage outage")
        return original_unlink(self, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", fail_once)
    response = _client(owner).delete(_url(workspace, project, dataset))
    assert response.status_code == 204
    assert file.is_file()
    assert StoredFileDeletion.objects.filter(storage_key=dataset.storage_key).exists()
    assert cleanup_pending_storage() == 1
    assert not file.exists()
    assert StoredFileDeletion.objects.count() == 0


@pytest.mark.django_db(transaction=True)
def test_cross_workspace_dataset_cannot_be_deleted(tree):
    owner, _viewer, _editor, workspace, project = tree
    dataset, file = _dataset(project)
    other = Workspace.objects.create(owner=owner, name="Another workspace")
    other_project = Project.objects.create(workspace=other, name="Other project")
    response = _client(owner).delete(_url(other, other_project, dataset))
    assert response.status_code == 404
    assert Dataset.objects.filter(pk=dataset.pk).exists()
    assert file.is_file()


@pytest.mark.django_db(transaction=True)
def test_active_ai_report_blocks_dataset_deletion(tree):
    owner, _viewer, _editor, workspace, project = tree
    dataset, file = _dataset(project)
    AIReport.objects.create(
        dataset=dataset, requested_by=owner, technique="few_shot", model="test-provider",
        status="processing", profile_digest="0" * 64, consent_at=timezone.now(),
    )
    response = _client(owner).delete(_url(workspace, project, dataset))
    assert response.status_code == 409
    assert file.is_file()
    assert StoredFileDeletion.objects.count() == 0
