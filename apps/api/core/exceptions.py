"""Stable error envelope for DRF-managed failures."""

from rest_framework.exceptions import ValidationError
from rest_framework.views import exception_handler as drf_exception_handler


def exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    if response is None:
        return None

    request = context.get("request")
    request_id = getattr(request, "request_id", "unknown")
    code = getattr(exc, "default_code", "request_failed")
    if hasattr(exc, "get_codes"):
        codes = exc.get_codes()
        if isinstance(codes, str):
            code = codes
    response.data = {
        "error": {
            "code": str(code).upper(),
            "message": "The request could not be completed.",
            "request_id": request_id,
        }
    }
    if isinstance(exc, ValidationError):
        response.data["error"]["details"] = exc.detail
    return response
