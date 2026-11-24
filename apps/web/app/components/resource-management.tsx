'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Trash2, UserPlus, Users } from 'lucide-react';
import { AppShell } from '@/app/components/shell/app-shell';
import {
  addWorkspaceMember,
  fetchWorkspaceMembers,
  removeWorkspaceMember,
  request,
  type Dataset,
  type Project,
  type Workspace,
} from '@/lib/client-api';
import type { WorkspaceMember } from '@/lib/types';

type Target = {
  kind: 'workspace' | 'project' | 'dataset';
  id: string;
  name: string;
  url: string;
  impact: string;
};

type DatasetPage = Dataset[] | { results: Dataset[] };

function ConfirmDeletion({
  target,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  target: Target;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [typed, setTyped] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [busy, onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 backdrop-blur-[1px]">
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ss-delete-title"
        aria-describedby="ss-delete-description"
        className="w-full max-w-md rounded-lg border border-[var(--ss-border-strong)] bg-[var(--ss-surface)] p-6 shadow-2xl space-y-4"
      >
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ss-danger)]">
            Permanent deletion
          </p>
          <h2 id="ss-delete-title" className="mt-1 text-lg font-semibold text-[var(--ss-text)]">
            Delete {target.kind}?
          </h2>
          <p id="ss-delete-description" className="mt-1.5 text-xs leading-relaxed text-[var(--ss-muted)]">
            <strong className="text-[var(--ss-text)]">{target.name}</strong> will be permanently deleted.{' '}
            {target.impact}
            This cannot be undone.
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="ss-delete-confirm-name" className="block text-xs text-[var(--ss-text)]">
            Type <strong>{target.name}</strong> to confirm
          </label>
          <input
            ref={inputRef}
            id="ss-delete-confirm-name"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            className="h-9 w-full rounded-md border border-[var(--ss-border-strong)] bg-[var(--ss-canvas)] px-3 font-mono text-xs text-[var(--ss-text)]"
          />
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-[var(--ss-danger)]/35 bg-[var(--ss-danger-wash)] px-3 py-2 text-xs text-[var(--ss-danger)]"
          >
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="h-9 rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] px-3.5 text-xs font-medium text-[var(--ss-text)] hover:bg-[var(--ss-surface-hover)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || typed !== target.name}
            onClick={() => void onConfirm()}
            className="h-9 rounded-md bg-[var(--ss-danger)] px-4 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40"
          >
            {busy ? 'Deleting…' : `Delete ${target.kind}`}
          </button>
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
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [memberUsername, setMemberUsername] = useState('');
  const [memberRole, setMemberRole] = useState<'editor' | 'viewer'>('editor');
  const [memberBusy, setMemberBusy] = useState(false);
  const [memberError, setMemberError] = useState('');
  const [memberNotice, setMemberNotice] = useState('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [target, setTarget] = useState<Target | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [busy, setBusy] = useState(false);

  const loadWorkspaces = useCallback(async () => {
    const items = await request<Workspace[]>('/api/v1/workspaces');
    setWorkspaces(items);
    setWorkspaceId((previous) =>
      items.some((item) => item.id === previous) ? previous : (items[0]?.id ?? ''),
    );
  }, []);

  useEffect(() => {
    let active = true;
    request<Workspace[]>('/api/v1/workspaces')
      .then((items) => {
        if (!active) return;
        setWorkspaces(items);
        setWorkspaceId(items[0]?.id ?? '');
      })
      .catch((reason: unknown) => {
        if (!active) return;
        if (reason instanceof Error && reason.message === 'Sign in to continue.') {
          router.replace('/login');
        } else {
          setError('Unable to load workspaces. Reload this page.');
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
      .then((items) => {
        if (!active) return;
        setProjects(items);
        setProjectId((previous) =>
          items.some((item) => item.id === previous) ? previous : (items[0]?.id ?? ''),
        );
      })
      .catch(() => {
        if (active) setError('Unable to load projects.');
      });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || !projectId) return;
    let active = true;
    request<DatasetPage>(`/api/v1/workspaces/${workspaceId}/projects/${projectId}/datasets`)
      .then((data) => {
        if (active) setDatasets(Array.isArray(data) ? data : data.results);
      })
      .catch(() => {
        if (active) setError('Unable to load datasets.');
      });
    return () => {
      active = false;
    };
  }, [workspaceId, projectId]);

  const workspace = workspaces.find((item) => item.id === workspaceId);
  const project = projects.find((item) => item.id === projectId);
  const owner = workspace?.role === 'owner';
  const canManageDatasets = owner || workspace?.role === 'editor';
  const root = `/api/v1/workspaces/${workspaceId}`;
  const datasetRoot = `${root}/projects/${projectId}/datasets`;

  async function loadMembers() {
    if (!workspaceId || !owner) return;
    setMemberBusy(true);
    setMemberError('');
    try {
      const list = await fetchWorkspaceMembers(workspaceId);
      setMembers(list);
      setMembersLoaded(true);
    } catch (cause) {
      setMemberError(cause instanceof Error ? cause.message : 'Unable to load workspace members.');
    } finally {
      setMemberBusy(false);
    }
  }

  async function handleAddMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || !owner || !memberUsername.trim()) return;
    setMemberBusy(true);
    setMemberError('');
    setMemberNotice('');
    try {
      const created = await addWorkspaceMember(workspaceId, memberUsername.trim(), memberRole);
      setMembers((prev) => [...prev, created]);
      setMembersLoaded(true);
      setMemberUsername('');
      setMemberNotice(`Granted ${created.role} access to ${created.username}.`);
    } catch (cause) {
      setMemberError(cause instanceof Error ? cause.message : 'Could not add member.');
    } finally {
      setMemberBusy(false);
    }
  }

  async function handleRemoveMember(userId: number, username: string) {
    if (!workspaceId || !owner) return;
    setMemberBusy(true);
    setMemberError('');
    setMemberNotice('');
    try {
      await removeWorkspaceMember(workspaceId, userId);
      setMembers((prev) => prev.filter((m) => m.user_id !== userId));
      setMemberNotice(`Revoked access for ${username}.`);
    } catch (cause) {
      setMemberError(cause instanceof Error ? cause.message : 'Could not remove member.');
    } finally {
      setMemberBusy(false);
    }
  }

  function chooseWorkspace(id: string) {
    setWorkspaceId(id);
    setProjectId('');
    setProjects([]);
    setDatasets([]);
    setMembers([]);
    setMembersLoaded(false);
    setError('');
  }
  function chooseProject(id: string) {
    setProjectId(id);
    setDatasets([]);
    setError('');
  }
  function openDeletion(value: Target) {
    setTarget(value);
    setDeleteError('');
  }
  function closeDeletion() {
    if (!busy) {
      setTarget(null);
      setDeleteError('');
    }
  }

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
        setProjectId((previous) =>
          items.some((item) => item.id === previous) ? previous : (items[0]?.id ?? ''),
        );
        setDatasets([]);
      } else {
        const data = await request<DatasetPage>(datasetRoot);
        setDatasets(Array.isArray(data) ? data : data.results);
      }
      setTarget(null);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Deletion failed. Please retry.';
      setDeleteError(
        message.includes('This item has changed')
          ? 'The resource has active work or was modified. Finish ongoing jobs, refresh, and retry.'
          : message,
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main
        className="grid min-h-screen place-items-center bg-[var(--ss-canvas)] font-mono text-xs text-[var(--ss-muted)]"
        role="status"
      >
        Loading data management…
      </main>
    );
  }

  return (
    <AppShell
      current="manage-data"
      breadcrumb={[
        { label: 'Workspaces', href: '/workspaces' },
        { label: 'Manage data' },
      ]}
    >
      <div className="space-y-6 max-w-4xl">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ss-primary)]">
            WORKSPACE GOVERNANCE & RBAC
          </p>
          <h1 className="mt-1 text-2xl sm:text-[28px] font-semibold tracking-[-0.03em] text-[var(--ss-text)]">
            Manage data
          </h1>
          <p className="mt-1 text-sm text-[var(--ss-muted)]">
            Control workspace member permissions and permanently delete workspaces, projects, or datasets with typed confirmation.
          </p>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-[var(--ss-danger)]/35 bg-[var(--ss-danger-wash)] px-4 py-2.5 text-xs text-[var(--ss-danger)]"
          >
            {error}
          </p>
        )}

        {/* Workspace Selection & Deletion */}
        <section
          aria-labelledby="ss-workspace-manage-title"
          className="rounded-lg border border-[var(--ss-border)] bg-[var(--ss-surface)] p-5 space-y-4"
        >
          <h2 id="ss-workspace-manage-title" className="text-sm font-semibold text-[var(--ss-text)]">
            Workspace
          </h2>
          <div className="space-y-1">
            <label htmlFor="ss-manage-workspace" className="block text-xs text-[var(--ss-muted)]">
              Select workspace
            </label>
            <select
              id="ss-manage-workspace"
              value={workspaceId}
              onChange={(event) => chooseWorkspace(event.target.value)}
              className="h-9 w-full max-w-md rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2.5 text-xs text-[var(--ss-text)]"
            >
              {!workspaces.length && <option value="">No workspaces</option>}
              {workspaces.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>

          {workspace && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-4 py-3">
              <div>
                <strong className="text-sm font-semibold text-[var(--ss-text)]">{workspace.name}</strong>
                <p className="text-xs text-[var(--ss-muted)]">Your access: {workspace.role}</p>
              </div>
              {owner && (
                <button
                  type="button"
                  onClick={() =>
                    openDeletion({
                      kind: 'workspace',
                      id: workspace.id,
                      name: workspace.name,
                      url: root,
                      impact:
                        'All projects, original and derived datasets, analyses, and remediation records in this workspace will also be removed. ',
                    })
                  }
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--ss-danger)]/45 bg-[var(--ss-surface)] px-3 text-xs font-semibold text-[var(--ss-danger)] hover:bg-[var(--ss-danger-wash)]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Delete workspace</span>
                </button>
              )}
            </div>
          )}
        </section>

        {/* Team Access Control (RBAC Members UI) */}
        {workspace && owner && (
          <section
            aria-labelledby="ss-members-title"
            className="rounded-lg border border-[var(--ss-border)] bg-[var(--ss-surface)] p-5 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-[var(--ss-primary)]" />
                <div>
                  <h2 id="ss-members-title" className="text-sm font-semibold text-[var(--ss-text)]">
                    Team access & roles
                  </h2>
                  <p className="text-xs text-[var(--ss-muted)]">
                    Grant Editor (upload, profile, unmask PII, remediate) or Viewer (read-only, PII masked) access.
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={memberBusy}
                onClick={() => void loadMembers()}
                className="inline-flex h-8 items-center rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-3 text-xs font-medium text-[var(--ss-text)] hover:bg-[var(--ss-surface-hover)]"
              >
                {membersLoaded ? 'Refresh members' : 'Load members'}
              </button>
            </div>

            <form
              onSubmit={(e) => void handleAddMember(e)}
              className="flex flex-col sm:flex-row gap-2.5"
            >
              <input
                value={memberUsername}
                onChange={(e) => setMemberUsername(e.target.value)}
                placeholder="Existing username…"
                aria-label="Member username"
                required
                className="h-9 flex-1 rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-3 text-xs text-[var(--ss-text)]"
              />
              <select
                aria-label="Member role"
                value={memberRole}
                onChange={(e) => setMemberRole(e.target.value as 'editor' | 'viewer')}
                className="h-9 rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2.5 text-xs text-[var(--ss-text)]"
              >
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
              <button
                type="submit"
                disabled={memberBusy || !memberUsername.trim()}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-[var(--ss-primary)] px-4 text-xs font-semibold text-white hover:bg-[var(--ss-primary-hover)] disabled:opacity-45"
              >
                <UserPlus className="h-3.5 w-3.5" />
                <span>Add member</span>
              </button>
            </form>

            {memberError && (
              <p
                role="alert"
                className="rounded-md border border-[var(--ss-danger)]/35 bg-[var(--ss-danger-wash)] px-3 py-2 text-xs text-[var(--ss-danger)]"
              >
                {memberError}
              </p>
            )}
            {memberNotice && (
              <p
                role="status"
                className="rounded-md border border-[var(--ss-primary-border)] bg-[var(--ss-primary-wash)] px-3 py-2 text-xs text-[var(--ss-primary)]"
              >
                {memberNotice}
              </p>
            )}

            {membersLoaded && (
              <div className="divide-y divide-[var(--ss-border)] rounded-md border border-[var(--ss-border)]">
                {members.length ? (
                  members.map((m) => (
                    <div
                      key={m.user_id}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs"
                    >
                      <div className="flex items-center gap-2.5">
                        <strong className="font-mono text-[var(--ss-text)]">{m.username}</strong>
                        <span className="rounded bg-[var(--ss-surface-subtle)] px-1.5 py-0.5 font-mono text-[10px] uppercase text-[var(--ss-muted)]">
                          {m.role}
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={memberBusy}
                        onClick={() => void handleRemoveMember(m.user_id, m.username)}
                        className="font-mono text-[11px] font-medium text-[var(--ss-danger)] hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="px-4 py-3 text-xs text-[var(--ss-muted)]">
                    No additional members assigned to this workspace yet.
                  </p>
                )}
              </div>
            )}
          </section>
        )}

        {/* Project Deletion */}
        {workspace && (
          <section
            aria-labelledby="ss-project-manage-title"
            className="rounded-lg border border-[var(--ss-border)] bg-[var(--ss-surface)] p-5 space-y-4"
          >
            <h2 id="ss-project-manage-title" className="text-sm font-semibold text-[var(--ss-text)]">
              Project
            </h2>
            <div className="space-y-1">
              <label htmlFor="ss-manage-project" className="block text-xs text-[var(--ss-muted)]">
                Select project
              </label>
              <select
                id="ss-manage-project"
                value={projectId}
                onChange={(event) => chooseProject(event.target.value)}
                className="h-9 w-full max-w-md rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2.5 text-xs text-[var(--ss-text)]"
              >
                {!projects.length && <option value="">No projects</option>}
                {projects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            {project && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-4 py-3">
                <div>
                  <strong className="text-sm font-semibold text-[var(--ss-text)]">{project.name}</strong>
                  <p className="text-xs text-[var(--ss-muted)]">
                    Contains datasets and their analysis history
                  </p>
                </div>
                {owner && (
                  <button
                    type="button"
                    onClick={() =>
                      openDeletion({
                        kind: 'project',
                        id: project.id,
                        name: project.name,
                        url: `${root}/projects/${project.id}`,
                        impact:
                          'Every dataset, AI report, remediation record, and derived file in this project will also be removed. ',
                      })
                    }
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--ss-danger)]/45 bg-[var(--ss-surface)] px-3 text-xs font-semibold text-[var(--ss-danger)] hover:bg-[var(--ss-danger-wash)]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Delete project</span>
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        {/* Dataset Deletion */}
        {project && (
          <section
            aria-labelledby="ss-dataset-manage-title"
            className="rounded-lg border border-[var(--ss-border)] bg-[var(--ss-surface)] p-5 space-y-4"
          >
            <div>
              <h2 id="ss-dataset-manage-title" className="text-sm font-semibold text-[var(--ss-text)]">
                Uploaded datasets
              </h2>
              <p className="text-xs text-[var(--ss-muted)]">
                Removing a source also removes its related analysis history and derived outputs. In-progress jobs must finish first.
              </p>
            </div>
            <div className="divide-y divide-[var(--ss-border)] rounded-md border border-[var(--ss-border)]">
              {datasets.map((dataset) => (
                <div
                  key={dataset.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div>
                    <strong className="font-mono text-xs font-semibold text-[var(--ss-text)]">
                      {dataset.filename}
                    </strong>
                    <p className="font-mono text-[11px] text-[var(--ss-muted)] tabular-nums">
                      {(dataset.size_bytes / 1024).toFixed(1)} KB · {dataset.status}
                    </p>
                  </div>
                  {canManageDatasets && (
                    <button
                      type="button"
                      disabled={dataset.status === 'queued' || dataset.status === 'processing'}
                      onClick={() =>
                        openDeletion({
                          kind: 'dataset',
                          id: dataset.id,
                          name: dataset.filename,
                          url: `${datasetRoot}/${dataset.id}`,
                          impact:
                            'Its saved analyses, remediation records, and derived outputs will also be removed. ',
                        })
                      }
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--ss-danger)]/45 bg-[var(--ss-surface)] px-3 text-xs font-semibold text-[var(--ss-danger)] hover:bg-[var(--ss-danger-wash)] disabled:opacity-45"
                    >
                      Delete CSV
                    </button>
                  )}
                </div>
              ))}
              {!datasets.length && (
                <p className="px-4 py-6 text-center text-xs text-[var(--ss-muted)]">
                  No uploaded dataset files in this project.
                </p>
              )}
            </div>
          </section>
        )}

        <p className="text-[11px] text-[var(--ss-subtle)]">
          Deleting data cannot be undone. File cleanup is completed after the database deletion; interrupted cleanup can be retried by an administrator.
        </p>
      </div>

      {target && (
        <ConfirmDeletion
          key={`${target.kind}:${target.id}`}
          target={target}
          busy={busy}
          error={deleteError}
          onCancel={closeDeletion}
          onConfirm={deleteSelected}
        />
      )}
    </AppShell>
  );
}
