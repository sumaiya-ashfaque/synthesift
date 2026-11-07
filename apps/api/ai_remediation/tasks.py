"""Asynchronous, evidence-scoped Gemini analyses with bounded retry."""

import logging

from celery import shared_task
from django.utils import timezone

from datasets.models import DatasetProfile

from .evidence import evidence_from_profile, profile_digest
from .gemini import GeminiFailure, generate_json
from .models import AIReport
from .prompts import make_prompt
from .validation import InvalidAIOutput, validate_report

logger = logging.getLogger(__name__)


def _fail(report_id, code):
    AIReport.objects.filter(
        pk=report_id, status=AIReport.Status.PROCESSING
    ).update(status=AIReport.Status.FAILED, error_code=code,
             completed_at=timezone.now())


@shared_task(bind=True, name="ai_remediation.generate_report", ignore_result=True, max_retries=2)
def generate_report(self, report_id: str) -> str:
    if self.request.retries == 0:
        claimed = AIReport.objects.filter(
            pk=report_id, status=AIReport.Status.QUEUED
        ).update(status=AIReport.Status.PROCESSING, started_at=timezone.now())
        if not claimed:
            return "skipped"
    report = AIReport.objects.select_related("dataset").filter(
        pk=report_id, status=AIReport.Status.PROCESSING
    ).first()
    if report is None:
        return "skipped"
    profile = DatasetProfile.objects.filter(
        dataset=report.dataset, status=DatasetProfile.Status.READY
    ).first()
    if profile is None or profile_digest(profile.result) != report.profile_digest:
        _fail(report_id, "profile_changed")
        return "failed"
    try:
        evidence = evidence_from_profile(profile.result)
        system, prompt = make_prompt(report.technique, evidence)
        generated = generate_json(
            model=report.model, system=system, prompt=prompt,
            thinking_level=report.thinking_level,
            max_output_tokens=report.max_output_tokens,
            temperature=float(report.temperature) if report.temperature is not None else None,
        )
        result = validate_report(generated, evidence)
    except GeminiFailure as exc:
        if exc.retryable and self.request.retries < self.max_retries:
            raise self.retry(exc=exc, countdown=10 * (2 ** self.request.retries)) from exc
        _fail(report_id, exc.code)
        return "failed"
    except InvalidAIOutput:
        _fail(report_id, "invalid_ai_output")
        return "failed"
    except Exception:
        logger.exception("Unexpected AI report error: %s", report_id)
        _fail(report_id, "processing_error")
        return "failed"

    updated = AIReport.objects.filter(
        pk=report_id, status=AIReport.Status.PROCESSING
    ).update(
        status=AIReport.Status.READY,
        result=result,
        error_code="",
        completed_at=timezone.now(),
    )
    return "ready" if updated else "superseded"
