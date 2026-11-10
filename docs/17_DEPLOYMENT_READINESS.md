# Deployment readiness — operator checklist

**Development verification is not production authorization.** Complete every item with dated evidence before exposing SyntheSift to external users.

- [ ] Separate staging/production environments and secrets manager; rotate any previously displayed API keys.
- [ ] Set `APP_ENV=production`, `DJANGO_DEBUG=false`, an uncompromised Django secret key, explicit allowed hosts/origins and secure session/CSRF cookies.
- [ ] Configure HTTPS termination and trusted proxy forwarding after checking the real network topology.
- [ ] Private PostgreSQL, Redis and dataset-storage networks; external ports limited by policy.
- [ ] Persistent database and immutable-file backups with a **tested** independent restore.
- [ ] Storage hash audit and stalled-job recovery; operator-scheduled cadence measured and documented.
- [ ] Health/live and health/ready checks monitored from outside the container environment.
- [ ] Runtime trace correlation by request ID; logging excludes dataset rows, secrets and prompts.
- [ ] Gemini key permissions, quotas and egress privacy terms reviewed; no browser-exposed credentials.
- [ ] Backend pytest, Ruff, migration check, contract drift, frontend lint/typecheck/Vitest/build, secret scan and smoke checks green.
- [ ] Workspace-tenant isolation and owner/editor/viewer authorization rechecked in deployed environment.
- [ ] Real-provider Gemini smoke with explicit user consent and a synthetic dataset; record model/version, response, latency, and failure rate.
- [ ] Browser/mobile keyboard accessibility, contrast and screen-reader review on deployed URL.
- [ ] Production dependency vulnerability scan, backup drill, load/timeout investigation and incident response rehearsed.

Start with read-only checks:

```powershell
docker compose exec -T api python manage.py audit_deployment --strict
python scripts/check_release.py --url https://YOUR-STAGING-HOST --output staging_health.json
```

`audit_deployment --strict` should be expected to fail against the default local development configuration. The health script is a **read-only** probe and does not authenticate or test private API flows. Do not commit generated evidence logs if they contain identifying deployment details.
