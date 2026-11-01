
"""Asynchronous admission of project dataset originals."""

import logging

from celery import shared_task
from django.utils import timezone

from .ingestion import AdmissionError, inspect_csv
from .models import Dataset

logger = logging.getLogger(__name__)


def _fail(dataset_id: str, code: str) -> bool:
    """Finalize an active dataset with a safe failure code."""
    updated = Dataset.objects.filter(
        pk=dataset_id,
        status=Dataset.Status.PROCESSING,
    ).update(
        status=Dataset.Status.FAILED,
        error_code=code,
        processing_started_at=None,
        completed_at=timezone.now(),
    )

    return bool(updated)


@shared_task(
    bind=True,
    name="datasets.ingest_csv",
    max_retries=3,
    ignore_result=True,
)
def ingest_dataset(self, dataset_id: str) -> str:
    """Claim, validate, and finalize a queued dataset."""
    claimed = Dataset.objects.filter(
        pk=dataset_id,
        status=Dataset.Status.QUEUED,
    ).update(
        status=Dataset.Status.PROCESSING,
        processing_started_at=timezone.now(),
        error_code="",
        completed_at=None,
    )

    if not claimed:
        return "skipped"

    dataset = Dataset.objects.get(pk=dataset_id)

    try:
        summary = inspect_csv(dataset)

    except AdmissionError as exc:
        return (
            "failed"
            if _fail(dataset_id, exc.code)
            else "superseded"
        )

    except (OSError, ValueError) as exc:
        if self.request.retries < self.max_retries:
            released = Dataset.objects.filter(
                pk=dataset_id,
                status=Dataset.Status.PROCESSING,
            ).update(
                status=Dataset.Status.QUEUED,
                processing_started_at=None,
            )

            if not released:
                return "superseded"

            raise self.retry(
                exc=exc,
                countdown=15 * (2 ** self.request.retries),
            ) from exc

        return (
            "failed"
            if _fail(dataset_id, "source_unavailable")
            else "superseded"
        )

    except Exception:
        logger.exception(
            "Unexpected CSV admission error for %s",
            dataset_id,
        )

        return (
            "failed"
            if _fail(dataset_id, "processing_error")
            else "superseded"
        )

    updated = Dataset.objects.filter(
        pk=dataset_id,
        status=Dataset.Status.PROCESSING,
    ).update(
        status=Dataset.Status.READY,
        row_count=summary.row_count,
        column_count=len(summary.columns),
        columns=summary.columns,
        error_code="",
        processing_started_at=None,
        completed_at=timezone.now(),
    )

    return "ready" if updated else "superseded"
