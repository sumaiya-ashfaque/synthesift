"""Privacy-first PII detection, structural pattern shapes, and live-grid masking.

Raw cell values are never persisted in profile artifacts. Only aggregate counts,
masked pattern shapes, and severity metadata are returned for profiling.
"""

from __future__ import annotations

import re

_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,24}$")
_PHONE_RE = re.compile(r"^(?:\+?\d{1,3}[\s.\-]?)?(?:\(?\d{3}\)?[\s.\-]?)?\d{3}[\s.\-]?\d{4}$")
_SSN_RE = re.compile(r"^(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}$")
_CARD_CANDIDATE_RE = re.compile(r"^(?:\d[\s\-]?){13,19}$")
_IPV4_RE = re.compile(
    r"^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$"
)
_IBAN_RE = re.compile(r"^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$")
_API_KEY_RE = re.compile(
    r"^(?:sk-[A-Za-z0-9_\-]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z\-_]{30,})$"
)
_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
_URL_RE = re.compile(r"^https?://[^\s/$.?#].[^\s]*$", re.IGNORECASE)
_CURRENCY_RE = re.compile(r"^[\$\€\£\¥]\s?[+-]?\d[\d,]*(?:\.\d{1,4})?$")
_POSTAL_RE = re.compile(r"^(?:\d{5}(?:-\d{4})?|[A-Z]\d[A-Z]\s?\d[A-Z]\d)$")

SENTINEL_NULLS = frozenset(
    {
        "n/a",
        "na",
        "null",
        "none",
        "nil",
        "nan",
        "-",
        "--",
        "?",
        "unknown",
        "missing",
        "undefined",
        "#n/a",
    }
)

PII_SEVERITY = {
    "ssn": "high",
    "credit_card": "high",
    "api_key": "high",
    "iban": "high",
    "email": "warning",
    "phone": "warning",
    "ip_address": "warning",
}


def _passes_luhn(digits: str) -> bool:
    total = 0
    reverse_digits = digits[::-1]
    for idx, ch in enumerate(reverse_digits):
        num = int(ch)
        if idx % 2 == 1:
            num *= 2
            if num > 9:
                num -= 9
        total += num
    return total % 10 == 0


def detect_pii_kind(value: str) -> str | None:
    """Classify a stripped cell string into a single highest-risk PII kind."""
    if not value or len(value) > 256:
        return None
    if _SSN_RE.fullmatch(value):
        return "ssn"
    if _API_KEY_RE.fullmatch(value):
        return "api_key"
    if _EMAIL_RE.fullmatch(value):
        return "email"
    if _CARD_CANDIDATE_RE.fullmatch(value):
        digits = re.sub(r"\D", "", value)
        if 13 <= len(digits) <= 19 and _passes_luhn(digits):
            return "credit_card"
    if _IBAN_RE.fullmatch(value.replace(" ", "")):
        return "iban"
    if _IPV4_RE.fullmatch(value):
        return "ip_address"
    if _PHONE_RE.fullmatch(value):
        digits = re.sub(r"\D", "", value)
        if 10 <= len(digits) <= 15 and not value.isdigit():
            return "phone"
    return None


def detect_semantic_format(value: str) -> str | None:
    """Detect structured non-PII semantic token formats."""
    if not value or len(value) > 256:
        return None
    if _UUID_RE.fullmatch(value):
        return "uuid"
    if _URL_RE.fullmatch(value):
        return "url"
    if _CURRENCY_RE.fullmatch(value):
        return "currency"
    if _POSTAL_RE.fullmatch(value):
        return "postal_code"
    return None


def is_sentinel_null(value: str) -> bool:
    """Identify string tokens commonly masquerading as missing values."""
    return value.strip().casefold() in SENTINEL_NULLS


def mask_pattern_shape(value: str, max_len: int = 28) -> str:
    """Convert raw text to a privacy-preserving structural shape mask.

    Upper letters -> 'A', lower letters -> 'a', digits -> '9', punctuation kept.
    Never retains actual characters or names.
    """
    out: list[str] = []
    for ch in value[:max_len]:
        if ch.isupper():
            out.append("A")
        elif ch.islower():
            out.append("a")
        elif ch.isdigit():
            out.append("9")
        elif ch.isspace():
            out.append(" ")
        else:
            out.append(ch)
    shape = "".join(out)
    if len(value) > max_len:
        shape += "…"
    return shape


def mask_cell_value(raw: str, pii_kinds: set[str] | None = None) -> tuple[str, bool]:
    """Mask PII values for safe live-grid preview when mask_pii=true.

    Returns (display_value, was_masked).
    """
    stripped = raw.strip()
    if not stripped:
        return raw, False

    detected = detect_pii_kind(stripped)
    kind = detected or (next(iter(pii_kinds)) if pii_kinds else None)
    if kind is None:
        return raw, False

    if kind == "email" and "@" in stripped:
        local, domain = stripped.split("@", 1)
        prefix = local[:1] if local else "*"
        return f"{prefix}•••@{domain}", True

    if kind == "ssn":
        digits = re.sub(r"\D", "", stripped)
        tail = digits[-4:] if len(digits) >= 4 else "••••"
        return f"•••-••-{tail}", True

    if kind == "credit_card":
        digits = re.sub(r"\D", "", stripped)
        tail = digits[-4:] if len(digits) >= 4 else "••••"
        return f"•••• •••• •••• {tail}", True

    if kind == "phone":
        digits = re.sub(r"\D", "", stripped)
        tail = digits[-4:] if len(digits) >= 4 else "••••"
        return f"•••-•••-{tail}", True

    if kind == "ip_address" and "." in stripped:
        first = stripped.split(".", 1)[0]
        return f"{first}.•••.•••.•••", True

    if kind in {"api_key", "iban"}:
        head = stripped[:4]
        return f"{head}••••••••", True

    return raw, False
