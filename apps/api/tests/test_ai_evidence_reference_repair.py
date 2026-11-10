"""Verify the exact evidence-ID whitelist and bounded safe correction path."""

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from ai_remediation.evidence import profile_digest
from ai_remediation.models import AIReport
from ai_remediation.prompts import make_evidence_repair_prompt, make_prompt
from ai_remediation.tasks import generate_report
from ai_remediation.validation import InvalidAIOutput, validate_report
from datasets.models import Dataset, DatasetProfile
from identity.models import Workspace
from projects.models import Project


def test_prompt_lists_only_ids_from_current_dataset():
    evidence = {
        "row_count": 3, "columns": [{"id": "C1", "name": "region"}],
        "findings": [{"id": "F2", "code": "high_missingness"}],
    }
    for technique in ("zero_shot", "few_shot", "stepwise", "role_based"):
        system, prompt = make_prompt(technique, evidence)
        assert "VALID_EVIDENCE_IDS (current dataset, exact strings only): [\"C1\", \"F2\"]" in prompt
        assert "must exactly match" in system
        assert "F1 in a few-shot example" in prompt
    repair_system, repair = make_evidence_repair_prompt(
        evidence, {"summary": "test", "recommendations": [{"evidence_ids": ["F999"]}]}
    )
    assert repair_system
    assert 'VALID_EVIDENCE_IDS: ["C1", "F2"]' in repair
    assert "omit it" in repair


def test_empty_evidence_requires_no_fabricated_references():
    evidence = {"row_count": 0, "columns": [], "findings": []}
    _, prompt = make_prompt("few_shot", evidence)
    assert 'VALID_EVIDENCE_IDS (current dataset, exact strings only): []' in prompt
    assert "recommendations: []" in prompt
    output = {"summary": "No evidence available", "limitations": [], "recommendations": []}
    assert validate_report(output, evidence)["recommendations"] == []
    output["recommendations"] = [{"evidence_ids": ["F1"]}]
    with pytest.raises(InvalidAIOutput, match="invalid_evidence_reference"):
        validate_report(output, evidence)


@pytest.mark.django_db
def test_worker_repairs_once_but_still_validates(monkeypatch):
    owner = get_user_model().objects.create_user(username="repair_owner", password="TestPass!234")
    workspace = Workspace.objects.create(owner=owner, name="Repair test space")
    project = Project.objects.create(workspace=workspace, name="Review project")
    dataset = Dataset.objects.create(
        project=project, uploaded_by=owner, filename="example.csv",
        storage_key="ab/ab" + "0" * 30 + ".csv", sha256="0" * 64,
        size_bytes=20, status=Dataset.Status.READY,
    )
    profile_data = {
        "row_count": 6, "column_count": 1, "missing_cells": 3, "duplicate_rows": 0,
        "columns": [{"name": "region", "populated_count": 3, "inferred_type": "text"}],
        "quality": {"findings": [{"code": "high_missingness", "severity": "warning",
                                  "column": "region", "message": "Missing values"}]},
    }
    DatasetProfile.objects.create(dataset=dataset, status=DatasetProfile.Status.READY,
                                  result=profile_data)
    report = AIReport.objects.create(
        dataset=dataset, requested_by=owner, technique="few_shot",
        model="gemini-3.5-flash-lite", thinking_level="low", max_output_tokens=3072,
        profile_digest=profile_digest(profile_data), consent_at=timezone.now(),
    )
    base = {
        "summary": "Review missing values", "limitations": ["No raw rows available"],
        "recommendations": [{
            "title": "Review source completeness", "action": "review_missingness",
            "priority": "medium", "rationale": "A completeness finding is present",
            "evidence_ids": ["F999"], "steps": ["Check source system"],
            "verification": "Confirm missing counts after approved changes",
        }],
    }
    calls = []

    def fake_generate(**kwargs):
        calls.append(kwargs)
        output = {**base, "recommendations": [{**base["recommendations"][0]}]}
        if len(calls) == 2:
            output["recommendations"][0]["evidence_ids"] = ["F1"]
        return output

    monkeypatch.setattr("ai_remediation.tasks.generate_json", fake_generate)
    assert generate_report.run(str(report.pk)) == "ready"
    report.refresh_from_db()
    assert report.status == AIReport.Status.READY
    assert report.result["recommendations"][0]["evidence_ids"] == ["F1"]
    assert len(calls) == 2
    assert "VALID_EVIDENCE_IDS" in calls[1]["prompt"]

    # A second invalid response must still result in a failed report.
    second_report = AIReport.objects.create(
        dataset=dataset, requested_by=owner, technique="few_shot",
        model="gemini-3.5-flash-lite", thinking_level="low", max_output_tokens=3072,
        profile_digest=profile_digest(profile_data), consent_at=timezone.now(),
    )
    rejected_calls = []

    def always_invalid(**kwargs):
        rejected_calls.append(kwargs)
        return {**base, "recommendations": [{**base["recommendations"][0]}]}

    monkeypatch.setattr("ai_remediation.tasks.generate_json", always_invalid)
    assert generate_report.run(str(second_report.pk)) == "failed"
    second_report.refresh_from_db()
    assert second_report.status == AIReport.Status.FAILED
    assert second_report.error_code == "invalid_ai_output"
    assert len(rejected_calls) == 2


@pytest.mark.django_db
def test_bad_repair_never_bypasses_validator():
    """Ensure the repair helper itself does not manufacture an accepted ID."""
    evidence = {"columns": [{"id": "C1"}], "findings": []}
    _, repair = make_evidence_repair_prompt(
        evidence, {"summary": "x", "recommendations": [{"evidence_ids": ["F44"]}]}
    )
    assert 'VALID_EVIDENCE_IDS: ["C1"]' in repair
    invalid = {
        "summary": "Inspect data", "limitations": [],
        "recommendations": [{"title": "Inspect", "action": "inspect", "priority": "low",
                             "rationale": "Inspect", "evidence_ids": ["F44"],
                             "steps": ["Review"], "verification": "Check"}],
    }
    with pytest.raises(InvalidAIOutput, match="invalid_evidence_reference"):
        validate_report(invalid, evidence)
