# Architecture Kit Changelog

## 1.0.0 — 2026-10-23

Initial documentation-only baseline: product/GenAI harness, detailed architecture, stakeholder ecosystem and power-interest/RACI maps, security/privacy threat model, deterministic and AI evaluation framework, delivery roadmap, data/API contract draft, operational runbooks, six ADRs, and seven editable/raster architecture diagrams.

**Status:** Proposed implementation specification; no application code or live results claimed. Review and approve decisions before M0 development starts.

## [0.1.0] - 2026-10-23 (implementation candidate)

- Authored Next.js/DRF modular foundation with Postgres, Redis and a Celery worker probe.
- Added health and service metadata API, generated OpenAPI endpoint, reviewed M0 route baseline and CI workflows.
- Added Docker Compose, developer commands and implementation-status documentation.
- Runtime/package-resolution release gates remain open; see `09_M0_IMPLEMENTATION.md`.

## [0.1.0] - 2026-10-29 (SyntheSift identity update)

- Renamed the product and repository identity to **SyntheSift**, with updated frontend, API metadata, worker identity, contracts, diagrams and documentation.
- Added `compose.legacy-data.yaml` and the local migration guide for retaining PostgreSQL/Redis volumes created under the previous Compose project.
- Documented the original developer-machine M0 health and worker checks, while keeping independent rebrand runtime validation and green CI as outstanding gates.
