"""Report production configuration gaps without revealing environment values."""

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from core.operational_checks import deployment_findings


class Command(BaseCommand):
    help = "Read-only production readiness assessment; use --strict in deployment CI."

    def add_arguments(self, parser):
        parser.add_argument("--strict", action="store_true")

    def handle(self, *args, **options):
        findings = deployment_findings(settings)
        for severity, code, message in findings:
            self.stdout.write(f"{severity.upper()} {code}: {message}")
        errors = sum(severity == "error" for severity, _, _ in findings)
        warnings = len(findings) - errors
        self.stdout.write(f"Deployment audit: {errors} error(s), {warnings} warning(s).")
        if errors and options["strict"]:
            raise CommandError("Production deployment readiness check failed.")
