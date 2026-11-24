"""Initial migration for TransformationRecipe and PipelineRun."""

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
            name="TransformationRecipe",
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
                ("steps", models.JSONField(default=list)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="created_recipes",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "project",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="recipes",
                        to="projects.project",
                    ),
                ),
            ],
            options={
                "ordering": ["-updated_at", "-id"],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("project", "name"),
                        name="unique_recipe_name_per_project",
                    )
                ],
            },
        ),
        migrations.CreateModel(
            name="PipelineRun",
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
                ("steps", models.JSONField(default=list)),
                (
                    "status",
                    models.CharField(
                        choices=[("previewed", "Previewed"), ("applied", "Applied")],
                        default="previewed",
                        max_length=12,
                    ),
                ),
                ("source_sha256", models.CharField(max_length=64)),
                ("preview_summary", models.JSONField(default=dict)),
                ("validation", models.JSONField(default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("applied_at", models.DateTimeField(blank=True, null=True)),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="pipeline_runs",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "recipe",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="runs",
                        to="pipelines.transformationrecipe",
                    ),
                ),
                (
                    "result_dataset",
                    models.OneToOneField(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="derived_by_pipeline",
                        to="datasets.dataset",
                    ),
                ),
                (
                    "source_dataset",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="pipeline_runs",
                        to="datasets.dataset",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-id"],
                "indexes": [
                    models.Index(
                        fields=["source_dataset", "created_at"],
                        name="pipeline_run_source_created",
                    )
                ],
            },
        ),
    ]
