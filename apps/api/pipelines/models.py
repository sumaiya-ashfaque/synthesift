"""Reusable transformation recipes and audited pipeline execution lineage."""

import uuid

from django.conf import settings
from django.db import models


class TransformationRecipe(models.Model):
    """Named, reusable multi-step DSL cleaning recipe scoped to a project."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        "projects.Project",
        on_delete=models.CASCADE,
        related_name="recipes",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_recipes",
    )
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True, default="")
    steps = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["project", "name"],
                name="unique_recipe_name_per_project",
            )
        ]


class PipelineRun(models.Model):
    """Audited preview and immutable materialization of a multi-step transformation plan."""

    class Status(models.TextChoices):
        PREVIEWED = "previewed", "Previewed"
        APPLIED = "applied", "Applied"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    source_dataset = models.ForeignKey(
        "datasets.Dataset",
        on_delete=models.CASCADE,
        related_name="pipeline_runs",
    )
    recipe = models.ForeignKey(
        "pipelines.TransformationRecipe",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="runs",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="pipeline_runs",
    )
    steps = models.JSONField(default=list)
    status = models.CharField(
        max_length=12,
        choices=Status.choices,
        default=Status.PREVIEWED,
    )
    source_sha256 = models.CharField(max_length=64)
    preview_summary = models.JSONField(default=dict)
    validation = models.JSONField(default=dict)
    result_dataset = models.OneToOneField(
        "datasets.Dataset",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="derived_by_pipeline",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    applied_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(
                fields=["source_dataset", "created_at"],
                name="pipeline_run_source_created",
            ),
        ]
