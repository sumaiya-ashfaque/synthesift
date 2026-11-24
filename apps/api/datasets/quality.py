"""Deterministic, source-free quality signals and 5-dimension scoring from profiles."""

from __future__ import annotations

from typing import Any

DIMENSION_WEIGHTS = {
    "completeness": 0.30,
    "uniqueness": 0.20,
    "validity": 0.20,
    "consistency": 0.15,
    "privacy_safety": 0.15,
}


def assess_quality(summary: dict[str, Any]) -> dict[str, Any]:
    """Derive explicitly scoped findings and transparent quality dimensions.

    Never implies semantic correctness; all weights and rules are disclosed.
    """
    rows = int(summary["row_count"])
    cols = int(summary["column_count"])
    missing = int(summary["missing_cells"])
    duplicates = int(summary.get("duplicate_rows", 0))
    total = rows * cols

    findings: list[dict[str, Any]] = []

    def add(
        code: str,
        severity: str,
        message: str,
        column: str | None = None,
        dimension: str = "validity",
        affected_count: int | None = None,
    ) -> None:
        item: dict[str, Any] = {
            "code": code,
            "severity": severity,
            "message": message,
            "column": column,
            "dimension": dimension,
        }
        if affected_count is not None:
            item["affected_count"] = affected_count
        findings.append(item)

    if duplicates:
        add(
            "duplicate_rows",
            "warning",
            f"{duplicates} repeated data row(s) have identical values.",
            dimension="uniqueness",
            affected_count=duplicates,
        )

    whitespace_cells = 0
    sentinel_cells = 0
    outlier_cells = 0
    mixed_case_cols = 0
    high_pii_cols = 0
    warn_pii_cols = 0

    for column in summary["columns"]:
        name = str(column["name"])
        count = int(column["missing_count"])
        populated = int(column["populated_count"])
        distinct = column["distinct_count"]
        exact = bool(column["distinct_count_exact"])

        if count == rows:
            add(
                "empty_column",
                "high",
                "All records are missing a value.",
                name,
                dimension="completeness",
                affected_count=count,
            )
        elif rows and (count / rows) >= 0.30:
            add(
                "high_missingness",
                "warning",
                f"{column['missing_percent']}% of records are missing a value.",
                name,
                dimension="completeness",
                affected_count=count,
            )
        elif count:
            add(
                "some_missingness",
                "info",
                f"{column['missing_percent']}% of records are missing a value.",
                name,
                dimension="completeness",
                affected_count=count,
            )

        if exact and distinct == 1 and populated > 1:
            add(
                "constant_column",
                "info",
                "All populated values are identical.",
                name,
                dimension="uniqueness",
                affected_count=populated,
            )

        # v2 rich profile findings (only fire when rich metadata is present)
        text_stats = column.get("text_stats") or {}
        ws_count = int(text_stats.get("whitespace_padding_count") or 0)
        if ws_count > 0:
            whitespace_cells += ws_count
            add(
                "whitespace_padding",
                "warning",
                f"{ws_count} cell(s) have leading or trailing whitespace.",
                name,
                dimension="consistency",
                affected_count=ws_count,
            )

        sentinel_count = int(text_stats.get("sentinel_null_count") or 0)
        if sentinel_count > 0:
            sentinel_cells += sentinel_count
            add(
                "sentinel_nulls",
                "warning",
                f"{sentinel_count} cell(s) contain placeholder null strings (e.g. N/A, null, -).",
                name,
                dimension="validity",
                affected_count=sentinel_count,
            )

        case_variants = int(text_stats.get("case_variant_groups") or 0)
        if case_variants > 0 and column.get("inferred_type") == "text":
            mixed_case_cols += 1
            add(
                "mixed_casing",
                "info",
                f"{case_variants} distinct value group(s) appear with inconsistent capitalization.",
                name,
                dimension="consistency",
                affected_count=case_variants,
            )

        distribution = column.get("distribution") or {}
        outliers = int(distribution.get("outlier_count_iqr") or 0)
        outlier_pct = float(distribution.get("outlier_percent_iqr") or 0.0)
        if outliers > 0:
            outlier_cells += outliers
            add(
                "numeric_outliers",
                "warning" if outlier_pct >= 2.0 else "info",
                f"{outliers} value(s) ({outlier_pct}%) fall outside the 1.5x IQR range.",
                name,
                dimension="validity",
                affected_count=outliers,
            )

        skew = distribution.get("skewness")
        if isinstance(skew, (int, float)) and abs(skew) >= 2.0 and populated >= 10:
            add(
                "skewed_distribution",
                "info",
                f"Numeric distribution is heavily skewed (skewness {skew:.2f}).",
                name,
                dimension="validity",
            )

        pii_signals = column.get("pii_signals") or []
        if pii_signals:
            top_severity = (
                "high" if any(sig.get("severity") == "high" for sig in pii_signals) else "warning"
            )
            if top_severity == "high":
                high_pii_cols += 1
            else:
                warn_pii_cols += 1
            kinds_label = ", ".join(sig["kind"].replace("_", " ") for sig in pii_signals)
            matched = sum(int(sig.get("count") or 0) for sig in pii_signals)
            add(
                "pii_detected",
                top_severity,
                f"Potential sensitive data detected ({kinds_label}) across {matched} cell(s). Masked by default in Grid & excluded from AI.",
                name,
                dimension="privacy_safety",
                affected_count=matched,
            )

    counts = {
        severity: sum(f["severity"] == severity for f in findings)
        for severity in ("high", "warning", "info")
    }

    completeness_pct = round(100 * (total - missing) / total, 2) if total else None
    duplicate_pct = round(100 * duplicates / rows, 2) if rows else 0.0

    # Transparent 5-dimension scores (0-100)
    dim_completeness = completeness_pct if completeness_pct is not None else 100.0
    dim_uniqueness = round(max(0.0, 100.0 - duplicate_pct), 2)
    validity_penalty = (
        100.0 * (sentinel_cells + outlier_cells) / total if total else 0.0
    )
    dim_validity = round(max(0.0, 100.0 - min(100.0, validity_penalty * 2.5)), 2)
    consistency_penalty = (
        (100.0 * whitespace_cells / total if total else 0.0) * 2.5
        + (mixed_case_cols * 4.0)
    )
    dim_consistency = round(max(0.0, 100.0 - min(100.0, consistency_penalty)), 2)
    privacy_penalty = (high_pii_cols * 25.0) + (warn_pii_cols * 10.0)
    dim_privacy = round(max(0.0, 100.0 - min(100.0, privacy_penalty)), 2)

    dimensions = {
        "completeness": dim_completeness,
        "uniqueness": dim_uniqueness,
        "validity": dim_validity,
        "consistency": dim_consistency,
        "privacy_safety": dim_privacy,
    }
    overall_score = round(
        sum(dimensions[key] * weight for key, weight in DIMENSION_WEIGHTS.items()),
        1,
    )

    return {
        "completeness_percent": completeness_pct,
        "duplicate_rows": duplicates,
        "duplicate_percent": duplicate_pct,
        "overall_score": overall_score,
        "dimensions": dimensions,
        "dimension_weights": DIMENSION_WEIGHTS,
        "finding_counts": counts,
        "findings": findings,
        "method": "deterministic-v2",
    }
