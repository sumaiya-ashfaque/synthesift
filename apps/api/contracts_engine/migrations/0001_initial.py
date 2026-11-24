"""Initial migration for DataContract and ContractRun."""

import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ("datasets", "0005_dataset_file_format"),
        ("projects", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="DataContract",
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
                ("name", models.CharField(max_length=120)),
                ("description", models.TextField(blank=True, default="")),
                ("version", models.PositiveIntegerField(default=1)),
                ("rules", models.JSONField(default=list)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="created_contracts",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "project",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="data_contracts",
                        to="projects.project",
                    ),
                ),
            ],
            options={
                "ordering": ["-updated_at", "-id"],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("project", "name"),
                        name="unique_contract_name_per_project",
                    )
                ],
            },
        ),
        migrations.CreateModel(
            name="ContractRun",
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
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("passed", "Passed"),
                            ("warning", "Warning"),
                            ("failed", "Failed"),
                        ],
                        max_length=12,
                    ),
                ),
                ("passed_rules", models.PositiveIntegerField(default=0)),
                ("failed_rules", models.PositiveIntegerField(default=0)),
                ("total_rules", models.PositiveIntegerField(default=0)),
                ("pass_rate", models.FloatField(default=0.0)),
                ("results", models.JSONField(default=list)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "contract",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="runs",
                        to="contracts_engine.datacontract",
                    ),
                ),
                (
                    "dataset",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="contract_runs",
                        to="datasets.dataset",
                    ),
                ),
                (
                    "triggered_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="contract_runs",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-id"],
                "indexes": [
                    models.Index(
                        fields=("dataset", "created_at"),
                        name="contract_run_dataset_created",
                    )
                ],
            },
        ),
    ]
