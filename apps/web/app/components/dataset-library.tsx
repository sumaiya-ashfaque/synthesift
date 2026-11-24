'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, RefreshCw, Search, Upload } from 'lucide-react';
import { AppShell } from '@/app/components/shell/app-shell';
import {
  request,
  SUPPORTED_DATASET_EXTENSIONS,
  uploadDataset,
  type Account,
  type Project,
  type Workspace,
} from '@/lib/client-api';
import { cn, formatBytes, formatNumber } from '@/lib/cn';

type Item = {
  id: string;
  filename: string;
  file_format?: string;
  status: string;
  size_bytes: number;
  row_count?: number | null;
  column_count?: number | null;
  created_at: string;
  workspace_id: string;
  workspace_name: string;
  project_id: string;
  project_name: string;
  can_reuse: boolean;
};
type ResponseData = { results: Item[]; limit: number };

export function DatasetLibrary() {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function refresh() {
    const response = await request<ResponseData>('/api/v1/dataset-library');
    setItems(response.results);
  }

  useEffect(() => {
    let active = true;
    Promise.all([
      request<Account>('/api/v1/auth/me'),
      request<Workspace[]>('/api/v1/workspaces'),
      request<ResponseData>('/api/v1/dataset-library'),
    ])
      .then(([who, ws, library]) => {
        if (!active) return;
        setAccount(who);
        setWorkspaces(ws);
        setItems(library.results);
        setWorkspaceId(ws.find((item) => item.role !== 'viewer')?.id ?? '');
      })
      .catch((reason: unknown) => {
        if (!active) return;
        if (reason instanceof Error && reason.message === 'Sign in to continue.') {
          router.replace('/login');
        } else {
          setError('Unable to load your dataset library.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    request<Project[]>(`/api/v1/workspaces/${workspaceId}/projects`)
      .then((data) => {
        if (active) {
          setProjects(data);
          setProjectId(data[0]?.id ?? '');
        }
      })
      .catch(() => {
        if (active) setError('Could not load projects for upload.');
      });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  const matches = useMemo(
    () =>
      items.filter((item) =>
        [item.filename, item.workspace_name, item.project_name, item.status, item.file_format ?? 'csv'].some(
          (text) => text.toLowerCase().includes(query.trim().toLowerCase()),
        ),
      ),
    [items, query],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem('file') as HTMLInputElement | null;
    const files = Array.from(input?.files ?? []);
    if (!files.length || !workspaceId || !projectId) return;
    if (files.length > 10) {
      setError('Select up to 10 dataset files per batch.');
      return;
    }
    const invalid = files.some(
      (file) =>
        !SUPPORTED_DATASET_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext)) ||
        file.size > 10 * 1024 * 1024,
    );
    if (invalid) {
      setError('Each file must be CSV, TSV, Parquet, XLSX, or JSON/NDJSON under 10 MB.');
      return;
    }

    setBusy(true);
    setNotice('');
    setError('');
    let completed = 0;
    const failures: string[] = [];
    try {
      for (const file of files) {
        try {
          await uploadDataset(workspaceId, projectId, file);
          completed += 1;
        } catch (reason) {
          failures.push(`${file.name}: ${reason instanceof Error ? reason.message : 'Upload failed'}`);
        }
      }
      await refresh();
      if (completed) {
        setNotice(`${completed} dataset${completed === 1 ? '' : 's'} uploaded for validation.`);
      }
      if (failures.length) {
        setError(`Could not upload ${failures.length} file(s): ${failures.join('; ')}`);
      }
      if (!failures.length) form.reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not refresh the library after upload.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    try {
      await request<void>('/api/v1/auth/logout', 'POST');
      router.replace('/login');
    } catch {
      setError('Sign out failed. Retry.');
    }
  }

  if (loading) {
    return (
      <main
        className="grid min-h-screen place-items-center bg-[var(--ss-canvas)] font-mono text-xs text-[var(--ss-muted)]"
        role="status"
      >
        Loading dataset library…
      </main>
    );
  }

  return (
    <AppShell
      current="library"
      breadcrumb={[
        { label: 'Workspaces', href: '/workspaces' },
        { label: 'Dataset library' },
      ]}
      account={account}
      onSignOut={() => void signOut()}
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ss-primary)]">
              DATA CATALOG
            </p>
            <h1 className="mt-1 text-2xl sm:text-[28px] font-semibold tracking-[-0.03em] text-[var(--ss-text)]">
              Dataset library
            </h1>
            <p className="mt-1 text-sm text-[var(--ss-muted)]">
              Batch-upload multi-format files and search every accessible dataset across your workspaces.
            </p>
          </div>
          <Link
            href="/workbench"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--ss-primary)] px-4 text-xs font-semibold text-white no-underline hover:bg-[var(--ss-primary-hover)]"
          >
            <span>Open Studio</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-[var(--ss-danger)]/35 bg-[var(--ss-danger-wash)] px-4 py-2.5 text-xs text-[var(--ss-danger)]"
          >
            {error}
          </p>
        )}
        {notice && (
          <p
            role="status"
            className="rounded-md border border-[var(--ss-primary-border)] bg-[var(--ss-primary-wash)] px-4 py-2.5 text-xs text-[var(--ss-primary)]"
          >
            {notice}
          </p>
        )}

        {/* Batch Upload Card */}
        <section
          aria-labelledby="ss-upload-heading"
          className="rounded-lg border border-[var(--ss-border)] bg-[var(--ss-surface)] p-5 space-y-4"
        >
          <div>
            <h2 id="ss-upload-heading" className="text-sm font-semibold text-[var(--ss-text)]">
              Batch upload datasets
            </h2>
            <p className="text-xs text-[var(--ss-muted)]">
              Select up to 10 CSV, TSV, Parquet, XLSX, or JSON/NDJSON files (10 MB max each).
            </p>
          </div>
          <form onSubmit={(event) => void submit(event)} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
            <label className="space-y-1 text-xs font-medium text-[var(--ss-muted)]">
              <span>Destination workspace</span>
              <select
                value={workspaceId}
                onChange={(event) => {
                  setWorkspaceId(event.target.value);
                  setProjectId('');
                  setProjects([]);
                }}
                required
                className="h-9 w-full rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2.5 text-xs text-[var(--ss-text)]"
              >
                <option value="">Select workspace</option>
                {workspaces
                  .filter((w) => w.role !== 'viewer')
                  .map((w) => (
                    <option value={w.id} key={w.id}>
                      {w.name}
                    </option>
                  ))}
              </select>
            </label>

            <label className="space-y-1 text-xs font-medium text-[var(--ss-muted)]">
              <span>Project</span>
              <select
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                required
                disabled={!workspaceId}
                className="h-9 w-full rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2.5 text-xs text-[var(--ss-text)] disabled:opacity-50"
              >
                <option value="">Select project</option>
                {projects.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-xs font-medium text-[var(--ss-muted)]">
              <span>Dataset files</span>
              <input
                name="file"
                type="file"
                accept={SUPPORTED_DATASET_EXTENSIONS.join(',')}
                multiple
                required
                className="h-9 w-full rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 py-1.5 text-xs text-[var(--ss-text)]"
              />
            </label>

            <button
              type="submit"
              disabled={busy || !projectId}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-[var(--ss-primary)] px-4 text-xs font-semibold text-white hover:bg-[var(--ss-primary-hover)] disabled:opacity-45"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>{busy ? 'Uploading…' : 'Upload dataset'}</span>
            </button>
          </form>
        </section>

        {/* Accessible Catalog */}
        <section
          aria-labelledby="ss-catalog-heading"
          className="rounded-lg border border-[var(--ss-border)] bg-[var(--ss-surface)] p-5 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="ss-catalog-heading" className="text-sm font-semibold text-[var(--ss-text)]">
                Your accessible datasets
              </h2>
              <p className="text-xs text-[var(--ss-muted)]">
                Showing up to 200 recent datasets across all workspaces you can view.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ss-subtle)]" />
                <input
                  id="ss-library-search"
                  aria-label="Search datasets"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filename, format, project…"
                  className="h-8 w-56 rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] pl-8 pr-3 text-xs"
                />
              </div>
              <button
                type="button"
                onClick={() => void refresh().catch(() => setError('Unable to refresh library.'))}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2.5 text-xs font-medium text-[var(--ss-text)] hover:bg-[var(--ss-surface-hover)]"
              >
                <RefreshCw className="h-3 w-3" />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-[var(--ss-border)]">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="border-b border-[var(--ss-border)] bg-[var(--ss-surface-subtle)] font-mono text-[10px] uppercase tracking-wider text-[var(--ss-muted)]">
                <tr>
                  <th className="px-3.5 py-2.5">Dataset</th>
                  <th className="px-3.5 py-2.5">Format</th>
                  <th className="px-3.5 py-2.5">Location</th>
                  <th className="px-3.5 py-2.5">Status</th>
                  <th className="px-3.5 py-2.5">Shape / Size</th>
                  <th className="px-3.5 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ss-border)]">
                {matches.map((item) => (
                  <tr key={item.id} className="hover:bg-[var(--ss-surface-hover)]">
                    <td className="px-3.5 py-3 font-mono font-semibold text-[var(--ss-text)]">
                      {item.filename}
                    </td>
                    <td className="px-3.5 py-3">
                      <span className="rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-[var(--ss-muted)]">
                        {(item.file_format ?? 'csv').toUpperCase()}
                      </span>
                    </td>
                    <td className="px-3.5 py-3 text-[var(--ss-muted)]">
                      <span>{item.workspace_name}</span>
                      <span className="mx-1 text-[var(--ss-subtle)]">/</span>
                      <span className="text-[var(--ss-text)]">{item.project_name}</span>
                    </td>
                    <td className="px-3.5 py-3">
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase',
                          item.status === 'ready'
                            ? 'bg-[var(--ss-pass-wash)] text-[var(--ss-pass)]'
                            : item.status === 'failed'
                              ? 'bg-[var(--ss-danger-wash)] text-[var(--ss-danger)]'
                              : 'bg-[var(--ss-warn-wash)] text-[var(--ss-warn)]',
                        )}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td className="px-3.5 py-3 font-mono text-[11px] tabular-nums text-[var(--ss-muted)]">
                      {item.row_count != null
                        ? `${formatNumber(item.row_count)}×${formatNumber(item.column_count)} · `
                        : ''}
                      {formatBytes(item.size_bytes)}
                    </td>
                    <td className="px-3.5 py-3 text-right">
                      {item.status === 'ready' ? (
                        <Link
                          href={`/workbench?workspace=${item.workspace_id}&project=${item.project_id}&dataset=${item.id}&tab=overview`}
                          className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-[var(--ss-primary)] no-underline hover:underline"
                        >
                          <span>Inspect</span>
                          <ArrowUpRight className="h-3 w-3" />
                        </Link>
                      ) : (
                        <span className="font-mono text-[10px] text-[var(--ss-subtle)]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!matches.length && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-xs text-[var(--ss-muted)]">
                      No matching datasets.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
