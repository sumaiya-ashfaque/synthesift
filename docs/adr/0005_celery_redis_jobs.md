# ADR-0005 — Run expensive tasks asynchronously through Celery and Redis

**Status:** Accepted as proposed architectural baseline; implementation and empirical verification pending.  
**Date:** 2026-10-23  
**Deciders:** Project owner / technical lead (single-person project role).

## Context

Profiling, Gemini calls and transformation can exceed HTTP deadlines and require retry and progress.

## Decision

DRF persists Job records, enqueues tasks only after commit, and workers operate idempotently. Redis is transport/cache; PostgreSQL stores durable logical state.

## Alternatives considered

Synchronous DRF requests (timeouts); event streaming platform (unnecessary complexity); ephemeral queue-only job status (lost truth).

## Positive and negative consequences

Adds broker and worker deployment, reconciliation and at-least-once delivery handling; isolates resource budgets across queues.

## Fitness test / review trigger

Kill a worker at each commit point, retry the same idempotency key, ensure exactly one visible output version.

Revisit if user requirements, load measurements, privacy policy, or failure evidence invalidate the stated trade-offs. Record replacements as superseding ADRs; do not silently edit historic rationale.
