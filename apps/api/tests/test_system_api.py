"""System API responses, failures and exposed surface."""

from unittest.mock import Mock, patch

from django.db import OperationalError
from rest_framework.test import APIClient


class _HealthyRedis:
    def ping(self):
        return True

    def close(self):
        pass


def test_live_is_unauthenticated_and_correlated():
    response = APIClient().get("/api/v1/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "synthesift-api"}
    assert response["X-Request-ID"]


def test_metadata_exposes_milestone_without_secrets():
    response = APIClient().get("/api/v1/meta")
    assert response.status_code == 200
    assert response.json() == {"name": "SyntheSift", "version": "0.1.0", "milestone": "M0"}


def test_ready_reports_dependencies(db):
    with patch("core.views.redis.Redis.from_url", return_value=_HealthyRedis()):
        response = APIClient().get("/api/v1/health/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "dependencies": {"database": "ok", "redis": "ok"}}


def test_ready_fails_closed_when_database_is_down():
    with patch("core.views.connection.cursor", side_effect=OperationalError("db down")):
        with patch("core.views.redis.Redis.from_url", return_value=_HealthyRedis()):
            response = APIClient().get("/api/v1/health/ready")
    assert response.status_code == 503
    assert response.json()["dependencies"]["database"] == "unavailable"


def test_ready_fails_closed_when_redis_is_down(db):
    mock_client = Mock()
    mock_client.ping.side_effect = OSError("redis down")
    with patch("core.views.redis.Redis.from_url", return_value=mock_client):
        response = APIClient().get("/api/v1/health/ready")
    assert response.status_code == 503
    assert response.json()["dependencies"]["redis"] == "unavailable"


def test_future_product_routes_are_not_published():
    response = APIClient().get("/api/v1/projects")
    assert response.status_code == 404


def test_schema_is_published():
    response = APIClient().get("/api/schema/")
    assert response.status_code == 200
    assert "openapi" in response.content.decode().lower()


def test_unsupported_method_uses_error_envelope():
    response = APIClient().post("/api/v1/health/live", {}, format="json")
    assert response.status_code == 405
    assert response.json()["error"]["code"] == "METHOD_NOT_ALLOWED"
    assert response.json()["error"]["request_id"] == response["X-Request-ID"]


def test_request_identifiers_are_unique_per_request():
    client = APIClient()
    first = client.get("/api/v1/health/live")
    second = client.get("/api/v1/health/live")
    assert first["X-Request-ID"] != second["X-Request-ID"]
