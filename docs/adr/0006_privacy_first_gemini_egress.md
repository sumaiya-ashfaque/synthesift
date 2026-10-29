# ADR-0006 — Send minimized evidence aggregates to Gemini, never raw dataset rows by default

**Status:** Accepted as proposed architectural baseline; implementation and empirical verification pending.  
**Date:** 2026-10-23  
**Deciders:** Project owner / technical lead (single-person project role).

## Context

Uploaded CSVs can contain personal identifiers, credentials and unexpected text; model inference is an external processing boundary.

## Decision

Detect/block risky columns and small-cell aggregates; require explicit request for inference; expose model use and record evidence hash. Fail closed on uncertain data classification.

## Alternatives considered

Send raw sample rows for higher accuracy (privacy risk); client-side API calls (key exposure); ban all GenAI (misses project goal).

## Positive and negative consequences

May reduce quality of recommendations on ambiguous datasets. Use abstention and offline evaluation; any raw sampling feature requires separate ADR/privacy review.

## Fitness test / review trigger

PII canary tests, provider mocked request inspection, prompt injection tests, secret scanning and model budget alarms.

Revisit if user requirements, load measurements, privacy policy, or failure evidence invalidate the stated trade-offs. Record replacements as superseding ADRs; do not silently edit historic rationale.
