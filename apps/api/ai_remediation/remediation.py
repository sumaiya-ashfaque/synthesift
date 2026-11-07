"""Bounded, deterministic reviewable CSV transformations; never execute LLM text."""

import csv
import hashlib
import io
from dataclasses import dataclass

from django.conf import settings

from datasets.ingestion import inspect_csv
from datasets.storage import storage_path


ALLOWED_OPERATIONS = ("trim_whitespace", "remove_exact_duplicates")


class RemediationError(Exception):
    """Safe user-facing error code for a rejected operation."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class TransformOutput:
    content: bytes
    summary: dict


def validate_operations(value: object) -> list[str]:
    if (
        not isinstance(value, list)
        or not 1 <= len(value) <= 2
        or any(not isinstance(op, str) or op not in ALLOWED_OPERATIONS for op in value)
        or len(value) != len(set(value))
    ):
        raise RemediationError("unsupported_operations")
    # Explicit order ensures that preview and apply are reproducible.
    return [op for op in ALLOWED_OPERATIONS if op in value]


def _metrics(rows: list[list[str]]) -> dict[str, int]:
    seen = set()
    duplicates = 0
    for row in rows:
        key = tuple(row)
        if key in seen:
            duplicates += 1
        seen.add(key)
    return {
        "rows": len(rows),
        "missing_cells": sum(not cell.strip() for row in rows for cell in row),
        "exact_duplicates": duplicates,
    }


def transform_dataset(dataset, operations: list[str]) -> TransformOutput:
    """Revalidate original hash and return a derived CSV plus aggregate comparison.

    Input bytes are read only from the trusted stored key. No raw rows are logged,
    sent to Gemini, or returned by the preview API.
    """
    operations = validate_operations(operations)
    # The existing admission engine enforces UTF-8, structural, size and hash limits.
    validated = inspect_csv(dataset)
    path = storage_path(dataset.storage_key)
    maximum = settings.DATASET_MAX_UPLOAD_BYTES
    if path.stat().st_size > maximum:
        raise RemediationError("source_too_large")
    original = path.read_bytes()
    if hashlib.sha256(original).hexdigest() != dataset.sha256:
        raise RemediationError("source_changed")

    try:
        reader = csv.reader(io.StringIO(original.decode("utf-8-sig"), newline=""), strict=True)
        header = next(reader)
        rows = list(reader)
    except (csv.Error, UnicodeError, StopIteration) as exc:
        raise RemediationError("source_invalid") from exc
    if len(header) != len(validated.columns) or len(rows) != validated.row_count:
        raise RemediationError("source_changed")
    if any(len(row) != len(header) for row in rows):
        raise RemediationError("source_invalid")

    before = _metrics(rows)
    changed_cells = 0
    if "trim_whitespace" in operations:
        trimmed = []
        for row in rows:
            updated = [value.strip() for value in row]
            changed_cells += sum(a != b for a, b in zip(row, updated, strict=True))
            trimmed.append(updated)
        rows = trimmed

    removed = 0
    if "remove_exact_duplicates" in operations:
        seen = set()
        unique = []
        for row in rows:
            key = tuple(row)
            if key in seen:
                removed += 1
                continue
            seen.add(key)
            unique.append(row)
        rows = unique

    after = _metrics(rows)
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(header)
    writer.writerows(rows)
    output = buffer.getvalue().encode("utf-8")
    if len(output) > maximum:
        raise RemediationError("derived_too_large")

    summary = {
        "before": before,
        "after": after,
        "columns": len(header),
        "changed_cells": changed_cells,
        "removed_duplicate_rows": removed,
        "operations": operations,
        "output_sha256": hashlib.sha256(output).hexdigest(),
        "output_size_bytes": len(output),
        "warnings": [
            "A lower duplicate count is not proof that repeated records were erroneous.",
            "Trimming whitespace can change identifiers or intentionally formatted values.",
        ],
    }
    return TransformOutput(content=output, summary=summary)
