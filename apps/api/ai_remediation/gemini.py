"""Bounded server-side Gemini REST client, without exposing API credentials."""

import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.conf import settings


class GeminiFailure(Exception):
    def __init__(self, code: str, retryable: bool = False):
        self.code = code
        self.retryable = retryable
        super().__init__(code)


def generate_json(*, model: str, system: str, prompt: str,
                  thinking_level: str, max_output_tokens: int,
                  temperature: float | None) -> dict:
    key = settings.GEMINI_API_KEY
    if not key:
        raise GeminiFailure("provider_not_configured")

    config = {
        "responseMimeType": "application/json",
        "maxOutputTokens": max_output_tokens,
    }
    if model.startswith("gemini-3."):
        config["thinkingConfig"] = {"thinkingLevel": thinking_level}
    elif temperature is not None:
        config["temperature"] = temperature

    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": config,
    }
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    request = Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"x-goog-api-key": key, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=40) as response:
            raw = response.read(120_001)
    except HTTPError as exc:
        if exc.code in (401, 403):
            raise GeminiFailure("provider_auth_failed") from None
        if exc.code == 429:
            raise GeminiFailure("provider_rate_limited", retryable=True) from None
        if exc.code in (408, 500, 502, 503, 504):
            raise GeminiFailure("provider_unavailable", retryable=True) from None
        raise GeminiFailure("provider_rejected_request") from None
    except (URLError, TimeoutError):
        raise GeminiFailure("provider_unavailable", retryable=True) from None

    if len(raw) > 120_000:
        raise GeminiFailure("provider_response_too_large")
    try:
        data = json.loads(raw)
        parts = data["candidates"][0]["content"]["parts"]
        message = "".join(p.get("text", "") for p in parts if isinstance(p, dict))
        generated = json.loads(message)
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise GeminiFailure("invalid_provider_response") from exc
    if not isinstance(generated, dict):
        raise GeminiFailure("invalid_provider_response")
    return generated
