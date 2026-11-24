'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Filter,
  Info,
  Lock,
  Search,
  X,
} from 'lucide-react';
import { MiniHistogramSparkline } from '@/app/components/ui/charts';
import { fetchDatasetRows, type RowsQueryParams } from '@/lib/client-api';
import { cn, formatNumber } from '@/lib/cn';
import type {
  CellFlag,
  ColumnProfileV2,
  DatasetRowsResponse,
} from '@/lib/types';

export type ActiveColumnFilter = {
  column: string;
  op: string;
  label: string;
} | null;

type Props = {
  workspaceId: string;
  projectId: string;
  datasetId: string;
  profileColumns?: ColumnProfileV2[];
  externalFilter?: ActiveColumnFilter;
  onClearExternalFilter?: () => void;
  onInspectColumn?: (columnName: string) => void;
};

const ISSUE_FILTERS: ReadonlyArray<{
  id: NonNullable<RowsQueryParams['issueOnly']>;
  label: string;
}> = [
  { id: 'all', label: 'All rows' },
  { id: 'any', label: 'Any defect' },
  { id: 'nulls', label: 'Nulls' },
  { id: 'whitespace', label: 'Whitespace' },
  { id: 'sentinel', label: 'Sentinel nulls' },
  { id: 'outliers', label: 'Outliers' },
];

function renderDiagnosticCell(value: string, flags: CellFlag[] | undefined) {
  const flagSet = new Set(flags ?? []);
  if (flagSet.has('null')) {
    return (
      <span className="inline-block rounded px-1 py-0.5 font-mono text-[10px] tracking-wider text-[var(--ss-subtle)] bg-[var(--ss-surface-subtle)]">
        NULL
      </span>
    );
  }

  const leadingMatch = flagSet.has('whitespace') ? (value.match(/^\s+/)?.[0] ?? '') : '';
  const trailingMatch = flagSet.has('whitespace') ? (value.match(/\s+$/)?.[0] ?? '') : '';
  const coreText = flagSet.has('whitespace')
    ? value.slice(leadingMatch.length, value.length - trailingMatch.length)
    : value;

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      {flagSet.has('pii_masked') && (
        <Lock className="h-3 w-3 shrink-0 text-[var(--ss-pii)]" aria-label="PII masked" />
      )}
      <span
        className={cn(
          'truncate',
          flagSet.has('pii_masked') && 'font-mono text-[11px] text-[var(--ss-pii)]',
          flagSet.has('sentinel_null') &&
            'font-mono text-[11px] underline decoration-dotted decoration-[var(--ss-warn)] text-[var(--ss-warn)]',
          flagSet.has('outlier') && 'font-mono font-semibold text-[var(--ss-warn)]',
        )}
        title={value}
      >
        {leadingMatch && (
          <span className="rounded-xs bg-[var(--ss-warn-wash)] px-0.5 font-mono text-[10px] text-[var(--ss-warn)]">
            {'␣'.repeat(Math.min(leadingMatch.length, 3))}
          </span>
        )}
        {coreText}
        {trailingMatch && (
          <span className="rounded-xs bg-[var(--ss-warn-wash)] px-0.5 font-mono text-[10px] text-[var(--ss-warn)]">
            {'␣'.repeat(Math.min(trailingMatch.length, 3))}
          </span>
        )}
      </span>
      {flagSet.has('outlier') && (
        <span className="shrink-0 rounded bg-[var(--ss-warn-wash)] px-1 py-0.5 font-mono text-[9px] font-semibold uppercase text-[var(--ss-warn)]">
          IQR
        </span>
      )}
      {flagSet.has('sentinel_null') && (
        <span className="shrink-0 rounded bg-[var(--ss-warn-wash)] px-1 py-0.5 font-mono text-[9px] font-semibold uppercase text-[var(--ss-warn)]">
          NA
        </span>
      )}
    </div>
  );
}

export function InteractiveDataGrid({
  workspaceId,
  projectId,
  datasetId,
  profileColumns = [],
  externalFilter = null,
  onClearExternalFilter,
  onInspectColumn,
}: Props) {
  const [data, setData] = useState<DatasetRowsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [queryMs, setQueryMs] = useState<number | null>(null);

  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [sortBy, setSortBy] = useState('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [issueOnly, setIssueOnly] = useState<NonNullable<RowsQueryParams['issueOnly']>>('all');
  const [maskPii, setMaskPii] = useState(true);

  const profileMap = useMemo(() => {
    const map = new Map<string, ColumnProfileV2>();
    for (const col of profileColumns) {
      map.set(col.name, col);
    }
    return map;
  }, [profileColumns]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setOffset(0);
    }, 240);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let active = true;
    const started = performance.now();

    fetchDatasetRows(workspaceId, projectId, datasetId, {
      limit,
      offset,
      sortBy: sortBy || undefined,
      sortDir,
      search: debouncedSearch || undefined,
      issueOnly,
      filterCol: externalFilter?.column,
      filterOp: externalFilter?.op,
      maskPii,
    })
      .then((res) => {
        if (!active) return;
        setData(res);
        setError('');
        setQueryMs(Math.round(performance.now() - started));
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : 'Unable to query dataset rows.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    workspaceId,
    projectId,
    datasetId,
    limit,
    offset,
    sortBy,
    sortDir,
    debouncedSearch,
    issueOnly,
    externalFilter,
    maskPii,
  ]);

  function toggleSort(colName: string) {
    setOffset(0);
    setLoading(true);
    if (sortBy !== colName) {
      setSortBy(colName);
      setSortDir('asc');
    } else if (sortDir === 'asc') {
      setSortDir('desc');
    } else {
      setSortBy('');
      setSortDir('asc');
    }
  }

  const colNames = data?.columns ?? [];
  const piiSet = new Set(data?.pii_columns ?? []);
  const rows = data?.rows ?? [];

  const totalRows = data?.total_rows ?? 0;
  const filteredRows = data?.filtered_rows ?? 0;
  const startRow = filteredRows === 0 ? 0 : offset + 1;
  const endRow = Math.min(filteredRows, offset + limit);
  const hasPrev = offset > 0;
  const hasNext = offset + limit < filteredRows;

  return (
    <div className="space-y-3">
      {/* Grid Control Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ss-subtle)]"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search rows via DuckDB…"
              aria-label="Search dataset rows"
              className="h-8 w-56 rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] pl-8 pr-3 text-xs text-[var(--ss-text)] placeholder:text-[var(--ss-subtle)] focus:border-[var(--ss-primary)]"
            />
          </div>

          <div
            className="inline-flex items-center rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-0.5"
            role="group"
            aria-label="Diagnostic row filter"
          >
            {ISSUE_FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setIssueOnly(item.id);
                  setOffset(0);
                  setLoading(true);
                }}
                className={cn(
                  'rounded px-2 py-1 text-[11px] font-medium transition-colors',
                  issueOnly === item.id
                    ? 'bg-[var(--ss-surface)] text-[var(--ss-text)] shadow-xs font-semibold'
                    : 'text-[var(--ss-muted)] hover:text-[var(--ss-text)]',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          {externalFilter && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--ss-primary-border)] bg-[var(--ss-primary-wash)] px-2.5 py-1 font-mono text-[11px] text-[var(--ss-primary)]">
              <Filter className="h-3 w-3" />
              <span>{externalFilter.label}</span>
              {onClearExternalFilter && (
                <button
                  type="button"
                  onClick={() => {
                    setOffset(0);
                    setLoading(true);
                    onClearExternalFilter();
                  }}
                  aria-label="Clear column filter"
                  className="hover:opacity-75"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          )}
        </div>

        {/* PII Privacy Masking Switch */}
        <div className="flex items-center gap-2">
          {data?.pii_columns && data.pii_columns.length > 0 && (
            <button
              type="button"
              disabled={!data.can_unmask_pii && maskPii}
              onClick={() => {
                setLoading(true);
                setMaskPii((prev) => !prev);
              }}
              title={
                !data.can_unmask_pii
                  ? 'Viewers cannot unmask PII columns'
                  : maskPii
                    ? 'Click to reveal raw PII values'
                    : 'Click to mask PII values'
              }
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 font-mono text-[11px] font-medium transition-colors',
                maskPii
                  ? 'border-[var(--ss-pii)]/35 bg-[var(--ss-pii-wash)] text-[var(--ss-pii)]'
                  : 'border-[var(--ss-warn)]/40 bg-[var(--ss-warn-wash)] text-[var(--ss-warn)]',
                !data.can_unmask_pii && maskPii && 'opacity-75 cursor-not-allowed',
              )}
            >
              {maskPii ? (
                <>
                  <EyeOff className="h-3.5 w-3.5" />
                  <span>PII Masked ({data.pii_columns.length})</span>
                </>
              ) : (
                <>
                  <Eye className="h-3.5 w-3.5" />
                  <span>PII Revealed</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-[var(--ss-danger)]/35 bg-[var(--ss-danger-wash)] px-3.5 py-2.5 text-xs text-[var(--ss-danger)]"
        >
          {error}
        </div>
      )}

      {/* Precision Data Grid */}
      <div className="overflow-hidden rounded-lg border border-[var(--ss-border)] bg-[var(--ss-surface)]">
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 bg-[var(--ss-surface-subtle)] border-b border-[var(--ss-border-strong)]">
              <tr>
                <th
                  scope="col"
                  className="w-12 border-r border-[var(--ss-border)] px-3 py-2.5 align-top font-mono text-[10px] uppercase tracking-wider text-[var(--ss-subtle)]"
                >
                  #
                </th>
                {colNames.map((name) => {
                  const meta = profileMap.get(name);
                  const isPii = piiSet.has(name) || (meta?.pii_signals?.length ?? 0) > 0;
                  const missingPct = meta?.missing_percent ?? 0;
                  const completenessPct = Math.max(0, 100 - missingPct);
                  const histogram = meta?.distribution?.histogram ?? [];
                  const isSorted = sortBy === name;

                  return (
                    <th
                      key={name}
                      scope="col"
                      className="border-r border-[var(--ss-border)] last:border-r-0 px-3 py-2.5 align-top font-normal"
                    >
                      <div className="flex flex-col gap-1.5 min-w-[140px] max-w-[240px]">
                        <div className="flex items-center justify-between gap-1.5">
                          <button
                            type="button"
                            onClick={() => toggleSort(name)}
                            className="flex items-center gap-1 min-w-0 text-left font-mono text-[11px] font-semibold text-[var(--ss-text)] hover:text-[var(--ss-primary)]"
                            title={`Sort by ${name}`}
                          >
                            <span className="truncate">{name}</span>
                            {isSorted ? (
                              sortDir === 'asc' ? (
                                <ArrowUp className="h-3 w-3 shrink-0 text-[var(--ss-primary)]" />
                              ) : (
                                <ArrowDown className="h-3 w-3 shrink-0 text-[var(--ss-primary)]" />
                              )
                            ) : (
                              <ArrowUpDown className="h-3 w-3 shrink-0 text-[var(--ss-subtle)] opacity-60" />
                            )}
                          </button>

                          {meta && onInspectColumn && (
                            <button
                              type="button"
                              onClick={() => onInspectColumn(name)}
                              title={`Inspect ${name} statistics`}
                              aria-label={`Inspect ${name}`}
                              className="rounded p-0.5 text-[var(--ss-subtle)] hover:bg-[var(--ss-surface-hover)] hover:text-[var(--ss-text)]"
                            >
                              <Info className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1">
                            <span className="rounded bg-[var(--ss-surface)] border border-[var(--ss-border)] px-1 py-px font-mono text-[9px] uppercase text-[var(--ss-muted)]">
                              {meta?.inferred_type ?? 'str'}
                            </span>
                            {isPii && (
                              <span
                                className="inline-flex items-center gap-0.5 rounded bg-[var(--ss-pii-wash)] px-1 py-px font-mono text-[9px] font-semibold text-[var(--ss-pii)]"
                                title="Column contains detected PII"
                              >
                                <Lock className="h-2.5 w-2.5" />
                                PII
                              </span>
                            )}
                          </div>
                          {histogram.length > 0 && (
                            <MiniHistogramSparkline bins={histogram} width={64} height={16} />
                          )}
                        </div>

                        {meta && (
                          <div
                            className="h-[2.5px] w-full overflow-hidden rounded-full bg-[var(--ss-border)]"
                            title={`${completenessPct.toFixed(1)}% non-missing`}
                          >
                            <div
                              className="h-full"
                              style={{
                                width: `${completenessPct}%`,
                                backgroundColor:
                                  completenessPct >= 95
                                    ? 'var(--ss-pass)'
                                    : completenessPct >= 70
                                      ? 'var(--ss-warn)'
                                      : 'var(--ss-danger)',
                              }}
                            />
                          </div>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ss-border)]">
              {loading && !data ? (
                <tr>
                  <td
                    colSpan={Math.max(colNames.length + 1, 1)}
                    className="px-4 py-12 text-center font-mono text-xs text-[var(--ss-muted)]"
                  >
                    Querying dataset via DuckDB…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={Math.max(colNames.length + 1, 1)}
                    className="px-4 py-12 text-center text-xs text-[var(--ss-muted)]"
                  >
                    No rows match the active search or defect filters.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.row_index}
                    className="hover:bg-[var(--ss-surface-hover)] transition-colors"
                  >
                    <td className="w-12 border-r border-[var(--ss-border)]/70 bg-[var(--ss-surface-subtle)]/40 px-3 py-2 text-right font-mono text-[11px] tabular-nums text-[var(--ss-subtle)]">
                      {row.row_index}
                    </td>
                    {colNames.map((colId) => {
                      const flags = row.flags[colId] ?? [];
                      const isNull = flags.includes('null');
                      const isOutlier = flags.includes('outlier');
                      return (
                        <td
                          key={colId}
                          className={cn(
                            'max-w-[260px] border-r border-[var(--ss-border)]/70 last:border-r-0 px-3 py-2 align-middle',
                            isNull && 'ss-null-cell',
                            isOutlier &&
                              'border-l-2 border-l-[var(--ss-warn)] bg-[var(--ss-warn-wash)]/40',
                          )}
                        >
                          {renderDiagnosticCell(row.cells[colId] ?? '', flags)}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Telemetry & Pagination */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ss-border)] bg-[var(--ss-surface-subtle)]/60 px-3.5 py-2 text-[11px] text-[var(--ss-muted)]">
          <div className="flex items-center gap-3 font-mono tabular-nums">
            <span>
              {formatNumber(startRow)}–{formatNumber(endRow)} of {formatNumber(filteredRows)}
              {filteredRows !== totalRows
                ? ` (filtered from ${formatNumber(totalRows)})`
                : ' rows'}
            </span>
            {queryMs !== null && (
              <span className="hidden sm:inline text-[var(--ss-subtle)]">
                DuckDB · {queryMs}ms
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 font-mono text-[11px]">
              <span className="text-[var(--ss-subtle)]">Page</span>
              <select
                value={limit}
                onChange={(e) => {
                  setLimit(Number(e.target.value));
                  setOffset(0);
                  setLoading(true);
                }}
                className="rounded border border-[var(--ss-border)] bg-[var(--ss-surface)] px-1.5 py-0.5 text-[11px] text-[var(--ss-text)]"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>

            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={!hasPrev || loading}
                onClick={() => {
                  setOffset(Math.max(0, offset - limit));
                  setLoading(true);
                }}
                className="inline-flex h-7 items-center gap-1 rounded border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2 text-[11px] font-medium text-[var(--ss-text)] hover:bg-[var(--ss-surface-hover)] disabled:opacity-45"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Prev
              </button>
              <button
                type="button"
                disabled={!hasNext || loading}
                onClick={() => {
                  setOffset(offset + limit);
                  setLoading(true);
                }}
                className="inline-flex h-7 items-center gap-1 rounded border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2 text-[11px] font-medium text-[var(--ss-text)] hover:bg-[var(--ss-surface-hover)] disabled:opacity-45"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
