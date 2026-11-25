"""RBAC-authorized endpoints for Data Contracts, YAML import/export, and Gate Runs."""

from __future__ import annotations

from django.db import IntegrityError, transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from datasets.api import authorized_project
from datasets.formats import AdmissionError
from datasets.models import Dataset, DatasetProfile
from identity.policy import require_role

from .models import ContractRun, DataContract
from .rules import (
    ContractRuleError,
    auto_generate_contract_rules,
    contract_to_yaml,
    evaluate_contract,
    parse_contract_yaml,
    validate_rules,
)
from .serializers import (
    ContractRunSerializer,
    ContractYamlImportSerializer,
    DataContractSerializer,
)


class ContractDatasetNotReady(APIException):
    status_code = 409
    default_detail = "Dataset must be ready before evaluating a Data Contract."
    default_code = "dataset_not_ready"


class DataContractListView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["contracts"], responses={200: DataContractSerializer(many=True)})
    def get(self, request, workspace_id, project_id):
        _, project = authorized_project(request.user, workspace_id, project_id)
        items = DataContract.objects.filter(project=project).select_related("created_by")[:100]
        return Response(DataContractSerializer(items, many=True).data)

    @extend_schema(
        tags=["contracts"],
        request=DataContractSerializer,
        responses={201: DataContractSerializer},
    )
    def post(self, request, workspace_id, project_id):
        workspace, project = authorized_project(request.user, workspace_id, project_id)
        require_role(request.user, workspace, {"owner", "editor"})
        serializer = DataContractSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            rules = validate_rules(serializer.validated_data["rules"])
        except ContractRuleError as exc:
            raise ValidationError({"rules": [exc.message]}) from exc
        try:
            with transaction.atomic():
                contract = DataContract.objects.create(
                    project=project,
                    created_by=request.user,
                    name=serializer.validated_data["name"].strip(),
                    description=serializer.validated_data.get("description", ""),
                    rules=rules,
                )
        except IntegrityError as exc:
            raise ValidationError({"name": ["A contract with this name already exists."]}) from exc
        return Response(DataContractSerializer(contract).data, status=status.HTTP_201_CREATED)


class DataContractDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["contracts"], responses={200: DataContractSerializer})
    def get(self, request, workspace_id, project_id, contract_id):
        _, project = authorized_project(request.user, workspace_id, project_id)
        contract = get_object_or_404(DataContract, pk=contract_id, project=project)
        return Response(DataContractSerializer(contract).data)

    @extend_schema(
        tags=["contracts"],
        request=DataContractSerializer,
        responses={200: DataContractSerializer},
    )
    def patch(self, request, workspace_id, project_id, contract_id):
        workspace, project = authorized_project(request.user, workspace_id, project_id)
        require_role(request.user, workspace, {"owner", "editor"})
        contract = get_object_or_404(DataContract, pk=contract_id, project=project)
        serializer = DataContractSerializer(contract, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        if "rules" in serializer.validated_data:
            try:
                serializer.validated_data["rules"] = validate_rules(serializer.validated_data["rules"])
            except ContractRuleError as exc:
                raise ValidationError({"rules": [exc.message]}) from exc
            contract.version += 1
        try:
            contract = serializer.save(version=contract.version)
        except IntegrityError as exc:
            raise ValidationError({"name": ["A contract with this name already exists."]}) from exc
        return Response(DataContractSerializer(contract).data)

    @extend_schema(tags=["contracts"], responses={204: None})
    def delete(self, request, workspace_id, project_id, contract_id):
        workspace, project = authorized_project(request.user, workspace_id, project_id)
        require_role(request.user, workspace, {"owner", "editor"})
        contract = get_object_or_404(DataContract, pk=contract_id, project=project)
        contract.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class DataContractYamlExportView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["contracts"], responses={200: OpenApiResponse(description="Declarative YAML contract")})
    def get(self, request, workspace_id, project_id, contract_id):
        _, project = authorized_project(request.user, workspace_id, project_id)
        contract = get_object_or_404(DataContract, pk=contract_id, project=project)
        content = contract_to_yaml(contract.name, contract.description, contract.version, contract.rules)
        if request.query_params.get("raw") == "1":
            response = HttpResponse(content, content_type="application/x-yaml; charset=utf-8")
            response["Content-Disposition"] = f'attachment; filename="contract_{str(contract.pk)[:8]}.yaml"'
            return response
        return Response({"yaml": content})


class DataContractYamlImportView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["contracts"],
        request=ContractYamlImportSerializer,
        responses={201: DataContractSerializer},
    )
    def post(self, request, workspace_id, project_id):
        workspace, project = authorized_project(request.user, workspace_id, project_id)
        require_role(request.user, workspace, {"owner", "editor"})
        serializer = ContractYamlImportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            parsed = parse_contract_yaml(serializer.validated_data["yaml"])
        except ContractRuleError as exc:
            raise ValidationError({"yaml": [exc.message]}) from exc
        try:
            with transaction.atomic():
                contract = DataContract.objects.create(
                    project=project,
                    created_by=request.user,
                    name=parsed["name"],
                    description=parsed["description"],
                    rules=parsed["rules"],
                )
        except IntegrityError as exc:
            raise ValidationError({"yaml": ["A contract with this name already exists."]}) from exc
        return Response(DataContractSerializer(contract).data, status=status.HTTP_201_CREATED)


class DataContractAutoGenerateView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["contracts"], request=None, responses={200: OpenApiResponse(description="Generated starter rules")})
    def post(self, request, workspace_id, project_id, dataset_id):
        _, project = authorized_project(request.user, workspace_id, project_id)
        dataset = get_object_or_404(Dataset, pk=dataset_id, project=project)
        profile = DatasetProfile.objects.filter(
            dataset=dataset, status=DatasetProfile.Status.READY
        ).first()
        if not profile or not isinstance(profile.result, dict):
            return Response({"rules": [], "yaml": "", "reason": "Profile the dataset first."})
        rules = auto_generate_contract_rules(profile.result)
        suggested_name = f"{dataset.filename.rsplit('.', 1)[0]}_contract"[:100]
        return Response(
            {
                "name": suggested_name,
                "rules": rules,
                "yaml": contract_to_yaml(
                    suggested_name, f"Auto-generated contract from {dataset.filename}", 1, rules
                ),
            }
        )


class ContractEvaluateView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["contracts"], request=None, responses={201: ContractRunSerializer})
    def post(self, request, workspace_id, project_id, dataset_id, contract_id):
        workspace, project = authorized_project(request.user, workspace_id, project_id)
        require_role(request.user, workspace, {"owner", "editor"})
        dataset = get_object_or_404(Dataset, pk=dataset_id, project=project)
        if dataset.status != Dataset.Status.READY:
            raise ContractDatasetNotReady()
        contract = get_object_or_404(DataContract, pk=contract_id, project=project)
        try:
            outcome = evaluate_contract(dataset, contract.rules)
        except (ContractRuleError, AdmissionError, OSError, ValueError) as exc:
            raise ValidationError({"contract": [str(exc)]}) from exc

        run = ContractRun.objects.create(
            contract=contract,
            dataset=dataset,
            triggered_by=request.user,
            status=outcome["status"],
            passed_rules=outcome["passed_rules"],
            failed_rules=outcome["failed_rules"],
            total_rules=outcome["total_rules"],
            pass_rate=outcome["pass_rate"],
            results=outcome["results"],
        )
        from governance.services import record_audit_event

        record_audit_event(
            workspace,
            actor=request.user,
            action="contract.evaluated",
            resource_type="data_contract",
            resource_id=str(contract.id),
            outcome="success" if outcome["status"] == "passed" else ("warning" if outcome["status"] == "warning" else "blocked"),
            metadata={
                "contract_name": contract.name,
                "dataset_filename": dataset.filename,
                "pass_rate": outcome["pass_rate"],
            },
        )
        return Response(ContractRunSerializer(run).data, status=status.HTTP_201_CREATED)


class DatasetContractRunsView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["contracts"], responses={200: ContractRunSerializer(many=True)})
    def get(self, request, workspace_id, project_id, dataset_id):
        _, project = authorized_project(request.user, workspace_id, project_id)
        dataset = get_object_or_404(Dataset, pk=dataset_id, project=project)
        runs = ContractRun.objects.filter(dataset=dataset).select_related(
            "contract", "triggered_by"
        )[:30]
        return Response(ContractRunSerializer(runs, many=True).data)
