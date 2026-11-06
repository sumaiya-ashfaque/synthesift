"""Project-scoped API for persisted dataset profiling."""

import logging

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import APIException
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from identity.policy import require_role

from .api import authorized_project
from .models import Dataset, DatasetProfile
from .profile_serializers import DatasetProfileSerializer
from .tasks import profile_csv

logger = logging.getLogger(__name__)


class DatasetNotReady(APIException):
    status_code = 409
    default_detail = "Dataset admission must finish before profiling."
    default_code = "dataset_not_ready"


def _authorized_dataset(user, workspace_id, project_id, dataset_id):
    workspace, project = authorized_project(user, workspace_id, project_id)
    dataset = get_object_or_404(Dataset, pk=dataset_id, project=project)
    return workspace, dataset


def _dispatch_profile(dataset_id):
    """Publish a committed profile request without exposing broker errors."""
    try:
        profile_csv.delay(str(dataset_id))
    except Exception:
        logger.exception("Unable to dispatch profile for dataset %s", dataset_id)
        DatasetProfile.objects.filter(
            dataset_id=dataset_id,
            status=DatasetProfile.Status.QUEUED,
        ).update(
            status=DatasetProfile.Status.FAILED,
            error_code="queue_unavailable",
            started_at=None,
            completed_at=timezone.now(),
        )


class DatasetProfileView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["profiling"], responses={200: DatasetProfileSerializer})
    def get(self, request, workspace_id, project_id, dataset_id):
        """Read the saved profile of an accessible dataset."""
        _, dataset = _authorized_dataset(
            request.user, workspace_id, project_id, dataset_id
        )
        profile = get_object_or_404(DatasetProfile, dataset=dataset)
        return Response(DatasetProfileSerializer(profile).data)

    @extend_schema(
        tags=["profiling"],
        request=None,
        responses={
            200: DatasetProfileSerializer,
            202: DatasetProfileSerializer,
        },
    )
    def post(self, request, workspace_id, project_id, dataset_id):
        """Request a profile or retry a failed profile."""
        workspace, dataset = _authorized_dataset(
            request.user, workspace_id, project_id, dataset_id
        )
        require_role(request.user, workspace, {"owner", "editor"})

        if dataset.status != Dataset.Status.READY:
            raise DatasetNotReady()

        with transaction.atomic():
            profile, created = DatasetProfile.objects.get_or_create(dataset=dataset)
            enqueue = created

            if not created:
                changed = DatasetProfile.objects.filter(
                    dataset=dataset,
                    status=DatasetProfile.Status.FAILED,
                ).update(
                    status=DatasetProfile.Status.QUEUED,
                    result={},
                    error_code="",
                    started_at=None,
                    completed_at=None,
                )
                enqueue = bool(changed)

            if enqueue:
                dataset_id_text = str(dataset.pk)
                transaction.on_commit(
                    lambda: _dispatch_profile(dataset_id_text)
                )

        profile.refresh_from_db()
        if (
            profile.status == DatasetProfile.Status.FAILED
            and profile.error_code == "queue_unavailable"
        ):
            response_status = status.HTTP_503_SERVICE_UNAVAILABLE
        elif profile.status == DatasetProfile.Status.READY:
            response_status = status.HTTP_200_OK
        else:
            response_status = status.HTTP_202_ACCEPTED

        return Response(
            DatasetProfileSerializer(profile).data,
            status=response_status,
        )
