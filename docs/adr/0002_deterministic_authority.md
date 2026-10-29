# ADR-0002 — Make deterministic profiling authoritative and Gemini advisory

**Status:** Accepted as proposed architectural baseline; implementation and empirical verification pending.  
**Date:** 2026-10-23  
**Deciders:** Project owner / technical lead (single-person project role).

## Context

LLMs can misidentify defects and fabricate numeric evidence. Safety and user trust require reproducible quality findings.

## Decision

Calculate findings, statistics and validation only with deterministic versioned Python algorithms. Give Gemini a privacy-filtered immutable fact pack with stable evidence IDs. Verify all recommendations before presentation.

## Alternatives considered

LLM-first diagnosis (less reliable and not reproducible); deterministic only (misses substantive GenAI requirements).

## Positive and negative consequences

Requires evidence builder and verifier but enables honest explanations and quantitative evaluations. Gemini can abstain and cannot overrule counts or rules.

## Fitness test / review trigger

Inject fabricated issue IDs and prompt-injection input; verify zero accepted unsupported evidence.

Revisit if user requirements, load measurements, privacy policy, or failure evidence invalidate the stated trade-offs. Record replacements as superseding ADRs; do not silently edit historic rationale.
