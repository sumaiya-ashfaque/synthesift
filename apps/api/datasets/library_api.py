
"""Project-backed dataset library and authorized import of immutable CSV files."""

import logging
from dataclasses import dataclass
from pathlib import Path

from django.db import transaction
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import serializers, status
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from identity.models import WorkspaceMembership
from identity.policy import require_role, visible_workspaces

from .api import authorized_project
from .models import Dataset
from .serializers import DatasetSerializer
from .storage import save_upload, storage_path
from .tasks import ingest_dataset

logger = logging.getLogger(__name__)


def dispatch(dataset: Dataset) -> None:
    """Queue CSV admission after the database transaction commits."""
    dataset_id = str(dataset.pk)
    transaction.on_commit(
        lambda: ingest_dataset.delay(dataset_id)
    )


class SourceUnavailable(APIException):
    status_code = 409
    default_detail = (
        "The source dataset is not ready or its original CSV is unavailable."
    )
    default_code = "source_unavailable"


class DatasetImportRequest(serializers.Serializer):
    source_dataset_id = serializers.UUIDField()


@dataclass
class _SourceUpload:
    """Streaming adapter that reuses the bounded storage write path."""

    path: Path
    size: int

    def chunks(self, chunk_size=64 * 1024):
        with self.path.open("rb") as reader:
            while data := reader.read(chunk_size):
                yield data


class DatasetLibraryView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["dataset-library"],
        responses={
            200: OpenApiResponse(description="Authorized dataset index")
        },
    )
    def get(self, request):
        accessible = visible_workspaces(request.user)

        records = (
            Dataset.objects.filter(project__workspace__in=accessible)
            .select_related("project", "project__workspace")
            .order_by("-created_at", "-id")[:200]
        )

        roles = dict(
            WorkspaceMembership.objects.filter(
                user=request.user,
                workspace__in=accessible,
            ).values_list("workspace_id", "role")
        )

        result = []

        for dataset in records:
            workspace = dataset.project.workspace

            result.append(
                {
                    "id": str(dataset.pk),
                    "filename": dataset.filename,
                    "status": dataset.status,
                    "size_bytes": dataset.size_bytes,
                    "created_at": dataset.created_at,
                    "workspace_id": str(workspace.pk),
                    "workspace_name": workspace.name,
                    "project_id": str(dataset.project_id),
                    "project_name": dataset.project.name,
                    "can_reuse": (
                        workspace.owner_id == request.user.pk
                        or roles.get(workspace.pk) == "editor"
                    ),
                }
            )

        return Response({"results": result, "limit": 200})


class DatasetLibraryImportView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["dataset-library"],
        request=DatasetImportRequest,
        responses={
            202: DatasetSerializer,
            409: OpenApiResponse(description="Source unavailable"),
        },
    )
    def post(self, request, workspace_id, project_id):
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

        serializer = DatasetImportRequest(data=request.data)
        serializer.is_valid(raise_exception=True)

        accessible = visible_workspaces(request.user)

        source = get_object_or_404(
            Dataset.objects.select_related("project__workspace"),
            pk=serializer.validated_data["source_dataset_id"],
            project__workspace__in=accessible,
        )

        require_role(
            request.user,
            source.project.workspace,
            {"owner", "editor"},
        )

        if source.project_id == project.pk:
            raise ValidationError(
                {
                    "source_dataset_id": [
                        "Dataset already belongs to this project."
                    ]
                }
            )

        if source.status != Dataset.Status.READY:
            raise SourceUnavailable()

        source_path = storage_path(source.storage_key)

        if (
            not source_path.is_file()
            or source_path.stat().st_size != source.size_bytes
        ):
            raise SourceUnavailable()

        # Store an independent copy of the original dataset.
        key, digest, size = save_upload(
            _SourceUpload(source_path, source.size_bytes)
        )

        if digest != source.sha256 or size != source.size_bytes:
            storage_path(key).unlink(missing_ok=True)

            logger.warning(
                "dataset_library.source_checksum_mismatch"
            )

            raise SourceUnavailable()

        try:
            with transaction.atomic():
                cloned = Dataset.objects.create(
                    project=project,
                    uploaded_by=request.user,
                    filename=source.filename,
                    storage_key=key,
                    sha256=digest,
                    size_bytes=size,
                )

        except Exception:
            storage_path(key).unlink(missing_ok=True)
            raise

        dispatch(cloned)

        cloned.refresh_from_db()

        return Response(
            DatasetSerializer(cloned).data,
            status=status.HTTP_202_ACCEPTED,
        )
