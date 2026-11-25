"""Enterprise governance endpoints: PATs, Audit Trail, Signed Webhooks, and Headless CI/CD Gate."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from contracts_engine.models import ContractRun, DataContract
from contracts_engine.rules import ContractRuleError, evaluate_contract
from datasets.api import authorized_project
from datasets.formats import AdmissionError
from datasets.ingestion import inspect_dataset
from datasets.models import Dataset, DatasetProfile
from datasets.profiling import profile_dataset
from datasets.quality import assess_quality
from datasets.storage import infer_file_format, save_upload
from identity.models import Workspace
from identity.policy import require_role
from pipelines.drift import compare_datasets

from .models import (
    PAT_SCOPES,
    SUPPORTED_WEBHOOK_EVENTS,
    AuditEvent,
    PersonalAccessToken,
    WebhookDelivery,
    WebhookEndpoint,
    generate_pat,
)
from .serializers import (
    AuditEventSerializer,
    PersonalAccessTokenCreateSerializer,
    PersonalAccessTokenSerializer,
    WebhookDeliverySerializer,
    WebhookEndpointSerializer,
    WebhookEndpointWriteSerializer,
)
from .services import (
    WebhookValidationError,
    deliver_to_endpoint,
    dispatch_webhook_event,
    record_audit_event,
    validate_webhook_url,
)


def _authorized_workspace(user, workspace_id, allowed_roles: set[str]):
    workspace = get_object_or_404(Workspace, pk=workspace_id)
    require_role(user, workspace, allowed_roles)
    return workspace


def _check_pat_scope(request, required_scope: str) -> None:
    pat = getattr(request, "pat", None)
    if pat is not None and required_scope not in (pat.scopes or []):
        raise PermissionDenied(f"Personal Access Token lacks required scope '{required_scope}'.")


def _parse_bool(raw: Any, default: bool = False) -> bool:
    if raw is None or raw == "":
        return default
    if isinstance(raw, bool):
        return raw
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _parse_float(raw: Any, default: float | None = None) -> float | None:
    if raw is None or raw == "":
        return default
    try:
        return float(raw)
    except (TypeError, ValueError) as exc:
        raise ValidationError({"threshold": ["Must be a valid numeric value."]}) from exc


class WorkspaceAuditLogView(APIView):
    """Query immutable workspace audit events."""

    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["governance"], responses={200: AuditEventSerializer(many=True)})
    def get(self, request, workspace_id):
        _check_pat_scope(request, "read")
        workspace = _authorized_workspace(request.user, workspace_id, {"owner", "editor", "viewer"})
        qs = AuditEvent.objects.filter(workspace=workspace)
        action = request.query_params.get("action", "").strip()
        outcome = request.query_params.get("outcome", "").strip()
        if action:
            qs = qs.filter(action=action)
        if outcome:
            qs = qs.filter(outcome=outcome)
        try:
            limit = min(200, max(1, int(request.query_params.get("limit", "100"))))
        except ValueError:
            limit = 100
        return Response(AuditEventSerializer(qs[:limit], many=True).data)


class PersonalAccessTokenListView(APIView):
    """List and mint workspace-scoped Personal Access Tokens."""

    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["governance"], responses={200: PersonalAccessTokenSerializer(many=True)})
    def get(self, request, workspace_id):
        workspace = _authorized_workspace(request.user, workspace_id, {"owner", "editor"})
        tokens = PersonalAccessToken.objects.filter(workspace=workspace).select_related("created_by")[:50]
        return Response(PersonalAccessTokenSerializer(tokens, many=True).data)

    @extend_schema(
        tags=["governance"],
        request=PersonalAccessTokenCreateSerializer,
        responses={201: OpenApiResponse(description="Newly minted token (plaintext shown once)")},
    )
    def post(self, request, workspace_id):
        workspace = _authorized_workspace(request.user, workspace_id, {"owner", "editor"})
        serializer = PersonalAccessTokenCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        scopes = sorted(set(serializer.validated_data["scopes"]) & PAT_SCOPES)
        if not scopes:
            raise ValidationError({"scopes": ["Select at least one valid scope."]})
        days = serializer.validated_data.get("expires_in_days")
        expires_at = timezone.now() + timedelta(days=days) if days else None

        raw_token, prefix, digest = generate_pat()
        pat = PersonalAccessToken.objects.create(
            workspace=workspace,
            created_by=request.user,
            name=serializer.validated_data["name"].strip(),
            token_prefix=prefix,
            token_hash=digest,
            scopes=scopes,
            expires_at=expires_at,
        )
        record_audit_event(
            workspace,
            actor=request.user,
            action="pat.created",
            resource_type="personal_access_token",
            resource_id=str(pat.id),
            metadata={"name": pat.name, "prefix": prefix, "scopes": scopes},
        )
        payload = PersonalAccessTokenSerializer(pat).data
        payload["token"] = raw_token
        return Response(payload, status=status.HTTP_201_CREATED)


class PersonalAccessTokenDetailView(APIView):
    """Revoke a Personal Access Token immediately."""

    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["governance"], responses={204: None})
    def delete(self, request, workspace_id, token_id):
        workspace = _authorized_workspace(request.user, workspace_id, {"owner", "editor"})
        pat = get_object_or_404(PersonalAccessToken, pk=token_id, workspace=workspace)
        if pat.revoked_at is None:
            pat.revoked_at = timezone.now()
            pat.save(update_fields=["revoked_at"])
            record_audit_event(
                workspace,
                actor=request.user,
                action="pat.revoked",
                resource_type="personal_access_token",
                resource_id=str(pat.id),
                metadata={"name": pat.name, "prefix": pat.token_prefix},
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


class WebhookEndpointListView(APIView):
    """List and register HMAC-SHA256 signed workspace webhooks."""

    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["governance"], responses={200: WebhookEndpointSerializer(many=True)})
    def get(self, request, workspace_id):
        workspace = _authorized_workspace(request.user, workspace_id, {"owner", "editor"})
        items = WebhookEndpoint.objects.filter(workspace=workspace).select_related("created_by")[:30]
        return Response(WebhookEndpointSerializer(items, many=True).data)

    @extend_schema(
        tags=["governance"],
        request=WebhookEndpointWriteSerializer,
        responses={201: OpenApiResponse(description="Created webhook with signing secret shown once")},
    )
    def post(self, request, workspace_id):
        workspace = _authorized_workspace(request.user, workspace_id, {"owner", "editor"})
        serializer = WebhookEndpointWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            safe_url = validate_webhook_url(serializer.validated_data["url"])
        except WebhookValidationError as exc:
            raise ValidationError({"url": [exc.message]}) from exc
        events = [e for e in serializer.validated_data["events"] if e in SUPPORTED_WEBHOOK_EVENTS]
        if not events:
            raise ValidationError(
                {"events": [f"Subscribe to at least one event from {sorted(SUPPORTED_WEBHOOK_EVENTS)}."]}
            )

        endpoint = WebhookEndpoint.objects.create(
            workspace=workspace,
            created_by=request.user,
            name=serializer.validated_data["name"].strip(),
            url=safe_url,
            events=sorted(set(events)),
            is_active=serializer.validated_data["is_active"],
        )
        record_audit_event(
            workspace,
            actor=request.user,
            action="webhook.created",
            resource_type="webhook_endpoint",
            resource_id=str(endpoint.id),
            metadata={"name": endpoint.name, "events": endpoint.events},
        )
        data = WebhookEndpointSerializer(endpoint).data
        data["signing_secret"] = endpoint.signing_secret
        return Response(data, status=status.HTTP_201_CREATED)


class WebhookEndpointDetailView(APIView):
    """Toggle or delete a workspace webhook endpoint."""

    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["governance"], responses={200: WebhookEndpointSerializer})
    def patch(self, request, workspace_id, webhook_id):
        workspace = _authorized_workspace(request.user, workspace_id, {"owner", "editor"})
        endpoint = get_object_or_404(WebhookEndpoint, pk=webhook_id, workspace=workspace)
        if "is_active" in request.data:
            endpoint.is_active = _parse_bool(request.data.get("is_active"), default=endpoint.is_active)
        if "name" in request.data and isinstance(request.data["name"], str) and request.data["name"].strip():
            endpoint.name = request.data["name"].strip()[:120]
        if "events" in request.data and isinstance(request.data["events"], list):
            clean = [e for e in request.data["events"] if e in SUPPORTED_WEBHOOK_EVENTS]
            if clean:
                endpoint.events = sorted(set(clean))
        endpoint.save()
        return Response(WebhookEndpointSerializer(endpoint).data)

    @extend_schema(tags=["governance"], responses={204: None})
    def delete(self, request, workspace_id, webhook_id):
        workspace = _authorized_workspace(request.user, workspace_id, {"owner", "editor"})
        endpoint = get_object_or_404(WebhookEndpoint, pk=webhook_id, workspace=workspace)
        record_audit_event(
            workspace,
            actor=request.user,
            action="webhook.deleted",
            resource_type="webhook_endpoint",
            resource_id=str(endpoint.id),
            metadata={"name": endpoint.name},
        )
        endpoint.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class WebhookEndpointTestView(APIView):
    """Send a signed test payload (or dry-run signature verification) to a webhook endpoint."""

    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["governance"], request=None, responses={200: OpenApiResponse(description="Delivery telemetry")})
    def post(self, request, workspace_id, webhook_id):
        workspace = _authorized_workspace(request.user, workspace_id, {"owner", "editor"})
        endpoint = get_object_or_404(WebhookEndpoint, pk=webhook_id, workspace=workspace)
        dry_run = _parse_bool(request.data.get("dry_run"), default=True)
        delivery, signature = deliver_to_endpoint(
            endpoint,
            "webhook.test",
            {
                "message": "SyntheSift HMAC-SHA256 webhook verification ping.",
                "endpoint_name": endpoint.name,
            },
            dry_run=dry_run,
        )
        record_audit_event(
            workspace,
            actor=request.user,
            action="webhook.tested",
            resource_type="webhook_endpoint",
            resource_id=str(endpoint.id),
            outcome=AuditEvent.Outcome.SUCCESS if delivery.status != WebhookDelivery.Status.FAILED else AuditEvent.Outcome.FAILED,
            metadata={"dry_run": dry_run, "status": delivery.status, "http_status": delivery.http_status},
        )
        return Response(
            {
                "delivery": WebhookDeliverySerializer(delivery).data,
                "signature_header": signature,
            }
        )


class WebhookDeliveryListView(APIView):
    """List recent webhook delivery logs for an endpoint."""

    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["governance"], responses={200: WebhookDeliverySerializer(many=True)})
    def get(self, request, workspace_id, webhook_id):
        workspace = _authorized_workspace(request.user, workspace_id, {"owner", "editor"})
        endpoint = get_object_or_404(WebhookEndpoint, pk=webhook_id, workspace=workspace)
        deliveries = WebhookDelivery.objects.filter(endpoint=endpoint)[:25]
        return Response(WebhookDeliverySerializer(deliveries, many=True).data)


class CIGateEvaluateView(APIView):
    """Headless CI/CD Data Quality Gate (supports PAT Bearer auth, file upload or dataset_id).

    Returns HTTP 200 on PASS and HTTP 422 on FAIL so CI runners (`curl --fail`) block bad data automatically.
    """

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    @extend_schema(
        tags=["governance"],
        responses={
            200: OpenApiResponse(description="CI/CD Quality Gate PASSED"),
            422: OpenApiResponse(description="CI/CD Quality Gate FAILED"),
        },
    )
    def post(self, request, workspace_id, project_id):
        _check_pat_scope(request, "gate:run")
        workspace, project = authorized_project(request.user, workspace_id, project_id)
        require_role(request.user, workspace, {"owner", "editor"})

        uploaded_file = request.FILES.get("file")
        dataset_id = request.data.get("dataset_id")
        contract_id = request.data.get("contract_id") or None
        baseline_id = request.data.get("baseline_dataset_id") or None
        min_quality_score = _parse_float(request.data.get("min_quality_score"), default=75.0)
        max_psi = _parse_float(request.data.get("max_psi"), default=0.25)
        fail_on_pii = _parse_bool(request.data.get("fail_on_pii"), default=False)
        dry_run_webhooks = _parse_bool(request.data.get("dry_run_webhooks"), default=True)

        if not uploaded_file and not dataset_id:
            raise ValidationError({"dataset": ["Provide either a multipart 'file' or an existing 'dataset_id'."]})

        # 1. Resolve or admit dataset + ensure READY v2 profile
        if uploaded_file:
            try:
                fmt = infer_file_format(uploaded_file.name)
                key, digest, size = save_upload(uploaded_file)
            except (AdmissionError, ValueError, OSError) as exc:
                raise ValidationError({"file": [str(exc)]}) from exc

            with transaction.atomic():
                dataset = Dataset.objects.create(
                    project=project,
                    uploaded_by=request.user,
                    filename=uploaded_file.name[:255],
                    file_format=fmt,
                    storage_key=key,
                    sha256=digest,
                    size_bytes=size,
                    status=Dataset.Status.QUEUED,
                )
                try:
                    validated = inspect_dataset(dataset)
                except AdmissionError as exc:
                    dataset.status = Dataset.Status.FAILED
                    dataset.error_code = exc.code
                    dataset.save(update_fields=["status", "error_code"])
                    raise ValidationError({"file": [f"Dataset admission failed: {exc.code}"]}) from exc
                dataset.status = Dataset.Status.READY
                dataset.row_count = validated.row_count
                dataset.column_count = len(validated.columns)
                dataset.columns = validated.columns
                dataset.completed_at = timezone.now()
                dataset.save(
                    update_fields=["status", "row_count", "column_count", "columns", "completed_at"]
                )
                prof_result = profile_dataset(dataset)
                prof_result["quality"] = assess_quality(prof_result)
                DatasetProfile.objects.create(
                    dataset=dataset,
                    status=DatasetProfile.Status.READY,
                    schema_version=2,
                    result=prof_result,
                    completed_at=timezone.now(),
                )
        else:
            dataset = get_object_or_404(Dataset, pk=dataset_id, project=project)
            if dataset.status != Dataset.Status.READY:
                raise ValidationError({"dataset_id": ["Dataset must be READY before CI gate evaluation."]})
            prof = DatasetProfile.objects.filter(
                dataset=dataset, status=DatasetProfile.Status.READY
            ).first()
            if prof and isinstance(prof.result, dict) and prof.result.get("profile_version", 1) >= 2:
                prof_result = prof.result
            else:
                prof_result = profile_dataset(dataset)
                prof_result["quality"] = assess_quality(prof_result)
                DatasetProfile.objects.update_or_create(
                    dataset=dataset,
                    defaults={
                        "status": DatasetProfile.Status.READY,
                        "schema_version": 2,
                        "result": prof_result,
                        "completed_at": timezone.now(),
                    },
                )

        # 2. Evaluate Quality Score + PII Safety + Optional Contract + Optional Drift
        quality = prof_result.get("quality") or {}
        overall_score = float(quality.get("overall_score") or quality.get("completeness_percent") or 0.0)
        pii_summary = prof_result.get("pii_summary") or {"flagged_columns": 0, "total_matches": 0, "kinds": []}
        pii_cols = int(pii_summary.get("flagged_columns") or 0)

        checks: list[dict[str, Any]] = []
        checks.append(
            {
                "name": "quality_score",
                "passed": overall_score >= (min_quality_score or 0.0),
                "expected": f">= {min_quality_score}",
                "observed": f"{overall_score}",
            }
        )
        if fail_on_pii:
            checks.append(
                {
                    "name": "zero_pii_policy",
                    "passed": pii_cols == 0,
                    "expected": "0 PII columns",
                    "observed": f"{pii_cols} PII column(s)",
                }
            )

        contract_payload: dict[str, Any] | None = None
        if contract_id:
            contract = get_object_or_404(DataContract, pk=contract_id, project=project)
            try:
                outcome = evaluate_contract(dataset, contract.rules)
            except (ContractRuleError, AdmissionError, OSError, ValueError) as exc:
                raise ValidationError({"contract_id": [str(exc)]}) from exc
            run = ContractRun.objects.create(
                contract=contract,
                dataset=dataset,
                triggered_by=request.user,
                status=outcome["status"],
                passed_rules=outcome["passed_rules"],
                failed_rules=outcome["failed_rules"],
                total_rules=outcome["total_rules"],
                pass_rate=outcome["pass_rate"],
                results=outcome["results"],
            )
            contract_passed = outcome["status"] != "failed"
            checks.append(
                {
                    "name": f"contract:{contract.name}",
                    "passed": contract_passed,
                    "expected": "0 error-severity rule failures",
                    "observed": f"{outcome['passed_rules']}/{outcome['total_rules']} passed ({outcome['pass_rate']}%)",
                }
            )
            contract_payload = {
                "run_id": str(run.id),
                "contract_name": contract.name,
                "status": outcome["status"],
                "pass_rate": outcome["pass_rate"],
                "passed_rules": outcome["passed_rules"],
                "failed_rules": outcome["failed_rules"],
            }
            if not contract_passed:
                dispatch_webhook_event(
                    workspace,
                    "contract.failed",
                    {
                        "dataset_filename": dataset.filename,
                        "contract_name": contract.name,
                        "pass_rate": outcome["pass_rate"],
                    },
                    dry_run=dry_run_webhooks,
                )

        drift_payload: dict[str, Any] | None = None
        if baseline_id:
            baseline = get_object_or_404(Dataset, pk=baseline_id, project=project)
            if baseline.status != Dataset.Status.READY:
                raise ValidationError({"baseline_dataset_id": ["Baseline dataset must be READY."]})
            drift = compare_datasets(baseline, dataset)
            observed_psi = float(drift["summary"]["max_psi"])
            drift_passed = observed_psi <= (max_psi or 0.25) and drift["summary"]["status"] != "drifted"
            checks.append(
                {
                    "name": "ml_drift_gate",
                    "passed": drift_passed,
                    "expected": f"max PSI <= {max_psi} and status != drifted",
                    "observed": f"max PSI {observed_psi} ({drift['summary']['status']})",
                }
            )
            drift_payload = {
                "baseline_filename": baseline.filename,
                "status": drift["summary"]["status"],
                "max_psi": observed_psi,
                "max_ks": drift["summary"]["max_ks"],
                "drifted_columns": drift["summary"]["drifted_columns"],
            }
            if not drift_passed:
                dispatch_webhook_event(
                    workspace,
                    "drift.detected",
                    {
                        "baseline": baseline.filename,
                        "candidate": dataset.filename,
                        "max_psi": observed_psi,
                        "drifted_columns": drift["summary"]["drifted_columns"],
                    },
                    dry_run=dry_run_webhooks,
                )

        all_passed = all(c["passed"] for c in checks)
        verdict = "passed" if all_passed else "failed"
        pat = getattr(request, "pat", None)
        actor_label = f"pat:{pat.token_prefix}" if pat else request.user.username

        record_audit_event(
            workspace,
            actor=request.user,
            actor_label=actor_label,
            action="ci_gate.evaluated",
            resource_type="dataset",
            resource_id=str(dataset.id),
            outcome=AuditEvent.Outcome.SUCCESS if all_passed else AuditEvent.Outcome.BLOCKED,
            metadata={
                "filename": dataset.filename,
                "verdict": verdict,
                "quality_score": overall_score,
                "pii_flagged_columns": pii_cols,
                "checks_passed": sum(1 for c in checks if c["passed"]),
                "checks_total": len(checks),
            },
        )
        dispatch_webhook_event(
            workspace,
            "ci_gate.passed" if all_passed else "ci_gate.failed",
            {
                "project_id": str(project.id),
                "dataset_filename": dataset.filename,
                "verdict": verdict,
                "quality_score": overall_score,
                "pii_flagged_columns": pii_cols,
            },
            dry_run=dry_run_webhooks,
        )

        # Build GitHub PR-ready Markdown table summary
        md_lines = [
            f"### SyntheSift Quality Gate — {'PASS' if all_passed else 'FAIL'}",
            f"**Dataset:** `{dataset.filename}` ({dataset.row_count} rows × {dataset.column_count} cols) · **Quality Index:** `{overall_score}/100`",
            "",
            "| Check | Expected | Observed | Status |",
            "| :--- | :--- | :--- | :--- |",
        ]
        for c in checks:
            md_lines.append(
                f"| `{c['name']}` | {c['expected']} | {c['observed']} | {'PASS' if c['passed'] else 'FAIL'} |"
            )

        body = {
            "verdict": verdict,
            "exit_code": 0 if all_passed else 1,
            "dataset": {
                "id": str(dataset.id),
                "filename": dataset.filename,
                "file_format": dataset.file_format,
                "row_count": dataset.row_count,
                "column_count": dataset.column_count,
                "sha256": dataset.sha256,
            },
            "quality_score": overall_score,
            "pii_flagged_columns": pii_cols,
            "checks": checks,
            "contract_run": contract_payload,
            "drift_summary": drift_payload,
            "markdown_summary": "\n".join(md_lines),
        }
        return Response(
            body,
            status=status.HTTP_200_OK if all_passed else status.HTTP_422_UNPROCESSABLE_ENTITY,
        )
