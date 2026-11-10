"""Read-only, evidence-reference audit for saved Gemini analyses.

The metrics are structural checks, not ground-truth quality or model accuracy.
"""

from collections import defaultdict
from collections.abc import Iterable
from datetime import datetime


def _references(result: object) -> tuple[int, int]:
    if not isinstance(result, dict):
        return 0, 0
    evidence = result.get("evidence")
    if not isinstance(evidence, dict):
        return 0, 0
    allowed = set()
    for category in ("columns", "findings"):
        items = evidence.get(category, [])
        if isinstance(items, list):
            allowed.update(
                item["id"] for item in items
                if isinstance(item, dict) and isinstance(item.get("id"), str)
            )
    cited = 0
    recognized = 0
    recommendations = result.get("recommendations", [])
    for rec in recommendations if isinstance(recommendations, list) else []:
        if not isinstance(rec, dict) or not isinstance(rec.get("evidence_ids"), list):
            continue
        for value in rec["evidence_ids"]:
            cited += 1
            recognized += int(isinstance(value, str) and value in allowed)
    return cited, recognized


def summarize_reports(reports: Iterable[object]) -> dict:
    buckets = defaultdict(lambda: {
        "reports": 0, "ready": 0, "failed": 0,
        "recommendations": 0, "evidence_references": 0,
        "recognized_references": 0, "latency_count": 0,
        "latency_seconds_total": 0.0,
    })
    total = 0
    for report in reports:
        total += 1
        technique = str(getattr(report, "technique", "unknown"))
        state = str(getattr(report, "status", "unknown"))
        bucket = buckets[technique]
        bucket["reports"] += 1
        bucket["ready"] += int(state == "ready")
        bucket["failed"] += int(state == "failed")
        if state != "ready":
            continue
        result = getattr(report, "result", {})
        if isinstance(result, dict) and isinstance(result.get("recommendations"), list):
            bucket["recommendations"] += len(result["recommendations"])
        cited, recognized = _references(result)
        bucket["evidence_references"] += cited
        bucket["recognized_references"] += recognized
        started = getattr(report, "started_at", None)
        finished = getattr(report, "completed_at", None)
        if isinstance(started, datetime) and isinstance(finished, datetime) and finished >= started:
            bucket["latency_count"] += 1
            bucket["latency_seconds_total"] += (finished - started).total_seconds()
    cleaned = {}
    for technique, values in sorted(buckets.items()):
        count = values.pop("latency_count")
        seconds = values.pop("latency_seconds_total")
        values["mean_completed_seconds"] = round(seconds / count, 3) if count else None
        values["recognized_reference_fraction"] = (
            round(values["recognized_references"] / values["evidence_references"], 4)
            if values["evidence_references"] else None
        )
        cleaned[technique] = values
    return {
        "report_count": total,
        "by_technique": cleaned,
        "interpretation": (
            "Descriptive audit only. This is not a randomized prompt comparison, "
            "factuality score, improvement rate, or quality ranking."
        ),
    }
