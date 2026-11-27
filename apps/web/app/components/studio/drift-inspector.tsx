'use client';

import { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  GitCompareArrows,
} from 'lucide-react';
import { compareDatasetDrift, type Dataset } from '@/lib/client-api';
import { cn, formatNumber } from '@/lib/cn';
import type { DriftAlignedBin, DriftColumnReport, DriftComparisonReport } from '@/lib/types';

type Props = {
  workspaceId: string;
  projectId: string;
  datasets: Dataset[];
  activeDatasetId: string;
};

function DualDistributionChart({
  column,
  bins,
}: {
  column: string;
  bins: DriftAlignedBin[];
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (!bins.length) return null;

  const maxPct = Math.max(...bins.flatMap((b) => [b.baseline_pct, b.candidate_pct]), 1);
  const w = 440;
  const h = 152;
  const padTop = 12;
  const padBot = 24;
  const chartH = h - padTop - padBot;
  const groupW = w / bins.length;
  const barW = Math.max(6, (groupW - 8) / 2);
  const active = hoverIdx !== null ? bins[hoverIdx] : null;

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
        <span className="font-semibold text-[var(--ss-text)]">{column}</span>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="inline-flex items-center gap-1.5 text-[var(--ss-pass)]">
            <span className="inline-block h-2.5 w-2.5 rounded-xs border border-[var(--ss-pass)]/50 bg-[var(--ss-sky)]" />
            Baseline {active ? `${active.baseline_pct}%` : ''}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[var(--ss-primary)]">
            <span className="inline-block h-2.5 w-2.5 rounded-xs bg-[var(--ss-primary)]" />
            Candidate {active ? `${active.candidate_pct}%` : ''}
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full h-auto overflow-visible"
        role="img"
        aria-label={`Overlaid drift distribution for ${column}`}
      >
        {[0, 0.5, 1].map((r) => {
          const y = padTop + chartH * (1 - r);
          return (
            <line
              key={r}
              x1={0}
              x2={w}
              y1={y}
              y2={y}
              stroke="var(--ss-border)"
              strokeDasharray={r === 0 ? undefined : '2 3'}
            />
          );
        })}

        {bins.map((bin, idx) => {
          const x0 = idx * groupW + 4;
          const bh = Math.max(1.5, (bin.baseline_pct / maxPct) * chartH);
          const ch = Math.max(1.5, (bin.candidate_pct / maxPct) * chartH);
          return (
            <g
              key={idx}
              onMouseEnter={() => setHoverIdx(idx)}
              onMouseLeave={() => setHoverIdx(null)}
              className="cursor-crosshair"
            >
              <rect x={idx * groupW} y={padTop} width={groupW} height={chartH} fill="transparent" />
              <rect
                x={x0}
                y={padTop + chartH - bh}
                width={barW}
                height={bh}
                rx={1}
                fill="var(--ss-sky)"
                stroke="var(--ss-pass)"
                strokeOpacity={0.55}
                strokeWidth={1}
              />
              <rect
                x={x0 + barW + 2}
                y={padTop + chartH - ch}
                width={barW}
                height={ch}
                rx={1}
                fill={hoverIdx === idx ? 'var(--ss-amber)' : 'var(--ss-primary)'}
                fillOpacity={hoverIdx === idx ? 1 : 0.88}
              />
            </g>
          );
        })}

        <text x={0} y={h - 5} fill="var(--ss-subtle)" fontSize={10} fontFamily="var(--ss-font-mono)">
          {bins[0].bin_start}
        </text>
        <text
          x={w}
          y={h - 5}
          textAnchor="end"
          fill="var(--ss-subtle)"
          fontSize={10}
          fontFamily="var(--ss-font-mono)"
        >
          {bins[bins.length - 1].bin_end}
        </text>
      </svg>
    </div>
  );
}

export function DriftInspector({ workspaceId, projectId, datasets, activeDatasetId }: Props) {
  const readyDatasets = datasets.filter((d) => d.status === 'ready');
  const [baselineId, setBaselineId] = useState(activeDatasetId || readyDatasets[0]?.id || '');
  const [candidateId, setCandidateId] = useState(
    readyDatasets.find((d) => d.id !== (activeDatasetId || readyDatasets[0]?.id))?.id ||
      activeDatasetId ||
      '',
  );
  const [report, setReport] = useState<DriftComparisonReport | null>(null);
  const [selectedCol, setSelectedCol] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function runCompare() {
    if (!baselineId || !candidateId) return;
    setBusy(true);
    setError('');
    try {
      const res = await compareDatasetDrift(workspaceId, projectId, baselineId, candidateId);
      setReport(res);
      const firstNum = res.columns.find((c) => c.kind === 'numeric' && c.numeric?.aligned_bins.length);
      setSelectedCol(firstNum?.column ?? res.columns[0]?.column ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to compute dataset drift.');
    } finally {
      setBusy(false);
    }
  }

  function swap() {
    setBaselineId(candidateId);
    setCandidateId(baselineId);
    setReport(null);
  }

  const inspected: DriftColumnReport | null =
    report?.columns.find((c) => c.column === selectedCol) ?? null;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-[var(--ss-text)]">
          Dataset Comparison & Statistical ML Drift
        </h2>
        <p className="text-xs text-[var(--ss-muted)]">
          Compare a baseline version (e.g. training split or v0) against a candidate dataset for schema drift, PSI, two-sample KS test, and categorical Jensen-Shannon divergence.
        </p>
      </div>

      {/* Selector Bar */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-4">
        <label className="flex-1 min-w-[200px] space-y-1 text-xs">
          <span className="block font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--ss-subtle)]">
            Baseline (Reference)
          </span>
          <select
            aria-label="Baseline dataset"
            value={baselineId}
            onChange={(e) => setBaselineId(e.target.value)}
            className="h-9 w-full rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 font-mono text-xs"
          >
            {readyDatasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.filename}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={swap}
          title="Swap baseline and candidate"
          aria-label="Swap baseline and candidate"
          className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 text-[var(--ss-muted)] hover:text-[var(--ss-text)]"
        >
          <ArrowLeftRight className="h-4 w-4" />
        </button>

        <label className="flex-1 min-w-[200px] space-y-1 text-xs">
          <span className="block font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--ss-subtle)]">
            Candidate (Target)
          </span>
          <select
            aria-label="Candidate dataset"
            value={candidateId}
            onChange={(e) => setCandidateId(e.target.value)}
            className="h-9 w-full rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 font-mono text-xs"
          >
            {readyDatasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.filename}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          disabled={busy || !baselineId || !candidateId}
          onClick={() => void runCompare()}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--ss-primary)] px-4 text-xs font-semibold text-white hover:bg-[var(--ss-primary-hover)] disabled:opacity-45"
        >
          <GitCompareArrows className="h-3.5 w-3.5" />
          <span>{busy ? 'Computing drift…' : 'Run drift analysis'}</span>
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-[var(--ss-danger)]/35 bg-[var(--ss-danger-wash)] px-3.5 py-2.5 text-xs text-[var(--ss-danger)]"
        >
          {error}
        </p>
      )}

      {report ? (
        <div className="space-y-5">
          {/* Verdict Banner */}
          <div
            className={cn(
              'flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4',
              report.summary.status === 'drifted'
                ? 'border-[var(--ss-danger)]/35 bg-[var(--ss-danger-wash)]/60'
                : report.summary.status === 'moderate'
                  ? 'border-[var(--ss-warn)]/35 bg-[var(--ss-warn-wash)]/60'
                  : 'border-[var(--ss-pass)]/35 bg-[var(--ss-pass-wash)]/60',
            )}
          >
            <div className="flex items-start gap-3">
              {report.summary.status === 'stable' ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-[var(--ss-pass)] mt-0.5" />
              ) : (
                <AlertTriangle
                  className={cn(
                    'h-5 w-5 shrink-0 mt-0.5',
                    report.summary.status === 'drifted'
                      ? 'text-[var(--ss-danger)]'
                      : 'text-[var(--ss-warn)]',
                  )}
                />
              )}
              <div>
                <strong className="font-mono text-xs uppercase tracking-wider text-[var(--ss-text)]">
                  DRIFT VERDICT: {report.summary.status}
                </strong>
                <p className="mt-0.5 text-xs text-[var(--ss-muted)]">
                  {report.summary.drifted_columns} drifted · {report.summary.moderate_columns} moderate ·{' '}
                  {report.summary.stable_columns} stable feature(s) across {report.schema_drift.common_column_count}{' '}
                  shared columns.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 font-mono text-xs tabular-nums">
              <div>
                <span className="block text-[10px] text-[var(--ss-subtle)]">MAX PSI</span>
                <strong>{report.summary.max_psi.toFixed(3)}</strong>
              </div>
              <div>
                <span className="block text-[10px] text-[var(--ss-subtle)]">MAX KS D</span>
                <strong>{report.summary.max_ks.toFixed(3)}</strong>
              </div>
              <div>
                <span className="block text-[10px] text-[var(--ss-subtle)]">MAX JSD</span>
                <strong>{report.summary.max_jsd.toFixed(3)}</strong>
              </div>
              <div>
                <span className="block text-[10px] text-[var(--ss-subtle)]">ROW DELTA</span>
                <strong>
                  {report.summary.row_count_delta >= 0 ? '+' : ''}
                  {formatNumber(report.summary.row_count_delta)} ({report.summary.row_count_pct_change}%)
                </strong>
              </div>
            </div>
          </div>

          {/* Schema Drift Callout */}
          {(report.schema_drift.added_columns.length > 0 ||
            report.schema_drift.removed_columns.length > 0 ||
            report.schema_drift.type_changes.length > 0) && (
            <div className="rounded-lg border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-4 space-y-2 text-xs">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--ss-subtle)]">
                SCHEMA DRIFT DETECTED
              </span>
              <div className="flex flex-wrap gap-2 font-mono text-[11px]">
                {report.schema_drift.added_columns.map((c) => (
                  <span key={`add-${c}`} className="rounded bg-[var(--ss-pass-wash)] px-2 py-0.5 text-[var(--ss-pass)]">
                    + {c}
                  </span>
                ))}
                {report.schema_drift.removed_columns.map((c) => (
                  <span key={`rem-${c}`} className="rounded bg-[var(--ss-danger-wash)] px-2 py-0.5 text-[var(--ss-danger)]">
                    − {c}
                  </span>
                ))}
                {report.schema_drift.type_changes.map((t) => (
                  <span key={`type-${t.column}`} className="rounded bg-[var(--ss-warn-wash)] px-2 py-0.5 text-[var(--ss-warn)]">
                    {t.column}: {t.baseline_type} → {t.candidate_type}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Split Table + Dual Histogram */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
            <div className="xl:col-span-7 overflow-x-auto rounded-lg border border-[var(--ss-border)]">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="border-b border-[var(--ss-border)] bg-[var(--ss-surface-subtle)] font-mono text-[10px] uppercase text-[var(--ss-muted)]">
                  <tr>
                    <th className="px-3 py-2.5">Column</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5">PSI / JSD</th>
                    <th className="px-3 py-2.5">KS D / TVD</th>
                    <th className="px-3 py-2.5">Null Δ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ss-border)] font-mono text-[11px]">
                  {report.columns.map((col) => (
                    <tr
                      key={col.column}
                      onClick={() => setSelectedCol(col.column)}
                      className={cn(
                        'cursor-pointer transition-colors',
                        selectedCol === col.column
                          ? 'bg-[var(--ss-primary-wash)]/55'
                          : 'hover:bg-[var(--ss-surface-hover)]',
                      )}
                    >
                      <td className="px-3 py-2.5 font-semibold text-[var(--ss-text)]">
                        {col.column}
                        <span className="ml-1.5 text-[9px] font-normal text-[var(--ss-subtle)]">
                          {col.kind}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                            col.status === 'drifted'
                              ? 'bg-[var(--ss-danger-wash)] text-[var(--ss-danger)]'
                              : col.status === 'moderate'
                                ? 'bg-[var(--ss-warn-wash)] text-[var(--ss-warn)]'
                                : 'bg-[var(--ss-pass-wash)] text-[var(--ss-pass)]',
                          )}
                        >
                          {col.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {col.numeric?.psi != null
                          ? `PSI ${col.numeric.psi.toFixed(3)}`
                          : col.categorical
                            ? `JSD ${col.categorical.jsd.toFixed(3)}`
                            : '—'}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {col.numeric?.ks_stat != null
                          ? `D=${col.numeric.ks_stat.toFixed(3)}`
                          : col.categorical
                            ? `TVD ${col.categorical.tvd.toFixed(3)}`
                            : '—'}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-[var(--ss-muted)]">
                        {col.missing_delta_pct >= 0 ? '+' : ''}
                        {col.missing_delta_pct}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="xl:col-span-5 rounded-lg border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-4 space-y-4">
              <span className="block font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--ss-subtle)]">
                FEATURE DISTRIBUTION COMPARISON
              </span>
              {inspected?.numeric && inspected.numeric.aligned_bins.length > 0 ? (
                <>
                  <DualDistributionChart
                    column={inspected.column}
                    bins={inspected.numeric.aligned_bins}
                  />
                  <div className="grid grid-cols-2 gap-2 text-xs font-mono tabular-nums">
                    <div className="rounded border border-[var(--ss-border)] bg-[var(--ss-surface)] p-2.5">
                      <span className="block text-[10px] text-[var(--ss-subtle)]">MEAN SHIFT</span>
                      <strong>
                        {inspected.numeric.baseline_mean} → {inspected.numeric.candidate_mean}
                      </strong>
                    </div>
                    <div className="rounded border border-[var(--ss-border)] bg-[var(--ss-surface)] p-2.5">
                      <span className="block text-[10px] text-[var(--ss-subtle)]">KS P-VALUE</span>
                      <strong>{inspected.numeric.ks_p_value}</strong>
                    </div>
                  </div>
                </>
              ) : inspected?.categorical ? (
                <div className="space-y-3 text-xs">
                  <strong className="font-mono text-sm">{inspected.column}</strong>
                  <p className="text-[var(--ss-muted)]">
                    Computed over SHA-256 hashed tokens—no raw categorical values or PII are returned.
                  </p>
                  <div className="grid grid-cols-2 gap-2 font-mono tabular-nums">
                    <div className="rounded border border-[var(--ss-border)] bg-[var(--ss-surface)] p-2.5">
                      <span className="block text-[10px] text-[var(--ss-subtle)]">DISTINCT</span>
                      <strong>
                        {inspected.categorical.baseline_distinct} → {inspected.categorical.candidate_distinct}
                      </strong>
                    </div>
                    <div className="rounded border border-[var(--ss-border)] bg-[var(--ss-surface)] p-2.5">
                      <span className="block text-[10px] text-[var(--ss-subtle)]">UNSEEN ROWS</span>
                      <strong>{inspected.categorical.unseen_category_pct}%</strong>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-[var(--ss-muted)]">
                  Select any shared column on the left to inspect its statistical shift.
                </p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--ss-border-strong)] p-10 text-center space-y-2">
          <Activity className="mx-auto h-6 w-6 text-[var(--ss-subtle)]" />
          <p className="text-xs font-medium text-[var(--ss-text)]">
            Select a baseline and candidate dataset above to measure statistical drift.
          </p>
          <p className="text-[11px] text-[var(--ss-muted)]">
            Great for comparing raw v0 vs cleaned v1, or training data vs production inference drops.
          </p>
        </div>
      )}
    </div>
  );
}
