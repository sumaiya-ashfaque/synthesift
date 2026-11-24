'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ChevronRight, Folder, Plus } from 'lucide-react';
import { DatasetPanel } from '@/app/components/dataset-panel';
import { AppShell } from '@/app/components/shell/app-shell';
import {
  request,
  type Account,
  type Project,
  type Workspace,
} from '@/lib/client-api';
import { cn } from '@/lib/cn';

export function WorkspaceDashboard() {
  const router = useRouter();

  const [account, setAccount] = useState<Account | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [projectSnapshot, setProjectSnapshot] = useState<{
    workspaceId: string;
    items: Project[];
    failed?: boolean;
  } | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadWorkspaces = useCallback(async () => {
    const items = await request<Workspace[]>('/api/v1/workspaces');
    setWorkspaces(items);
    setSelected((current) =>
      items.some((item) => item.id === current) ? current : (items[0]?.id ?? null),
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
          setProjectSnapshot({ workspaceId: selected, items, failed: false });
        }
      })
      .catch(() => {
        if (active) {
          setProjectSnapshot({ workspaceId: selected, items: [], failed: true });
          setError('Unable to load projects.');
        }
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
      const created = await request<Workspace>('/api/v1/workspaces', 'POST', { name });
      await loadWorkspaces();
      setSelected(created.id);
      setSelectedProjectId(null);
      form.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create workspace.');
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
      const created = await request<Project>(`/api/v1/workspaces/${selected}/projects`, 'POST', {
        name,
      });
      const items = await request<Project[]>(`/api/v1/workspaces/${selected}/projects`);
      setProjectSnapshot({ workspaceId: selected, items, failed: false });
      setSelectedProjectId(created.id);
      form.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create project.');
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
  const projects = projectSnapshot?.workspaceId === selected ? projectSnapshot.items : [];
  const projectsLoading = selected !== null && projectSnapshot?.workspaceId !== selected;
  const projectsFailed = projectSnapshot?.workspaceId === selected && projectSnapshot.failed === true;
  const activeProject = projects.find((item) => item.id === selectedProjectId) ?? projects[0];

  if (loading) {
    return (
      <main
        className="grid min-h-screen place-items-center bg-[var(--ss-canvas)] font-mono text-xs text-[var(--ss-muted)]"
        role="status"
      >
        Loading workspaces…
      </main>
    );
  }

  return (
    <AppShell
      current="overview"
      breadcrumb={[
        { label: 'Workspaces' },
        { label: workspace?.name ?? 'Overview' },
      ]}
      account={account}
      onSignOut={() => void signOut()}
      quickJumps={workspaces.map((w) => ({
        id: `ws-${w.id}`,
        label: `Workspace: ${w.name}`,
        group: 'Workspaces',
        meta: w.role,
        onSelect: () => {
          setSelected(w.id);
          setSelectedProjectId(null);
        },
      }))}
      sidebarExtra={
        <div className="space-y-2 border-t border-[var(--ss-border)] pt-4">
          <span className="block px-2 font-mono text-[10px] font-semibold tracking-[0.12em] uppercase text-[var(--ss-subtle)]">
            YOUR WORKSPACES
          </span>
          <nav aria-label="Select workspace" className="flex flex-col gap-0.5">
            {workspaces.map((item) => {
              const isActive = selected === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => {
                    setError('');
                    setSelected(item.id);
                    setSelectedProjectId(null);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-xs transition-colors',
                    isActive
                      ? 'bg-[var(--ss-primary-wash)] text-[var(--ss-primary)] font-semibold'
                      : 'text-[var(--ss-muted)] hover:bg-[var(--ss-surface-hover)] hover:text-[var(--ss-text)] font-medium',
                  )}
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded border border-[var(--ss-border)] bg-[var(--ss-surface)] font-mono text-[10px] font-semibold text-[var(--ss-primary)]">
                    {item.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" />
                </button>
              );
            })}
            {!workspaces.length && (
              <p className="px-2 py-1 text-xs text-[var(--ss-muted)]">No workspaces yet.</p>
            )}
          </nav>

          <details className="pt-2">
            <summary className="cursor-pointer px-2 font-mono text-[11px] font-semibold text-[var(--ss-primary)] hover:underline">
              + New workspace
            </summary>
            <form onSubmit={createWorkspace} className="mt-2.5 space-y-2 px-1">
              <label htmlFor="ss-workspace-name" className="block text-[11px] text-[var(--ss-muted)]">
                Workspace name
              </label>
              <input
                id="ss-workspace-name"
                name="name"
                maxLength={120}
                required
                placeholder="e.g. Analytics Team"
                className="h-8 w-full rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2.5 text-xs"
              />
              <button
                type="submit"
                disabled={busy}
                className="h-8 w-full rounded-md bg-[var(--ss-primary)] text-xs font-semibold text-white hover:bg-[var(--ss-primary-hover)] disabled:opacity-50"
              >
                Create workspace
              </button>
            </form>
          </details>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ss-primary)]">
              WORKSPACE OVERVIEW
            </p>
            <h1 className="mt-1 text-2xl sm:text-[28px] font-semibold tracking-[-0.03em] text-[var(--ss-text)]">
              {workspace?.name ?? 'Your workspaces'}
            </h1>
            <p className="mt-1 text-sm text-[var(--ss-muted)]">
              {workspace
                ? 'Organize projects, ingest multi-format tabular datasets, and launch datasets into the Studio.'
                : 'Create a workspace in the left rail to start organizing projects.'}
            </p>
          </div>
          {workspace && (
            <span className="rounded-full border border-[var(--ss-primary-border)] bg-[var(--ss-primary-wash)] px-3 py-1 font-mono text-[11px] font-semibold uppercase text-[var(--ss-primary)]">
              {workspace.role}
            </span>
          )}
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-[var(--ss-danger)]/35 bg-[var(--ss-danger-wash)] px-4 py-2.5 text-xs text-[var(--ss-danger)]"
          >
            {error}
          </p>
        )}

        {workspace ? (
          <>
            {/* 3-Card Workspace KPI Strip */}
            <section
              aria-label="Workspace details"
              className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[var(--ss-border)] overflow-hidden rounded-lg border border-[var(--ss-border)] bg-[var(--ss-surface)]"
            >
              <div className="p-4">
                <span className="block font-mono text-[10px] uppercase tracking-wider text-[var(--ss-subtle)]">
                  Projects
                </span>
                <strong className="mt-1.5 block font-mono text-2xl font-semibold tabular-nums">
                  {projectsLoading ? '—' : projects.length}
                </strong>
                <small className="mt-1 block text-[11px] text-[var(--ss-muted)]">
                  Active in workspace
                </small>
              </div>
              <div className="p-4">
                <span className="block font-mono text-[10px] uppercase tracking-wider text-[var(--ss-subtle)]">
                  Your access
                </span>
                <strong className="mt-1.5 block text-lg font-semibold capitalize">
                  {workspace.role}
                </strong>
                <small className="mt-1 block text-[11px] text-[var(--ss-muted)]">
                  Role-based permission tier
                </small>
              </div>
              <div className="p-4">
                <span className="block font-mono text-[10px] uppercase tracking-wider text-[var(--ss-subtle)]">
                  Created
                </span>
                <strong className="mt-1.5 block font-mono text-lg font-semibold tabular-nums">
                  {workspace.created_at
                    ? new Date(workspace.created_at).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })
                    : '—'}
                </strong>
                <small className="mt-1 block text-[11px] text-[var(--ss-muted)]">
                  Immutable workspace ledger
                </small>
              </div>
            </section>

            {/* Projects Panel */}
            <section
              aria-labelledby="ss-project-title"
              className="overflow-hidden rounded-lg border border-[var(--ss-border)] bg-[var(--ss-surface)]"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ss-border)] px-5 py-4">
                <div>
                  <h2 id="ss-project-title" className="text-sm font-semibold text-[var(--ss-text)]">
                    Projects
                  </h2>
                  <p className="text-xs text-[var(--ss-muted)]">
                    Select a project to manage its datasets or launch any dataset into the Studio.
                  </p>
                </div>
                {workspace.role !== 'viewer' && (
                  <a
                    href="#ss-create-project"
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2.5 text-xs font-medium text-[var(--ss-text)] no-underline hover:bg-[var(--ss-surface-hover)]"
                  >
                    <Plus className="h-3.5 w-3.5 text-[var(--ss-primary)]" />
                    <span>New project</span>
                  </a>
                )}
              </div>

              {projectsLoading ? (
                <p className="p-6 font-mono text-xs text-[var(--ss-muted)]" role="status">
                  Loading projects…
                </p>
              ) : projectsFailed ? (
                <p className="p-6 text-xs text-[var(--ss-danger)]" role="alert">
                  Projects could not be loaded. Reload the page to retry.
                </p>
              ) : projects.length ? (
                <ul className="divide-y divide-[var(--ss-border)]">
                  {projects.map((item) => {
                    const isSelected = activeProject?.id === item.id;
                    return (
                      <li
                        key={item.id}
                        className={cn(
                          'flex items-center justify-between gap-3 px-5 py-3.5 transition-colors',
                          isSelected
                            ? 'bg-[var(--ss-primary-wash)]/55 border-l-2 border-l-[var(--ss-primary)]'
                            : 'hover:bg-[var(--ss-surface-hover)]',
                        )}
                      >
                        <button
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => setSelectedProjectId(item.id)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] text-[var(--ss-primary)]">
                            <Folder className="h-4 w-4" strokeWidth={1.65} />
                          </span>
                          <div className="min-w-0">
                            <strong className="block truncate text-sm font-semibold text-[var(--ss-text)]">
                              {item.name}
                            </strong>
                            {item.description && (
                              <p className="truncate text-xs text-[var(--ss-muted)]">
                                {item.description}
                              </p>
                            )}
                          </div>
                        </button>
                        <span className="rounded border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2 py-0.5 font-mono text-[10px] uppercase text-[var(--ss-muted)]">
                          {isSelected ? 'Selected' : 'Project'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="p-8 text-center">
                  <strong className="block text-sm font-semibold text-[var(--ss-text)]">
                    No projects yet
                  </strong>
                  <p className="mt-1 text-xs text-[var(--ss-muted)]">
                    Create a project below to organize datasets and analysis runs.
                  </p>
                </div>
              )}

              {workspace.role !== 'viewer' && (
                <div
                  id="ss-create-project"
                  className="border-t border-[var(--ss-border)] bg-[var(--ss-canvas)]/60 px-5 py-4"
                >
                  <form onSubmit={createProject} className="space-y-2">
                    <label
                      htmlFor="ss-project-name"
                      className="block font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--ss-subtle)]"
                    >
                      Create a project
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2.5">
                      <input
                        id="ss-project-name"
                        name="name"
                        maxLength={120}
                        required
                        placeholder="e.g. Revenue Billing Q4"
                        className="h-9 flex-1 rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] px-3 text-xs text-[var(--ss-text)]"
                      />
                      <button
                        type="submit"
                        disabled={busy}
                        className="h-9 rounded-md bg-[var(--ss-primary)] px-4 text-xs font-semibold text-white hover:bg-[var(--ss-primary-hover)] disabled:opacity-50"
                      >
                        Create project
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </section>

            {/* Active Project Datasets Panel */}
            {!projectsLoading && !projectsFailed && activeProject && selected && (
              <DatasetPanel
                key={`${selected}:${activeProject.id}`}
                workspaceId={selected}
                project={activeProject}
                canUpload={workspace.role !== 'viewer'}
              />
            )}
          </>
        ) : (
          <section
            aria-live="polite"
            className="rounded-lg border border-dashed border-[var(--ss-border-strong)] bg-[var(--ss-surface)] p-12 text-center"
          >
            <strong className="text-sm font-semibold text-[var(--ss-text)]">
              No workspace selected
            </strong>
            <p className="mt-1 text-xs text-[var(--ss-muted)]">
              Choose or create a workspace in the left rail to manage projects and datasets.
            </p>
          </section>
        )}
      </div>
    </AppShell>
  );
}
