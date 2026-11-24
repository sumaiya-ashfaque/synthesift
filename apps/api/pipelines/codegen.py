"""Generate reproducible Polars, Pandas, and DuckDB SQL scripts from a validated DSL plan."""

from __future__ import annotations

import json
from typing import Any

from .dsl import validate_steps


def _py_str(value: str) -> str:
    return json.dumps(value)


def _sql_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _sql_lit(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def generate_polars_code(filename: str, raw_steps: list[dict[str, Any]]) -> str:
    steps = validate_steps(raw_steps)
    lines = [
        '"""Reproducible Polars pipeline exported from SyntheSift."""',
        "import hashlib",
        "import polars as pl",
        "",
        f"df = pl.read_csv({_py_str(filename)}, infer_schema_length=0)",
        "",
    ]

    for idx, step in enumerate(steps, start=1):
        op = step["op"]
        lines.append(f"# Step {idx}: {op}")
        if op == "trim_whitespace":
            fn = {"both": "strip_chars", "left": "strip_chars_start", "right": "strip_chars_end"}[step["side"]]
            expr = f"pl.all().str.{fn}()" if step["column"] == "*" else f"pl.col({_py_str(step['column'])}).str.{fn}()"
            lines.append(f"df = df.with_columns({expr})")
        elif op == "normalize_case":
            fn = {"lower": "to_lowercase", "upper": "to_uppercase", "title": "to_titlecase"}[step["mode"]]
            lines.append(f"df = df.with_columns(pl.col({_py_str(step['column'])}).str.{fn}())")
        elif op == "normalize_sentinel_nulls":
            tokens = step.get("tokens") or ["n/a", "na", "null", "none", "-", "--", "unknown"]
            target = "pl.all()" if step["column"] == "*" else f"pl.col({_py_str(step['column'])})"
            lines.append(
                f"df = df.with_columns(pl.when({target}.str.strip_chars().str.to_lowercase().is_in({tokens!r})).then(None).otherwise({target}).name.keep())"
            )
        elif op == "replace_values":
            lines.append(
                f"df = df.with_columns(pl.col({_py_str(step['column'])}).replace({step['mapping']!r}))"
            )
        elif op == "regex_replace":
            lines.append(
                f"df = df.with_columns(pl.col({_py_str(step['column'])}).str.replace_all({_py_str(step['pattern'])}, {_py_str(step['replacement'])}))"
            )
        elif op == "fill_missing":
            col = _py_str(step["column"])
            strat = step["strategy"]
            if strat == "constant":
                lines.append(f"df = df.with_columns(pl.col({col}).fill_null({_py_str(step['value'])}))")
            elif strat in {"mean", "median"}:
                lines.append(
                    f"df = df.with_columns(pl.col({col}).cast(pl.Float64, strict=False).fill_null(strategy={_py_str(strat)}).cast(pl.String))"
                )
            elif strat == "ffill":
                lines.append(f"df = df.with_columns(pl.col({col}).forward_fill())")
            else:
                lines.append(
                    f"mode_val = df.select(pl.col({col}).drop_nulls().mode().first()).item()\n"
                    f"df = df.with_columns(pl.col({col}).fill_null(mode_val))"
                )
        elif op == "cast_type":
            col = _py_str(step["column"])
            dtype_map = {
                "integer": "pl.Int64",
                "decimal": "pl.Float64",
                "boolean": "pl.Boolean",
                "date": "pl.Date",
                "text": "pl.String",
            }
            strict = "True" if step["on_error"] == "reject" else "False"
            lines.append(f"df = df.with_columns(pl.col({col}).cast({dtype_map[step['to_type']]}, strict={strict}))")
        elif op == "standardize_date":
            col = _py_str(step["column"])
            lines.append(
                f"df = df.with_columns(pl.col({col}).str.to_date(strict=False).dt.strftime({_py_str(step['output_format'])}))"
            )
        elif op == "clip_numeric":
            col = _py_str(step["column"])
            if step.get("use_iqr_bounds"):
                lines.append(
                    f"q1, q3 = df.select(pl.col({col}).cast(pl.Float64, strict=False).quantile(0.25), pl.col({col}).cast(pl.Float64, strict=False).quantile(0.75)).row(0)\n"
                    f"iqr = q3 - q1\n"
                    f"df = df.with_columns(pl.col({col}).cast(pl.Float64, strict=False).clip(q1 - 1.5 * iqr, q3 + 1.5 * iqr))"
                )
            else:
                lines.append(
                    f"df = df.with_columns(pl.col({col}).cast(pl.Float64, strict=False).clip({step.get('min_value')!r}, {step.get('max_value')!r}))"
                )
        elif op == "drop_duplicate_rows":
            subset = step.get("subset_columns") or None
            lines.append(f"df = df.unique(subset={subset!r}, keep={_py_str(step['keep'])}, maintain_order=True)")
        elif op == "filter_rows":
            col = _py_str(step["column"])
            cond = step["condition"]
            val = _py_str(step.get("value", ""))
            expr_map = {
                "not_null": f"pl.col({col}).is_not_null() & (pl.col({col}).str.strip_chars() != '')",
                "is_null": f"pl.col({col}).is_null() | (pl.col({col}).str.strip_chars() == '')",
                "eq": f"pl.col({col}) == {val}",
                "neq": f"pl.col({col}) != {val}",
                "contains": f"pl.col({col}).str.to_lowercase().str.contains({val}.lower(), literal=True)",
                "gt": f"pl.col({col}).cast(pl.Float64, strict=False) > float({val})",
                "lt": f"pl.col({col}).cast(pl.Float64, strict=False) < float({val})",
            }
            lines.append(f"df = df.filter({expr_map[cond]})")
        elif op == "rename_column":
            lines.append(f"df = df.rename({{{_py_str(step['column'])}: {_py_str(step['new_name'])}}})")
        elif op == "drop_columns":
            lines.append(f"df = df.drop({step['columns']!r})")
        elif op == "split_column":
            col = _py_str(step["column"])
            left, right = step["new_columns"]
            lines.append(
                f"df = df.with_columns(\n"
                f"    pl.col({col}).str.split_exact({_py_str(step['delimiter'])}, 1)\n"
                f"      .struct.rename_fields([{_py_str(left)}, {_py_str(right)}])\n"
                f").unnest({col})"
            )
        elif op == "mask_pii":
            col = _py_str(step["column"])
            if step["method"] == "redact":
                lines.append(f"df = df.with_columns(pl.when(pl.col({col}).is_not_null()).then(pl.lit('[REDACTED]')).otherwise(None).alias({col}))")
            elif step["method"] == "hash_sha256":
                lines.append(
                    f"df = df.with_columns(pl.col({col}).map_elements(lambda v: 'sha256:' + hashlib.sha256(v.encode()).hexdigest()[:16] if v else v, return_dtype=pl.String))"
                )
            else:
                lines.append(
                    f"df = df.with_columns(pl.col({col}).str.replace(r'^(.{{1,2}})[^@]*', '$1•••'))"
                )
        lines.append("")

    lines.append('df.write_csv("cleaned_output.csv")')
    return "\n".join(lines)


def generate_pandas_code(filename: str, raw_steps: list[dict[str, Any]]) -> str:
    steps = validate_steps(raw_steps)
    lines = [
        '"""Reproducible Pandas pipeline exported from SyntheSift."""',
        "import hashlib",
        "import pandas as pd",
        "",
        f"df = pd.read_csv({_py_str(filename)}, dtype=str, keep_default_na=False)",
        "",
    ]

    for idx, step in enumerate(steps, start=1):
        op = step["op"]
        lines.append(f"# Step {idx}: {op}")
        if op == "trim_whitespace":
            fn = {"both": "strip", "left": "lstrip", "right": "rstrip"}[step["side"]]
            if step["column"] == "*":
                lines.append(f"df = df.apply(lambda s: s.str.{fn}())")
            else:
                c = _py_str(step["column"])
                lines.append(f"df[{c}] = df[{c}].str.{fn}()")
        elif op == "normalize_case":
            c = _py_str(step["column"])
            fn = {"lower": "lower", "upper": "upper", "title": "title"}[step["mode"]]
            lines.append(f"df[{c}] = df[{c}].str.{fn}()")
        elif op == "normalize_sentinel_nulls":
            tokens = step.get("tokens") or ["n/a", "na", "null", "none", "-", "--", "unknown"]
            if step["column"] == "*":
                lines.append(f"df = df.apply(lambda s: s.mask(s.str.strip().str.lower().isin({tokens!r}), ''))")
            else:
                c = _py_str(step["column"])
                lines.append(f"df.loc[df[{c}].str.strip().str.lower().isin({tokens!r}), {c}] = ''")
        elif op == "replace_values":
            c = _py_str(step["column"])
            lines.append(f"df[{c}] = df[{c}].replace({step['mapping']!r})")
        elif op == "regex_replace":
            c = _py_str(step["column"])
            lines.append(
                f"df[{c}] = df[{c}].str.replace({_py_str(step['pattern'])}, {_py_str(step['replacement'])}, regex=True)"
            )
        elif op == "fill_missing":
            c = _py_str(step["column"])
            strat = step["strategy"]
            if strat == "constant":
                lines.append(f"df.loc[df[{c}].str.strip() == '', {c}] = {_py_str(step['value'])}")
            elif strat in {"mean", "median"}:
                lines.append(
                    f"num = pd.to_numeric(df[{c}], errors='coerce')\n"
                    f"df.loc[df[{c}].str.strip() == '', {c}] = str(round(num.{strat}(), 4))"
                )
            elif strat == "ffill":
                lines.append(f"df[{c}] = df[{c}].replace('', pd.NA).ffill().fillna('')")
            else:
                lines.append(f"df.loc[df[{c}].str.strip() == '', {c}] = df.loc[df[{c}].str.strip() != '', {c}].mode().iloc[0]")
        elif op == "cast_type":
            c = _py_str(step["column"])
            lines.append(f"# Cast '{step['column']}' -> {step['to_type']} (on_error={step['on_error']})")
            if step["to_type"] in {"integer", "decimal"}:
                lines.append(f"df[{c}] = pd.to_numeric(df[{c}], errors='coerce')")
            elif step["to_type"] == "date":
                lines.append(f"df[{c}] = pd.to_datetime(df[{c}], errors='coerce').dt.strftime('%Y-%m-%d')")
        elif op == "standardize_date":
            c = _py_str(step["column"])
            lines.append(f"df[{c}] = pd.to_datetime(df[{c}], errors='coerce').dt.strftime({_py_str(step['output_format'])}).fillna(df[{c}])")
        elif op == "clip_numeric":
            c = _py_str(step["column"])
            if step.get("use_iqr_bounds"):
                lines.append(
                    f"s = pd.to_numeric(df[{c}], errors='coerce')\n"
                    f"q1, q3 = s.quantile(0.25), s.quantile(0.75)\n"
                    f"df[{c}] = s.clip(q1 - 1.5 * (q3 - q1), q3 + 1.5 * (q3 - q1))"
                )
            else:
                lines.append(
                    f"df[{c}] = pd.to_numeric(df[{c}], errors='coerce').clip(lower={step.get('min_value')!r}, upper={step.get('max_value')!r})"
                )
        elif op == "drop_duplicate_rows":
            subset = step.get("subset_columns") or None
            lines.append(f"df = df.drop_duplicates(subset={subset!r}, keep={_py_str(step['keep'])})")
        elif op == "filter_rows":
            c = _py_str(step["column"])
            cond = step["condition"]
            v = _py_str(step.get("value", ""))
            if cond == "not_null":
                lines.append(f"df = df[df[{c}].str.strip() != '']")
            elif cond == "is_null":
                lines.append(f"df = df[df[{c}].str.strip() == '']")
            elif cond == "eq":
                lines.append(f"df = df[df[{c}] == {v}]")
            elif cond == "neq":
                lines.append(f"df = df[df[{c}] != {v}]")
            elif cond == "contains":
                lines.append(f"df = df[df[{c}].str.contains({v}, case=False, na=False, regex=False)]")
            elif cond == "gt":
                lines.append(f"df = df[pd.to_numeric(df[{c}], errors='coerce') > float({v})]")
            elif cond == "lt":
                lines.append(f"df = df[pd.to_numeric(df[{c}], errors='coerce') < float({v})]")
        elif op == "rename_column":
            lines.append(f"df = df.rename(columns={{{_py_str(step['column'])}: {_py_str(step['new_name'])}}})")
        elif op == "drop_columns":
            lines.append(f"df = df.drop(columns={step['columns']!r})")
        elif op == "split_column":
            c = _py_str(step["column"])
            left, right = step["new_columns"]
            lines.append(f"df[[{_py_str(left)}, {_py_str(right)}]] = df[{c}].str.split({_py_str(step['delimiter'])}, n=1, expand=True)")
        elif op == "mask_pii":
            c = _py_str(step["column"])
            if step["method"] == "redact":
                lines.append(f"df.loc[df[{c}].str.strip() != '', {c}] = '[REDACTED]'")
            elif step["method"] == "hash_sha256":
                lines.append(f"df[{c}] = df[{c}].apply(lambda v: 'sha256:' + hashlib.sha256(v.encode()).hexdigest()[:16] if v else '')")
            else:
                lines.append(f"df[{c}] = df[{c}].str.replace(r'^(.{{1,2}})[^@]*', r'\\1•••', regex=True)")
        lines.append("")

    lines.append('df.to_csv("cleaned_output.csv", index=False)')
    return "\n".join(lines)


def generate_duckdb_sql(filename: str, raw_steps: list[dict[str, Any]]) -> str:
    steps = validate_steps(raw_steps)
    ctes = [f"step_0 AS (\n  SELECT * FROM read_csv_auto({_sql_lit(filename)}, all_varchar=true)\n)"]

    for idx, step in enumerate(steps, start=1):
        prev = f"step_{idx - 1}"
        cur = f"step_{idx}"
        op = step["op"]

        if op == "trim_whitespace":
            fn = {"both": "TRIM", "left": "LTRIM", "right": "RTRIM"}[step["side"]]
            if step["column"] == "*":
                body = f"SELECT {fn}(COLUMNS(*)) FROM {prev}"
            else:
                col = _sql_ident(step["column"])
                body = f"SELECT * REPLACE ({fn}({col}) AS {col}) FROM {prev}"
        elif op == "normalize_case":
            col = _sql_ident(step["column"])
            fn = {"lower": "LOWER", "upper": "UPPER", "title": "CONCAT(UPPER(LEFT(col,1)), LOWER(SUBSTRING(col,2)))"}[step["mode"]]
            expr = f"{fn}({col})" if step["mode"] in {"lower", "upper"} else f"CONCAT(UPPER(LEFT({col}, 1)), LOWER(SUBSTRING({col}, 2)))"
            body = f"SELECT * REPLACE ({expr} AS {col}) FROM {prev}"
        elif op == "normalize_sentinel_nulls":
            tokens = ", ".join(_sql_lit(t.lower()) for t in (step.get("tokens") or ["n/a", "na", "null", "none", "-"]))
            if step["column"] == "*":
                body = f"SELECT * FROM {prev} -- Normalize sentinel tokens ({tokens}) across all columns"
            else:
                col = _sql_ident(step["column"])
                body = f"SELECT * REPLACE (CASE WHEN LOWER(TRIM({col})) IN ({tokens}) THEN '' ELSE {col} END AS {col}) FROM {prev}"
        elif op == "replace_values":
            col = _sql_ident(step["column"])
            whens = " ".join(f"WHEN {col} = {_sql_lit(k)} THEN {_sql_lit(v)}" for k, v in step["mapping"].items())
            body = f"SELECT * REPLACE (CASE {whens} ELSE {col} END AS {col}) FROM {prev}"
        elif op == "regex_replace":
            col = _sql_ident(step["column"])
            body = f"SELECT * REPLACE (REGEXP_REPLACE({col}, {_sql_lit(step['pattern'])}, {_sql_lit(step['replacement'])}, 'g') AS {col}) FROM {prev}"
        elif op == "fill_missing":
            col = _sql_ident(step["column"])
            if step["strategy"] == "constant":
                body = f"SELECT * REPLACE (CASE WHEN TRIM(COALESCE({col}, '')) = '' THEN {_sql_lit(step['value'])} ELSE {col} END AS {col}) FROM {prev}"
            else:
                agg = "AVG" if step["strategy"] == "mean" else "MEDIAN"
                body = f"SELECT * REPLACE (CASE WHEN TRIM(COALESCE({col}, '')) = '' THEN CAST((SELECT {agg}(TRY_CAST({col} AS DOUBLE)) FROM {prev}) AS VARCHAR) ELSE {col} END AS {col}) FROM {prev}"
        elif op == "cast_type":
            col = _sql_ident(step["column"])
            sql_t = {"integer": "BIGINT", "decimal": "DOUBLE", "boolean": "BOOLEAN", "date": "DATE", "text": "VARCHAR"}[step["to_type"]]
            body = f"SELECT * REPLACE (TRY_CAST({col} AS {sql_t}) AS {col}) FROM {prev}"
        elif op == "standardize_date":
            col = _sql_ident(step["column"])
            body = f"SELECT * REPLACE (COALESCE(STRFTIME(TRY_CAST({col} AS DATE), {_sql_lit(step['output_format'])}), {col}) AS {col}) FROM {prev}"
        elif op == "clip_numeric":
            col = _sql_ident(step["column"])
            lo = step.get("min_value")
            hi = step.get("max_value")
            if step.get("use_iqr_bounds"):
                body = (
                    f"SELECT * REPLACE (GREATEST(q1 - 1.5*(q3-q1), LEAST(q3 + 1.5*(q3-q1), TRY_CAST({col} AS DOUBLE))) AS {col}) "
                    f"FROM {prev}, (SELECT QUANTILE_CONT(TRY_CAST({col} AS DOUBLE), 0.25) AS q1, QUANTILE_CONT(TRY_CAST({col} AS DOUBLE), 0.75) AS q3 FROM {prev})"
                )
            else:
                expr = f"TRY_CAST({col} AS DOUBLE)"
                if lo is not None:
                    expr = f"GREATEST({lo}, {expr})"
                if hi is not None:
                    expr = f"LEAST({hi}, {expr})"
                body = f"SELECT * REPLACE ({expr} AS {col}) FROM {prev}"
        elif op == "drop_duplicate_rows":
            subset = step.get("subset_columns") or []
            if subset:
                cols_sql = ", ".join(_sql_ident(c) for c in subset)
                body = f"SELECT * FROM {prev} QUALIFY ROW_NUMBER() OVER (PARTITION BY {cols_sql}) = 1"
            else:
                body = f"SELECT DISTINCT * FROM {prev}"
        elif op == "filter_rows":
            col = _sql_ident(step["column"])
            cond = step["condition"]
            val = _sql_lit(step.get("value", ""))
            pred = {
                "not_null": f"TRIM(COALESCE({col}, '')) <> ''",
                "is_null": f"TRIM(COALESCE({col}, '')) = ''",
                "eq": f"{col} = {val}",
                "neq": f"{col} <> {val}",
                "contains": f"LOWER({col}) LIKE LOWER({_sql_lit('%' + step.get('value', '') + '%')})",
                "gt": f"TRY_CAST({col} AS DOUBLE) > {float(step.get('value', '0') or 0)}",
                "lt": f"TRY_CAST({col} AS DOUBLE) < {float(step.get('value', '0') or 0)}",
            }[cond]
            body = f"SELECT * FROM {prev} WHERE {pred}"
        elif op == "rename_column":
            col = _sql_ident(step["column"])
            new_col = _sql_ident(step["new_name"])
            body = f"SELECT * RENAME ({col} AS {new_col}) FROM {prev}"
        elif op == "drop_columns":
            dropped = ", ".join(_sql_ident(c) for c in step["columns"])
            body = f"SELECT * EXCLUDE ({dropped}) FROM {prev}"
        elif op == "split_column":
            col = _sql_ident(step["column"])
            left, right = _sql_ident(step["new_columns"][0]), _sql_ident(step["new_columns"][1])
            d = _sql_lit(step["delimiter"])
            body = f"SELECT *, SPLIT_PART({col}, {d}, 1) AS {left}, SPLIT_PART({col}, {d}, 2) AS {right} FROM {prev}"
        elif op == "mask_pii":
            col = _sql_ident(step["column"])
            if step["method"] == "redact":
                body = f"SELECT * REPLACE ('[REDACTED]' AS {col}) FROM {prev}"
            elif step["method"] == "hash_sha256":
                body = f"SELECT * REPLACE (CONCAT('sha256:', LEFT(SHA256({col}), 16)) AS {col}) FROM {prev}"
            else:
                body = f"SELECT * REPLACE (REGEXP_REPLACE({col}, '^(.{{1,2}})[^@]*', '\\1•••') AS {col}) FROM {prev}"
        else:
            body = f"SELECT * FROM {prev}"

        ctes.append(f"{cur} AS (\n  {body}\n)")

    return "-- Reproducible DuckDB SQL exported from SyntheSift\nWITH\n" + ",\n".join(ctes) + f"\nSELECT * FROM step_{len(steps)};\n"
