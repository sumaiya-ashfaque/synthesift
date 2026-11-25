"""RBAC-authorized endpoints for Transformation Recipes, Pipelines, Code Export, and Lineage DAG."""

from __future__ import annotations

import re

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError, transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from ai_remediation.models import RemediationRun
from datasets.api import authorized_project
from datasets.formats import AdmissionError, iter_tabular_rows
from datasets.ingestion import inspect_csv
from datasets.models import Dataset, DatasetProfile
from datasets.profiling import profile_dataset
from datasets.quality import assess_quality
from datasets.storage import save_upload, storage_path
from identity.policy import require_role

from .codegen import generate_duckdb_sql, generate_pandas_code, generate_polars_code
from .drift import compare_datasets
from .dsl import PipelineDSLError, suggest_steps_from_profile, validate_steps
from .executor import execute_pipeline, export_table_bytes
from .models import PipelineRun, TransformationRecipe
from .serializers import (
    DriftCompareRequestSerializer,
    PipelineApproveSerializer,
    PipelineCodeExportSerializer,
    PipelinePreviewRequestSerializer,
    PipelineRunSerializer,
    TransformationRecipeSerializer,
)


class PipelineConflict(APIException):
    status_code = 409
    default_detail = "Dataset state changed or is not ready for transformation."
    default_code = "pipeline_conflict"


def _dataset_scope(user, workspace_id, project_id, dataset_id):
    workspace, project = authorized_project(user, workspace_id, project_id)
    dataset = get_object_or_404(Dataset, pk=dataset_id, project=project)
    return workspace, project, dataset


def _safe_stem(filename: str) -> str:
    stem = filename.rsplit(".", 1)[0] if "." in filename else filename
    cleaned = re.sub(r"[^A-Za-z0-9._\-]+", "_", stem).strip("._-")
    return (cleaned or "dataset")[:80]


class RecipeListView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["pipelines"], responses={200: TransformationRecipeSerializer(many=True)})
    def get(self, request, workspace_id, project_id):
        _, project = authorized_project(request.user, workspace_id, project_id)
        items = TransformationRecipe.objects.filter(project=project).select_related("created_by")[:100]
        return Response(TransformationRecipeSerializer(items, many=True).data)

    @extend_schema(
        tags=["pipelines"],
        request=TransformationRecipeSerializer,
        responses={201: TransformationRecipeSerializer},
    )
    def post(self, request, workspace_id, project_id):
        workspace, project = authorized_project(request.user, workspace_id, project_id)
        require_role(request.user, workspace, {"owner", "editor"})
        serializer = TransformationRecipeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            validated_steps = validate_steps(serializer.validated_data["steps"])
        except PipelineDSLError as exc:
            raise ValidationError({"steps": [exc.message]}) from exc
        try:
            with transaction.atomic():
                recipe = TransformationRecipe.objects.create(
                    project=project,
                    created_by=request.user,
                    name=serializer.validated_data["name"].strip(),
                    description=serializer.validated_data.get("description", ""),
                    steps=validated_steps,
                )
        except IntegrityError as exc:
            raise ValidationError({"name": ["A recipe with this name already exists in the project."]}) from exc
        return Response(TransformationRecipeSerializer(recipe).data, status=status.HTTP_201_CREATED)


class RecipeDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["pipelines"], responses={200: TransformationRecipeSerializer})
    def get(self, request, workspace_id, project_id, recipe_id):
        _, project = authorized_project(request.user, workspace_id, project_id)
        recipe = get_object_or_404(TransformationRecipe, pk=recipe_id, project=project)
        return Response(TransformationRecipeSerializer(recipe).data)

    @extend_schema(
        tags=["pipelines"],
        request=TransformationRecipeSerializer,
        responses={200: TransformationRecipeSerializer},
    )
    def patch(self, request, workspace_id, project_id, recipe_id):
        workspace, project = authorized_project(request.user, workspace_id, project_id)
        require_role(request.user, workspace, {"owner", "editor"})
        recipe = get_object_or_404(TransformationRecipe, pk=recipe_id, project=project)
        serializer = TransformationRecipeSerializer(recipe, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        if "steps" in serializer.validated_data:
            try:
                serializer.validated_data["steps"] = validate_steps(serializer.validated_data["steps"])
            except PipelineDSLError as exc:
                raise ValidationError({"steps": [exc.message]}) from exc
        try:
            recipe = serializer.save()
        except IntegrityError as exc:
            raise ValidationError({"name": ["A recipe with this name already exists in the project."]}) from exc
        return Response(TransformationRecipeSerializer(recipe).data)

    @extend_schema(tags=["pipelines"], responses={204: None})
    def delete(self, request, workspace_id, project_id, recipe_id):
        workspace, project = authorized_project(request.user, workspace_id, project_id)
        require_role(request.user, workspace, {"owner", "editor"})
        recipe = get_object_or_404(TransformationRecipe, pk=recipe_id, project=project)
        recipe.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class PipelineRunListView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["pipelines"], responses={200: PipelineRunSerializer(many=True)})
    def get(self, request, workspace_id, project_id, dataset_id):
        _, _, dataset = _dataset_scope(request.user, workspace_id, project_id, dataset_id)
        runs = PipelineRun.objects.filter(source_dataset=dataset).select_related(
            "created_by", "recipe", "result_dataset"
        )[:30]
        return Response(PipelineRunSerializer(runs, many=True).data)

    @extend_schema(
        tags=["pipelines"],
        request=PipelinePreviewRequestSerializer,
        responses={201: PipelineRunSerializer},
    )
    def post(self, request, workspace_id, project_id, dataset_id):
        """Run a deterministic dry-run preview returning step metrics and Git-style cell diffs."""
        workspace, project, dataset = _dataset_scope(request.user, workspace_id, project_id, dataset_id)
        require_role(request.user, workspace, {"owner", "editor"})
        if dataset.status != Dataset.Status.READY:
            raise PipelineConflict()

        serializer = PipelinePreviewRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        recipe = None
        if serializer.validated_data.get("recipe_id"):
            recipe = get_object_or_404(
                TransformationRecipe, pk=serializer.validated_data["recipe_id"], project=project
            )

        try:
            validated_steps = validate_steps(serializer.validated_data["steps"])
            output = execute_pipeline(
                dataset,
                validated_steps,
                mask_pii_in_diff=serializer.validated_data.get("mask_pii", True),
            )
        except PipelineDSLError as exc:
            raise ValidationError({"steps": [exc.message]}) from exc

        run = PipelineRun.objects.create(
            source_dataset=dataset,
            recipe=recipe,
            created_by=request.user,
            steps=validated_steps,
            status=PipelineRun.Status.PREVIEWED,
            source_sha256=dataset.sha256,
            preview_summary=output.summary,
        )
        return Response(PipelineRunSerializer(run).data, status=status.HTTP_201_CREATED)


class PipelineSuggestView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["pipelines"], request=None, responses={200: OpenApiResponse(description="Suggested starter steps")})
    def post(self, request, workspace_id, project_id, dataset_id):
        _, _, dataset = _dataset_scope(request.user, workspace_id, project_id, dataset_id)
        profile = DatasetProfile.objects.filter(
            dataset=dataset, status=DatasetProfile.Status.READY
        ).first()
        if not profile or not isinstance(profile.result, dict):
            return Response({"steps": [], "reason": "Profile the dataset first to auto-draft cleaning steps."})
        steps = suggest_steps_from_profile(profile.result)
        return Response({"steps": steps, "count": len(steps)})


class PipelineCodeExportView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["pipelines"],
        request=PipelineCodeExportSerializer,
        responses={200: OpenApiResponse(description="Reproducible code snippet")},
    )
    def post(self, request, workspace_id, project_id, dataset_id):
        _, _, dataset = _dataset_scope(request.user, workspace_id, project_id, dataset_id)
        serializer = PipelineCodeExportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        steps = serializer.validated_data["steps"]
        language = serializer.validated_data["language"]
        try:
            if language == "polars":
                code = generate_polars_code(dataset.filename, steps)
            elif language == "pandas":
                code = generate_pandas_code(dataset.filename, steps)
            else:
                code = generate_duckdb_sql(dataset.filename, steps)
        except PipelineDSLError as exc:
            raise ValidationError({"steps": [exc.message]}) from exc
        return Response({"language": language, "code": code})


class PipelineApproveView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["pipelines"],
        request=PipelineApproveSerializer,
        responses={200: PipelineRunSerializer},
    )
    def post(self, request, workspace_id, project_id, dataset_id, run_id):
        """Explicitly approve a previewed pipeline run and materialize an immutable derived dataset."""
        workspace, _, dataset = _dataset_scope(request.user, workspace_id, project_id, dataset_id)
        require_role(request.user, workspace, {"owner", "editor"})
        serializer = PipelineApproveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        key_to_cleanup = None
        try:
            with transaction.atomic():
                run = get_object_or_404(
                    PipelineRun.objects.select_for_update(),
                    pk=run_id,
                    source_dataset=dataset,
                )
                if run.status == PipelineRun.Status.APPLIED:
                    return Response(PipelineRunSerializer(run).data)

                dataset = Dataset.objects.select_for_update().get(pk=dataset.pk)
                if dataset.status != Dataset.Status.READY or dataset.sha256 != run.source_sha256:
                    raise PipelineConflict()

                output = execute_pipeline(dataset, run.steps, mask_pii_in_diff=True)
                if output.summary["output_sha256"] != run.preview_summary.get("output_sha256"):
                    raise PipelineConflict()

                custom_name = (serializer.validated_data.get("output_filename") or "").strip()
                if custom_name:
                    derived_name = f"{_safe_stem(custom_name)}.csv"
                else:
                    derived_name = f"{_safe_stem(dataset.filename)}_v{str(run.pk)[:6]}.csv"

                uploaded = SimpleUploadedFile(derived_name, output.csv_bytes, content_type="text/csv")
                key, digest, size = save_upload(uploaded)
                key_to_cleanup = key

                derived = Dataset.objects.create(
                    project=dataset.project,
                    uploaded_by=request.user,
                    filename=derived_name,
                    file_format=Dataset.FileFormat.CSV,
                    storage_key=key,
                    sha256=digest,
                    size_bytes=size,
                    status=Dataset.Status.QUEUED,
                )
                validated = inspect_csv(derived)
                derived.status = Dataset.Status.READY
                derived.row_count = validated.row_count
                derived.column_count = len(validated.columns)
                derived.columns = validated.columns
                derived.completed_at = timezone.now()
                derived.save(
                    update_fields=["status", "row_count", "column_count", "columns", "completed_at"]
                )

                derived_profile = profile_dataset(derived)
                derived_profile["quality"] = assess_quality(derived_profile)
                DatasetProfile.objects.create(
                    dataset=derived,
                    status=DatasetProfile.Status.READY,
                    schema_version=2,
                    result=derived_profile,
                    completed_at=timezone.now(),
                )

                before_prof = DatasetProfile.objects.filter(
                    dataset=dataset, status=DatasetProfile.Status.READY
                ).first()
                before_q = (before_prof.result or {}).get("quality", {}) if before_prof else {}
                after_q = derived_profile["quality"]

                before_score = before_q.get("overall_score")
                after_score = after_q.get("overall_score")
                run.validation = {
                    "before_overall_score": before_score,
                    "after_overall_score": after_score,
                    "score_delta": (
                        round(after_score - before_score, 1)
                        if isinstance(before_score, (int, float)) and isinstance(after_score, (int, float))
                        else None
                    ),
                    "before_completeness_percent": before_q.get("completeness_percent"),
                    "after_completeness_percent": after_q.get("completeness_percent"),
                    "before_dimensions": before_q.get("dimensions"),
                    "after_dimensions": after_q.get("dimensions"),
                    "derived_filename": derived.filename,
                }
                run.result_dataset = derived
                run.status = PipelineRun.Status.APPLIED
                run.applied_at = timezone.now()
                run.save(update_fields=["result_dataset", "status", "applied_at", "validation"])
            key_to_cleanup = None
            from governance.services import record_audit_event

            record_audit_event(
                workspace,
                actor=request.user,
                action="pipeline.applied",
                resource_type="pipeline_run",
                resource_id=str(run.id),
                metadata={
                    "source_filename": dataset.filename,
                    "derived_filename": run.validation.get("derived_filename", ""),
                    "step_count": len(run.steps),
                    "score_delta": run.validation.get("score_delta"),
                },
            )
            return Response(PipelineRunSerializer(run).data)
        except (PipelineDSLError, AdmissionError) as exc:
            raise ValidationError({"pipeline": [str(exc)]}) from exc
        finally:
            if key_to_cleanup is not None:
                storage_path(key_to_cleanup).unlink(missing_ok=True)


class PipelineExportView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["pipelines"], responses={200: OpenApiTypes.BINARY})
    def get(self, request, workspace_id, project_id, dataset_id, run_id):
        _, _, dataset = _dataset_scope(request.user, workspace_id, project_id, dataset_id)
        run = get_object_or_404(
            PipelineRun.objects.select_related("result_dataset"),
            pk=run_id,
            source_dataset=dataset,
            status=PipelineRun.Status.APPLIED,
        )
        if not run.result_dataset:
            raise PipelineConflict()

        fmt = (request.query_params.get("download") or "csv").lower()
        if fmt not in {"csv", "parquet", "xlsx"}:
            raise ValidationError({"download": "Choose csv, parquet, or xlsx."})

        columns, row_iter = iter_tabular_rows(run.result_dataset)
        payload = export_table_bytes(columns, list(row_iter), fmt)

        mime = {
            "csv": "text/csv",
            "parquet": "application/octet-stream",
            "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }[fmt]
        stem = _safe_stem(run.result_dataset.filename)
        response = HttpResponse(payload, content_type=mime)
        response["Content-Disposition"] = f'attachment; filename="{stem}.{fmt}"'
        response["X-Content-Type-Options"] = "nosniff"
        response["Cache-Control"] = "private, no-store, max-age=0"
        return response


class ProjectLineageView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["pipelines"],
        responses={200: OpenApiResponse(description="Project-wide dataset version lineage DAG")},
    )
    def get(self, request, workspace_id, project_id):
        _, project = authorized_project(request.user, workspace_id, project_id)
        datasets = list(
            Dataset.objects.filter(project=project)
            .select_related("profile")
            .order_by("created_at", "id")
        )
        ds_ids = [d.pk for d in datasets]

        pipe_runs = list(
            PipelineRun.objects.filter(
                source_dataset_id__in=ds_ids,
                status=PipelineRun.Status.APPLIED,
                result_dataset__isnull=False,
            )
            .select_related("recipe")
            .order_by("applied_at", "id")
        )
        rem_runs = list(
            RemediationRun.objects.filter(
                dataset_id__in=ds_ids,
                status=RemediationRun.Status.APPLIED,
                result_dataset__isnull=False,
            ).order_by("applied_at", "id")
        )

        derived_ids = {r.result_dataset_id for r in pipe_runs} | {r.result_dataset_id for r in rem_runs}

        nodes = []
        for ds in datasets:
            prof = getattr(ds, "profile", None)
            quality = (prof.result or {}).get("quality", {}) if prof and prof.status == "ready" else {}
            nodes.append(
                {
                    "id": str(ds.pk),
                    "filename": ds.filename,
                    "file_format": ds.file_format,
                    "status": ds.status,
                    "row_count": ds.row_count,
                    "column_count": ds.column_count,
                    "size_bytes": ds.size_bytes,
                    "sha256": ds.sha256,
                    "overall_score": quality.get("overall_score"),
                    "completeness_percent": quality.get("completeness_percent"),
                    "is_derived": ds.pk in derived_ids,
                    "created_at": ds.created_at,
                }
            )

        edges = []
        for run in pipe_runs:
            edges.append(
                {
                    "id": f"pipe:{run.pk}",
                    "kind": "pipeline",
                    "source": str(run.source_dataset_id),
                    "target": str(run.result_dataset_id),
                    "label": run.recipe.name if run.recipe else f"{len(run.steps)} DSL step(s)",
                    "step_count": len(run.steps),
                    "operations": [s.get("op") for s in run.steps if isinstance(s, dict)],
                    "rows_removed": run.preview_summary.get("total_rows_removed", 0),
                    "cells_changed": run.preview_summary.get("total_cells_changed", 0),
                    "score_delta": run.validation.get("score_delta"),
                    "applied_at": run.applied_at,
                }
            )

        for run in rem_runs:
            edges.append(
                {
                    "id": f"rem:{run.pk}",
                    "kind": "ai_remediation",
                    "source": str(run.dataset_id),
                    "target": str(run.result_dataset_id),
                    "label": "AI-reviewed remediation",
                    "step_count": len(run.operations or []),
                    "operations": run.operations or [],
                    "rows_removed": (run.preview or {}).get("removed_duplicate_rows", 0),
                    "cells_changed": (run.preview or {}).get("changed_cells", 0),
                    "score_delta": None,
                    "applied_at": run.applied_at,
                }
            )

        return Response({"nodes": nodes, "edges": edges})


class DriftCompareView(APIView):
    """Compare any two READY datasets in a project for schema & statistical ML drift."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["drift"],
        request=DriftCompareRequestSerializer,
        responses={200: OpenApiResponse(description="Schema & statistical drift report")},
    )
    def post(self, request, workspace_id, project_id):
        _, project = authorized_project(request.user, workspace_id, project_id)
        serializer = DriftCompareRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        baseline = get_object_or_404(
            Dataset, pk=serializer.validated_data["baseline_dataset_id"], project=project
        )
        candidate = get_object_or_404(
            Dataset, pk=serializer.validated_data["candidate_dataset_id"], project=project
        )
        if baseline.status != Dataset.Status.READY or candidate.status != Dataset.Status.READY:
            raise PipelineConflict("Both baseline and candidate datasets must be ready.")

        try:
            report = compare_datasets(baseline, candidate)
        except (AdmissionError, OSError, ValueError) as exc:
            raise ValidationError({"drift": [str(exc)]}) from exc
        return Response(report, status=status.HTTP_200_OK)
