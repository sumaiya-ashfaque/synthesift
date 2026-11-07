
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        (
            "datasets",
            "0002_dataset_processing_started_at",
        ),
    ]

    operations = [
        migrations.CreateModel(
            name="DatasetProfile",
            fields=[
                (
                    "dataset",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        primary_key=True,
                        related_name="profile",
                        serialize=False,
                        to="datasets.dataset",
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("queued", "Queued"),
                            ("processing", "Processing"),
                            ("ready", "Ready"),
                            ("failed", "Failed"),
                        ],
                        default="queued",
                        max_length=16,
                    ),
                ),
                (
                    "schema_version",
                    models.PositiveSmallIntegerField(
                        default=1,
                    ),
                ),
                (
                    "result",
                    models.JSONField(default=dict),
                ),
                (
                    "error_code",
                    models.CharField(
                        blank=True,
                        max_length=40,
                    ),
                ),
                (
                    "started_at",
                    models.DateTimeField(
                        blank=True,
                        null=True,
                    ),
                ),
                (
                    "completed_at",
                    models.DateTimeField(
                        blank=True,
                        null=True,
                    ),
                ),
                (
                    "created_at",
                    models.DateTimeField(
                        auto_now_add=True,
                    ),
                ),
                (
                    "updated_at",
                    models.DateTimeField(
                        auto_now=True,
                    ),
                ),
            ],
        ),
    ]
