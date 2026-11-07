'use client';

import { useCallback, useEffect, useState } from 'react';

import { request } from '@/lib/client-api';

type Metrics = {
  rows: number;
  missing_cells: number;
  exact_duplicates: number;
};

type Run = {
  id: string;
  status: 'previewed' | 'applied';
  operations: string[];
  report_id: string;
  result_dataset_id: string | null;
  created_at: string;
  applied_at: string | null;
  validation?: { after_completeness_percent?: number | null; derived_profile_status?: string };
  preview: {
    before: Metrics;
    after: Metrics;
    changed_cells: number;
    removed_duplicate_rows: number;
    warnings: string[];
  };
};

type Props = {
  workspaceId: string;
  projectId: string;
  datasetId: string;
  reportId: string;
  canApply: boolean;
};

export function RemediationWorkflowPanel({
  workspaceId, projectId, datasetId, reportId, canApply,
}: Props) {
  const endpoint = `/api/v1/workspaces/${workspaceId}/projects/${projectId}` +
    `/datasets/${datasetId}/remediations`;
  const [trim, setTrim] = useState(false);
  const [dedupe, setDedupe] = useState(false);
  const [approved, setApproved] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [recent, setRecent] = useState<Run[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const history = await request<Run[]>(endpoint);
    setRecent(Array.isArray(history) ? history : []);
  }, [endpoint]);

  useEffect(() => {
    let active = true;
    void request<Run[]>(endpoint)
      .then((history) => {
        if (active) setRecent(Array.isArray(history) ? history : []);
      })
      .catch(() => {
        if (active) setError('Could not retrieve remediation history.');
      });
    return () => { active = false; };
  }, [endpoint]);

  async function preview() {
    if (!canApply || !(trim || dedupe)) return;
    setBusy(true);
    setError('');
    setApproved(false);
    setRun(null);
    try {
      const operations = [
        ...(trim ? ['trim_whitespace'] : []),
        ...(dedupe ? ['remove_exact_duplicates'] : []),
      ];
      const value = await request<Run>(endpoint, 'POST', { report_id: reportId, operations });
      setRun(value);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Preview failed.');
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!canApply || !approved || !run || run.status !== 'previewed') return;
    setBusy(true);
    setError('');
    try {
      const value = await request<Run>(`${endpoint}/${run.id}`, 'POST', { approve: true });
      setRun(value);
      setApproved(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not apply the preview.');
    } finally {
      setBusy(false);
    }
  }

  const shown = run ?? recent.find((item) => item.report_id === reportId) ?? null;

  return (
    <section className="ss-remediation" aria-label="Reviewed data transformations">
      <div className="ss-remediation-heading">
        <div>
          <h4>Controlled remediation</h4>
          <p>Choose deterministic operations. Gemini recommendations inform review but cannot execute code or alter source files.</p>
        </div>
        <button type="button" className="ss-button ss-button-outline" disabled={busy}
          onClick={() => void refresh().catch(() => setError('Unable to refresh remediations.'))}>
          Refresh history
        </button>
      </div>

      {canApply && (
        <div className="ss-remediation-actions">
          <label>
            <input type="checkbox" checked={trim} disabled={busy}
              onChange={(e) => { setTrim(e.target.checked); setRun(null); setApproved(false); }} />
            Trim leading and trailing whitespace from cells
          </label>
          <label>
            <input type="checkbox" checked={dedupe} disabled={busy}
              onChange={(e) => { setDedupe(e.target.checked); setRun(null); setApproved(false); }} />
            Remove exact duplicate rows (retain first occurrence)
          </label>
          <button type="button" className="ss-button ss-button-outline"
            disabled={busy || (!trim && !dedupe)} onClick={() => void preview()}>
            {busy ? 'Working…' : 'Preview changes'}
          </button>
        </div>
      )}
      {!canApply && <p className="ss-ai-note">Viewers can inspect completed remediation audits but cannot preview or apply changes.</p>}
      {error && <p className="ss-error-banner" role="alert">{error}</p>}

      {shown && (
        <div className="ss-remediation-preview">
          <p className="ss-ai-note">{shown.status === 'applied' ? 'Applied to a new dataset' : run?.id === shown.id ? 'Preview only — no file changed' : 'Saved preview (read-only) — choose operations and preview again to approve'}</p>
          <table>
            <thead><tr><th scope="col">Metric</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
            <tbody>
              <tr><th scope="row">Rows</th><td>{shown.preview.before.rows}</td><td>{shown.preview.after.rows}</td></tr>
              <tr><th scope="row">Missing cells</th><td>{shown.preview.before.missing_cells}</td><td>{shown.preview.after.missing_cells}</td></tr>
              <tr><th scope="row">Exact duplicate rows</th><td>{shown.preview.before.exact_duplicates}</td><td>{shown.preview.after.exact_duplicates}</td></tr>
            </tbody>
          </table>
          <p>Changed cells: {shown.preview.changed_cells} · Removed rows: {shown.preview.removed_duplicate_rows}</p>
          <ul>{shown.preview.warnings.map((message, i) => <li key={i}>{message}</li>)}</ul>
          {shown.status === 'previewed' && canApply && run?.id === shown.id && (
            <div className="ss-remediation-approval">
              <label>
                <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} disabled={busy} />
                I reviewed the preview and approve creating a derived dataset. The original remains unchanged.
              </label>
              <button type="button" className="ss-button ss-button-primary" disabled={!approved || busy}
                onClick={() => void apply()}>Approve and create derived dataset</button>
            </div>
          )}
          {shown.status === 'applied' && shown.result_dataset_id && (
            <div className="ss-remediation-downloads">
              <p>Derived dataset ID: <code>{shown.result_dataset_id}</code></p>
              <p>Derived profile: {shown.validation?.derived_profile_status ?? 'pending'} · Completeness: {shown.validation?.after_completeness_percent ?? 'not measured'}%</p>
              <a href={`${endpoint}/${shown.id}/export?download=csv`}>Download derived CSV</a>
              <a href={`${endpoint}/${shown.id}/export?download=pdf`}>Download audit PDF</a>
              <p className="ss-ai-note">Downloaded CSV cells are untrusted data. Use safe spreadsheet import settings; do not enable spreadsheet macros or formulas.</p>
            </div>
          )}
        </div>
      )}
      {!shown && <p className="ss-ai-note">No remediation preview is associated with this report.</p>}
    </section>
  );
}
