
"""Validation and representation of dataset admissions."""

from pathlib import PurePath

from django.conf import settings
from rest_framework import serializers

from .models import Dataset
from .storage import UploadTooLarge


class DatasetUploadSerializer(serializers.Serializer):
    file = serializers.FileField(allow_empty_file=False)

    def validate_file(self, uploaded):
        name = uploaded.name or ""

        if (
            not name
            or name != PurePath(name.replace("\\", "/")).name
            or len(name) > 255
            or any(ord(char) < 32 or ord(char) == 127 for char in name)
            or not name.lower().endswith(".csv")
        ):
            raise serializers.ValidationError(
                "Provide a CSV file with a valid filename."
            )

        if (
            uploaded.size is not None
            and uploaded.size > settings.DATASET_MAX_UPLOAD_BYTES
        ):
            raise UploadTooLarge()

        return uploaded


class DatasetSerializer(serializers.ModelSerializer):
    class Meta:
        model = Dataset
        fields = (
            "id",
            "project",
            "filename",
            "size_bytes",
            "sha256",
            "status",
            "row_count",
            "column_count",
            "columns",
            "error_code",
            "created_at",
            "completed_at",
        )
        read_only_fields = fields
