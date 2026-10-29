# 01 — Product and Engineering Harness Specification

> **SyntheSift v1.0 | Baseline 2026-10-23 | Status: design proposal**

## 1. Executive product charter

**Mission.** Help analysts and engineering teams understand whether a dataset is fit for use, identify and rank quality issues, obtain *evidence-grounded* AI remediation proposals, preview safely executable changes, verify outcomes, and export an auditable quality report.

**Product promise.** Move from opaque cleaning scripts and generic chatbot answers to a reproducible, human-governed data quality workflow with explainability, safety, provenance, and measurable improvement.

**Target users.** Data analysts, data engineers, data stewards, BI teams, ML practitioners, and small technical teams without a large dedicated data-quality platform. The portfolio audience additionally includes software engineering hiring managers and reviewers, but portfolio appeal is **not** a substitute for real utility.

**MVP statement.** A signed-in user uploads a supported CSV, receives deterministic profiling and quality findings, requests Gemini-generated structured recommendations grounded in finding IDs, previews a validated transformation plan, explicitly approves execution, compares before/after quality metrics, and exports a report and cleaned CSV. Original bytes never change.

## 2. Product goals, non-goals and success hypotheses

| ID | Goal | How measured |
|---|---|---|
| G-01 | Trustworthy findings | Golden-fixture issue detection and diagnostic precision/recall |
| G-02 | Actionable GenAI | Evidence attribution, usable proposed actions, safe abstentions |
| G-03 | Non-destructive remediation | 100% lineage completeness; immutable source; rollback by selecting prior version |
| G-04 | Useful workflow | End-to-end success on demo datasets; time to first quality overview |
| G-05 | Production-minded foundation | Reproducible deployment, telemetry, role separation, threat controls, CI |
| G-06 | Cost-managed inference | Per-run token accounting; bounded request budgets; no hidden repeated calls |
| G-07 | Reviewer-friendly GitHub | One-command local startup after configuration; sample datasets; API documentation; architecture diagrams |

**Non-goals for MVP:** autonomous modification of customer systems; live database writes; arbitrary user Python/SQL execution; training/fine-tuning foundation models; data lake ETL orchestration; real-time streaming ingestion; complete multi-region SaaS; guaranteed legal compliance; unreviewed destructive cleans; advanced ML anomaly detection without validation data. These may be revisited through ADRs.

**Hypotheses to test (not facts):** structured evidence improves recommendation grounding; preview/validation reduces unintended data loss; issue-level quality metrics are more actionable than a single score; small teams value an accessible guided workflow.

## 3. Scope by release

**MVP / vertical slice:** authenticated single-workspace capability; CSV UTF-8 with encoding-detection policy and explicit rejection on ambiguities; configurable upload bounds; reproducible profiling; built-in quality rules; anomaly *flags* as advisory; Gemini explanations and structured proposals; allowlisted transformation DSL; preview and explicit approval; before/after validation; downloadable HTML/PDF quality report and cleaned CSV; immutable lineage; audits; basic API and integration tests.

**Post-MVP:** XLSX and Parquet ingestion with format-specific hardening; reusable quality contracts; scheduling; collaborative teams/roles; dataset comparison; richer anomaly ensembles; upload via presigned object URLs; integrations and webhooks; policy-as-code; billing; enterprise SSO and admin audit export.

### MVP operating bounds (initial engineering defaults, adjustable after benchmarks)

- CSV input: **25 MiB** maximum upload, **250,000 rows**, **200 columns**, and **256 MiB estimated decompressed in-memory footprint**; enforce both upload and parsed-size bounds. These are design defaults, not proven capacities.
- Uploaded files are treated as *untrusted*. Rejected, malformed, encrypted, truncated, unsupported, overwide, or over-budget inputs produce user-understandable errors.
- Time-intensive profiling, visualization, Gemini calls and transformations run as queued workers, not inside web request handlers.
- No external LLM call takes place until a user requests AI recommendations and the outgoing evidence payload passes privacy policy.
- Hosted multitenancy is **architecturally anticipated**, but a production SaaS launch requires separate hardening and operational review.

## 4. Personas and jobs-to-be-done

| Persona | Trigger | Job | Success signal |
|---|---|---|---|
| Analyst | CSV quality uncertain | Find missing values, inconsistencies, duplicates, suspicious rows | Issues ranked, located and exportable |
| Data engineer | Transformations planned | Generate safe, repeatable cleaning plan | Plan schema-valid, previewed and reproducible |
| Data steward | Risk and accountability | Approve high-impact changes and trace decisions | Audit trail and before/after evidence |
| ML practitioner | Model drift suspected | Detect potentially abnormal input distributions | Clearly labeled advisory anomalies |
| Technical evaluator | Reviewing repository | Verify code quality and architecture decisions | Repeatable demo, tests, coverage and docs |

## 5. User journeys / interaction contract

**J-01 — Inspect:** User signs in → creates project → uploads CSV → system validates file → creates immutable DatasetVersion v0 → starts ProfileRun → dashboard presents schema, metrics, plots, flagged issues and warning banners.

**J-02 — Understand:** User selects issues → requests AI analysis → backend builds privacy-filtered evidence package with stable IDs → Gemini returns structured recommendations → backend validates schema, citations, permissions and operations → UI renders ranked explanations, caveats and model metadata.

**J-03 — Safely remediate:** User selects proposals or manually builds plan → system normalizes DSL, checks constraints and previews on a bounded representative sample → user sees number/percentage of rows affected, examples and potential data-loss warnings → explicit approval → worker applies to a **new** version → validation compares metrics and verifies invariants → UI offers cleaned export and rollback through selecting the prior version.

**J-04 — Audit/share:** User downloads report with dataset hash, profile engine version, rule definitions, plan, approval actor/time, before/after metrics, known limitations and AI provenance. No hidden or raw PII is included by default.

## 6. Functional requirements

| ID | Requirement | Priority | Verification |
|---|---|---|---|
| FR-001 | Account authentication and project-scoped authorization | Must | Auth/tenant integration tests |
| FR-002 | CSV ingestion, sniffing, type safety, quotas, immutable store | Must | Parser corpus + security tests |
| FR-003 | Dataset schema and statistical profiling | Must | Golden Pandas fixtures |
| FR-004 | Missing, duplicate, type, range, uniqueness, category and format rules | Must | Parameterized rule tests |
| FR-005 | Outlier flags (IQR/robust methods) labeled advisory | Must | Edge-case fixture tests |
| FR-006 | Evidence IDs, severity, affected count, confidence/limitations | Must | API schema tests |
| FR-007 | Gemini evidence-grounded explanations and priority proposals | Must | Offline eval and live API smoke |
| FR-008 | Strict structured output and schema/business validation | Must | Malformed/prompt injection tests |
| FR-009 | Safe plan DSL: allowlisted operations with constraints | Must | Executor policy tests |
| FR-010 | Preview includes data delta, row impact and warnings | Must | Deterministic snapshot tests |
| FR-011 | Explicit user approval and immutable output dataset version | Must | Authorization + lineage tests |
| FR-012 | Before/after metric validation and failed-validation policy | Must | Rule regression tests |
| FR-013 | Cleaned CSV and PDF/HTML report export | Must | Export roundtrip and CSV injection tests |
| FR-014 | Job status, progress and retryable error UI | Must | Async/E2E fault scenarios |
| FR-015 | Audit event trail and correlation IDs | Must | Audit assertions |
| FR-016 | Charts rendered from backend Matplotlib/Seaborn | Must | Render + pixel sanity checks |
| FR-017 | Cost/tokens/model/prompt version visible in AI run details | Must | Provider adapter contract tests |
| FR-018 | Reusable user-defined rules and scheduled checks | Should (later) | Design ADR + tests |
| FR-019 | XLSX/Parquet import, collaborative permissions | Should (later) | Release-specific tests |

### Deterministic profile specification

- Table: record count, column count, total missing cells, duplicate row count (with explicit normalization policy), inferred types, parse failures, missingness by column, numeric summary (min/max/mean/median/standard deviation/quantiles), categorical frequency/cardinality, date ranges and freshness where parseable.
- Issues: `issue_id`, `dataset_version_id`, `rule_id`, `rule_version`, `severity`, `affected_rows`, `affected_percentage`, `column_refs`, `evidence_metrics`, `sample_row_ids` (redacted), `confidence_kind`, `remediation_eligibility`, `warnings`.
- Rule implementations record configuration and data-quality intent. E.g. a null may be acceptable unless a rule declares requiredness. Statistical outliers are **possible anomalies**, not confirmed errors.
- A global quality score, if presented, must disclose the weighting formula and per-dimension components; never substitute for issue details. Initial MVP should prioritize dimensions and issue evidence.

## 7. Mandatory GenAI harness: contractual requirements

| Harness condition | SyntheSift implementation | Acceptance evidence |
|---|---|---|
| Functional application | Complete upload → inspect → recommend → preview → apply → validate → export path | Recorded E2E demonstration + Playwright |
| Frontend + backend | Next.js/React UI and DRF API with defined boundaries | Deployed two-tier demo + API tests |
| API integration | Server-side Gemini API adapter with real authenticated calls | Live smoke test (secrets excluded) |
| Substantive generative processing | Ranked interpretations, reasons, and transformation proposal generation | Reviewed evaluation cases show nontrivial proposals |
| Parameter tuning | Configurable model, temperature, top-p, output budget and per-task presets | Logged benchmark experiments and chosen preset ADR |
| >= 2 prompt techniques | **(a) Role/task/constraints with evidence IDs**, **(b) few-shot exemplars**, plus **(c) generate-then-critique/validate pass** where cost justified | Versioned prompts and ablation comparisons |
| Error handling | API/timeouts/quotas/invalid JSON/no-evidence/unsafe plan/parse failure/cancellation | Fault-injection tests, graceful UI recovery |

**Important limitation:** prompt engineering cannot guarantee truthful grounding, privacy or safe execution. All output is untrusted until validated against deterministic evidence and code-level policy.

## 8. LLM behavior contract

**Inputs permitted by default:** dataset metadata, column types, aggregate counts, rule findings, normalized non-sensitive value patterns, rule names, numeric summaries, data dictionary, user intent and **stable issue IDs**. **Raw records, personal identifiers, free-text fields and sampled cell values are excluded by default**. The system must mask or block likely secrets and PII. Optional row-sample sharing requires an explicit privacy review and feature consent, deferred for MVP.

**Output contract:** schema-versioned list of recommendations with `recommendation_id`, `related_issue_ids`, `rationale`, `priority`, `expected_effect`, `risk_level`, `limitations`, `evidence_ids`, `proposed_steps` (typed DSL operations only), and `human_approval_required`. Unsupported evidence references or forbidden operations cause rejection, not best-effort execution.

**Allowed operations, MVP:** `trim_whitespace`, `normalize_case`, `replace_values` (exact mapping with bounded keys), `cast_type` (validated parse policy and rollback), `fill_missing` (constant or approved numeric aggregate), `drop_duplicate_rows` (defined subset/keep policy), and `clip_numeric` (configured bounds and warning). Type conversions must preserve original text in v0 and report any failed casts. Row drops/clips are high-impact and require explicit separate confirmation.

**Disallowed:** arbitrary Python/SQL, shell commands, network callbacks, package installation, code generation for immediate execution, deleting source files, dynamic regex from the model without validation, schema-changing operations without plan authorization, or silent transformations.

**Generation controls:** temperature / top-p / max-output-tokens stored as versioned presets; JSON-schema-supported Gemini response; Python/Pydantic validation; schema compatibility handling; capped retries with jitter for transient failures; no automatic retry on permanent auth or policy failures; idempotency for users' retried requests. Cache only privacy-safe evidence/prompt combinations with clear retention.

## 9. UX and accessibility acceptance

Pages: sign-in; project dashboard; upload; dataset details; profile; issue explorer; recommendation review; plan builder; before/after diff; history/lineage; export and run detail; settings. UI must show uncertainty, validation state, sample-vs-full execution distinction, source of metric, and operation risk. No dark patterns or hidden action execution. Target **WCAG 2.2 AA** practices (keyboard, focus order, semantic labels, contrast, screen-reader error messages). All important metrics and charts need tabular/text alternatives.

## 10. Cross-cutting engineering practices

- **SOLID and boundaries:** business logic lives in domain/application services; DRF serializers/views stay thin; persistence and Gemini SDK live in adapters; Next.js presentation avoids backend business rules.
- **Typing and linting:** strict TypeScript; Python typed boundary contracts; Ruff/Black/mypy and ESLint/Prettier; Pydantic for AI/DSL boundary schemas.
- **API-first:** OpenAPI contract, generated TS client when appropriate, semantic API versioning, consistent error envelope and pagination.
- **Dependency management:** pinned lockfiles, vulnerability checks, license review, reproducible Docker builds.
- **Git practice:** short-lived branches, Conventional Commits, PR template, changelog, `main` always releasable, protected branch in product deployment.
- **Code review:** feature change includes unit/integration/E2E or explicitly documented reason; security-sensitive changes include threat-test updates; ADR for architectural decision.
- **Operational discipline:** structured JSON logs and request IDs; secrets out of code; `.env.example` only; migrations reviewed and tested; backups and restore rehearsals for hosted launch.
- **Feature flags:** gate external calls, unsafe/high-impact operations, experimental anomaly detectors and collaboration features.

## 11. Definition of Ready and Definition of Done

**Ready:** user outcome and acceptance scenarios known; state/schema/API effects specified; threat and privacy effects identified; design fits versioned architecture; test fixtures named; migration/rollback plan defined when needed.

**Done:** code and docs merged; tests pass (including negative cases); API contract updated; telemetry and error surfaces verified; acceptance demo recorded; no secrets in repository; lint/type/security scans pass; performance/cost impact measured where relevant; user can complete the intended action independently.

## 12. Requirement traceability, versioning and changes

Every PR names FR/NFR/SEC/AI IDs. AI prompt changes get version IDs and offline evaluation results before live release. Database migrations must be backward-compatible or include a two-step deployment path. Adopt SemVer for releases and ADR sequence numbers for architecture; validate this specification after each major milestone.

## 13. Explicit open decisions for implementation

- Final authentication/session implementation and deployment domain policy.
- Actual safe upload threshold after profiling benchmarks on the target host.
- Object-storage provider for hosted release and retention defaults.
- Which Gemini model and parameter preset meets cost/grounding evaluation thresholds.
- Which reporting renderer produces reproducible branded PDFs in deployment.
- Whether a quality composite score improves user decisions; validate in user tests.

Any changed baseline decision belongs in an ADR; no claim of a deployed or tested feature is implied by this design.
