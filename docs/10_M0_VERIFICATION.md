# M0 Verification Evidence

**Recorded:** 2026-10-23  
**Environment:** authoring container with Python 3.13, Node.js 22, PyYAML; no Docker executable and no reachable npm or PyPI package registry.

## Checks executed

| Check | Result | Method |
| --- | --- | --- |
| Python syntax compilation | PASS | `python -m compileall -q apps/api scripts` |
| YAML/JSON syntax across the repository | PASS | PyYAML and `json.loads` parsing |
| Reviewed M0 contract-checker happy path | PASS | `python scripts/check_contract.py contracts/openapi.yaml contracts/openapi.yaml` |
| Contract-checker unit tests | PASS (2 tests) | `python -m unittest discover -s tests/unit -p 'test_*.py' -v` |
| Shell smoke script syntax | PASS | `bash -n scripts/smoke.sh` |
| Artifact structure and docs | PASS | File inventory, required files and archive checksum generation |

## Not executed in authoring environment

- Django/DRF application tests and migration commands (Django and related dependencies unavailable).
- Frontend unit tests, ESLint, TypeScript compilation and Next.js build (dependencies unavailable).
- Docker Compose build, service health, actual database/Redis probes, Celery task roundtrip and HTTP smoke test (Docker unavailable).
- GitHub Actions runtime verification and vulnerability scan results (repository not hosted).

## Required follow-up on a connected development machine

1. Install all dependencies, resolve full transitive lockfiles and switch build/CI dependency installation to frozen mode.
2. Run the pipeline commands in the root README, including `docker compose up --build -d` and the private Celery worker probe.
3. Commit generated lockfiles and the successful CI run evidence to the repository.
4. Validate the Docker Compose health check behavior and worker hostname handling under the target Docker engine.
5. Verify deployment settings, security headers, TLS, credential management, dependency advisories and retention requirements before any external access.

Static checks do not imply successful container startup or a functioning end-to-end application. M0 remains an implementation candidate until the acceptance gates in `09_M0_IMPLEMENTATION.md` are complete.

## Developer-machine verification (reported 2026-10-29)

The user reported successful startup of the original M0 Docker Compose stack on Windows, with API, web, worker, PostgreSQL and Redis all healthy, and migrations exited with code 0. The user subsequently confirmed that Django system checks, a real Celery task round-trip, and the HTTP readiness endpoint passed. These observations apply to the pre-rename Docker stack, not to the rebranded artifact.

The SyntheSift rebrand should be separately checked following `11_REBRANDING_MIGRATION.md`; GitHub Actions execution, dependency lockfile generation, and the frontend/backend test suites remain outstanding release gates.
