"""Operational task used for a controlled worker smoke test."""

from celery import shared_task


@shared_task(name="core.health.ping", ignore_result=False)
def worker_ping() -> dict[str, str]:
    return {"status": "ok", "worker": "synthesift-worker"}
