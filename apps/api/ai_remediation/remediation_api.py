"""Authorized preview, explicit approval, and immutable export endpoints."""

import hashlib

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import transaction
from django.http import FileResponse, HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from datasets.api import authorized_project
from datasets.ingestion import AdmissionError, inspect_csv
from datasets.models import Dataset, DatasetProfile
from datasets.profiling import profile_dataset
from datasets.quality import assess_quality
from datasets.storage import save_upload, storage_path
from identity.policy import require_role

from .evidence import profile_digest
from .models import AIReport, RemediationRun
from .remediation import RemediationError, transform_dataset, validate_operations
from .remediation_pdf import render_audit_pdf
from .remediation_serializers import (
    ApproveSerializer,
    PreviewCreateSerializer,
    RemediationRunSerializer,
)


class RemediationConflict(APIException):
    status_code = 409
    default_detail = "The source, profile, or review state is no longer valid."
    default_code = "remediation_conflict"


class SourceInvalid(APIException):
    status_code = 422
    default_detail = "The stored source failed transformation validation."
    default_code = "source_invalid"


def _scope(user, workspace_id, project_id, dataset_id):
    workspace, project = authorized_project(user, workspace_id, project_id)
    dataset = get_object_or_404(Dataset, pk=dataset_id, project=project)
    return workspace, dataset


def _ready_profile(dataset):
    profile = DatasetProfile.objects.filter(
        dataset=dataset, status=DatasetProfile.Status.READY
    ).first()
    if dataset.status != Dataset.Status.READY or profile is None:
        raise RemediationConflict()
    return profile


def _evaluate(dataset, operations):
    try:
        return transform_dataset(dataset, operations)
    except (RemediationError, AdmissionError, OSError, UnicodeError, ValueError) as exc:
        raise SourceInvalid() from exc


class RemediationListView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["remediation"], responses={200: RemediationRunSerializer(many=True)})
    def get(self, request, workspace_id, project_id, dataset_id):
        _, dataset = _scope(request.user, workspace_id, project_id, dataset_id)
        runs = RemediationRun.objects.filter(dataset=dataset)[:20]
        return Response(RemediationRunSerializer(runs, many=True).data)

    @extend_schema(
        tags=["remediation"], request=PreviewCreateSerializer,
        responses={201: RemediationRunSerializer},
    )
    def post(self, request, workspace_id, project_id, dataset_id):
        workspace, dataset = _scope(request.user, workspace_id, project_id, dataset_id)
        require_role(request.user, workspace, {"owner", "editor"})
        serializer = PreviewCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        operations = validate_operations(serializer.validated_data["operations"])
        profile = _ready_profile(dataset)
        report = get_object_or_404(
            AIReport, pk=serializer.validated_data["report_id"],
            dataset=dataset, status=AIReport.Status.READY,
        )
        digest = profile_digest(profile.result)
        if report.profile_digest != digest:
            raise RemediationConflict()
        transformed = _evaluate(dataset, operations)
        if (
            transformed.summary["changed_cells"] == 0
            and transformed.summary["removed_duplicate_rows"] == 0
        ):
            raise ValidationError({
                "operations": "These operations would not change any rows or cells."
            })
        record = RemediationRun.objects.create(
            dataset=dataset, report=report, requested_by=request.user,
            operations=operations, source_digest=dataset.sha256,
            profile_digest=digest, preview=transformed.summary,
        )
        return Response(
            RemediationRunSerializer(record).data, status=status.HTTP_201_CREATED
        )


class RemediationDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["remediation"], responses={200: RemediationRunSerializer})
    def get(self, request, workspace_id, project_id, dataset_id, run_id):
        _, dataset = _scope(request.user, workspace_id, project_id, dataset_id)
        run = get_object_or_404(RemediationRun, pk=run_id, dataset=dataset)
        return Response(RemediationRunSerializer(run).data)

    @extend_schema(
        tags=["remediation"], request=ApproveSerializer,
        responses={200: RemediationRunSerializer},
    )
    def post(self, request, workspace_id, project_id, dataset_id, run_id):
        workspace, dataset = _scope(request.user, workspace_id, project_id, dataset_id)
        require_role(request.user, workspace, {"owner", "editor"})
        serializer = ApproveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # Lock before reading/creating the derived record. Repeat approvals are idempotent.
        key_to_cleanup = None
        try:
            with transaction.atomic():
                run = get_object_or_404(
                    RemediationRun.objects.select_for_update(), pk=run_id,
                    dataset=dataset,
                )
                if run.status == RemediationRun.Status.APPLIED:
                    return Response(RemediationRunSerializer(run).data)
                if run.requested_by_id != request.user.pk:
                    raise RemediationConflict()
                dataset = Dataset.objects.select_for_update().get(pk=dataset.pk)
                profile = _ready_profile(dataset)
                if (
                    dataset.sha256 != run.source_digest
                    or profile_digest(profile.result) != run.profile_digest
                    or run.report.status != AIReport.Status.READY
                ):
                    raise RemediationConflict()
                transformed = _evaluate(dataset, run.operations)
                if transformed.summary != run.preview:
                    raise RemediationConflict()

                uploaded = SimpleUploadedFile(
                    "synthesift_derived.csv", transformed.content, content_type="text/csv"
                )
                key, digest, size = save_upload(uploaded)
                key_to_cleanup = key
                derived = Dataset.objects.create(
                    project=dataset.project, uploaded_by=request.user,
                    filename=f"cleaned_{str(dataset.id)[:8]}.csv",
                    storage_key=key, sha256=digest, size_bytes=size,
                    status=Dataset.Status.QUEUED,
                )
                # Admission rechecks the derived bytes and CSV structure before READY.
                validated = inspect_csv(derived)
                derived.status = Dataset.Status.READY
                derived.row_count = validated.row_count
                derived.column_count = len(validated.columns)
                derived.columns = validated.columns
                derived.completed_at = timezone.now()
                derived.save(update_fields=[
                    "status", "row_count", "column_count", "columns", "completed_at"
                ])
                derived_profile = profile_dataset(derived)
                derived_profile["quality"] = assess_quality(derived_profile)
                DatasetProfile.objects.create(
                    dataset=derived, status=DatasetProfile.Status.READY,
                    schema_version=1, result=derived_profile,
                    completed_at=timezone.now(),
                )
                before_quality = profile.result.get("quality", {})
                run.validation = {
                    "before_completeness_percent": before_quality.get("completeness_percent"),
                    "after_completeness_percent": derived_profile["quality"]["completeness_percent"],
                    "before_finding_counts": before_quality.get("finding_counts", {}),
                    "after_finding_counts": derived_profile["quality"]["finding_counts"],
                    "derived_profile_status": "ready",
                }
                run.result_dataset = derived
                run.status = RemediationRun.Status.APPLIED
                run.applied_at = timezone.now()
                run.save(update_fields=["result_dataset", "status", "applied_at", "validation"])
            key_to_cleanup = None
            return Response(RemediationRunSerializer(run).data)
        except (RemediationError, AdmissionError, OSError, ValueError) as exc:
            raise SourceInvalid() from exc
        finally:
            if key_to_cleanup is not None:
                storage_path(key_to_cleanup).unlink(missing_ok=True)


class RemediationExportView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["remediation"], responses={200: OpenApiTypes.BINARY})
    def get(self, request, workspace_id, project_id, dataset_id, run_id):
        _, dataset = _scope(request.user, workspace_id, project_id, dataset_id)
        run = get_object_or_404(
            RemediationRun.objects.select_related("result_dataset", "dataset", "report"),
            pk=run_id, dataset=dataset, status=RemediationRun.Status.APPLIED,
        )
        kind = request.query_params.get("download", "pdf")
        if kind not in {"pdf", "csv"}:
            raise ValidationError({"download": "Choose pdf or csv."})
        filename = f"synthesift_audit_{str(run.pk)[:8]}"
        if kind == "pdf":
            content = render_audit_pdf(run)
            response = HttpResponse(content, content_type="application/pdf")
            response["Content-Disposition"] = f'attachment; filename="{filename}.pdf"'
        else:
            file_path = storage_path(run.result_dataset.storage_key)
            if not file_path.is_file():
                raise SourceInvalid()
            if hashlib.sha256(file_path.read_bytes()).hexdigest() != run.result_dataset.sha256:
                raise SourceInvalid()
            response = FileResponse(
                file_path.open("rb"), content_type="text/csv",
                as_attachment=True, filename=f"{filename}.csv",
            )
        response["X-Content-Type-Options"] = "nosniff"
        return response
