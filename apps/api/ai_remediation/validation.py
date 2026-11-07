"""Reject unsupported model recommendations before persistence."""

ALLOWED_ACTIONS = {
    "inspect", "review_duplicates", "review_missingness",
    "standardize_format", "retain_as_is",
}
ALLOWED_PRIORITY = {"high", "medium", "low"}


class InvalidAIOutput(Exception):
    pass


def _short_text(value, limit=600) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise InvalidAIOutput("invalid_text")
    return value.strip()


def validate_report(value: object, evidence: dict) -> dict:
    if not isinstance(value, dict):
        raise InvalidAIOutput("invalid_root")
    summary = _short_text(value.get("summary"), 1000)
    limitations = value.get("limitations")
    items = value.get("recommendations")
    if (not isinstance(limitations, list) or len(limitations) > 6
            or not isinstance(items, list) or len(items) > 5):
        raise InvalidAIOutput("invalid_collections")
    allowed = {x["id"] for x in evidence["findings"] + evidence["columns"]}
    cleaned = []
    for item in items:
        if not isinstance(item, dict):
            raise InvalidAIOutput("invalid_item")
        ids = item.get("evidence_ids")
        steps = item.get("steps")
        if (not isinstance(ids, list) or not ids or len(ids) > 6
                or any(not isinstance(i, str) or i not in allowed for i in ids)):
            raise InvalidAIOutput("invalid_evidence_reference")
        if not isinstance(steps, list) or not 1 <= len(steps) <= 5:
            raise InvalidAIOutput("invalid_steps")
        action = item.get("action")
        priority = item.get("priority")
        if (not isinstance(action, str) or action not in ALLOWED_ACTIONS
                or not isinstance(priority, str) or priority not in ALLOWED_PRIORITY):
            raise InvalidAIOutput("invalid_action")
        cleaned.append({
            "title": _short_text(item.get("title"), 120),
            "action": action,
            "priority": priority,
            "rationale": _short_text(item.get("rationale"), 650),
            "evidence_ids": list(dict.fromkeys(ids)),
            "steps": [_short_text(step, 170) for step in steps],
            "verification": _short_text(item.get("verification"), 350),
        })
    return {
        "summary": summary,
        "limitations": [_short_text(item, 240) for item in limitations],
        "recommendations": cleaned,
        "evidence": evidence,
        "approval_required": True,
        "method": "gemini-evidence-grounded-v1",
    }
