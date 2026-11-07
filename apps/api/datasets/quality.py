"""Deterministic, source-free quality signals from aggregate CSV profiles."""

from typing import Any


def assess_quality(summary: dict[str, Any]) -> dict[str, Any]:
    """Derive explicitly scoped findings; do not imply semantic correctness."""
    rows = int(summary["row_count"])
    cols = int(summary["column_count"])
    missing = int(summary["missing_cells"])
    duplicates = int(summary.get("duplicate_rows", 0))
    total = rows * cols

    findings: list[dict[str, Any]] = []

    def add(code: str, severity: str, message: str, column: str | None = None) -> None:
        findings.append(
            {"code": code, "severity": severity, "message": message, "column": column}
        )

    if duplicates:
        add(
            "duplicate_rows",
            "warning",
            f"{duplicates} repeated data row(s) have identical CSV values.",
        )

    for column in summary["columns"]:
        name = str(column["name"])
        count = int(column["missing_count"])
        populated = int(column["populated_count"])
        distinct = column["distinct_count"]
        exact = bool(column["distinct_count_exact"])

        if count == rows:
            add("empty_column", "high", "All records are missing a value.", name)
        elif rows and (count / rows) >= 0.30:
            add(
                "high_missingness",
                "warning",
                f"{column['missing_percent']}% of records are missing a value.",
                name,
            )
        elif count:
            add(
                "some_missingness",
                "info",
                f"{column['missing_percent']}% of records are missing a value.",
                name,
            )

        if exact and distinct == 1 and populated > 1:
            add("constant_column", "info", "All populated values are identical.", name)

    counts = {severity: sum(f["severity"] == severity for f in findings)
              for severity in ("high", "warning", "info")}

    return {
        "completeness_percent": round(100 * (total - missing) / total, 2) if total else None,
        "duplicate_rows": duplicates,
        "duplicate_percent": round(100 * duplicates / rows, 2) if rows else 0,
        "finding_counts": counts,
        "findings": findings,
        "method": "deterministic-v1",
    }
