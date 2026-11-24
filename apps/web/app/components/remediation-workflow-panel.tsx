'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Download, FileText, RefreshCw, ShieldAlert } from 'lucide-react';
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
  workspaceId,
  projectId,
  datasetId,
  reportId,
  canApply,
}: Props) {
  const endpoint =
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}` +
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
    return () => {
      active = false;
    };
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
    <section
      className="rounded-lg border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-5 space-y-4"
      aria-label="Reviewed data transformations"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ss-primary)]">
            DETERMINISTIC DSL GATE
          </span>
          <h4 className="mt-0.5 text-sm font-semibold text-[var(--ss-text)]">
            Controlled remediation
          </h4>
          <p className="mt-0.5 text-xs text-[var(--ss-muted)]">
            Choose deterministic operations. Gemini recommendations inform review but cannot execute code or alter source files.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void refresh().catch(() => setError('Unable to refresh remediations.'))}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 text-xs font-medium text-[var(--ss-text)] hover:bg-[var(--ss-surface-hover)] disabled:opacity-50"
        >
          <RefreshCw className="h-3 w-3" />
          <span>Refresh history</span>
        </button>
      </div>

      {canApply ? (
        <div className="rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] p-4 space-y-3">
          <label className="flex items-center gap-2.5 text-xs text-[var(--ss-text)] cursor-pointer">
            <input
              type="checkbox"
              checked={trim}
              disabled={busy}
              onChange={(e) => {
                setTrim(e.target.checked);
                setRun(null);
                setApproved(false);
              }}
              className="h-4 w-4 rounded accent-[var(--ss-primary)]"
            />
            <span>Trim leading and trailing whitespace from cells</span>
          </label>
          <label className="flex items-center gap-2.5 text-xs text-[var(--ss-text)] cursor-pointer">
            <input
              type="checkbox"
              checked={dedupe}
              disabled={busy}
              onChange={(e) => {
                setDedupe(e.target.checked);
                setRun(null);
                setApproved(false);
              }}
              className="h-4 w-4 rounded accent-[var(--ss-primary)]"
            />
            <span>Remove exact duplicate rows (retain first occurrence)</span>
          </label>
          <div className="pt-1">
            <button
              type="button"
              disabled={busy || (!trim && !dedupe)}
              onClick={() => void preview()}
              className="inline-flex h-8 items-center rounded-md border border-[var(--ss-border-strong)] bg-[var(--ss-canvas)] px-3 text-xs font-semibold text-[var(--ss-text)] hover:bg-[var(--ss-surface-hover)] disabled:opacity-45"
            >
              {busy ? 'Working…' : 'Preview changes'}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-[var(--ss-muted)]">
          Viewers can inspect completed remediation audits but cannot preview or apply changes.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-md border border-[var(--ss-danger)]/35 bg-[var(--ss-danger-wash)] px-3 py-2 text-xs text-[var(--ss-danger)]"
        >
          {error}
        </p>
      )}

      {shown ? (
        <div className="rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] p-4 space-y-4">
          <div className="flex items-center gap-2 text-xs font-medium text-[var(--ss-text)]">
            {shown.status === 'applied' ? (
              <CheckCircle2 className="h-4 w-4 text-[var(--ss-pass)]" />
            ) : (
              <ShieldAlert className="h-4 w-4 text-[var(--ss-warn)]" />
            )}
            <p className="m-0">
              {shown.status === 'applied'
                ? 'Applied to a new dataset'
                : run?.id === shown.id
                  ? 'Preview only — no file changed'
                  : 'Saved preview (read-only) — choose operations and preview again to approve'}
            </p>
          </div>

          <div className="overflow-x-auto rounded border border-[var(--ss-border)]">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="border-b border-[var(--ss-border)] bg-[var(--ss-surface-subtle)] font-mono text-[10px] uppercase tracking-wider text-[var(--ss-muted)]">
                <tr>
                  <th scope="col" className="px-3 py-2">Metric</th>
                  <th scope="col" className="px-3 py-2">Before</th>
                  <th scope="col" className="px-3 py-2">After</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ss-border)] font-mono tabular-nums">
                <tr>
                  <th scope="row" className="px-3 py-2 font-sans font-medium">Rows</th>
                  <td className="px-3 py-2">{shown.preview.before.rows}</td>
                  <td className="px-3 py-2 font-semibold text-[var(--ss-primary)]">{shown.preview.after.rows}</td>
                </tr>
                <tr>
                  <th scope="row" className="px-3 py-2 font-sans font-medium">Missing cells</th>
                  <td className="px-3 py-2">{shown.preview.before.missing_cells}</td>
                  <td className="px-3 py-2 font-semibold">{shown.preview.after.missing_cells}</td>
                </tr>
                <tr>
                  <th scope="row" className="px-3 py-2 font-sans font-medium">Exact duplicate rows</th>
                  <td className="px-3 py-2">{shown.preview.before.exact_duplicates}</td>
                  <td className="px-3 py-2 font-semibold text-[var(--ss-pass)]">{shown.preview.after.exact_duplicates}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="font-mono text-[11px] text-[var(--ss-muted)] tabular-nums">
            Changed cells: {shown.preview.changed_cells} · Removed rows: {shown.preview.removed_duplicate_rows}
          </p>

          <ul className="list-disc pl-5 space-y-1 text-xs text-[var(--ss-muted)]">
            {shown.preview.warnings.map((message, i) => (
              <li key={i}>{message}</li>
            ))}
          </ul>

          {shown.status === 'previewed' && canApply && run?.id === shown.id && (
            <div className="rounded-md border border-[var(--ss-primary-border)] bg-[var(--ss-primary-wash)]/50 p-3.5 space-y-3">
              <label className="flex items-start gap-2.5 text-xs text-[var(--ss-text)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={approved}
                  onChange={(e) => setApproved(e.target.checked)}
                  disabled={busy}
                  className="mt-0.5 h-4 w-4 rounded accent-[var(--ss-primary)]"
                />
                <span>
                  I reviewed the preview and approve creating a derived dataset. The original remains unchanged.
                </span>
              </label>
              <button
                type="button"
                disabled={!approved || busy}
                onClick={() => void apply()}
                className="inline-flex h-9 items-center rounded-md bg-[var(--ss-primary)] px-4 text-xs font-semibold text-white hover:bg-[var(--ss-primary-hover)] disabled:opacity-45"
              >
                Approve and create derived dataset
              </button>
            </div>
          )}

          {shown.status === 'applied' && shown.result_dataset_id && (
            <div className="rounded-md border border-[var(--ss-pass)]/30 bg-[var(--ss-pass-wash)]/60 p-4 space-y-2.5 text-xs">
              <p className="font-mono">
                Derived dataset ID: <code>{shown.result_dataset_id}</code>
              </p>
              <p className="text-[var(--ss-muted)]">
                Derived profile: {shown.validation?.derived_profile_status ?? 'pending'} · Completeness:{' '}
                {shown.validation?.after_completeness_percent ?? 'not measured'}%
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <a
                  href={`${endpoint}/${shown.id}/export?download=csv`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--ss-border-strong)] bg-[var(--ss-surface)] px-3 text-xs font-semibold text-[var(--ss-text)] no-underline hover:bg-[var(--ss-surface-hover)]"
                >
                  <Download className="h-3.5 w-3.5 text-[var(--ss-primary)]" />
                  <span>Download derived CSV</span>
                </a>
                <a
                  href={`${endpoint}/${shown.id}/export?download=pdf`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--ss-border-strong)] bg-[var(--ss-surface)] px-3 text-xs font-semibold text-[var(--ss-text)] no-underline hover:bg-[var(--ss-surface-hover)]"
                >
                  <FileText className="h-3.5 w-3.5 text-[var(--ss-primary)]" />
                  <span>Download audit PDF</span>
                </a>
              </div>
              <p className="text-[11px] text-[var(--ss-muted)]">
                Downloaded CSV cells are untrusted data. Use safe spreadsheet import settings; do not enable spreadsheet macros or formulas.
              </p>
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-[var(--ss-muted)]">
          No remediation preview is associated with this report.
        </p>
      )}
    </section>
  );
}
