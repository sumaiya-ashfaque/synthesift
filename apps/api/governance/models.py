"""Enterprise governance models: Personal Access Tokens, Audit Trail, and Signed Webhooks."""

from __future__ import annotations

import hashlib
import secrets
import uuid

from django.conf import settings
from django.db import models

PAT_SCOPES = frozenset({"read", "write", "gate:run"})

SUPPORTED_WEBHOOK_EVENTS = frozenset(
    {
        "ci_gate.passed",
        "ci_gate.failed",
        "contract.failed",
        "drift.detected",
        "pipeline.applied",
        "webhook.test",
    }
)


def hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def generate_pat() -> tuple[str, str, str]:
    """Generate a high-entropy workspace Personal Access Token.

    Returns (raw_token, display_prefix, sha256_hash). Raw token is displayed once and never persisted.
    """
    raw = f"ss_pat_{secrets.token_urlsafe(32)}"
    prefix = raw[:15]
    return raw, prefix, hash_token(raw)


def generate_webhook_secret() -> str:
    return f"whsec_{secrets.token_hex(24)}"


class PersonalAccessToken(models.Model):
    """SHA-256 hashed workspace-scoped API token for headless CI/CD pipelines."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        "identity.Workspace", on_delete=models.CASCADE, related_name="access_tokens"
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="access_tokens"
    )
    name = models.CharField(max_length=120)
    token_prefix = models.CharField(max_length=20)
    token_hash = models.CharField(max_length=64, unique=True, db_index=True)
    scopes = models.JSONField(default=list)
    expires_at = models.DateTimeField(null=True, blank=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["workspace", "revoked_at"], name="pat_workspace_revoked"),
        ]


class AuditEvent(models.Model):
    """Append-only workspace governance audit log (zero raw dataset values)."""

    class Outcome(models.TextChoices):
        SUCCESS = "success", "Success"
        WARNING = "warning", "Warning"
        BLOCKED = "blocked", "Blocked"
        FAILED = "failed", "Failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        "identity.Workspace", on_delete=models.CASCADE, related_name="audit_events"
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_events",
    )
    actor_label = models.CharField(max_length=150, default="system")
    action = models.CharField(max_length=80)
    resource_type = models.CharField(max_length=60)
    resource_id = models.CharField(max_length=80, blank=True, default="")
    outcome = models.CharField(max_length=16, choices=Outcome.choices, default=Outcome.SUCCESS)
    metadata = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["workspace", "-created_at"], name="audit_ws_created"),
            models.Index(fields=["workspace", "action"], name="audit_ws_action"),
        ]


class WebhookEndpoint(models.Model):
    """Workspace-scoped outbound webhook destination signed with HMAC-SHA256."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        "identity.Workspace", on_delete=models.CASCADE, related_name="webhooks"
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_webhooks",
    )
    name = models.CharField(max_length=120)
    url = models.URLField(max_length=500)
    signing_secret = models.CharField(max_length=64, default=generate_webhook_secret)
    events = models.JSONField(default=list)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]


class WebhookDelivery(models.Model):
    """Recorded delivery attempt and HMAC signature telemetry for outbound webhooks."""

    class Status(models.TextChoices):
        DELIVERED = "delivered", "Delivered"
        FAILED = "failed", "Failed"
        DRY_RUN = "dry_run", "Dry Run"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    endpoint = models.ForeignKey(
        WebhookEndpoint, on_delete=models.CASCADE, related_name="deliveries"
    )
    event_type = models.CharField(max_length=60)
    status = models.CharField(max_length=16, choices=Status.choices)
    http_status = models.IntegerField(null=True, blank=True)
    response_excerpt = models.CharField(max_length=300, blank=True, default="")
    payload_summary = models.JSONField(default=dict)
    duration_ms = models.FloatField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
