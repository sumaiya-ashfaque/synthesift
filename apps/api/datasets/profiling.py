
"""Deterministic, bounded profiling of admitted CSV datasets."""

import csv
import re
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, DecimalException

from django.conf import settings

from .ingestion import AdmissionError, inspect_csv
from .models import Dataset
from .storage import storage_path

_BOOLEAN_VALUES = {"true", "false", "yes", "no"}
_INTEGER_PATTERN = re.compile(r"[+-]?[0-9]+\Z")


def _is_iso_date(value: str) -> bool:
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


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

    def add(self, raw: str, distinct_limit: int) -> None:
        value = raw.strip()

        if not value:
            self.missing_count += 1
            return

        self.populated_count += 1

        if self.distinct_exact:
            self.distinct_values.add(raw)

            if len(self.distinct_values) > distinct_limit:
                self.distinct_values.clear()
                self.distinct_exact = False

        if value.casefold() in _BOOLEAN_VALUES:
            self.boolean_count += 1

        if (
            _INTEGER_PATTERN.fullmatch(value)
            and not re.fullmatch(r"[+-]?0[0-9]+", value)
        ):
            self.integer_count += 1

        if _is_iso_date(value):
            self.date_count += 1

        # Preserve identifier-like values such as 00123 as text.
        if re.fullmatch(r"[+-]?0[0-9]+", value):
            return

        try:
            numeric = Decimal(value)

            if not numeric.is_finite():
                return

            updated_sum = self.numeric_sum + numeric

        except DecimalException:
            return

        self.numeric_count += 1
        self.numeric_sum = updated_sum

        if self.numeric_min is None or numeric < self.numeric_min:
            self.numeric_min = numeric

        if self.numeric_max is None or numeric > self.numeric_max:
            self.numeric_max = numeric

    def as_dict(self, row_count: int) -> dict:
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

        if inferred_type in {"integer", "decimal"}:
            try:
                numeric_stats = {
                    "min": str(self.numeric_min),
                    "max": str(self.numeric_max),
                    "mean": str(
                        self.numeric_sum / self.populated_count
                    ),
                }
            except DecimalException:
                numeric_stats = None

        return {
            "name": self.name,
            "inferred_type": inferred_type,
            "missing_count": self.missing_count,
            "missing_percent": round(
                100 * self.missing_count / row_count, 2
            ),
            "populated_count": self.populated_count,
            "distinct_count": (
                len(self.distinct_values)
                if self.distinct_exact
                else None
            ),
            "distinct_count_exact": self.distinct_exact,
            "numeric": numeric_stats,
        }


def profile_dataset(dataset: Dataset) -> dict:
    """Compute aggregate statistics without returning raw cell values."""
    if dataset.status != Dataset.Status.READY:
        raise ValueError("Only ready datasets can be profiled.")

    validated = inspect_csv(dataset)

    distinct_limit = settings.DATASET_PROFILE_DISTINCT_LIMIT

    if distinct_limit < 1:
        raise ValueError(
            "DATASET_PROFILE_DISTINCT_LIMIT must be positive."
        )

    accumulators = [
        _ColumnAccumulator(name)
        for name in validated.columns
    ]

    row_count = 0

    with storage_path(dataset.storage_key).open(
        "r",
        encoding="utf-8-sig",
        newline="",
    ) as source:
        reader = csv.reader(source, strict=True)
        next(reader)

        for row in reader:
            if len(row) != len(accumulators):
                raise AdmissionError("source_changed")

            row_count += 1

            for accumulator, value in zip(
                accumulators, row, strict=True
            ):
                accumulator.add(value, distinct_limit)

    if row_count != validated.row_count:
        raise AdmissionError("source_changed")

    columns = [
        item.as_dict(row_count)
        for item in accumulators
    ]

    return {
        "row_count": row_count,
        "column_count": len(columns),
        "missing_cells": sum(
            item.missing_count for item in accumulators
        ),
        "columns": columns,
    }
