'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState } from 'react';

import { Brand } from '@/app/components/brand';
import { ProductNavigation } from '@/app/components/product-navigation';
import { request, uploadDataset, type Account, type Project, type Workspace } from '@/lib/client-api';

type Item = { id: string; filename: string; status: string; size_bytes: number;
  created_at: string; workspace_id: string; workspace_name: string;
  project_id: string; project_name: string; can_reuse: boolean };
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
    Promise.all([request<Account>('/api/v1/auth/me'), request<Workspace[]>('/api/v1/workspaces'),
      request<ResponseData>('/api/v1/dataset-library')]).then(([who, ws, library]) => {
        if (!active) return;
        setAccount(who); setWorkspaces(ws); setItems(library.results);
        setWorkspaceId(ws.find((item) => item.role !== 'viewer')?.id ?? '');
      }).catch((reason: unknown) => {
        if (!active) return;
        if (reason instanceof Error && reason.message === 'Sign in to continue.') router.replace('/login');
        else setError('Unable to load your dataset library.');
      }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [router]);
  useEffect(() => {
    if (!workspaceId) { setProjects([]); setProjectId(''); return; }
    let active = true;
    request<Project[]>(`/api/v1/workspaces/${workspaceId}/projects`)
      .then((data) => { if (active) { setProjects(data); setProjectId(data[0]?.id ?? ''); } })
      .catch(() => { if (active) setError('Could not load projects for upload.'); });
    return () => { active = false; };
  }, [workspaceId]);

  const matches = useMemo(() => items.filter((item) =>
    [item.filename, item.workspace_name, item.project_name, item.status].some((text) =>
      text.toLowerCase().includes(query.trim().toLowerCase()))), [items, query]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem('file') as HTMLInputElement | null;
    const files = Array.from(input?.files ?? []);
    if (!files.length || !workspaceId || !projectId) return;
    if (files.length > 10) { setError('Select up to 10 CSV files per batch.'); return; }
    if (files.some((file) => !file.name.toLowerCase().endsWith('.csv') || file.size > 10 * 1024 * 1024)) {
      setError('Each file must be a CSV no larger than 10 MB.'); return;
    }
    setBusy(true); setNotice(''); setError('');
    let completed = 0;
    const failures: string[] = [];
    try {
      for (const file of files) {
        try { await uploadDataset(workspaceId, projectId, file); completed += 1; }
        catch (reason) { failures.push(`${file.name}: ${reason instanceof Error ? reason.message : 'Upload failed'}`); }
      }
      await refresh();
      if (completed) setNotice(`${completed} dataset${completed === 1 ? '' : 's'} uploaded for validation.`);
      if (failures.length) setError(`Could not upload ${failures.length} file(s): ${failures.join('; ')}`);
      if (!failures.length) form.reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not refresh the library after upload.');
    } finally { setBusy(false); }
  }
  async function signOut() {
    try { await request<void>('/api/v1/auth/logout', 'POST'); router.replace('/login'); }
    catch { setError('Sign out failed. Retry.'); }
  }
  if (loading) return <main className="ss-loading-page" role="status">Loading dataset library…</main>;
  return <div className="ss-app-shell ss-experience-shell">
    <aside className="ss-sidebar" aria-label="Product navigation">
      <div className="ss-sidebar-brand"><Brand /></div>
      <div className="ss-sidebar-content"><ProductNavigation current="library" /></div>
      <div className="ss-sidebar-bottom"><span className="ss-sidebar-label">SyntheSift</span><p>Dataset catalog</p></div>
    </aside>
    <div className="ss-main-column">
      <header className="ss-app-topbar ss-experience-topbar">
        <div className="ss-breadcrumb"><Link href="/workspaces">Workspaces</Link><span>/</span><strong>Dataset library</strong></div>
        <div className="ss-user-actions"><span className="ss-account-label">{account?.email || account?.username}</span>
          <button className="ss-topbar-account" onClick={() => void signOut()} type="button">Sign out</button></div>
      </header>
      <main id="main-content" className="ss-app-main ss-library-main">
        <div className="ss-page-heading"><div><p className="ss-kicker">DATA CATALOG</p>
          <h1>Dataset library</h1><p className="ss-page-subtitle">Find the datasets you can access across your workspaces.</p></div>
          <Link className="ss-workbench-action" href="/workbench">Open workbench</Link></div>
        {error && <p className="ss-error-banner" role="alert">{error}</p>}
        {notice && <p className="ss-library-success" role="status">{notice}</p>}
        <section className="ss-library-upload" aria-labelledby="ss-upload-heading">
          <div><h2 id="ss-upload-heading">Upload a CSV</h2>
            <p>Choose the workspace and project where the original should live. It will appear here automatically.</p></div>
          <form onSubmit={(event) => void submit(event)}>
            <label>Destination workspace
              <select value={workspaceId} onChange={(event) => { setWorkspaceId(event.target.value); setProjectId(''); setProjects([]); }} required>
                <option value="">Select workspace</option>
                {workspaces.filter((w) => w.role !== 'viewer').map((w) => <option value={w.id} key={w.id}>{w.name}</option>)}
              </select>
            </label>
            <label>Project
              <select value={projectId} onChange={(event) => setProjectId(event.target.value)} required disabled={!workspaceId}>
                <option value="">Select project</option>
                {projects.map((p) => <option value={p.id} key={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label>CSV files (up to 10 files, 10 MB each)
              <input name="file" type="file" accept=".csv,text/csv" multiple required />
            </label>
            <button type="submit" className="ss-button ss-button-primary" disabled={busy || !projectId}>
              {busy ? 'Uploading…' : 'Upload dataset'}</button>
          </form>
          {!workspaces.some((w) => w.role !== 'viewer') && <p>Upload requires editor or owner access to a workspace.</p>}
        </section>
        <section className="ss-library-catalog" aria-labelledby="ss-catalog-heading">
          <div className="ss-section-heading"><div><h2 id="ss-catalog-heading">Your accessible datasets</h2>
            <p>Recent datasets in projects you can view. New imports are independent copies.</p></div>
            <button className="ss-button ss-button-outline" type="button"
              onClick={() => void refresh().catch(() => setError('Unable to refresh library.'))}>Refresh</button></div>
          <label htmlFor="ss-library-search">Search datasets</label>
          <input id="ss-library-search" value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="Filename, project, workspace or status" />
          <div className="ss-workbench-table-scroll">
            <table className="ss-workbench-table"><thead><tr>
              <th>Dataset</th><th>Project</th><th>Workspace</th><th>Status</th><th>Size</th><th>Uploaded</th>
            </tr></thead><tbody>
              {matches.map((item) => <tr key={item.id}>
                <td><strong>{item.filename}</strong></td><td>{item.project_name}</td>
                <td>{item.workspace_name}</td><td>{item.status}</td>
                <td>{(item.size_bytes / 1024).toFixed(1)} KB</td>
                <td>{new Date(item.created_at).toLocaleDateString()}</td>
              </tr>)}
              {!matches.length && <tr><td colSpan={6}>No matching datasets.</td></tr>}
            </tbody></table>
          </div>
          <p className="ss-workbench-disclaimer">Showing up to 200 recent datasets. Import into a project from its dataset panel; existing analyses stay with the original.</p>
        </section>
      </main>
    </div>
  </div>;
}
