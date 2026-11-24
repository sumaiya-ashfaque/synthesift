"""Tests for Data Contracts (10 expectation rules), YAML round-trip, auto-generation, and gate runs."""

from __future__ import annotations

import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APIClient

from datasets.ingestion import inspect_csv
from datasets.models import Dataset, DatasetProfile
from datasets.profiling import profile_dataset
from datasets.quality import assess_quality
from datasets.storage import save_upload
from identity.models import Workspace, WorkspaceMembership
from projects.models import Project


@pytest.fixture
def contracts_env(db, tmp_path):
    user_model = get_user_model()
    owner = user_model.objects.create_user(username="c_owner", password="ExamplePassword2026!")
    viewer = user_model.objects.create_user(username="c_viewer", password="ExamplePassword2026!")
    ws = Workspace.objects.create(owner=owner, name="Contracts Lab")
    WorkspaceMembership.objects.create(workspace=ws, user=viewer, role="viewer")
    proj = Project.objects.create(workspace=ws, name="Governance")

    payload = (
        b"invoice_id,email,tier,amount\n"
        b"INV-1,alice@acme.io,Enterprise,500\n"
        b"INV-2,bob@acme.io,Growth,300\n"
        b"INV-3,,Starter,150\n"
        b"INV-4,dave@acme.io, Enterprise ,95000\n"
    )
    with override_settings(DATASET_STORAGE_ROOT=tmp_path):
        key, sha, size = save_upload(SimpleUploadedFile("invoices.csv", payload))
        ds = Dataset.objects.create(
            project=proj, uploaded_by=owner, filename="invoices.csv", file_format="csv",
            storage_key=key, sha256=sha, size_bytes=size, status=Dataset.Status.READY,
        )
        s = inspect_csv(ds)
        ds.row_count = s.row_count
        ds.column_count = len(s.columns)
        ds.columns = s.columns
        ds.save(update_fields=["row_count", "column_count", "columns"])
        prof = profile_dataset(ds)
        prof["quality"] = assess_quality(prof)
        DatasetProfile.objects.create(
            dataset=ds, status=DatasetProfile.Status.READY, schema_version=2, result=prof
        )
        yield owner, viewer, ws, proj, ds


def _client(user):
    c = APIClient()
    c.force_authenticate(user=user)
    return c


def test_contract_create_evaluate_yaml_roundtrip_and_autogenerate(contracts_env):
    owner, viewer, ws, proj, ds = contracts_env
    base = f"/api/v1/workspaces/{ws.pk}/projects/{proj.pk}"

    # 1. Auto-generate starter contract from profile
    auto = _client(owner).post(f"{base}/datasets/{ds.pk}/contracts/auto-generate")
    assert auto.status_code == 200
    assert len(auto.json()["rules"]) >= 4
    assert "schema_version: synthesift.contract/v1" in auto.json()["yaml"]

    # 2. Create contract with passing + failing rules
    rules = [
        {"type": "expect_table_row_count_between", "min_rows": 2, "max_rows": 10, "severity": "error"},
        {"type": "expect_column_unique", "column": "invoice_id", "severity": "error"},
        {"type": "expect_column_regex_match", "column": "invoice_id", "pattern": "^INV-\\d+$", "mostly": 1.0, "severity": "error"},
        {"type": "expect_column_values_in_set", "column": "tier", "allowed_values": ["Enterprise", "Growth", "Starter"], "case_sensitive": False, "mostly": 1.0, "severity": "error"},
        {"type": "expect_column_not_null", "column": "email", "max_null_percent": 0.0, "severity": "error"},
        {"type": "expect_column_no_pii", "column": "email", "severity": "error"},
        {"type": "expect_column_no_whitespace_padding", "column": "tier", "severity": "warning"},
        {"type": "expect_column_values_between", "column": "amount", "min_value": 0, "max_value": 1000, "mostly": 1.0, "severity": "error"},
    ]
    created = _client(owner).post(
        f"{base}/contracts",
        {"name": "Billing SLA Gate", "description": "Blocks bad billing drops", "rules": rules},
        format="json",
    )
    assert created.status_code == 201, created.content
    cid = created.json()["id"]

    # Viewer cannot create or run contracts
    assert _client(viewer).post(f"{base}/contracts", {"name": "X", "rules": rules}, format="json").status_code == 403
    assert _client(viewer).post(f"{base}/datasets/{ds.pk}/contracts/{cid}/evaluate").status_code == 403

    # 3. Evaluate contract against dataset
    run_resp = _client(owner).post(f"{base}/datasets/{ds.pk}/contracts/{cid}/evaluate")
    assert run_resp.status_code == 201, run_resp.content
    run = run_resp.json()
    assert run["status"] == "failed"
    assert run["total_rules"] == 8
    assert run["passed_rules"] == 4
    assert run["failed_rules"] == 4

    # 4. Export YAML and import as a cloned contract
    yaml_resp = _client(owner).get(f"{base}/contracts/{cid}/yaml")
    assert yaml_resp.status_code == 200
    yaml_text = yaml_resp.json()["yaml"].replace("Billing SLA Gate", "Billing SLA Gate v2")

    imp = _client(owner).post(f"{base}/contracts/import-yaml", {"yaml": yaml_text}, format="json")
    assert imp.status_code == 201
    assert imp.json()["name"] == "Billing SLA Gate v2"
    assert len(imp.json()["rules"]) == 8

    # 5. History readable by viewer
    hist = _client(viewer).get(f"{base}/datasets/{ds.pk}/contract-runs")
    assert hist.status_code == 200
    assert len(hist.json()) == 1
