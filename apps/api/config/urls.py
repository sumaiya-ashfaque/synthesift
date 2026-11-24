"""API routing; unimplemented product routes are not exposed."""

from django.urls import path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from ai_remediation.api import AIReportDetailView, AIReportListView
from ai_remediation.eval_api import (
    AIGuardrailBenchmarkView,
    AIReportDraftPipelineView,
    ProjectAIEvalSummaryView,
)
from ai_remediation.remediation_api import (
    RemediationDetailView,
    RemediationExportView,
    RemediationListView,
)
from contracts_engine.api import (
    ContractEvaluateView,
    DataContractAutoGenerateView,
    DataContractDetailView,
    DataContractListView,
    DataContractYamlExportView,
    DataContractYamlImportView,
    DatasetContractRunsView,
)
from core.views import LiveView, MetadataView, ReadyView
from datasets.api import DatasetDetailView, DatasetListView
from datasets.demo_api import DatasetDemoSeedView
from datasets.library_api import DatasetLibraryImportView, DatasetLibraryView
from datasets.profile_api import DatasetProfileView
from datasets.rows_api import DatasetRowsView
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
from pipelines.api import (
    DriftCompareView,
    PipelineApproveView,
    PipelineCodeExportView,
    PipelineExportView,
    PipelineRunListView,
    PipelineSuggestView,
    ProjectLineageView,
    RecipeDetailView,
    RecipeListView,
)
from projects.api import ProjectDetailView, ProjectListView

urlpatterns = [
    path("api/v1/dataset-library", DatasetLibraryView.as_view(), name="dataset-library"),
    path("api/v1/workspaces/<uuid:workspace_id>/projects/<uuid:project_id>/datasets/import", DatasetLibraryImportView.as_view(), name="dataset-library-import"),
    path("api/v1/workspaces/<uuid:workspace_id>/projects/<uuid:project_id>/datasets/seed-demo", DatasetDemoSeedView.as_view(), name="dataset-seed-demo"),
    
    path(
        "api/v1/workspaces/<uuid:workspace_id>/projects/<uuid:project_id>/datasets",
        DatasetListView.as_view(),
        name="project-datasets",
    ),
    path(
        "api/v1/workspaces/<uuid:workspace_id>/projects/<uuid:project_id>/datasets/<uuid:dataset_id>",
        DatasetDetailView.as_view(),
        name="project-dataset-detail",
    ),
    path(
        "api/v1/workspaces/<uuid:workspace_id>/projects/<uuid:project_id>/datasets/<uuid:dataset_id>/rows",
        DatasetRowsView.as_view(),
        name="project-dataset-rows",
    ),

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
    path(
        "api/v1/workspaces/<uuid:workspace_id>/projects/"
        "<uuid:project_id>/datasets/<uuid:dataset_id>/profile",
        DatasetProfileView.as_view(),
        name="project-dataset-profile",
    ),
    path(
        "api/v1/workspaces/<uuid:workspace_id>/projects/"
        "<uuid:project_id>/datasets/<uuid:dataset_id>/ai-reports",
        AIReportListView.as_view(),
        name="dataset-ai-reports",
    ),
    path(
        "api/v1/workspaces/<uuid:workspace_id>/projects/"
        "<uuid:project_id>/datasets/<uuid:dataset_id>/ai-reports/<uuid:report_id>",
        AIReportDetailView.as_view(),
        name="dataset-ai-report-detail",
    ),
    path(
        "api/v1/workspaces/<uuid:workspace_id>/projects/"
        "<uuid:project_id>/datasets/<uuid:dataset_id>/ai-reports/<uuid:report_id>/draft-pipeline",
        AIReportDraftPipelineView.as_view(),
        name="dataset-ai-report-draft-pipeline",
    ),
    path(
        "api/v1/workspaces/<uuid:workspace_id>/projects/<uuid:project_id>/ai-evals",
        ProjectAIEvalSummaryView.as_view(),
        name="project-ai-evals",
    ),
    path(
        "api/v1/workspaces/<uuid:workspace_id>/projects/<uuid:project_id>/ai-evals/offline-benchmark",
        AIGuardrailBenchmarkView.as_view(),
        name="project-ai-evals-offline-benchmark",
    ),
    path(
        "api/v1/workspaces/<uuid:workspace_id>/projects/"
        "<uuid:project_id>/datasets/<uuid:dataset_id>/remediations",
        RemediationListView.as_view(), name="dataset-remediations",
    ),
    path(
        "api/v1/workspaces/<uuid:workspace_id>/projects/"
        "<uuid:project_id>/datasets/<uuid:dataset_id>/remediations/<uuid:run_id>",
        RemediationDetailView.as_view(), name="dataset-remediation-detail",
    ),
    path(
        "api/v1/workspaces/<uuid:workspace_id>/projects/"
        "<uuid:project_id>/datasets/<uuid:dataset_id>/remediations/<uuid:run_id>/export",
        RemediationExportView.as_view(), name="dataset-remediation-export",
    ),
    path(
        "api/v1/workspaces/<uuid:workspace_id>/projects/<uuid:project_id>/recipes",
        RecipeListView.as_view(), name="project-recipes",
    ),
    path(
        "api/v1/workspaces/<uuid:workspace_id>/projects/<uuid:project_id>/recipes/<uuid:recipe_id>",
        RecipeDetailView.as_view(), name="project-recipe-detail",
    ),
    path(
        "api/v1/workspaces/<uuid:workspace_id>/projects/<uuid:project_id>/lineage",
        ProjectLineageView.as_view(), name="project-lineage",
    ),
    path(
        "api/v1/workspaces/<uuid:workspace_id>/projects/<uuid:project_id>/drift/compare",
        DriftCompareView.as_view(), name="project-drift-compare",
    ),
    path(
        "api/v1/workspaces/<uuid:workspace_id>/projects/<uuid:project_id>/datasets/<uuid:dataset_id>/pipelines",
        PipelineRunListView.as_view(), name="dataset-pipelines",
    ),
    path(
        "api/v1/workspaces/<uuid:workspace_id>/projects/<uuid:project_id>/datasets/<uuid:dataset_id>/pipelines/suggest",
        PipelineSuggestView.as_view(), name="dataset-pipeline-suggest",
    ),
    path(
        "api/v1/workspaces/<uuid:workspace_id>/projects/<uuid:project_id>/datasets/<uuid:dataset_id>/pipelines/export-code",
        PipelineCodeExportView.as_view(), name="dataset-pipeline-export-code",
    ),
    path(
        "api/v1/workspaces/<uuid:workspace_id>/projects/<uuid:project_id>/datasets/<uuid:dataset_id>/pipelines/<uuid:run_id>/approve",
        PipelineApproveView.as_view(), name="dataset-pipeline-approve",
    ),
    path(
        "api/v1/workspaces/<uuid:workspace_id>/projects/<uuid:project_id>/datasets/<uuid:dataset_id>/pipelines/<uuid:run_id>/export",
        PipelineExportView.as_view(), name="dataset-pipeline-export",
    ),
    path(
        "api/v1/workspaces/<uuid:workspace_id>/projects/<uuid:project_id>/contracts",
        DataContractListView.as_view(), name="project-contracts",
    ),
    path(
        "api/v1/workspaces/<uuid:workspace_id>/projects/<uuid:project_id>/contracts/import-yaml",
        DataContractYamlImportView.as_view(), name="project-contracts-import-yaml",
    ),
    path(
        "api/v1/workspaces/<uuid:workspace_id>/projects/<uuid:project_id>/contracts/<uuid:contract_id>",
        DataContractDetailView.as_view(), name="project-contract-detail",
    ),
    path(
        "api/v1/workspaces/<uuid:workspace_id>/projects/<uuid:project_id>/contracts/<uuid:contract_id>/yaml",
        DataContractYamlExportView.as_view(), name="project-contract-yaml",
    ),
    path(
        "api/v1/workspaces/<uuid:workspace_id>/projects/<uuid:project_id>/datasets/<uuid:dataset_id>/contracts/auto-generate",
        DataContractAutoGenerateView.as_view(), name="dataset-contract-autogenerate",
    ),
    path(
        "api/v1/workspaces/<uuid:workspace_id>/projects/<uuid:project_id>/datasets/<uuid:dataset_id>/contracts/<uuid:contract_id>/evaluate",
        ContractEvaluateView.as_view(), name="dataset-contract-evaluate",
    ),
    path(
        "api/v1/workspaces/<uuid:workspace_id>/projects/<uuid:project_id>/datasets/<uuid:dataset_id>/contract-runs",
        DatasetContractRunsView.as_view(), name="dataset-contract-runs",
    ),
]
