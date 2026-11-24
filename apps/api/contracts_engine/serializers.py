"""Serializers for Data Contracts and Contract Gate Runs."""

from rest_framework import serializers

from .models import ContractRun, DataContract


class DataContractSerializer(serializers.ModelSerializer):
    created_by = serializers.CharField(source="created_by.username", read_only=True, default=None)

    class Meta:
        model = DataContract
        fields = (
            "id",
            "project",
            "name",
            "description",
            "version",
            "rules",
            "created_by",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "project", "version", "created_by", "created_at", "updated_at")


class ContractYamlImportSerializer(serializers.Serializer):
    yaml = serializers.CharField(max_length=50_000)


class ContractRunSerializer(serializers.ModelSerializer):
    contract_id = serializers.UUIDField(source="contract.id", read_only=True)
    contract_name = serializers.CharField(source="contract.name", read_only=True)
    dataset_id = serializers.UUIDField(source="dataset.id", read_only=True)
    triggered_by = serializers.CharField(source="triggered_by.username", read_only=True, default=None)

    class Meta:
        model = ContractRun
        fields = (
            "id",
            "contract_id",
            "contract_name",
            "dataset_id",
            "triggered_by",
            "status",
            "passed_rules",
            "failed_rules",
            "total_rules",
            "pass_rate",
            "results",
            "created_at",
        )
        read_only_fields = fields
