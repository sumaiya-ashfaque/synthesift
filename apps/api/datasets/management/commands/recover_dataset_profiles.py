"""Mark profiling jobs that exceed the operational timeout as interrupted."""

from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from datasets.models import DatasetProfile


class Command(BaseCommand):
    help = "Mark stale processing dataset profiles as failed (manual reconciliation)."

    def add_arguments(self, parser):
        parser.add_argument("--older-than-minutes", type=int, default=60)
        parser.add_argument("--limit", type=int, default=100)
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        minutes = options["older_than_minutes"]
        limit = options["limit"]
        if minutes < 1 or limit < 1:
            raise CommandError("Age and batch limit must both be positive.")

        now = timezone.now()
        cutoff = now - timedelta(minutes=minutes)
        queryset = DatasetProfile.objects.filter(
            status=DatasetProfile.Status.PROCESSING,
            started_at__lt=cutoff,
        ).order_by("started_at", "dataset_id")

        if options["dry_run"]:
            count = len(list(queryset.values_list("dataset_id", flat=True)[:limit]))
            self.stdout.write(f"Would recover {count} stale profile(s).")
            return

        with transaction.atomic():
            records = list(queryset.select_for_update(skip_locked=True)[:limit])
            for record in records:
                record.status = DatasetProfile.Status.FAILED
                record.error_code = "processing_interrupted"
                record.result = {}
                record.started_at = None
                record.completed_at = now
                record.save(
                    update_fields=[
                        "status", "error_code", "result", "started_at",
                        "completed_at", "updated_at",
                    ]
                )

        self.stdout.write(self.style.SUCCESS(f"Recovered {len(records)} stale profile(s)."))
