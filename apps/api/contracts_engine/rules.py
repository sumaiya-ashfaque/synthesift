"""Typed 10-rule Data Contract validator, deterministic evaluator, and YAML serializer."""

from __future__ import annotations

import math
import re
import statistics
from typing import Any

import yaml

from datasets.formats import iter_tabular_rows
from datasets.pii import detect_pii_kind

MAX_RULES = 50

SUPPORTED_RULES = frozenset(
    {
        "expect_column_to_exist",
        "expect_column_not_null",
        "expect_column_unique",
        "expect_column_values_between",
        "expect_column_values_in_set",
        "expect_column_regex_match",
        "expect_column_no_pii",
        "expect_column_no_whitespace_padding",
        "expect_table_row_count_between",
        "expect_column_mean_between",
    }
)


class ContractRuleError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


def _opt_float(raw: Any, label: str) -> float | None:
    if raw is None or raw == "":
        return None
    if isinstance(raw, bool):
        raise ContractRuleError(f"'{label}' must be numeric.")
    try:
        val = float(raw)
        if not math.isfinite(val):
            raise ValueError
        return val
    except (TypeError, ValueError) as exc:
        raise ContractRuleError(f"'{label}' must be a finite number.") from exc


def _opt_int(raw: Any, label: str) -> int | None:
    if raw is None or raw == "":
        return None
    if isinstance(raw, bool):
        raise ContractRuleError(f"'{label}' must be an integer.")
    try:
        return int(raw)
    except (TypeError, ValueError) as exc:
        raise ContractRuleError(f"'{label}' must be an integer.") from exc


def validate_rules(raw_rules: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_rules, list) or not (1 <= len(raw_rules) <= MAX_RULES):
        raise ContractRuleError(f"Provide between 1 and {MAX_RULES} contract rules.")

    validated: list[dict[str, Any]] = []
    for idx, rule in enumerate(raw_rules):
        if not isinstance(rule, dict):
            raise ContractRuleError(f"Rule {idx + 1} must be an object.")
        kind = rule.get("type")
        if not isinstance(kind, str) or kind not in SUPPORTED_RULES:
            raise ContractRuleError(f"Rule {idx + 1}: unsupported rule type '{kind}'.")
        severity = rule.get("severity", "error")
        if severity not in {"error", "warning"}:
            raise ContractRuleError(f"Rule {idx + 1}: severity must be 'error' or 'warning'.")

        entry: dict[str, Any] = {"type": kind, "severity": severity}

        if kind != "expect_table_row_count_between":
            col = rule.get("column")
            if not isinstance(col, str) or not col.strip() or len(col) > 255:
                raise ContractRuleError(f"Rule {idx + 1}: 'column' is required.")
            entry["column"] = col.strip()

        if kind == "expect_column_not_null":
            max_null = _opt_float(rule.get("max_null_percent", 0.0), "max_null_percent")
            if max_null is None or not (0.0 <= max_null <= 100.0):
                raise ContractRuleError(f"Rule {idx + 1}: max_null_percent must be 0..100.")
            entry["max_null_percent"] = max_null

        elif kind == "expect_column_values_between":
            lo = _opt_float(rule.get("min_value"), "min_value")
            hi = _opt_float(rule.get("max_value"), "max_value")
            mostly = _opt_float(rule.get("mostly", 1.0), "mostly")
            if lo is None and hi is None:
                raise ContractRuleError(f"Rule {idx + 1}: provide min_value and/or max_value.")
            if lo is not None and hi is not None and lo > hi:
                raise ContractRuleError(f"Rule {idx + 1}: min_value cannot exceed max_value.")
            if mostly is None or not (0.0 <= mostly <= 1.0):
                raise ContractRuleError(f"Rule {idx + 1}: mostly must be between 0 and 1.")
            entry.update({"min_value": lo, "max_value": hi, "mostly": mostly})

        elif kind == "expect_column_values_in_set":
            allowed = rule.get("allowed_values")
            if not isinstance(allowed, list) or not (1 <= len(allowed) <= 100) or any(not isinstance(v, str) for v in allowed):
                raise ContractRuleError(f"Rule {idx + 1}: allowed_values must be 1..100 strings.")
            mostly = _opt_float(rule.get("mostly", 1.0), "mostly")
            if mostly is None or not (0.0 <= mostly <= 1.0):
                raise ContractRuleError(f"Rule {idx + 1}: mostly must be between 0 and 1.")
            entry.update(
                {
                    "allowed_values": allowed,
                    "case_sensitive": bool(rule.get("case_sensitive", False)),
                    "mostly": mostly,
                }
            )

        elif kind == "expect_column_regex_match":
            pattern = rule.get("pattern")
            if not isinstance(pattern, str) or not pattern or len(pattern) > 120:
                raise ContractRuleError(f"Rule {idx + 1}: pattern must be 1..120 characters.")
            if re.search(r"\([^)]*[+*][^)]*\)[+*]", pattern):
                raise ContractRuleError(f"Rule {idx + 1}: nested quantifiers in regex are disallowed.")
            try:
                re.compile(pattern)
            except re.error as exc:
                raise ContractRuleError(f"Rule {idx + 1}: invalid regex ({exc}).") from exc
            mostly = _opt_float(rule.get("mostly", 1.0), "mostly")
            if mostly is None or not (0.0 <= mostly <= 1.0):
                raise ContractRuleError(f"Rule {idx + 1}: mostly must be between 0 and 1.")
            entry.update({"pattern": pattern, "mostly": mostly})

        elif kind == "expect_table_row_count_between":
            min_r = _opt_int(rule.get("min_rows"), "min_rows")
            max_r = _opt_int(rule.get("max_rows"), "max_rows")
            if min_r is None and max_r is None:
                raise ContractRuleError(f"Rule {idx + 1}: provide min_rows and/or max_rows.")
            if min_r is not None and max_r is not None and min_r > max_r:
                raise ContractRuleError(f"Rule {idx + 1}: min_rows cannot exceed max_rows.")
            entry.update({"min_rows": min_r, "max_rows": max_r})

        elif kind == "expect_column_mean_between":
            lo = _opt_float(rule.get("min_mean"), "min_mean")
            hi = _opt_float(rule.get("max_mean"), "max_mean")
            if lo is None and hi is None:
                raise ContractRuleError(f"Rule {idx + 1}: provide min_mean and/or max_mean.")
            if lo is not None and hi is not None and lo > hi:
                raise ContractRuleError(f"Rule {idx + 1}: min_mean cannot exceed max_mean.")
            entry.update({"min_mean": lo, "max_mean": hi})

        validated.append(entry)

    return validated


def evaluate_contract(dataset, raw_rules: list[dict[str, Any]]) -> dict[str, Any]:
    """Deterministically evaluate contract rules against a READY dataset."""
    rules = validate_rules(raw_rules)
    columns, row_iter = iter_tabular_rows(dataset)
    rows = list(row_iter)
    row_count = len(rows)
    col_idx = {name: i for i, name in enumerate(columns)}

    results: list[dict[str, Any]] = []
    passed_count = 0
    failed_errors = 0
    failed_warnings = 0

    for idx, rule in enumerate(rules, start=1):
        kind = rule["type"]
        severity = rule["severity"]
        col = rule.get("column")
        passed = False
        observed = ""
        expected = ""
        failing_rows = 0

        if kind == "expect_table_row_count_between":
            lo, hi = rule.get("min_rows"), rule.get("max_rows")
            passed = (lo is None or row_count >= lo) and (hi is None or row_count <= hi)
            observed = f"{row_count} rows"
            expected = f"[{lo if lo is not None else '0'}, {hi if hi is not None else '∞'}] rows"

        elif kind == "expect_column_to_exist":
            passed = col in col_idx
            observed = "Present" if passed else "Missing from schema"
            expected = f"Column '{col}' exists"

        elif col == "*" and kind in {"expect_column_no_pii", "expect_column_no_whitespace_padding"}:
            if kind == "expect_column_no_pii":
                hits = 0
                for row in rows:
                    if any(detect_pii_kind(c.strip()) is not None for c in row if c.strip()):
                        hits += 1
                failing_rows = hits
                passed = hits == 0
                observed = f"{hits} row(s) with PII signals"
                expected = "0 rows with PII"
            else:
                hits = sum(1 for row in rows if any(c != c.strip() for c in row if c.strip()))
                failing_rows = hits
                passed = hits == 0
                observed = f"{hits} row(s) with leading/trailing whitespace"
                expected = "0 rows with whitespace padding"

        elif col not in col_idx:
            passed = False
            observed = "Column not found"
            expected = f"Column '{col}' present"

        else:
            ci = col_idx[col]
            vals = [row[ci] for row in rows]

            if kind == "expect_column_not_null":
                nulls = sum(1 for v in vals if not v.strip())
                null_pct = round(100.0 * nulls / row_count, 2) if row_count else 0.0
                max_pct = rule["max_null_percent"]
                failing_rows = nulls
                passed = null_pct <= max_pct
                observed = f"{null_pct}% null ({nulls} rows)"
                expected = f"<= {max_pct}% null"

            elif kind == "expect_column_unique":
                populated = [v for v in vals if v.strip()]
                dupes = len(populated) - len(set(populated))
                failing_rows = dupes
                passed = dupes == 0
                observed = f"{dupes} duplicate value(s)"
                expected = "100% unique populated values"

            elif kind == "expect_column_values_between":
                lo, hi, mostly = rule.get("min_value"), rule.get("max_value"), rule["mostly"]
                populated = [v.strip() for v in vals if v.strip()]
                in_range = 0
                for text in populated:
                    try:
                        num = float(text)
                        if math.isfinite(num) and (lo is None or num >= lo) and (hi is None or num <= hi):
                            in_range += 1
                    except ValueError:
                        pass
                ratio = (in_range / len(populated)) if populated else 1.0
                failing_rows = len(populated) - in_range
                passed = ratio >= mostly
                observed = f"{round(100 * ratio, 2)}% within range ({failing_rows} out of bounds)"
                expected = f">= {round(100 * mostly, 1)}% in [{lo if lo is not None else '-∞'}, {hi if hi is not None else '+∞'}]"

            elif kind == "expect_column_values_in_set":
                cs = rule["case_sensitive"]
                allowed = set(rule["allowed_values"]) if cs else {v.casefold() for v in rule["allowed_values"]}
                mostly = rule["mostly"]
                populated = [v.strip() for v in vals if v.strip()]
                matched = sum(1 for v in populated if (v in allowed if cs else v.casefold() in allowed))
                ratio = (matched / len(populated)) if populated else 1.0
                failing_rows = len(populated) - matched
                passed = ratio >= mostly
                observed = f"{round(100 * ratio, 2)}% in allowed set ({failing_rows} unexpected)"
                expected = f">= {round(100 * mostly, 1)}% in {len(allowed)}-value set"

            elif kind == "expect_column_regex_match":
                compiled = re.compile(rule["pattern"])
                mostly = rule["mostly"]
                populated = [v.strip() for v in vals if v.strip()]
                matched = sum(1 for v in populated if compiled.search(v))
                ratio = (matched / len(populated)) if populated else 1.0
                failing_rows = len(populated) - matched
                passed = ratio >= mostly
                observed = f"{round(100 * ratio, 2)}% matched ({failing_rows} non-matching)"
                expected = f">= {round(100 * mostly, 1)}% match /{rule['pattern']}/"

            elif kind == "expect_column_no_pii":
                hits = sum(1 for v in vals if v.strip() and detect_pii_kind(v.strip()) is not None)
                failing_rows = hits
                passed = hits == 0
                observed = f"{hits} cell(s) flagged as PII"
                expected = "0 PII cells"

            elif kind == "expect_column_no_whitespace_padding":
                hits = sum(1 for v in vals if v.strip() and v != v.strip())
                failing_rows = hits
                passed = hits == 0
                observed = f"{hits} cell(s) with leading/trailing spaces"
                expected = "0 padded cells"

            elif kind == "expect_column_mean_between":
                lo, hi = rule.get("min_mean"), rule.get("max_mean")
                nums = []
                for v in vals:
                    try:
                        n = float(v.strip())
                        if math.isfinite(n):
                            nums.append(n)
                    except ValueError:
                        pass
                if not nums:
                    passed = False
                    observed = "No numeric values"
                else:
                    mean_v = round(statistics.mean(nums), 4)
                    passed = (lo is None or mean_v >= lo) and (hi is None or mean_v <= hi)
                    observed = f"mean = {mean_v}"
                expected = f"mean in [{lo if lo is not None else '-∞'}, {hi if hi is not None else '+∞'}]"

        if passed:
            passed_count += 1
        elif severity == "error":
            failed_errors += 1
        else:
            failed_warnings += 1

        results.append(
            {
                "rule_index": idx,
                "type": kind,
                "column": col,
                "severity": severity,
                "passed": passed,
                "observed": observed,
                "expected": expected,
                "failing_rows": failing_rows,
            }
        )

    total = len(results)
    failed_total = failed_errors + failed_warnings
    overall = "failed" if failed_errors > 0 else ("warning" if failed_warnings > 0 else "passed")

    return {
        "status": overall,
        "passed_rules": passed_count,
        "failed_rules": failed_total,
        "total_rules": total,
        "pass_rate": round(100.0 * passed_count / total, 1) if total else 100.0,
        "results": results,
    }


def auto_generate_contract_rules(profile_result: dict[str, Any]) -> list[dict[str, Any]]:
    """Synthesize a clean starter Data Contract directly from a v2 dataset profile."""
    rules: list[dict[str, Any]] = []
    row_count = int(profile_result.get("row_count") or 0)
    if row_count > 0:
        rules.append(
            {
                "type": "expect_table_row_count_between",
                "min_rows": max(1, int(row_count * 0.8)),
                "max_rows": int(row_count * 2.5) + 10,
                "severity": "error",
            }
        )

    rules.append(
        {
            "type": "expect_column_no_whitespace_padding",
            "column": "*",
            "severity": "warning",
        }
    )

    for col in (profile_result.get("columns") or [])[:15]:
        if not isinstance(col, dict):
            continue
        name = col["name"]
        rules.append({"type": "expect_column_to_exist", "column": name, "severity": "error"})

        miss_pct = float(col.get("missing_percent") or 0.0)
        if miss_pct == 0.0:
            rules.append(
                {
                    "type": "expect_column_not_null",
                    "column": name,
                    "max_null_percent": 0.0,
                    "severity": "error",
                }
            )
        elif miss_pct < 25.0:
            rules.append(
                {
                    "type": "expect_column_not_null",
                    "column": name,
                    "max_null_percent": round(min(30.0, miss_pct + 5.0), 1),
                    "severity": "warning",
                }
            )

        dist = col.get("distribution") or {}
        bounds = dist.get("outlier_bounds")
        if bounds and dist.get("iqr", 0) > 0:
            rules.append(
                {
                    "type": "expect_column_values_between",
                    "column": name,
                    "min_value": round(float(bounds["lower"]), 2),
                    "max_value": round(float(bounds["upper"]), 2),
                    "mostly": 0.98,
                    "severity": "warning",
                }
            )

        if not (col.get("pii_signals") or []) and col.get("inferred_type") == "text":
            rules.append(
                {
                    "type": "expect_column_no_pii",
                    "column": name,
                    "severity": "error",
                }
            )

        if len(rules) >= 24:
            break

    return rules[:MAX_RULES]


def contract_to_yaml(name: str, description: str, version: int, rules: list[dict[str, Any]]) -> str:
    doc = {
        "schema_version": "synthesift.contract/v1",
        "name": name,
        "version": version,
        "description": description,
        "rules": rules,
    }
    return yaml.safe_dump(doc, sort_keys=False, allow_unicode=True)


def parse_contract_yaml(yaml_text: str) -> dict[str, Any]:
    if not isinstance(yaml_text, str) or not yaml_text.strip() or len(yaml_text) > 50_000:
        raise ContractRuleError("YAML payload must be non-empty and under 50 KB.")
    try:
        parsed = yaml.safe_load(yaml_text)
    except yaml.YAMLError as exc:
        raise ContractRuleError(f"Invalid YAML syntax: {exc}") from exc
    if not isinstance(parsed, dict):
        raise ContractRuleError("Contract YAML must define a top-level mapping.")
    name = str(parsed.get("name") or "").strip()
    if not name or len(name) > 120:
        raise ContractRuleError("Contract YAML must include a 'name' (1..120 chars).")
    description = str(parsed.get("description") or "").strip()[:1000]
    rules = validate_rules(parsed.get("rules"))
    return {"name": name, "description": description, "rules": rules}
