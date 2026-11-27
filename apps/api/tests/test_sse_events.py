"""Tests for Server-Sent Events (SSE) real-time dataset job status stream."""

import json

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from datasets.models import Dataset, DatasetProfile
from identity.models import Workspace, WorkspaceMembership
from projects.models import Project

User = get_user_model()


@pytest.mark.django_db
def test_dataset_sse_events_stream_emits_status_and_done_frames():
    user = User.objects.create_user(username="sse_owner", password="StrongPassword123!")
    outsider = User.objects.create_user(username="sse_outsider", password="StrongPassword123!")
    ws = Workspace.objects.create(name="SSE WS", owner=user)
    WorkspaceMembership.objects.create(workspace=ws, user=user, role="owner")
    project = Project.objects.create(workspace=ws, name="SSE Proj")
    dataset = Dataset.objects.create(
        project=project,
        uploaded_by=user,
        filename="stream_test.csv",
        file_format="csv",
        storage_key="fake/stream.csv",
        size_bytes=80,
        sha256="c" * 64,
        status=Dataset.Status.READY,
        row_count=10,
        column_count=2,
        columns=["a", "b"],
    )
    DatasetProfile.objects.create(
        dataset=dataset,
        status=DatasetProfile.Status.READY,
        result={"row_count": 10, "column_count": 2, "columns": []},
    )

    url = f"/api/v1/workspaces/{ws.id}/projects/{project.id}/datasets/{dataset.id}/events?once=1"

    # Unauthenticated blocked
    anon = APIClient()
    assert anon.get(url, HTTP_ACCEPT="text/event-stream").status_code == 401

    # Unauthorized user blocked
    other = APIClient()
    other.force_authenticate(user=outsider)
    assert other.get(url, HTTP_ACCEPT="text/event-stream").status_code in {403, 404}

    # Authorized EventSource client receives SSE stream
    client = APIClient()
    client.force_authenticate(user=user)
    res = client.get(url, HTTP_ACCEPT="text/event-stream")
    assert res.status_code == 200
    assert res["Content-Type"].startswith("text/event-stream")
    assert res["Cache-Control"] == "no-cache"

    body = b"".join(res.streaming_content).decode("utf-8")
    assert "event: status\n" in body
    assert "event: done\n" in body

    data_lines = [line[6:] for line in body.splitlines() if line.startswith("data: ")]
    assert len(data_lines) >= 2
    payload = json.loads(data_lines[0])
    assert payload["dataset_id"] == str(dataset.id)
    assert payload["dataset_status"] == "ready"
    assert payload["profile_status"] == "ready"
    assert payload["pending"] is False
