"""Evidence-grounded AI reports. Suggestions never modify source datasets."""

import uuid

from django.conf import settings
from django.db import models


class AIReport(models.Model):
    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        PROCESSING = "processing", "Processing"
        READY = "ready", "Ready"
        FAILED = "failed", "Failed"

    class Technique(models.TextChoices):
        ZERO_SHOT = "zero_shot", "Zero-shot"
        FEW_SHOT = "few_shot", "Few-shot"
        STEPWISE = "stepwise", "Structured reasoning"
        ROLE_BASED = "role_based", "Role-based"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    dataset = models.ForeignKey(
        "datasets.Dataset", related_name="ai_reports", on_delete=models.CASCADE
    )
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="ai_reports",
        on_delete=models.SET_NULL, null=True,
    )
    status = models.CharField(
        max_length=16, choices=Status.choices, default=Status.QUEUED
    )
    technique = models.CharField(max_length=16, choices=Technique.choices)
    model = models.CharField(max_length=48)
    thinking_level = models.CharField(max_length=12, default="low")
    temperature = models.DecimalField(max_digits=3, decimal_places=2, null=True)
    max_output_tokens = models.PositiveIntegerField(default=2048)
    profile_digest = models.CharField(max_length=64)
    result = models.JSONField(default=dict)
    error_code = models.CharField(max_length=48, blank=True)
    consent_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["dataset", "created_at"], name="ai_report_dataset_created")]
