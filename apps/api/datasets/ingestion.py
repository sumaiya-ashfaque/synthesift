
"""Strict, bounded CSV inspection of immutable dataset originals."""

import csv
import hashlib
from dataclasses import dataclass

from django.conf import settings

from .storage import storage_path


class AdmissionError(Exception):
    """Safe error code for invalid dataset content."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class CSVSummary:
    row_count: int
    columns: list[str]


def inspect_csv(dataset) -> CSVSummary:
    """Verify source integrity and CSV structure without loading all rows."""
    path = storage_path(dataset.storage_key)
    digest = hashlib.sha256()
    size = 0

    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            size += len(chunk)

            if size > settings.DATASET_MAX_UPLOAD_BYTES:
                raise AdmissionError("source_too_large")

            digest.update(chunk)

    if size != dataset.size_bytes or digest.hexdigest() != dataset.sha256:
        raise AdmissionError("integrity_mismatch")

    previous_limit = csv.field_size_limit()
    csv.field_size_limit(settings.DATASET_MAX_CELL_CHARS)

    try:
        with path.open("r", encoding="utf-8-sig", newline="") as source:
            reader = csv.reader(source, strict=True)
            raw_header = next(reader, None)

            if not raw_header:
                raise AdmissionError("missing_header")

            columns = [item.strip() for item in raw_header]

            if len(columns) > settings.DATASET_MAX_COLUMNS:
                raise AdmissionError("too_many_columns")

            if any(not item or "\x00" in item for item in columns):
                raise AdmissionError("invalid_header")

            if len({item.casefold() for item in columns}) != len(columns):
                raise AdmissionError("duplicate_header")

            count = 0

            for row in reader:
                if len(row) != len(columns):
                    raise AdmissionError("inconsistent_columns")

                if any("\x00" in value for value in row):
                    raise AdmissionError("invalid_cell")

                count += 1

                if count > settings.DATASET_MAX_ROWS:
                    raise AdmissionError("too_many_rows")

            if count == 0:
                raise AdmissionError("no_data_rows")

            return CSVSummary(
                row_count=count,
                columns=columns,
            )

    except UnicodeError as exc:
        raise AdmissionError("invalid_utf8") from exc

    except csv.Error as exc:
        raise AdmissionError("malformed_csv") from exc

    finally:
        csv.field_size_limit(previous_limit)
