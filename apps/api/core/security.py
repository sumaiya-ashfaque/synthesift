"""Return a stable error envelope when Django rejects a CSRF request."""

from django.http import JsonResponse


def csrf_failure(request, reason=""):
    response = JsonResponse(
        {"error": {
            "code": "CSRF_FAILED",
            "message": "The request could not be verified.",
            "request_id": getattr(request, "request_id", "unknown"),
        }},
        status=403,
    )
    response["Cache-Control"] = "no-store"
    return response
