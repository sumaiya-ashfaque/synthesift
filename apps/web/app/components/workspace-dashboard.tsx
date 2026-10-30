
'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Brand } from '@/app/components/brand';
import { request, type Account, type Project, type Workspace } from '@/lib/client-api';

export function WorkspaceDashboard() {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [projectSnapshot, setProjectSnapshot] = useState<{
    workspaceId: string;
    items: Project[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadWorkspaces = useCallback(async () => {
    const items = await request<Workspace[]>('/api/v1/workspaces');
    setWorkspaces(items);
    setSelected((current) =>
      items.some((item) => item.id === current)
        ? current
        : items[0]?.id ?? null
    );
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

        if (
          err instanceof Error &&
          err.message === 'Sign in to continue.'
        ) {
          router.replace('/login');
        } else {
          setError('Unable to load your workspaces. Retry the page.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [loadWorkspaces, router]);

  useEffect(() => {
    if (!selected) return;

    let active = true;

    request<Project[]>(`/api/v1/workspaces/${selected}/projects`)
      .then((items) => {
        if (active) {
          setProjectSnapshot({ workspaceId: selected, items });
        }
      })
      .catch(() => {
        if (active) setError('Unable to load projects.');
      });

    return () => {
      active = false;
    };
  }, [selected]);

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const name = String(new FormData(form).get('name') ?? '').trim();
    if (!name) return;

    setBusy(true);
    setError('');

    try {
      const created = await request<Workspace>(
        '/api/v1/workspaces',
        'POST',
        { name }
      );

      await loadWorkspaces();
      setSelected(created.id);
      form.reset();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to create workspace.'
      );
    } finally {
      setBusy(false);
    }
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
      await request<Project>(
        `/api/v1/workspaces/${selected}/projects`,
        'POST',
        { name }
      );

      const items = await request<Project[]>(
        `/api/v1/workspaces/${selected}/projects`
      );

      setProjectSnapshot({ workspaceId: selected, items });
      form.reset();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to create project.'
      );
    } finally {
      setBusy(false);
    }
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
  const projects =
    projectSnapshot?.workspaceId === selected
      ? projectSnapshot.items
      : [];

  if (loading) {
    return (
      <main className="ss-loading-page" role="status">
        Loading workspaces…
      </main>
    );
  }

  return (
    <div className="ss-app-shell">
      <aside className="ss-sidebar" aria-label="Workspace navigation">
        <div className="ss-sidebar-brand">
          <Brand />
        </div>

        <div className="ss-sidebar-content">
          <div className="ss-sidebar-label">Workspaces</div>

          <nav
            aria-label="Select workspace"
            className="ss-workspace-nav"
          >
            {workspaces.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`ss-workspace-button ${
                  selected === item.id ? 'is-active' : ''
                }`}
                aria-current={
                  selected === item.id ? 'page' : undefined
                }
                onClick={() => {
                  setError('');
                  setSelected(item.id);
                }}
              >
                <span
                  className="ss-workspace-initial"
                  aria-hidden="true"
                >
                  {item.name.slice(0, 1).toUpperCase()}
                </span>

                <span className="ss-workspace-name">
                  {item.name}
                </span>

                <span
                  className="ss-workspace-chevron"
                  aria-hidden="true"
                >
                  ›
                </span>
              </button>
            ))}

            {!workspaces.length && (
              <p className="ss-sidebar-empty">
                No workspaces yet.
              </p>
            )}
          </nav>

          <details className="ss-sidebar-create">
            <summary>New workspace</summary>

            <form
              onSubmit={createWorkspace}
              className="ss-sidebar-form"
            >
              <label htmlFor="ss-workspace-name">
                Workspace name
              </label>

              <input
                id="ss-workspace-name"
                name="name"
                maxLength={120}
                required
                placeholder="e.g. Analytics Team"
              />

              <button
                type="submit"
                className="ss-button ss-button-primary"
                disabled={busy}
              >
                Create workspace
              </button>
            </form>
          </details>
        </div>

        <div className="ss-sidebar-bottom">
          <span className="ss-sidebar-label">SyntheSift</span>
          <p>Data quality workspace</p>
        </div>
      </aside>

      <div className="ss-main-column">
        <header className="ss-app-topbar">
          <div className="ss-breadcrumb">
            <span>Workspaces</span>
            <span aria-hidden="true">/</span>
            <strong>{workspace?.name ?? 'Overview'}</strong>
          </div>

          <div className="ss-user-actions">
            <span
              className="ss-account-label"
              title={account?.email || account?.username}
            >
              {account?.email || account?.username}
            </span>

            <button
              type="button"
              className="ss-button ss-button-outline"
              onClick={signOut}
              disabled={busy}
            >
              Sign out
            </button>
          </div>
        </header>

        <main className="ss-app-main" id="main-content">
          <div className="ss-page-heading">
            <div>
              <p className="ss-kicker">Workspace overview</p>

              <h1>{workspace?.name ?? 'Your workspaces'}</h1>

              <p className="ss-page-subtitle">
                {workspace
                  ? 'Manage projects and organize your data in this workspace.'
                  : 'Create a workspace to organize your projects.'}
              </p>
            </div>

            {workspace && (
              <span className="ss-role-tag">
                {workspace.role}
              </span>
            )}
          </div>

          {error && (
            <p className="ss-error-banner" role="alert">
              {error}
            </p>
          )}

          {workspace ? (
            <>
              <section
                className="ss-overview-row"
                aria-label="Workspace details"
              >
                <div className="ss-overview-card">
                  <span>Projects</span>
                  <strong>{projects.length}</strong>
                  <small>In this workspace</small>
                </div>

                <div className="ss-overview-card">
                  <span>Your access</span>
                  <strong className="ss-overview-text">
                    {workspace.role}
                  </strong>
                  <small>Workspace permissions</small>
                </div>

                <div className="ss-overview-card">
                  <span>Created</span>
                  <strong className="ss-overview-date">
                    {workspace.created_at
                      ? new Date(
                          workspace.created_at
                        ).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })
                      : '—'}
                  </strong>
                  <small>Workspace created</small>
                </div>
              </section>

              <section
                className="ss-project-panel"
                aria-labelledby="ss-project-title"
              >
                <div className="ss-project-panel-header">
                  <div>
                    <h2 id="ss-project-title">Projects</h2>
                    <p>
                      Organize related datasets and analysis work.
                    </p>
                  </div>

                  {workspace.role !== 'viewer' && (
                    <a
                      className="ss-small-anchor"
                      href="#ss-create-project"
                    >
                      New project
                    </a>
                  )}
                </div>

                {projects.length ? (
                  <ul className="ss-project-rows">
                    {projects.map((item) => (
                      <li
                        className="ss-project-row"
                        key={item.id}
                      >
                        <span
                          className="ss-project-symbol"
                          aria-hidden="true"
                        >
                          <svg
                            width="19"
                            height="19"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.75"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10H3V7Z" />
                          </svg>
                        </span>

                        <div className="ss-project-row-body">
                          <strong>{item.name}</strong>

                          {item.description && (
                            <p>{item.description}</p>
                          )}
                        </div>

                        <span className="ss-project-type">
                          Project
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="ss-empty-projects">
                    <strong>No projects yet</strong>
                    <p>
                      Create a project to keep related datasets together.
                    </p>
                  </div>
                )}

                {workspace.role !== 'viewer' && (
                  <div
                    className="ss-project-create"
                    id="ss-create-project"
                  >
                    <form
                      onSubmit={createProject}
                      className="ss-project-form"
                    >
                      <label htmlFor="ss-project-name">
                        Create a project
                      </label>

                      <div className="ss-project-form-row">
                        <input
                          id="ss-project-name"
                          name="name"
                          maxLength={120}
                          required
                          placeholder="Project name"
                        />

                        <button
                          className="ss-button ss-button-primary"
                          type="submit"
                          disabled={busy}
                        >
                          Create project
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </section>
            </>
          ) : (
            <section
              className="ss-empty-projects"
              aria-live="polite"
            >
              <strong>No workspace selected</strong>
              <p>
                Choose or create a workspace in the sidebar to
                manage its projects.
              </p>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
