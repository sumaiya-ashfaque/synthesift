"""Persisted Data Contracts and audited Contract Gate evaluation runs."""

import uuid

from django.conf import settings
from django.db import models


class DataContract(models.Model):
    """Reusable, YAML-exportable quality contract scoped to a project."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        "projects.Project",
        on_delete=models.CASCADE,
        related_name="data_contracts",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_contracts",
    )
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True, default="")
    version = models.PositiveIntegerField(default=1)
    rules = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["project", "name"],
                name="unique_contract_name_per_project",
            )
        ]


class ContractRun(models.Model):
    """Immutable audit record of evaluating a DataContract against a Dataset."""

    class Status(models.TextChoices):
        PASSED = "passed", "Passed"
        WARNING = "warning", "Warning"
        FAILED = "failed", "Failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    contract = models.ForeignKey(
        "contracts_engine.DataContract",
        on_delete=models.CASCADE,
        related_name="runs",
    )
    dataset = models.ForeignKey(
        "datasets.Dataset",
        on_delete=models.CASCADE,
        related_name="contract_runs",
    )
    triggered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="contract_runs",
    )
    status = models.CharField(max_length=12, choices=Status.choices)
    passed_rules = models.PositiveIntegerField(default=0)
    failed_rules = models.PositiveIntegerField(default=0)
    total_rules = models.PositiveIntegerField(default=0)
    pass_rate = models.FloatField(default=0.0)
    results = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(
                fields=["dataset", "created_at"],
                name="contract_run_dataset_created",
            ),
        ]
