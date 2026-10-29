"""Workspace-scoped project creation, visibility and mutation policy."""

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from identity.models import Workspace, WorkspaceMembership
from projects.models import Project


@pytest.fixture
def project_users(db):
    user = get_user_model()
    return [user.objects.create_user(username=name, password="SafeExample2026!") for name in ("owner", "editor", "viewer", "outsider")]


@pytest.fixture
def project_space(project_users):
    workspace = Workspace.objects.create(owner=project_users[0], name="Operations")
    WorkspaceMembership.objects.create(workspace=workspace, user=project_users[1], role="editor")
    WorkspaceMembership.objects.create(workspace=workspace, user=project_users[2], role="viewer")
    return workspace


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.django_db
def test_owner_and_editor_can_create_and_read_projects(project_users, project_space):
    owner = client_for(project_users[0])
    editor = client_for(project_users[1])
    workspace_id = project_space.pk
    a = owner.post(f"/api/v1/workspaces/{workspace_id}/projects", {"name": "Customer Master"}, format="json")
    b = editor.post(f"/api/v1/workspaces/{workspace_id}/projects", {"name": "Invoices"}, format="json")
    assert a.status_code == 201
    assert b.status_code == 201
    assert Project.objects.filter(workspace=project_space).count() == 2
    assert len(editor.get(f"/api/v1/workspaces/{workspace_id}/projects").json()) == 2


@pytest.mark.django_db
def test_viewer_is_read_only(project_users, project_space):
    owner = client_for(project_users[0])
    viewer = client_for(project_users[2])
    workspace_id = project_space.pk
    project_id = owner.post(f"/api/v1/workspaces/{workspace_id}/projects", {"name": "Shared"}, format="json").json()["id"]
    assert viewer.get(f"/api/v1/workspaces/{workspace_id}/projects/{project_id}").status_code == 200
    assert viewer.post(f"/api/v1/workspaces/{workspace_id}/projects", {"name": "Rejected"}, format="json").status_code == 403
    assert viewer.patch(f"/api/v1/workspaces/{workspace_id}/projects/{project_id}", {"name": "Rejected"}, format="json").status_code == 403
    assert viewer.delete(f"/api/v1/workspaces/{workspace_id}/projects/{project_id}").status_code == 403


@pytest.mark.django_db
def test_editor_can_edit_but_cannot_delete(project_users, project_space):
    owner = client_for(project_users[0])
    editor = client_for(project_users[1])
    workspace_id = project_space.pk
    project_id = owner.post(f"/api/v1/workspaces/{workspace_id}/projects", {"name": "Draft"}, format="json").json()["id"]
    assert editor.patch(f"/api/v1/workspaces/{workspace_id}/projects/{project_id}", {"name": "Final"}, format="json").status_code == 200
    assert editor.delete(f"/api/v1/workspaces/{workspace_id}/projects/{project_id}").status_code == 403
    assert owner.delete(f"/api/v1/workspaces/{workspace_id}/projects/{project_id}").status_code == 204


@pytest.mark.django_db
def test_cross_workspace_project_ids_do_not_resolve(project_users, project_space):
    owner = client_for(project_users[0])
    outsider = client_for(project_users[3])
    workspace_id = project_space.pk
    project_id = owner.post(f"/api/v1/workspaces/{workspace_id}/projects", {"name": "Private"}, format="json").json()["id"]
    assert outsider.get(f"/api/v1/workspaces/{workspace_id}/projects/{project_id}").status_code == 404
    assert outsider.patch(f"/api/v1/workspaces/{workspace_id}/projects/{project_id}", {"name": "Bad"}, format="json").status_code == 404
    other = Workspace.objects.create(owner=project_users[3], name="Other")
    assert outsider.get(f"/api/v1/workspaces/{other.pk}/projects/{project_id}").status_code == 404


@pytest.mark.django_db
def test_project_names_unique_case_insensitive_per_workspace(project_users, project_space):
    owner = client_for(project_users[0])
    path = f"/api/v1/workspaces/{project_space.pk}/projects"
    assert owner.post(path, {"name": "Annual"}, format="json").status_code == 201
    assert owner.post(path, {"name": "annual"}, format="json").status_code == 400
    other = Workspace.objects.create(owner=project_users[0], name="Different")
    assert owner.post(f"/api/v1/workspaces/{other.pk}/projects", {"name": "Annual"}, format="json").status_code == 201


@pytest.mark.django_db
def test_workspace_is_derived_from_url_not_post_body(project_users, project_space):
    owner = client_for(project_users[0])
    other = Workspace.objects.create(owner=project_users[0], name="Other")
    response = owner.post(f"/api/v1/workspaces/{project_space.pk}/projects", {"name": "Safe", "workspace": str(other.pk)}, format="json")
    assert response.status_code == 201
    assert response.json()["workspace"] == str(project_space.pk)
