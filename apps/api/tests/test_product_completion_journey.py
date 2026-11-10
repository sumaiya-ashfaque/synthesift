"""Full API review -> approved derived dataset -> authorized export, with Gemini mocked."""

import hashlib

import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APIClient

from ai_remediation.models import AIReport
from ai_remediation.tasks import generate_report
from datasets.models import Dataset, DatasetProfile
from datasets.storage import save_upload, storage_path
from identity.models import Workspace, WorkspaceMembership
from projects.models import Project


@pytest.mark.django_db
@pytest.mark.parametrize("technique", ["zero_shot", "few_shot", "stepwise", "role_based"])
def test_mocked_gemini_to_approved_derived_export(
    technique, monkeypatch, tmp_path, django_capture_on_commit_callbacks
):
    """Exercise the actual API and worker logic; never call the external provider."""
    user_model = get_user_model()
    owner = user_model.objects.create_user(
        username=f"completion_{technique}", password="TestPasswordExample123!"
    )
    viewer = user_model.objects.create_user(
        username=f"viewer_{technique}", password="TestPasswordExample123!"
    )
    workspace = Workspace.objects.create(owner=owner, name="Synthetic data review")
    WorkspaceMembership.objects.create(workspace=workspace, user=viewer, role="viewer")
    project = Project.objects.create(workspace=workspace, name="Sample quality")
    source = b"name,region\n Alice ,North\nAlice,North\nBob,South\n"

    def client_for(user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    with override_settings(DATASET_STORAGE_ROOT=tmp_path, GEMINI_API_KEY="mock-only-not-real"):
        key, digest, size = save_upload(SimpleUploadedFile("synthetic.csv", source))
        dataset = Dataset.objects.create(
            project=project, uploaded_by=owner, filename="synthetic.csv",
            storage_key=key, sha256=digest, size_bytes=size,
            status=Dataset.Status.READY, row_count=3, column_count=2,
            columns=["name", "region"],
        )
        profile = {
            "row_count": 3, "column_count": 2, "missing_cells": 0,
            "duplicate_rows": 0,
            "columns": [{
                "name": "name", "inferred_type": "text", "missing_count": 0,
                "missing_percent": 0, "populated_count": 3, "distinct_count": 3,
                "distinct_count_exact": True, "numeric": None,
            }],
            "quality": {"findings": [], "completeness_percent": 100,
                        "finding_counts": {}},
        }
        DatasetProfile.objects.create(
            dataset=dataset, status=DatasetProfile.Status.READY, result=profile
        )
        monkeypatch.setattr("ai_remediation.api.generate_report.delay", lambda _id: None)
        seen_prompts = []

        def fake_generation(**kwargs):
            seen_prompts.append(kwargs["prompt"])
            return {
                "summary": "Verify whether repeated entries are intentional.",
                "limitations": ["Only aggregate evidence was used."],
                "recommendations": [{
                    "title": "Review duplicates", "action": "review_duplicates",
                    "priority": "medium", "rationale": "Repeated rows warrant review.",
                    "evidence_ids": ["C1"],
                    "steps": ["Inspect source record policy."],
                    "verification": "Recheck counts following an approved change.",
                }],
            }

        monkeypatch.setattr("ai_remediation.tasks.generate_json", fake_generation)
        base = (
            f"/api/v1/workspaces/{workspace.pk}/projects/{project.pk}"
            f"/datasets/{dataset.pk}"
        )
        with django_capture_on_commit_callbacks(execute=True):
            response = client_for(owner).post(
                f"{base}/ai-reports",
                {
                    "technique": technique, "model": "gemini-3.5-flash-lite",
                    "thinking_level": "low", "max_output_tokens": 3072,
                    "consent_external_processing": True,
                },
                format="json",
            )
        assert response.status_code == 202, response.content
        report_id = response.json()["id"]
        assert generate_report.run(report_id) == "ready"
        report = AIReport.objects.get(pk=report_id)
        assert report.status == AIReport.Status.READY
        assert report.result["recommendations"][0]["evidence_ids"] == ["C1"]
        assert "Alice" not in seen_prompts[0]  # No row-level values are sent.
        assert client_for(viewer).get(f"{base}/ai-reports").status_code == 200
        assert client_for(viewer).post(
            f"{base}/remediations",
            {"report_id": report_id, "operations": ["trim_whitespace"]},
            format="json",
        ).status_code == 403

        preview = client_for(owner).post(
            f"{base}/remediations",
            {"report_id": report_id,
             "operations": ["remove_exact_duplicates", "trim_whitespace"]},
            format="json",
        )
        assert preview.status_code == 201, preview.content
        run_id = preview.json()["id"]
        endpoint = f"{base}/remediations/{run_id}"
        assert Dataset.objects.count() == 1
        assert client_for(owner).post(
            endpoint, {"approve": False}, format="json"
        ).status_code == 400
        applied = client_for(owner).post(
            endpoint, {"approve": True}, format="json"
        )
        assert applied.status_code == 200, applied.content
        derived = Dataset.objects.get(pk=applied.json()["result_dataset_id"])
        assert derived.row_count == 2
        assert storage_path(dataset.storage_key).read_bytes() == source
        assert storage_path(derived.storage_key).read_bytes() == b"name,region\nAlice,North\nBob,South\n"
        assert hashlib.sha256(source).hexdigest() == dataset.sha256
        assert client_for(viewer).get(f"{endpoint}/export?download=pdf").status_code == 200
        csv_response = client_for(owner).get(f"{endpoint}/export?download=csv")
        assert csv_response.status_code == 200
        assert b"".join(csv_response.streaming_content) == b"name,region\nAlice,North\nBob,South\n"
