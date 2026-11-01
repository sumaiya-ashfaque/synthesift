
'use client';

import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  request,
  uploadDataset,
  type Dataset,
  type DatasetPage,
  type Project,
} from '@/lib/client-api';

type Props = {
  workspaceId: string;
  project: Project;
  canUpload: boolean;
};

const ERROR_LABELS: Record<string, string> = {
  duplicate_header: 'Duplicate column names',
  missing_header: 'Missing CSV header',
  invalid_header: 'Invalid column name',
  inconsistent_columns: 'Inconsistent row structure',
  invalid_utf8: 'Invalid UTF-8 encoding',
  invalid_cell: 'Unsupported cell content',
  malformed_csv: 'Malformed CSV',
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function dateLabel(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusLabel(dataset: Dataset): string {
  switch (dataset.status) {
    case 'queued':
      return 'Queued';
    case 'processing':
      return 'Processing';
    case 'ready':
      return 'Ready';
    case 'failed':
      return 'Failed';
  }
}

export function DatasetPanel({
  workspaceId,
  project,
  canUpload,
}: Props) {
  const endpoint =
    `/api/v1/workspaces/${workspaceId}/projects/${project.id}/datasets`;

  const fileRef = useRef<HTMLInputElement>(null);

  const [page, setPage] = useState<DatasetPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    const next = await request<DatasetPage>(
      `${endpoint}?limit=100&offset=0`,
    );

    setPage(next);
  }, [endpoint]);

  useEffect(() => {
    let active = true;

    request<DatasetPage>(
      `${endpoint}?limit=100&offset=0`,
    )
      .then((next) => {
        if (active) {
          setPage(next);
        }
      })
      .catch(() => {
        if (active) {
          setError(
            'Unable to load datasets for this project.',
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [endpoint]);

  const hasActiveJobs =
    page?.results.some(
      (item) =>
        item.status === 'queued' ||
        item.status === 'processing',
    ) ?? false;

  useEffect(() => {
    if (!hasActiveJobs) {
      return;
    }

    let active = true;

    const timer = window.setInterval(() => {
      void request<DatasetPage>(
        `${endpoint}?limit=100&offset=0`,
      )
        .then((next) => {
          if (active) {
            setPage(next);
          }
        })
        .catch(() => {
          if (active) {
            setError(
              'Status refresh failed. Retry to update datasets.',
            );
          }
        });
    }, 5000);

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
      setError(
        'Unable to refresh datasets. Please retry.',
      );
    } finally {
      setRefreshing(false);
    }
  }

  async function handleUpload(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!file || !canUpload) {
      return;
    }

    setError('');
    setNotice('');
    setUploading(true);

    try {
      const created = await uploadDataset(
        workspaceId,
        project.id,
        file,
      );

      setNotice(
        `${created.filename} uploaded. Admission status: ${created.status}.`,
      );

      setFile(null);

      if (fileRef.current) {
        fileRef.current.value = '';
      }

      setPage((previous) =>
        previous
          ? {
              ...previous,
              count: previous.count + 1,
              results: [
                created,
                ...previous.results,
              ].slice(0, 100),
            }
          : {
              count: 1,
              next: null,
              previous: null,
              results: [created],
            },
      );

      try {
        await refresh();
      } catch {
        setError(
          'Upload saved. The dataset list could not refresh. Use Refresh to retry.',
        );
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Upload failed. Please retry.',
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <section
      className="ss-datasets-panel"
      aria-labelledby="ss-datasets-heading"
    >
      <div className="ss-datasets-heading-row">
        <div>
          <p className="ss-kicker">Project datasets</p>

          <h2 id="ss-datasets-heading">
            {project.name}
          </h2>

          <p>
            Upload CSV sources and inspect their
            admission results.
          </p>
        </div>

        <button
          type="button"
          className="ss-button ss-button-outline"
          onClick={() => void handleRefresh()}
          disabled={refreshing || uploading}
        >
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {canUpload && (
        <form
          className="ss-dataset-upload"
          onSubmit={handleUpload}
        >
          <div>
            <label htmlFor="ss-dataset-file">
              CSV file
            </label>

            <p>
              UTF-8 CSV, up to 10 MB.
              Original files are preserved.
            </p>
          </div>

          <div className="ss-dataset-upload-controls">
            <input
              ref={fileRef}
              id="ss-dataset-file"
              type="file"
              accept=".csv,text/csv"
              required
              onChange={(event) =>
                setFile(
                  event.currentTarget.files?.[0] ??
                    null,
                )
              }
              disabled={uploading}
            />

            <button
              className="ss-button ss-button-primary"
              type="submit"
              disabled={!file || uploading}
            >
              {uploading
                ? 'Uploading...'
                : 'Upload CSV'}
            </button>
          </div>
        </form>
      )}

      {error && (
        <p
          className="ss-error-banner"
          role="alert"
        >
          {error}
        </p>
      )}

      {notice && (
        <p
          className="ss-dataset-notice"
          role="status"
        >
          {notice}
        </p>
      )}

      <div className="ss-dataset-table-heading">
        <h3>Uploaded datasets</h3>

        {page && (
          <span>{page.count} total</span>
        )}
      </div>

      {loading ? (
        <p
          className="ss-dataset-feedback"
          role="status"
        >
          Loading datasets...
        </p>
      ) : !page ? (
        <p className="ss-dataset-feedback">
          No dataset information available.
          Choose Refresh to retry.
        </p>
      ) : page.results.length === 0 ? (
        <div className="ss-dataset-empty">
          <strong>
            No datasets in this project
          </strong>

          <p>
            {canUpload
              ? 'Upload a CSV file to begin.'
              : 'An owner or editor can upload datasets here.'}
          </p>
        </div>
      ) : (
        <div className="ss-dataset-table-scroll">
          <table className="ss-dataset-table">
            <thead>
              <tr>
                <th scope="col">Dataset</th>
                <th scope="col">Status</th>
                <th scope="col">Rows</th>
                <th scope="col">Columns</th>
                <th scope="col">Uploaded</th>
              </tr>
            </thead>

            <tbody>
              {page.results.map((dataset) => (
                <tr key={dataset.id}>
                  <td>
                    <strong className="ss-dataset-filename">
                      {dataset.filename}
                    </strong>

                    <small>
                      {formatBytes(
                        dataset.size_bytes,
                      )}
                    </small>
                  </td>

                  <td>
                    <span
                      className={
                        `ss-dataset-status is-${dataset.status}`
                      }
                    >
                      {statusLabel(dataset)}
                    </span>

                    {dataset.status ===
                      'failed' && (
                      <small className="ss-dataset-error">
                        {ERROR_LABELS[
                          dataset.error_code
                        ] ?? 'Admission failed'}
                      </small>
                    )}
                  </td>

                  <td>
                    {dataset.row_count ?? '—'}
                  </td>

                  <td>
                    {dataset.column_count ?? '—'}

                    {dataset.columns.length >
                      0 && (
                      <details className="ss-dataset-columns">
                        <summary>
                          View names
                        </summary>

                        <div>
                          {dataset.columns.join(
                            ', ',
                          )}
                        </div>
                      </details>
                    )}
                  </td>

                  <td>
                    <time
                      dateTime={
                        dataset.created_at
                      }
                    >
                      {dateLabel(
                        dataset.created_at,
                      )}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {page &&
        page.count >
          page.results.length && (
          <p className="ss-dataset-feedback">
            Showing the newest{' '}
            {page.results.length} datasets
            of {page.count}.
          </p>
        )}

      {hasActiveJobs && (
        <p
          className="ss-dataset-feedback"
          aria-live="polite"
        >
          Processing statuses refresh
          every 5 seconds.
        </p>
      )}
    </section>
  );
}
