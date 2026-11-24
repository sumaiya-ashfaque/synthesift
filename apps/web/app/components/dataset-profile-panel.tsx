'use client';

import { useEffect, useState } from 'react';
import { AIRemediationPanel } from '@/app/components/ai-remediation-panel';
import { request, type Dataset } from '@/lib/client-api';

type ColumnProfile = {
  name: string;
  inferred_type: string;
  missing_count: number;
  missing_percent: number;
  populated_count: number;
  distinct_count: number | null;
  distinct_count_exact: boolean;
  numeric: { min: string; max: string; mean: string } | null;
};

type Finding = {
  code: string;
  severity: 'high' | 'warning' | 'info';
  message: string;
  column: string | null;
};

type ProfileResult = {
  row_count: number;
  column_count: number;
  missing_cells: number;
  duplicate_rows?: number;
  columns: ColumnProfile[];
  quality?: {
    completeness_percent: number | null;
    duplicate_rows: number;
    duplicate_percent: number;
    finding_counts: Record<string, number>;
    findings: Finding[];
    method: string;
  };
};

type DatasetProfile = {
  dataset: string;
  status: 'queued' | 'processing' | 'ready' | 'failed';
  result: ProfileResult;
  error_code: string;
  completed_at: string | null;
};

type Props = {
  workspaceId: string;
  projectId: string;
  datasets: Dataset[];
  canProfile: boolean;
};

type ProfileSnapshot = { key: string; value: DatasetProfile | null };

async function fetchProfile(url: string): Promise<DatasetProfile | null> {
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });

  if (response.status === 404) return null;
  if (response.status === 401) throw new Error('Sign in to view this profile.');
  if (response.status === 403) throw new Error('You cannot access this profile.');
  if (!response.ok) throw new Error('Unable to load the profile. Retry.');
  return (await response.json()) as DatasetProfile;
}

function shortNumber(value: number): string {
  return value.toLocaleString();
}

export function DatasetProfilePanel({
  workspaceId,
  projectId,
  datasets,
  canProfile,
}: Props) {
  const [chosenId, setChosenId] = useState('');
  const [snapshot, setSnapshot] = useState<ProfileSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const selected =
    datasets.find((item) => item.id === chosenId) ??
    datasets.find((item) => item.status === 'ready') ??
    datasets[0];

  const selectedId = selected?.id ?? '';
  const snapshotKey = `${workspaceId}:${projectId}:${selectedId}`;
  const current = snapshot?.key === snapshotKey ? snapshot.value : undefined;
  const endpoint =
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}` +
    `/datasets/${selectedId}/profile`;
  const admitted = selected?.status === 'ready';

  useEffect(() => {
    if (!admitted) return;
    let active = true;
    void fetchProfile(endpoint)
      .then((value) => {
        if (active) setSnapshot({ key: snapshotKey, value });
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Unable to load the profile.');
        }
      });
    return () => {
      active = false;
    };
  }, [admitted, endpoint, snapshotKey]);

  const pending = current?.status === 'queued' || current?.status === 'processing';

  useEffect(() => {
    if (!pending) return;
    let active = true;
    const timer = window.setInterval(() => {
      void fetchProfile(endpoint)
        .then((value) => {
          if (active) setSnapshot({ key: snapshotKey, value });
        })
        .catch(() => {
          if (active) setError('Profile status could not refresh.');
        });
    }, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [endpoint, pending, snapshotKey]);

  async function startProfile() {
    if (!admitted || !canProfile) return;
    setBusy(true);
    setError('');
    try {
      const value = await request<DatasetProfile>(endpoint, 'POST');
      setSnapshot({ key: snapshotKey, value });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to start profiling. Please retry.');
    } finally {
      setBusy(false);
    }
  }

  async function refreshProfile() {
    if (!admitted) return;
    setBusy(true);
    setError('');
    try {
      const value = await fetchProfile(endpoint);
      setSnapshot({ key: snapshotKey, value });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to refresh.');
    } finally {
      setBusy(false);
    }
  }

  const result = current?.status === 'ready' ? current.result : null;
  const quality = result?.quality;
  const distribution = result?.columns.reduce<Record<string, number>>((counts, column) => {
    counts[column.inferred_type] = (counts[column.inferred_type] ?? 0) + 1;
    return counts;
  }, {});
  const missing =
    result?.columns
      .filter((column) => column.missing_count > 0)
      .sort((a, b) => b.missing_percent - a.missing_percent) ?? [];

  return (
    <section
      className="rounded-lg border border-[var(--ss-border)] bg-[var(--ss-surface)] p-5 space-y-4"
      aria-labelledby="ss-profile-title"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ss-primary)]">
            Data quality
          </p>
          <h3 id="ss-profile-title" className="text-base font-semibold text-[var(--ss-text)]">
            Dataset profile
          </h3>
          <p className="text-xs text-[var(--ss-muted)]">
            Measure completeness, column structure, repeated rows and quality signals.
          </p>
        </div>
        {admitted && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void refreshProfile()}
            className="h-8 rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-3 text-xs font-medium"
          >
            Refresh
          </button>
        )}
      </header>

      <div className="space-y-1">
        <label htmlFor="ss-profile-dataset" className="block text-xs text-[var(--ss-muted)]">
          Dataset
        </label>
        <select
          id="ss-profile-dataset"
          value={selectedId}
          disabled={datasets.length === 0}
          onChange={(event) => {
            setChosenId(event.target.value);
            setError('');
          }}
          className="h-9 w-full max-w-md rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2.5 text-xs"
        >
          {datasets.length === 0 && <option value="">No datasets</option>}
          {datasets.map((item) => (
            <option key={item.id} value={item.id}>
              {item.filename} · {item.status}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-[var(--ss-danger)]/35 bg-[var(--ss-danger-wash)] px-3 py-2 text-xs text-[var(--ss-danger)]">
          {error}
        </p>
      )}

      {!selected ? (
        <p className="text-xs text-[var(--ss-muted)]">Upload a dataset file to start profiling.</p>
      ) : !admitted ? (
        <p className="text-xs text-[var(--ss-muted)]">
          Admission is {selected.status}. Profiling is available when this dataset is ready.
        </p>
      ) : current === undefined ? (
        <div className="text-xs text-[var(--ss-muted)]" role="status">
          {error ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void refreshProfile()}
              className="h-8 rounded-md border border-[var(--ss-border)] px-3 text-xs"
            >
              Retry loading
            </button>
          ) : (
            'Loading saved profile...'
          )}
        </div>
      ) : current === null ? (
        <div className="space-y-2.5">
          <p className="text-xs text-[var(--ss-muted)]">No profile has been generated for this dataset.</p>
          {canProfile && (
            <button
              type="button"
              onClick={() => void startProfile()}
              disabled={busy}
              className="h-9 rounded-md bg-[var(--ss-primary)] px-4 text-xs font-semibold text-white"
            >
              {busy ? 'Starting...' : 'Analyze dataset'}
            </button>
          )}
        </div>
      ) : current.status === 'failed' ? (
        <div className="space-y-2.5">
          <p role="status" className="text-xs text-[var(--ss-danger)]">
            Profiling failed: {current.error_code || 'processing_error'}.
          </p>
          {canProfile && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void startProfile()}
              className="h-9 rounded-md bg-[var(--ss-primary)] px-4 text-xs font-semibold text-white"
            >
              Retry profiling
            </button>
          )}
        </div>
      ) : pending ? (
        <p role="status" className="font-mono text-xs text-[var(--ss-primary)]">
          {current.status === 'queued' ? 'Profiling queued' : 'Profiling in progress'}. Status updates automatically.
        </p>
      ) : result ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5" aria-label="Profile summary">
            <div className="rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-3">
              <span className="block font-mono text-[10px] text-[var(--ss-subtle)]">Rows</span>
              <strong className="font-mono text-base tabular-nums">{shortNumber(result.row_count)}</strong>
            </div>
            <div className="rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-3">
              <span className="block font-mono text-[10px] text-[var(--ss-subtle)]">Columns</span>
              <strong className="font-mono text-base tabular-nums">{shortNumber(result.column_count)}</strong>
            </div>
            <div className="rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-3">
              <span className="block font-mono text-[10px] text-[var(--ss-subtle)]">Missing cells</span>
              <strong className="font-mono text-base tabular-nums">{shortNumber(result.missing_cells)}</strong>
            </div>
            <div className="rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-3">
              <span className="block font-mono text-[10px] text-[var(--ss-subtle)]">Completeness</span>
              <strong className="font-mono text-base tabular-nums">
                {quality?.completeness_percent ??
                  (result.row_count * result.column_count
                    ? Math.round(
                        10000 * (1 - result.missing_cells / (result.row_count * result.column_count)),
                      ) / 100
                    : 0)}
                %
              </strong>
            </div>
            <div className="rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-3">
              <span className="block font-mono text-[10px] text-[var(--ss-subtle)]">Repeated rows</span>
              <strong className="font-mono text-base tabular-nums">
                {shortNumber(result.duplicate_rows ?? 0)}
              </strong>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <section className="rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-4 space-y-2" aria-labelledby="ss-missing-title">
              <h4 id="ss-missing-title" className="text-xs font-semibold">Missing values by column</h4>
              {missing.length === 0 ? (
                <p className="text-xs text-[var(--ss-muted)]">No missing cells detected.</p>
              ) : (
                <ul className="space-y-1.5 text-xs">
                  {missing.slice(0, 8).map((column) => (
                    <li key={column.name} className="flex items-center justify-between gap-2 font-mono">
                      <span className="truncate">{column.name}</span>
                      <strong>{column.missing_percent}%</strong>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-4 space-y-2" aria-labelledby="ss-types-title">
              <h4 id="ss-types-title" className="text-xs font-semibold">Inferred column types</h4>
              <ul className="space-y-1.5 text-xs font-mono">
                {Object.entries(distribution ?? {}).map(([type, count]) => (
                  <li key={type} className="flex items-center justify-between">
                    <span>{type}</span>
                    <strong>{count}</strong>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <section aria-labelledby="ss-findings-title" className="space-y-2">
            <h4 id="ss-findings-title" className="text-xs font-semibold">Quality findings</h4>
            {quality?.findings.length ? (
              <ul className="divide-y divide-[var(--ss-border)] rounded border border-[var(--ss-border)]">
                {quality.findings.map((finding, index) => (
                  <li key={`${finding.code}:${finding.column ?? ''}:${index}`} className="p-3 text-xs">
                    <strong className="font-mono">{finding.column ?? 'Dataset'}</strong>
                    <p className="text-[var(--ss-muted)] mt-0.5">{finding.message}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-[var(--ss-muted)]">
                No issues found by the current deterministic checks.
              </p>
            )}
          </section>

          <section aria-labelledby="ss-columns-title" className="space-y-2">
            <h4 id="ss-columns-title" className="text-xs font-semibold">Column statistics</h4>
            <div className="overflow-x-auto rounded border border-[var(--ss-border)]">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="border-b border-[var(--ss-border)] bg-[var(--ss-surface-subtle)] font-mono text-[10px]">
                  <tr>
                    <th scope="col" className="px-3 py-2">Column</th>
                    <th scope="col" className="px-3 py-2">Type</th>
                    <th scope="col" className="px-3 py-2">Missing</th>
                    <th scope="col" className="px-3 py-2">Distinct</th>
                    <th scope="col" className="px-3 py-2">Numeric range / mean</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ss-border)] font-mono">
                  {result.columns.map((column) => (
                    <tr key={column.name}>
                      <td className="px-3 py-2"><strong>{column.name}</strong></td>
                      <td className="px-3 py-2">{column.inferred_type}</td>
                      <td className="px-3 py-2">{column.missing_count} ({column.missing_percent}%)</td>
                      <td className="px-3 py-2">
                        {column.distinct_count_exact ? column.distinct_count : 'Above tracking limit'}
                      </td>
                      <td className="px-3 py-2">
                        {column.numeric
                          ? `${column.numeric.min} – ${column.numeric.max}; mean ${column.numeric.mean}`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : (
        <p className="text-xs text-[var(--ss-muted)]">No profiling result is available.</p>
      )}

      {result && selected && (
        <AIRemediationPanel
          key={`${workspaceId}:${projectId}:${selected.id}`}
          workspaceId={workspaceId}
          projectId={projectId}
          datasetId={selected.id}
          canRun={canProfile}
        />
      )}
    </section>
  );
}
