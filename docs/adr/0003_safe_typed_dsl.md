# ADR-0003 — Represent remediations as a typed allowlisted DSL with exact-hash human approval

**Status:** Accepted as proposed architectural baseline; implementation and empirical verification pending.  
**Date:** 2026-10-23  
**Deciders:** Project owner / technical lead (single-person project role).

## Context

Executable model-generated Python or SQL creates unacceptable code execution and data-loss risks.

## Decision

Use JSON-schema/Pydantic typed operations with semantic checks, bounded preview, explicit user consent, and extra high-impact confirmation. Bind approval to source SHA and canonical plan hash.

## Alternatives considered

Evaluate generated source code in a sandbox (high complexity and escape risk); unrestricted SQL (unexpected side effects); suggestion-only chat (not functional transformation).

## Positive and negative consequences

MVP operations are intentionally limited. Adding a new operation requires schema, evaluator, threat model and golden tests. No automatic execution.

## Fitness test / review trigger

Check invalid DSL and arbitrary-code payload rejection, stale-plan failure, original hash preservation and correct output lineage.

Revisit if user requirements, load measurements, privacy policy, or failure evidence invalidate the stated trade-offs. Record replacements as superseding ADRs; do not silently edit historic rationale.
