"""Deterministic 15-op pipeline executor with Git-style cell diffs and multi-format export."""

from __future__ import annotations

import csv
import hashlib
import io
import math
import re
import statistics
import time
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, DecimalException
from typing import Any

import openpyxl
import polars as pl
from dateutil import parser as date_parser
from django.conf import settings

from datasets.formats import AdmissionError, iter_tabular_rows
from datasets.ingestion import inspect_csv
from datasets.pii import SENTINEL_NULLS, detect_pii_kind, is_sentinel_null, mask_cell_value

from .dsl import PipelineDSLError, validate_steps

_TRUE_SET = {"true", "yes", "1", "t", "y"}
_FALSE_SET = {"false", "no", "0", "f", "n"}


@dataclass(frozen=True)
class PipelineOutput:
    columns: list[str]
    rows: list[list[str]]
    csv_bytes: bytes
    summary: dict[str, Any]


def _table_metrics(columns: list[str], rows: list[list[str]]) -> dict[str, int]:
    seen: set[tuple[str, ...]] = set()
    duplicates = 0
    missing = 0
    whitespace = 0
    sentinels = 0
    for row in rows:
        key = tuple(row)
        if key in seen:
            duplicates += 1
        else:
            seen.add(key)
        for cell in row:
            stripped = cell.strip()
            if not stripped:
                missing += 1
            else:
                if cell != stripped:
                    whitespace += 1
                if is_sentinel_null(cell):
                    sentinels += 1
    return {
        "rows": len(rows),
        "columns": len(columns),
        "missing_cells": missing,
        "exact_duplicates": duplicates,
        "whitespace_cells": whitespace,
        "sentinel_nulls": sentinels,
    }


def _resolve_target_indices(columns: list[str], col_spec: str, step_idx: int) -> list[int]:
    if col_spec == "*":
        return list(range(len(columns)))
    if col_spec not in columns:
        raise PipelineDSLError(
            f"Step {step_idx + 1}: column '{col_spec}' does not exist at this point in the pipeline.",
            step_idx,
        )
    return [columns.index(col_spec)]


def _parse_float(value: str) -> float | None:
    stripped = value.strip()
    if not stripped:
        return None
    try:
        num = float(stripped)
        return num if math.isfinite(num) else None
    except ValueError:
        return None


def _compute_iqr_bounds(values: list[float]) -> tuple[float, float] | None:
    if len(values) < 4:
        return None
    series = pl.Series("v", values, dtype=pl.Float64)
    p25 = series.quantile(0.25, interpolation="linear")
    p75 = series.quantile(0.75, interpolation="linear")
    if p25 is None or p75 is None:
        return None
    iqr = float(p75) - float(p25)
    if iqr <= 0:
        return None
    return (round(float(p25) - 1.5 * iqr, 4), round(float(p75) + 1.5 * iqr, 4))


def _format_num(val: float, prefer_int: bool = False) -> str:
    if prefer_int and float(val).is_integer():
        return str(int(val))
    rounded = round(val, 4)
    if float(rounded).is_integer():
        return str(int(rounded))
    return f"{rounded:.4f}".rstrip("0").rstrip(".")


def _mask_for_diff(raw: str, col_name: str, pii_cols: set[str], mask_pii: bool) -> str:
    if not mask_pii or not raw.strip():
        return raw
    if col_name in pii_cols or detect_pii_kind(raw.strip()) is not None:
        masked, _ = mask_cell_value(raw, None)
        return masked
    return raw


def execute_pipeline(
    dataset,
    raw_steps: list[dict[str, Any]],
    *,
    mask_pii_in_diff: bool = True,
    max_diff_rows: int = 40,
) -> PipelineOutput:
    """Validate and deterministically run DSL steps, producing output bytes & cell diffs."""
    steps = validate_steps(raw_steps)
    validated = inspect_csv(dataset)

    try:
        header, row_iter = iter_tabular_rows(dataset)
        initial_rows = list(row_iter)
    except (AdmissionError, OSError, UnicodeError, ValueError) as exc:
        raise PipelineDSLError(f"Source dataset could not be read: {exc}") from exc

    if len(header) != len(validated.columns) or len(initial_rows) != validated.row_count:
        raise PipelineDSLError("Source dataset changed during pipeline execution.")

    # Track each row with its original 1-based row index and original column->value snapshot
    columns = list(header)
    tracked_rows: list[tuple[int, list[str]]] = [
        (idx, list(row)) for idx, row in enumerate(initial_rows, start=1)
    ]
    original_snapshots: dict[int, dict[str, str]] = {
        idx: dict(zip(header, row, strict=True))
        for idx, row in enumerate(initial_rows, start=1)
    }

    before_metrics = _table_metrics(columns, [r for _, r in tracked_rows])
    step_telemetry: list[dict[str, Any]] = []
    warnings: list[str] = []

    # Identify columns with PII in original data for safe diff previews
    pii_cols: set[str] = set()
    for col_i, col_name in enumerate(header):
        for _, row in tracked_rows[:200]:
            if detect_pii_kind(row[col_i].strip()) is not None:
                pii_cols.add(col_name)
                break

    for step_idx, step in enumerate(steps):
        t0 = time.perf_counter()
        op = step["op"]
        cells_changed = 0
        rows_removed = 0
        cols_added: list[str] = []
        cols_removed: list[str] = []
        step_note = ""

        if op == "trim_whitespace":
            indices = _resolve_target_indices(columns, step["column"], step_idx)
            side = step["side"]
            for _, row in tracked_rows:
                for ci in indices:
                    old = row[ci]
                    new = old.strip() if side == "both" else (old.lstrip() if side == "left" else old.rstrip())
                    if new != old:
                        row[ci] = new
                        cells_changed += 1

        elif op == "normalize_case":
            indices = _resolve_target_indices(columns, step["column"], step_idx)
            mode = step["mode"]
            for _, row in tracked_rows:
                for ci in indices:
                    old = row[ci]
                    if not old.strip():
                        continue
                    new = old.lower() if mode == "lower" else (old.upper() if mode == "upper" else old.title())
                    if new != old:
                        row[ci] = new
                        cells_changed += 1

        elif op == "normalize_sentinel_nulls":
            indices = _resolve_target_indices(columns, step["column"], step_idx)
            tokens = (
                {t.casefold() for t in step["tokens"]}
                if step.get("tokens")
                else SENTINEL_NULLS
            )
            for _, row in tracked_rows:
                for ci in indices:
                    old = row[ci]
                    if old and old.strip().casefold() in tokens:
                        row[ci] = ""
                        cells_changed += 1

        elif op == "replace_values":
            ci = _resolve_target_indices(columns, step["column"], step_idx)[0]
            mapping: dict[str, str] = step["mapping"]
            for _, row in tracked_rows:
                old = row[ci]
                if old in mapping and mapping[old] != old:
                    row[ci] = mapping[old]
                    cells_changed += 1

        elif op == "regex_replace":
            ci = _resolve_target_indices(columns, step["column"], step_idx)[0]
            compiled = re.compile(step["pattern"])
            repl = step["replacement"]
            for _, row in tracked_rows:
                old = row[ci]
                if not old:
                    continue
                new = compiled.sub(repl, old)
                if new != old:
                    row[ci] = new
                    cells_changed += 1

        elif op == "fill_missing":
            ci = _resolve_target_indices(columns, step["column"], step_idx)[0]
            strategy = step["strategy"]
            fill_value: str | None = None

            if strategy == "constant":
                fill_value = step["value"]
            elif strategy in {"mean", "median"}:
                nums = [v for _, r in tracked_rows if (v := _parse_float(r[ci])) is not None]
                if not nums:
                    raise PipelineDSLError(
                        f"Step {step_idx + 1}: column '{step['column']}' has no numeric values for {strategy} imputation.",
                        step_idx,
                    )
                agg = statistics.mean(nums) if strategy == "mean" else statistics.median(nums)
                fill_value = _format_num(agg)
                step_note = f"Computed {strategy}={fill_value}"
            elif strategy == "mode":
                populated = [r[ci] for _, r in tracked_rows if r[ci].strip()]
                if not populated:
                    raise PipelineDSLError(
                        f"Step {step_idx + 1}: column '{step['column']}' has no populated values for mode imputation.",
                        step_idx,
                    )
                fill_value = Counter(populated).most_common(1)[0][0]
                step_note = "Filled with modal value"

            if strategy == "ffill":
                last_seen = ""
                for _, row in tracked_rows:
                    if row[ci].strip():
                        last_seen = row[ci]
                    elif last_seen:
                        row[ci] = last_seen
                        cells_changed += 1
            else:
                assert fill_value is not None
                for _, row in tracked_rows:
                    if not row[ci].strip():
                        row[ci] = fill_value
                        cells_changed += 1

        elif op == "cast_type":
            ci = _resolve_target_indices(columns, step["column"], step_idx)[0]
            to_type = step["to_type"]
            on_error = step["on_error"]
            failed = 0
            for _, row in tracked_rows:
                raw = row[ci].strip()
                if not raw:
                    continue
                converted: str | None = None
                if to_type == "text":
                    converted = raw
                elif to_type == "integer":
                    try:
                        dec = Decimal(raw.replace(",", ""))
                        if dec.is_finite():
                            converted = str(int(dec.to_integral_value()))
                    except DecimalException:
                        converted = None
                elif to_type == "decimal":
                    try:
                        dec = Decimal(raw.replace(",", "").lstrip("$€£¥"))
                        if dec.is_finite():
                            converted = str(dec.normalize())
                    except DecimalException:
                        converted = None
                elif to_type == "boolean":
                    low = raw.casefold()
                    if low in _TRUE_SET:
                        converted = "true"
                    elif low in _FALSE_SET:
                        converted = "false"
                elif to_type == "date":
                    try:
                        parsed = date_parser.parse(raw, default=datetime(2000, 1, 1))
                        converted = parsed.date().isoformat()
                    except (ValueError, OverflowError):
                        converted = None

                if converted is None:
                    failed += 1
                    if on_error == "reject":
                        raise PipelineDSLError(
                            f"Step {step_idx + 1}: could not cast a value in '{step['column']}' to {to_type}.",
                            step_idx,
                        )
                    if on_error == "null" and row[ci] != "":
                        row[ci] = ""
                        cells_changed += 1
                elif converted != row[ci]:
                    row[ci] = converted
                    cells_changed += 1
            if failed:
                warnings.append(
                    f"cast_type on '{step['column']}': {failed} value(s) could not be parsed as {to_type} (policy: {on_error})."
                )

        elif op == "standardize_date":
            ci = _resolve_target_indices(columns, step["column"], step_idx)[0]
            out_fmt = step["output_format"]
            unparsed = 0
            for _, row in tracked_rows:
                raw = row[ci].strip()
                if not raw:
                    continue
                try:
                    parsed = date_parser.parse(raw, default=datetime(2000, 1, 1))
                    formatted = parsed.strftime(out_fmt)
                    if formatted != row[ci]:
                        row[ci] = formatted
                        cells_changed += 1
                except (ValueError, OverflowError):
                    unparsed += 1
            if unparsed:
                warnings.append(f"standardize_date on '{step['column']}': {unparsed} unparseable value(s) left unchanged.")

        elif op == "clip_numeric":
            ci = _resolve_target_indices(columns, step["column"], step_idx)[0]
            lower = step.get("min_value")
            upper = step.get("max_value")
            if step.get("use_iqr_bounds"):
                nums = [v for _, r in tracked_rows if (v := _parse_float(r[ci])) is not None]
                iqr_bounds = _compute_iqr_bounds(nums)
                if iqr_bounds is not None:
                    lower = iqr_bounds[0] if lower is None else max(lower, iqr_bounds[0])
                    upper = iqr_bounds[1] if upper is None else min(upper, iqr_bounds[1])
                    step_note = f"IQR bounds [{lower}, {upper}]"
            if lower is not None or upper is not None:
                for _, row in tracked_rows:
                    val = _parse_float(row[ci])
                    if val is None:
                        continue
                    clipped = val
                    if lower is not None and clipped < lower:
                        clipped = lower
                    if upper is not None and clipped > upper:
                        clipped = upper
                    if clipped != val:
                        row[ci] = _format_num(clipped)
                        cells_changed += 1
                warnings.append(
                    f"clip_numeric on '{step['column']}' modifies extreme values; verify outliers are errors, not true events."
                )

        elif op == "drop_duplicate_rows":
            subset = step.get("subset_columns") or []
            if subset:
                key_indices = [_resolve_target_indices(columns, c, step_idx)[0] for c in subset]
            else:
                key_indices = list(range(len(columns)))
            keep = step["keep"]
            before_n = len(tracked_rows)
            if keep == "first":
                seen_keys: set[tuple[str, ...]] = set()
                kept: list[tuple[int, list[str]]] = []
                for item in tracked_rows:
                    k = tuple(item[1][i] for i in key_indices)
                    if k in seen_keys:
                        continue
                    seen_keys.add(k)
                    kept.append(item)
                tracked_rows = kept
            else:
                seen_keys = set()
                kept_rev: list[tuple[int, list[str]]] = []
                for item in reversed(tracked_rows):
                    k = tuple(item[1][i] for i in key_indices)
                    if k in seen_keys:
                        continue
                    seen_keys.add(k)
                    kept_rev.append(item)
                tracked_rows = list(reversed(kept_rev))
            rows_removed = before_n - len(tracked_rows)

        elif op == "filter_rows":
            ci = _resolve_target_indices(columns, step["column"], step_idx)[0]
            cond = step["condition"]
            target_val = step.get("value", "")
            before_n = len(tracked_rows)
            kept = []
            for item in tracked_rows:
                cell = item[1][ci]
                stripped = cell.strip()
                keep_row = True
                if cond == "not_null":
                    keep_row = bool(stripped)
                elif cond == "is_null":
                    keep_row = not stripped
                elif cond == "eq":
                    keep_row = cell == target_val
                elif cond == "neq":
                    keep_row = cell != target_val
                elif cond == "contains":
                    keep_row = target_val.casefold() in cell.casefold()
                elif cond in {"gt", "lt"}:
                    lhs = _parse_float(cell)
                    rhs = _parse_float(target_val)
                    if lhs is None or rhs is None:
                        keep_row = False
                    else:
                        keep_row = lhs > rhs if cond == "gt" else lhs < rhs
                if keep_row:
                    kept.append(item)
            tracked_rows = kept
            rows_removed = before_n - len(tracked_rows)
            if not tracked_rows:
                raise PipelineDSLError(
                    f"Step {step_idx + 1}: filter_rows removed all rows; derived datasets must contain at least 1 row.",
                    step_idx,
                )

        elif op == "rename_column":
            ci = _resolve_target_indices(columns, step["column"], step_idx)[0]
            new_name = step["new_name"]
            if any(c.casefold() == new_name.casefold() and i != ci for i, c in enumerate(columns)):
                raise PipelineDSLError(
                    f"Step {step_idx + 1}: column '{new_name}' already exists.",
                    step_idx,
                )
            columns[ci] = new_name

        elif op == "drop_columns":
            drop_set = set(step["columns"])
            for col in step["columns"]:
                _resolve_target_indices(columns, col, step_idx)
            keep_indices = [i for i, c in enumerate(columns) if c not in drop_set]
            if not keep_indices:
                raise PipelineDSLError(
                    f"Step {step_idx + 1}: cannot drop all columns from a dataset.",
                    step_idx,
                )
            cols_removed = [c for c in columns if c in drop_set]
            columns = [columns[i] for i in keep_indices]
            tracked_rows = [(idx, [r[i] for i in keep_indices]) for idx, r in tracked_rows]

        elif op == "split_column":
            ci = _resolve_target_indices(columns, step["column"], step_idx)[0]
            delim = step["delimiter"]
            left_name, right_name = step["new_columns"]
            existing_cf = {c.casefold() for c in columns}
            if left_name.casefold() in existing_cf or right_name.casefold() in existing_cf or left_name.casefold() == right_name.casefold():
                raise PipelineDSLError(
                    f"Step {step_idx + 1}: split output column names must be unique and not already exist.",
                    step_idx,
                )
            columns.extend([left_name, right_name])
            cols_added = [left_name, right_name]
            for _, row in tracked_rows:
                parts = row[ci].split(delim, 1)
                left_val = parts[0]
                right_val = parts[1] if len(parts) > 1 else ""
                row.extend([left_val, right_val])
                cells_changed += 2

        elif op == "mask_pii":
            ci = _resolve_target_indices(columns, step["column"], step_idx)[0]
            method = step["method"]
            for _, row in tracked_rows:
                raw = row[ci].strip()
                if not raw:
                    continue
                if method == "redact":
                    new = "[REDACTED]"
                elif method == "hash_sha256":
                    new = "sha256:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]
                else:
                    masked, was_masked = mask_cell_value(row[ci], None)
                    new = masked if was_masked else (raw[:1] + "•••" + raw[-1:] if len(raw) > 2 else "•••")
                if new != row[ci]:
                    row[ci] = new
                    cells_changed += 1

        duration_ms = round((time.perf_counter() - t0) * 1000, 2)
        step_telemetry.append(
            {
                "step_index": step_idx + 1,
                "op": op,
                "column": step.get("column") or (", ".join(step.get("columns", [])) if step.get("columns") else "*"),
                "cells_changed": cells_changed,
                "rows_removed": rows_removed,
                "columns_added": cols_added,
                "columns_removed": cols_removed,
                "duration_ms": duration_ms,
                "note": step_note,
            }
        )

    final_rows = [r for _, r in tracked_rows]
    after_metrics = _table_metrics(columns, final_rows)

    # Build Git-style Row & Cell Diffs (bounded to max_diff_rows)
    surviving_map: dict[int, dict[str, str]] = {
        idx: dict(zip(columns, row, strict=True))
        for idx, row in tracked_rows
    }
    diff_rows: list[dict[str, Any]] = []
    modified_row_count = 0
    removed_row_count = 0

    for orig_idx in range(1, len(initial_rows) + 1):
        before_row = original_snapshots[orig_idx]
        after_row = surviving_map.get(orig_idx)
        if after_row is None:
            removed_row_count += 1
            if len(diff_rows) < max_diff_rows:
                preview_cells = [
                    {
                        "column": col,
                        "before": _mask_for_diff(before_row[col], col, pii_cols, mask_pii_in_diff),
                        "after": None,
                    }
                    for col in header[:5]
                ]
                diff_rows.append(
                    {"row_index": orig_idx, "status": "removed", "changes": preview_cells}
                )
            continue

        changes: list[dict[str, Any]] = []
        for col in columns:
            if col in before_row:
                b_val = before_row[col]
                a_val = after_row[col]
                if b_val != a_val:
                    changes.append(
                        {
                            "column": col,
                            "before": _mask_for_diff(b_val, col, pii_cols, mask_pii_in_diff),
                            "after": _mask_for_diff(a_val, col, pii_cols, mask_pii_in_diff),
                        }
                    )
            else:
                changes.append(
                    {
                        "column": col,
                        "before": None,
                        "after": _mask_for_diff(after_row[col], col, pii_cols, mask_pii_in_diff),
                    }
                )
        if changes:
            modified_row_count += 1
            if len(diff_rows) < max_diff_rows:
                diff_rows.append(
                    {"row_index": orig_idx, "status": "modified", "changes": changes[:10]}
                )

    csv_bytes = export_table_bytes(columns, final_rows, "csv")
    if len(csv_bytes) > settings.DATASET_MAX_UPLOAD_BYTES:
        raise PipelineDSLError("Derived dataset exceeds maximum upload byte limit.")

    total_cells_changed = sum(t["cells_changed"] for t in step_telemetry)
    total_rows_removed = sum(t["rows_removed"] for t in step_telemetry)

    summary = {
        "before": before_metrics,
        "after": after_metrics,
        "total_cells_changed": total_cells_changed,
        "total_rows_removed": total_rows_removed,
        "modified_row_count": modified_row_count,
        "removed_row_count": removed_row_count,
        "step_telemetry": step_telemetry,
        "diff_rows": diff_rows,
        "diff_truncated": (modified_row_count + removed_row_count) > len(diff_rows),
        "output_sha256": hashlib.sha256(csv_bytes).hexdigest(),
        "output_size_bytes": len(csv_bytes),
        "warnings": list(dict.fromkeys(warnings)),
    }
    return PipelineOutput(columns=columns, rows=final_rows, csv_bytes=csv_bytes, summary=summary)


def export_table_bytes(columns: list[str], rows: list[list[str]], fmt: str) -> bytes:
    """Serialize tabular data into CSV, Parquet, or Excel (.xlsx) bytes."""
    if fmt == "csv":
        buf = io.StringIO(newline="")
        writer = csv.writer(buf, lineterminator="\n")
        writer.writerow(columns)
        writer.writerows(rows)
        return buf.getvalue().encode("utf-8")

    if fmt == "parquet":
        col_dict = {col: [row[i] for row in rows] for i, col in enumerate(columns)}
        frame = pl.DataFrame(col_dict, schema={col: pl.String for col in columns})
        out = io.BytesIO()
        frame.write_parquet(out)
        return out.getvalue()

    if fmt == "xlsx":
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "SyntheSift_Cleaned"
        ws.append(columns)
        for row in rows:
            # Neutralize formula injection prefixes in exported spreadsheets
            safe_row = [
                f"'{cell}" if cell and cell[0] in {"=", "+", "-", "@"} else cell
                for cell in row
            ]
            ws.append(safe_row)
        out = io.BytesIO()
        wb.save(out)
        return out.getvalue()

    raise ValueError(f"Unsupported export format: {fmt}")
