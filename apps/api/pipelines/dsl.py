"""Strict schema validation and catalog metadata for the 15-op safe Transformation DSL."""

from __future__ import annotations

import re
from typing import Any

MAX_STEPS = 25
MAX_REGEX_LENGTH = 120
MAX_MAPPING_KEYS = 100

SUPPORTED_OPS = frozenset(
    {
        "trim_whitespace",
        "normalize_case",
        "normalize_sentinel_nulls",
        "replace_values",
        "regex_replace",
        "fill_missing",
        "cast_type",
        "standardize_date",
        "clip_numeric",
        "drop_duplicate_rows",
        "filter_rows",
        "rename_column",
        "drop_columns",
        "split_column",
        "mask_pii",
    }
)


class PipelineDSLError(Exception):
    """Structured validation error for an unsafe or malformed DSL step."""

    def __init__(self, message: str, step_index: int | None = None):
        self.message = message
        self.step_index = step_index
        super().__init__(message)


def _require_str(step: dict[str, Any], key: str, idx: int, *, allow_empty: bool = False, max_len: int = 255) -> str:
    val = step.get(key)
    if not isinstance(val, str):
        raise PipelineDSLError(f"Step {idx + 1}: '{key}' must be a string.", idx)
    if not allow_empty and not val.strip():
        raise PipelineDSLError(f"Step {idx + 1}: '{key}' cannot be empty.", idx)
    if len(val) > max_len:
        raise PipelineDSLError(f"Step {idx + 1}: '{key}' exceeds {max_len} characters.", idx)
    return val


def _require_enum(step: dict[str, Any], key: str, allowed: set[str], idx: int, default: str | None = None) -> str:
    val = step.get(key, default)
    if not isinstance(val, str) or val not in allowed:
        raise PipelineDSLError(
            f"Step {idx + 1}: '{key}' must be one of {sorted(allowed)}.", idx
        )
    return val


def _optional_number(step: dict[str, Any], key: str, idx: int) -> float | None:
    val = step.get(key)
    if val is None or val == "":
        return None
    if isinstance(val, bool) or not isinstance(val, (int, float)):
        try:
            return float(val)
        except (TypeError, ValueError) as exc:
            raise PipelineDSLError(f"Step {idx + 1}: '{key}' must be numeric.", idx) from exc
    return float(val)


def validate_steps(raw_steps: Any) -> list[dict[str, Any]]:
    """Validate and canonicalize an ordered list of 1..25 typed DSL operations."""
    if not isinstance(raw_steps, list) or not (1 <= len(raw_steps) <= MAX_STEPS):
        raise PipelineDSLError(f"Provide between 1 and {MAX_STEPS} transformation steps.")

    normalized: list[dict[str, Any]] = []
    for idx, step in enumerate(raw_steps):
        if not isinstance(step, dict):
            raise PipelineDSLError(f"Step {idx + 1} must be an object.", idx)

        op = step.get("op")
        if not isinstance(op, str) or op not in SUPPORTED_OPS:
            raise PipelineDSLError(
                f"Step {idx + 1}: unsupported operation '{op}'.", idx
            )

        if op == "trim_whitespace":
            col = _require_str(step, "column", idx)
            side = _require_enum(step, "side", {"both", "left", "right"}, idx, default="both")
            normalized.append({"op": op, "column": col, "side": side})

        elif op == "normalize_case":
            col = _require_str(step, "column", idx)
            mode = _require_enum(step, "mode", {"lower", "upper", "title"}, idx, default="title")
            normalized.append({"op": op, "column": col, "mode": mode})

        elif op == "normalize_sentinel_nulls":
            col = _require_str(step, "column", idx)
            tokens = step.get("tokens")
            clean_tokens: list[str] | None = None
            if tokens is not None:
                if not isinstance(tokens, list) or len(tokens) > 30 or any(not isinstance(t, str) for t in tokens):
                    raise PipelineDSLError(f"Step {idx + 1}: 'tokens' must be a list of up to 30 strings.", idx)
                clean_tokens = [t.strip() for t in tokens if t.strip()]
            entry: dict[str, Any] = {"op": op, "column": col}
            if clean_tokens:
                entry["tokens"] = clean_tokens
            normalized.append(entry)

        elif op == "replace_values":
            col = _require_str(step, "column", idx)
            mapping = step.get("mapping")
            if (
                not isinstance(mapping, dict)
                or not (1 <= len(mapping) <= MAX_MAPPING_KEYS)
                or any(not isinstance(k, str) or not isinstance(v, str) for k, v in mapping.items())
            ):
                raise PipelineDSLError(
                    f"Step {idx + 1}: 'mapping' must be a non-empty string-to-string object.", idx
                )
            normalized.append({"op": op, "column": col, "mapping": dict(mapping)})

        elif op == "regex_replace":
            col = _require_str(step, "column", idx)
            pattern = _require_str(step, "pattern", idx, max_len=MAX_REGEX_LENGTH)
            replacement = _require_str(step, "replacement", idx, allow_empty=True, max_len=200)
            # Reject obvious catastrophic nested quantifiers
            if re.search(r"\([^)]*[+*][^)]*\)[+*]", pattern):
                raise PipelineDSLError(
                    f"Step {idx + 1}: nested quantifiers in regex are disallowed for safety.", idx
                )
            try:
                re.compile(pattern)
            except re.error as exc:
                raise PipelineDSLError(f"Step {idx + 1}: invalid regex pattern ({exc}).", idx) from exc
            normalized.append({"op": op, "column": col, "pattern": pattern, "replacement": replacement})

        elif op == "fill_missing":
            col = _require_str(step, "column", idx)
            strategy = _require_enum(
                step, "strategy", {"constant", "mean", "median", "mode", "ffill"}, idx, default="constant"
            )
            entry = {"op": op, "column": col, "strategy": strategy}
            if strategy == "constant":
                entry["value"] = _require_str(step, "value", idx, allow_empty=False, max_len=200)
            normalized.append(entry)

        elif op == "cast_type":
            col = _require_str(step, "column", idx)
            to_type = _require_enum(
                step, "to_type", {"integer", "decimal", "boolean", "date", "text"}, idx
            )
            on_error = _require_enum(step, "on_error", {"null", "keep", "reject"}, idx, default="keep")
            normalized.append({"op": op, "column": col, "to_type": to_type, "on_error": on_error})

        elif op == "standardize_date":
            col = _require_str(step, "column", idx)
            out_fmt = _require_enum(
                step, "output_format", {"%Y-%m-%d", "%Y/%m/%d", "%d-%m-%Y"}, idx, default="%Y-%m-%d"
            )
            normalized.append({"op": op, "column": col, "output_format": out_fmt})

        elif op == "clip_numeric":
            col = _require_str(step, "column", idx)
            use_iqr = bool(step.get("use_iqr_bounds", False))
            min_v = _optional_number(step, "min_value", idx)
            max_v = _optional_number(step, "max_value", idx)
            if not use_iqr and min_v is None and max_v is None:
                raise PipelineDSLError(
                    f"Step {idx + 1}: provide min_value, max_value, or enable use_iqr_bounds.", idx
                )
            if min_v is not None and max_v is not None and min_v > max_v:
                raise PipelineDSLError(
                    f"Step {idx + 1}: min_value cannot exceed max_value.", idx
                )
            normalized.append(
                {
                    "op": op,
                    "column": col,
                    "use_iqr_bounds": use_iqr,
                    "min_value": min_v,
                    "max_value": max_v,
                }
            )

        elif op == "drop_duplicate_rows":
            subset = step.get("subset_columns")
            clean_subset: list[str] = []
            if subset is not None:
                if not isinstance(subset, list) or any(not isinstance(c, str) or not c.strip() for c in subset):
                    raise PipelineDSLError(f"Step {idx + 1}: 'subset_columns' must be column names.", idx)
                clean_subset = list(dict.fromkeys(c.strip() for c in subset))
            keep = _require_enum(step, "keep", {"first", "last"}, idx, default="first")
            normalized.append({"op": op, "subset_columns": clean_subset, "keep": keep})

        elif op == "filter_rows":
            col = _require_str(step, "column", idx)
            cond = _require_enum(
                step, "condition", {"not_null", "is_null", "eq", "neq", "contains", "gt", "lt"}, idx
            )
            entry = {"op": op, "column": col, "condition": cond}
            if cond in {"eq", "neq", "contains", "gt", "lt"}:
                entry["value"] = _require_str(step, "value", idx, allow_empty=True, max_len=200)
            normalized.append(entry)

        elif op == "rename_column":
            col = _require_str(step, "column", idx)
            new_name = _require_str(step, "new_name", idx, max_len=120).strip()
            if "\x00" in new_name:
                raise PipelineDSLError(f"Step {idx + 1}: invalid new column name.", idx)
            normalized.append({"op": op, "column": col, "new_name": new_name})

        elif op == "drop_columns":
            cols = step.get("columns")
            if not isinstance(cols, list) or not cols or any(not isinstance(c, str) or not c.strip() for c in cols):
                raise PipelineDSLError(f"Step {idx + 1}: 'columns' must be a non-empty list of column names.", idx)
            normalized.append({"op": op, "columns": list(dict.fromkeys(c.strip() for c in cols))})

        elif op == "split_column":
            col = _require_str(step, "column", idx)
            delim = _require_str(step, "delimiter", idx, max_len=12)
            new_cols = step.get("new_columns")
            if (
                not isinstance(new_cols, list)
                or len(new_cols) != 2
                or any(not isinstance(c, str) or not c.strip() for c in new_cols)
            ):
                raise PipelineDSLError(
                    f"Step {idx + 1}: 'new_columns' must specify exactly 2 non-empty column names.", idx
                )
            normalized.append(
                {
                    "op": op,
                    "column": col,
                    "delimiter": delim,
                    "new_columns": [new_cols[0].strip(), new_cols[1].strip()],
                }
            )

        elif op == "mask_pii":
            col = _require_str(step, "column", idx)
            method = _require_enum(
                step, "method", {"partial_mask", "hash_sha256", "redact"}, idx, default="partial_mask"
            )
            normalized.append({"op": op, "column": col, "method": method})

    return normalized


def suggest_steps_from_profile(profile_result: dict[str, Any]) -> list[dict[str, Any]]:
    """Deterministically propose starter DSL steps grounded in v2 profile findings."""
    steps: list[dict[str, Any]] = []
    columns = profile_result.get("columns") or []
    duplicate_rows = int(profile_result.get("duplicate_rows") or 0)

    ws_cols = [
        c["name"]
        for c in columns
        if isinstance(c, dict) and ((c.get("text_stats") or {}).get("whitespace_padding_count") or 0) > 0
    ]
    if ws_cols:
        steps.append({"op": "trim_whitespace", "column": "*", "side": "both"})

    sentinel_cols = [
        c["name"]
        for c in columns
        if isinstance(c, dict) and ((c.get("text_stats") or {}).get("sentinel_null_count") or 0) > 0
    ]
    if sentinel_cols:
        steps.append({"op": "normalize_sentinel_nulls", "column": "*"})

    for col in columns:
        if not isinstance(col, dict):
            continue
        name = col["name"]
        text_stats = col.get("text_stats") or {}
        dist = col.get("distribution") or {}
        pii = col.get("pii_signals") or []

        if (text_stats.get("case_variant_groups") or 0) > 0 and col.get("semantic_type") == "categorical":
            steps.append({"op": "normalize_case", "column": name, "mode": "title"})

        if (dist.get("outlier_count_iqr") or 0) > 0 and dist.get("outlier_bounds"):
            steps.append(
                {
                    "op": "clip_numeric",
                    "column": name,
                    "use_iqr_bounds": True,
                    "min_value": None,
                    "max_value": None,
                }
            )

        if pii:
            steps.append({"op": "mask_pii", "column": name, "method": "partial_mask"})

    if duplicate_rows > 0:
        steps.append({"op": "drop_duplicate_rows", "subset_columns": [], "keep": "first"})

    return steps[:MAX_STEPS]
