# Contributing

SyntheSift is developed in small, reviewed vertical slices. The repository's design and acceptance criteria are maintained in `docs/` and enforced through CI where feasible.

## Before implementation

1. Locate the FR/NFR/SEC/AI requirement and milestone in `docs/01_PRODUCT_HARNESS.md` and `docs/06_DELIVERY_PLAN.md`.
2. Document the expected behavior, API/data changes, failure handling and security boundaries in the issue.
3. For architectural changes, add an ADR instead of silently diverging from the approved plan.

## Branch and commit conventions

Use a short-lived branch such as `feat/m1-upload-admission`. Prefer Conventional Commit subjects (`feat:`, `fix:`, `test:`, `docs:`, `chore:`), small commits, and meaningful messages that explain the intent of the change. Keep `main` releasable.

## Implementation standards

- Keep Django views thin. Place domain logic in the appropriate application service and persistence adapters. Do not implement data-cleaning rules inside Next.js.
- Prefer typed interfaces, input validation at boundaries, deterministic behavior and explicit failures. Avoid generic catch-and-continue code.
- Comments explain invariants, non-obvious trade-offs and compatibility constraints—not syntax or routine control flow. Use accurate docstrings for public interfaces.
- Tests must cover success, authorization, invalid inputs and dependency failures when relevant.
- Never commit `.env`, credentials, uploaded datasets or model input containing private data.
- Do not publish code-generated AI transformations directly to an executable environment. The typed DSL and authorization gates govern later milestones.

## Review gates

Run `make lint`, `make typecheck`, `make api-test`, `make web-test`, `make contract`, `make smoke` and `make worker-smoke` when available. Record environmental skips explicitly and include a reviewer-readable test summary.

## Documentation requirements

Update the OpenAPI baseline for public API changes, the M0/M1 implementation notes for operational changes, and ADRs for changed architectural decisions. Record migrations, restoration implications, feature status and limitations.
