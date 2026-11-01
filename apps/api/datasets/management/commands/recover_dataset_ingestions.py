
"""Reconcile datasets abandoned by interrupted workers."""

from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from datasets.models import Dataset


class Command(BaseCommand):
    help = "Mark stale processing datasets as failed."

    def add_arguments(self, parser):
        parser.add_argument(
            "--older-than-minutes",
            type=int,
            default=60,
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=100,
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
        )

    def handle(self, *args, **options):
        minutes = options["older_than_minutes"]
        limit = options["limit"]

        if minutes < 1 or limit < 1:
            raise CommandError(
                "Age and batch limit must be positive."
            )

        now = timezone.now()
        cutoff = now - timedelta(minutes=minutes)

        stale = Dataset.objects.filter(
            status=Dataset.Status.PROCESSING,
            processing_started_at__lt=cutoff,
        ).order_by("processing_started_at", "pk")

        if options["dry_run"]:
            count = len(list(stale.values_list("pk", flat=True)[:limit]))

            self.stdout.write(
                f"Would recover {count} stale dataset(s)."
            )
            return

        recovered = 0

        with transaction.atomic():
            for dataset in stale.select_for_update(
                skip_locked=True
            )[:limit]:
                dataset.status = Dataset.Status.FAILED
                dataset.error_code = "processing_interrupted"
                dataset.processing_started_at = None
                dataset.completed_at = now

                dataset.save(
                    update_fields=[
                        "status",
                        "error_code",
                        "processing_started_at",
                        "completed_at",
                    ]
                )

                recovered += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Recovered {recovered} stale dataset(s)."
            )
        )
