"""Retry deletion of orphaned CSV bytes after committed resource deletions."""

from django.core.management.base import BaseCommand

from datasets.deletion import cleanup_pending_storage
from datasets.models import StoredFileDeletion


class Command(BaseCommand):
    help = "Remove CSV files queued by completed workspace/project/dataset deletions."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=250)

    def handle(self, *args, **options):
        limit = options["limit"]
        if limit < 1 or limit > 10000:
            raise ValueError("--limit must be between 1 and 10000")
        removed = cleanup_pending_storage(limit=limit)
        remaining = StoredFileDeletion.objects.count()
        self.stdout.write(f"Files cleaned: {removed}; pending retries: {remaining}")
