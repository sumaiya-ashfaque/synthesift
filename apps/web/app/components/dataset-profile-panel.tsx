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
        if (active) setError(
          cause instanceof Error ? cause.message : 'Unable to load the profile.',
        );
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
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to start profiling. Please retry.',
      );
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
  const missing = result?.columns
    .filter((column) => column.missing_count > 0)
    .sort((a, b) => b.missing_percent - a.missing_percent) ?? [];

  return (
    <section className="ss-profile-panel" aria-labelledby="ss-profile-title">
      <header className="ss-profile-heading">
        <div>
          <p className="ss-kicker">Data quality</p>
          <h3 id="ss-profile-title">Dataset profile</h3>
          <p>Measure completeness, column structure, repeated rows and quality signals.</p>
        </div>
        {admitted && (
          <button
            type="button"
            className="ss-button ss-button-outline"
            disabled={busy}
            onClick={() => void refreshProfile()}
          >
            Refresh
          </button>
        )}
      </header>

      <div className="ss-profile-selection">
        <label htmlFor="ss-profile-dataset">Dataset</label>
        <select
          id="ss-profile-dataset"
          value={selectedId}
          disabled={datasets.length === 0}
          onChange={(event) => {
            setChosenId(event.target.value);
            setError('');
          }}
        >
          {datasets.length === 0 && <option value="">No datasets</option>}
          {datasets.map((item) => (
            <option key={item.id} value={item.id}>
              {item.filename} · {item.status}
            </option>
          ))}
        </select>
      </div>

      {error && <p role="alert" className="ss-error-banner">{error}</p>}

      {!selected ? (
        <p className="ss-profile-empty">Upload a CSV file to start profiling.</p>
      ) : !admitted ? (
        <p className="ss-profile-empty">
          Admission is {selected.status}. Profiling is available when this dataset is ready.
        </p>
      ) : current === undefined ? (
        <div className="ss-profile-empty" role="status">
          {error ? (
            <button
              type="button"
              className="ss-button ss-button-outline"
              disabled={busy}
              onClick={() => void refreshProfile()}
            >
              Retry loading
            </button>
          ) : 'Loading saved profile...'}
        </div>
      ) : current === null ? (
        <div className="ss-profile-empty">
          <p>No profile has been generated for this dataset.</p>
          {canProfile && (
            <button
              type="button"
              className="ss-button ss-button-primary"
              onClick={() => void startProfile()}
              disabled={busy}
            >
              {busy ? 'Starting...' : 'Analyze dataset'}
            </button>
          )}
        </div>
      ) : current.status === 'failed' ? (
        <div className="ss-profile-empty">
          <p role="status">Profiling failed: {current.error_code || 'processing_error'}.</p>
          {canProfile && (
            <button
              type="button"
              className="ss-button ss-button-primary"
              disabled={busy}
              onClick={() => void startProfile()}
            >
              Retry profiling
            </button>
          )}
        </div>
      ) : pending ? (
        <p role="status" className="ss-profile-empty">
          {current.status === 'queued' ? 'Profiling queued' : 'Profiling in progress'}.
          Status updates automatically.
        </p>
      ) : result ? (
        <div className="ss-profile-results">
          <div className="ss-profile-metrics" aria-label="Profile summary">
            <div><span>Rows</span><strong>{shortNumber(result.row_count)}</strong></div>
            <div><span>Columns</span><strong>{shortNumber(result.column_count)}</strong></div>
            <div><span>Missing cells</span><strong>{shortNumber(result.missing_cells)}</strong></div>
            <div>
              <span>Completeness</span>
              <strong>{quality?.completeness_percent ??
                (result.row_count * result.column_count
                  ? Math.round(10000 * (1 - result.missing_cells /
                    (result.row_count * result.column_count))) / 100
                  : 0)}%</strong>
            </div>
            <div><span>Repeated rows</span><strong>{shortNumber(result.duplicate_rows ?? 0)}</strong></div>
          </div>

          <div className="ss-profile-visuals">
            <section className="ss-profile-visual" aria-labelledby="ss-missing-title">
              <h4 id="ss-missing-title">Missing values by column</h4>
              <p>Percent of dataset rows · showing up to 8 columns with missing values</p>
              {missing.length === 0 ? (
                <p className="ss-profile-empty-small">No missing cells detected.</p>
              ) : (
                <ul className="ss-profile-bars">
                  {missing.slice(0, 8).map((column) => (
                    <li key={column.name}>
                      <span title={column.name}>{column.name}</span>
                      <div className="ss-profile-bar-track" aria-hidden="true">
                        <span style={{ width: `${Math.min(100, column.missing_percent)}%` }} />
                      </div>
                      <strong>{column.missing_percent}%</strong>
                    </li>
                  ))}
                </ul>
              )}
              {missing.length > 8 && (
                <small>{missing.length - 8} more columns appear in the table below.</small>
              )}
            </section>

            <section className="ss-profile-visual" aria-labelledby="ss-types-title">
              <h4 id="ss-types-title">Inferred column types</h4>
              <p>Count of columns by inferred type</p>
              <ul className="ss-profile-types">
                {Object.entries(distribution ?? {}).map(([type, count]) => (
                  <li key={type}>
                    <span>{type}</span>
                    <div className="ss-profile-bar-track" aria-hidden="true">
                      <span style={{ width: `${result.column_count
                        ? (100 * count) / result.column_count : 0}%` }} />
                    </div>
                    <strong>{count}</strong>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <section aria-labelledby="ss-findings-title" className="ss-profile-findings">
            <div className="ss-profile-subhead">
              <h4 id="ss-findings-title">Quality findings</h4>
              {quality && <span>{quality.findings.length} finding(s)</span>}
            </div>
            {!quality ? (
              <p className="ss-profile-empty-small">This saved profile predates quality checks.</p>
            ) : quality.findings.length === 0 ? (
              <p className="ss-profile-empty-small">
                No issues found by the current deterministic checks.
              </p>
            ) : (
              <ul className="ss-profile-finding-list">
                {quality.findings.map((finding, index) => (
                  <li key={`${finding.code}:${finding.column ?? ''}:${index}`}>
                    <span className={`ss-profile-severity is-${finding.severity}`}>
                      {finding.severity}
                    </span>
                    <div>
                      <strong>{finding.column ?? 'Dataset'}</strong>
                      <p>{finding.message}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <small>Findings are rule-based signals, not a guarantee of semantic correctness.</small>
          </section>

          <section className="ss-profile-columns" aria-labelledby="ss-columns-title">
            <h4 id="ss-columns-title">Column statistics</h4>
            <div className="ss-profile-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Column</th><th scope="col">Type</th>
                    <th scope="col">Missing</th><th scope="col">Distinct</th>
                    <th scope="col">Numeric range / mean</th>
                  </tr>
                </thead>
                <tbody>
                  {result.columns.map((column) => (
                    <tr key={column.name}>
                      <td><strong>{column.name}</strong></td>
                      <td>{column.inferred_type}</td>
                      <td>{column.missing_count} ({column.missing_percent}%)</td>
                      <td>{column.distinct_count_exact
                        ? column.distinct_count : 'Above tracking limit'}</td>
                      <td>{column.numeric
                        ? `${column.numeric.min} – ${column.numeric.max}; mean ${column.numeric.mean}`
                        : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : (
        <p className="ss-profile-empty">No profiling result is available.</p>
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
