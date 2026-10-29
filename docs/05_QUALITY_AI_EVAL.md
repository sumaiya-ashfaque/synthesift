# 05 — Quality Engineering, GenAI Evaluation and Release Gates

> v1.0 | Test and evaluation design; results not yet measured.

## 1. Quality strategy

Verify **deterministic correctness** independently of **AI usefulness**, then verify their composition through the full product workflow. AI-generated text alone never constitutes validation. Every quality claim requires a named fixture, metric, test version and repeatable run.

### Test pyramid and tool selection

| Layer | Scope / examples | Recommended implementation | CI cadence |
|---|---|---|---|
| Unit | Parser guards, numeric summaries, null/duplicate rules, DSL semantics, privacy filter | Pytest/pytest-django, Hypothesis; Vitest | Each PR |
| Contract | REST response shapes, JSON Schema, error envelope, idempotency | DRF API tests, OpenAPI validation, JSON Schema | Each PR |
| Integration | DB constraints, storage adapter, Celery lifecycle, authz, migrations | PostgreSQL + Redis service containers and mocked Gemini | Each PR |
| Frontend component | Accessible tables, warning/approval dialog, stale state | React Testing Library, Vitest, axe checks | Each PR |
| End-to-end | Upload→profile→AI fake→preview→approve→execute→validate→export | Playwright + Docker Compose | Each PR main-path; broader nightly |
| Security | IDOR, PII canary, prompt injection, export injection, malformed file, stale approval | Pytest adversarial suite, SAST and dependency scan | Each PR + release |
| Provider live | Gemini credentials, model response handling and bounds | Explicit opt-in smoke against synthetic data | Manual/nightly with budget |
| Performance | 25 MiB benchmark, memory cap, queue contention, API load | Locust/k6, profiling harness | Milestone and release |
| Recovery | Worker crash, Redis outage, object store failure and backup restore | Fault-injection staging scripts | Release candidate |

### Coverage policy

Initial CI targets (quality gates, **not achieved results**): backend core transformation/rule modules ≥90% statement coverage and 100% named safety invariants; backend overall ≥80%; frontend critical flow coverage via E2E; all security P0 negative cases passing. Branch coverage and mutation testing are introduced for high-impact validators. Coverage percentage cannot compensate for missing adversarial checks.

## 2. Golden datasets and testing corpus

| Fixture ID | Shape | Ground truth | Must exercise |
|---|---|---|---|
| F-001 | 20-row retail CSV | Missing price, duplicates, inconsistent categories | Basic profile and finding counts |
| F-002 | Date/currency columns | Invalid formats, mixed locales, parse failures | Explicit locale and coercion rejection |
| F-003 | Constant/empty columns | Zero-variance, all-null, high cardinality | No divide-by-zero or spurious anomalies |
| F-004 | Valid rare high-value amount | Statistical extreme, but legitimate | Advisory anomaly without automatic deletion |
| F-005 | PII/credential canary | Known email, phone, token strings | Zero canary data in outbound Gemini body/logs |
| F-006 | Injection in column names and cells | 'ignore instructions' / fake policy text | No policy override or tool/action escalation |
| F-007 | Dangerous spreadsheet prefixes | Formula-like values incl. leading whitespace | Safe CSV export encoding policy |
| F-008 | UTF-8/malformed/giant cells | Known invalid records and size breaches | Bounded reject/clean error |
| F-009 | Two workspaces | Disjoint projects, version refs, reports | Zero cross-tenant authorization leaks |
| F-010 | High-impact plan | Duplicate deletion and clipping | Second confirmation, preview caveat, hash binding |
| F-011 | Retry/crash points | DB committed, object temp written, broker failed | Exactly one visible final version |
| F-012 | Artificial 250k-row bounded CSV | Known distributions and duplicate fraction | Perf + memory benchmark and correct summaries |

Fixture data must be synthetic, tracked in `tests/fixtures/`, generator seeds pinned; never commit client data. Maintain expected outputs in versioned JSON with explicit type/nullable semantics.

## 3. Deterministic evaluation

- **Profile consistency:** exact row/column/null/duplicate counts; numeric values within controlled floating tolerance; fixed datetime parsing policy; metrics independent of input row order where semantics allow.
- **Rule detection:** precision, recall and F1 against labeled faulty records. Report per-rule support and issue severity; do not aggregate unmatched labels into misleading score.
- **Anomaly advisory:** false-positive rate on legitimate rare cases, recall on synthetic injected anomalies, stability under random seed/row order. No proof of data invalidity from outlier flag alone.
- **Transformation executor:** golden before/after cells, exact action count, unexpected modification rate, failed cast count, lineage checksum consistency. Must demonstrate no mutation to source bytes on error.
- **Validation:** report improved, unchanged and degraded metrics; validate invariants even when desired rule score improves. Check missing/duplicate delta, row loss, schema shift, value distributions and rejected rows.

## 4. GenAI evaluation framework

**Unit of evaluation:** immutable profile + privacy-filtered evidence JSON + optional user objective, with gold supported issue IDs, recommended admissible operations and documented cases where abstention is correct. Use a curated corpus with ordinary, ambiguous, adversarial, high-risk and no-action cases. Human reviewers label expected behavior; LLM-as-judge is secondary, not the ground truth.

| Metric | Definition | Initial release gate (proposed) |
|---|---|---|
| Schema validity | Fully parseable output conforming to strict DTO | ≥99% on offline test corpus after bounded repair; raw first-pass rate also report |
| Evidence reference validity | Fraction of references resolving to included findings | **100%** for accepted recommendations |
| Operation allowlist | Fraction of accepted steps permitted by policy | **100%**; reject all unsafe outputs |
| PII leakage | Presence of canary/private values in outbound model call | **0** in sentinel fixture; hard block |
| Recommendation utility | Human rating (actionable and context-appropriate) | ≥80% of eligible cases rated useful by rubric; sample size disclosed |
| Unsupported claims | Unsubstantiated factual assertions per evaluation case | Minimize; explicitly report rate, investigate each high-severity claim |
| Abstention quality | Correct refusal to recommend when evidence insufficient | ≥90% on designed no-action/ambiguous cases, calibrate after pilot |
| Harmful remediation | Proposal that would violate tested data integrity policy | **0 accepted**; raw model unsafe proposal rate is tracked |
| Cost | Model input/output tokens and estimated price per run | Measured per fixture; cap enforced, choose preset by Pareto comparison |
| Latency | p50/p95 queue+provider+validation per AI run | Measured under reference conditions; no fabricated SLO |

**Accepted** means passes deterministic verifier. Report separate raw-model, post-repair and post-policy rates so verifier effectiveness cannot be mistaken for native model accuracy. For confidence language, prohibit numeric certainty invented by the model; indicate evidence completeness and the interpretation's limitations.

## 5. Prompt techniques, ablations and parameter tuning

Three versioned prompt components: **(1) role/task/constraints and evidence-grounded context**, **(2) few-shot input→response exemplars (including abstention)**, and **(3) constrained structured JSON output**. Optional critique pass is an experiment, **never mandatory** before evidence shows benefit.

| Experiment | Variant | Measures |
|---|---|---|
| P-01 | Role/constraints only | Baseline schema, grounding, cost |
| P-02 | +few-shot examples | Utility vs latency/token overhead |
| P-03 | +JSON schema / structured output | Invalid-output and unsafe proposal changes |
| P-04 | +independent critique pass | Unsupported claims improvement per dollar |
| T-01 | Low / moderate temperature | Stability/diversity and factual grounding |
| T-02 | Top-p presets | Output compliance and proposal variety |
| T-03 | Output-token budgets | Truncation, quality and expense |
| M-01 | Provider model versions | Cost/latency/quality Pareto frontier |

Use the **same frozen test cases** and repeat where stochastic. Split development and held-out evaluation to avoid tuning to test answers. Archive model ID/version, prompt SHA, example-set revision, safety policy, exact sanitized input hash, config, timestamps, cost, API errors and validator decision. Do not store sensitive payload bodies in general telemetry. Model temperature/`top_p` parameters must be adjusted only if supported by the pinned model/API; adapter rejects unsupported configurations.

## 6. Adversarial and negative-case evaluation

Attack strings in CSV headers/values such as fake system instructions, credentials, SQL commands, arbitrary Python, forged finding IDs, invalid enum values, unicode control sequences, injection text into report titles, and instructions to delete all rows. Test model invalid JSON, refusal, empty response, hallucinated evidence, over-budget, 401/403, 429, timeout and wrong content type. Expected behavior: return validated safe recommendations or a controlled failure; **never execute** model instructions or transmit unpermitted data.

## 7. Traceability matrix

| Requirement group | Named acceptance scenarios | Evidence to retain |
|---|---|---|
| FR-001/015 auth/audit | Login, cross-tenant resource denial, approval audit | DRF integration and event snapshots |
| FR-002/003 upload/profile | Good/malformed/oversize files and exact profile | Golden fixture diff |
| FR-004/005/006 quality | Rule counts, anomaly advisory, evidence IDs | Per-rule precision/recall and schema snapshots |
| FR-007/008/017 AI | Live synthetic smoke, offline eval, schema/error/provenance | Benchmark JSON and reports |
| FR-009/010/011/012 remediation | DSL rejection, preview, approval hash, apply/validate | State transition and non-mutation evidence |
| FR-013/016 exports/plots | Report provenance, csv injection, image rendering | Artifact diff and accessible table test |
| FR-014 jobs | Queue, retries, cancellations and error states | Fault-injection logs |

## 8. CI release gates and triage policy

**Blocking PR checks:** formatting, lint, static types, unit/contract/integration tests, source/secret scans, static security checks, JSON schema/OpenAPI validation, deterministic offline AI fixtures, broken links/docs check, Docker build. **Blocking release checks:** E2E, full adversarial suite, manual synthetic Gemini smoke, performance evidence, migration upgrade/rollback rehearsal, data deletion/backup test, threat model refresh, accessibility check and updated changelog. Hosted launch requires separately approved security/privacy and operational gates.

**Severity:** P0 source corruption/privacy leak/cross-tenant disclosure/unsafe auto-execution → immediately block; P1 missing mandatory workflow or corrupt export → block release; P2 usability/performance regressions → triage against documented acceptance; P3 cosmetic polish → optional.

## 9. Reproducibility report format

Each evaluation report contains commit SHA, test date, dataset corpus manifest and checksums, model + API config, seed, prompt/policy/schema versions, machine specs, sample sizes, pass counts, utility judgments, latency distributions, token usage, known gaps, and failing case IDs (no raw secrets). Never claim production readiness based solely on one successful demo.
