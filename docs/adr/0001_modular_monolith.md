# ADR-0001 — Choose a modular monolith with separate Next.js UI and DRF API

**Status:** Accepted as proposed architectural baseline; implementation and empirical verification pending.  
**Date:** 2026-10-23  
**Deciders:** Project owner / technical lead (single-person project role).

## Context

The MVP needs a real deployable product but development is initially solo and operational simplicity matters.

## Decision

Implement backend domains as apps with application/domain/adapters, deployed as one API plus background workers, with a separate Next.js frontend.

## Alternatives considered

Microservices (premature distributed failure modes); frontend-only prototype (no real backend); monolithic unlayered Django view logic (poor maintainability).

## Positive and negative consequences

Lower operational cost and coordinated migrations; module boundaries must be enforced via tests. Extract a service only after independent scaling or compliance demands.

## Fitness test / review trigger

Architecture module dependency lint and E2E multi-module tests.

Revisit if user requirements, load measurements, privacy policy, or failure evidence invalidate the stated trade-offs. Record replacements as superseding ADRs; do not silently edit historic rationale.
