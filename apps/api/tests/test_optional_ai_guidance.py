"""Optional guidance is validated and remains below immutable evidence constraints."""

from ai_remediation.prompts import make_prompt
from ai_remediation.serializers import AIReportCreateSerializer


def options(**updates):
    return {
        "technique": "few_shot",
        "model": "gemini-2.5-flash",
        "thinking_level": "low",
        "max_output_tokens": 3072,
        "consent_external_processing": True,
        **updates,
    }


def test_empty_custom_prompt_is_optional():
    serializer = AIReportCreateSerializer(data=options())
    assert serializer.is_valid(), serializer.errors
    assert "user_prompt" not in serializer.validated_data


def test_custom_prompt_is_bounded_and_kept_as_data():
    serializer = AIReportCreateSerializer(data=options(user_prompt="  Focus on email columns.  "))
    assert serializer.is_valid(), serializer.errors
    assert serializer.validated_data["user_prompt"] == "Focus on email columns."
    system, prompt = make_prompt("few_shot", {"row_count": 12}, serializer.validated_data["user_prompt"])
    assert "Use ONLY supplied aggregate evidence" in system
    assert '"Focus on email columns."' in prompt
    assert "OPTIONAL USER FOCUS" in prompt
    bad = AIReportCreateSerializer(data=options(user_prompt="x" * 601))
    assert not bad.is_valid()
    assert "user_prompt" in bad.errors
