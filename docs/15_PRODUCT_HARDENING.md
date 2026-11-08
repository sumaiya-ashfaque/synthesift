# SyntheSift — Operational hardening and support runbook

## Purpose and guarantees

This extension adds read-only dataset integrity auditing, conservative recovery of stalled Gemini jobs, deployment configuration preflight, tracked-file secret checks, and safer support-facing HTTP errors. It does **not** execute AI-generated code, modify original CSV files, re-submit data to Gemini, change permissions or install a database migration.

## Production safety

1. Maintain the `.env` file outside Git; use a secrets manager for production. Rotate any credential exposed in screenshots, CI logs, or source history.
2. Set `APP_ENV=production`, `DJANGO_DEBUG=false`, a private `DJANGO_SECRET_KEY`, explicit `DJANGO_ALLOWED_HOSTS`, HTTPS, and secure cookies. Terminate TLS at a trusted proxy and configure Django's proxy settings only after validating its topology.
3. Back up PostgreSQL and the immutable dataset volume together; test restore in a separate environment. `docker compose down -v` is destructive to local data.
4. Run the dataset audit against the shared storage volume. A finding must be investigated, not automatically repaired.
5. Access to the commands is server-operator only. Logs contain record IDs and safe status codes, not raw CSV rows, prompts, bearer tokens, or API keys.
6. Do not set up an unattended recovery loop until the normal queue delays and execution time limit have been measured. Recovery only marks stale reports failed; it never schedules provider calls. Analysts can explicitly request a new report through existing consent controls.
7. CSV exports are delivered with `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`. Spreadsheet applications can still interpret formula-like cells. Import downloads cautiously and do not advertise spreadsheet-formula sanitization until implemented and tested.

## Operational commands

Run from repository root while Docker is healthy:

```powershell
docker compose exec -T api python manage.py audit_dataset_storage --limit 200 --fail-on-error
docker compose exec -T api python manage.py recover_ai_reports
docker compose exec -T api python manage.py recover_ai_reports --apply
docker compose exec -T api python manage.py audit_deployment
```

`audit_deployment --strict` intentionally fails in local development; use it only after configuring a genuine production environment. Audit runs print only a bounded number of records (default 200). Consider `--project-id` for a single project.

For user-facing `5xx` request failures, the frontend may display an opaque support reference from `X-Request-ID`. Operators should correlate only that ID with protected server logs. Do not echo API error bodies in the UI.

## Regression and acceptance

- Backend: Django system check, migration dry-run, full pytest suite.
- Frontend: ESLint, TypeScript, Vitest and production Next.js build.
- Security: `python scripts/check_repo_secrets.py` and `python -m unittest discover -s scripts/tests -p 'test_*.py'`.
- Contract: runtime drf-spectacular schema vs reviewed `contracts/openapi.yaml` (no endpoints added here).
- Recovery: dry-run cannot change report state; apply only stale queued/processing reports; ready reports remain unchanged.
- File audit: good hash passes; altered/missing storage is reported without reading file contents into logs.
- Export: CSV and PDF return `Cache-Control: private, no-store`; files remain workspace-authorized and original data stays immutable.
- UI: 5xx errors remain actionable, and a strictly validated request UUID may appear as a support reference.

## Remaining work

Full cross-browser accessibility review, deployed TLS/proxy validation, backup/restore drills, real-provider latency/load tests, an automated security scan with an external managed scanner, and production monitoring/alerting are not accomplished by this patch. Do not claim deployment readiness solely from a clean local test suite.
