"""Audit logging, SSRF-safe webhook validation, and HMAC-SHA256 signed delivery."""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import logging
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from django.conf import settings

from .models import AuditEvent, WebhookDelivery, WebhookEndpoint

logger = logging.getLogger(__name__)


class WebhookValidationError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


def record_audit_event(
    workspace,
    *,
    actor=None,
    actor_label: str = "",
    action: str,
    resource_type: str,
    resource_id: str = "",
    outcome: str = AuditEvent.Outcome.SUCCESS,
    metadata: dict[str, Any] | None = None,
) -> AuditEvent | None:
    """Persist a bounded, privacy-safe governance audit record."""
    try:
        label = actor_label or (getattr(actor, "username", "") if actor else "system")
        return AuditEvent.objects.create(
            workspace=workspace,
            actor=actor if getattr(actor, "is_authenticated", False) else None,
            actor_label=label[:150],
            action=action[:80],
            resource_type=resource_type[:60],
            resource_id=str(resource_id or "")[:80],
            outcome=outcome,
            metadata=metadata or {},
        )
    except Exception:
        logger.exception("governance.audit_record_failed", extra={"action": action})
        return None


def _is_blocked_ip(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return True
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def validate_webhook_url(raw_url: str) -> str:
    """Block SSRF targets (loopback, RFC1918, cloud metadata) and enforce HTTP(S)."""
    url = (raw_url or "").strip()
    if not url or len(url) > 500:
        raise WebhookValidationError("Provide a valid webhook URL (up to 500 chars).")
    parsed = urllib.parse.urlparse(url)
    allowed_schemes = {"https"} if settings.APP_ENV == "production" else {"https", "http"}
    if parsed.scheme.lower() not in allowed_schemes:
        raise WebhookValidationError(
            "Webhook URL must use https:// (http:// is permitted only in development)."
        )
    host = (parsed.hostname or "").strip().lower()
    if not host:
        raise WebhookValidationError("Webhook URL must include a hostname.")
    if host in {"localhost", "metadata.google.internal", "169.254.169.254"} or host.endswith(
        (".local", ".internal")
    ):
        raise WebhookValidationError("Loopback, link-local, and internal hostnames are blocked.")

    try:
        ipaddress.ip_address(host)
        if _is_blocked_ip(host):
            raise WebhookValidationError("Private, loopback, and metadata IP ranges are blocked.")
        return url
    except ValueError:
        pass

    # If DNS resolves locally, also reject private A/AAAA targets; allow unresolvable domains in offline test/dev
    try:
        infos = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80))
        for info in infos:
            addr = info[4][0]
            if _is_blocked_ip(addr):
                raise WebhookValidationError("Webhook destination resolves to a blocked private IP.")
    except socket.gaierror:
        pass

    return url


def sign_webhook_payload(secret: str, timestamp: str, body_bytes: bytes) -> str:
    """Compute Stripe-style `t=<ts>,v1=<hex>` HMAC-SHA256 webhook signature."""
    signed_content = f"{timestamp}.".encode() + body_bytes
    sig = hmac.new(secret.encode(), signed_content, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={sig}"


def deliver_to_endpoint(
    endpoint: WebhookEndpoint,
    event_type: str,
    payload: dict[str, Any],
    *,
    dry_run: bool = False,
) -> tuple[WebhookDelivery, str]:
    """Sign and optionally deliver a single outbound webhook event."""
    timestamp = str(int(time.time()))
    envelope = {
        "schema_version": "synthesift.webhook/v1",
        "event": event_type,
        "workspace_id": str(endpoint.workspace_id),
        "timestamp": timestamp,
        "data": payload,
    }
    body_bytes = json.dumps(envelope, sort_keys=True, separators=(",", ":")).encode("utf-8")
    signature = sign_webhook_payload(endpoint.signing_secret, timestamp, body_bytes)

    if dry_run:
        delivery = WebhookDelivery.objects.create(
            endpoint=endpoint,
            event_type=event_type,
            status=WebhookDelivery.Status.DRY_RUN,
            http_status=200,
            response_excerpt="Dry-run signature generated (no outbound HTTP call made).",
            payload_summary=payload,
            duration_ms=0.0,
        )
        return delivery, signature

    t0 = time.perf_counter()
    http_status: int | None = None
    excerpt = ""
    status_val = WebhookDelivery.Status.FAILED
    try:
        validate_webhook_url(endpoint.url)
        req = urllib.request.Request(
            endpoint.url,
            data=body_bytes,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "User-Agent": "SyntheSift-Webhooks/2.0",
                "X-SyntheSift-Event": event_type,
                "X-SyntheSift-Signature": signature,
            },
        )
        with urllib.request.urlopen(req, timeout=4.0) as resp:  # noqa: S310
            http_status = int(resp.status)
            excerpt = resp.read(280).decode("utf-8", errors="replace")
            if 200 <= http_status < 300:
                status_val = WebhookDelivery.Status.DELIVERED
    except urllib.error.HTTPError as exc:
        http_status = int(exc.code)
        excerpt = str(exc.reason)[:280]
    except (urllib.error.URLError, WebhookValidationError, OSError, ValueError) as exc:
        excerpt = str(exc)[:280]

    duration_ms = round((time.perf_counter() - t0) * 1000.0, 1)
    delivery = WebhookDelivery.objects.create(
        endpoint=endpoint,
        event_type=event_type,
        status=status_val,
        http_status=http_status,
        response_excerpt=excerpt,
        payload_summary=payload,
        duration_ms=duration_ms,
    )
    return delivery, signature


def dispatch_webhook_event(
    workspace,
    event_type: str,
    payload: dict[str, Any],
    *,
    dry_run: bool = False,
) -> list[WebhookDelivery]:
    """Dispatch event to all active workspace webhook endpoints subscribed to event_type."""
    endpoints = WebhookEndpoint.objects.filter(workspace=workspace, is_active=True)[:20]
    deliveries: list[WebhookDelivery] = []
    for ep in endpoints:
        if event_type in (ep.events or []):
            delivery, _ = deliver_to_endpoint(ep, event_type, payload, dry_run=dry_run)
            deliveries.append(delivery)
    return deliveries
