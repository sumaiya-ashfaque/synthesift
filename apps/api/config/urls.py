"""API routing; unimplemented product routes are not exposed."""

from django.urls import path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from core.views import LiveView, MetadataView, ReadyView
from identity.api import (
    CsrfView,
    LoginView,
    LogoutView,
    MembershipDetailView,
    MembershipListView,
    MeView,
    RegisterView,
    WorkspaceDetailView,
    WorkspaceListView,
)
from projects.api import ProjectDetailView, ProjectListView

urlpatterns = [
    path("api/v1/auth/csrf", CsrfView.as_view(), name="auth-csrf"),
    path("api/v1/auth/register", RegisterView.as_view(), name="auth-register"),
    path("api/v1/auth/login", LoginView.as_view(), name="auth-login"),
    path("api/v1/auth/logout", LogoutView.as_view(), name="auth-logout"),
    path("api/v1/auth/me", MeView.as_view(), name="auth-me"),
    path("api/v1/workspaces", WorkspaceListView.as_view(), name="workspaces"),
    path("api/v1/workspaces/<uuid:workspace_id>", WorkspaceDetailView.as_view(), name="workspace-detail"),
    path("api/v1/workspaces/<uuid:workspace_id>/members", MembershipListView.as_view(), name="workspace-members"),
    path("api/v1/workspaces/<uuid:workspace_id>/members/<int:user_id>", MembershipDetailView.as_view(), name="workspace-member-detail"),
    path("api/v1/workspaces/<uuid:workspace_id>/projects", ProjectListView.as_view(), name="projects"),
    path("api/v1/workspaces/<uuid:workspace_id>/projects/<uuid:project_id>", ProjectDetailView.as_view(), name="project-detail"),
    path("api/v1/health/live", LiveView.as_view(), name="health-live"),
    path("api/v1/health/ready", ReadyView.as_view(), name="health-ready"),
    path("api/v1/meta", MetadataView.as_view(), name="meta"),
    path("api/schema/", SpectacularAPIView.as_view(), name="openapi-schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="openapi-schema"), name="api-docs"),
]
