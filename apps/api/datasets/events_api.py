"""Server-Sent Events (SSE) stream for live dataset, profiling, AI, and contract job status."""

from __future__ import annotations

import json
import time
from typing import Any

from django.http import StreamingHttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.renderers import BaseRenderer, JSONRenderer
from rest_framework.views import APIView

from ai_remediation.models import AIReport
from contracts_engine.models import ContractRun

from .api import authorized_project
from .models import Dataset, DatasetProfile


class EventStreamRenderer(BaseRenderer):
    """Allow DRF content negotiation to accept browser EventSource `Accept: text/event-stream`."""

    media_type = "text/event-stream"
    format = "sse"
    charset = "utf-8"

    def render(self, data, accepted_media_type=None, renderer_context=None):
        return data


def _snapshot_dataset_state(dataset_id) -> dict[str, Any]:
    dataset = Dataset.objects.filter(pk=dataset_id).first()
    if dataset is None:
        return {"deleted": True, "pending": False, "timestamp": timezone.now().isoformat()}

    profile = (
        DatasetProfile.objects.filter(dataset_id=dataset_id)
        .order_by("-completed_at", "-started_at")
        .first()
    )
    latest_ai = (
        AIReport.objects.filter(dataset_id=dataset_id).order_by("-created_at").first()
    )
    latest_contract = (
        ContractRun.objects.filter(dataset_id=dataset_id).order_by("-created_at").first()
    )

    dataset_status = dataset.status
    profile_status = profile.status if profile else None
    ai_status = latest_ai.status if latest_ai else None
    contract_status = latest_contract.status if latest_contract else None

    pending = (
        dataset_status in {Dataset.Status.QUEUED, Dataset.Status.PROCESSING}
        or profile_status in {"queued", "processing"}
        or ai_status in {AIReport.Status.QUEUED, AIReport.Status.PROCESSING}
    )

    return {
        "dataset_id": str(dataset.id),
        "dataset_status": dataset_status,
        "row_count": dataset.row_count,
        "profile_status": profile_status,
        "latest_ai_report_id": str(latest_ai.id) if latest_ai else None,
        "latest_ai_report_status": ai_status,
        "latest_contract_status": contract_status,
        "pending": pending,
        "timestamp": timezone.now().isoformat(),
    }


def _sse_frame(event_name: str, payload: dict[str, Any]) -> str:
    return f"event: {event_name}\ndata: {json.dumps(payload, separators=(',', ':'))}\n\n"


class DatasetEventsStreamView(APIView):
    """Stream real-time Server-Sent Events (SSE) for dataset ingestion, profiling, and AI jobs."""

    permission_classes = [IsAuthenticated]
    renderer_classes = [EventStreamRenderer, JSONRenderer]

    @extend_schema(
        tags=["datasets"],
        responses={200: OpenApiResponse(description="Server-Sent Events stream (text/event-stream)")},
    )
    def get(self, request, workspace_id, project_id, dataset_id):
        _, project = authorized_project(request.user, workspace_id, project_id)
        dataset = get_object_or_404(Dataset, pk=dataset_id, project=project)

        once = request.query_params.get("once", "").strip().lower() in {"1", "true", "yes"}
        try:
            max_seconds = min(20.0, max(1.0, float(request.query_params.get("max_seconds", "15"))))
        except ValueError:
            max_seconds = 15.0

        def event_stream():
            deadline = time.monotonic() + max_seconds
            last_signature: tuple | None = None

            while True:
                snap = _snapshot_dataset_state(dataset.id)
                signature = (
                    snap.get("dataset_status"),
                    snap.get("profile_status"),
                    snap.get("latest_ai_report_status"),
                    snap.get("latest_contract_status"),
                    snap.get("deleted", False),
                )
                if signature != last_signature:
                    yield _sse_frame("status", snap)
                    last_signature = signature

                if once or not snap.get("pending") or time.monotonic() >= deadline:
                    yield _sse_frame("done", snap)
                    break

                time.sleep(0.75)

        response = StreamingHttpResponse(event_stream(), content_type="text/event-stream; charset=utf-8")
        response["Cache-Control"] = "no-cache"
        response["X-Accel-Buffering"] = "no"
        return response
