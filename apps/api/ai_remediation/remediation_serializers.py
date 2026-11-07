"""Typed preview, approval and read-only lineage representations."""

from rest_framework import serializers

from .models import RemediationRun
from .remediation import ALLOWED_OPERATIONS


class PreviewCreateSerializer(serializers.Serializer):
    report_id = serializers.UUIDField()
    operations = serializers.ListField(
        child=serializers.ChoiceField(choices=ALLOWED_OPERATIONS),
        allow_empty=False,
        max_length=2,
    )

    def validate_operations(self, operations):
        if len(operations) != len(set(operations)):
            raise serializers.ValidationError("Choose each operation once.")
        return operations


class ApproveSerializer(serializers.Serializer):
    approve = serializers.BooleanField(required=True)

    def validate_approve(self, value):
        if value is not True:
            raise serializers.ValidationError("Explicit approval is required.")
        return value


class RemediationRunSerializer(serializers.ModelSerializer):
    result_dataset_id = serializers.UUIDField(read_only=True)
    report_id = serializers.UUIDField(read_only=True)
    requested_by_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = RemediationRun
        fields = (
            "id", "dataset", "report_id", "requested_by_id", "operations",
            "status", "preview", "validation", "result_dataset_id", "created_at", "applied_at",
        )
        read_only_fields = fields
