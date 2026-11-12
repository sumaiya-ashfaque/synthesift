"""Authorized hard deletion with transactional, retryable source-file cleanup.

Database rows are deleted first. File keys are queued in the same transaction,
then removed after commit; a management command retries interrupted cleanup.
"""

import logging

from django.db import transaction
from django.db.models import Q
from rest_framework.exceptions import APIException

from .models import Dataset, DatasetProfile, StoredFileDeletion
from .storage import storage_path

logger = logging.getLogger(__name__)


class DeletionConflict(APIException):
    status_code = 409
    default_code = "deletion_conflict"
    default_detail = "This resource cannot be deleted while a data or AI job is running."


def _dataset_closure(seed_ids: set) -> set:
    """Include derived outputs of source datasets, recursively."""
    from ai_remediation.models import RemediationRun

    ids = set(seed_ids)
    while ids:
        descendants = set(
            RemediationRun.objects.filter(dataset_id__in=ids)
            .exclude(result_dataset_id__isnull=True)
            .values_list("result_dataset_id", flat=True)
        )
        new_ids = descendants - ids
        if not new_ids:
            return ids
        ids.update(new_ids)
    return ids


def cleanup_pending_storage(*, limit=250, keys=None):
    """Retry a bounded number of committed storage deletions (idempotent)."""
    pending = StoredFileDeletion.objects.all().order_by("created_at", "id")
    if keys is not None:
        pending = pending.filter(storage_key__in=keys)
    succeeded = 0
    for item in pending[:limit]:
        try:
            storage_path(item.storage_key).unlink(missing_ok=True)
        except (OSError, ValueError):
            logger.exception("dataset.storage_delete_failed", extra={"deletion_id": str(item.id)})
        else:
            item.delete()
            succeeded += 1
    return succeeded


def _after_commit(keys):
    try:
        for start in range(0, len(keys), 200):
            cleanup_pending_storage(keys=keys[start:start + 200], limit=200)
    except Exception:
        # The committed queue is durable; the management command will retry.
        logger.exception("dataset.storage_delete_deferred")


def _delete_tree(*, ids: set, target, project_id=None, workspace_id=None):
    """Run inside an outer transaction with target row locked."""
    from ai_remediation.models import AIReport, RemediationRun

    ids = _dataset_closure(ids)
    datasets = list(Dataset.objects.select_related("project").select_for_update().filter(id__in=ids))
    if len(datasets) != len(ids):
        raise DeletionConflict("Related datasets changed. Refresh and retry.")
    if project_id is not None and any(item.project_id != project_id for item in datasets):
        raise DeletionConflict("Derived data belongs to another project and cannot be deleted here.")
    if workspace_id is not None and any(item.project.workspace_id != workspace_id for item in datasets):
        raise DeletionConflict("Derived data belongs to another workspace and cannot be deleted here.")

    if any(item.status in (Dataset.Status.QUEUED, Dataset.Status.PROCESSING) for item in datasets):
        raise DeletionConflict("Dataset ingestion is in progress. Retry once it finishes.")
    if DatasetProfile.objects.filter(
        dataset_id__in=ids, status__in=("queued", "processing")
    ).exists():
        raise DeletionConflict("Dataset profiling is in progress. Retry once it finishes.")
    if AIReport.objects.filter(
        dataset_id__in=ids, status__in=("queued", "processing")
    ).exists():
        raise DeletionConflict("AI analysis is in progress. Retry once it finishes.")

    keys = sorted({record.storage_key for record in datasets})
    for key in keys:
        StoredFileDeletion.objects.get_or_create(storage_key=key)

    # RemediationRun.report uses PROTECT; remove runs before their AI reports.
    RemediationRun.objects.filter(
        Q(dataset_id__in=ids) | Q(result_dataset_id__in=ids) | Q(report__dataset_id__in=ids)
    ).delete()
    target(ids)
    if keys:
        transaction.on_commit(lambda: _after_commit(keys))


def delete_dataset(dataset):
    with transaction.atomic():
        record = Dataset.objects.select_for_update().get(pk=dataset.pk)
        _delete_tree(
            ids={record.pk},
            project_id=record.project_id,
            target=lambda selected_ids: Dataset.objects.filter(pk__in=selected_ids).delete(),
        )


def delete_project(project):
    from projects.models import Project

    with transaction.atomic():
        record = Project.objects.select_for_update().get(pk=project.pk)
        ids = set(Dataset.objects.filter(project=record).values_list("pk", flat=True))
        _delete_tree(ids=ids, target=lambda _selected_ids: record.delete(), project_id=record.pk)


def delete_workspace(workspace):
    from identity.models import Workspace

    with transaction.atomic():
        record = Workspace.objects.select_for_update().get(pk=workspace.pk)
        ids = set(
            Dataset.objects.filter(project__workspace=record).values_list("pk", flat=True)
        )
        _delete_tree(ids=ids, target=lambda _selected_ids: record.delete(), workspace_id=record.pk)
