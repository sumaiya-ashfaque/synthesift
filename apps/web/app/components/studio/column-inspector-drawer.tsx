'use client';

import { useEffect } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Lock,
  Sparkles,
  X,
} from 'lucide-react';
import {
  BoxWhiskerPlot,
  DistributionHistogram,
} from '@/app/components/ui/charts';
import { formatNumber, formatPercent } from '@/lib/cn';
import type { ColumnProfileV2 } from '@/lib/types';

type Props = {
  column: ColumnProfileV2 | null;
  rowCount: number;
  onClose: () => void;
  onInspectFilter?: (columnName: string, filterOp: string) => void;
};

export function ColumnInspectorDrawer({
  column,
  rowCount,
  onClose,
  onInspectFilter,
}: Props) {
  useEffect(() => {
    if (!column) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [column, onClose]);

  if (!column) return null;

  const completeness = Math.max(0, 100 - column.missing_percent);
  const dist = column.distribution ?? null;
  const textStats = column.text_stats ?? null;
  const pii = column.pii_signals ?? [];
  const numMin = column.numeric ? Number(column.numeric.min) : NaN;
  const numMax = column.numeric ? Number(column.numeric.max) : NaN;

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/30 backdrop-blur-[1px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Inspect column ${column.name}`}
    >
      <aside
        className="flex h-full w-full max-w-[460px] flex-col border-l border-[var(--ss-border-strong)] bg-[var(--ss-surface)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--ss-border)] px-5 py-4">
          <div className="min-w-0">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ss-subtle)]">
              COLUMN INSPECTOR
            </span>
            <h2 className="mt-1 truncate font-mono text-base font-semibold text-[var(--ss-text)]">
              {column.name}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="rounded border border-[var(--ss-border)] bg-[var(--ss-surface-subtle)] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[var(--ss-text)]">
                {column.inferred_type}
              </span>
              {column.semantic_type && column.semantic_type !== column.inferred_type && (
                <span className="rounded border border-[var(--ss-primary-border)] bg-[var(--ss-primary-wash)] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[var(--ss-primary)]">
                  {column.semantic_type.replaceAll('_', ' ')}
                </span>
              )}
              {pii.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded bg-[var(--ss-pii-wash)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--ss-pii)]">
                  <Lock className="h-2.5 w-2.5" />
                  PII RISK
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close inspector"
            className="rounded-md border border-[var(--ss-border)] p-1.5 text-[var(--ss-muted)] hover:bg-[var(--ss-surface-hover)] hover:text-[var(--ss-text)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          {/* Completeness & Cardinality */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--ss-subtle)]">
                COMPLETENESS
              </span>
              <span className="font-mono font-semibold tabular-nums">
                {completeness.toFixed(1)}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--ss-surface-subtle)]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${completeness}%`,
                  backgroundColor:
                    completeness >= 95
                      ? 'var(--ss-pass)'
                      : completeness >= 70
                        ? 'var(--ss-warn)'
                        : 'var(--ss-danger)',
                }}
              />
            </div>

            <div className="grid grid-cols-3 gap-2 pt-1">
              <div className="rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-2.5">
                <span className="block font-mono text-[10px] text-[var(--ss-subtle)]">POPULATED</span>
                <strong className="mt-0.5 block font-mono text-sm tabular-nums">
                  {formatNumber(column.populated_count ?? rowCount - column.missing_count)}
                </strong>
              </div>
              <div className="rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-2.5">
                <span className="block font-mono text-[10px] text-[var(--ss-subtle)]">MISSING</span>
                <strong className="mt-0.5 block font-mono text-sm tabular-nums">
                  {formatNumber(column.missing_count)}
                </strong>
              </div>
              <div className="rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-2.5">
                <span className="block font-mono text-[10px] text-[var(--ss-subtle)]">DISTINCT</span>
                <strong className="mt-0.5 block font-mono text-sm tabular-nums">
                  {column.distinct_count !== null ? formatNumber(column.distinct_count) : '>2,048'}
                </strong>
              </div>
            </div>
          </section>

          {/* PII Risk Breakdown */}
          {pii.length > 0 && (
            <section className="rounded-md border border-[var(--ss-pii)]/30 bg-[var(--ss-pii-wash)] p-3.5 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--ss-pii)]">
                <Lock className="h-3.5 w-3.5" />
                <span>Sensitive Data Detected</span>
              </div>
              <p className="text-xs leading-relaxed text-[var(--ss-muted)]">
                Values matching regulated PII patterns are masked by default in the Data Grid and never sent to external AI models.
              </p>
              <div className="space-y-1.5 pt-1">
                {pii.map((sig) => (
                  <div
                    key={sig.kind}
                    className="flex items-center justify-between rounded bg-[var(--ss-surface)]/80 px-2.5 py-1.5 font-mono text-[11px]"
                  >
                    <span className="uppercase">{sig.kind.replaceAll('_', ' ')}</span>
                    <span className="tabular-nums font-semibold">
                      {sig.count.toLocaleString()} ({sig.percent}%)
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Numeric Distribution & Box Plot */}
          {dist && (
            <section className="space-y-4 border-t border-[var(--ss-border)] pt-5">
              <span className="block font-mono text-[10px] uppercase tracking-wider text-[var(--ss-subtle)]">
                STATISTICAL DISTRIBUTION
              </span>

              <DistributionHistogram distribution={dist} />

              {Number.isFinite(numMin) && Number.isFinite(numMax) && (
                <div className="pt-1">
                  <BoxWhiskerPlot min={numMin} max={numMax} distribution={dist} />
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  ['Min', column.numeric?.min ?? '—'],
                  ['Max', column.numeric?.max ?? '—'],
                  ['Mean', column.numeric?.mean ? Number(column.numeric.mean).toFixed(2) : '—'],
                  ['Std Dev', dist.std !== null ? dist.std.toFixed(2) : '—'],
                  ['Skewness', dist.skewness !== null ? dist.skewness.toFixed(2) : '—'],
                  ['IQR Outliers', `${dist.outlier_count_iqr} (${dist.outlier_percent_iqr}%)`],
                  ['Zeros', formatNumber(dist.zero_count)],
                  ['Negatives', formatNumber(dist.negative_count)],
                ].map(([label, val]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between rounded border border-[var(--ss-border)] px-2.5 py-1.5"
                  >
                    <span className="text-[var(--ss-muted)]">{label}</span>
                    <span className="font-mono font-medium tabular-nums text-[var(--ss-text)]">
                      {val}
                    </span>
                  </div>
                ))}
              </div>

              {dist.outlier_bounds && dist.outlier_count_iqr > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-[var(--ss-warn)]/30 bg-[var(--ss-warn-wash)] p-3 text-xs">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--ss-warn)] mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-medium text-[var(--ss-text)]">
                      {dist.outlier_count_iqr} advisory outlier(s) outside [{dist.outlier_bounds.lower}, {dist.outlier_bounds.upper}]
                    </p>
                    {onInspectFilter && (
                      <button
                        type="button"
                        onClick={() => onInspectFilter(column.name, 'is_outlier')}
                        className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-[var(--ss-warn)] hover:underline"
                      >
                        Filter outlier rows in Grid
                        <ArrowUpRight className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Text & Structural Hygiene */}
          {textStats && (
            <section className="space-y-3 border-t border-[var(--ss-border)] pt-5">
              <span className="block font-mono text-[10px] uppercase tracking-wider text-[var(--ss-subtle)]">
                HYGIENE & STRUCTURAL SHAPES
              </span>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center justify-between rounded border border-[var(--ss-border)] px-2.5 py-1.5">
                  <span className="text-[var(--ss-muted)]">Length range</span>
                  <span className="font-mono tabular-nums">
                    {textStats.min_length ?? 0}–{textStats.max_length} ch
                  </span>
                </div>
                <div className="flex items-center justify-between rounded border border-[var(--ss-border)] px-2.5 py-1.5">
                  <span className="text-[var(--ss-muted)]">Mean length</span>
                  <span className="font-mono tabular-nums">{textStats.mean_length} ch</span>
                </div>
                <div className="flex items-center justify-between rounded border border-[var(--ss-border)] px-2.5 py-1.5">
                  <span className="text-[var(--ss-muted)]">Whitespace pad</span>
                  <span className="font-mono font-medium tabular-nums">
                    {textStats.whitespace_padding_count}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded border border-[var(--ss-border)] px-2.5 py-1.5">
                  <span className="text-[var(--ss-muted)]">Sentinel nulls</span>
                  <span className="font-mono font-medium tabular-nums">
                    {textStats.sentinel_null_count}
                  </span>
                </div>
              </div>

              {textStats.pattern_shapes.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] text-[var(--ss-subtle)]">
                      PRIVACY-SAFE PATTERN MASKS (A/a/9)
                    </span>
                    <Sparkles className="h-3 w-3 text-[var(--ss-subtle)]" />
                  </div>
                  {textStats.pattern_shapes.map((item) => (
                    <div
                      key={item.shape}
                      className="grid grid-cols-[minmax(0,1fr)_52px] items-center gap-2 rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2.5 py-1.5"
                    >
                      <code className="truncate text-[11px] text-[var(--ss-text)]">
                        {item.shape}
                      </code>
                      <span className="text-right font-mono text-[11px] tabular-nums text-[var(--ss-muted)]">
                        {formatPercent(item.percent, 0)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Quick Jump Filters into Grid */}
          {onInspectFilter && (
            <section className="space-y-2 border-t border-[var(--ss-border)] pt-5">
              <span className="block font-mono text-[10px] uppercase tracking-wider text-[var(--ss-subtle)]">
                GRID DRILL-DOWN
              </span>
              <div className="flex flex-wrap gap-2">
                {column.missing_count > 0 && (
                  <button
                    type="button"
                    onClick={() => onInspectFilter(column.name, 'is_null')}
                    className="inline-flex items-center gap-1 rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2.5 py-1.5 text-xs font-medium hover:border-[var(--ss-border-strong)]"
                  >
                    Show {column.missing_count} missing rows
                    <ArrowUpRight className="h-3.5 w-3.5 text-[var(--ss-muted)]" />
                  </button>
                )}
                {(textStats?.whitespace_padding_count ?? 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => onInspectFilter(column.name, 'has_whitespace')}
                    className="inline-flex items-center gap-1 rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2.5 py-1.5 text-xs font-medium hover:border-[var(--ss-border-strong)]"
                  >
                    Show whitespace rows
                    <ArrowUpRight className="h-3.5 w-3.5 text-[var(--ss-muted)]" />
                  </button>
                )}
                {(textStats?.sentinel_null_count ?? 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => onInspectFilter(column.name, 'is_sentinel_null')}
                    className="inline-flex items-center gap-1 rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2.5 py-1.5 text-xs font-medium hover:border-[var(--ss-border-strong)]"
                  >
                    Show sentinel-null rows
                    <ArrowUpRight className="h-3.5 w-3.5 text-[var(--ss-muted)]" />
                  </button>
                )}
                {(dist?.outlier_count_iqr ?? 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => onInspectFilter(column.name, 'is_outlier')}
                    className="inline-flex items-center gap-1 rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2.5 py-1.5 text-xs font-medium hover:border-[var(--ss-border-strong)]"
                  >
                    Show outlier rows
                    <ArrowUpRight className="h-3.5 w-3.5 text-[var(--ss-muted)]" />
                  </button>
                )}
              </div>
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}
