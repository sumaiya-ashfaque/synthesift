"""Project-isolated, role-authorized report creation and retrieval."""

import logging
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import APIException
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from datasets.api import authorized_project
from datasets.models import Dataset, DatasetProfile
from identity.policy import require_role

from .evidence import profile_digest
from .models import AIReport
from .serializers import AIReportCreateSerializer, AIReportSerializer
from .tasks import generate_report

logger = logging.getLogger(__name__)


class ReportConflict(APIException):
    status_code = 409
    default_detail = "A ready profile is required, or an AI report is already pending."
    default_code = "report_conflict"


class ReportLimit(APIException):
    status_code = 429
    default_detail = "Report limit reached for this dataset today."
    default_code = "report_limit"


class ProviderNotConfigured(APIException):
    status_code = 503
    default_detail = "Gemini is not configured on the server."
    default_code = "provider_not_configured"


def _target(user, workspace_id, project_id, dataset_id):
    workspace, project = authorized_project(user, workspace_id, project_id)
    dataset = get_object_or_404(Dataset, pk=dataset_id, project=project)
    return workspace, dataset


def _dispatch(report_id):
    try:
        generate_report.delay(str(report_id))
    except Exception:
        logger.exception("AI report dispatch failed: %s", report_id)
        AIReport.objects.filter(
            pk=report_id, status=AIReport.Status.QUEUED
        ).update(
            status=AIReport.Status.FAILED, error_code="queue_unavailable",
            completed_at=timezone.now(),
        )


class AIReportListView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["ai-remediation"], responses={200: AIReportSerializer(many=True)})
    def get(self, request, workspace_id, project_id, dataset_id):
        _, dataset = _target(request.user, workspace_id, project_id, dataset_id)
        reports = AIReport.objects.filter(dataset=dataset).order_by("-created_at")[:10]
        return Response(AIReportSerializer(reports, many=True).data)

    @extend_schema(
        tags=["ai-remediation"], request=AIReportCreateSerializer,
        responses={202: AIReportSerializer},
    )
    def post(self, request, workspace_id, project_id, dataset_id):
        workspace, dataset = _target(request.user, workspace_id, project_id, dataset_id)
        require_role(request.user, workspace, {"owner", "editor"})
        serializer = AIReportCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if not settings.GEMINI_API_KEY:
            raise ProviderNotConfigured()

        with transaction.atomic():
            # Serialize submissions for this dataset across concurrent requests.
            dataset = Dataset.objects.select_for_update().get(pk=dataset.pk)
            profile = DatasetProfile.objects.filter(
                dataset=dataset, status=DatasetProfile.Status.READY
            ).first()
            if dataset.status != Dataset.Status.READY or profile is None:
                raise ReportConflict()
            if AIReport.objects.filter(
                dataset=dataset,
                status__in=[AIReport.Status.QUEUED, AIReport.Status.PROCESSING],
            ).exists():
                raise ReportConflict()
            cutoff = timezone.now() - timedelta(hours=24)
            if AIReport.objects.filter(dataset=dataset, created_at__gte=cutoff).count() >= 10:
                raise ReportLimit()
            data = serializer.validated_data
            report = AIReport.objects.create(
                dataset=dataset,
                requested_by=request.user,
                technique=data["technique"],
                model=data["model"],
                thinking_level=data["thinking_level"],
                temperature=data.get("temperature"),
                max_output_tokens=data["max_output_tokens"],
                profile_digest=profile_digest(profile.result),
                user_prompt=data.get("user_prompt", ""),
                consent_at=timezone.now(),
            )
            report_id = str(report.pk)
            transaction.on_commit(lambda: _dispatch(report_id))

        report.refresh_from_db()
        if report.error_code == "queue_unavailable":
            return Response(
                AIReportSerializer(report).data,
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        return Response(AIReportSerializer(report).data, status=status.HTTP_202_ACCEPTED)


class AIReportDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["ai-remediation"], responses={200: AIReportSerializer})
    def get(self, request, workspace_id, project_id, dataset_id, report_id):
        _, dataset = _target(request.user, workspace_id, project_id, dataset_id)
        report = get_object_or_404(AIReport, pk=report_id, dataset=dataset)
        return Response(AIReportSerializer(report).data)
