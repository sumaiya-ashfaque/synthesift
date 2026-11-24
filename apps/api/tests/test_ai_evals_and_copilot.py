"""Integration tests for AI Systems Eval Workbench, guardrail benchmark, and Copilot-to-DSL drafting."""

from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from ai_remediation.models import AIReport
from datasets.models import Dataset, DatasetProfile
from identity.models import Workspace, WorkspaceMembership
from projects.models import Project

User = get_user_model()


@pytest.mark.django_db
def test_ai_eval_telemetry_guardrail_benchmark_and_copilot_draft_pipeline():
    user = User.objects.create_user(username="eval_owner", password="StrongPassword123!")
    ws = Workspace.objects.create(name="Eval WS", owner=user)
    WorkspaceMembership.objects.create(workspace=ws, user=user, role="owner")
    project = Project.objects.create(workspace=ws, name="Eval Proj")
    dataset = Dataset.objects.create(
        project=project,
        uploaded_by=user,
        filename="billing.csv",
        file_format="csv",
        storage_key="fake/billing.csv",
        size_bytes=120,
        sha256="a" * 64,
        status=Dataset.Status.READY,
        row_count=20,
        column_count=3,
        columns=["invoice_id", "amount", "email"],
    )
    DatasetProfile.objects.create(
        dataset=dataset,
        status=DatasetProfile.Status.READY,
        result={
            "row_count": 20,
            "column_count": 3,
            "columns": [
                {"name": "invoice_id", "inferred_type": "text"},
                {"name": "amount", "inferred_type": "decimal"},
                {"name": "email", "inferred_type": "text"},
            ],
        },
    )

    now = timezone.now()
    ready_report = AIReport.objects.create(
        dataset=dataset,
        requested_by=user,
        status=AIReport.Status.READY,
        technique=AIReport.Technique.FEW_SHOT,
        model="gemini-3.5-flash-lite",
        profile_digest="b" * 64,
        consent_at=now,
        started_at=now,
        completed_at=now + timedelta(milliseconds=840),
        result={
            "summary": "Whitespace, duplicates, and PII need remediation.",
            "limitations": ["Aggregate only."],
            "evidence": {
                "columns": [
                    {"id": "C1", "name": "invoice_id", "missing_percent": 0.0},
                    {"id": "C2", "name": "amount", "missing_percent": 10.0},
                    {"id": "C3", "name": "email", "missing_percent": 0.0},
                ],
                "findings": [
                    {"id": "F1", "code": "duplicate_rows", "column": "", "message": "2 exact duplicates"},
                    {"id": "F2", "code": "whitespace_padding", "column": "invoice_id", "message": "spaces"},
                    {"id": "F3", "code": "pii_detected", "column": "email", "message": "email PII"},
                ],
            },
            "recommendations": [
                {
                    "title": "Deduplicate records",
                    "action": "review_duplicates",
                    "priority": "high",
                    "rationale": "Exact duplicates inflate revenue.",
                    "evidence_ids": ["F1"],
                    "steps": ["Drop duplicates."],
                    "verification": "Verify row count.",
                },
                {
                    "title": "Clean keys and mask PII",
                    "action": "standardize_format",
                    "priority": "medium",
                    "rationale": "Standardize keys and protect customer emails.",
                    "evidence_ids": ["F2", "F3", "C1"],
                    "steps": ["Trim whitespace and mask email."],
                    "verification": "Re-profile.",
                },
            ],
        },
    )
    AIReport.objects.create(
        dataset=dataset,
        requested_by=user,
        status=AIReport.Status.FAILED,
        error_code="invalid_ai_output",
        technique=AIReport.Technique.ZERO_SHOT,
        model="gemini-2.5-flash",
        profile_digest="b" * 64,
        consent_at=now,
        started_at=now,
        completed_at=now + timedelta(milliseconds=420),
    )

    client = APIClient()
    client.force_authenticate(user=user)

    # 1. Live AI evaluation telemetry
    eval_res = client.get(f"/api/v1/workspaces/{ws.id}/projects/{project.id}/ai-evals")
    assert eval_res.status_code == 200
    data = eval_res.json()
    assert data["summary"]["total_reports"] == 2
    assert data["summary"]["ready_reports"] == 1
    assert data["summary"]["failed_reports"] == 1
    assert data["summary"]["schema_compliance_rate"] == 50.0
    assert data["summary"]["citation_grounding_rate"] == 100.0
    assert data["summary"]["privacy_egress_policy"] == "aggregate_only_zero_raw_rows"
    assert len(data["by_technique"]) == 2
    assert data["failure_breakdown"]["invalid_ai_output"] == 1

    # 2. Offline adversarial guardrail benchmark suite
    bench_res = client.post(
        f"/api/v1/workspaces/{ws.id}/projects/{project.id}/ai-evals/offline-benchmark"
    )
    assert bench_res.status_code == 200
    bench = bench_res.json()
    assert bench["total_cases"] == 6
    assert bench["passed_cases"] == 6
    assert bench["pass_rate"] == 100.0
    assert all(c["passed"] for c in bench["cases"])

    # 3. Deterministic Copilot-to-DSL pipeline drafting from ready report
    draft_res = client.post(
        f"/api/v1/workspaces/{ws.id}/projects/{project.id}/datasets/{dataset.id}/ai-reports/{ready_report.id}/draft-pipeline"
    )
    assert draft_res.status_code == 200
    draft = draft_res.json()
    ops = [s["op"] for s in draft["steps"]]
    assert "drop_duplicate_rows" in ops
    assert "trim_whitespace" in ops
    assert "mask_pii" in ops
    assert len(draft["rationale_map"]) == len(draft["steps"])
