import uuid

from django.conf import settings
from django.db import models


class Dataset(models.Model):
    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        PROCESSING = "processing", "Processing"
        READY = "ready", "Ready"
        FAILED = "failed", "Failed"

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )

    project = models.ForeignKey(
        "projects.Project",
        on_delete=models.CASCADE,
        related_name="datasets",
    )

    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="uploaded_datasets",
    )

    filename = models.CharField(max_length=255)

    storage_key = models.CharField(
        max_length=120,
        unique=True,
    )

    sha256 = models.CharField(max_length=64)
    size_bytes = models.PositiveBigIntegerField()

    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.QUEUED,
    )

    row_count = models.PositiveIntegerField(
        null=True,
        blank=True,
    )

    column_count = models.PositiveIntegerField(
        null=True,
        blank=True,
    )

    columns = models.JSONField(default=list)

    error_code = models.CharField(
        max_length=40,
        blank=True,
    )

    created_at = models.DateTimeField(auto_now_add=True)

    completed_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    processing_started_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(
                fields=["project", "created_at"],
                name="dataset_project_created",
            ),
        ]