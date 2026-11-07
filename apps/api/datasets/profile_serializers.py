"""Read-only representation of persisted dataset profiles."""

from rest_framework import serializers

from .models import DatasetProfile


class DatasetProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = DatasetProfile
        fields = (
            "dataset",
            "status",
            "schema_version",
            "result",
            "error_code",
            "started_at",
            "completed_at",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields
