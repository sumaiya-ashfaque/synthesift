# 07 — Data Contracts, Domain Invariants and API Design

> v1.0 | This is a *proposed* contract; generated OpenAPI at runtime must match it before implementation release.

## 1. Contract hierarchy

1. **Domain invariants** in application services have precedence over serialized payloads.
2. **`contracts/transformation-plan.schema.json`** is normative for plan wire shape and syntactic validation; domain engine validates semantics.
3. **`contracts/ai-recommendations.schema.json`** is normative for model JSON structure, still subject to evidence and safety policy.
4. **`contracts/openapi.yaml`** is a versioned API design baseline. Code generation and tests will enforce the implemented contract.
5. **DB model + migrations** hold authoritative persisted states, hashes, and relationships; frontend DTOs never bypass authorization.

## 2. IDs, versioning and idempotency

Use UUIDs for public IDs and unique DB keys; `DatasetVersion` is append-only except lifecycle status/tombstone metadata. A published output references its parent input, exact plan hash, immutable object checksum, executor version and validation run. Write requests use `Idempotency-Key` (scoped by workspace, operation and request fingerprint). Reusing a key with a different payload returns 409, not a different execution result.

**Hash formula (design):** plan hash = SHA-256 of RFC 8785-style canonical JSON representation of the approved schema-versioned plan **including input dataset version ID, source SHA-256, operation order, operator/config version and guardrails**. Select one canonicalization library and test cross-language parity; no raw `JSON.stringify` / Python dict order reliance. Approval expires or becomes stale on source/policy change.

## 3. Schema and cleaning semantics

| Op | Args | Preconditions | Impact tracking |
|---|---|---|---|
| `trim_whitespace` | `column`, `side` (`both`,`left`,`right`) | Column string-like; preserve null | Changed cell count, examples redacted |
| `normalize_case` | `column`, `mode` (`lower`,`upper`,`title`) | Column string-like; locale assumptions disclosed | Changed cell count |
| `replace_values` | `column`, bounded `mapping` | Exact string-match; no regex, map size cap | Per replacement affected count |
| `cast_type` | `column`, `to_type`, `on_error` | Allowed target type; `on_error=reject` for MVP | Failed parse count; schema delta |
| `fill_missing` | `column`, `strategy`, `value` where needed | Constant or numeric mean/median with type check | Filled count, distribution delta |
| `drop_duplicate_rows` | `subset_columns`, `keep` | Valid subset; source row IDs stable | Removed row count; high-impact approval |
| `clip_numeric` | `column`, `min_value`/`max_value` | Numeric, lower≤upper | Clipped count, extreme value delta |

**Order matters.** Executor evaluates operations in specified order against a *temporary* copy, writes output only after all succeed and validation policy passes. No arbitrary SQL, Python, JavaScript or cloud calls in the plan. Duplicates use stable canonical row ordering; null equality and textual normalization must be specified and tested. A **row-count decrease** may be intentional but never hidden from validation/report.

## 4. Object-storage artifact envelope

```json
{
  "artifact_id": "UUID",
  "workspace_id": "UUID",
  "dataset_version_id": "UUID",
  "kind": "source_csv | derived_csv | report_pdf | report_html | chart_png",
  "content_sha256": "64 lowercase hex chars",
  "size_bytes": 12345,
  "storage_key": "private internal server-generated key",
  "created_at": "ISO-8601 timestamp",
  "retention_expiry": "ISO-8601 timestamp or null"
}
```

Artifact APIs never disclose raw storage keys to unauthenticated clients. Issued download URLs expire and are scoped. Raw uploads must be scanned/parsing-safe before available state; worker partials remain unreferenced by published versions.

## 5. API operation workflow

| Operation | Request | Response | Error conditions |
|---|---|---|---|
| Create project | Name, workspace context | 201 project ID | 401/403/422 |
| Upload dataset | Multipart CSV, project ID, idempotency key | 202 job ID and dataset ID (after durable admission) | 413/415/422/429 |
| Read profile | Dataset-version ID | 200 stats/findings and version hash or 202 pending | 403/404/409 |
| AI recommendations | Profile ID, task intent/filters | 202 AI run ID + job ID | 403/409/429/503 |
| Create plan | Input version, ordered DSL steps | 201 plan ID, draft status | 403/422 |
| Validate/preview plan | Exact plan ID and version/hash | 200 policy/preview result or 202 job ID | 409/422 |
| Approve | Plan ID, exact hash, acknowledged warnings | 200 approval ID | 403/409/422 |
| Execute | Approved plan ID, idempotency key | 202 execution/job ID | 403/409/429 |
| Compare/export | Input/output version refs and format | 202 job ID or 200 artifact metadata | 403/409/422 |

### Standard error response

```json
{
  "error": {
    "code": "PLAN_STALE",
    "message": "The source or plan changed after preview. Review it again.",
    "details": {"plan_id": "UUID"},
    "request_id": "opaque request identifier"
  }
}
```

Error messages should be user-actionable but not reveal the existence of unauthorized project/version IDs. Job state is durable and can be polled; queued endpoints never imply success of later work.

## 6. Row identity, stable evidence and leakage guards

For deterministic issue examples, compute an internal row ordinal or opaque row ID bound to `dataset_version_id`. Do not put raw cells in public issue JSON or Gemini evidence by default. Each finding ID remains stable *within one profile run*. Explanations must cite IDs in the evidence pack; a proposed plan cannot cite IDs from a different profile/version. For duplicate detection, maintain explicit hashing policy and clarify treatment of NaNs/whitespace. Quality score components, if added, include formula version, weights, dimension values and warnings.

## 7. State and transactional rules

1. `DatasetVersion AVAILABLE` requires verified committed artifact and SHA.
2. `Plan APPROVED` requires successful validation, current preview binding and signed warnings.
3. `Execution SUCCEEDED` requires an output `DatasetVersion AVAILABLE` and completed `ValidationRun`.
4. `AIAnalysis ACCEPTED` requires schema + evidence + policy verification; rejected suggestions remain auditable but not executable.
5. Worker restart and at-least-once message delivery cannot publish duplicate versions for one idempotent execution.
6. The audit trail records who/what/when **without logging sensitive row content**.
7. Permission checks are performed on **every** step, including asynchronous issuance of signed links.

## 8. Report provenance requirements

Each report includes source/output version IDs and checksums, UTC generation time, profile/rule versions, row and column counts, findings and severities, changed cell/row counts, rejected casts, regression warnings, transformation list, approving actor/time, prompts/models provenance identifiers *without exposing secrets*, and known limitations. Output CSS/HTML escaping and spreadsheet safety apply to all data-driven text.

## 9. Compatibility and evolution policy

Contract schemas carry `schema_version`, while REST endpoints live under `/api/v1`. Additive optional fields are normally backward-compatible; removing fields, narrowing enums, changing null semantics or altering operation meaning requires explicit version bump + migration. Migration rehearsals must prove old/new worker compatibility during rolling upgrades where used. Track deprecations with notices in changelog.
