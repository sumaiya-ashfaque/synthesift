# Decisions and unresolved assumptions

| ID | Decision / assumption | Current stance | Revisit in |
|---|---|---|---|
| D-01 | Modular monolith, separated Next.js and DRF | Proposed baseline (ADR-0001) | M0 |
| D-02 | Deterministic findings authoritative | Required (ADR-0002) | Every AI feature |
| D-03 | Typed DSL + explicit approval | Required (ADR-0003) | Every transformation feature |
| D-04 | Artifact immutability with lifecycle deletion | Required (ADR-0004) | M1 |
| D-05 | Celery and Redis queue | Proposed baseline (ADR-0005) | M0/M1 |
| D-06 | Gemini receives minimized aggregates, no raw rows | Required (ADR-0006) | M3 |
| O-01 | Django auth/session mechanism and same-origin proxy details | Open | M0 |
| O-02 | Hard upload/worker resource limits | Initial bound; benchmark required | M1/M2 |
| O-03 | Storage adapter and hosted provider | Local then selectable S3-compatible | M1/M7 |
| O-04 | Gemini model and generation parameters | Select via versioned offline eval | M3 |
| O-05 | Composite quality score | Defer; prove utility first | After MVP |
| O-06 | PDF generation library | Select by reproducibility/security test | M6 |
| O-07 | Retention/deletion policy and legal review | Proposed only | Before external pilot |
| O-08 | More exact OpenAPI DTOs and CSRF bootstrap | Draft design contract | M0 |

- **M0 / ADR-0007:** Keep the planned product schema separate from the implemented M0 route surface; require an explicit release-gate check before claiming a completed foundation.
