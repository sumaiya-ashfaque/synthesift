'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, GitBranch, RefreshCw } from 'lucide-react';
import { fetchProjectLineage } from '@/lib/client-api';
import { cn, formatNumber, shortDigest } from '@/lib/cn';
import type { LineageNode, ProjectLineageGraph } from '@/lib/types';

type Props = {
  workspaceId: string;
  projectId: string;
  activeDatasetId: string;
  onSelectDataset: (datasetId: string) => void;
};

type PositionedNode = LineageNode & {
  depth: number;
  x: number;
  y: number;
};

const NODE_W = 248;
const NODE_H = 104;
const COL_GAP = 112;
const ROW_GAP = 28;
const PAD = 24;

export function LineageDag({
  workspaceId,
  projectId,
  activeDatasetId,
  onSelectDataset,
}: Props) {
  const [graph, setGraph] = useState<ProjectLineageGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await fetchProjectLineage(workspaceId, projectId);
      setGraph(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load project lineage.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    fetchProjectLineage(workspaceId, projectId)
      .then((data) => {
        if (active) setGraph(data);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Unable to load project lineage.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workspaceId, projectId]);

  const layout = useMemo(() => {
    const nodes = graph?.nodes ?? [];
    const edges = graph?.edges ?? [];
    const incoming = new Map<string, string[]>();
    for (const edge of edges) {
      const list = incoming.get(edge.target) ?? [];
      list.push(edge.source);
      incoming.set(edge.target, list);
    }

    const depthCache = new Map<string, number>();
    const computeDepth = (id: string, visiting = new Set<string>()): number => {
      if (depthCache.has(id)) return depthCache.get(id)!;
      if (visiting.has(id)) return 0;
      visiting.add(id);
      const parents = incoming.get(id) ?? [];
      const d = parents.length === 0 ? 0 : Math.max(...parents.map((p) => computeDepth(p, visiting))) + 1;
      depthCache.set(id, d);
      return d;
    };

    const byDepth = new Map<number, LineageNode[]>();
    for (const node of nodes) {
      const d = computeDepth(node.id);
      const bucket = byDepth.get(d) ?? [];
      bucket.push(node);
      byDepth.set(d, bucket);
    }

    const positioned = new Map<string, PositionedNode>();
    let maxCol = 0;
    let maxRow = 0;

    for (const [depth, bucket] of byDepth.entries()) {
      maxCol = Math.max(maxCol, depth);
      maxRow = Math.max(maxRow, bucket.length);
      bucket.forEach((node, rowIdx) => {
        positioned.set(node.id, {
          ...node,
          depth,
          x: PAD + depth * (NODE_W + COL_GAP),
          y: PAD + rowIdx * (NODE_H + ROW_GAP),
        });
      });
    }

    const width = Math.max(640, PAD * 2 + (maxCol + 1) * NODE_W + maxCol * COL_GAP);
    const height = Math.max(220, PAD * 2 + Math.max(1, maxRow) * NODE_H + Math.max(0, maxRow - 1) * ROW_GAP);

    return { positioned, width, height, edges };
  }, [graph]);

  if (loading && !graph) {
    return (
      <p className="py-10 text-center font-mono text-xs text-[var(--ss-muted)]" role="status">
        Building project version lineage DAG…
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--ss-text)]">
            Dataset Version Lineage DAG
          </h2>
          <p className="text-xs text-[var(--ss-muted)]">
            Immutable provenance graph across this project. Click any dataset node to inspect or roll back to that version.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2.5 text-xs font-medium text-[var(--ss-text)] hover:bg-[var(--ss-surface-hover)]"
        >
          <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
          <span>Refresh DAG</span>
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

      {/* Interactive SVG DAG Canvas */}
      <div className="overflow-x-auto rounded-lg border border-[var(--ss-border)] bg-[var(--ss-canvas)]">
        <div className="relative" style={{ width: layout.width, height: layout.height }}>
          <svg
            width={layout.width}
            height={layout.height}
            className="absolute inset-0 pointer-events-none"
            aria-label="Dataset version lineage graph"
          >
            <defs>
              <marker
                id="ss-dag-arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--ss-primary)" />
              </marker>
            </defs>

            {layout.edges.map((edge) => {
              const src = layout.positioned.get(edge.source);
              const dst = layout.positioned.get(edge.target);
              if (!src || !dst) return null;
              const x1 = src.x + NODE_W;
              const y1 = src.y + NODE_H / 2;
              const x2 = dst.x - 4;
              const y2 = dst.y + NODE_H / 2;
              const mx = (x1 + x2) / 2;
              const d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
              return (
                <g key={edge.id}>
                  <path
                    d={d}
                    fill="none"
                    stroke="var(--ss-primary)"
                    strokeWidth={1.75}
                    markerEnd="url(#ss-dag-arrow)"
                  />
                  <rect
                    x={mx - 44}
                    y={(y1 + y2) / 2 - 11}
                    width={88}
                    height={22}
                    rx={4}
                    fill="var(--ss-surface)"
                    stroke="var(--ss-primary-border)"
                    strokeWidth={1}
                  />
                  <text
                    x={mx}
                    y={(y1 + y2) / 2 + 3.5}
                    textAnchor="middle"
                    fill="var(--ss-primary)"
                    fontSize={10}
                    fontFamily="var(--ss-font-mono)"
                  >
                    {edge.step_count} op · {edge.score_delta != null ? `${edge.score_delta >= 0 ? '+' : ''}${edge.score_delta}` : `${edge.cells_changed}Δ`}
                  </text>
                </g>
              );
            })}
          </svg>

          {Array.from(layout.positioned.values()).map((node) => {
            const isActive = node.id === activeDatasetId;
            return (
              <button
                key={node.id}
                type="button"
                onClick={() => onSelectDataset(node.id)}
                style={{
                  left: node.x,
                  top: node.y,
                  width: NODE_W,
                  height: NODE_H,
                }}
                className={cn(
                  'absolute flex flex-col justify-between rounded-lg border p-3 text-left transition-colors',
                  isActive
                    ? 'border-[var(--ss-primary)] bg-[var(--ss-primary-wash)]/55 shadow-sm'
                    : 'border-[var(--ss-border-strong)] bg-[var(--ss-surface)] hover:border-[var(--ss-primary)]',
                )}
              >
                <div className="flex items-center justify-between gap-2 w-full">
                  <span className="inline-flex items-center gap-1 rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-[var(--ss-muted)]">
                    <GitBranch className="h-2.5 w-2.5 text-[var(--ss-primary)]" />
                    v{node.depth} · {node.file_format}
                  </span>
                  {typeof node.overall_score === 'number' && (
                    <span className="font-mono text-[11px] font-semibold tabular-nums text-[var(--ss-primary)]">
                      {node.overall_score.toFixed(1)}/100
                    </span>
                  )}
                </div>

                <strong className="truncate font-mono text-xs font-semibold text-[var(--ss-text)]">
                  {node.filename}
                </strong>

                <div className="flex items-center justify-between font-mono text-[10px] text-[var(--ss-subtle)] tabular-nums">
                  <span>
                    {formatNumber(node.row_count)} × {formatNumber(node.column_count)}
                  </span>
                  <span>{shortDigest(node.sha256)}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Accessible Provenance Edge Ledger */}
      {layout.edges.length > 0 && (
        <div className="space-y-2">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--ss-subtle)]">
            TRANSFORMATION EDGES ({layout.edges.length})
          </span>
          <div className="overflow-x-auto rounded-lg border border-[var(--ss-border)]">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="border-b border-[var(--ss-border)] bg-[var(--ss-surface-subtle)] font-mono text-[10px] uppercase text-[var(--ss-muted)]">
                <tr>
                  <th className="px-3 py-2">Derivation</th>
                  <th className="px-3 py-2">Plan / Recipe</th>
                  <th className="px-3 py-2">Impact</th>
                  <th className="px-3 py-2">Score Delta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ss-border)] font-mono text-[11px]">
                {layout.edges.map((edge) => {
                  const src = layout.positioned.get(edge.source);
                  const dst = layout.positioned.get(edge.target);
                  return (
                    <tr key={edge.id}>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-1.5">
                          <span>{src?.filename ?? edge.source.slice(0, 8)}</span>
                          <ArrowRight className="h-3 w-3 text-[var(--ss-primary)]" />
                          <strong className="text-[var(--ss-text)]">
                            {dst?.filename ?? edge.target.slice(0, 8)}
                          </strong>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-sans text-[var(--ss-muted)]">{edge.label}</td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {edge.cells_changed} cells · -{edge.rows_removed} rows
                      </td>
                      <td className="px-3 py-2.5 tabular-nums font-semibold text-[var(--ss-pass)]">
                        {edge.score_delta != null
                          ? `${edge.score_delta >= 0 ? '+' : ''}${edge.score_delta} pts`
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
