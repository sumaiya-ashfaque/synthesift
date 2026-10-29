"""Authentication, CSRF and workspace authorization boundaries."""

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APIClient

from identity.models import WorkspaceMembership


@pytest.fixture(autouse=True)
def clear_throttle_cache():
    cache.clear()


@pytest.fixture
def users(db):
    user = get_user_model()
    return (
        user.objects.create_user(username="analyst", password="TestPassword2026!", email="a@example.test"),
        user.objects.create_user(username="outsider", password="TestPassword2026!", email="b@example.test"),
        user.objects.create_user(username="editor", password="TestPassword2026!", email="c@example.test"),
        user.objects.create_user(username="viewer", password="TestPassword2026!", email="d@example.test"),
    )


@pytest.fixture
def owner_client(users):
    client = APIClient()
    client.force_authenticate(user=users[0])
    return client


@pytest.mark.django_db
def test_register_creates_hashed_password():
    client = APIClient(enforce_csrf_checks=True)
    denied = client.post("/api/v1/auth/register", {"username": "new", "email": "new@example.test", "password": "StrongExample2026!"}, format="json")
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "CSRF_FAILED"
    assert client.get("/api/v1/auth/csrf").status_code == 200
    response = client.post("/api/v1/auth/register", {"username": "new", "email": "new@example.test", "password": "StrongExample2026!"}, format="json", HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value)
    assert response.status_code == 201
    user = get_user_model().objects.get(username="new")
    assert user.check_password("StrongExample2026!")
    assert "password" not in response.json()


@pytest.mark.django_db
def test_registration_can_be_disabled():
    with override_settings(SELF_REGISTRATION_ENABLED=False):
        response = APIClient().post("/api/v1/auth/register", {"username": "new", "email": "new@example.test", "password": "StrongExample2026!"}, format="json")
    assert response.status_code == 403


@pytest.mark.django_db
def test_login_me_and_logout_rotate_session(users):
    client = APIClient(enforce_csrf_checks=True)
    assert client.get("/api/v1/auth/me").status_code == 401
    client.get("/api/v1/auth/csrf")
    response = client.post("/api/v1/auth/login", {"username": "analyst", "password": "TestPassword2026!"}, format="json", HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value)
    assert response.status_code == 200
    assert client.get("/api/v1/auth/me").json()["username"] == "analyst"
    assert client.post("/api/v1/auth/logout").status_code == 403
    response = client.post("/api/v1/auth/logout", HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value)
    assert response.status_code == 204
    assert client.get("/api/v1/auth/me").status_code == 401


@pytest.mark.django_db
def test_bad_password_does_not_create_session(users):
    response = APIClient().post("/api/v1/auth/login", {"username": "analyst", "password": "incorrect"}, format="json")
    assert response.status_code == 401
    assert "TestPassword2026!" not in response.content.decode()


@pytest.mark.django_db
def test_anonymous_workspace_operations_are_denied():
    assert APIClient().get("/api/v1/workspaces").status_code == 401
    assert APIClient().post("/api/v1/workspaces", {"name": "Private"}, format="json").status_code == 401


@pytest.mark.django_db
def test_owner_creates_workspace_and_casefold_duplicate_rejected(owner_client):
    response = owner_client.post("/api/v1/workspaces", {"name": "Finance"}, format="json")
    assert response.status_code == 201
    assert response.json()["role"] == "owner"
    assert len(owner_client.get("/api/v1/workspaces").json()) == 1
    assert owner_client.post("/api/v1/workspaces", {"name": "finance"}, format="json").status_code == 400


@pytest.mark.django_db
def test_other_user_cannot_discover_workspace_or_members(users, owner_client):
    workspace_id = owner_client.post("/api/v1/workspaces", {"name": "Finance"}, format="json").json()["id"]
    outsider = APIClient()
    outsider.force_authenticate(user=users[1])
    assert outsider.get("/api/v1/workspaces").json() == []
    assert outsider.get(f"/api/v1/workspaces/{workspace_id}").status_code == 404
    assert outsider.get(f"/api/v1/workspaces/{workspace_id}/members").status_code == 404
    assert outsider.get(f"/api/v1/workspaces/{workspace_id}/projects").status_code == 404


@pytest.mark.django_db
def test_owner_assigns_roles_and_only_owner_manages_members(users, owner_client):
    workspace_id = owner_client.post("/api/v1/workspaces", {"name": "Shared"}, format="json").json()["id"]
    for username, role in [("editor", "editor"), ("viewer", "viewer")]:
        response = owner_client.post(f"/api/v1/workspaces/{workspace_id}/members", {"username": username, "role": role}, format="json")
        assert response.status_code == 201
    assert len(owner_client.get(f"/api/v1/workspaces/{workspace_id}/members").json()) == 2
    editor = APIClient()
    editor.force_authenticate(user=users[2])
    assert editor.get("/api/v1/workspaces").json()[0]["role"] == "editor"
    assert editor.get(f"/api/v1/workspaces/{workspace_id}/members").status_code == 403
    assert editor.patch(f"/api/v1/workspaces/{workspace_id}", {"name": "Renamed"}, format="json").status_code == 403
    viewer = APIClient()
    viewer.force_authenticate(user=users[3])
    assert viewer.get(f"/api/v1/workspaces/{workspace_id}").status_code == 200
    assert viewer.delete(f"/api/v1/workspaces/{workspace_id}").status_code == 403
    assert WorkspaceMembership.objects.filter(workspace_id=workspace_id).count() == 2


@pytest.mark.django_db
def test_owner_cannot_add_duplicate_or_self_membership(owner_client):
    workspace_id = owner_client.post("/api/v1/workspaces", {"name": "Shared"}, format="json").json()["id"]
    assert owner_client.post(f"/api/v1/workspaces/{workspace_id}/members", {"username": "analyst", "role": "editor"}, format="json").status_code == 400


@pytest.mark.django_db
def test_owner_can_revoke_membership(users, owner_client):
    workspace_id = owner_client.post("/api/v1/workspaces", {"name": "Shared"}, format="json").json()["id"]
    owner_client.post(f"/api/v1/workspaces/{workspace_id}/members", {"username": "viewer", "role": "viewer"}, format="json")
    viewer = APIClient()
    viewer.force_authenticate(user=users[3])
    assert viewer.get(f"/api/v1/workspaces/{workspace_id}").status_code == 200
    assert owner_client.delete(f"/api/v1/workspaces/{workspace_id}/members/{users[3].pk}").status_code == 204
    assert viewer.get(f"/api/v1/workspaces/{workspace_id}").status_code == 404
