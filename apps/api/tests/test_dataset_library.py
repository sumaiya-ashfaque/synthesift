"""Library permissions, copy independence, and access isolation."""

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from datasets.models import Dataset
from identity.models import Workspace, WorkspaceMembership
from projects.models import Project


@pytest.mark.django_db
class TestDatasetLibrary:
    def setup_method(self):
        user_model = get_user_model()
        self.owner = user_model.objects.create_user(username="library_owner", password="secret")
        self.other = user_model.objects.create_user(username="library_other", password="secret")
        self.ws = Workspace.objects.create(owner=self.owner, name="Quality")
        self.source_project = Project.objects.create(workspace=self.ws, name="Source")
        self.target_project = Project.objects.create(workspace=self.ws, name="Destination")
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def test_empty_library_is_authorized(self):
        response = self.client.get("/api/v1/dataset-library")
        assert response.status_code == 200
        assert response.data["results"] == []

    def test_cannot_import_into_non_member_project(self):
        self.client.force_authenticate(self.other)
        response = self.client.post(
            f"/api/v1/workspaces/{self.ws.pk}/projects/{self.target_project.pk}/datasets/import",
            {"source_dataset_id": "00000000-0000-0000-0000-000000000001"}, format="json",
        )
        assert response.status_code == 404

    def test_cannot_import_unready_source(self):
        source = Dataset.objects.create(
            project=self.source_project, uploaded_by=self.owner, filename="source.csv",
            storage_key="aa/aa000000000000000000000000000000.csv", sha256="0" * 64, size_bytes=3,
        )
        response = self.client.post(
            f"/api/v1/workspaces/{self.ws.pk}/projects/{self.target_project.pk}/datasets/import",
            {"source_dataset_id": str(source.pk)}, format="json",
        )
        assert response.status_code == 409
        assert Dataset.objects.count() == 1

    def test_viewer_cannot_reuse(self):
        viewer = get_user_model().objects.create_user(username="library_viewer", password="secret")
        WorkspaceMembership.objects.create(user=viewer, workspace=self.ws, role="viewer")
        self.client.force_authenticate(viewer)
        response = self.client.get("/api/v1/dataset-library")
        assert response.status_code == 200
        assert response.data["results"] == []
        response = self.client.post(
            f"/api/v1/workspaces/{self.ws.pk}/projects/{self.target_project.pk}/datasets/import",
            {"source_dataset_id": "00000000-0000-0000-0000-000000000001"}, format="json",
        )
        assert response.status_code == 403

    def test_import_copies_bytes_and_keeps_independent_storage(self, tmp_path, monkeypatch):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from django.test import override_settings

        from datasets.storage import save_upload, storage_path

        monkeypatch.setattr("datasets.library_api.dispatch", lambda dataset: None)
        with override_settings(DATASET_STORAGE_ROOT=tmp_path):
            content = b"customer,value\nA,12\nB,20\n"
            key, digest, size = save_upload(SimpleUploadedFile("source.csv", content))
            source = Dataset.objects.create(
                project=self.source_project, uploaded_by=self.owner, filename="source.csv",
                storage_key=key, sha256=digest, size_bytes=size, status=Dataset.Status.READY,
            )
            url = (
                f"/api/v1/workspaces/{self.ws.pk}/projects/"
                f"{self.target_project.pk}/datasets/import"
            )
            response = self.client.post(url, {"source_dataset_id": str(source.pk)}, format="json")
            assert response.status_code == 202, response.data
            copy = Dataset.objects.exclude(pk=source.pk).get()
            assert copy.project_id == self.target_project.pk
            assert copy.storage_key != source.storage_key
            assert storage_path(copy.storage_key).read_bytes() == content
            storage_path(source.storage_key).unlink()
            assert storage_path(copy.storage_key).read_bytes() == content
