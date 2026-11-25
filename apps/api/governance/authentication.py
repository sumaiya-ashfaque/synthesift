"""DRF authentication class for SHA-256 hashed workspace Personal Access Tokens."""

from __future__ import annotations

from django.utils import timezone
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

from .models import PersonalAccessToken, hash_token


class PersonalAccessTokenAuthentication(BaseAuthentication):
    """Authenticate headless CI/CD requests via `Authorization: Bearer ss_pat_...`."""

    keyword = "Bearer"

    def authenticate(self, request):
        raw_token = self._extract_token(request)
        if not raw_token:
            return None

        digest = hash_token(raw_token)
        pat = (
            PersonalAccessToken.objects.select_related("created_by", "workspace")
            .filter(token_hash=digest, revoked_at__isnull=True)
            .first()
        )
        if pat is None:
            raise AuthenticationFailed("Invalid or revoked Personal Access Token.")

        now = timezone.now()
        if pat.expires_at and pat.expires_at <= now:
            raise AuthenticationFailed("Personal Access Token has expired.")

        if not pat.created_by.is_active:
            raise AuthenticationFailed("Token owner account is inactive.")

        # Enforce strict workspace boundary if the URL targets a workspace_id
        resolver_match = getattr(request, "resolver_match", None)
        if resolver_match:
            target_ws = resolver_match.kwargs.get("workspace_id")
            if target_ws is not None and str(target_ws) != str(pat.workspace_id):
                raise AuthenticationFailed("Personal Access Token is scoped to a different workspace.")

        PersonalAccessToken.objects.filter(pk=pat.pk).update(last_used_at=now)
        request.pat = pat
        return (pat.created_by, pat)

    def authenticate_header(self, request):
        return self.keyword

    def _extract_token(self, request) -> str | None:
        auth_header = request.META.get("HTTP_AUTHORIZATION", "").strip()
        if auth_header:
            parts = auth_header.split(None, 1)
            if len(parts) == 2 and parts[0].lower() == "bearer" and parts[1].startswith("ss_pat_"):
                return parts[1].strip()
        api_key = request.META.get("HTTP_X_API_KEY", "").strip()
        if api_key.startswith("ss_pat_"):
            return api_key
        return None
