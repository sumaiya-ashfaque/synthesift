"""Session identity endpoints and workspace governance."""

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout
from django.db import IntegrityError, transaction
from django.http import Http404
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .authentication import ApiSessionAuthentication
from .models import WorkspaceMembership
from .policy import get_workspace, require_role, visible_workspaces
from .serializers import (
    AddMembershipSerializer,
    LoginSerializer,
    MembershipSerializer,
    RegisterSerializer,
    UserSerializer,
    WorkspaceSerializer,
)

User = get_user_model()


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    @extend_schema(tags=["auth"], responses={200: None})
    def get(self, request):
        get_token(request)
        return Response({"status": "ok"})


@method_decorator(csrf_protect, name="dispatch")
class RegisterView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "registration"

    @extend_schema(tags=["auth"], request=RegisterSerializer, responses={201: UserSerializer})
    def post(self, request):
        if not settings.SELF_REGISTRATION_ENABLED:
            raise PermissionDenied("Registration is disabled")
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                user = serializer.save()
        except IntegrityError as exc:
            raise ValidationError({"username": ["Username unavailable"]}) from exc
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = [ApiSessionAuthentication]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    @extend_schema(tags=["auth"], request=LoginSerializer, responses={200: UserSerializer})
    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = authenticate(request, **serializer.validated_data)
        if user is None:
            raise AuthenticationFailed("Invalid credentials")
        login(request, user)
        return Response(UserSerializer(user).data)


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["auth"], request=None, responses={204: None})
    def post(self, request):
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["auth"], responses={200: UserSerializer})
    def get(self, request):
        return Response(UserSerializer(request.user).data)


class WorkspaceListView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["workspaces"], responses={200: WorkspaceSerializer(many=True)})
    def get(self, request):
        data = WorkspaceSerializer(visible_workspaces(request.user), many=True, context={"request": request}).data
        return Response(data)

    @extend_schema(tags=["workspaces"], request=WorkspaceSerializer, responses={201: WorkspaceSerializer})
    def post(self, request):
        serializer = WorkspaceSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                instance = serializer.save(owner=request.user)
        except IntegrityError as exc:
            raise ValidationError({"name": ["Workspace name unavailable"]}) from exc
        return Response(WorkspaceSerializer(instance, context={"request": request}).data, status=status.HTTP_201_CREATED)


class WorkspaceDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["workspaces"], responses={200: WorkspaceSerializer})
    def get(self, request, workspace_id):
        workspace = get_workspace(request.user, workspace_id)
        return Response(WorkspaceSerializer(workspace, context={"request": request}).data)

    @extend_schema(tags=["workspaces"], request=WorkspaceSerializer, responses={200: WorkspaceSerializer})
    def patch(self, request, workspace_id):
        workspace = get_workspace(request.user, workspace_id)
        require_role(request.user, workspace, {"owner"})
        serializer = WorkspaceSerializer(workspace, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                instance = serializer.save()
        except IntegrityError as exc:
            raise ValidationError({"name": ["Workspace name unavailable"]}) from exc
        return Response(WorkspaceSerializer(instance, context={"request": request}).data)

    @extend_schema(tags=["workspaces"], responses={204: None})
    def delete(self, request, workspace_id):
        workspace = get_workspace(request.user, workspace_id)
        require_role(request.user, workspace, {"owner"})
        workspace.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MembershipListView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["workspaces"], responses={200: MembershipSerializer(many=True)})
    def get(self, request, workspace_id):
        workspace = get_workspace(request.user, workspace_id)
        require_role(request.user, workspace, {"owner"})
        return Response(MembershipSerializer(workspace.memberships.select_related("user"), many=True).data)

    @extend_schema(tags=["workspaces"], request=AddMembershipSerializer, responses={201: MembershipSerializer})
    def post(self, request, workspace_id):
        workspace = get_workspace(request.user, workspace_id)
        require_role(request.user, workspace, {"owner"})
        serializer = AddMembershipSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        member = User.objects.filter(username__iexact=serializer.validated_data["username"]).order_by("pk").first()
        if member is None:
            raise ValidationError({"username": ["Account unavailable"]})
        if member.pk == workspace.owner_id:
            raise ValidationError({"username": ["Owner cannot be added as a member"]})
        try:
            with transaction.atomic():
                membership = WorkspaceMembership.objects.create(
                    workspace=workspace, user=member, role=serializer.validated_data["role"]
                )
        except IntegrityError as exc:
            raise ValidationError({"username": ["Membership already exists"]}) from exc
        return Response(MembershipSerializer(membership).data, status=status.HTTP_201_CREATED)


class MembershipDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["workspaces"], responses={204: None})
    def delete(self, request, workspace_id, user_id):
        workspace = get_workspace(request.user, workspace_id)
        require_role(request.user, workspace, {"owner"})
        membership = WorkspaceMembership.objects.filter(workspace=workspace, user_id=user_id).first()
        if membership is None:
            raise Http404
        membership.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
