"""Constrained, transparent API contract for user-initiated AI reports."""

from decimal import Decimal

from rest_framework import serializers

from .models import AIReport

MODELS = (
    "gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-2.5-flash"
)


class AIReportCreateSerializer(serializers.Serializer):
    technique = serializers.ChoiceField(choices=AIReport.Technique.choices)
    model = serializers.ChoiceField(choices=MODELS, default=MODELS[0])
    thinking_level = serializers.ChoiceField(
        choices=("minimal", "low", "medium", "high"), default="low"
    )
    temperature = serializers.DecimalField(
        max_digits=3, decimal_places=2, min_value=Decimal("0.00"),
        max_value=Decimal("1.00"), allow_null=True, required=False,
    )
    max_output_tokens = serializers.IntegerField(
        min_value=1024, max_value=8192, default=3072
    )
    user_prompt = serializers.CharField(max_length=600, allow_blank=True, required=False, trim_whitespace=True)
    consent_external_processing = serializers.BooleanField()

    def validate(self, attrs):
        if not attrs["consent_external_processing"]:
            raise serializers.ValidationError({
                "consent_external_processing": "Explicit external processing consent is required."
            })
        if attrs["model"].startswith("gemini-3.") and attrs.get("temperature") is not None:
            raise serializers.ValidationError({
                "temperature": "Gemini 3 uses its recommended sampling defaults; choose thinking level."
            })
        if attrs["model"] == "gemini-3.8-flash" and attrs["thinking_level"] == "minimal":
            raise serializers.ValidationError({
                "thinking_level": "Gemini 3.8 Flash requires low, medium, or high."
            })
        if attrs["model"] == "gemini-2.5-flash":
            if attrs["thinking_level"] != "low":
                raise serializers.ValidationError({
                    "thinking_level": "Thinking level applies to Gemini 3 models."
                })
        return attrs


class AIReportSerializer(serializers.ModelSerializer):
    class Meta:
        model = AIReport
        fields = (
            "id", "dataset", "status", "technique", "model", "thinking_level",
            "temperature", "max_output_tokens", "profile_digest", "user_prompt", "result",
            "error_code", "created_at", "started_at", "completed_at",
        )
        read_only_fields = fields
