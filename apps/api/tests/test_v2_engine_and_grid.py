"""Tests for v2 multi-format ingestion, Polars/DuckDB profiling, PII masking, and rows API."""

from __future__ import annotations

import io
import json

import openpyxl
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
from datasets.storage import infer_file_format, save_upload
from identity.models import Workspace, WorkspaceMembership
from projects.models import Project


@pytest.fixture
def env(db, tmp_path):
    user_model = get_user_model()
    owner = user_model.objects.create_user(
        username="v2_owner",
        email="owner@synthesift.test",
        password="ExamplePassword2026!",
    )
    viewer = user_model.objects.create_user(
        username="v2_viewer",
        email="viewer@synthesift.test",
        password="ExamplePassword2026!",
    )
    workspace = Workspace.objects.create(owner=owner, name="Analytics Studio")
    WorkspaceMembership.objects.create(workspace=workspace, user=viewer, role="viewer")
    project = Project.objects.create(workspace=workspace, name="Billing Q4")

    with override_settings(DATASET_STORAGE_ROOT=tmp_path):
        yield owner, viewer, workspace, project


def _client(user) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _admit_ready(project, user, filename: str, payload: bytes) -> Dataset:
    key, sha, size = save_upload(SimpleUploadedFile(filename, payload))
    ds = Dataset.objects.create(
        project=project,
        uploaded_by=user,
        filename=filename,
        file_format=infer_file_format(filename),
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
    return ds


def test_multi_format_ingestion_parquet_xlsx_json_tsv(env):
    owner, _, _, project = env

    # 1. Parquet
    buf = io.BytesIO()
    pl.DataFrame({"sku": ["001", "002", "003"], "price": [10.5, 22.0, 15.25]}).write_parquet(buf)
    pq_ds = _admit_ready(project, owner, "catalog.parquet", buf.getvalue())
    assert pq_ds.file_format == "parquet"
    assert pq_ds.row_count == 3
    assert pq_ds.columns == ["sku", "price"]

    # 2. Excel (.xlsx)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["region", "revenue"])
    ws.append(["EU", 1200])
    ws.append(["US", 3400])
    xbuf = io.BytesIO()
    wb.save(xbuf)
    xlsx_ds = _admit_ready(project, owner, "sales.xlsx", xbuf.getvalue())
    assert xlsx_ds.file_format == "xlsx"
    assert xlsx_ds.row_count == 2
    assert xlsx_ds.columns == ["region", "revenue"]

    # 3. JSON array
    json_payload = json.dumps(
        [{"id": "001", "flag": True}, {"id": "002", "flag": False}]
    ).encode("utf-8")
    json_ds = _admit_ready(project, owner, "events.json", json_payload)
    assert json_ds.file_format == "json"
    assert json_ds.row_count == 2

    # 4. TSV
    tsv_ds = _admit_ready(project, owner, "metrics.tsv", b"a\tb\n1\t2\n3\t4\n")
    assert tsv_ds.file_format == "tsv"
    assert tsv_ds.row_count == 2


def test_v2_profiler_distributions_pii_correlations_and_zero_raw_leakage(env):
    owner, _, _, project = env
    content = (
        b"customer_email,plan,seats,mrr_usd\n"
        b"alice.smith@acme.io,Enterprise,10,500\n"
        b"bob.jones@acme.io,enterprise,20,1000\n"
        b"carol.lee@acme.io, Enterprise ,30,1500\n"
        b"dave.kim@acme.io,N/A,40,2000\n"
        b"erin.fox@acme.io,Starter,50,2500\n"
        b"frank.ray@acme.io,Starter,60,99000\n"
    )
    ds = _admit_ready(project, owner, "saas.csv", content)
    summary = profile_dataset(ds)
    quality = assess_quality(summary)

    # Privacy invariant: zero raw values persisted in profile JSON
    serialized = json.dumps(summary)
    assert "alice.smith@acme.io" not in serialized
    assert "bob.jones@acme.io" not in serialized
    assert "Enterprise" not in serialized

    cols = {c["name"]: c for c in summary["columns"]}
    assert cols["customer_email"]["semantic_type"] == "email"
    assert cols["customer_email"]["pii_signals"][0]["kind"] == "email"
    assert cols["plan"]["text_stats"]["whitespace_padding_count"] == 1
    assert cols["plan"]["text_stats"]["sentinel_null_count"] == 1
    assert cols["plan"]["text_stats"]["case_variant_groups"] >= 1

    mrr_dist = cols["mrr_usd"]["distribution"]
    assert mrr_dist is not None
    assert mrr_dist["outlier_count_iqr"] >= 1
    assert len(mrr_dist["histogram"]) >= 4
    assert summary["correlations"]

    codes = {f["code"] for f in quality["findings"]}
    assert {"pii_detected", "whitespace_padding", "sentinel_nulls", "numeric_outliers"} <= codes
    assert 0 <= quality["overall_score"] <= 100
    assert set(quality["dimensions"].keys()) == {
        "completeness",
        "uniqueness",
        "validity",
        "consistency",
        "privacy_safety",
    }


def test_duckdb_rows_api_pagination_filters_flags_and_pii_rbac(env):
    owner, viewer, workspace, project = env
    content = (
        b"email,tier,amount\n"
        b"secret.person@corp.io, Growth ,100\n"
        b"second.person@corp.io,N/A,120\n"
        b"third.person@corp.io,Starter,110\n"
        b"fourth.person@corp.io,Starter,115\n"
        b"fifth.person@corp.io,Starter,95000\n"
    )
    ds = _admit_ready(project, owner, "grid.csv", content)
    summary = profile_dataset(ds)
    summary["quality"] = assess_quality(summary)
    DatasetProfile.objects.create(
        dataset=ds,
        status=DatasetProfile.Status.READY,
        schema_version=2,
        result=summary,
    )

    url = (
        f"/api/v1/workspaces/{workspace.pk}/projects/{project.pk}"
        f"/datasets/{ds.pk}/rows"
    )

    # Default masks PII
    resp = _client(owner).get(url)
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["total_rows"] == 5
    assert payload["mask_pii"] is True
    assert "email" in payload["pii_columns"]
    first_email = payload["rows"][0]["cells"]["email"]
    assert "secret.person" not in first_email
    assert "•••@corp.io" in first_email
    assert "whitespace" in payload["rows"][0]["flags"]["tier"]
    assert "sentinel_null" in payload["rows"][1]["flags"]["tier"]
    assert "outlier" in payload["rows"][4]["flags"]["amount"]

    # Owner can explicitly unmask
    unmasked = _client(owner).get(f"{url}?mask_pii=false")
    assert unmasked.status_code == 200
    assert unmasked.json()["rows"][0]["cells"]["email"] == "secret.person@corp.io"

    # Viewer CANNOT unmask PII
    assert _client(viewer).get(f"{url}?mask_pii=false").status_code == 403
    assert _client(viewer).get(url).status_code == 200

    # Issue-only filtering works via DuckDB
    outliers_only = _client(owner).get(f"{url}?issue_only=outliers")
    assert outliers_only.status_code == 200
    assert outliers_only.json()["filtered_rows"] == 1
    assert outliers_only.json()["rows"][0]["cells"]["amount"] == "95000"


def test_demo_seed_endpoint_creates_three_profiled_multi_format_datasets(env):
    owner, viewer, workspace, project = env
    url = (
        f"/api/v1/workspaces/{workspace.pk}/projects/{project.pk}"
        f"/datasets/seed-demo"
    )

    assert _client(viewer).post(url).status_code == 403

    resp = _client(owner).post(url)
    assert resp.status_code == 201
    items = resp.json()
    assert len(items) == 3
    assert {item["file_format"] for item in items} == {"csv", "parquet", "json"}
    assert all(item["status"] == "ready" for item in items)
    assert DatasetProfile.objects.filter(
        dataset__project=project, status=DatasetProfile.Status.READY
    ).count() == 3
