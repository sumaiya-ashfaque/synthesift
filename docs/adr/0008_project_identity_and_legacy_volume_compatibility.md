# ADR-0008: Product identity and local-volume compatibility

**Status:** Accepted for M0 rename  
**Date:** 2026-10-29

## Context

The product formerly referred to as DataSentinel AI is named **SyntheSift**. Its public identity must be consistent across the web application, REST metadata, OpenAPI documentation, development conventions, and source repository. The developer already has a working Docker Compose stack with persistent PostgreSQL and Redis volumes associated with the original Compose project name.

## Decision

- Adopt `SyntheSift` for visible product identity and `synthesift` for code/package/runtime identifiers.
- Use `synthesift` for newly created Docker Compose resources and default development database identifiers.
- Retain public API paths and their semantics. The rebrand is not an API breaking change.
- Provide an **opt-in legacy Compose overlay** for reusing existing persistent volumes. A developer must retain the old `.env` credentials when attaching an existing PostgreSQL data volume.
- Do not automatically delete or migrate local data, rename the previous user's files, or change installed Docker Desktop configuration.
- Regenerate architecture diagrams from editable Graphviz sources so static files match their text diagrams.

## Consequences

The rename changes Docker resource naming for new deployments and necessitates an explicit local migration choice. Old resources remain available for rollback. An entirely new local M0 instance starts with clean volumes if the compatibility overlay is omitted. The repository documentation must not imply that the new build has passed external runtime checks until rerun.

## Alternatives considered

Reusing the old Compose name indefinitely was rejected because it would create inconsistent operational identifiers. Automatic volume deletion or credential changes were rejected due to risk of data loss.
