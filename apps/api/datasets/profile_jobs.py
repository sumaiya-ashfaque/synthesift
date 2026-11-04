
"""Persist deterministic profiling results for admitted datasets."""

import csv
import logging

from django.utils import timezone

from .ingestion import AdmissionError
from .models import Dataset, DatasetProfile
from .profiling import profile_dataset

logger = logging.getLogger(__name__)


def _fail_profile(dataset_id: str, code: str) -> str:
    updated = DatasetProfile.objects.filter(
        dataset_id=dataset_id,
        status=DatasetProfile.Status.PROCESSING,
    ).update(
        status=DatasetProfile.Status.FAILED,
        result={},
        error_code=code,
        started_at=None,
        completed_at=timezone.now(),
    )

    return "failed" if updated else "superseded"


def process_profile(dataset_id: str) -> str:
    """Claim and persist one queued profile exactly once."""
    record = (
        DatasetProfile.objects.select_related("dataset")
        .filter(dataset_id=dataset_id)
        .first()
    )

    if record is None:
        return "skipped"

    if record.dataset.status != Dataset.Status.READY:
        return "skipped"

    claimed = DatasetProfile.objects.filter(
        dataset_id=dataset_id,
        status=DatasetProfile.Status.QUEUED,
    ).update(
        status=DatasetProfile.Status.PROCESSING,
        started_at=timezone.now(),
        completed_at=None,
        error_code="",
    )

    if not claimed:
        return "skipped"

    try:
        summary = profile_dataset(record.dataset)

    except AdmissionError as exc:
        return _fail_profile(dataset_id, exc.code)

    except (OSError, UnicodeError, ValueError, csv.Error):
        logger.exception(
            "CSV profiling source error for dataset %s",
            dataset_id,
        )
        return _fail_profile(
            dataset_id,
            "profile_source_error",
        )

    except Exception:
        logger.exception(
            "Unexpected profiling failure for dataset %s",
            dataset_id,
        )
        return _fail_profile(
            dataset_id,
            "profile_error",
        )

    updated = DatasetProfile.objects.filter(
        dataset_id=dataset_id,
        status=DatasetProfile.Status.PROCESSING,
    ).update(
        status=DatasetProfile.Status.READY,
        schema_version=1,
        result=summary,
        error_code="",
        started_at=None,
        completed_at=timezone.now(),
    )

    return "ready" if updated else "superseded"
