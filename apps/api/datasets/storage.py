"""Content-addressed, immutable local storage for multi-format tabular datasets."""

import hashlib
import os
import re
import tempfile
import uuid
from pathlib import Path

from django.conf import settings
from rest_framework.exceptions import APIException, ValidationError

SUPPORTED_EXTENSIONS = frozenset(
    {"csv", "tsv", "parquet", "xlsx", "json", "jsonl", "ndjson"}
)

EXTENSION_TO_FORMAT = {
    "csv": "csv",
    "tsv": "tsv",
    "parquet": "parquet",
    "xlsx": "xlsx",
    "json": "json",
    "jsonl": "ndjson",
    "ndjson": "ndjson",
}

_STORAGE_KEY_PATTERN = re.compile(
    r"([0-9a-f]{2})/([0-9a-f]{32})\.(csv|tsv|parquet|xlsx|json|jsonl|ndjson)"
)


class UploadTooLarge(APIException):
    status_code = 413
    default_detail = "Dataset exceeds the upload limit."
    default_code = "upload_too_large"


def infer_extension(filename: str | None) -> str:
    """Return a validated lowercase file extension or raise ValueError."""
    if not filename or "." not in filename:
        raise ValueError("Missing dataset file extension.")
    ext = filename.rsplit(".", 1)[-1].lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported dataset extension: {ext}")
    return ext


def infer_file_format(filename: str | None) -> str:
    """Map an uploaded filename to its canonical Dataset.FileFormat value."""
    return EXTENSION_TO_FORMAT[infer_extension(filename)]


def storage_path(key: str) -> Path:
    match = _STORAGE_KEY_PATTERN.fullmatch(key)

    if match is None or not match.group(2).startswith(match.group(1)):
        raise ValueError("Invalid dataset storage key.")

    return (
        Path(settings.DATASET_STORAGE_ROOT)
        / match.group(1)
        / f"{match.group(2)}.{match.group(3)}"
    )


def save_upload(uploaded, extension: str | None = None) -> tuple[str, str, int]:
    """Stream an uploaded file to immutable content-addressed storage."""
    limit = settings.DATASET_MAX_UPLOAD_BYTES

    if uploaded.size is not None and uploaded.size > limit:
        raise UploadTooLarge()

    if extension is None:
        raw_name = getattr(uploaded, "name", None)
        if not raw_name:
            path_attr = getattr(uploaded, "path", None)
            raw_name = path_attr.name if path_attr is not None else None
        try:
            ext = infer_extension(raw_name)
        except ValueError:
            ext = "csv"
    else:
        ext = extension.lower().lstrip(".")
        if ext not in SUPPORTED_EXTENSIONS:
            raise ValidationError({"file": ["Unsupported dataset file format."]})

    identifier = uuid.uuid4().hex
    key = f"{identifier[:2]}/{identifier}.{ext}"

    target = storage_path(key)
    target.parent.mkdir(parents=True, exist_ok=True)

    digest = hashlib.sha256()
    size = 0
    temporary_path = None

    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            prefix=".incoming-",
            dir=target.parent,
            delete=False,
        ) as stream:
            temporary_path = Path(stream.name)

            for chunk in uploaded.chunks():
                size += len(chunk)

                if size > limit:
                    raise UploadTooLarge()

                digest.update(chunk)
                stream.write(chunk)

            stream.flush()
            os.fsync(stream.fileno())

        if size == 0:
            raise ValidationError({"file": ["Dataset file cannot be empty."]})

        os.link(temporary_path, target)

        return key, digest.hexdigest(), size

    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
