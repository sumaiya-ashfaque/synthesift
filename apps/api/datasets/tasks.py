
"""Asynchronous admission of project dataset originals."""

import logging

from celery import shared_task
from django.utils import timezone

from .ingestion import AdmissionError, inspect_csv
from .models import Dataset

logger = logging.getLogger(__name__)


def _fail(dataset_id: str, code: str) -> None:
    Dataset.objects.filter(
        pk=dataset_id,
        status=Dataset.Status.PROCESSING,
    ).update(
        status=Dataset.Status.FAILED,
        error_code=code,
        completed_at=timezone.now(),
    )


@shared_task(
    bind=True,
    name="datasets.ingest_csv",
    max_retries=3,
    ignore_result=True,
)
def ingest_dataset(self, dataset_id: str) -> str:
    claimed = Dataset.objects.filter(
        pk=dataset_id,
        status=Dataset.Status.QUEUED,
    ).update(
        status=Dataset.Status.PROCESSING,
        error_code="",
        completed_at=None,
    )

    if not claimed:
        return "skipped"

    dataset = Dataset.objects.get(pk=dataset_id)

    try:
        summary = inspect_csv(dataset)

    except AdmissionError as exc:
        _fail(dataset_id, exc.code)
        return "failed"

    except (OSError, ValueError) as exc:
        if self.request.retries < self.max_retries:
            Dataset.objects.filter(
                pk=dataset_id,
                status=Dataset.Status.PROCESSING,
            ).update(status=Dataset.Status.QUEUED)

            raise self.retry(
                exc=exc,
                countdown=15 * (2 ** self.request.retries),
            ) from exc

        _fail(dataset_id, "source_unavailable")
        return "failed"

    except Exception:
        logger.exception(
            "Unexpected CSV admission error for %s",
            dataset_id,
        )
        _fail(dataset_id, "processing_error")
        return "failed"

    Dataset.objects.filter(
        pk=dataset_id,
        status=Dataset.Status.PROCESSING,
    ).update(
        status=Dataset.Status.READY,
        row_count=summary.row_count,
        column_count=len(summary.columns),
        columns=summary.columns,
        error_code="",
        completed_at=timezone.now(),
    )

    return "ready"
