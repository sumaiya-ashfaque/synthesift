'use client';

import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { request, type Dataset } from '@/lib/client-api';

type LibraryItem = {
  id: string;
  filename: string;
  status: string;
  project_id: string;
  workspace_id: string;
  workspace_name: string;
  project_name: string;
  can_reuse: boolean;
};
type LibraryResult = { results: LibraryItem[]; limit: number };

type Props = { workspaceId: string; projectId: string; onImported: () => Promise<void> };

export function DatasetLibraryPicker({ workspaceId, projectId, onImported }: Props) {
  const [sources, setSources] = useState<LibraryItem[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!expanded) return;
    let active = true;
    request<LibraryResult>('/api/v1/dataset-library')
      .then((data) => {
        if (active) {
          setSources(
            data.results.filter(
              (item) => item.status === 'ready' && item.can_reuse && item.project_id !== projectId,
            ),
          );
        }
      })
      .catch(() => {
        if (active) setError('Could not load your authorized datasets.');
      });
    return () => {
      active = false;
    };
  }, [expanded, projectId]);

  async function copy() {
    if (!sourceId) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const url = `/api/v1/workspaces/${workspaceId}/projects/${projectId}/datasets/import`;
      await request<Dataset>(url, 'POST', { source_dataset_id: sourceId });
      await onImported();
      setSuccess('Copy created. Dataset validation has been queued.');
      setSourceId('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Dataset could not be imported.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => {
          setExpanded(!expanded);
          setError('');
        }}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-3 text-xs font-medium text-[var(--ss-text)] hover:bg-[var(--ss-surface-hover)]"
      >
        <Copy className="h-3.5 w-3.5 text-[var(--ss-muted)]" />
        <span>{expanded ? 'Close library' : 'Choose from dataset library'}</span>
      </button>

      {expanded && (
        <div className="max-w-xl rounded-lg border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-4 space-y-3">
          <label htmlFor="ss-library-source" className="block text-xs font-semibold text-[var(--ss-text)]">
            Existing dataset
          </label>
          <select
            id="ss-library-source"
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
            className="h-9 w-full rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 text-xs text-[var(--ss-text)]"
          >
            <option value="">Select an available dataset</option>
            {sources.map((item) => (
              <option key={item.id} value={item.id}>
                {item.filename} — {item.workspace_name} / {item.project_name}
              </option>
            ))}
          </select>
          <p className="text-xs text-[var(--ss-muted)]">
            Uses a new immutable copy in this project. The original and its reports remain unchanged.
          </p>
          {!sources.length && (
            <p className="text-xs text-[var(--ss-muted)]">
              No ready datasets available from other accessible projects.
            </p>
          )}
          <button
            type="button"
            disabled={busy || !sourceId}
            onClick={() => void copy()}
            className="inline-flex h-8 items-center rounded-md bg-[var(--ss-primary)] px-3.5 text-xs font-semibold text-white hover:bg-[var(--ss-primary-hover)] disabled:opacity-45"
          >
            {busy ? 'Importing…' : 'Copy into this project'}
          </button>
          {error && (
            <p
              role="alert"
              className="rounded-md border border-[var(--ss-danger)]/35 bg-[var(--ss-danger-wash)] px-3 py-2 text-xs text-[var(--ss-danger)]"
            >
              {error}
            </p>
          )}
          {success && (
            <p
              role="status"
              className="rounded-md border border-[var(--ss-primary-border)] bg-[var(--ss-primary-wash)] px-3 py-2 text-xs text-[var(--ss-primary)]"
            >
              {success}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
