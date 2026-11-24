'use client';

import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  FlaskConical,
  Lock,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { fetchProjectAiEvals, runAiGuardrailBenchmark } from '@/lib/client-api';
import { cn, formatDateTime } from '@/lib/cn';
import type { GuardrailBenchmarkResponse, ProjectAIEvalsResponse } from '@/lib/types';

type Props = {
  workspaceId: string;
  projectId: string;
};

export function AIEvalWorkbench({ workspaceId, projectId }: Props) {
  const [evals, setEvals] = useState<ProjectAIEvalsResponse | null>(null);
  const [benchmark, setBenchmark] = useState<GuardrailBenchmarkResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [benchBusy, setBenchBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    fetchProjectAiEvals(workspaceId, projectId)
      .then((res) => {
        if (active) setEvals(res);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Unable to load AI evaluation metrics.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workspaceId, projectId]);

  async function refreshTelemetry() {
    setRefreshing(true);
    setError('');
    try {
      const res = await fetchProjectAiEvals(workspaceId, projectId);
      setEvals(res);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to refresh AI evaluation telemetry.');
    } finally {
      setRefreshing(false);
    }
  }

  async function handleRunBenchmark() {
    setBenchBusy(true);
    setError('');
    try {
      const res = await runAiGuardrailBenchmark(workspaceId, projectId);
      setBenchmark(res);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to run adversarial guardrail suite.');
    } finally {
      setBenchBusy(false);
    }
  }

  const summary = evals?.summary;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ss-primary)]">
            AI SYSTEMS OBSERVABILITY & SAFETY HARNESS
          </span>
          <h2 className="mt-0.5 text-sm font-semibold text-[var(--ss-text)]">
            AI Eval Workbench & Guardrail Suite
          </h2>
          <p className="text-xs text-[var(--ss-muted)]">
            Audit live citation grounding, strict JSON schema compliance, prompt-technique tradeoffs, and deterministic adversarial defense tests.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={refreshing}
            onClick={() => void refreshTelemetry()}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-3 text-xs font-medium text-[var(--ss-text)] hover:bg-[var(--ss-surface-hover)] disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
            Refresh
          </button>
          <button
            type="button"
            disabled={benchBusy}
            onClick={() => void handleRunBenchmark()}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--ss-primary)] px-3.5 text-xs font-semibold text-white hover:bg-[var(--ss-primary-hover)] disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            {benchBusy ? 'Running suite…' : 'Run Adversarial Guardrail Suite'}
          </button>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-[var(--ss-danger)]/35 bg-[var(--ss-danger-wash)] px-3.5 py-2.5 text-xs text-[var(--ss-danger)]"
        >
          {error}
        </p>
      )}

      {/* 4-Card Evaluation KPI Strip */}
      <section
        aria-label="AI evaluation KPIs"
        className="grid grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[var(--ss-border)] overflow-hidden rounded-lg border border-[var(--ss-border)] bg-[var(--ss-canvas)]"
      >
        <div className="p-4">
          <span className="block font-mono text-[10px] uppercase tracking-wider text-[var(--ss-subtle)]">
            Citation Grounding
          </span>
          <strong className="mt-1.5 block font-mono text-2xl font-semibold tabular-nums text-[var(--ss-text)]">
            {loading ? '—' : `${summary?.citation_grounding_rate ?? 100}%`}
          </strong>
          <small className="mt-1 block text-[11px] text-[var(--ss-muted)]">
            {summary?.total_recommendations ?? 0} validated recommendation(s)
          </small>
        </div>

        <div className="p-4">
          <span className="block font-mono text-[10px] uppercase tracking-wider text-[var(--ss-subtle)]">
            Schema Compliance
          </span>
          <strong className="mt-1.5 block font-mono text-2xl font-semibold tabular-nums text-[var(--ss-text)]">
            {loading ? '—' : `${summary?.schema_compliance_rate ?? 100}%`}
          </strong>
          <small className="mt-1 block text-[11px] text-[var(--ss-muted)]">
            {summary?.ready_reports ?? 0} ready · {summary?.failed_reports ?? 0} failed
          </small>
        </div>

        <div className="p-4">
          <span className="block font-mono text-[10px] uppercase tracking-wider text-[var(--ss-subtle)]">
            P95 / Mean Latency
          </span>
          <strong className="mt-1.5 block font-mono text-2xl font-semibold tabular-nums text-[var(--ss-text)]">
            {summary?.p95_latency_ms != null ? `${summary.p95_latency_ms}ms` : '—'}
          </strong>
          <small className="mt-1 block text-[11px] text-[var(--ss-muted)]">
            {summary?.mean_latency_ms != null ? `mean ${summary.mean_latency_ms}ms` : 'No completed LLM runs yet'}
          </small>
        </div>

        <div className="p-4">
          <span className="block font-mono text-[10px] uppercase tracking-wider text-[var(--ss-subtle)]">
            Egress Privacy Guard
          </span>
          <strong className="mt-1.5 flex items-center gap-1.5 font-mono text-lg font-semibold text-[var(--ss-pass)]">
            <Lock className="h-4 w-4 shrink-0" />
            Zero Raw Rows
          </strong>
          <small className="mt-1 block text-[11px] text-[var(--ss-muted)]">
            Aggregate-only evidence · {summary?.safe_abstention_count ?? 0} abstention(s)
          </small>
        </div>
      </section>

      {/* Adversarial Guardrail Benchmark Harness */}
      <section className="rounded-lg border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="h-4 w-4 text-[var(--ss-primary)] mt-0.5 shrink-0" />
            <div>
              <h3 className="text-xs font-semibold text-[var(--ss-text)]">
                Deterministic Adversarial & Grounding Guardrail Benchmark
              </h3>
              <p className="text-[11px] text-[var(--ss-muted)]">
                Tests SyntheSift’s live validation & DSL engine against hallucinated citations, arbitrary code execution proposals, prompt-injection overflows, and ReDoS attacks — no external API key required.
              </p>
            </div>
          </div>

          {benchmark && (
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span
                className={cn(
                  'rounded px-2 py-0.5 font-semibold uppercase',
                  benchmark.pass_rate === 100
                    ? 'bg-[var(--ss-pass-wash)] text-[var(--ss-pass)]'
                    : 'bg-[var(--ss-danger-wash)] text-[var(--ss-danger)]',
                )}
              >
                {benchmark.passed_cases}/{benchmark.total_cases} PASSED ({benchmark.pass_rate}%)
              </span>
              <span className="text-[var(--ss-subtle)] tabular-nums">{benchmark.duration_ms}ms</span>
            </div>
          )}
        </div>

        {benchmark ? (
          <div className="overflow-x-auto rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)]">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="border-b border-[var(--ss-border)] bg-[var(--ss-surface-subtle)] font-mono text-[10px] uppercase text-[var(--ss-muted)]">
                <tr>
                  <th className="px-3 py-2">Assertion</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Expected → Actual</th>
                  <th className="px-3 py-2">Guardrail Code</th>
                  <th className="px-3 py-2">Verdict</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ss-border)] text-xs">
                {benchmark.cases.map((c) => (
                  <tr key={c.id}>
                    <td className="px-3 py-2.5">
                      <strong className="block font-medium text-[var(--ss-text)]">{c.title}</strong>
                      <span className="block text-[11px] text-[var(--ss-muted)]">{c.detail}</span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[10px] uppercase text-[var(--ss-muted)]">
                      {c.category.replaceAll('_', ' ')}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-[var(--ss-text)]">
                      {c.expected_outcome} → {c.actual_outcome}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-[var(--ss-muted)]">
                      {c.guardrail_code}
                    </td>
                    <td className="px-3 py-2.5">
                      {c.passed ? (
                        <span className="inline-flex items-center gap-1 rounded bg-[var(--ss-pass-wash)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--ss-pass)]">
                          <CheckCircle2 className="h-3 w-3" />
                          PASS
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-[var(--ss-danger-wash)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--ss-danger)]">
                          <XCircle className="h-3 w-3" />
                          FAIL
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-[var(--ss-border-strong)] bg-[var(--ss-surface)] p-6 text-center space-y-2">
            <FlaskConical className="mx-auto h-5 w-5 text-[var(--ss-subtle)]" />
            <p className="text-xs text-[var(--ss-muted)]">
              Click <strong>Run Adversarial Guardrail Suite</strong> above to execute all 6 live safety & grounding checks.
            </p>
          </div>
        )}
      </section>

      {/* Prompt Technique & Model Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="rounded-lg border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-4 space-y-3">
          <span className="block font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--ss-subtle)]">
            PROMPT TECHNIQUE COMPARISON
          </span>
          {evals?.by_technique.length ? (
            <div className="overflow-x-auto rounded border border-[var(--ss-border)] bg-[var(--ss-surface)]">
              <table className="w-full border-collapse text-left font-mono text-[11px]">
                <thead className="border-b border-[var(--ss-border)] bg-[var(--ss-surface-subtle)] text-[10px] uppercase text-[var(--ss-muted)]">
                  <tr>
                    <th className="px-3 py-2">Technique</th>
                    <th className="px-3 py-2">Runs</th>
                    <th className="px-3 py-2">Grounding</th>
                    <th className="px-3 py-2">Avg Recs</th>
                    <th className="px-3 py-2">Mean ms</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ss-border)] tabular-nums">
                  {evals.by_technique.map((row) => (
                    <tr key={row.technique}>
                      <td className="px-3 py-2 font-semibold text-[var(--ss-text)]">
                        {row.technique.replaceAll('_', ' ')}
                      </td>
                      <td className="px-3 py-2">
                        {row.ready}/{row.runs}
                      </td>
                      <td className="px-3 py-2 text-[var(--ss-pass)]">{row.citation_grounding_rate}%</td>
                      <td className="px-3 py-2">{row.avg_recommendations}</td>
                      <td className="px-3 py-2 text-[var(--ss-muted)]">
                        {row.mean_latency_ms != null ? `${row.mean_latency_ms}ms` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-[var(--ss-muted)]">
              Run AI analyses across prompt techniques (zero-shot, few-shot, stepwise, role-based) to compare grounding and latency.
            </p>
          )}
        </section>

        <section className="rounded-lg border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-4 space-y-3">
          <span className="block font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--ss-subtle)]">
            MODEL RELIABILITY MATRIX
          </span>
          {evals?.by_model.length ? (
            <div className="overflow-x-auto rounded border border-[var(--ss-border)] bg-[var(--ss-surface)]">
              <table className="w-full border-collapse text-left font-mono text-[11px]">
                <thead className="border-b border-[var(--ss-border)] bg-[var(--ss-surface-subtle)] text-[10px] uppercase text-[var(--ss-muted)]">
                  <tr>
                    <th className="px-3 py-2">Model</th>
                    <th className="px-3 py-2">Ready / Failed</th>
                    <th className="px-3 py-2">Grounding</th>
                    <th className="px-3 py-2">Mean ms</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ss-border)] tabular-nums">
                  {evals.by_model.map((row) => (
                    <tr key={row.model}>
                      <td className="px-3 py-2 font-semibold text-[var(--ss-text)]">{row.model}</td>
                      <td className="px-3 py-2">
                        <span className="text-[var(--ss-pass)]">{row.ready}</span> /{' '}
                        <span className={row.failed ? 'text-[var(--ss-danger)]' : 'text-[var(--ss-muted)]'}>
                          {row.failed}
                        </span>
                      </td>
                      <td className="px-3 py-2">{row.citation_grounding_rate}%</td>
                      <td className="px-3 py-2 text-[var(--ss-muted)]">
                        {row.mean_latency_ms != null ? `${row.mean_latency_ms}ms` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-[var(--ss-muted)]">
              No model telemetry recorded yet for this project.
            </p>
          )}
        </section>
      </div>

      {/* Recent Runs & Failure Modes */}
      {evals && evals.recent_runs.length > 0 && (
        <section className="rounded-lg border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--ss-subtle)]">
              RECENT PROJECT AI EVALUATIONS ({evals.recent_runs.length})
            </span>
            {Object.keys(evals.failure_breakdown).length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
                <ShieldAlert className="h-3 w-3 text-[var(--ss-danger)]" />
                {Object.entries(evals.failure_breakdown).map(([code, count]) => (
                  <span
                    key={code}
                    className="rounded bg-[var(--ss-danger-wash)] px-1.5 py-0.5 text-[var(--ss-danger)]"
                  >
                    {code}: {count}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="overflow-x-auto rounded border border-[var(--ss-border)] bg-[var(--ss-surface)]">
            <table className="w-full border-collapse text-left font-mono text-[11px]">
              <thead className="border-b border-[var(--ss-border)] bg-[var(--ss-surface-subtle)] text-[10px] uppercase text-[var(--ss-muted)]">
                <tr>
                  <th className="px-3 py-2">Dataset</th>
                  <th className="px-3 py-2">Technique</th>
                  <th className="px-3 py-2">Model</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Grounding</th>
                  <th className="px-3 py-2">Latency</th>
                  <th className="px-3 py-2">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ss-border)] tabular-nums">
                {evals.recent_runs.map((run) => (
                  <tr key={run.id}>
                    <td className="px-3 py-2 font-semibold text-[var(--ss-text)]">
                      {run.dataset_filename}
                    </td>
                    <td className="px-3 py-2 text-[var(--ss-muted)]">
                      {run.technique.replaceAll('_', ' ')}
                    </td>
                    <td className="px-3 py-2 text-[var(--ss-muted)]">{run.model}</td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                          run.status === 'ready'
                            ? 'bg-[var(--ss-pass-wash)] text-[var(--ss-pass)]'
                            : run.status === 'failed'
                              ? 'bg-[var(--ss-danger-wash)] text-[var(--ss-danger)]'
                              : 'bg-[var(--ss-warn-wash)] text-[var(--ss-warn)]',
                        )}
                      >
                        {run.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">{run.grounded_ratio}%</td>
                    <td className="px-3 py-2 text-[var(--ss-muted)]">
                      {run.latency_ms != null ? `${run.latency_ms}ms` : '—'}
                    </td>
                    <td className="px-3 py-2 text-[var(--ss-subtle)]">
                      {formatDateTime(run.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
