'use client';

import { useEffect, useState } from 'react';
import { request, type Dataset } from '@/lib/client-api';

type LibraryItem = {
  id: string; filename: string; status: string;
  project_id: string; workspace_id: string;
  workspace_name: string; project_name: string; can_reuse: boolean;
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
      .then((data) => { if (active) setSources(data.results.filter((item) =>
        item.status === 'ready' && item.can_reuse && item.project_id !== projectId)); })
      .catch(() => { if (active) setError('Could not load your authorized datasets.'); });
    return () => { active = false; };
  }, [expanded, projectId]);

  async function copy() {
    if (!sourceId) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      const url = `/api/v1/workspaces/${workspaceId}/projects/${projectId}/datasets/import`;
      await request<Dataset>(url, 'POST', { source_dataset_id: sourceId });
      await onImported();
      setSuccess('Copy created. Dataset validation has been queued.');
      setSourceId('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Dataset could not be imported.');
    } finally { setBusy(false); }
  }

  return (
    <div className="ss-library-picker">
      <button type="button" className="ss-button ss-button-outline" aria-expanded={expanded}
        onClick={() => { setExpanded(!expanded); setError(''); }}>
        {expanded ? 'Close library' : 'Choose from dataset library'}
      </button>
      {expanded && <div className="ss-library-picker-details">
        <label htmlFor="ss-library-source">Existing dataset</label>
        <select id="ss-library-source" value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
          <option value="">Select an available dataset</option>
          {sources.map((item) => <option key={item.id} value={item.id}>
            {item.filename} — {item.workspace_name} / {item.project_name}
          </option>)}
        </select>
        <p>Uses a new immutable copy in this project. The original and its reports remain unchanged.</p>
        {!sources.length && <p>No ready datasets available from other accessible projects.</p>}
        <button type="button" className="ss-button ss-button-primary" disabled={busy || !sourceId}
          onClick={() => void copy()}>{busy ? 'Importing…' : 'Copy into this project'}</button>
        {error && <p role="alert" className="ss-error-banner">{error}</p>}
        {success && <p role="status" className="ss-library-success">{success}</p>}
      </div>}
    </div>
  );
}
