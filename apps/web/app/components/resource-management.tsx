'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Brand } from '@/app/components/brand';
import { request, type Dataset, type Project, type Workspace } from '@/lib/client-api';

type Target = {
  kind: 'workspace' | 'project' | 'dataset';
  id: string;
  name: string;
  url: string;
  impact: string;
};

type DatasetPage = Dataset[] | { results: Dataset[] };

function ConfirmDeletion({
  target, busy, error, onCancel, onConfirm,
}: {
  target: Target;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [typed, setTyped] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [busy, onCancel]);

  return (
    <div className="ss-delete-backdrop">
      <section role="alertdialog" aria-modal="true" aria-labelledby="ss-delete-title"
        aria-describedby="ss-delete-description" className="ss-delete-dialog">
        <p className="ss-kicker">Permanent deletion</p>
        <h2 id="ss-delete-title">Delete {target.kind}?</h2>
        <p id="ss-delete-description">
          <strong>{target.name}</strong> will be permanently deleted. {target.impact}
          This cannot be undone.
        </p>
        <label htmlFor="ss-delete-confirm-name">Type <strong>{target.name}</strong> to confirm</label>
        <input ref={inputRef} id="ss-delete-confirm-name" value={typed}
          onChange={(event) => setTyped(event.target.value)} autoComplete="off"
          spellCheck={false} disabled={busy} />
        {error && <p className="ss-error-banner" role="alert">{error}</p>}
        <div className="ss-delete-dialog-actions">
          <button type="button" className="ss-button ss-button-outline" disabled={busy} onClick={onCancel}>Cancel</button>
          <button type="button" className="ss-button ss-button-danger" disabled={busy || typed !== target.name}
            onClick={() => void onConfirm()}>{busy ? 'Deleting…' : `Delete ${target.kind}`}</button>
        </div>
      </section>
    </div>
  );
}

export function ResourceManagement() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [target, setTarget] = useState<Target | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [busy, setBusy] = useState(false);

  const loadWorkspaces = useCallback(async () => {
    const items = await request<Workspace[]>('/api/v1/workspaces');
    setWorkspaces(items);
    setWorkspaceId((previous) => items.some((item) => item.id === previous) ? previous : (items[0]?.id ?? ''));
  }, []);

  useEffect(() => {
    let active = true;
    request<Workspace[]>('/api/v1/workspaces').then((items) => {
      if (!active) return;
      setWorkspaces(items);
      setWorkspaceId(items[0]?.id ?? '');
    }).catch((reason: unknown) => {
      if (!active) return;
      if (reason instanceof Error && reason.message === 'Sign in to continue.') {
        router.replace('/login');
      } else {
        setError('Unable to load workspaces. Reload this page.');
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [router]);

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    request<Project[]>(`/api/v1/workspaces/${workspaceId}/projects`).then((items) => {
      if (!active) return;
      setProjects(items);
      setProjectId((previous) => items.some((item) => item.id === previous) ? previous : (items[0]?.id ?? ''));
    }).catch(() => { if (active) setError('Unable to load projects.'); });
    return () => { active = false; };
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || !projectId) return;
    let active = true;
    request<DatasetPage>(`/api/v1/workspaces/${workspaceId}/projects/${projectId}/datasets`)
      .then((data) => { if (active) setDatasets(Array.isArray(data) ? data : data.results); })
      .catch(() => { if (active) setError('Unable to load datasets.'); });
    return () => { active = false; };
  }, [workspaceId, projectId]);

  const workspace = workspaces.find((item) => item.id === workspaceId);
  const project = projects.find((item) => item.id === projectId);
  const owner = workspace?.role === 'owner';
  const canManageDatasets = owner || workspace?.role === 'editor';
  const root = `/api/v1/workspaces/${workspaceId}`;
  const datasetRoot = `${root}/projects/${projectId}/datasets`;

  function chooseWorkspace(id: string) {
    setWorkspaceId(id);
    setProjectId('');
    setProjects([]);
    setDatasets([]);
    setError('');
  }
  function chooseProject(id: string) {
    setProjectId(id);
    setDatasets([]);
    setError('');
  }
  function openDeletion(value: Target) { setTarget(value); setDeleteError(''); }
  function closeDeletion() { if (!busy) { setTarget(null); setDeleteError(''); } }

  async function deleteSelected() {
    if (!target) return;
    const deleted = target;
    setBusy(true);
    setDeleteError('');
    try {
      await request<void>(deleted.url, 'DELETE');
      if (deleted.kind === 'workspace') {
        setProjectId('');
        setProjects([]);
        setDatasets([]);
        await loadWorkspaces();
      } else if (deleted.kind === 'project') {
        const items = await request<Project[]>(`${root}/projects`);
        setProjects(items);
        setProjectId((previous) => items.some((item) => item.id === previous) ? previous : (items[0]?.id ?? ''));
        setDatasets([]);
      } else {
        const data = await request<DatasetPage>(datasetRoot);
        setDatasets(Array.isArray(data) ? data : data.results);
      }
      setTarget(null);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Deletion failed. Please retry.';
      setDeleteError(message.includes('This item has changed')
        ? 'The resource has active work or was modified. Finish ongoing jobs, refresh, and retry.'
        : message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <main className="ss-loading-page" role="status">Loading data management…</main>;
  return (
    <div className="ss-app-shell">
      <aside className="ss-sidebar" aria-label="Product navigation">
        <div className="ss-sidebar-brand"><Brand /></div>
        <nav className="ss-sidebar-content ss-management-nav" aria-label="Navigation">
          <a href="/workspaces">Workspaces</a>
          <a href="/manage-data" aria-current="page">Manage data</a>
        </nav>
        <div className="ss-sidebar-bottom"><span className="ss-sidebar-label">SyntheSift</span><p>Data quality workspace</p></div>
      </aside>
      <div className="ss-main-column">
        <header className="ss-app-topbar"><div className="ss-breadcrumb"><a href="/workspaces">Workspaces</a><span aria-hidden="true">/</span><strong>Manage data</strong></div></header>
        <main className="ss-app-main" id="main-content">
          <div className="ss-page-heading"><div><p className="ss-kicker">Workspace administration</p>
            <h1>Manage data</h1>
            <p className="ss-page-subtitle">Remove workspaces, projects, or CSV datasets with an explicit confirmation.</p>
          </div></div>
          {error && <p className="ss-error-banner" role="alert">{error}</p>}
          <section className="ss-manage-section" aria-labelledby="ss-workspace-manage-title">
            <div className="ss-manage-heading"><h2 id="ss-workspace-manage-title">Workspace</h2></div>
            <label htmlFor="ss-manage-workspace">Select workspace</label>
            <select id="ss-manage-workspace" value={workspaceId} onChange={(event) => chooseWorkspace(event.target.value)}>
              {!workspaces.length && <option value="">No workspaces</option>}
              {workspaces.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
            </select>
            {workspace && <div className="ss-manage-row"><div><strong>{workspace.name}</strong><p>Your access: {workspace.role}</p></div>
              {owner && <button type="button" className="ss-button ss-button-danger-outline" onClick={() => openDeletion({
                kind: 'workspace', id: workspace.id, name: workspace.name, url: root,
                impact: 'All projects, original and derived datasets, analyses, and remediation records in this workspace will also be removed. ',
              })}>Delete workspace</button>}
            </div>}
          </section>
          {workspace && <section className="ss-manage-section" aria-labelledby="ss-project-manage-title">
            <div className="ss-manage-heading"><h2 id="ss-project-manage-title">Project</h2></div>
            <label htmlFor="ss-manage-project">Select project</label>
            <select id="ss-manage-project" value={projectId} onChange={(event) => chooseProject(event.target.value)}>
              {!projects.length && <option value="">No projects</option>}
              {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            {project && <div className="ss-manage-row"><div><strong>{project.name}</strong><p>Contains datasets and their analysis history</p></div>
              {owner && <button type="button" className="ss-button ss-button-danger-outline" onClick={() => openDeletion({
                kind: 'project', id: project.id, name: project.name, url: `${root}/projects/${project.id}`,
                impact: 'Every dataset, AI report, remediation record, and derived file in this project will also be removed. ',
              })}>Delete project</button>}
            </div>}
          </section>}
          {project && <section className="ss-manage-section" aria-labelledby="ss-dataset-manage-title">
            <div className="ss-manage-heading"><h2 id="ss-dataset-manage-title">Uploaded CSV files</h2>
              <p>Removing a source also removes its related analysis history and derived outputs. In-progress jobs must finish first.</p></div>
            <div className="ss-manage-data-list">
              {datasets.map((dataset) => <div key={dataset.id} className="ss-manage-row"><div>
                <strong>{dataset.filename}</strong><p>{(dataset.size_bytes / 1024).toFixed(1)} KB · {dataset.status}</p>
              </div>{canManageDatasets && <button type="button" className="ss-button ss-button-danger-outline"
                disabled={dataset.status === 'queued' || dataset.status === 'processing'}
                onClick={() => openDeletion({kind: 'dataset', id: dataset.id, name: dataset.filename,
                  url: `${datasetRoot}/${dataset.id}`,
                  impact: 'Its saved analyses, remediation records, and derived outputs will also be removed. ',
                })}>Delete CSV</button>}</div>)}
              {!datasets.length && <p className="ss-manage-empty">No uploaded CSV files in this project.</p>}
            </div>
          </section>}
          <p className="ss-manage-footnote">Deleting data cannot be undone. File cleanup is completed after the database deletion; interrupted cleanup can be retried by an administrator.</p>
        </main>
      </div>
      {target && <ConfirmDeletion key={`${target.kind}:${target.id}`} target={target} busy={busy}
        error={deleteError} onCancel={closeDeletion} onConfirm={deleteSelected} />}
    </div>
  );
}
