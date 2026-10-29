# SyntheSift

**AI-Powered Data Quality Analysis & Remediation Platform.**

*Profile. Detect. Explain. Remediate. Validate.*

[![CI](https://img.shields.io/badge/CI-configured-informational)](#quality-and-verification) [![Release](https://img.shields.io/badge/milestone-M0-blue)](#release-status) [![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

> **Implementation status: M0 engineering foundation.** Dataset uploads, profiling, Gemini recommendations, transformation previews, human approvals and exports are planned, **not yet available**. A configured CI workflow is not evidence that CI has passed.

## Overview

SyntheSift is designed as a standalone, production-minded data-quality platform. Its product architecture combines deterministic data-quality engines with evidence-grounded Gemini reasoning and a restricted, audited transformation DSL. Source datasets remain immutable; proposed changes are reviewed and validated before execution.

M0 establishes the technical baseline: a Next.js/React frontend, a Django REST Framework API, PostgreSQL, Redis, a Celery worker, health/metadata endpoints, OpenAPI, tests, Docker Compose, and CI infrastructure.

## Stack

| Layer | Technology |
| --- | --- |
| Web | Next.js / React / TypeScript / Node.js 22 |
| API | Django REST Framework / Python 3.12 |
| Jobs | Celery / Redis |
| Persistence | PostgreSQL 17 |
| Diagnostics | DRF Spectacular OpenAPI; dependency health checks |
| M2, future | Pandas / NumPy / Matplotlib / Seaborn |
| M3, future | Gemini API (server-side only) |

## Branding and existing local data

The application is now named **SyntheSift**. Developers moving from the previous M0 Docker stack should read [the rebranding migration guide](docs/11_REBRANDING_MIGRATION.md) **before** starting the renamed Compose project. A Compose project rename normally creates new volumes. The guide provides a separate `compose.legacy-data.yaml` overlay for reusing the existing PostgreSQL and Redis volumes without removing them.

## Quick start

Prerequisites: Docker Engine and Docker Compose v2, `curl`, and available ports 3000 and 8000.

```bash
cp .env.example .env
# Replace DJANGO_SECRET_KEY and POSTGRES_PASSWORD for any shared environment.
docker compose up --build -d
docker compose ps
bash scripts/smoke.sh
docker compose exec -T api python manage.py verify_worker --timeout 12
```

Open `http://localhost:3000` for the foundation dashboard and `http://localhost:3000/api/docs/` for the implemented API schema. API endpoints are also available directly at `http://localhost:8000/api/v1/...` through a loopback-only binding.

The `migrate` service completes Django migrations before API and worker startup. Redis and PostgreSQL are internal to the Docker network and have no host port bindings. The browser accesses API endpoints through the Next.js same-origin reverse proxy.

### Health routes

| Route | Meaning | Status |
| --- | --- | --- |
| `GET /api/v1/health/live` | API process responds | 200 |
| `GET /api/v1/health/ready` | PostgreSQL and Redis respond | 200 or 503 |
| `GET /api/v1/meta` | Service name, version and milestone | 200 |
| `GET /api/schema/` | Generated OpenAPI | 200 |
| `GET /api/docs/` | Swagger UI | 200 |

Worker execution is checked through the **private management command** `verify_worker`, not an unprotected HTTP task dispatcher.

### Operations

```bash
docker compose logs --follow --tail=100
docker compose exec api python manage.py check
docker compose exec api python manage.py showmigrations
docker compose down
```

`docker compose down --volumes` removes local PostgreSQL and Redis data **irreversibly**. Never use it on an environment containing data you need.

## Repository structure

```text
apps/
  web/                     Next.js SSR dashboard, health client and frontend tests
  api/                     Django API, health views, Celery tasks and backend tests
contracts/
  openapi.yaml             Reviewed M0 implemented route baseline
  openapi.future.yaml      Design-only API from architecture v1.0
  *.schema.json            Future AI and plan JSON Schema contracts
docs/
  01...08                  Product harness, architecture, stakeholders, privacy, QA and roadmap
  09_M0_IMPLEMENTATION.md  M0 decisions, gates and known limitations
  adr/                     Architectural decision records
  diagrams/                Source and generated architecture/stakeholder diagrams
scripts/                   Contract comparison and smoke checks
.github/workflows/         API, web and containerized integration CI
```

## Quality and verification

API test suite (PostgreSQL required):

```bash
python -m pip install -r apps/api/requirements-dev.txt
cd apps/api
pytest -q
python manage.py check
python manage.py spectacular --file ../../contracts/openapi.generated.yaml --validate
cd ../..
python scripts/check_contract.py contracts/openapi.yaml contracts/openapi.generated.yaml
```

Frontend test suite:

```bash
cd apps/web
npm install
npm run lint
npm run typecheck
npm test
npm run build
```

The CI workflow runs backend checks, frontend checks, then Compose integration probes with a real enqueued Celery task. Root `Makefile` targets offer shortcuts.

**Dependency reproducibility limitation:** This artifact was generated in an environment without npm/PyPI access. A transitive dependency lock cannot be reliably created or validated here; `npm install` currently resolves npm dependencies and Python files specify bounded ranges. Before declaring M0 reproducible/green, resolve and commit full lock files in a connected development environment, switch installs to frozen/locked mode, and rerun all CI gates. See `docs/09_M0_IMPLEMENTATION.md`.

## Architecture and security

Read `docs/02_ARCHITECTURE.md` before expanding the application. The architecture is a modular monolith, not microservices. The proposed AI output is **advisory** and must never be treated as executable code. Privacy filtering, typed plans and approval gates are part of the future feature milestones, not M0 capabilities.

Security concerns and responsible disclosure are documented in [SECURITY.md](SECURITY.md). Engineering and documentation conventions are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Release status

Current code: **v0.1.0 / M0 rebranded foundation candidate**. The original M0 Docker stack and basic system probes were reported passing in the developer environment; the rebranded stack needs its own startup verification. Dependency lockfiles and green GitHub Actions remain release gates.
