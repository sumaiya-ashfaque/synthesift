"""Project operations are always resolved through workspace authorization."""

from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from identity.policy import get_workspace, require_role

from .models import Project
from .serializers import ProjectSerializer


class ProjectListView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["projects"], responses={200: ProjectSerializer(many=True)})
    def get(self, request, workspace_id):
        workspace = get_workspace(request.user, workspace_id)
        return Response(ProjectSerializer(workspace.projects.all(), many=True).data)

    @extend_schema(tags=["projects"], request=ProjectSerializer, responses={201: ProjectSerializer})
    def post(self, request, workspace_id):
        workspace = get_workspace(request.user, workspace_id)
        require_role(request.user, workspace, {"owner", "editor"})
        serializer = ProjectSerializer(data=request.data, context={"workspace": workspace})
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                instance = serializer.save(workspace=workspace)
        except IntegrityError as exc:
            raise ValidationError({"name": ["Project name unavailable"]}) from exc
        return Response(ProjectSerializer(instance).data, status=status.HTTP_201_CREATED)


class ProjectDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["projects"], responses={200: ProjectSerializer})
    def get(self, request, workspace_id, project_id):
        workspace = get_workspace(request.user, workspace_id)
        project = get_object_or_404(Project, workspace=workspace, pk=project_id)
        return Response(ProjectSerializer(project).data)

    @extend_schema(tags=["projects"], request=ProjectSerializer, responses={200: ProjectSerializer})
    def patch(self, request, workspace_id, project_id):
        workspace = get_workspace(request.user, workspace_id)
        project = get_object_or_404(Project, workspace=workspace, pk=project_id)
        require_role(request.user, workspace, {"owner", "editor"})
        serializer = ProjectSerializer(project, data=request.data, partial=True, context={"workspace": workspace})
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                instance = serializer.save()
        except IntegrityError as exc:
            raise ValidationError({"name": ["Project name unavailable"]}) from exc
        return Response(ProjectSerializer(instance).data)

    @extend_schema(tags=["projects"], responses={204: None})
    def delete(self, request, workspace_id, project_id):
        workspace = get_workspace(request.user, workspace_id)
        project = get_object_or_404(Project, workspace=workspace, pk=project_id)
        require_role(request.user, workspace, {"owner"})
        project.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
