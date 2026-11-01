import hashlib
import os
import re
import tempfile
import uuid
from pathlib import Path

from django.conf import settings
from rest_framework.exceptions import APIException, ValidationError


class UploadTooLarge(APIException):
    status_code = 413
    default_detail = "Dataset exceeds the upload limit."
    default_code = "upload_too_large"


def storage_path(key: str) -> Path:
    match = re.fullmatch(
        r"([0-9a-f]{2})/([0-9a-f]{32})\.csv",
        key,
    )

    if match is None or not match.group(2).startswith(match.group(1)):
        raise ValueError("Invalid dataset storage key.")

    return (
        Path(settings.DATASET_STORAGE_ROOT)
        / match.group(1)
        / f"{match.group(2)}.csv"
    )


def save_upload(uploaded) -> tuple[str, str, int]:
    limit = settings.DATASET_MAX_UPLOAD_BYTES

    if uploaded.size is not None and uploaded.size > limit:
        raise UploadTooLarge()

    identifier = uuid.uuid4().hex
    key = f"{identifier[:2]}/{identifier}.csv"

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
            raise ValidationError(
                {"file": ["CSV file cannot be empty."]}
            )

        os.link(temporary_path, target)

        return key, digest.hexdigest(), size

    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)