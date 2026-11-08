"""Pure, side-effect-free checks for SyntheSift operational maintenance.

No source rows, credentials, or provider prompts are logged or returned.
"""

import hashlib
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

_KEY = re.compile(r"([0-9a-f]{2})/([0-9a-f]{32})\.csv\Z")


def verify_stored_file(
    root: Path | str, key: str, expected_sha256: str, expected_bytes: int,
    maximum_bytes: int,
) -> str:
    """Audit one immutable source without exposing its bytes; return a safe result code."""
    match = _KEY.fullmatch(key)
    if not match or not match.group(2).startswith(match.group(1)):
        return "invalid_storage_key"
    if not isinstance(expected_bytes, int) or expected_bytes < 1:
        return "invalid_stored_size"
    if not isinstance(maximum_bytes, int) or maximum_bytes < 1:
        return "invalid_maximum_size"
    if expected_bytes > maximum_bytes:
        return "oversize_metadata"
    if not re.fullmatch(r"[0-9a-f]{64}", expected_sha256):
        return "invalid_stored_digest"

    root_path = Path(root).resolve()
    path = root_path / match.group(1) / (match.group(2) + ".csv")
    # Resolve the *actual* location, including symlinks, before reading anything.
    try:
        actual = path.resolve(strict=True)
        if not actual.is_relative_to(root_path):
            return "storage_escape"
        if not actual.is_file():
            return "not_regular_file"
        size = actual.stat().st_size
        if size > maximum_bytes:
            return "oversize_file"
        if size != expected_bytes:
            return "size_mismatch"
        digest = hashlib.sha256()
        with actual.open("rb") as stream:
            for block in iter(lambda: stream.read(64 * 1024), b""):
                digest.update(block)
        return "ok" if digest.hexdigest() == expected_sha256 else "sha256_mismatch"
    except FileNotFoundError:
        return "missing_file"
    except (OSError, ValueError):
        return "unreadable_file"


def stale_report_reason(
    *, status: str, created_at: datetime, started_at: datetime | None,
    now: datetime, queued_minutes: int, processing_minutes: int,
) -> str | None:
    """Return a stale-job code, never a reason to re-send data to a provider."""
    if status == "queued" and created_at <= now - timedelta(minutes=queued_minutes):
        return "stale_queued"
    if status == "processing":
        active_since = started_at or created_at
        if active_since <= now - timedelta(minutes=processing_minutes):
            return "stale_processing"
    return None


def deployment_findings(config: Any) -> list[tuple[str, str, str]]:
    """Check conservative production guards without printing their secret values."""
    findings: list[tuple[str, str, str]] = []

    def add(severity: str, code: str, message: str) -> None:
        findings.append((severity, code, message))

    if getattr(config, "APP_ENV", "development") != "production":
        add("error", "not_production", "APP_ENV must be production for deployment.")
    if getattr(config, "DEBUG", False):
        add("error", "debug_enabled", "Disable Django DEBUG.")
    secret = getattr(config, "SECRET_KEY", "")
    if not secret or str(secret).startswith("unsafe-"):
        add("error", "development_secret", "Configure a private Django secret key.")
    hosts = getattr(config, "ALLOWED_HOSTS", [])
    if not hosts or any(h in {"*", "localhost", "127.0.0.1"} for h in hosts):
        add("error", "unsafe_hosts", "Use explicit public production hosts.")
    if not getattr(config, "SESSION_COOKIE_SECURE", False):
        add("error", "insecure_session_cookie", "Enable secure session cookies.")
    if not getattr(config, "CSRF_COOKIE_SECURE", False):
        add("error", "insecure_csrf_cookie", "Enable secure CSRF cookies.")
    if not getattr(config, "SECURE_CONTENT_TYPE_NOSNIFF", False):
        add("error", "missing_nosniff", "Enable X-Content-Type-Options nosniff.")
    if not getattr(config, "SECURE_SSL_REDIRECT", False):
        add("warning", "tls_redirect", "Verify HTTPS enforcement at the reverse proxy.")
    if not getattr(config, "GEMINI_API_KEY", ""):
        add("warning", "gemini_not_configured", "Generative analyses will be unavailable.")
    if not getattr(config, "DATASET_STORAGE_ROOT", None):
        add("error", "storage_not_configured", "Configure the dataset storage root.")
    return findings
