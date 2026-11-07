# Evidence-grounded AI remediation

SyntheSift uses deterministic dataset profiling as the **measurement layer** and a separate, explicitly invoked Gemini analysis as the **generative reasoning layer**. The latter is not a chatbot, does not edit datasets, and cannot execute recommendations. Each analysis returns a structured report that the user can inspect before any future remediation workflow.

## End-to-end pipeline

1. The existing authenticated CSV intake stores an immutable original, then validates it in Celery.
2. The existing profiler computes missingness, type inference, cardinality, numeric aggregates and quality findings. It persists a profile in PostgreSQL.
3. An owner/editor selects a prompt technique, model and supported inference settings, reviews the external-processing disclosure, and explicitly opts in.
4. Django creates an auditable queued `AIReport`, taking a SHA-256 digest of the exact saved profile. An asynchronous Celery task retrieves it after the database commit.
5. `evidence_from_profile` constructs a bounded payload: counts, up to 30 column summaries and 30 findings, stable IDs (`C1`, `F1`). **No CSV records are sent.** Numeric aggregates for fewer than five populated values are suppressed.
6. Gemini receives system rules, a selected prompt strategy, and that data. The response must be valid JSON with bounded recommendations, allowed action types, priorities, human-verifiable steps, and references to actual evidence IDs.
7. Validated results are saved and returned through project-scoped read-only endpoints; the frontend displays their evidence and limitations.

## Four distinct prompt techniques

- **Zero-shot:** direct evidence-to-remediation request with no example.
- **Few-shot:** includes one schematic input-output example to teach the expected JSON form.
- **Structured reasoning:** instructs comparative assessment and prioritization; output includes concise conclusions, not private hidden reasoning.
- **Role-based:** data-steward/change-control persona prioritizing caution, reversibility and verification.

All four use the same safety instructions and response validator to support a matched comparison. Changing a strategy changes the actual provider prompt, not only the UI label.

## Inference parameters

For Gemini 3.x: `thinkingLevel` and `maxOutputTokens`, while sampling remains at provider-recommended defaults. For the legacy Gemini 2.5 Flash option: `temperature` and `maxOutputTokens`. Provider models are explicitly allowlisted. A missing key returns a 503; there is no silent mock fallback.

## Security and failure boundaries

- Authentication: Django session + CSRF; owner/editor generation; viewer read-only; inaccessible projects return 404.
- Privacy: explicit consent; no raw rows; bounded evidence; column names may still be sensitive and should be reviewed.
- Credentials: `GEMINI_API_KEY` in ignored `.env`, worker only; no browser key.
- Safety: untrusted CSV metadata in delimited JSON, model output schema validation, no code execution, no writeback, no claimed automatic approval.
- Reliability: broker dispatch error, provider credentials, quota/rate limit, timeout, unexpected HTTP and invalid outputs produce distinct error codes. Transient 429/5xx cases get up to two retries with backoff. Tasks are conditionally claimed to avoid duplicate execution.
- Resource controls: at most one active AI report per dataset and 10 report requests per dataset in a rolling 24-hour window. The last 10 reports are accessible.
- Limitations: a worker crash can leave an active report stuck until reconciliation; there is no distributed transactional outbox. This remains a pre-production hardening task.

## Evaluation protocol for final documentation

Use representative accepted CSVs with missingness, duplicate records, constant columns, mixed types and well-formed data. For each fixed profile, run all four prompt strategies with the same model, output budget and thinking level. Record output schema validity, correct evidence references, unsupported assertions, proposed-action safety, useful verification checks, latency, token usage where exposed, and approximate cost. Use at least one expert reviewer; compare against the deterministic baseline, and report uncertainty. Repeat across multiple inputs/seeds. Do not claim higher accuracy or safety before measured results.

For coursework submission, attach the completed GitHub revision, reproducible testing evidence, screenshots of live provider output, and a PDF report describing implementation, prompt methods, evaluation and limitations.
