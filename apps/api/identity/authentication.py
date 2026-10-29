"""Return 401 for unauthenticated API access while retaining Django CSRF checks."""

from rest_framework.authentication import SessionAuthentication


class ApiSessionAuthentication(SessionAuthentication):
    def authenticate_header(self, request):
        return "Session"
