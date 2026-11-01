import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("projects", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="Dataset",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("filename", models.CharField(max_length=255)),
                (
                    "storage_key",
                    models.CharField(max_length=120, unique=True),
                ),
                ("sha256", models.CharField(max_length=64)),
                (
                    "size_bytes",
                    models.PositiveBigIntegerField(),
                ),
                (
                    "status",
                    models.CharField(
                        max_length=16,
                        default="queued",
                        choices=[
                            ("queued", "Queued"),
                            ("processing", "Processing"),
                            ("ready", "Ready"),
                            ("failed", "Failed"),
                        ],
                    ),
                ),
                (
                    "row_count",
                    models.PositiveIntegerField(
                        null=True,
                        blank=True,
                    ),
                ),
                (
                    "column_count",
                    models.PositiveIntegerField(
                        null=True,
                        blank=True,
                    ),
                ),
                ("columns", models.JSONField(default=list)),
                (
                    "error_code",
                    models.CharField(
                        max_length=40,
                        blank=True,
                    ),
                ),
                (
                    "created_at",
                    models.DateTimeField(auto_now_add=True),
                ),
                (
                    "completed_at",
                    models.DateTimeField(
                        null=True,
                        blank=True,
                    ),
                ),
                (
                    "project",
                    models.ForeignKey(
                        to="projects.project",
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="datasets",
                    ),
                ),
                (
                    "uploaded_by",
                    models.ForeignKey(
                        to=settings.AUTH_USER_MODEL,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="uploaded_datasets",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-id"],
            },
        ),
        migrations.AddIndex(
            model_name="dataset",
            index=models.Index(
                fields=["project", "created_at"],
                name="dataset_project_created",
            ),
        ),
    ]