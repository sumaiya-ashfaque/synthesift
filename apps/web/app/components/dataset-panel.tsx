'use client';

import Link from 'next/link';
import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ArrowUpRight,
  FileSpreadsheet,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { DatasetLibraryPicker } from '@/app/components/dataset-library-picker';
import {
  request,
  seedDemoDatasets,
  SUPPORTED_DATASET_EXTENSIONS,
  uploadDataset,
  type Dataset,
  type DatasetPage,
  type Project,
} from '@/lib/client-api';
import { cn, formatBytes, formatDateTime, formatNumber, shortDigest } from '@/lib/cn';

type Props = {
  workspaceId: string;
  project: Project;
  canUpload: boolean;
};

const ERROR_LABELS: Record<string, string> = {
  duplicate_header: 'Duplicate column names',
  missing_header: 'Missing header row',
  invalid_header: 'Invalid column name',
  inconsistent_columns: 'Inconsistent row structure',
  invalid_utf8: 'Invalid UTF-8 encoding',
  invalid_cell: 'Unsupported cell content',
  malformed_csv: 'Malformed CSV',
  malformed_parquet: 'Malformed Parquet file',
  malformed_xlsx: 'Malformed Excel workbook',
  malformed_json: 'Malformed JSON / NDJSON',
  no_data_rows: 'No data rows',
  too_many_rows: 'Row limit exceeded',
  too_many_columns: 'Column limit exceeded',
  integrity_mismatch: 'File integrity check failed',
  source_too_large: 'Source file exceeds the limit',
  source_unavailable: 'Source file unavailable',
  processing_error: 'Processing failed',
  queue_unavailable: 'Processing queue unavailable',
  processing_interrupted: 'Processing was interrupted',
};

export function DatasetPanel({ workspaceId, project, canUpload }: Props) {
  const endpoint = `/api/v1/workspaces/${workspaceId}/projects/${project.id}/datasets`;
  const fileRef = useRef<HTMLInputElement>(null);

  const [page, setPage] = useState<DatasetPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    const next = await request<DatasetPage>(`${endpoint}?limit=100&offset=0`);
    setPage(next);
  }, [endpoint]);

  useEffect(() => {
    let active = true;
    request<DatasetPage>(`${endpoint}?limit=100&offset=0`)
      .then((next) => {
        if (active) setPage(next);
      })
      .catch(() => {
        if (active) setError('Unable to load datasets for this project.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [endpoint]);

  const hasActiveJobs =
    page?.results.some((item) => item.status === 'queued' || item.status === 'processing') ?? false;

  useEffect(() => {
    if (!hasActiveJobs) return;
    let active = true;
    const timer = window.setInterval(() => {
      void request<DatasetPage>(`${endpoint}?limit=100&offset=0`)
        .then((next) => {
          if (active) setPage(next);
        })
        .catch(() => {
          if (active) setError('Status refresh failed. Retry to update datasets.');
        });
    }, 3500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [endpoint, hasActiveJobs]);

  async function handleRefresh() {
    setRefreshing(true);
    setError('');
    try {
      await refresh();
    } catch {
      setError('Unable to refresh datasets. Please retry.');
    } finally {
      setRefreshing(false);
    }
  }

  async function submitFile(selectedFile: File) {
    if (!canUpload) return;
    setError('');
    setNotice('');
    setUploading(true);
    try {
      const created = await uploadDataset(workspaceId, project.id, selectedFile);
      setNotice(`${created.filename} uploaded (${created.status}). Open in Studio once admitted.`);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      setPage((previous) =>
        previous
          ? {
              ...previous,
              count: previous.count + 1,
              results: [created, ...previous.results].slice(0, 100),
            }
          : { count: 1, next: null, previous: null, results: [created] },
      );
      await refresh().catch(() => {
        setError('Upload saved. Click Refresh to update status.');
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed. Please retry.');
    } finally {
      setUploading(false);
    }
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    await submitFile(file);
  }

  async function handleSeedDemo() {
    if (!canUpload) return;
    setSeeding(true);
    setError('');
    setNotice('');
    try {
      const created = await seedDemoDatasets(workspaceId, project.id);
      await refresh();
      setNotice(
        `Seeded ${created.length} pre-profiled multi-format datasets (CSV, Parquet, JSON). Click “Open Studio” on any row to explore.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load sample datasets.');
    } finally {
      setSeeding(false);
    }
  }

  return (
    <section
      aria-labelledby="ss-datasets-heading"
      className="rounded-lg border border-[var(--ss-border)] bg-[var(--ss-surface)] p-5 sm:p-6 space-y-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ss-primary)]">
            PROJECT DATASETS
          </p>
          <h2 id="ss-datasets-heading" className="mt-0.5 text-lg font-semibold text-[var(--ss-text)]">
            {project.name}
          </h2>
          <p className="text-xs text-[var(--ss-muted)]">
            Ingest CSV, TSV, Parquet, Excel (.xlsx), or JSON/NDJSON files and launch them into the Data Studio.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canUpload && (
            <button
              type="button"
              onClick={() => void handleSeedDemo()}
              disabled={seeding || uploading}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--ss-primary-border)] bg-[var(--ss-primary-wash)] px-3 text-xs font-semibold text-[var(--ss-primary)] hover:opacity-90 disabled:opacity-50"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>{seeding ? 'Seeding…' : 'Load sample datasets'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshing || uploading}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2.5 text-xs font-medium text-[var(--ss-text)] hover:bg-[var(--ss-surface-hover)]"
          >
            <RefreshCw className={cn('h-3 w-3', refreshing && 'animate-spin')} />
            <span>{refreshing ? 'Refreshing…' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Drag & Drop Multi-Format Upload Zone */}
      {canUpload && (
        <form
          onSubmit={handleUpload}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const dropped = e.dataTransfer.files?.[0];
            if (dropped) setFile(dropped);
          }}
          className={cn(
            'rounded-lg border border-dashed p-4 transition-colors',
            dragging
              ? 'border-[var(--ss-primary)] bg-[var(--ss-primary-wash)]/50'
              : 'border-[var(--ss-border-strong)] bg-[var(--ss-canvas)]/70',
          )}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] text-[var(--ss-primary)]">
                <Upload className="h-4 w-4" />
              </div>
              <div>
                <label htmlFor="ss-dataset-file" className="block text-xs font-semibold text-[var(--ss-text)]">
                  Upload tabular dataset
                </label>
                <p className="mt-0.5 font-mono text-[11px] text-[var(--ss-muted)]">
                  CSV · TSV · Parquet · XLSX · JSON · NDJSON (up to 10 MB · immutable SHA-256)
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                id="ss-dataset-file"
                type="file"
                accept={SUPPORTED_DATASET_EXTENSIONS.join(',')}
                required={!file}
                onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)}
                disabled={uploading}
                className="max-w-[240px] rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 py-1.5 text-xs text-[var(--ss-text)] file:mr-2 file:border-0 file:bg-transparent file:font-mono file:text-[11px] file:font-semibold file:text-[var(--ss-primary)]"
              />
              <button
                type="submit"
                disabled={!file || uploading}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--ss-primary)] px-4 text-xs font-semibold text-white hover:bg-[var(--ss-primary-hover)] disabled:opacity-45"
              >
                {uploading ? 'Uploading…' : 'Upload dataset'}
              </button>
            </div>
          </div>
          {file && (
            <p className="mt-2 font-mono text-[11px] text-[var(--ss-primary)]">
              Selected: {file.name} ({formatBytes(file.size)})
            </p>
          )}
        </form>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-md border border-[var(--ss-danger)]/35 bg-[var(--ss-danger-wash)] px-3.5 py-2.5 text-xs text-[var(--ss-danger)]"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-md border border-[var(--ss-primary-border)] bg-[var(--ss-primary-wash)] px-3.5 py-2.5 text-xs text-[var(--ss-primary)]"
        >
          {notice}
        </p>
      )}

      {/* Dataset Inventory Table */}
      <div className="space-y-2.5">
        <div className="flex items-baseline justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider font-mono text-[var(--ss-subtle)]">
            Admitted datasets
          </h3>
          {page && (
            <span className="font-mono text-[11px] tabular-nums text-[var(--ss-muted)]">
              {page.count} total
            </span>
          )}
        </div>

        {loading ? (
          <p className="py-6 font-mono text-xs text-[var(--ss-muted)]" role="status">
            Loading datasets…
          </p>
        ) : !page ? (
          <p className="py-6 text-xs text-[var(--ss-muted)]">
            No dataset information available. Choose Refresh to retry.
          </p>
        ) : page.results.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--ss-border)] p-8 text-center">
            <strong className="text-sm font-semibold text-[var(--ss-text)]">
              No datasets in this project
            </strong>
            <p className="mt-1 text-xs text-[var(--ss-muted)]">
              {canUpload
                ? 'Drop a file above or click “Load sample datasets” for an instant multi-format walkthrough.'
                : 'An owner or editor can upload datasets here.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--ss-border)]">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="border-b border-[var(--ss-border)] bg-[var(--ss-surface-subtle)] font-mono text-[10px] uppercase tracking-wider text-[var(--ss-muted)]">
                <tr>
                  <th scope="col" className="px-3.5 py-2.5">Dataset</th>
                  <th scope="col" className="px-3.5 py-2.5">Format</th>
                  <th scope="col" className="px-3.5 py-2.5">Status</th>
                  <th scope="col" className="px-3.5 py-2.5">Shape</th>
                  <th scope="col" className="px-3.5 py-2.5">Uploaded</th>
                  <th scope="col" className="px-3.5 py-2.5 text-right">Studio</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ss-border)]">
                {page.results.map((dataset: Dataset) => {
                  const studioHref = `/workbench?workspace=${workspaceId}&project=${project.id}&dataset=${dataset.id}&tab=overview`;
                  return (
                    <tr key={dataset.id} className="hover:bg-[var(--ss-surface-hover)] transition-colors">
                      <td className="px-3.5 py-3">
                        <strong className="block font-mono font-semibold text-[var(--ss-text)]">
                          {dataset.filename}
                        </strong>
                        <span className="font-mono text-[10px] text-[var(--ss-subtle)] tabular-nums">
                          {formatBytes(dataset.size_bytes)} · sha256:{shortDigest(dataset.sha256)}
                        </span>
                      </td>
                      <td className="px-3.5 py-3">
                        <span className="rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-[var(--ss-muted)]">
                          {(dataset.file_format ?? 'csv').toUpperCase()}
                        </span>
                      </td>
                      <td className="px-3.5 py-3">
                        <span
                          className={cn(
                            'inline-block rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase',
                            dataset.status === 'ready'
                              ? 'bg-[var(--ss-pass-wash)] text-[var(--ss-pass)]'
                              : dataset.status === 'failed'
                                ? 'bg-[var(--ss-danger-wash)] text-[var(--ss-danger)]'
                                : 'bg-[var(--ss-warn-wash)] text-[var(--ss-warn)]',
                          )}
                        >
                          {dataset.status}
                        </span>
                        {dataset.status === 'failed' && (
                          <small className="mt-1 block text-[11px] text-[var(--ss-danger)]">
                            {ERROR_LABELS[dataset.error_code] ?? 'Admission failed'}
                          </small>
                        )}
                      </td>
                      <td className="px-3.5 py-3 font-mono text-[11px] tabular-nums text-[var(--ss-muted)]">
                        {dataset.row_count != null
                          ? `${formatNumber(dataset.row_count)} × ${formatNumber(dataset.column_count)}`
                          : '—'}
                      </td>
                      <td className="px-3.5 py-3 font-mono text-[11px] tabular-nums text-[var(--ss-muted)]">
                        {formatDateTime(dataset.created_at)}
                      </td>
                      <td className="px-3.5 py-3 text-right">
                        {dataset.status === 'ready' ? (
                          <Link
                            href={studioHref}
                            className="inline-flex items-center gap-1 rounded-md border border-[var(--ss-primary-border)] bg-[var(--ss-primary-wash)] px-2.5 py-1 font-mono text-[11px] font-semibold text-[var(--ss-primary)] no-underline hover:opacity-90"
                          >
                            <span>Open Studio</span>
                            <ArrowUpRight className="h-3 w-3" />
                          </Link>
                        ) : (
                          <span className="font-mono text-[10px] text-[var(--ss-subtle)]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canUpload && (
        <div className="pt-2 border-t border-[var(--ss-border)]">
          <DatasetLibraryPicker
            workspaceId={workspaceId}
            projectId={project.id}
            onImported={refresh}
          />
        </div>
      )}
    </section>
  );
}
