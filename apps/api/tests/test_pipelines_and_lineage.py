"""Tests for Phase 2: 15-op Transformation DSL, cell diffs, recipes, codegen, export, and lineage DAG."""

from __future__ import annotations

import io
import zipfile

import polars as pl
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
from pipelines.dsl import PipelineDSLError, validate_steps
from projects.models import Project


@pytest.fixture
def ctx(db, tmp_path):
    user_model = get_user_model()
    owner = user_model.objects.create_user(
        username="pipe_owner", email="pipe@synthesift.test", password="ExamplePassword2026!"
    )
    viewer = user_model.objects.create_user(
        username="pipe_viewer", email="viewer@synthesift.test", password="ExamplePassword2026!"
    )
    workspace = Workspace.objects.create(owner=owner, name="Pipeline Lab")
    WorkspaceMembership.objects.create(workspace=workspace, user=viewer, role="viewer")
    project = Project.objects.create(workspace=workspace, name="Cleaning Suite")

    raw_csv = (
        b"customer_email,plan_tier,region,amount,joined_on\n"
        b"alice@acme.io, enterprise ,US-EAST,500,01/15/2026\n"
        b"bob@acme.io,Enterprise,N/A,520,2026-01-16\n"
        b"carol@acme.io,STARTER,EU-WEST,480,2026/01/17\n"
        b"dave@acme.io,Starter,EU-WEST,510,2026-01-18\n"
        b"erin@acme.io,Starter,US-EAST,95000,2026-01-19\n"
        b"alice@acme.io, enterprise ,US-EAST,500,01/15/2026\n"
    )

    with override_settings(DATASET_STORAGE_ROOT=tmp_path):
        key, sha, size = save_upload(SimpleUploadedFile("billing.csv", raw_csv))
        ds = Dataset.objects.create(
            project=project,
            uploaded_by=owner,
            filename="billing.csv",
            file_format="csv",
            storage_key=key,
            sha256=sha,
            size_bytes=size,
            status=Dataset.Status.READY,
        )
        summary = inspect_csv(ds)
        ds.row_count = summary.row_count
        ds.column_count = len(summary.columns)
        ds.columns = summary.columns
        ds.save(update_fields=["row_count", "column_count", "columns"])

        prof = profile_dataset(ds)
        prof["quality"] = assess_quality(prof)
        DatasetProfile.objects.create(
            dataset=ds, status=DatasetProfile.Status.READY, schema_version=2, result=prof
        )

        yield owner, viewer, workspace, project, ds


def _client(user) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def test_dsl_rejects_unsafe_regex_and_unknown_ops():
    with pytest.raises(PipelineDSLError):
        validate_steps([{"op": "exec_python", "code": "import os"}])
    with pytest.raises(PipelineDSLError):
        validate_steps([{"op": "regex_replace", "column": "x", "pattern": "(a+)+$", "replacement": ""}])


def test_full_pipeline_preview_diff_approve_multiformat_export_and_lineage(ctx):
    owner, viewer, workspace, project, ds = ctx
    base = f"/api/v1/workspaces/{workspace.pk}/projects/{project.pk}"
    ds_base = f"{base}/datasets/{ds.pk}"

    # 1. Auto-suggest starter steps from profile
    suggest_resp = _client(owner).post(f"{ds_base}/pipelines/suggest")
    assert suggest_resp.status_code == 200
    suggested = suggest_resp.json()["steps"]
    assert len(suggested) >= 3

    # 2. Save a reusable recipe
    steps = [
        {"op": "trim_whitespace", "column": "*", "side": "both"},
        {"op": "normalize_sentinel_nulls", "column": "*"},
        {"op": "normalize_case", "column": "plan_tier", "mode": "title"},
        {"op": "fill_missing", "column": "region", "strategy": "constant", "value": "UNKNOWN"},
        {"op": "standardize_date", "column": "joined_on", "output_format": "%Y-%m-%d"},
        {"op": "clip_numeric", "column": "amount", "use_iqr_bounds": True},
        {"op": "mask_pii", "column": "customer_email", "method": "hash_sha256"},
        {"op": "drop_duplicate_rows", "subset_columns": [], "keep": "first"},
    ]
    recipe_resp = _client(owner).post(
        f"{base}/recipes",
        {"name": "Billing Monthly Clean", "description": "Standard hygiene + PII hash", "steps": steps},
        format="json",
    )
    assert recipe_resp.status_code == 201
    recipe_id = recipe_resp.json()["id"]

    # Viewer cannot create recipes or preview pipelines
    assert _client(viewer).post(f"{base}/recipes", {"name": "X", "steps": steps}, format="json").status_code == 403
    assert _client(viewer).post(f"{ds_base}/pipelines", {"steps": steps}, format="json").status_code == 403

    # 3. Dry-run preview with Git-style cell diffs
    preview_resp = _client(owner).post(
        f"{ds_base}/pipelines",
        {"steps": steps, "recipe_id": recipe_id, "mask_pii": True},
        format="json",
    )
    assert preview_resp.status_code == 201, preview_resp.content
    run = preview_resp.json()
    assert run["status"] == "previewed"
    summary = run["preview_summary"]
    assert summary["before"]["rows"] == 6
    assert summary["after"]["rows"] == 5
    assert summary["total_rows_removed"] == 1
    assert summary["total_cells_changed"] > 5
    assert len(summary["step_telemetry"]) == len(steps)
    assert any(d["status"] == "removed" for d in summary["diff_rows"])
    assert any(d["status"] == "modified" for d in summary["diff_rows"])

    # 4. Approve & materialize immutable derived dataset
    approve_resp = _client(owner).post(
        f"{ds_base}/pipelines/{run['id']}/approve",
        {"approve": True, "output_filename": "billing_cleaned_v1"},
        format="json",
    )
    assert approve_resp.status_code == 200, approve_resp.content
    applied = approve_resp.json()
    assert applied["status"] == "applied"
    assert applied["result_dataset_id"] is not None
    assert applied["validation"]["after_overall_score"] >= applied["validation"]["before_overall_score"]

    # 5. Multi-format exports: CSV, Parquet, Excel (.xlsx)
    csv_exp = _client(owner).get(f"{ds_base}/pipelines/{run['id']}/export?download=csv")
    assert csv_exp.status_code == 200
    assert b"sha256:" in csv_exp.content
    assert b"alice@acme.io" not in csv_exp.content

    pq_exp = _client(owner).get(f"{ds_base}/pipelines/{run['id']}/export?download=parquet")
    assert pq_exp.status_code == 200
    df = pl.read_parquet(io.BytesIO(pq_exp.content))
    assert df.height == 5

    xlsx_exp = _client(owner).get(f"{ds_base}/pipelines/{run['id']}/export?download=xlsx")
    assert xlsx_exp.status_code == 200
    assert zipfile.is_zipfile(io.BytesIO(xlsx_exp.content))

    # 6. Project Lineage DAG
    lineage_resp = _client(owner).get(f"{base}/lineage")
    assert lineage_resp.status_code == 200
    lineage = lineage_resp.json()
    assert len(lineage["nodes"]) == 2
    assert len(lineage["edges"]) == 1
    edge = lineage["edges"][0]
    assert edge["source"] == str(ds.pk)
    assert edge["target"] == applied["result_dataset_id"]
    assert edge["label"] == "Billing Monthly Clean"
    assert edge["rows_removed"] == 1


def test_reproducible_code_export_polars_pandas_and_duckdb_sql(ctx):
    owner, _, workspace, project, ds = ctx
    url = f"/api/v1/workspaces/{workspace.pk}/projects/{project.pk}/datasets/{ds.pk}/pipelines/export-code"
    steps = [
        {"op": "trim_whitespace", "column": "*", "side": "both"},
        {"op": "clip_numeric", "column": "amount", "use_iqr_bounds": True},
        {"op": "drop_duplicate_rows", "subset_columns": [], "keep": "first"},
    ]

    for lang, marker in [
        ("polars", "import polars as pl"),
        ("pandas", "import pandas as pd"),
        ("sql", "WITH\nstep_0 AS"),
    ]:
        resp = _client(owner).post(url, {"steps": steps, "language": lang}, format="json")
        assert resp.status_code == 200
        assert marker in resp.json()["code"]
