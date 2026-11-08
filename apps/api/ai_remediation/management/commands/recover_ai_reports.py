"""Conservatively close stale Gemini analysis jobs; never re-send evidence."""

from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Q
from django.utils import timezone

from ai_remediation.models import AIReport
from core.operational_checks import stale_report_reason


class Command(BaseCommand):
    help = "Dry-run by default; mark genuinely stale queued/processing AI reports failed."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true")
        parser.add_argument("--queued-minutes", type=int, default=90)
        parser.add_argument("--processing-minutes", type=int, default=20)
        parser.add_argument("--limit", type=int, default=200)

    def handle(self, *args, **options):
        queued_minutes = options["queued_minutes"]
        processing_minutes = options["processing_minutes"]
        limit = options["limit"]
        if queued_minutes < 10 or processing_minutes < 10:
            raise CommandError("Recovery timeouts must be at least 10 minutes.")
        if not 1 <= limit <= 1000:
            raise CommandError("--limit must be between 1 and 1000.")
        now = timezone.now()
        queue_cutoff = now - timedelta(minutes=queued_minutes)
        processing_cutoff = now - timedelta(minutes=processing_minutes)
        queued_query = Q(status=AIReport.Status.QUEUED, created_at__lte=queue_cutoff)
        running_query = Q(status=AIReport.Status.PROCESSING) & (
            Q(started_at__lte=processing_cutoff)
            | Q(started_at__isnull=True, created_at__lte=processing_cutoff)
        )
        records = list(
            AIReport.objects.filter(queued_query | running_query)
            .order_by("created_at")
            .values("pk", "status", "created_at", "started_at")[:limit]
        )
        changed = 0
        for row in records:
            code = stale_report_reason(
                status=row["status"], created_at=row["created_at"],
                started_at=row["started_at"], now=now,
                queued_minutes=queued_minutes, processing_minutes=processing_minutes,
            )
            if not code:
                continue
            if options["apply"]:
                # Recheck timestamp and state to avoid closing jobs that advanced.
                selector = Q(pk=row["pk"], status=row["status"])
                if row["status"] == AIReport.Status.QUEUED:
                    selector &= Q(created_at__lte=queue_cutoff)
                else:
                    selector &= (
                        Q(started_at__lte=processing_cutoff)
                        | Q(started_at__isnull=True, created_at__lte=processing_cutoff)
                    )
                changed += AIReport.objects.filter(selector).update(
                    status=AIReport.Status.FAILED,
                    error_code=code,
                    completed_at=now,
                )
        mode = "APPLIED" if options["apply"] else "DRY RUN"
        self.stdout.write(
            f"{mode}: {len(records)} stale candidate(s), {changed} report(s) closed."
        )
        if not options["apply"]:
            self.stdout.write("To close candidates, rerun with --apply.")
