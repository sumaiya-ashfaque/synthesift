import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import governance.models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ("identity", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="PersonalAccessToken",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("name", models.CharField(max_length=120)),
                ("token_prefix", models.CharField(max_length=20)),
                ("token_hash", models.CharField(db_index=True, max_length=64, unique=True)),
                ("scopes", models.JSONField(default=list)),
                ("expires_at", models.DateTimeField(blank=True, null=True)),
                ("last_used_at", models.DateTimeField(blank=True, null=True)),
                ("revoked_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "created_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="access_tokens",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "workspace",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="access_tokens",
                        to="identity.workspace",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at"],
                "indexes": [models.Index(fields=["workspace", "revoked_at"], name="pat_workspace_revoked")],
            },
        ),
        migrations.CreateModel(
            name="AuditEvent",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("actor_label", models.CharField(default="system", max_length=150)),
                ("action", models.CharField(max_length=80)),
                ("resource_type", models.CharField(max_length=60)),
                ("resource_id", models.CharField(blank=True, default="", max_length=80)),
                (
                    "outcome",
                    models.CharField(
                        choices=[
                            ("success", "Success"),
                            ("warning", "Warning"),
                            ("blocked", "Blocked"),
                            ("failed", "Failed"),
                        ],
                        default="success",
                        max_length=16,
                    ),
                ),
                ("metadata", models.JSONField(default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "actor",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="audit_events",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "workspace",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="audit_events",
                        to="identity.workspace",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at"],
                "indexes": [
                    models.Index(fields=["workspace", "-created_at"], name="audit_ws_created"),
                    models.Index(fields=["workspace", "action"], name="audit_ws_action"),
                ],
            },
        ),
        migrations.CreateModel(
            name="WebhookEndpoint",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("name", models.CharField(max_length=120)),
                ("url", models.URLField(max_length=500)),
                (
                    "signing_secret",
                    models.CharField(default=governance.models.generate_webhook_secret, max_length=64),
                ),
                ("events", models.JSONField(default=list)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="created_webhooks",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "workspace",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="webhooks",
                        to="identity.workspace",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="WebhookDelivery",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("event_type", models.CharField(max_length=60)),
                (
                    "status",
                    models.CharField(
                        choices=[("delivered", "Delivered"), ("failed", "Failed"), ("dry_run", "Dry Run")],
                        max_length=16,
                    ),
                ),
                ("http_status", models.IntegerField(blank=True, null=True)),
                ("response_excerpt", models.CharField(blank=True, default="", max_length=300)),
                ("payload_summary", models.JSONField(default=dict)),
                ("duration_ms", models.FloatField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "endpoint",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="deliveries",
                        to="governance.webhookendpoint",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
    ]
