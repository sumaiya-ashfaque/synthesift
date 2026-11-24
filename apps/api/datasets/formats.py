"""Bounded, integrity-verified multi-format tabular readers and DuckDB/Polars bridge."""

from __future__ import annotations

import csv
import hashlib
import json
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any

import duckdb
import openpyxl
import polars as pl
from django.conf import settings

from .storage import infer_file_format, storage_path


class AdmissionError(Exception):
    """Safe error code for invalid dataset content."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class CSVSummary:
    row_count: int
    columns: list[str]
    file_format: str = "csv"


def verify_source_integrity(dataset) -> Path:
    """Verify file existence, size bound, and SHA-256 checksum on disk."""
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

    return path


def resolve_format(dataset) -> str:
    """Determine the canonical format of a dataset record."""
    fmt = getattr(dataset, "file_format", "") or ""
    if fmt in {"csv", "tsv", "parquet", "xlsx", "json", "ndjson"}:
        return fmt
    try:
        return infer_file_format(dataset.storage_key)
    except ValueError:
        return "csv"


def _validate_header(raw_header: list[str]) -> list[str]:
    if not raw_header:
        raise AdmissionError("missing_header")

    columns = [item.strip() for item in raw_header]

    if len(columns) > settings.DATASET_MAX_COLUMNS:
        raise AdmissionError("too_many_columns")

    if any(not item or "\x00" in item for item in columns):
        raise AdmissionError("invalid_header")

    if len({item.casefold() for item in columns}) != len(columns):
        raise AdmissionError("duplicate_header")

    return columns


def _stringify_cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    text = str(value)
    if "\x00" in text:
        raise AdmissionError("invalid_cell")
    if len(text) > settings.DATASET_MAX_CELL_CHARS:
        raise AdmissionError("invalid_cell")
    return text


def _iter_delimited(path: Path, delimiter: str) -> tuple[list[str], Iterator[list[str]]]:
    previous_limit = csv.field_size_limit()
    csv.field_size_limit(settings.DATASET_MAX_CELL_CHARS)

    def _rows() -> Iterator[list[str]]:
        try:
            with path.open("r", encoding="utf-8-sig", newline="") as source:
                reader = csv.reader(source, delimiter=delimiter, strict=True)
                raw_header = next(reader, None)
                columns = _validate_header(raw_header or [])
                col_count = len(columns)
                count = 0
                for row in reader:
                    if len(row) != col_count:
                        raise AdmissionError("inconsistent_columns")
                    if any("\x00" in value for value in row):
                        raise AdmissionError("invalid_cell")
                    count += 1
                    if count > settings.DATASET_MAX_ROWS:
                        raise AdmissionError("too_many_rows")
                    yield row
                if count == 0:
                    raise AdmissionError("no_data_rows")
        except UnicodeError as exc:
            raise AdmissionError("invalid_utf8") from exc
        except csv.Error as exc:
            raise AdmissionError("malformed_csv") from exc
        finally:
            csv.field_size_limit(previous_limit)

    # Peek header synchronously while validating file encoding/header.
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as source:
            reader = csv.reader(source, delimiter=delimiter, strict=True)
            raw_header = next(reader, None)
            columns = _validate_header(raw_header or [])
    except UnicodeError as exc:
        csv.field_size_limit(previous_limit)
        raise AdmissionError("invalid_utf8") from exc
    except csv.Error as exc:
        csv.field_size_limit(previous_limit)
        raise AdmissionError("malformed_csv") from exc
    finally:
        csv.field_size_limit(previous_limit)

    return columns, _rows()


def _load_parquet_rows(path: Path) -> tuple[list[str], list[list[str]]]:
    try:
        frame = pl.read_parquet(path)
    except Exception as exc:
        raise AdmissionError("malformed_parquet") from exc

    columns = _validate_header([str(col) for col in frame.columns])
    if frame.height == 0:
        raise AdmissionError("no_data_rows")
    if frame.height > settings.DATASET_MAX_ROWS:
        raise AdmissionError("too_many_rows")

    rows = [
        [_stringify_cell(cell) for cell in row]
        for row in frame.iter_rows()
    ]
    return columns, rows


def _load_xlsx_rows(path: Path) -> tuple[list[str], list[list[str]]]:
    wb = None
    try:
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        sheet = wb.active
        if sheet is None:
            raise AdmissionError("missing_header")
        row_iter = sheet.iter_rows(values_only=True)
        raw_header = next(row_iter, None)
        if raw_header is None:
            raise AdmissionError("missing_header")
        header_strings = ["" if cell is None else str(cell) for cell in raw_header]
        # Trim trailing empty Excel columns from header.
        while header_strings and not header_strings[-1].strip():
            header_strings.pop()
        columns = _validate_header(header_strings)
        col_count = len(columns)
        rows: list[list[str]] = []
        for raw_row in row_iter:
            padded = list(raw_row[:col_count])
            if len(padded) < col_count:
                padded.extend([None] * (col_count - len(padded)))
            string_row = [_stringify_cell(cell) for cell in padded]
            if not any(cell.strip() for cell in string_row):
                continue
            rows.append(string_row)
            if len(rows) > settings.DATASET_MAX_ROWS:
                raise AdmissionError("too_many_rows")
        if not rows:
            raise AdmissionError("no_data_rows")
        return columns, rows
    except AdmissionError:
        raise
    except Exception as exc:
        raise AdmissionError("malformed_xlsx") from exc
    finally:
        if wb is not None:
            wb.close()


def _load_json_rows(path: Path, ndjson: bool) -> tuple[list[str], list[list[str]]]:
    try:
        raw_text = path.read_text(encoding="utf-8-sig")
    except UnicodeError as exc:
        raise AdmissionError("invalid_utf8") from exc

    records: list[dict[str, Any]] = []
    try:
        if ndjson:
            for line in raw_text.splitlines():
                stripped = line.strip()
                if not stripped:
                    continue
                item = json.loads(stripped)
                if not isinstance(item, dict):
                    raise AdmissionError("malformed_json")
                records.append(item)
                if len(records) > settings.DATASET_MAX_ROWS:
                    raise AdmissionError("too_many_rows")
        else:
            parsed = json.loads(raw_text)
            if not isinstance(parsed, list):
                raise AdmissionError("malformed_json")
            if len(parsed) > settings.DATASET_MAX_ROWS:
                raise AdmissionError("too_many_rows")
            for item in parsed:
                if not isinstance(item, dict):
                    raise AdmissionError("malformed_json")
                records.append(item)
    except AdmissionError:
        raise
    except ValueError as exc:
        raise AdmissionError("malformed_json") from exc

    if not records:
        raise AdmissionError("no_data_rows")

    seen_keys: dict[str, None] = {}
    for rec in records:
        for key in rec:
            seen_keys.setdefault(str(key), None)

    columns = _validate_header(list(seen_keys.keys()))
    raw_keys = list(seen_keys.keys())
    rows = [
        [_stringify_cell(rec.get(key)) for key in raw_keys]
        for rec in records
    ]
    return columns, rows


def inspect_tabular(dataset) -> CSVSummary:
    """Verify integrity and tabular structure across all supported file formats."""
    path = verify_source_integrity(dataset)
    fmt = resolve_format(dataset)

    if fmt in {"csv", "tsv"}:
        delimiter = "\t" if fmt == "tsv" else ","
        columns, row_iter = _iter_delimited(path, delimiter)
        count = 0
        for _ in row_iter:
            count += 1
        return CSVSummary(row_count=count, columns=columns, file_format=fmt)

    if fmt == "parquet":
        columns, rows = _load_parquet_rows(path)
        return CSVSummary(row_count=len(rows), columns=columns, file_format=fmt)

    if fmt == "xlsx":
        columns, rows = _load_xlsx_rows(path)
        return CSVSummary(row_count=len(rows), columns=columns, file_format=fmt)

    if fmt in {"json", "ndjson"}:
        columns, rows = _load_json_rows(path, ndjson=(fmt == "ndjson"))
        return CSVSummary(row_count=len(rows), columns=columns, file_format=fmt)

    raise AdmissionError("unsupported_format")


def iter_tabular_rows(dataset) -> tuple[list[str], Iterator[list[str]]]:
    """Stream validated rows of strings for any supported dataset format."""
    path = verify_source_integrity(dataset)
    fmt = resolve_format(dataset)

    if fmt in {"csv", "tsv"}:
        return _iter_delimited(path, "\t" if fmt == "tsv" else ",")
    if fmt == "parquet":
        columns, rows = _load_parquet_rows(path)
        return columns, iter(rows)
    if fmt == "xlsx":
        columns, rows = _load_xlsx_rows(path)
        return columns, iter(rows)
    if fmt in {"json", "ndjson"}:
        columns, rows = _load_json_rows(path, ndjson=(fmt == "ndjson"))
        return columns, iter(rows)
    raise AdmissionError("unsupported_format")


def load_polars_frame(dataset) -> pl.DataFrame:
    """Load an integrity-verified dataset into a Polars DataFrame of strings.

    Preserves exact string representation (including leading zeros and whitespace)
    and adds an explicit 1-based `_row_index` column for stable pagination.
    """
    columns, row_iter = iter_tabular_rows(dataset)
    col_data: dict[str, list[str]] = {name: [] for name in columns}
    for row in row_iter:
        for name, cell in zip(columns, row, strict=True):
            col_data[name].append(cell)
    return pl.DataFrame(col_data, schema={name: pl.String for name in columns})


def connect_duckdb_dataset(dataset) -> tuple[duckdb.DuckDBPyConnection, list[str], int]:
    """Load an integrity-verified dataset into an isolated in-memory DuckDB table.

    Exposes a single table `dataset_rows` containing `_row_index` (1-based) plus
    all dataset columns as VARCHAR, ensuring zero filesystem access from SQL
    and requiring no PyArrow dependency.
    """
    columns, row_iter = iter_tabular_rows(dataset)
    rows = [(idx, *row) for idx, row in enumerate(row_iter, start=1)]
    conn = duckdb.connect(database=":memory:")
    quoted_defs = ['"_row_index" BIGINT'] + [
        '"' + col.replace('"', '""') + '" VARCHAR' for col in columns
    ]
    conn.execute(f"CREATE TABLE dataset_rows ({', '.join(quoted_defs)})")
    if rows:
        placeholders = ", ".join(["?"] * (len(columns) + 1))
        conn.executemany(f"INSERT INTO dataset_rows VALUES ({placeholders})", rows)
    return conn, columns, len(rows)
