"""Typed API representations for identity and workspaces."""

from django.contrib.auth import get_user_model, password_validation
from django.contrib.auth.validators import UnicodeUsernameValidator
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .models import Workspace, WorkspaceMembership
from .policy import role_for

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "username", "email")
        read_only_fields = fields


class RegisterSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150, trim_whitespace=True)
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_username(self, value):
        try:
            UnicodeUsernameValidator()(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages) from exc
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("Username unavailable")
        return value

    def validate_password(self, value):
        user = User(username=self.initial_data.get("username", ""), email=self.initial_data.get("email", ""))
        try:
            password_validation.validate_password(value, user)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages) from exc
        return value

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(trim_whitespace=False)


class WorkspaceSerializer(serializers.ModelSerializer):
    owner = serializers.CharField(source="owner.username", read_only=True)
    role = serializers.SerializerMethodField()

    class Meta:
        model = Workspace
        fields = ("id", "name", "description", "owner", "role", "created_at", "updated_at")
        read_only_fields = ("id", "owner", "role", "created_at", "updated_at")

    def get_role(self, obj):
        return role_for(self.context["request"].user, obj)

    def validate_name(self, value):
        user = self.context["request"].user
        owner = self.instance.owner if self.instance else user
        query = Workspace.objects.filter(owner=owner, name__iexact=value)
        if self.instance:
            query = query.exclude(pk=self.instance.pk)
        if query.exists():
            raise serializers.ValidationError("A workspace with this name already exists")
        return value


class MembershipSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source="user.username", read_only=True)

    class Meta:
        model = WorkspaceMembership
        fields = ("user_id", "username", "role", "created_at")
        read_only_fields = fields


class AddMembershipSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    role = serializers.ChoiceField(choices=WorkspaceMembership.Role.choices)
