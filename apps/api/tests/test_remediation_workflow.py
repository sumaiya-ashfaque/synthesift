"""Deterministic preview, human authorization, derived lineage and PDF export."""

import hashlib

import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from ai_remediation.evidence import profile_digest
from ai_remediation.models import AIReport, RemediationRun
from ai_remediation.remediation import RemediationError, transform_dataset, validate_operations
from datasets.models import Dataset, DatasetProfile
from datasets.storage import save_upload, storage_path
from identity.models import Workspace, WorkspaceMembership
from projects.models import Project


@pytest.fixture
def scenario(db, tmp_path):
    user_model = get_user_model()
    owner = user_model.objects.create_user(username="remediation_owner", password="ExamplePassword2026!")
    viewer = user_model.objects.create_user(username="remediation_viewer", password="ExamplePassword2026!")
    outsider = user_model.objects.create_user(username="remediation_outsider", password="ExamplePassword2026!")
    workspace = Workspace.objects.create(owner=owner, name="Review Workflow")
    WorkspaceMembership.objects.create(workspace=workspace, user=viewer, role="viewer")
    project = Project.objects.create(workspace=workspace, name="Customer Quality")
    with override_settings(DATASET_STORAGE_ROOT=tmp_path):
        source = b"name,code\n Alice ,X\nAlice,X\nBob,Y\n"
        key, sha, size = save_upload(SimpleUploadedFile("original.csv", source))
        dataset = Dataset.objects.create(
            project=project, uploaded_by=owner, filename="original.csv",
            storage_key=key, sha256=sha, size_bytes=size,
            status=Dataset.Status.READY, row_count=3, column_count=2,
            columns=["name", "code"],
        )
        result = {
            "row_count": 3, "column_count": 2, "missing_cells": 0,
            "duplicate_rows": 0,
            "columns": [{"name": "name", "missing_count": 0}],
            "quality": {"findings": []},
        }
        DatasetProfile.objects.create(
            dataset=dataset, status=DatasetProfile.Status.READY, result=result
        )
        report = AIReport.objects.create(
            dataset=dataset, requested_by=owner, technique="few_shot",
            model="gemini-3.5-flash-lite", thinking_level="low",
            max_output_tokens=3072, profile_digest=profile_digest(result),
            consent_at=timezone.now(), status=AIReport.Status.READY,
            result={"summary": "Review formatting before any change.", "recommendations": []},
        )
        base = (
            f"/api/v1/workspaces/{workspace.pk}/projects/{project.pk}"
            f"/datasets/{dataset.pk}/remediations"
        )
        yield {
            "owner": owner, "viewer": viewer, "outsider": outsider,
            "dataset": dataset, "report": report, "base": base,
            "source": source,
        }


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def preview_request(scenario):
    return {
        "report_id": str(scenario["report"].pk),
        "operations": ["remove_exact_duplicates", "trim_whitespace"],
    }


def test_operations_are_allowlisted_and_ordered():
    assert validate_operations([
        "remove_exact_duplicates", "trim_whitespace"
    ]) == ["trim_whitespace", "remove_exact_duplicates"]
    for value in ([], ["run_python"], ["trim_whitespace", "trim_whitespace"], "trim_whitespace"):
        with pytest.raises(RemediationError):
            validate_operations(value)


def test_deterministic_preview_does_not_mutate_source(scenario):
    dataset = scenario["dataset"]
    result = transform_dataset(dataset, ["trim_whitespace", "remove_exact_duplicates"])
    assert result.summary["before"]["rows"] == 3
    assert result.summary["after"]["rows"] == 2
    assert result.summary["after"]["exact_duplicates"] == 0
    assert result.summary["changed_cells"] == 1
    assert result.summary["removed_duplicate_rows"] == 1
    assert result.content == b"name,code\nAlice,X\nBob,Y\n"
    assert storage_path(dataset.storage_key).read_bytes() == scenario["source"]
    assert hashlib.sha256(result.content).hexdigest() == result.summary["output_sha256"]


def test_preview_and_explicit_approval_create_immutable_derived_dataset(scenario):
    owner = client_for(scenario["owner"])
    preview = owner.post(scenario["base"], preview_request(scenario), format="json")
    assert preview.status_code == 201, preview.content
    value = preview.json()
    assert value["status"] == "previewed"
    assert value["result_dataset_id"] is None
    assert Dataset.objects.count() == 1

    endpoint = f'{scenario["base"]}/{value["id"]}'
    assert owner.post(endpoint, {"approve": False}, format="json").status_code == 400
    applied = owner.post(endpoint, {"approve": True}, format="json")
    assert applied.status_code == 200, applied.content
    assert applied.json()["status"] == "applied"
    assert Dataset.objects.count() == 2
    derived = Dataset.objects.get(pk=applied.json()["result_dataset_id"])
    assert derived.project_id == scenario["dataset"].project_id
    assert derived.status == Dataset.Status.READY
    assert derived.row_count == 2
    derived_profile = DatasetProfile.objects.get(dataset=derived)
    assert derived_profile.status == DatasetProfile.Status.READY
    assert derived_profile.result["row_count"] == 2
    assert derived_profile.result["duplicate_rows"] == 0
    assert storage_path(derived.storage_key).read_bytes() == b"name,code\nAlice,X\nBob,Y\n"
    assert storage_path(scenario["dataset"].storage_key).read_bytes() == scenario["source"]
    assert owner.post(endpoint, {"approve": True}, format="json").status_code == 200
    assert Dataset.objects.count() == 2

    pdf = owner.get(f"{endpoint}/export?download=pdf")
    assert pdf.status_code == 200
    assert pdf["Content-Type"] == "application/pdf"
    assert pdf["Cache-Control"] == "private, no-store, max-age=0"
    assert bytes(pdf.content).startswith(b"%PDF")
    csv_response = owner.get(f"{endpoint}/export?download=csv")
    assert csv_response.status_code == 200
    assert csv_response["Cache-Control"] == "private, no-store, max-age=0"
    assert b"".join(csv_response.streaming_content) == b"name,code\nAlice,X\nBob,Y\n"
    assert RemediationRun.objects.filter(dataset=scenario["dataset"]).count() == 1


def test_viewer_can_read_but_not_preview_or_apply(scenario):
    owner = client_for(scenario["owner"])
    made = owner.post(scenario["base"], preview_request(scenario), format="json").json()
    viewer = client_for(scenario["viewer"])
    assert viewer.get(scenario["base"]).status_code == 200
    assert viewer.get(f'{scenario["base"]}/{made["id"]}').status_code == 200
    assert viewer.post(scenario["base"], preview_request(scenario), format="json").status_code == 403
    assert viewer.post(f'{scenario["base"]}/{made["id"]}', {"approve": True}, format="json").status_code == 403
    assert client_for(scenario["outsider"]).get(scenario["base"]).status_code == 404


def test_report_or_profile_change_prevents_application(scenario):
    owner = client_for(scenario["owner"])
    made = owner.post(scenario["base"], preview_request(scenario), format="json")
    assert made.status_code == 201
    profile = DatasetProfile.objects.get(dataset=scenario["dataset"])
    profile.result = {**profile.result, "missing_cells": 1}
    profile.save(update_fields=["result"])
    rejected = owner.post(f'{scenario["base"]}/{made.json()["id"]}', {"approve": True}, format="json")
    assert rejected.status_code == 409
    assert Dataset.objects.count() == 1


def test_preview_rejects_unsupported_operation(scenario):
    bad = client_for(scenario["owner"]).post(
        scenario["base"],
        {"report_id": str(scenario["report"].pk), "operations": ["execute_code"]},
        format="json",
    )
    assert bad.status_code == 400
    assert RemediationRun.objects.count() == 0
