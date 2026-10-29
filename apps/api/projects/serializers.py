from rest_framework import serializers

from .models import Project


class ProjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Project
        fields = ("id", "workspace", "name", "description", "created_at", "updated_at")
        read_only_fields = ("id", "workspace", "created_at", "updated_at")

    def validate_name(self, value):
        workspace = self.context["workspace"]
        query = Project.objects.filter(workspace=workspace, name__iexact=value)
        if self.instance:
            query = query.exclude(pk=self.instance.pk)
        if query.exists():
            raise serializers.ValidationError("A project with this name already exists")
        return value
