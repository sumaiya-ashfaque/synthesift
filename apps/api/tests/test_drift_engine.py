"""Tests for statistical dataset comparison and ML drift detection (PSI, KS, JSD, schema)."""

from __future__ import annotations

import json

import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APIClient

from datasets.ingestion import inspect_csv
from datasets.models import Dataset
from datasets.storage import save_upload
from identity.models import Workspace
from projects.models import Project


@pytest.fixture
def drift_env(db, tmp_path):
    user = get_user_model().objects.create_user(
        username="drift_owner", password="ExamplePassword2026!"
    )
    ws = Workspace.objects.create(owner=user, name="ML Monitoring")
    proj = Project.objects.create(workspace=ws, name="Churn Model")

    with override_settings(DATASET_STORAGE_ROOT=tmp_path):
        def make(name: str, payload: bytes) -> Dataset:
            key, sha, size = save_upload(SimpleUploadedFile(name, payload))
            ds = Dataset.objects.create(
                project=proj, uploaded_by=user, filename=name, file_format="csv",
                storage_key=key, sha256=sha, size_bytes=size, status=Dataset.Status.READY,
            )
            s = inspect_csv(ds)
            ds.row_count = s.row_count
            ds.column_count = len(s.columns)
            ds.columns = s.columns
            ds.save(update_fields=["row_count", "column_count", "columns"])
            return ds

        yield user, ws, proj, make


def test_drift_detects_schema_shift_psi_ks_and_jsd_without_leaking_raw_values(drift_env):
    user, ws, proj, make = drift_env
    baseline = make(
        "train_q3.csv",
        b"customer_secret,spend,segment,legacy_col\n"
        b"secret-alpha,100,Starter,1\n"
        b"secret-beta,110,Starter,1\n"
        b"secret-gamma,105,Growth,1\n"
        b"secret-delta,115,Starter,1\n"
        b"secret-eps,108,Starter,1\n"
        b"secret-zeta,112,Growth,1\n",
    )
    candidate = make(
        "prod_q4.csv",
        b"customer_secret,spend,segment,new_feature\n"
        b"secret-one,850,Enterprise,x\n"
        b"secret-two,920,Enterprise,x\n"
        b"secret-three,880,Enterprise,x\n"
        b"secret-four,910,Enterprise,x\n"
        b"secret-five,895,Enterprise,x\n"
        b"secret-six,905,Enterprise,x\n",
    )

    client = APIClient()
    client.force_authenticate(user=user)
    url = f"/api/v1/workspaces/{ws.pk}/projects/{proj.pk}/drift/compare"
    resp = client.post(
        url,
        {"baseline_dataset_id": str(baseline.pk), "candidate_dataset_id": str(candidate.pk)},
        format="json",
    )
    assert resp.status_code == 200, resp.content
    data = resp.json()

    # Privacy invariant: zero raw cell strings leaked in drift report
    dumped = json.dumps(data)
    assert "secret-alpha" not in dumped
    assert "Enterprise" not in dumped

    assert data["summary"]["status"] == "drifted"
    assert data["schema_drift"]["added_columns"] == ["new_feature"]
    assert data["schema_drift"]["removed_columns"] == ["legacy_col"]

    cols = {c["column"]: c for c in data["columns"]}
    assert cols["spend"]["status"] == "drifted"
    assert cols["spend"]["numeric"]["psi"] >= 0.25
    assert cols["spend"]["numeric"]["ks_stat"] == 1.0
    assert cols["segment"]["status"] == "drifted"
    assert cols["segment"]["categorical"]["jsd"] >= 0.9


def test_identical_datasets_report_stable_zero_drift(drift_env):
    user, ws, proj, make = drift_env
    payload = b"score,tier\n10,A\n20,B\n30,A\n40,B\n"
    d1 = make("a.csv", payload)
    d2 = make("b.csv", payload)

    client = APIClient()
    client.force_authenticate(user=user)
    resp = client.post(
        f"/api/v1/workspaces/{ws.pk}/projects/{proj.pk}/drift/compare",
        {"baseline_dataset_id": str(d1.pk), "candidate_dataset_id": str(d2.pk)},
        format="json",
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["summary"]["status"] == "stable"
    assert body["summary"]["max_psi"] == 0.0
    assert body["summary"]["max_ks"] == 0.0
    assert body["summary"]["max_jsd"] == 0.0
