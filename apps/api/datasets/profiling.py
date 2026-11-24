"""Deterministic, privacy-safe statistical profiling powered by Polars & DuckDB.

Privacy invariant: raw cell values are NEVER persisted in profile output.
Only aggregate statistics, bucketed histograms, masked structural shapes,
and PII risk counts are stored.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, DecimalException
from typing import Any

import polars as pl
from django.conf import settings

from .formats import iter_tabular_rows
from .ingestion import AdmissionError, inspect_csv
from .models import Dataset
from .pii import (
    PII_SEVERITY,
    detect_pii_kind,
    detect_semantic_format,
    is_sentinel_null,
    mask_pattern_shape,
)

_BOOLEAN_VALUES = {"true", "false", "yes", "no"}
_INTEGER_PATTERN = re.compile(r"[+-]?[0-9]+\Z")
_LEADING_ZERO_PATTERN = re.compile(r"[+-]?0[0-9]+")


def _is_iso_date(value: str) -> bool:
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def _clean_float(value: Any, digits: int = 4) -> float | None:
    if value is None:
        return None
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(num):
        return None
    return round(num, digits)


def _compute_numeric_distribution(values: list[float]) -> dict[str, Any] | None:
    if not values:
        return None

    series = pl.Series("v", values, dtype=pl.Float64)
    n = len(values)
    p5 = _clean_float(series.quantile(0.05, interpolation="linear"))
    p25 = _clean_float(series.quantile(0.25, interpolation="linear"))
    p50 = _clean_float(series.quantile(0.50, interpolation="linear"))
    p75 = _clean_float(series.quantile(0.75, interpolation="linear"))
    p95 = _clean_float(series.quantile(0.95, interpolation="linear"))
    std = _clean_float(series.std(ddof=1)) if n >= 2 else 0.0
    skewness = _clean_float(series.skew()) if n >= 3 else 0.0
    zero_count = int((series == 0.0).sum())
    negative_count = int((series < 0.0).sum())

    iqr = round((p75 - p25), 4) if (p75 is not None and p25 is not None) else 0.0
    lower_bound = round(p25 - 1.5 * iqr, 4) if p25 is not None else None
    upper_bound = round(p75 + 1.5 * iqr, 4) if p75 is not None else None

    if lower_bound is not None and upper_bound is not None and iqr > 0:
        outlier_count = int(((series < lower_bound) | (series > upper_bound)).sum())
    else:
        outlier_count = 0

    # Deterministic 12-bin histogram with finite bounds
    vmin = float(series.min())
    vmax = float(series.max())
    histogram: list[dict[str, Any]] = []
    if math.isfinite(vmin) and math.isfinite(vmax):
        if vmin == vmax:
            histogram = [{"bin_start": round(vmin, 4), "bin_end": round(vmax, 4), "count": n}]
        else:
            bin_count = min(12, max(4, int(math.sqrt(n))))
            step = (vmax - vmin) / bin_count
            counts = [0] * bin_count
            for val in values:
                idx = int((val - vmin) / step)
                if idx >= bin_count:
                    idx = bin_count - 1
                if idx < 0:
                    idx = 0
                counts[idx] += 1
            for idx, count in enumerate(counts):
                histogram.append(
                    {
                        "bin_start": round(vmin + idx * step, 4),
                        "bin_end": round(vmin + (idx + 1) * step, 4),
                        "count": count,
                    }
                )

    return {
        "p5": p5,
        "p25": p25,
        "p50": p50,
        "p75": p75,
        "p95": p95,
        "std": std,
        "iqr": iqr,
        "skewness": skewness,
        "zero_count": zero_count,
        "negative_count": negative_count,
        "outlier_count_iqr": outlier_count,
        "outlier_percent_iqr": round(100 * outlier_count / n, 2) if n else 0.0,
        "outlier_bounds": (
            {"lower": lower_bound, "upper": upper_bound}
            if lower_bound is not None and upper_bound is not None
            else None
        ),
        "histogram": histogram,
    }


def _compute_correlations(
    numeric_columns: dict[str, list[float | None]],
) -> list[dict[str, Any]]:
    """Compute top pairwise Pearson correlations across numeric columns."""
    names = list(numeric_columns.keys())[:25]
    if len(names) < 2:
        return []

    frame = pl.DataFrame(
        {name: pl.Series(name, numeric_columns[name], dtype=pl.Float64) for name in names}
    )
    pairs: list[dict[str, Any]] = []
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            col_a, col_b = names[i], names[j]
            subset = frame.select([col_a, col_b]).drop_nulls()
            if subset.height < 3:
                continue
            corr_df = subset.select(pl.corr(col_a, col_b).alias("r"))
            raw_r = corr_df["r"][0]
            r = _clean_float(raw_r, digits=3)
            if r is not None:
                pairs.append({"col_a": col_a, "col_b": col_b, "r": r})

    pairs.sort(key=lambda item: abs(item["r"]), reverse=True)
    return pairs[:30]


@dataclass
class _ColumnAccumulator:
    name: str
    missing_count: int = 0
    populated_count: int = 0
    integer_count: int = 0
    numeric_count: int = 0
    boolean_count: int = 0
    date_count: int = 0
    numeric_sum: Decimal = Decimal(0)
    numeric_min: Decimal | None = None
    numeric_max: Decimal | None = None
    distinct_values: set[str] = field(default_factory=set)
    distinct_exact: bool = True

    # v2 rich privacy-safe diagnostics
    numeric_floats: list[float] = field(default_factory=list)
    aligned_floats: list[float | None] = field(default_factory=list)
    min_length: int | None = None
    max_length: int = 0
    length_sum: int = 0
    whitespace_padding_count: int = 0
    sentinel_null_count: int = 0
    leading_zero_id_count: int = 0
    case_groups: dict[str, set[str]] = field(default_factory=dict)
    case_tracking_capped: bool = False
    pattern_counts: Counter[str] = field(default_factory=Counter)
    pii_counts: Counter[str] = field(default_factory=Counter)
    semantic_counts: Counter[str] = field(default_factory=Counter)

    def add(self, raw: str, distinct_limit: int) -> None:
        value = raw.strip()

        if not value:
            self.missing_count += 1
            self.aligned_floats.append(None)
            return

        self.populated_count += 1

        if raw != value:
            self.whitespace_padding_count += 1

        val_len = len(value)
        if self.min_length is None or val_len < self.min_length:
            self.min_length = val_len
        if val_len > self.max_length:
            self.max_length = val_len
        self.length_sum += val_len

        if is_sentinel_null(value):
            self.sentinel_null_count += 1

        if self.distinct_exact:
            self.distinct_values.add(raw)
            if len(self.distinct_values) > distinct_limit:
                self.distinct_values.clear()
                self.distinct_exact = False

        # Track mixed casing groups using hashed keys only (zero raw storage in output).
        if not self.case_tracking_capped and val_len <= 80:
            folded = value.casefold()
            variants = self.case_groups.get(folded)
            if variants is None:
                if len(self.case_groups) < 512:
                    self.case_groups[folded] = {value}
                else:
                    self.case_tracking_capped = True
            elif len(variants) < 8:
                variants.add(value)

        # Privacy-preserving structural shape frequency (bounded).
        shape = mask_pattern_shape(value)
        if len(self.pattern_counts) < 256 or shape in self.pattern_counts:
            self.pattern_counts[shape] += 1

        pii_kind = detect_pii_kind(value)
        if pii_kind is not None:
            self.pii_counts[pii_kind] += 1
        else:
            sem_fmt = detect_semantic_format(value)
            if sem_fmt is not None:
                self.semantic_counts[sem_fmt] += 1

        if value.casefold() in _BOOLEAN_VALUES:
            self.boolean_count += 1

        is_leading_zero = bool(_LEADING_ZERO_PATTERN.fullmatch(value))
        if is_leading_zero:
            self.leading_zero_id_count += 1

        if _INTEGER_PATTERN.fullmatch(value) and not is_leading_zero:
            self.integer_count += 1

        if _is_iso_date(value):
            self.date_count += 1

        # Preserve identifier-like values such as 00123 as text.
        if is_leading_zero:
            self.aligned_floats.append(None)
            return

        try:
            numeric = Decimal(value)
            if not numeric.is_finite():
                self.aligned_floats.append(None)
                return
            updated_sum = self.numeric_sum + numeric
        except DecimalException:
            self.aligned_floats.append(None)
            return

        self.numeric_count += 1
        self.numeric_sum = updated_sum

        if self.numeric_min is None or numeric < self.numeric_min:
            self.numeric_min = numeric
        if self.numeric_max is None or numeric > self.numeric_max:
            self.numeric_max = numeric

        try:
            flt = float(numeric)
            if math.isfinite(flt):
                self.numeric_floats.append(flt)
                self.aligned_floats.append(flt)
            else:
                self.aligned_floats.append(None)
        except (ValueError, OverflowError):
            self.aligned_floats.append(None)

    def _infer_semantic_type(self, inferred_type: str, row_count: int) -> str:
        if inferred_type == "empty" or self.populated_count == 0:
            return "empty"
        threshold = max(1, int(self.populated_count * 0.6))
        if self.pii_counts:
            top_pii, top_pii_count = self.pii_counts.most_common(1)[0]
            if top_pii_count >= threshold:
                return top_pii
        if self.semantic_counts:
            top_sem, top_sem_count = self.semantic_counts.most_common(1)[0]
            if top_sem_count >= threshold:
                return top_sem
        if inferred_type == "date":
            return "iso_date"
        if inferred_type == "boolean":
            return "boolean"
        if self.leading_zero_id_count >= threshold:
            return "identifier"
        if inferred_type in {"integer", "decimal"}:
            if (
                inferred_type == "integer"
                and self.distinct_exact
                and len(self.distinct_values) == self.populated_count
                and self.populated_count >= 5
                and self.name.casefold().endswith("id")
            ):
                return "identifier"
            return "numeric_discrete" if inferred_type == "integer" else "numeric_continuous"
        if (
            self.distinct_exact
            and 1 < len(self.distinct_values) <= min(25, max(2, row_count // 2))
            and self.max_length <= 40
        ):
            return "categorical"
        return "free_text"

    def as_dict(self, row_count: int) -> dict[str, Any]:
        if self.populated_count == 0:
            inferred_type = "empty"
        elif self.boolean_count == self.populated_count:
            inferred_type = "boolean"
        elif self.integer_count == self.populated_count:
            inferred_type = "integer"
        elif self.numeric_count == self.populated_count:
            inferred_type = "decimal"
        elif self.date_count == self.populated_count:
            inferred_type = "date"
        else:
            inferred_type = "text"

        numeric_stats = None
        distribution = None
        if inferred_type in {"integer", "decimal"}:
            try:
                numeric_stats = {
                    "min": str(self.numeric_min),
                    "max": str(self.numeric_max),
                    "mean": str(self.numeric_sum / self.populated_count),
                }
            except DecimalException:
                numeric_stats = None
            distribution = _compute_numeric_distribution(self.numeric_floats)

        case_variant_groups = sum(
            1 for variants in self.case_groups.values() if len(variants) > 1
        )
        top_patterns = [
            {
                "shape": shape,
                "count": count,
                "percent": round(100 * count / self.populated_count, 1)
                if self.populated_count
                else 0.0,
            }
            for shape, count in self.pattern_counts.most_common(5)
        ]

        pii_signals = [
            {
                "kind": kind,
                "count": count,
                "percent": round(100 * count / self.populated_count, 2)
                if self.populated_count
                else 0.0,
                "severity": PII_SEVERITY.get(kind, "warning"),
            }
            for kind, count in self.pii_counts.most_common()
        ]

        text_stats = (
            {
                "min_length": self.min_length,
                "max_length": self.max_length,
                "mean_length": round(self.length_sum / self.populated_count, 1),
                "whitespace_padding_count": self.whitespace_padding_count,
                "sentinel_null_count": self.sentinel_null_count,
                "case_variant_groups": case_variant_groups,
                "pattern_shapes": top_patterns,
            }
            if self.populated_count > 0
            else None
        )

        return {
            "name": self.name,
            "inferred_type": inferred_type,
            "semantic_type": self._infer_semantic_type(inferred_type, row_count),
            "missing_count": self.missing_count,
            "missing_percent": round(100 * self.missing_count / row_count, 2),
            "populated_count": self.populated_count,
            "distinct_count": (
                len(self.distinct_values) if self.distinct_exact else None
            ),
            "distinct_count_exact": self.distinct_exact,
            "numeric": numeric_stats,
            "distribution": distribution,
            "text_stats": text_stats,
            "pii_signals": pii_signals,
        }


def profile_dataset(dataset: Dataset) -> dict[str, Any]:
    """Compute privacy-safe aggregate statistics without persisting raw cell values."""
    if dataset.status != Dataset.Status.READY:
        raise ValueError("Only ready datasets can be profiled.")

    validated = inspect_csv(dataset)

    distinct_limit = settings.DATASET_PROFILE_DISTINCT_LIMIT
    if distinct_limit < 1:
        raise ValueError("DATASET_PROFILE_DISTINCT_LIMIT must be positive.")

    accumulators = [_ColumnAccumulator(name) for name in validated.columns]

    row_count = 0
    seen_rows: set[bytes] = set()
    duplicate_rows = 0

    _, row_iter = iter_tabular_rows(dataset)
    for row in row_iter:
        if len(row) != len(accumulators):
            raise AdmissionError("source_changed")

        row_count += 1
        fingerprint = hashlib.sha256(
            json.dumps(row, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        ).digest()
        if fingerprint in seen_rows:
            duplicate_rows += 1
        else:
            seen_rows.add(fingerprint)

        for accumulator, value in zip(accumulators, row, strict=True):
            accumulator.add(value, distinct_limit)

    if row_count != validated.row_count:
        raise AdmissionError("source_changed")

    columns = [item.as_dict(row_count) for item in accumulators]

    numeric_series_map = {
        acc.name: acc.aligned_floats
        for acc, col in zip(accumulators, columns, strict=True)
        if col["inferred_type"] in {"integer", "decimal"}
    }
    correlations = _compute_correlations(numeric_series_map)

    pii_kinds: set[str] = set()
    flagged_columns = 0
    total_pii_matches = 0
    for col in columns:
        signals = col.get("pii_signals") or []
        if signals:
            flagged_columns += 1
            for sig in signals:
                pii_kinds.add(sig["kind"])
                total_pii_matches += sig["count"]

    return {
        "profile_version": 2,
        "engine": "polars-duckdb-v2",
        "row_count": row_count,
        "duplicate_rows": duplicate_rows,
        "column_count": len(columns),
        "missing_cells": sum(item.missing_count for item in accumulators),
        "pii_summary": {
            "flagged_columns": flagged_columns,
            "total_matches": total_pii_matches,
            "kinds": sorted(pii_kinds),
        },
        "correlations": correlations,
        "columns": columns,
    }
