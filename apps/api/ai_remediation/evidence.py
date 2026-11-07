"""Minimize external disclosure: no original rows, only bounded aggregates."""

import hashlib
import json


def profile_digest(result: dict) -> str:
    canonical = json.dumps(result, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def evidence_from_profile(result: dict) -> dict:
    """Give the LLM aggregate evidence with stable reference IDs."""
    columns = []
    for index, col in enumerate(result.get("columns", [])[:30], start=1):
        if not isinstance(col, dict):
            continue
        numeric = col.get("numeric") if col.get("populated_count", 0) >= 5 else None
        columns.append({
            "id": f"C{index}",
            "name": str(col.get("name", ""))[:80],
            "type": col.get("inferred_type"),
            "missing_percent": col.get("missing_percent"),
            "distinct_count": col.get("distinct_count"),
            "distinct_count_exact": col.get("distinct_count_exact"),
            "numeric_aggregates": numeric,
        })
    findings = []
    for index, finding in enumerate(
        result.get("quality", {}).get("findings", [])[:30], start=1
    ):
        if not isinstance(finding, dict):
            continue
        findings.append({
            "id": f"F{index}",
            "code": str(finding.get("code", ""))[:50],
            "severity": str(finding.get("severity", ""))[:16],
            "column": str(finding.get("column") or "")[:80],
            "message": str(finding.get("message", ""))[:180],
        })
    return {
        "row_count": result.get("row_count"),
        "column_count": result.get("column_count"),
        "missing_cells": result.get("missing_cells"),
        "duplicate_rows": result.get("duplicate_rows", 0),
        "columns": columns,
        "findings": findings,
    }
