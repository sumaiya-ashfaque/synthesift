"""Privacy-safe statistical dataset comparison and ML feature drift detection.

Computes:
- Schema diff (added/removed columns, inferred type shifts, row/quality deltas)
- Numeric drift: Population Stability Index (PSI), two-sample KS statistic (D & p-value),
  aligned histogram comparison bins, mean/median/std shifts
- Categorical/text drift: Jensen-Shannon Divergence (JSD), Total Variation Distance (TVD),
  cardinality shift (computed over hashed tokens — zero raw cell values returned)
"""

from __future__ import annotations

import hashlib
import math
from collections import Counter
from typing import Any

import polars as pl

from datasets.formats import iter_tabular_rows
from datasets.models import Dataset, DatasetProfile
from datasets.profiling import profile_dataset
from datasets.quality import assess_quality


def _parse_finite_floats(values: list[str]) -> list[float]:
    out: list[float] = []
    for raw in values:
        s = raw.strip()
        if not s:
            continue
        try:
            v = float(s)
            if math.isfinite(v):
                out.append(v)
        except ValueError:
            continue
    return out


def _ks_two_sample(base: list[float], cand: list[float]) -> tuple[float, float]:
    """Exact two-sample Kolmogorov-Smirnov statistic D and asymptotic p-value."""
    n1, n2 = len(base), len(cand)
    if n1 == 0 or n2 == 0:
        return 0.0, 1.0

    s1 = sorted(base)
    s2 = sorted(cand)
    i = j = 0
    max_diff = 0.0

    while i < n1 and j < n2:
        if s1[i] < s2[j]:
            val = s1[i]
            while i < n1 and s1[i] == val:
                i += 1
        elif s2[j] < s1[i]:
            val = s2[j]
            while j < n2 and s2[j] == val:
                j += 1
        else:
            val = s1[i]
            while i < n1 and s1[i] == val:
                i += 1
            while j < n2 and s2[j] == val:
                j += 1
        diff = abs((i / n1) - (j / n2))
        if diff > max_diff:
            max_diff = diff

    en = math.sqrt((n1 * n2) / (n1 + n2))
    lam = (en + 0.12 + 0.11 / en) * max_diff
    if lam <= 0:
        p_val = 1.0
    else:
        # Kolmogorov survival series
        p_sum = 0.0
        for k in range(1, 50):
            term = ((-1) ** (k - 1)) * math.exp(-2.0 * (k * k) * (lam * lam))
            p_sum += term
            if abs(term) < 1e-10:
                break
        p_val = max(0.0, min(1.0, 2.0 * p_sum))

    return round(max_diff, 4), round(p_val, 4)


def _compute_numeric_drift(base: list[float], cand: list[float]) -> dict[str, Any]:
    if not base or not cand:
        return {
            "psi": None,
            "ks_stat": None,
            "ks_p_value": None,
            "baseline_mean": None,
            "candidate_mean": None,
            "mean_shift_pct": None,
            "baseline_p50": None,
            "candidate_p50": None,
            "aligned_bins": [],
            "status": "stable",
        }

    s_base = pl.Series("b", base, dtype=pl.Float64)
    s_cand = pl.Series("c", cand, dtype=pl.Float64)
    b_mean = float(s_base.mean())
    c_mean = float(s_cand.mean())
    b_p50 = float(s_base.quantile(0.5, interpolation="linear"))
    c_p50 = float(s_cand.quantile(0.5, interpolation="linear"))

    mean_shift_pct = (
        round(100.0 * (c_mean - b_mean) / abs(b_mean), 2)
        if abs(b_mean) > 1e-9
        else (0.0 if abs(c_mean) <= 1e-9 else 100.0)
    )

    # Build aligned bins spanning both distributions cleanly
    lo = min(float(s_base.min()), float(s_cand.min()))
    hi = max(float(s_base.max()), float(s_cand.max()))
    n_bins = min(10, max(4, int(math.sqrt(len(base)))))

    aligned_bins: list[dict[str, Any]] = []
    psi = 0.0
    eps = 1e-4

    if lo == hi:
        aligned_bins = [{"bin_start": round(lo, 4), "bin_end": round(hi, 4), "baseline_pct": 100.0, "candidate_pct": 100.0}]
    else:
        step = (hi - lo) / n_bins
        b_counts = [0] * n_bins
        c_counts = [0] * n_bins
        for v in base:
            idx = min(n_bins - 1, max(0, int((v - lo) / step)))
            b_counts[idx] += 1
        for v in cand:
            idx = min(n_bins - 1, max(0, int((v - lo) / step)))
            c_counts[idx] += 1

        nb = len(base)
        nc = len(cand)
        for idx in range(n_bins):
            bp = b_counts[idx] / nb
            cp = c_counts[idx] / nc
            aligned_bins.append(
                {
                    "bin_start": round(lo + idx * step, 4),
                    "bin_end": round(lo + (idx + 1) * step, 4),
                    "baseline_pct": round(100.0 * bp, 2),
                    "candidate_pct": round(100.0 * cp, 2),
                }
            )
            bp_s = max(bp, eps)
            cp_s = max(cp, eps)
            psi += (cp_s - bp_s) * math.log(cp_s / bp_s)

    psi = round(max(0.0, psi), 4)
    ks_stat, ks_p = _ks_two_sample(base, cand)

    if psi >= 0.25 or ks_stat >= 0.30:
        status = "drifted"
    elif psi >= 0.10 or ks_stat >= 0.15:
        status = "moderate"
    else:
        status = "stable"

    return {
        "psi": psi,
        "ks_stat": ks_stat,
        "ks_p_value": ks_p,
        "baseline_mean": round(b_mean, 4),
        "candidate_mean": round(c_mean, 4),
        "mean_shift_pct": mean_shift_pct,
        "baseline_p50": round(b_p50, 4),
        "candidate_p50": round(c_p50, 4),
        "aligned_bins": aligned_bins,
        "status": status,
    }


def _compute_categorical_drift(base: list[str], cand: list[str]) -> dict[str, Any]:
    """Compute JSD & TVD over hashed tokens so raw strings/PII are never returned."""
    b_clean = [hashlib.sha256(v.strip().encode("utf-8")).digest() for v in base if v.strip()]
    c_clean = [hashlib.sha256(v.strip().encode("utf-8")).digest() for v in cand if v.strip()]
    nb, nc = len(b_clean), len(c_clean)
    if nb == 0 or nc == 0:
        return {
            "jsd": 0.0,
            "tvd": 0.0,
            "baseline_distinct": len(set(b_clean)),
            "candidate_distinct": len(set(c_clean)),
            "unseen_category_pct": 0.0,
            "status": "stable",
        }

    bc = Counter(b_clean)
    cc = Counter(c_clean)
    vocab = set(bc.keys()) | set(cc.keys())

    tvd_sum = 0.0
    jsd_sum = 0.0
    unseen_rows = sum(count for token, count in cc.items() if token not in bc)

    for token in vocab:
        p = bc.get(token, 0) / nb
        q = cc.get(token, 0) / nc
        m = 0.5 * (p + q)
        tvd_sum += abs(p - q)
        if p > 0:
            jsd_sum += 0.5 * p * math.log2(p / m)
        if q > 0:
            jsd_sum += 0.5 * q * math.log2(q / m)

    tvd = round(0.5 * tvd_sum, 4)
    jsd = round(max(0.0, min(1.0, jsd_sum)), 4)
    unseen_pct = round(100.0 * unseen_rows / nc, 2)

    if jsd >= 0.25 or tvd >= 0.35:
        status = "drifted"
    elif jsd >= 0.10 or tvd >= 0.15:
        status = "moderate"
    else:
        status = "stable"

    return {
        "jsd": jsd,
        "tvd": tvd,
        "baseline_distinct": len(bc),
        "candidate_distinct": len(cc),
        "unseen_category_pct": unseen_pct,
        "status": status,
    }


def _load_or_compute_profile(dataset: Dataset) -> dict[str, Any]:
    prof = DatasetProfile.objects.filter(
        dataset=dataset, status=DatasetProfile.Status.READY
    ).first()
    if prof and isinstance(prof.result, dict) and prof.result.get("columns"):
        return prof.result
    summary = profile_dataset(dataset)
    summary["quality"] = assess_quality(summary)
    return summary


def compare_datasets(baseline: Dataset, candidate: Dataset) -> dict[str, Any]:
    """Compare baseline vs candidate dataset for schema and statistical distribution drift."""
    b_prof = _load_or_compute_profile(baseline)
    c_prof = _load_or_compute_profile(candidate)

    b_cols, b_iter = iter_tabular_rows(baseline)
    c_cols, c_iter = iter_tabular_rows(candidate)
    b_rows = list(b_iter)
    c_rows = list(c_iter)

    b_col_map = {col["name"]: col for col in b_prof.get("columns", [])}
    c_col_map = {col["name"]: col for col in c_prof.get("columns", [])}

    b_set = set(b_cols)
    c_set = set(c_cols)
    added_columns = [c for c in c_cols if c not in b_set]
    removed_columns = [c for c in b_cols if c not in c_set]
    common_columns = [c for c in b_cols if c in c_set]

    type_changes = []
    for col in common_columns:
        bt = b_col_map.get(col, {}).get("inferred_type", "text")
        ct = c_col_map.get(col, {}).get("inferred_type", "text")
        if bt != ct:
            type_changes.append({"column": col, "baseline_type": bt, "candidate_type": ct})

    b_col_idx = {c: i for i, c in enumerate(b_cols)}
    c_col_idx = {c: i for i, c in enumerate(c_cols)}

    column_drifts: list[dict[str, Any]] = []
    max_psi = 0.0
    max_ks = 0.0
    max_jsd = 0.0

    for col in common_columns:
        bi = b_col_idx[col]
        ci = c_col_idx[col]
        b_vals = [r[bi] for r in b_rows]
        c_vals = [r[ci] for r in c_rows]

        b_miss_pct = round(100.0 * sum(not v.strip() for v in b_vals) / max(1, len(b_vals)), 2)
        c_miss_pct = round(100.0 * sum(not v.strip() for v in c_vals) / max(1, len(c_vals)), 2)
        miss_delta = round(c_miss_pct - b_miss_pct, 2)

        b_type = b_col_map.get(col, {}).get("inferred_type", "text")
        c_type = c_col_map.get(col, {}).get("inferred_type", "text")
        is_numeric = b_type in {"integer", "decimal"} and c_type in {"integer", "decimal"}

        if is_numeric:
            num_stats = _compute_numeric_drift(
                _parse_finite_floats(b_vals), _parse_finite_floats(c_vals)
            )
            col_status = num_stats["status"]
            if num_stats["psi"] is not None:
                max_psi = max(max_psi, num_stats["psi"])
            if num_stats["ks_stat"] is not None:
                max_ks = max(max_ks, num_stats["ks_stat"])
            cat_stats = None
        else:
            cat_stats = _compute_categorical_drift(b_vals, c_vals)
            col_status = cat_stats["status"]
            max_jsd = max(max_jsd, cat_stats["jsd"])
            num_stats = None

        # Escalate status if missingness jumped sharply or type changed
        if b_type != c_type or abs(miss_delta) >= 20.0:
            col_status = "drifted"
        elif abs(miss_delta) >= 10.0 and col_status == "stable":
            col_status = "moderate"

        column_drifts.append(
            {
                "column": col,
                "baseline_type": b_type,
                "candidate_type": c_type,
                "kind": "numeric" if is_numeric else "categorical",
                "baseline_missing_pct": b_miss_pct,
                "candidate_missing_pct": c_miss_pct,
                "missing_delta_pct": miss_delta,
                "numeric": num_stats,
                "categorical": cat_stats,
                "status": col_status,
            }
        )

    severity_rank = {"drifted": 0, "moderate": 1, "stable": 2}
    column_drifts.sort(
        key=lambda item: (
            severity_rank[item["status"]],
            -(item["numeric"]["psi"] if item["numeric"] and item["numeric"]["psi"] is not None else 0.0),
            -(item["categorical"]["jsd"] if item["categorical"] else 0.0),
        )
    )

    drifted_count = sum(1 for c in column_drifts if c["status"] == "drifted")
    moderate_count = sum(1 for c in column_drifts if c["status"] == "moderate")
    stable_count = sum(1 for c in column_drifts if c["status"] == "stable")

    if drifted_count > 0 or added_columns or removed_columns or type_changes:
        overall_status = "drifted"
    elif moderate_count > 0:
        overall_status = "moderate"
    else:
        overall_status = "stable"

    b_score = (b_prof.get("quality") or {}).get("overall_score")
    c_score = (c_prof.get("quality") or {}).get("overall_score")
    row_delta = len(c_rows) - len(b_rows)
    row_pct = round(100.0 * row_delta / len(b_rows), 2) if b_rows else 0.0

    return {
        "baseline": {
            "id": str(baseline.pk),
            "filename": baseline.filename,
            "file_format": baseline.file_format,
            "row_count": len(b_rows),
            "column_count": len(b_cols),
            "overall_score": b_score,
        },
        "candidate": {
            "id": str(candidate.pk),
            "filename": candidate.filename,
            "file_format": candidate.file_format,
            "row_count": len(c_rows),
            "column_count": len(c_cols),
            "overall_score": c_score,
        },
        "summary": {
            "status": overall_status,
            "row_count_delta": row_delta,
            "row_count_pct_change": row_pct,
            "score_delta": (
                round(c_score - b_score, 1)
                if isinstance(b_score, (int, float)) and isinstance(c_score, (int, float))
                else None
            ),
            "drifted_columns": drifted_count,
            "moderate_columns": moderate_count,
            "stable_columns": stable_count,
            "max_psi": round(max_psi, 4),
            "max_ks": round(max_ks, 4),
            "max_jsd": round(max_jsd, 4),
        },
        "schema_drift": {
            "added_columns": added_columns,
            "removed_columns": removed_columns,
            "type_changes": type_changes,
            "common_column_count": len(common_columns),
        },
        "columns": column_drifts,
    }
