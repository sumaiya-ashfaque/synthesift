'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { request, type Account, type Project, type Workspace } from '@/lib/client-api';

export function WorkspaceDashboard() {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [projectSnapshot, setProjectSnapshot] = useState<{ workspaceId: string; items: Project[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadWorkspaces = useCallback(async () => {
    const items = await request<Workspace[]>('/api/v1/workspaces');
    setWorkspaces(items);
    setSelected((current) => (items.some((item) => item.id === current) ? current : items[0]?.id ?? null));
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const me = await request<Account>('/api/v1/auth/me');
        if (!active) return;
        setAccount(me);
        await loadWorkspaces();
      } catch (err) {
        if (!active) return;
        if (err instanceof Error && err.message === 'Sign in to continue.') {
          router.replace('/login');
        } else {
          setError('Unable to load your workspaces. Retry the page.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [loadWorkspaces, router]);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    request<Project[]>(`/api/v1/workspaces/${selected}/projects`)
      .then((items) => { if (active) setProjectSnapshot({ workspaceId: selected, items }); })
      .catch(() => { if (active) setError('Unable to load projects.'); });
    return () => { active = false; };
  }, [selected]);

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get('name') ?? '').trim();
    if (!name) return;
    setBusy(true);
    setError('');
    try {
      const created = await request<Workspace>('/api/v1/workspaces', 'POST', { name });
      await loadWorkspaces();
      setSelected(created.id);
      form.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create workspace.');
    } finally { setBusy(false); }
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const name = String(new FormData(form).get('name') ?? '').trim();
    if (!name) return;
    setBusy(true);
    setError('');
    try {
      await request<Project>(`/api/v1/workspaces/${selected}/projects`, 'POST', { name });
      const items = await request<Project[]>(`/api/v1/workspaces/${selected}/projects`);
      setProjectSnapshot({ workspaceId: selected, items });
      form.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create project.');
    } finally { setBusy(false); }
  }

  async function signOut() {
    setBusy(true);
    try {
      await request<void>('/api/v1/auth/logout', 'POST');
      router.replace('/login');
    } catch {
      setError('Sign out failed. Please retry.');
      setBusy(false);
    }
  }

  const workspace = workspaces.find((item) => item.id === selected);
  const projects = projectSnapshot?.workspaceId === selected ? projectSnapshot.items : [];
  if (loading) return <main className="site-shell"><p role="status">Loading your workspaces…</p></main>;

  return (
    <main className="site-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark" aria-hidden="true">S</span>SyntheSift</div>
        <div className="header-actions"><span className="muted">{account?.username}</span><button className="text-button" onClick={signOut} disabled={busy}>Sign out</button></div>
      </header>
      <section className="workspace-heading"><p className="eyebrow">Data management</p><h1>Your workspaces</h1><p className="muted">Organize datasets within projects and control access by workspace.</p></section>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="content-grid">
        <section className="panel" aria-labelledby="workspaces-title">
          <h2 id="workspaces-title">Workspaces</h2>
          <div className="selection-list">
            {workspaces.map((item) => (
              <button key={item.id} className={`selection-item ${selected === item.id ? 'selected' : ''}`} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}>
                <strong>{item.name}</strong><span className="muted">{item.role}</span>
              </button>
            ))}
            {!workspaces.length && <p className="muted">No workspaces yet. Create your first one below.</p>}
          </div>
          <form onSubmit={createWorkspace} className="inline-form">
            <label htmlFor="workspace-name">New workspace name</label>
            <input id="workspace-name" name="name" maxLength={120} required placeholder="Analytics Team" />
            <button className="primary-link" disabled={busy}>Create workspace</button>
          </form>
        </section>
        <section className="panel" aria-labelledby="projects-title">
          <h2 id="projects-title">{workspace ? `${workspace.name} · Projects` : 'Projects'}</h2>
          {workspace ? (
            <>
              <ul className="project-list">
                {projects.map((item) => <li key={item.id}><strong>{item.name}</strong><p className="muted">{item.description || 'Dataset admission will be available in the next increment.'}</p></li>)}
              </ul>
              {!projects.length && <p className="muted">No projects yet.</p>}
              {workspace.role !== 'viewer' && (
                <form onSubmit={createProject} className="inline-form">
                  <label htmlFor="project-name">New project name</label>
                  <input id="project-name" name="name" maxLength={120} required placeholder="Customer Data" />
                  <button className="primary-link" disabled={busy}>Create project</button>
                </form>
              )}
            </>
          ) : <p className="muted">Select a workspace to see its projects.</p>}
        </section>
      </div>
    </main>
  );
}
