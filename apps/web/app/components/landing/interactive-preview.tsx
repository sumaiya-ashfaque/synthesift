'use client';

import { useState } from 'react';
import { Check, Eye, EyeOff, Lock, ShieldCheck, Sparkles, Table2 } from 'lucide-react';
import {
  DistributionHistogram,
  MiniHistogramSparkline,
  QualityDimensionBars,
} from '@/app/components/ui/charts';
import { cn } from '@/lib/cn';
import type { ColumnDistribution } from '@/lib/types';

type PreviewTab = 'grid' | 'profile' | 'ai';

const SAMPLE_HIST = [
  { bin_start: 180, bin_end: 1200, count: 44 },
  { bin_start: 1200, bin_end: 2400, count: 38 },
  { bin_start: 2400, bin_end: 3600, count: 21 },
  { bin_start: 3600, bin_end: 4800, count: 9 },
  { bin_start: 4800, bin_end: 6000, count: 5 },
  { bin_start: 6000, bin_end: 34000, count: 0 },
  { bin_start: 34000, bin_end: 78500, count: 3 },
];

const SAMPLE_DIST: ColumnDistribution = {
  p5: 310,
  p25: 940,
  p50: 1840,
  p75: 3120,
  p95: 5280,
  std: 9840.2,
  iqr: 2180,
  skewness: 5.42,
  zero_count: 0,
  negative_count: 0,
  outlier_count_iqr: 3,
  outlier_percent_iqr: 2.5,
  outlier_bounds: { lower: -2330, upper: 6390 },
  histogram: SAMPLE_HIST,
};

const SAMPLE_ROWS = [
  {
    idx: 1,
    id: 'INV-10001',
    emailRaw: 'billing.1@helvetia.io',
    emailMasked: 'b•••@helvetia.io',
    tier: 'Enterprise',
    tierFlag: null,
    mrr: '4,820.00',
    mrrOutlier: false,
  },
  {
    idx: 2,
    id: 'INV-10002',
    emailRaw: 'ops@northstarbio.io',
    emailMasked: 'o•••@northstarbio.io',
    tier: '  Growth ',
    tierFlag: 'ws' as const,
    mrr: '1,450.00',
    mrrOutlier: false,
  },
  {
    idx: 3,
    id: 'INV-10003',
    emailRaw: '',
    emailMasked: '',
    tier: 'N/A',
    tierFlag: 'na' as const,
    mrr: '74,200.00',
    mrrOutlier: true,
  },
  {
    idx: 4,
    id: 'INV-10004',
    emailRaw: 'finance@kestrel.ai',
    emailMasked: 'f•••@kestrel.ai',
    tier: 'Starter',
    tierFlag: null,
    mrr: '690.00',
    mrrOutlier: false,
  },
];

export function InteractivePreview() {
  const [tab, setTab] = useState<PreviewTab>('grid');
  const [maskPii, setMaskPii] = useState(true);

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--ss-border-strong)] bg-[var(--ss-surface)] shadow-[0_22px_54px_-24px_rgba(147,0,49,0.22)]">
      {/* Instrument Chrome Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ss-border)] bg-[var(--ss-surface-subtle)] px-3.5 py-2.5">
        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span className="rounded border border-[var(--ss-primary-border)] bg-[var(--ss-primary-wash)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--ss-primary)]">
            CSV
          </span>
          <span className="font-semibold text-[var(--ss-text)]">saas_billing_q4.csv</span>
          <span className="hidden sm:inline text-[var(--ss-subtle)]">120 rows · 11 cols</span>
        </div>

        <div className="flex items-center gap-1 rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-0.5">
          {[
            { id: 'grid' as const, label: 'Data grid', Icon: Table2 },
            { id: 'profile' as const, label: 'Profile', Icon: ShieldCheck },
            { id: 'ai' as const, label: 'AI & DSL', Icon: Sparkles },
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                'inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors',
                tab === id
                  ? 'bg-[var(--ss-surface)] text-[var(--ss-text)] shadow-xs font-semibold'
                  : 'text-[var(--ss-muted)] hover:text-[var(--ss-text)]',
              )}
            >
              <Icon className="h-3 w-3" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab Body */}
      <div className="p-4">
        {tab === 'grid' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--ss-muted)]">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--ss-pass)]" />
                <span>DUCKDB LIVE QUERY · 4ms</span>
              </div>
              <button
                type="button"
                onClick={() => setMaskPii((prev) => !prev)}
                className={cn(
                  'inline-flex items-center gap-1 rounded border px-2 py-1 font-mono text-[10px] font-medium',
                  maskPii
                    ? 'border-[var(--ss-pii)]/35 bg-[var(--ss-pii-wash)] text-[var(--ss-pii)]'
                    : 'border-[var(--ss-warn)]/40 bg-[var(--ss-warn-wash)] text-[var(--ss-warn)]',
                )}
              >
                {maskPii ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                <span>{maskPii ? 'PII Masked' : 'PII Unmasked'}</span>
              </button>
            </div>

            <div className="overflow-x-auto rounded border border-[var(--ss-border)]">
              <table className="w-full border-collapse text-left text-[11px]">
                <thead className="border-b border-[var(--ss-border)] bg-[var(--ss-surface-subtle)]">
                  <tr>
                    <th className="px-2.5 py-2 font-mono text-[10px] text-[var(--ss-subtle)]">#</th>
                    <th className="px-2.5 py-2 font-mono font-semibold text-[var(--ss-text)]">
                      <div>invoice_id</div>
                      <span className="text-[9px] font-normal text-[var(--ss-muted)]">text</span>
                    </th>
                    <th className="px-2.5 py-2 font-mono font-semibold text-[var(--ss-text)]">
                      <div className="flex items-center gap-1">
                        <span>billing_email</span>
                        <span className="rounded bg-[var(--ss-pii-wash)] px-1 text-[8px] text-[var(--ss-pii)]">
                          PII
                        </span>
                      </div>
                      <span className="text-[9px] font-normal text-[var(--ss-muted)]">email</span>
                    </th>
                    <th className="px-2.5 py-2 font-mono font-semibold text-[var(--ss-text)]">
                      <div>plan_tier</div>
                      <span className="text-[9px] font-normal text-[var(--ss-muted)]">categorical</span>
                    </th>
                    <th className="px-2.5 py-2 font-mono font-semibold text-[var(--ss-text)]">
                      <div className="flex items-center justify-between gap-2">
                        <span>mrr_usd</span>
                        <MiniHistogramSparkline bins={SAMPLE_HIST} width={44} height={14} />
                      </div>
                      <span className="text-[9px] font-normal text-[var(--ss-muted)]">decimal</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ss-border)] font-mono">
                  {SAMPLE_ROWS.map((row) => (
                    <tr key={row.idx} className="hover:bg-[var(--ss-surface-hover)]">
                      <td className="px-2.5 py-2 text-[var(--ss-subtle)] tabular-nums">{row.idx}</td>
                      <td className="px-2.5 py-2 text-[var(--ss-text)]">{row.id}</td>
                      <td className={cn('px-2.5 py-2', !row.emailRaw && 'ss-null-cell')}>
                        {!row.emailRaw ? (
                          <span className="rounded bg-[var(--ss-surface-subtle)] px-1 py-0.5 text-[9px] text-[var(--ss-subtle)]">
                            NULL
                          </span>
                        ) : maskPii ? (
                          <span className="inline-flex items-center gap-1 text-[var(--ss-pii)]">
                            <Lock className="h-2.5 w-2.5" />
                            {row.emailMasked}
                          </span>
                        ) : (
                          <span>{row.emailRaw}</span>
                        )}
                      </td>
                      <td className="px-2.5 py-2">
                        {row.tierFlag === 'ws' ? (
                          <span>
                            <span className="rounded-xs bg-[var(--ss-warn-wash)] px-0.5 text-[9px] text-[var(--ss-warn)]">
                              ␣␣
                            </span>
                            Growth
                            <span className="rounded-xs bg-[var(--ss-warn-wash)] px-0.5 text-[9px] text-[var(--ss-warn)]">
                              ␣
                            </span>
                          </span>
                        ) : row.tierFlag === 'na' ? (
                          <span className="inline-flex items-center gap-1 text-[var(--ss-warn)] underline decoration-dotted">
                            N/A
                            <span className="rounded bg-[var(--ss-warn-wash)] px-1 text-[8px] font-semibold no-underline">
                              NA
                            </span>
                          </span>
                        ) : (
                          row.tier
                        )}
                      </td>
                      <td
                        className={cn(
                          'px-2.5 py-2 tabular-nums',
                          row.mrrOutlier &&
                            'border-l-2 border-l-[var(--ss-warn)] bg-[var(--ss-warn-wash)]/50 font-semibold text-[var(--ss-warn)]',
                        )}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          {row.mrr}
                          {row.mrrOutlier && (
                            <span className="rounded bg-[var(--ss-warn-wash)] px-1 text-[8px]">
                              IQR
                            </span>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="font-mono text-[10px] text-[var(--ss-subtle)]">
              Click “PII Masked” above to preview role-gated cell redaction. Raw cells never enter LLM prompts.
            </p>
          </div>
        )}

        {tab === 'profile' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-3">
                <DistributionHistogram distribution={SAMPLE_DIST} />
              </div>
              <div className="rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-3">
                <span className="block mb-2 font-mono text-[10px] uppercase tracking-wider text-[var(--ss-subtle)]">
                  5-DIMENSION SCORE · 84.6 / 100
                </span>
                <QualityDimensionBars
                  dimensions={{
                    completeness: 94.8,
                    uniqueness: 96.7,
                    validity: 88.2,
                    consistency: 79.5,
                    privacy_safety: 60.0,
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {tab === 'ai' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--ss-pii)]">
                  EGRESS PAYLOAD (ZERO ROWS)
                </span>
                <Lock className="h-3 w-3 text-[var(--ss-pii)]" />
              </div>
              <pre className="overflow-x-auto font-mono text-[10px] leading-relaxed text-[var(--ss-muted)]">
{`{
  "columns": [
    {"id": "C4", "name": "billing_email",
     "pii_kinds": ["email"], "missing_pct": 8.3},
    {"id": "C9", "name": "mrr_usd",
     "outlier_count_iqr": 3}
  ],
  "findings": [
    {"id": "F1", "code": "duplicate_rows"},
    {"id": "F4", "code": "whitespace_padding"}
  ]
}`}
              </pre>
            </div>

            <div className="rounded-md border border-[var(--ss-primary-border)] bg-[var(--ss-primary-wash)]/50 p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--ss-primary)]">
                  BOUNDED REMEDIATION GATE
                </span>
                <Check className="h-3.5 w-3.5 text-[var(--ss-primary)]" />
              </div>
              <div className="space-y-1.5 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span className="text-[var(--ss-muted)]">Operations</span>
                  <span className="text-[var(--ss-text)]">trim + dedupe</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--ss-muted)]">Rows delta</span>
                  <span className="tabular-nums text-[var(--ss-text)]">120 → 116 (-4)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--ss-muted)]">Cells normalized</span>
                  <span className="tabular-nums text-[var(--ss-pass)]">24 cells</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--ss-muted)]">Source file</span>
                  <span className="text-[var(--ss-text)]">Immutable (SHA-256)</span>
                </div>
              </div>
              <p className="pt-1 border-t border-[var(--ss-primary-border)] text-[10px] text-[var(--ss-muted)]">
                LLM text is never executed. Derived CSV + Audit PDF are generated only after explicit human approval.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
