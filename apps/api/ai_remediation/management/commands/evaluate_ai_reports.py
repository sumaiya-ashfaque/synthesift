"""Output privacy-minimized, read-only aggregate metrics for persisted AI reports."""

import json

from django.core.management.base import BaseCommand, CommandError

from ai_remediation.evaluation import summarize_reports
from ai_remediation.models import AIReport


class Command(BaseCommand):
    help = "Summarize saved AI report outcomes without printing dataset rows or prompts."

    def add_arguments(self, parser):
        parser.add_argument("--dataset-id", help="Restrict to one dataset UUID")
        parser.add_argument("--limit", type=int, default=500)

    def handle(self, *args, **options):
        limit = options["limit"]
        if not 1 <= limit <= 5000:
            raise CommandError("--limit must be between 1 and 5000")
        query = AIReport.objects.order_by("-created_at")
        if options.get("dataset_id"):
            query = query.filter(dataset_id=options["dataset_id"])
        value = summarize_reports(list(query[:limit]))
        self.stdout.write(json.dumps(value, indent=2, sort_keys=True))
