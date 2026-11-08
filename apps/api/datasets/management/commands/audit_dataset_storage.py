"""Read-only immutable dataset storage inventory and integrity audit."""

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from core.operational_checks import verify_stored_file
from datasets.models import Dataset


class Command(BaseCommand):
    help = "Read-only bounded audit of immutable dataset files (no raw rows printed)."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=200)
        parser.add_argument("--project-id", default=None)
        parser.add_argument("--fail-on-error", action="store_true")

    def handle(self, *args, **options):
        limit = options["limit"]
        if not 1 <= limit <= 5000:
            raise CommandError("--limit must be between 1 and 5000.")
        query = Dataset.objects.order_by("pk")
        if options["project_id"]:
            query = query.filter(project_id=options["project_id"])
        rows = query.values("id", "storage_key", "sha256", "size_bytes")[:limit]
        total = 0
        errors = 0
        for row in rows.iterator():
            total += 1
            code = verify_stored_file(
                settings.DATASET_STORAGE_ROOT,
                row["storage_key"], row["sha256"], row["size_bytes"],
                settings.DATASET_MAX_UPLOAD_BYTES,
            )
            if code != "ok":
                errors += 1
                self.stdout.write(f"{row['id']}: {code}")
        self.stdout.write(f"Audited {total} dataset(s); integrity findings: {errors}.")
        if errors and options["fail_on_error"]:
            raise CommandError("Dataset storage audit found integrity issues.")
