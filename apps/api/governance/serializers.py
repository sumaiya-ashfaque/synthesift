"""Serializers for Personal Access Tokens, Audit Trail, Webhooks, and CI/CD Gate."""

from rest_framework import serializers

from .models import AuditEvent, PersonalAccessToken, WebhookDelivery, WebhookEndpoint


class PersonalAccessTokenSerializer(serializers.ModelSerializer):
    created_by = serializers.CharField(source="created_by.username", read_only=True)
    is_revoked = serializers.SerializerMethodField()

    class Meta:
        model = PersonalAccessToken
        fields = (
            "id",
            "workspace",
            "name",
            "token_prefix",
            "scopes",
            "expires_at",
            "last_used_at",
            "revoked_at",
            "is_revoked",
            "created_by",
            "created_at",
        )
        read_only_fields = fields

    def get_is_revoked(self, obj: PersonalAccessToken) -> bool:
        return obj.revoked_at is not None


class PersonalAccessTokenCreateSerializer(serializers.Serializer):
    name = serializers.CharField(min_length=2, max_length=120)
    scopes = serializers.ListField(
        child=serializers.ChoiceField(choices=["read", "write", "gate:run"]),
        default=["read", "gate:run"],
        min_length=1,
        max_length=3,
    )
    expires_in_days = serializers.IntegerField(min_value=1, max_value=365, required=False, allow_null=True)


class AuditEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditEvent
        fields = (
            "id",
            "workspace",
            "actor_label",
            "action",
            "resource_type",
            "resource_id",
            "outcome",
            "metadata",
            "created_at",
        )
        read_only_fields = fields


class WebhookEndpointSerializer(serializers.ModelSerializer):
    created_by = serializers.CharField(source="created_by.username", read_only=True, default=None)
    secret_preview = serializers.SerializerMethodField()

    class Meta:
        model = WebhookEndpoint
        fields = (
            "id",
            "workspace",
            "name",
            "url",
            "events",
            "is_active",
            "secret_preview",
            "created_by",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "workspace", "secret_preview", "created_by", "created_at", "updated_at")

    def get_secret_preview(self, obj: WebhookEndpoint) -> str:
        return f"{obj.signing_secret[:10]}••••" if obj.signing_secret else ""


class WebhookEndpointWriteSerializer(serializers.Serializer):
    name = serializers.CharField(min_length=2, max_length=120)
    url = serializers.URLField(max_length=500)
    events = serializers.ListField(
        child=serializers.CharField(max_length=60),
        min_length=1,
        max_length=10,
    )
    is_active = serializers.BooleanField(default=True)


class WebhookDeliverySerializer(serializers.ModelSerializer):
    class Meta:
        model = WebhookDelivery
        fields = (
            "id",
            "endpoint",
            "event_type",
            "status",
            "http_status",
            "response_excerpt",
            "payload_summary",
            "duration_ms",
            "created_at",
        )
        read_only_fields = fields
