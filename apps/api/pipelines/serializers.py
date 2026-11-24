"""Serializers for transformation recipes, pipeline runs, and code export."""

from rest_framework import serializers

from .models import PipelineRun, TransformationRecipe


class TransformationRecipeSerializer(serializers.ModelSerializer):
    created_by = serializers.CharField(source="created_by.username", read_only=True, default=None)

    class Meta:
        model = TransformationRecipe
        fields = (
            "id",
            "project",
            "name",
            "description",
            "steps",
            "created_by",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "project", "created_by", "created_at", "updated_at")


class PipelinePreviewRequestSerializer(serializers.Serializer):
    steps = serializers.ListField(child=serializers.DictField(), min_length=1, max_length=25)
    recipe_id = serializers.UUIDField(required=False, allow_null=True)
    mask_pii = serializers.BooleanField(required=False, default=True)


class PipelineApproveSerializer(serializers.Serializer):
    approve = serializers.BooleanField()
    output_filename = serializers.CharField(max_length=180, required=False, allow_blank=True)

    def validate_approve(self, value):
        if value is not True:
            raise serializers.ValidationError("Explicit approval (approve=true) is required.")
        return value


class PipelineCodeExportSerializer(serializers.Serializer):
    steps = serializers.ListField(child=serializers.DictField(), min_length=1, max_length=25)
    language = serializers.ChoiceField(choices=("polars", "pandas", "sql"), default="polars")


class DriftCompareRequestSerializer(serializers.Serializer):
    baseline_dataset_id = serializers.UUIDField()
    candidate_dataset_id = serializers.UUIDField()


class PipelineRunSerializer(serializers.ModelSerializer):
    created_by = serializers.CharField(source="created_by.username", read_only=True, default=None)
    source_dataset_id = serializers.UUIDField(source="source_dataset.id", read_only=True)
    result_dataset_id = serializers.UUIDField(
        source="result_dataset.id", read_only=True, default=None
    )
    recipe_id = serializers.UUIDField(source="recipe.id", read_only=True, default=None)

    class Meta:
        model = PipelineRun
        fields = (
            "id",
            "source_dataset_id",
            "recipe_id",
            "created_by",
            "steps",
            "status",
            "source_sha256",
            "preview_summary",
            "validation",
            "result_dataset_id",
            "created_at",
            "applied_at",
        )
        read_only_fields = fields
