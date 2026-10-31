
"""Workspace-authorized dataset admission endpoints."""

import logging

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import APIException
from rest_framework.pagination import LimitOffsetPagination
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from identity.policy import get_workspace, require_role
from projects.models import Project

from .models import Dataset
from .serializers import DatasetSerializer, DatasetUploadSerializer
from .storage import save_upload, storage_path
from .tasks import ingest_dataset

logger = logging.getLogger(__name__)


class DatasetStorageUnavailable(APIException):
    status_code = 503
    default_detail = "Dataset storage is temporarily unavailable."
    default_code = "dataset_storage_unavailable"


def authorized_project(user, workspace_id, project_id):
    """Resolve a project within a workspace accessible to the user."""
    workspace = get_workspace(user, workspace_id)

    project = get_object_or_404(
        Project,
        pk=project_id,
        workspace=workspace,
    )

    return workspace, project


def _dispatch_ingestion(dataset_id):
    """Enqueue CSV processing after the dataset transaction commits."""
    try:
        ingest_dataset.delay(str(dataset_id))

    except Exception:
        logger.exception(
            "Unable to dispatch CSV ingestion for %s",
            dataset_id,
        )

        Dataset.objects.filter(
            pk=dataset_id,
            status=Dataset.Status.QUEUED,
        ).update(
            status=Dataset.Status.FAILED,
            error_code="queue_unavailable",
            completed_at=timezone.now(),
        )


class DatasetPagination(LimitOffsetPagination):
    default_limit = 25
    max_limit = 100


class DatasetListView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser]
    pagination_class = DatasetPagination

    @extend_schema(
        tags=["datasets"],
        responses={200: DatasetSerializer(many=True)},
    )
    def get(self, request, workspace_id, project_id):
        """List datasets belonging to an accessible project."""
        _, project = authorized_project(
            request.user,
            workspace_id,
            project_id,
        )

        paginator = DatasetPagination()

        page = paginator.paginate_queryset(
            project.datasets.all(),
            request,
            view=self,
        )

        return paginator.get_paginated_response(
            DatasetSerializer(page, many=True).data
        )

    @extend_schema(
        tags=["datasets"],
        request=DatasetUploadSerializer,
        responses={201: DatasetSerializer},
    )
    def post(self, request, workspace_id, project_id):
        """Store a CSV original and schedule asynchronous admission."""
        workspace, project = authorized_project(
            request.user,
            workspace_id,
            project_id,
        )

        require_role(
            request.user,
            workspace,
            {"owner", "editor"},
        )

        serializer = DatasetUploadSerializer(
            data=request.data,
        )
        serializer.is_valid(raise_exception=True)

        uploaded = serializer.validated_data["file"]

        try:
            key, checksum, size = save_upload(uploaded)

        except OSError as exc:
            raise DatasetStorageUnavailable() from exc

        try:
            with transaction.atomic():
                dataset = Dataset.objects.create(
                    project=project,
                    uploaded_by=request.user,
                    filename=uploaded.name,
                    storage_key=key,
                    sha256=checksum,
                    size_bytes=size,
                )

                transaction.on_commit(
                    lambda: _dispatch_ingestion(dataset.pk)
                )

        except Exception:
            storage_path(key).unlink(missing_ok=True)
            raise

        dataset.refresh_from_db()

        return Response(
            DatasetSerializer(dataset).data,
            status=status.HTTP_201_CREATED,
        )


class DatasetDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["datasets"],
        responses={200: DatasetSerializer},
    )
    def get(
        self,
        request,
        workspace_id,
        project_id,
        dataset_id,
    ):
        """Retrieve metadata for a dataset within an accessible project."""
        _, project = authorized_project(
            request.user,
            workspace_id,
            project_id,
        )

        dataset = get_object_or_404(
            Dataset,
            pk=dataset_id,
            project=project,
        )

        return Response(
            DatasetSerializer(dataset).data
        )
