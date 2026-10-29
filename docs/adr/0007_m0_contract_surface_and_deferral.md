# ADR 0007 — Publish only implemented routes in M0

**Status:** Accepted for M0  
**Context:** The architecture package provides a complete design-time OpenAPI schema for future project, dataset, profiling, AI, and remediation operations. Publishing those paths in a runtime contract before implementation would misrepresent service capabilities and compromise contract-based testing.

## Decision

Retain the architecture schema as `contracts/openapi.future.yaml`; create an implemented `contracts/openapi.yaml` with M0 system operations only. Generate the runtime OpenAPI from DRF views and reject changes to the (path, method) surface unless the reviewed implemented contract also changes. Public access is limited to service diagnostics; no unauthenticated task-submission or dataset operation is introduced.

## Consequences

The client API surface remains small until real authenticated features are built. Contract checking initially verifies routes and methods; schema/response compatibility coverage must expand in M1. Reviewers can distinguish shipped code from proposed features, and milestone documentation stays truthful.
