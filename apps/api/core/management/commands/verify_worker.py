"""Check real broker, worker and result backend connectivity."""

from celery.exceptions import TimeoutError as CeleryTimeoutError
from django.core.management.base import BaseCommand, CommandError

from core.tasks import worker_ping


class Command(BaseCommand):
    help = "Enqueue a probe and wait for the Celery worker to finish it."

    def add_arguments(self, parser):
        parser.add_argument("--timeout", type=float, default=10.0)

    def handle(self, *args, **options):
        try:
            result = worker_ping.apply_async()
            payload = result.get(timeout=options["timeout"], propagate=True)
        except (CeleryTimeoutError, OSError, ConnectionError) as exc:
            raise CommandError("Worker probe failed; inspect broker and worker logs.") from exc
        if payload != {"status": "ok", "worker": "synthesift-worker"}:
            raise CommandError("Worker probe returned an unexpected response.")
        self.stdout.write(self.style.SUCCESS("Worker probe succeeded."))
