"""Prompt strategy metadata audits are read-only and do not call Gemini."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from ai_remediation.evaluation import summarize_reports
from ai_remediation.prompts import make_prompt
from ai_remediation.validation import InvalidAIOutput, validate_report


def _report(technique, status, result):
    start = datetime(2026, 11, 7, tzinfo=UTC)
    return SimpleNamespace(
        technique=technique, status=status, result=result,
        started_at=start, completed_at=start + timedelta(seconds=3),
    )


def test_all_four_prompt_techniques_share_evidence_safety_constraints():
    evidence = {"row_count": 10, "columns": [], "findings": []}
    techniques = ("zero_shot", "few_shot", "stepwise", "role_based")
    compiled = [make_prompt(item, evidence) for item in techniques]
    assert len({prompt for _, prompt in compiled}) == 4
    assert len({system for system, _ in compiled}) == 1
    for system, prompt in compiled:
        assert "UNTRUSTED AGGREGATE EVIDENCE" in prompt
        assert "Never propose executing SQL" in system
        assert "human review" in system


def test_evaluator_counts_recognized_evidence_without_claiming_accuracy():
    result = {
        "evidence": {"findings": [{"id": "F1"}], "columns": [{"id": "C1"}]},
        "recommendations": [{"evidence_ids": ["F1", "invalid"]}],
    }
    audit = summarize_reports([
        _report("few_shot", "ready", result),
        _report("zero_shot", "failed", {}),
    ])
    assert audit["report_count"] == 2
    few_shot = audit["by_technique"]["few_shot"]
    assert few_shot["recommendations"] == 1
    assert few_shot["recognized_reference_fraction"] == 0.5
    assert few_shot["mean_completed_seconds"] == 3
    assert audit["by_technique"]["zero_shot"]["failed"] == 1
    assert "not a randomized" in audit["interpretation"]


def test_validated_recommendation_rejects_invented_evidence():
    evidence = {"columns": [{"id": "C1"}], "findings": []}
    raw = {
        "summary": "Review the dataset", "limitations": ["No raw rows supplied"],
        "recommendations": [{
            "title": "Inspect data", "action": "inspect", "priority": "low",
            "rationale": "Review the column", "evidence_ids": ["C1"],
            "steps": ["Check the source schema"], "verification": "Re-run the profile",
        }],
    }
    assert validate_report(raw, evidence)["approval_required"] is True
    raw["recommendations"][0]["evidence_ids"] = ["C99"]
    try:
        validate_report(raw, evidence)
    except InvalidAIOutput:
        pass
    else:
        raise AssertionError("Unrecognized evidence should not pass validation")
