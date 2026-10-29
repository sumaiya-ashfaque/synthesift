# ADR-0004 — Store immutable dataset artifacts in object storage with metadata in PostgreSQL

**Status:** Accepted as proposed architectural baseline; implementation and empirical verification pending.  
**Date:** 2026-10-23  
**Deciders:** Project owner / technical lead (single-person project role).

## Context

Datasets may be large, versioned and legally sensitive; DB records must remain queryable without storing whole CSV blobs.

## Decision

Persist immutable private source and derived artifacts via storage adapter, with SHA-256, owner scope and version DAG recorded in PostgreSQL. Allow lifecycle deletion independent of logical immutability.

## Alternatives considered

Postgres BYTEA for every file (DB bloat); modify files in place (breaks reproducibility); public buckets (privacy leak).

## Positive and negative consequences

Requires consistency handling between DB/object store and cleanup reconciler. Hosted provider is left configurable.

## Fitness test / review trigger

Run crash-point consistency tests, checksum mismatch handling, cross-tenant download tests and deletion workflow.

Revisit if user requirements, load measurements, privacy policy, or failure evidence invalidate the stated trade-offs. Record replacements as superseding ADRs; do not silently edit historic rationale.
