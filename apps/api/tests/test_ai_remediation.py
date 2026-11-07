"""Check AI API isolation, inference parameters and evidence validation without network calls."""

import json

import pytest
from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from ai_remediation.evidence import evidence_from_profile
from ai_remediation.gemini import generate_json
from ai_remediation.models import AIReport
from ai_remediation.prompts import make_prompt
from ai_remediation.tasks import generate_report
from ai_remediation.validation import InvalidAIOutput, validate_report
from datasets.models import Dataset, DatasetProfile
from identity.models import Workspace, WorkspaceMembership
from projects.models import Project


@pytest.fixture
def context(db):
    user_model = get_user_model()
    users = {role: user_model.objects.create_user(username=f"ai_{role}", password="TestPass!234")
             for role in ("owner", "viewer", "outsider")}
    workspace = Workspace.objects.create(owner=users["owner"], name="Review Space")
    WorkspaceMembership.objects.create(workspace=workspace, user=users["viewer"], role="viewer")
    project = Project.objects.create(workspace=workspace, name="Quality")
    dataset = Dataset.objects.create(
        project=project, uploaded_by=users["owner"], filename="customers.csv",
        storage_key="ab/" + "ab" + "0" * 30 + ".csv", sha256="0" * 64,
        size_bytes=20, status=Dataset.Status.READY,
    )
    result = {
        "row_count": 12, "column_count": 1, "missing_cells": 6,
        "duplicate_rows": 0,
        "columns": [{"name": "region", "inferred_type": "text", "missing_count": 6,
                     "missing_percent": 50, "populated_count": 6, "distinct_count": 3,
                     "distinct_count_exact": True, "numeric": None}],
        "quality": {"findings": [{"code": "high_missingness", "severity": "warning",
                                 "column": "region", "message": "50% missing"}]},
    }
    DatasetProfile.objects.create(dataset=dataset, status=DatasetProfile.Status.READY, result=result)
    url = f"/api/v1/workspaces/{workspace.pk}/projects/{project.pk}/datasets/{dataset.pk}/ai-reports"
    return users, workspace, project, dataset, url


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def payload(**overrides):
    return {"technique": "few_shot", "model": "gemini-3.5-flash-lite",
            "thinking_level": "low", "max_output_tokens": 3072,
            "consent_external_processing": True, **overrides}


@pytest.mark.django_db
def test_owner_can_submit_and_viewer_only_read(context, monkeypatch, django_capture_on_commit_callbacks):
    users, _, _, dataset, url = context
    dispatched = []
    monkeypatch.setattr("ai_remediation.api.generate_report.delay", lambda x: dispatched.append(x))
    with override_settings(GEMINI_API_KEY="fake-test-only"):
        with django_capture_on_commit_callbacks(execute=True):
            response = client_for(users["owner"]).post(url, payload(), format="json")
        assert response.status_code == 202, response.content
        assert dispatched == [response.json()["id"]]
        assert response.json()["dataset"] == str(dataset.pk)
        assert client_for(users["viewer"]).get(url).status_code == 200
        assert client_for(users["viewer"]).post(url, payload(), format="json").status_code == 403
        assert client_for(users["outsider"]).get(url).status_code == 404
        assert client_for(users["outsider"]).post(url, payload(), format="json").status_code == 404
        assert client_for(users["owner"]).post(url, payload(), format="json").status_code == 409


@pytest.mark.django_db
def test_consent_config_and_readiness(context):
    users, _, _, dataset, url = context
    client = client_for(users["owner"])
    with override_settings(GEMINI_API_KEY="fake-test-only"):
        assert client.post(url, payload(consent_external_processing=False), format="json").status_code == 400
        assert client.post(url, payload(model="gemini-3.8-flash", thinking_level="minimal"), format="json").status_code == 400
        assert client.post(url, payload(temperature="0.5"), format="json").status_code == 400
        assert client.post(url, payload(max_output_tokens=99), format="json").status_code == 400
        dataset.status = Dataset.Status.QUEUED
        dataset.save(update_fields=["status"])
        assert client.post(url, payload(), format="json").status_code == 409
    assert AIReport.objects.count() == 0


@pytest.mark.django_db
def test_missing_key_does_not_enqueue(context):
    users, _, _, _, url = context
    with override_settings(GEMINI_API_KEY=""):
        assert client_for(users["owner"]).post(url, payload(), format="json").status_code == 503
    assert AIReport.objects.count() == 0


def test_prompt_techniques_are_distinct_and_evidence_only():
    evidence = {"row_count": 2, "columns": [], "findings": []}
    prompts = [make_prompt(t, evidence)[1] for t in
               ("zero_shot", "few_shot", "stepwise", "role_based")]
    assert len(set(prompts)) == 4
    assert all("UNTRUSTED AGGREGATE EVIDENCE" in prompt for prompt in prompts)


def test_recommendations_require_valid_evidence_ids():
    evidence = {"columns": [{"id": "C1"}], "findings": [{"id": "F1"}]}
    output = {"summary": "Review missing data", "limitations": ["No source rows"],
              "recommendations": [{"title": "Check missingness", "action": "review_missingness",
                                   "priority": "high", "rationale": "Missing values flagged",
                                   "evidence_ids": ["F1"], "steps": ["Inspect upstream records"],
                                   "verification": "Compare counts"}]}
    assert validate_report(output, evidence)["approval_required"] is True
    output["recommendations"][0]["evidence_ids"] = ["made-up"]
    with pytest.raises(InvalidAIOutput):
        validate_report(output, evidence)


def test_privacy_omits_numeric_aggregates_for_tiny_cohorts():
    profile = {"row_count": 1, "column_count": 1, "missing_cells": 0,
               "columns": [{"name": "age", "populated_count": 1, "numeric": {"mean": "83"}}],
               "quality": {"findings": []}}
    assert evidence_from_profile(profile)["columns"][0]["numeric_aggregates"] is None


def test_real_gemini_request_has_effective_parameters(monkeypatch):
    calls = []

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self, _limit):
            return json.dumps({"candidates": [{"content": {"parts": [
                {"text": '{"summary":"ok","limitations":[],"recommendations":[]}'}
            ]}}]}).encode()

    def fake_urlopen(req, timeout):
        calls.append((json.loads(req.data), req.headers, timeout))
        return Response()

    monkeypatch.setattr("ai_remediation.gemini.urlopen", fake_urlopen)
    with override_settings(GEMINI_API_KEY="not-a-real-key"):
        generate_json(model="gemini-3.5-flash-lite", system="system", prompt="prompt",
                      thinking_level="high", max_output_tokens=3072, temperature=None)
        generate_json(model="gemini-2.5-flash", system="system", prompt="prompt",
                      thinking_level="low", max_output_tokens=2048, temperature=0.35)
    assert calls[0][0]["generationConfig"]["thinkingConfig"]["thinkingLevel"] == "high"
    assert calls[0][0]["generationConfig"]["maxOutputTokens"] == 3072
    assert "temperature" not in calls[0][0]["generationConfig"]
    assert calls[1][0]["generationConfig"]["temperature"] == 0.35
    assert "not-a-real-key" not in str(calls[0][0])


@pytest.mark.django_db
def test_worker_validates_output_and_persists_proposals(context, monkeypatch):
    from ai_remediation.evidence import profile_digest

    users, _, _, dataset, _ = context
    profile = DatasetProfile.objects.get(dataset=dataset)
    report = AIReport.objects.create(
        dataset=dataset, requested_by=users["owner"], technique="zero_shot",
        model="gemini-3.5-flash-lite", thinking_level="low", max_output_tokens=3072,
        profile_digest=profile_digest(profile.result), consent_at=timezone.now(),
    )
    monkeypatch.setattr("ai_remediation.tasks.generate_json", lambda **_kw: {
        "summary": "Review region missingness", "limitations": ["No raw records"],
        "recommendations": [{"title": "Check source data", "action": "review_missingness",
                             "priority": "medium", "rationale": "Half values missing",
                             "evidence_ids": ["F1"], "steps": ["Inspect source process"],
                             "verification": "Check missing count"}],
    })
    assert generate_report.run(str(report.pk)) == "ready"
    report.refresh_from_db()
    assert report.status == AIReport.Status.READY
    assert report.result["recommendations"][0]["evidence_ids"] == ["F1"]
    assert generate_report.run(str(report.pk)) == "skipped"
