# 08 — Deployment, Observability, Reliability and Runbooks

> v1.0 | Operational blueprint, not an observed operating record.

## 1. Environment topology

| Environment | Purpose | Database and storage | Model access | Security expectation |
|---|---|---|---|---|
| Local dev | One-command reproducible app | Docker PostgreSQL/Redis + local object adapter/MinIO | Fake adapter default; real Gemini opt-in | Synthetic data, `.env` ignored |
| CI | Repeatable regression suite | Ephemeral Postgres/Redis + fixture store | Fake adapter | No production secrets |
| Staging | Migration/perf/restore tests | Isolated managed-equivalent services | Controlled Gemini with synthetic data | TLS, private networking, minimal privilege |
| Hosted pilot | Real users after review | Managed DB, durable object store, backup | Budgeted provider adapter | Data policy, monitoring, retention/deletion, review |

## 2. Container/process map

`web` (Next.js Node process), `api` (Django ASGI/WSGI), `worker-profile`, `worker-ai`, `worker-remediation` (same Django code with Celery queue differentiation when scaled), `postgres`, `redis`, object adapter/storage, ingress. The initial Compose environment may consolidate workers for simplicity, but must preserve task class and quota boundaries.

Startup ordering: dependency health → DB migrations under a single controlled command → API/worker health → seeded synthetic demo. No automatic production schema migration on every worker restart.

## 3. Proposed service objectives and measurement

| SLI | Initial aspirational target | Measurement source |
|---|---|---|
| Successful API read latency | p95 < 2 s for cached profile read in reference load | Request histogram |
| Admission acknowledge | p95 < 3 s *after upload transfer* for modest CSV | API metric |
| Profile completion | p95 < 120 s for bounded 25 MiB test case on specified hardware | Queue + worker timer |
| Job completion correctness | No success state without valid artifact and validation evidence | Consistency checker |
| AI integrity | 0 executable unsupported/unapproved plan steps | Audit verifier |
| Hosted pilot availability | 99.5% monthly **design aspiration** | External uptime monitor after launch |

Define an error budget after measuring a staging reference, not before. Security/integrity requirements are hard gates rather than traded for latency. Do not count expected invalid user uploads as server SLO failures.

## 4. Logs, metrics, tracing and alerts

**Log fields:** time, level, service, trace/request ID, opaque workspace ID, job ID, operation code, duration, error code. Redact dataset headers/values, email, token, full prompt and model raw response; use audit event store for access history.

**Metrics:** API error ratio, status codes, queue depth/age, worker OOM/CPU/memory, upload rejects, parse errors, profiling runtime, Gemini token usage per workspace and model, cost estimate, 429s, schema failures, retries, plan rejections, stale approval attempts, validation failures, export failures, orphan temp artifacts.

**Alerts:** P0 on source hash change, unauthorized artifact access signal, forbidden operation accepted, PII canary in egress; P1 sustained job backlog or provider costs near budget; P2 elevated model latency and plot-render failure. Alerts must be actionable with escalation routes.

## 5. Runbook — Gemini unavailable or quota exhausted

1. Detect 429/5xx/timeout, annotate AI run with `PROVIDER_UNAVAILABLE` and request ID.
2. Stop unbounded retries; use capped exponential backoff + jitter and per-workspace budget.
3. Keep deterministic profile, charts, rule findings, and manual plan builder fully available.
4. Show retryable state with safe action; never invent AI recommendations or mark a failed run successful.
5. After recovery, run synthetic smoke and compare schema pass rate/cost; do not reprocess without user intent/idempotency policy.

## 6. Runbook — stuck worker or duplicate job

1. Inspect durable job DB row and Celery state; reconcile stale heartbeat/lease.
2. Verify whether output artifact was committed and whether validation succeeded.
3. If incomplete, retry idempotently under same execution key; do not publish duplicate child version.
4. Clean orphan temporary artifacts after retention grace; document retry evidence.
5. Investigate resource caps, poison messages, database errors and provider retry policy.

## 7. Runbook — suspected privacy disclosure

1. Disable AI egress/export as appropriate through emergency feature flags.
2. Revoke affected secrets/signed URLs; isolate suspicious processes/workspaces.
3. Preserve metadata-level evidence under need-to-know access; avoid copying exposed rows into incident tickets.
4. Identify affected artifacts, parties and time window, then invoke legal/privacy escalation policy.
5. Fix leak, add regression fixture and evaluate re-enablement; public/customer notifications must follow applicable legal review.

## 8. Runbook — restore and recover

Back up DB and object artifacts with linked restoration checkpoints; include data encryption key access path and run periodic restore in isolated environment. Restore success criteria: consistent DatasetVersion → object SHA mapping; no orphan approved execution, intact membership and audit records, no missing report references. Set **RPO/RTO only after rehearsals**. Never claim a backup succeeded without restore testing.

## 9. Runbook — storage integrity / checksum mismatch

Mark affected version unavailable, deny export and execution, suspend child operations, verify copied object hash and database metadata, quarantine suspect object, restore from verified backup or mark unrecoverable, record incident and investigate source. Do not re-hash and silently overwrite the expected checksum.

## 10. Runbook — runaway costs

Set model-call per-workspace rate and daily budget ceilings before launch, plus global emergency disable. Monitor token/cost per evaluated fixture and per 100 workflows. When threshold breached, fail closed on new AI requests with understandable quota message; deterministic analysis remains accessible. Investigate retries, prompt growth, provider price/config changes and cached results.

## 11. Release checklist

- [ ] Tag and changelog link to tested commit.
- [ ] Unit, contract, integration, E2E and adversarial suites pass.
- [ ] Dependency/secret/license scans reviewed.
- [ ] Live Gemini smoke on synthetic data passes (release candidates).
- [ ] Migration forward and rollback paths tested.
- [ ] Source immutability and privacy canary assertions pass.
- [ ] Load/memory/cost test artifacts filed.
- [ ] Backups/restore and data deletion workflow exercised (for hosted pilot).
- [ ] Dashboards, on-call escalation, model budget and emergency disable verified.
- [ ] Known limitations, retention policy and incident contact visible to users.
- [ ] Hosted deployment reviewed for privacy/legal and infrastructure controls.
