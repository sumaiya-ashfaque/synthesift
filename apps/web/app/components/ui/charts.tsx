'use client';

import { useState } from 'react';
import type {
  ColumnDistribution,
  CorrelationPair,
  HistogramBin,
  QualityDimensions,
} from '@/lib/types';

function compactNum(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toFixed(abs < 10 ? 2 : 1);
}

/**
 * Tiny inline SVG sparkline histogram rendered directly inside Data Grid column headers.
 */
export function MiniHistogramSparkline({
  bins,
  height = 20,
  width = 92,
}: {
  bins: HistogramBin[];
  height?: number;
  width?: number;
}) {
  if (!bins.length) return null;
  const max = Math.max(...bins.map((b) => b.count), 1);
  const gap = 1.5;
  const barWidth = Math.max(2, (width - gap * (bins.length - 1)) / bins.length);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="block shrink-0"
      aria-hidden="true"
    >
      {bins.map((bin, idx) => {
        const h = Math.max(1.5, (bin.count / max) * (height - 2));
        const x = idx * (barWidth + gap);
        const y = height - h;
        return (
          <rect
            key={idx}
            x={x}
            y={y}
            width={barWidth}
            height={h}
            rx={1}
            fill="var(--ss-primary)"
            fillOpacity={bin.count === 0 ? 0.15 : 0.72}
          />
        );
      })}
    </svg>
  );
}

/**
 * Interactive 12-bin Swiss precision SVG histogram with IQR outlier fences.
 */
export function DistributionHistogram({
  distribution,
}: {
  distribution: ColumnDistribution;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const bins = distribution.histogram ?? [];
  if (!bins.length) {
    return (
      <p className="font-mono text-xs text-[var(--ss-subtle)]">
        No histogram bins computed.
      </p>
    );
  }

  const maxCount = Math.max(...bins.map((b) => b.count), 1);
  const minVal = bins[0].bin_start;
  const maxVal = bins[bins.length - 1].bin_end;
  const span = maxVal - minVal || 1;
  const width = 400;
  const height = 136;
  const padTop = 10;
  const padBottom = 22;
  const chartH = height - padTop - padBottom;
  const gap = 4;
  const barW = (width - gap * (bins.length - 1)) / bins.length;

  const activeBin = hovered !== null ? bins[hovered] : null;

  const fenceX = (val: number | undefined): number | null => {
    if (typeof val !== 'number' || !Number.isFinite(val)) return null;
    if (val < minVal || val > maxVal) return null;
    return ((val - minVal) / span) * width;
  };

  const lowerX = fenceX(distribution.outlier_bounds?.lower);
  const upperX = fenceX(distribution.outlier_bounds?.upper);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between font-mono text-[11px] text-[var(--ss-muted)]">
        <span>
          {activeBin
            ? `Range [${compactNum(activeBin.bin_start)}, ${compactNum(activeBin.bin_end)}]`
            : `Distribution (${bins.length} bins)`}
        </span>
        <span className="tabular-nums text-[var(--ss-text)]">
          {activeBin ? `${activeBin.count.toLocaleString()} rows` : `max bin ${maxCount.toLocaleString()}`}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto overflow-visible"
        role="img"
        aria-label="Numeric value histogram"
      >
        {/* Horizontal hairlines */}
        {[0, 0.5, 1].map((ratio) => {
          const y = padTop + chartH * (1 - ratio);
          return (
            <line
              key={ratio}
              x1={0}
              x2={width}
              y1={y}
              y2={y}
              stroke="var(--ss-border)"
              strokeWidth={1}
              strokeDasharray={ratio === 0 ? undefined : '2 3'}
            />
          );
        })}

        {/* Histogram bars */}
        {bins.map((bin, idx) => {
          const h = bin.count === 0 ? 1 : Math.max(2, (bin.count / maxCount) * chartH);
          const x = idx * (barW + gap);
          const y = padTop + chartH - h;
          const isHover = hovered === idx;
          const outOfFence =
            distribution.outlier_bounds != null &&
            (bin.bin_end < distribution.outlier_bounds.lower ||
              bin.bin_start > distribution.outlier_bounds.upper);
          return (
            <g
              key={idx}
              onMouseEnter={() => setHovered(idx)}
              onMouseLeave={() => setHovered(null)}
              className="cursor-crosshair"
            >
              <rect
                x={x}
                y={padTop}
                width={barW}
                height={chartH}
                fill="transparent"
              />
              <rect
                x={x}
                y={y}
                width={barW}
                height={h}
                rx={1.5}
                fill={outOfFence ? 'var(--ss-warn)' : 'var(--ss-primary)'}
                fillOpacity={isHover ? 1 : outOfFence ? 0.85 : 0.78}
              />
            </g>
          );
        })}

        {/* IQR Outlier Fences */}
        {lowerX !== null && (
          <line
            x1={lowerX}
            x2={lowerX}
            y1={padTop}
            y2={padTop + chartH}
            stroke="var(--ss-warn)"
            strokeWidth={1.25}
            strokeDasharray="3 2"
          />
        )}
        {upperX !== null && (
          <line
            x1={upperX}
            x2={upperX}
            y1={padTop}
            y2={padTop + chartH}
            stroke="var(--ss-warn)"
            strokeWidth={1.25}
            strokeDasharray="3 2"
          />
        )}

        {/* X-axis min / median / max labels */}
        <text
          x={0}
          y={height - 4}
          fill="var(--ss-subtle)"
          fontSize={10}
          fontFamily="var(--ss-font-mono)"
        >
          {compactNum(minVal)}
        </text>
        {distribution.p50 != null && (
          <text
            x={width / 2}
            y={height - 4}
            textAnchor="middle"
            fill="var(--ss-muted)"
            fontSize={10}
            fontFamily="var(--ss-font-mono)"
          >
            med {compactNum(distribution.p50)}
          </text>
        )}
        <text
          x={width}
          y={height - 4}
          textAnchor="end"
          fill="var(--ss-subtle)"
          fontSize={10}
          fontFamily="var(--ss-font-mono)"
        >
          {compactNum(maxVal)}
        </text>
      </svg>
    </div>
  );
}

/**
 * Horizontal Swiss precision Box-and-Whisker quantile plot (p5, p25, p50, p75, p95).
 */
export function BoxWhiskerPlot({
  min,
  max,
  distribution,
}: {
  min: number;
  max: number;
  distribution: ColumnDistribution;
}) {
  const { p5, p25, p50, p75, p95 } = distribution;
  if (p25 == null || p50 == null || p75 == null) return null;

  const span = max - min || 1;
  const pos = (v: number) => Math.max(2, Math.min(98, ((v - min) / span) * 96 + 2));

  const x5 = pos(p5 ?? min);
  const x25 = pos(p25);
  const x50 = pos(p50);
  const x75 = pos(p75);
  const x95 = pos(p95 ?? max);

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between font-mono text-[10px] uppercase tracking-wider text-[var(--ss-subtle)]">
        <span>Quantile Box (P5 · P25 · Med · P75 · P95)</span>
        <span className="tabular-nums">IQR {compactNum(distribution.iqr)}</span>
      </div>
      <svg viewBox="0 0 200 32" className="w-full h-8" aria-label="Quantile box plot">
        <line x1={4} x2={196} y1={16} y2={16} stroke="var(--ss-border)" strokeWidth={1} />
        <line
          x1={x5 * 2}
          x2={x95 * 2}
          y1={16}
          y2={16}
          stroke="var(--ss-muted)"
          strokeWidth={1.5}
        />
        <line x1={x5 * 2} x2={x5 * 2} y1={10} y2={22} stroke="var(--ss-muted)" strokeWidth={1.5} />
        <line x1={x95 * 2} x2={x95 * 2} y1={10} y2={22} stroke="var(--ss-muted)" strokeWidth={1.5} />
        <rect
          x={x25 * 2}
          y={7}
          width={Math.max(2, (x75 - x25) * 2)}
          height={18}
          rx={2}
          fill="var(--ss-primary-wash)"
          stroke="var(--ss-primary)"
          strokeWidth={1.5}
        />
        <line
          x1={x50 * 2}
          x2={x50 * 2}
          y1={6}
          y2={26}
          stroke="var(--ss-primary)"
          strokeWidth={2.5}
        />
      </svg>
      <div className="grid grid-cols-5 gap-1 font-mono text-[10px] tabular-nums text-[var(--ss-muted)]">
        <div>
          <span className="block text-[var(--ss-subtle)]">P5</span>
          {compactNum(p5)}
        </div>
        <div>
          <span className="block text-[var(--ss-subtle)]">P25</span>
          {compactNum(p25)}
        </div>
        <div>
          <span className="block text-[var(--ss-primary)]">P50</span>
          <strong className="text-[var(--ss-text)]">{compactNum(p50)}</strong>
        </div>
        <div>
          <span className="block text-[var(--ss-subtle)]">P75</span>
          {compactNum(p75)}
        </div>
        <div className="text-right">
          <span className="block text-[var(--ss-subtle)]">P95</span>
          {compactNum(p95)}
        </div>
      </div>
    </div>
  );
}

const DIMENSION_META: ReadonlyArray<{
  key: keyof QualityDimensions;
  label: string;
  weight: string;
}> = [
  { key: 'completeness', label: 'Completeness', weight: '30%' },
  { key: 'uniqueness', label: 'Uniqueness', weight: '20%' },
  { key: 'validity', label: 'Validity', weight: '20%' },
  { key: 'consistency', label: 'Consistency', weight: '15%' },
  { key: 'privacy_safety', label: 'Privacy safety', weight: '15%' },
];

export function QualityDimensionBars({
  dimensions,
}: {
  dimensions: QualityDimensions;
}) {
  return (
    <div className="space-y-3">
      {DIMENSION_META.map(({ key, label, weight }) => {
        const score = Math.max(0, Math.min(100, dimensions[key] ?? 0));
        const tone =
          score >= 90
            ? 'var(--ss-pass)'
            : score >= 70
              ? 'var(--ss-warn)'
              : 'var(--ss-danger)';
        return (
          <div key={key} className="space-y-1">
            <div className="flex items-baseline justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="font-medium text-[var(--ss-text)]">{label}</span>
                <span className="font-mono text-[10px] text-[var(--ss-subtle)]">
                  wt {weight}
                </span>
              </div>
              <span className="font-mono font-semibold tabular-nums text-[var(--ss-text)]">
                {score.toFixed(1)}%
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--ss-surface-subtle)]">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${score}%`, backgroundColor: tone }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Clean architectural SVG ring meter for overall composite quality score.
 */
export function QualityScoreMeter({ score }: { score: number | null | undefined }) {
  const safe = typeof score === 'number' && Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null;
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const offset = safe !== null ? circumference * (1 - safe / 100) : circumference;
  const stroke =
    safe === null
      ? 'var(--ss-border-strong)'
      : safe >= 88
        ? 'var(--ss-pass)'
        : safe >= 70
          ? 'var(--ss-warn)'
          : 'var(--ss-danger)';

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={84} height={84} viewBox="0 0 84 84" aria-label="Composite quality score">
        <circle
          cx={42}
          cy={42}
          r={radius}
          fill="none"
          stroke="var(--ss-surface-subtle)"
          strokeWidth={5}
        />
        <circle
          cx={42}
          cy={42}
          r={radius}
          fill="none"
          stroke={stroke}
          strokeWidth={5}
          strokeLinecap="butt"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 42 42)"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-lg font-semibold tabular-nums leading-none text-[var(--ss-text)]">
          {safe !== null ? safe.toFixed(0) : '—'}
        </span>
        <span className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--ss-subtle)]">
          / 100
        </span>
      </div>
    </div>
  );
}

/**
 * Diverging Pearson Correlation Matrix for numeric columns.
 */
export function CorrelationHeatmap({
  pairs,
}: {
  pairs: CorrelationPair[];
}) {
  if (!pairs.length) {
    return (
      <p className="text-xs text-[var(--ss-muted)]">
        Need at least two numeric columns with variance to compute Pearson correlations.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {pairs.slice(0, 8).map((pair) => {
        const mag = Math.min(1, Math.abs(pair.r));
        const positive = pair.r >= 0;
        return (
          <div
            key={`${pair.col_a}:${pair.col_b}`}
            className="grid grid-cols-[minmax(0,1fr)_96px_48px] items-center gap-3 text-xs"
          >
            <div className="truncate font-mono text-[11px] text-[var(--ss-text)]">
              <span>{pair.col_a}</span>
              <span className="mx-1.5 text-[var(--ss-subtle)]">×</span>
              <span>{pair.col_b}</span>
            </div>
            <div className="relative h-2 overflow-hidden rounded-full bg-[var(--ss-surface-subtle)]">
              <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[var(--ss-border-strong)]" />
              <div
                className="absolute top-0 bottom-0 rounded-full"
                style={{
                  left: positive ? '50%' : `${50 - mag * 50}%`,
                  width: `${mag * 50}%`,
                  backgroundColor: positive ? 'var(--ss-primary)' : 'var(--ss-warn)',
                }}
              />
            </div>
            <span className="text-right font-mono text-[11px] font-medium tabular-nums text-[var(--ss-text)]">
              {pair.r > 0 ? `+${pair.r.toFixed(2)}` : pair.r.toFixed(2)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
