"""Integration tests for PAT auth, CI/CD Quality Gate, SSRF-safe HMAC Webhooks, and Audit Trail."""

import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from contracts_engine.models import DataContract
from governance.models import AuditEvent, PersonalAccessToken
from identity.models import Workspace, WorkspaceMembership
from projects.models import Project

User = get_user_model()


@pytest.mark.django_db
def test_pat_lifecycle_ci_gate_webhooks_and_audit_trail(tmp_path, settings):
    settings.DATASET_STORAGE_ROOT = tmp_path
    owner = User.objects.create_user(username="gov_owner", password="StrongPassword123!")
    ws = Workspace.objects.create(name="Gov WS", owner=owner)
    WorkspaceMembership.objects.create(workspace=ws, user=owner, role="owner")
    other_ws = Workspace.objects.create(name="Other WS", owner=owner)
    WorkspaceMembership.objects.create(workspace=other_ws, user=owner, role="owner")
    project = Project.objects.create(workspace=ws, name="Release Pipeline")

    contract = DataContract.objects.create(
        project=project,
        created_by=owner,
        name="prod_gate_contract",
        rules=[
            {"type": "expect_column_not_null", "column": "invoice_id", "max_null_percent": 0.0, "severity": "error"},
            {"type": "expect_column_no_pii", "column": "*", "severity": "error"},
        ],
    )

    session_client = APIClient()
    session_client.force_authenticate(user=owner)

    # 1. Mint PAT (raw token returned once, never stored in plaintext)
    tok_res = session_client.post(
        f"/api/v1/workspaces/{ws.id}/tokens",
        {"name": "github-actions-ci", "scopes": ["read", "gate:run"], "expires_in_days": 30},
        format="json",
    )
    assert tok_res.status_code == 201
    tok_data = tok_res.json()
    raw_pat = tok_data["token"]
    assert raw_pat.startswith("ss_pat_")
    pat_obj = PersonalAccessToken.objects.get(pk=tok_data["id"])
    assert pat_obj.token_hash != raw_pat

    # Listing tokens must NOT leak the plaintext secret
    list_res = session_client.get(f"/api/v1/workspaces/{ws.id}/tokens")
    assert list_res.status_code == 200
    assert raw_pat not in str(list_res.json())

    # 2. SSRF protection rejects cloud metadata & loopback webhooks
    ssrf_res = session_client.post(
        f"/api/v1/workspaces/{ws.id}/webhooks",
        {"name": "bad-ssrf", "url": "http://169.254.169.254/latest/meta-data", "events": ["ci_gate.failed"]},
        format="json",
    )
    assert ssrf_res.status_code == 400

    # Valid external HTTPS webhook + dry-run HMAC signature check
    wh_res = session_client.post(
        f"/api/v1/workspaces/{ws.id}/webhooks",
        {"name": "slack-alerts", "url": "https://hooks.example.com/services/T00/B00/XXX", "events": ["ci_gate.failed", "ci_gate.passed", "contract.failed"]},
        format="json",
    )
    assert wh_res.status_code == 201
    wh = wh_res.json()
    assert wh["signing_secret"].startswith("whsec_")

    test_res = session_client.post(
        f"/api/v1/workspaces/{ws.id}/webhooks/{wh['id']}/test",
        {"dry_run": True},
        format="json",
    )
    assert test_res.status_code == 200
    assert test_res.json()["signature_header"].startswith("t=")
    assert ",v1=" in test_res.json()["signature_header"]

    # 3. Headless CI/CD Gate using ONLY Bearer PAT (no session cookie!)
    pat_client = APIClient()
    pat_client.credentials(HTTP_AUTHORIZATION=f"Bearer {raw_pat}")

    # Cross-workspace isolation must fail
    wrong_ws_res = pat_client.get(f"/api/v1/workspaces/{other_ws.id}/audit-logs")
    assert wrong_ws_res.status_code == 401

    # Dirty CSV with PII & missing key -> HTTP 422 FAIL
    dirty_csv = SimpleUploadedFile(
        "bad_drop.csv",
        b"invoice_id,customer_email,amount\nINV-1,alice@example.com,42.50\n,bob@example.com,19.00\n",
        content_type="text/csv",
    )
    fail_gate = pat_client.post(
        f"/api/v1/workspaces/{ws.id}/projects/{project.id}/ci/gate",
        {
            "file": dirty_csv,
            "contract_id": str(contract.id),
            "min_quality_score": "80",
            "fail_on_pii": "true",
            "dry_run_webhooks": "true",
        },
        format="multipart",
    )
    assert fail_gate.status_code == 422
    fail_body = fail_gate.json()
    assert fail_body["verdict"] == "failed"
    assert fail_body["exit_code"] == 1
    assert fail_body["pii_flagged_columns"] >= 1
    assert "### SyntheSift Quality Gate — FAIL" in fail_body["markdown_summary"]

    # Clean CSV -> HTTP 200 PASS
    clean_csv = SimpleUploadedFile(
        "good_drop.csv",
        b"invoice_id,region,amount\nINV-1,EU,42.50\nINV-2,US,55.00\nINV-3,APAC,31.25\nINV-4,EU,48.00\nINV-5,US,60.00\n",
        content_type="text/csv",
    )
    pass_gate = pat_client.post(
        f"/api/v1/workspaces/{ws.id}/projects/{project.id}/ci/gate",
        {
            "file": clean_csv,
            "contract_id": str(contract.id),
            "min_quality_score": "80",
            "fail_on_pii": "true",
            "dry_run_webhooks": "true",
        },
        format="multipart",
    )
    assert pass_gate.status_code == 200
    assert pass_gate.json()["verdict"] == "passed"
    assert pass_gate.json()["exit_code"] == 0

    # 4. Audit trail captured PAT creation, webhook creation/test, and CI gates without leaking raw PII
    audit_res = pat_client.get(f"/api/v1/workspaces/{ws.id}/audit-logs")
    assert audit_res.status_code == 200
    events = audit_res.json()
    actions = {e["action"] for e in events}
    assert {"pat.created", "webhook.created", "webhook.tested", "ci_gate.evaluated"}.issubset(actions)
    assert "alice@example.com" not in str(events)

    # Webhook deliveries logged for test + CI gate events
    deliv_res = session_client.get(f"/api/v1/workspaces/{ws.id}/webhooks/{wh['id']}/deliveries")
    assert deliv_res.status_code == 200
    assert len(deliv_res.json()) >= 3

    # 5. Revoke PAT -> immediate 401
    rev_res = session_client.delete(f"/api/v1/workspaces/{ws.id}/tokens/{tok_data['id']}")
    assert rev_res.status_code == 204
    after_rev = pat_client.get(f"/api/v1/workspaces/{ws.id}/audit-logs")
    assert after_rev.status_code == 401
    assert AuditEvent.objects.filter(workspace=ws, action="pat.revoked").exists()
