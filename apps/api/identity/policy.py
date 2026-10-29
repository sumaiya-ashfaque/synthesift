"""Centralized workspace-scoped authorization decisions."""

from django.db.models import Q
from django.http import Http404
from rest_framework.exceptions import PermissionDenied

from .models import Workspace, WorkspaceMembership


def visible_workspaces(user):
    return Workspace.objects.filter(
        Q(owner=user) | Q(memberships__user=user)
    ).distinct()


def get_workspace(user, workspace_id):
    try:
        return visible_workspaces(user).get(pk=workspace_id)
    except (Workspace.DoesNotExist, ValueError, TypeError) as exc:
        raise Http404 from exc


def role_for(user, workspace):
    if workspace.owner_id == user.pk:
        return "owner"
    return WorkspaceMembership.objects.filter(workspace=workspace, user=user).values_list("role", flat=True).first()


def require_role(user, workspace, allowed):
    if role_for(user, workspace) not in allowed:
        raise PermissionDenied("Insufficient workspace permissions")
