# SyntheSift — Product workflow and acceptance evidence

SyntheSift is a Django REST / Next.js data-quality application backed by PostgreSQL, Redis/Celery and Gemini. Its implemented flow is **admit CSV → profile → inspect rule-based findings → request evidence-grounded AI recommendations → approve bounded remediation → validate derived data → export CSV/PDF**. Data-changing steps require an owner/editor's explicit approval; a viewer can review saved reports but cannot submit changes. Source CSV objects remain immutable.

## Running the local application

From the repository root:

```powershell
docker compose config --quiet
docker compose up --build -d
docker compose ps -a
python scripts/check_release.py --url http://127.0.0.1:8000
```

An exited migration container with exit code 0 is expected. The API, web, database, Redis and worker should be running and healthy. Never use `docker compose down -v` for a normal restart: it removes persistent volumes. The release-smoke script checks only two unauthenticated read-only health endpoints; it is not a full functional test.

## Functional review with non-sensitive example files

Fixtures in `fixtures/` are synthetic and contain no real customer data:

- `customers_quality_challenge.csv`: 20 records with missing values, a repeated record, whitespace, a mixed-type age entry, differently formatted region labels and suspicious spend values. These are **test scenarios**, not claims that every issue is detected or automatically fixable by the current rule engine.
- `customers_clean_control.csv`: small, consistently formatted control case.
- `remediation_review.csv`: repeated records and surrounding whitespace with an intentionally simple expected transform.

Log in as an owner/editor and create or select a project. Upload the challenging fixture, wait until admission is ready, start profiling, and examine actual counts and findings. Request Gemini recommendations after reading and checking external-processing consent. Try each available prompt technique separately. Confirm each saved report records its technique/model and provides evidence references. The comparison widget is descriptive only—it does not rank prompt accuracy. Viewers should be able to read past reports without the generation or approval controls.

For the remediation fixture, use `trim_whitespace` and `remove_exact_duplicates` in the preview, then expressly approve creating a derived dataset. Inspect before/after statistics, the new dataset record, original SHA-256 integrity, and the CSV/PDF downloads. Approval is a separate operation: generating recommendations does not alter data.

## Four prompt-engineering techniques

| Selector | Implementation goal | What must be checked |
| --- | --- | --- |
| `zero_shot` | Direct grounded analysis | Each action cites supplied evidence IDs |
| `few_shot` | An illustrative input/output example | Model follows the JSON structure without copying example facts |
| `stepwise` | Structured evidence comparison and prioritization | Conclusions are concise; no private reasoning is requested |
| `role_based` | Cautious data-steward review persona | Suggestions remain reversible, conservative and human-reviewed |

All four share the same safety system instruction and constrained aggregate-evidence payload. Numeric settings include `max_output_tokens`; Gemini 3 models expose thinking level rather than custom sampling temperature, while the supported compatible model exposes temperature. A successful API call alone is **not** a measure of recommendation correctness.

## Prompt evaluation audit

Read-only summary of stored reports:

```powershell
docker compose exec -T api python manage.py evaluate_ai_reports --limit 500
```

Optional: `--dataset-id <UUID>` limits the audit to a single dataset. It returns by-technique counts, completion status, number of recommendations, reference IDs recognized in the stored evidence, and observed processing durations where timestamps exist. These are descriptive structural metrics, not statistical evidence of accuracy, causal impact, prompt superiority or data-quality improvement.

A credible technique comparison requires the **same pinned dataset/profile** for each technique, the same model settings when supported, repeated trials, blinded manual rating of factual grounding/actionability/uncertainty, and failure accounting. Do not infer superiority from unmatched reports or different models.

## Regression and release gate

```powershell
python -m unittest discover -s scripts/tests -p "test_*.py"
python scripts/check_repo_secrets.py
docker compose exec -T api python manage.py check
docker compose exec -T api python manage.py makemigrations --check --dry-run
docker compose exec -T api python manage.py audit_dataset_storage --limit 200 --fail-on-error
docker compose run --rm --user root api sh -c "pip install -r requirements-dev.txt && python -m pytest --maxfail=1 -q"
cd apps/web
npm run lint
npm run typecheck
npm run test
npm run build
cd ../..
```

Run Ruff and the reviewed vs generated OpenAPI route comparison using the existing CI commands. The product-completion patch adds **no endpoints, database migrations, API keys or new runtime dependencies**. Confirm GitHub backend, frontend, integration and security checks remain green.

## Limitations and non-claims

The application does not run arbitrary model-generated scripts or automatically repair all semantic anomalies. Existing remediations are restricted to trimming whitespace and removing exact duplicate rows. A low duplicate count does not prove removed records were erroneous. No source CSV rows should be sent to Gemini by the implemented analysis path, but profile metadata and column names can themselves be sensitive; user consent remains necessary. Local Docker tests do not establish deployed TLS, backups, alerting, cloud availability, accessibility certification, legal compliance, or model accuracy. Test those separately before real production use.

## Documentation and demonstration artifacts

`docs/SyntheSift_Technical_Documentation.pdf` records architecture, implemented safeguards, the four prompt techniques and a verification checklist. Add screenshots and your **actual** GitHub Actions/job outputs, dataset measurements, test counts and example Gemini responses to the submission package; do not invent test outcomes. Keep `.env`, credentials and the private master specification outside GitHub.
