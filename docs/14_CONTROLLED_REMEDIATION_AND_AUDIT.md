# Controlled remediation and immutable audit

SyntheSift accepts human-selected, typed CSV transformations after an evidence-grounded, completed Gemini report is available. AI suggestions are advisory: no generated code, SQL, text, or unreviewed recommendation is executed. Only explicit operations from a fixed allowlist are supported.

## End-to-end operation

1. An owner/editor selects a ready dataset with a completed profiling result and associated ready AI report.
2. The reviewer selects `trim_whitespace`, `remove_exact_duplicates`, or both. Transformation order is deterministic: trim cells, then remove exact duplicate rows.
3. The backend revalidates the original bytes using existing CSV admission constraints and checksum, calculates a **preview** (row counts, missing-cell counts, exact duplicates and changed cells), and stores the preview. No dataset is created during this step. Previews with zero changes are rejected.
4. The reviewer must explicitly check the approval checkbox and submit again. Server-side authorization and `approve: true` are required.
5. The backend holds a row lock on the run, verifies source and profile digests and exact preview consistency, writes the derived CSV under a new generated storage key, revalidates it, creates a complete deterministic derived profile with quality findings, and commits its metadata as a **new** Dataset in the original project. The original source remains unchanged.
6. Authorized readers may download the derived CSV and a PDF audit with lineage, SHA-256 checksums, operations, actor, time, and before/after metrics.

All work uses the existing session/CSRF protections, per-project workspace permissions, database, and dataset storage. Repeated approval is idempotent. Viewers can read approved audits but cannot preview or apply changes. Cross-workspace access returns not found. No network inference request occurs during preview or apply.

## API

All routes are nested below `/api/v1/workspaces/{workspace_id}/projects/{project_id}/datasets/{dataset_id}`:

- `GET /remediations` - last 20 preview and applied records
- `POST /remediations` - `{ "report_id": "uuid", "operations": ["trim_whitespace", "remove_exact_duplicates"] }` creates preview
- `GET /remediations/{run_id}` - read preview/applied record
- `POST /remediations/{run_id}` - `{ "approve": true }` finalizes derived dataset
- `GET /remediations/{run_id}/export?download=csv|pdf` - download derived original-format CSV or concise audit PDF; only applied records

A stale profile, source checksum mismatch or preview mismatch blocks approval. Previews contain aggregate counts rather than raw values. `RemediationRun` stores the associated AI report and reviewer identity; derived datasets retain an immutable provenance link to their source.

## Correctness and safety boundaries

- Exact duplicates are identical CSV records, not inferred duplicate entities. Removal can be undesirable in transactional or time-series data.
- Outer whitespace may be intentional (fixed-width IDs, formatted values, etc.). This operation is **never** implied merely by a suggestion to inspect a column.
- Reductions in duplicate rows or missing cells are **measured changes**, not proof of semantic correctness. The audit states this explicitly.
- Original CSV rows are not sent to Gemini by this workflow. Approvals are first-party, deterministic processing.
- CSV download is not a sanitized spreadsheet workbook. Spreadsheet software may interpret cell text as formulas. Use safe import settings, never enable macros or active content, and treat exported cells as untrusted.
- No arbitrary scripts, expressions, SQL, external URLs, freeform operation arguments, overwrites, or automated execution of LLM output are permitted.
- PDF reporting requires ReportLab. PDF contents use aggregate and lineage metadata; source rows are not included.
- Storage is local-volume backed; a durable object-store transactional outbox, approval revocation, time-limited previews, scheduled reconciliation, and exhaustive browser automation remain future hardening tasks.

## Verify

```powershell
docker compose up --build -d
docker compose exec -T api python manage.py check
docker compose exec -T api python manage.py makemigrations --check --dry-run
docker compose run --rm --user root api sh -c "pip install --no-cache-dir -r requirements-dev.txt && python -m pytest --maxfail=1 -q"
cd apps/web
npm run lint
npm run typecheck
npm run test
npm run build
cd ../..
python scripts/check_contract.py contracts/openapi.yaml contracts/openapi.generated.yaml
```

Test both positive and negative scenarios: no preview before consent, no derived dataset before approval, duplicate approvals create one derived dataset, old previews invalidate when the profile changes, invalid DSL rejected, viewer/outsider cannot mutate, originals remain untouched, and PDF/CSV export works.
