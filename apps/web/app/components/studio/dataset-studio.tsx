'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Columns3,
  FileSpreadsheet,
  FlaskConical,
  GitBranch,
  GitCompareArrows,
  Lock,
  Network,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Table2,
} from 'lucide-react';
import { AIRemediationPanel } from '@/app/components/ai-remediation-panel';
import { AppShell } from '@/app/components/shell/app-shell';
import { AIEvalWorkbench } from '@/app/components/studio/ai-eval-workbench';
import { ColumnInspectorDrawer } from '@/app/components/studio/column-inspector-drawer';
import { ContractsPanel } from '@/app/components/studio/contracts-panel';
import { DriftInspector } from '@/app/components/studio/drift-inspector';
import {
  InteractiveDataGrid,
  type ActiveColumnFilter,
} from '@/app/components/studio/interactive-data-grid';
import { LineageDag } from '@/app/components/studio/lineage-dag';
import { PipelineBuilder } from '@/app/components/studio/pipeline-builder';
import {
  CorrelationHeatmap,
  MiniHistogramSparkline,
  QualityDimensionBars,
  QualityScoreMeter,
} from '@/app/components/ui/charts';
import {
  request,
  seedDemoDatasets,
  type Account,
  type Dataset,
  type Project,
  type Workspace,
} from '@/lib/client-api';
import {
  cn,
  formatBytes,
  formatDateTime,
  formatNumber,
  formatPercent,
  shortDigest,
} from '@/lib/cn';
import { useDatasetEventStream } from '@/lib/use-dataset-events';
import type {
  AIReportRecord,
  DatasetProfileRecord,
  DSLStep,
  RemediationRunRecord,
} from '@/lib/types';

type ResultList<T> = T[] | { results: T[] };
type StudioTab =
  | 'overview'
  | 'grid'
  | 'columns'
  | 'findings'
  | 'pipeline'
  | 'drift'
  | 'contracts'
  | 'lineage'
  | 'analysis'
  | 'evals'
  | 'history';

const TABS: ReadonlyArray<{ id: StudioTab; label: string; Icon: typeof Activity }> = [
  { id: 'overview', label: 'Overview', Icon: Activity },
  { id: 'grid', label: 'Data grid', Icon: Table2 },
  { id: 'columns', label: 'Columns', Icon: Columns3 },
  { id: 'findings', label: 'Findings', Icon: AlertTriangle },
  { id: 'pipeline', label: 'Pipeline', Icon: SlidersHorizontal },
  { id: 'drift', label: 'Drift', Icon: GitCompareArrows },
  { id: 'contracts', label: 'Contracts', Icon: ShieldCheck },
  { id: 'lineage', label: 'Lineage', Icon: Network },
  { id: 'analysis', label: 'AI & remediation', Icon: Sparkles },
  { id: 'evals', label: 'AI evals', Icon: FlaskConical },
  { id: 'history', label: 'History', Icon: GitBranch },
];

type Details = {
  key: string;
  profile: DatasetProfileRecord | null;
  reports: AIReportRecord[];
  runs: RemediationRunRecord[];
  errors: string[];
};

function asList<T>(input: ResultList<T>): T[] {
  return Array.isArray(input) ? input : Array.isArray(input.results) ? input.results : [];
}

async function readProfile(url: string): Promise<DatasetProfileRecord | null> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (response.status === 404) return null;
  if (response.status === 401) throw new Error('Sign in to continue.');
  if (response.status === 403) throw new Error('You do not have permission to view this profile.');
  if (!response.ok) throw new Error('Could not load the saved dataset profile.');
  return (await response.json()) as DatasetProfileRecord;
}

export function DatasetStudio() {
  const router = useRouter();
  const [urlParams] = useState(() => {
    if (typeof window === 'undefined') return { ws: '', proj: '', ds: '', tab: 'overview' as StudioTab };
    const sp = new URLSearchParams(window.location.search);
    const rawTab = sp.get('tab') as StudioTab | null;
    return {
      ws: sp.get('workspace') ?? '',
      proj: sp.get('project') ?? '',
      ds: sp.get('dataset') ?? '',
      tab: rawTab && TABS.some((t) => t.id === rawTab) ? rawTab : ('overview' as StudioTab),
    };
  });
  const initialWs = urlParams.ws;
  const initialProj = urlParams.proj;
  const initialDs = urlParams.ds;
  const initialTab = urlParams.tab;

  const [account, setAccount] = useState<Account | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [datasetId, setDatasetId] = useState('');
  const [details, setDetails] = useState<Details | null>(null);

  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [profilingBusy, setProfilingBusy] = useState(false);
  const [seedingBusy, setSeedingBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [tab, setTab] = useState<StudioTab>(
    TABS.some((t) => t.id === initialTab) ? initialTab : 'overview',
  );
  const [query, setQuery] = useState('');
  const [severity, setSeverity] = useState('all');
  const [inspectedColName, setInspectedColName] = useState<string | null>(null);
  const [gridColumnFilter, setGridColumnFilter] = useState<ActiveColumnFilter>(null);
  const [draftedPipeline, setDraftedPipeline] = useState<{
    revision: number;
    steps: DSLStep[];
    note: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      request<Account>('/api/v1/auth/me'),
      request<Workspace[]>('/api/v1/workspaces'),
    ])
      .then(([user, items]) => {
        if (!active) return;
        setAccount(user);
        setWorkspaces(items);
        const preferred = items.find((w) => w.id === initialWs)?.id ?? items[0]?.id ?? '';
        setWorkspaceId(preferred);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        if (reason instanceof Error && reason.message === 'Sign in to continue.') {
          router.replace('/login');
        } else {
          setError('Unable to load your workspaces. Refresh to retry.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [router, initialWs]);

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    request<Project[]>(`/api/v1/workspaces/${workspaceId}/projects`)
      .then((items) => {
        if (!active) return;
        setProjects(items);
        const preferred = items.find((p) => p.id === initialProj)?.id ?? items[0]?.id ?? '';
        setProjectId(preferred);
      })
      .catch(() => {
        if (active) setError('Unable to load projects in this workspace.');
      });
    return () => {
      active = false;
    };
  }, [workspaceId, initialProj]);

  const reloadDatasets = useCallback(async (wId: string, pId: string, preferredId?: string) => {
    const items = await request<ResultList<Dataset>>(
      `/api/v1/workspaces/${wId}/projects/${pId}/datasets`,
    );
    const list = asList(items);
    setDatasets(list);
    setDatasetId((prev) => {
      const target = preferredId || prev;
      if (target && list.some((d) => d.id === target)) return target;
      return list[0]?.id ?? '';
    });
  }, []);

  useEffect(() => {
    if (!workspaceId || !projectId) return;
    let active = true;
    request<ResultList<Dataset>>(
      `/api/v1/workspaces/${workspaceId}/projects/${projectId}/datasets`,
    )
      .then((items) => {
        if (!active) return;
        const list = asList(items);
        setDatasets(list);
        const preferred = list.find((d) => d.id === initialDs)?.id ?? list[0]?.id ?? '';
        setDatasetId(preferred);
      })
      .catch(() => {
        if (active) setError('Unable to load datasets in this project.');
      });
    return () => {
      active = false;
    };
  }, [workspaceId, projectId, initialDs]);

  const key = `${workspaceId}:${projectId}:${datasetId}`;

  const loadDetails = useCallback(async () => {
    if (!workspaceId || !projectId || !datasetId) return;
    const root = `/api/v1/workspaces/${workspaceId}/projects/${projectId}/datasets/${datasetId}`;
    const [profileRes, reportsRes, runsRes] = await Promise.allSettled([
      readProfile(`${root}/profile`),
      request<ResultList<AIReportRecord>>(`${root}/ai-reports`),
      request<ResultList<RemediationRunRecord>>(`${root}/remediations`),
    ]);
    const issues: string[] = [];
    if (profileRes.status === 'rejected') issues.push('Dataset profile could not be loaded.');
    if (reportsRes.status === 'rejected') issues.push('Saved AI analyses could not be loaded.');
    if (runsRes.status === 'rejected') issues.push('Remediation history could not be loaded.');
    setDetails({
      key,
      profile: profileRes.status === 'fulfilled' ? profileRes.value : null,
      reports: reportsRes.status === 'fulfilled' ? asList(reportsRes.value) : [],
      runs: runsRes.status === 'fulfilled' ? asList(runsRes.value) : [],
      errors: issues,
    });
    setDetailsLoading(false);
  }, [workspaceId, projectId, datasetId, key]);

  useEffect(() => {
    if (!workspaceId || !projectId || !datasetId) return;
    let active = true;
    const root = `/api/v1/workspaces/${workspaceId}/projects/${projectId}/datasets/${datasetId}`;
    Promise.allSettled([
      readProfile(`${root}/profile`),
      request<ResultList<AIReportRecord>>(`${root}/ai-reports`),
      request<ResultList<RemediationRunRecord>>(`${root}/remediations`),
    ]).then(([profileRes, reportsRes, runsRes]) => {
      if (!active) return;
      const issues: string[] = [];
      if (profileRes.status === 'rejected') issues.push('Dataset profile could not be loaded.');
      if (reportsRes.status === 'rejected') issues.push('Saved AI analyses could not be loaded.');
      if (runsRes.status === 'rejected') issues.push('Remediation history could not be loaded.');
      setDetails({
        key,
        profile: profileRes.status === 'fulfilled' ? profileRes.value : null,
        reports: reportsRes.status === 'fulfilled' ? asList(reportsRes.value) : [],
        runs: runsRes.status === 'fulfilled' ? asList(runsRes.value) : [],
        errors: issues,
      });
      setDetailsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [workspaceId, projectId, datasetId, key]);

  const loaded = details?.key === key ? details : null;
  const profilePending =
    loaded?.profile?.status === 'queued' || loaded?.profile?.status === 'processing';
  const datasetPending =
    datasets.find((d) => d.id === datasetId)?.status === 'queued' ||
    datasets.find((d) => d.id === datasetId)?.status === 'processing';
  const sseEnabled = Boolean(workspaceId && projectId && datasetId && (profilePending || datasetPending));
  const sseUrl =
    workspaceId && projectId && datasetId
      ? `/api/v1/workspaces/${workspaceId}/projects/${projectId}/datasets/${datasetId}/events`
      : null;

  const { connected: sseConnected } = useDatasetEventStream({
    url: sseUrl,
    enabled: sseEnabled,
    onUpdate: (ev) => {
      if (!ev.pending || ev.profile_status === 'ready' || ev.profile_status === 'failed') {
        void loadDetails();
        if (workspaceId && projectId) {
          void reloadDatasets(workspaceId, projectId, datasetId);
        }
      }
    },
  });

  const workspace = workspaces.find((item) => item.id === workspaceId);
  const project = projects.find((item) => item.id === projectId);
  const dataset = datasets.find((item) => item.id === datasetId);
  const canEdit = workspace?.role === 'owner' || workspace?.role === 'editor';
  const profile = loaded?.profile?.status === 'ready' ? loaded.profile.result : undefined;
  const quality = profile?.quality;

  const filteredColumns = useMemo(
    () =>
      (profile?.columns ?? []).filter((item) =>
        `${item.name} ${item.inferred_type} ${item.semantic_type ?? ''}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [profile?.columns, query],
  );

  const filteredFindings = useMemo(
    () =>
      (quality?.findings ?? [])
        .filter((item) => severity === 'all' || item.severity === severity)
        .filter((item) =>
          `${item.code} ${item.column ?? ''} ${item.message} ${item.dimension ?? ''}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        ),
    [quality?.findings, severity, query],
  );

  const inspectedColumn = useMemo(
    () => profile?.columns.find((c) => c.name === inspectedColName) ?? null,
    [profile?.columns, inspectedColName],
  );

  const history = useMemo(
    () =>
      [
        ...(dataset?.created_at
          ? [{ id: `dataset:${dataset.id}`, label: 'Dataset admitted', detail: `${dataset.filename} (${shortDigest(dataset.sha256)})`, date: dataset.created_at }]
          : []),
        ...(loaded?.profile?.completed_at
          ? [{ id: 'profile', label: 'Profile completed', detail: profile?.engine ?? 'deterministic profiler', date: loaded.profile.completed_at }]
          : []),
        ...(loaded?.reports ?? []).map((r) => ({
          id: `report:${r.id}`,
          label: `AI analysis · ${r.technique.replaceAll('_', ' ')}`,
          detail: `${r.model ?? 'Gemini'} · ${r.status}`,
          date: r.created_at,
        })),
        ...(loaded?.runs ?? []).map((r) => ({
          id: `run:${r.id}`,
          label: `Remediation · ${r.status}`,
          detail: (r.operations ?? []).join(', ').replaceAll('_', ' '),
          date: r.applied_at || r.created_at,
        })),
      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [dataset, loaded, profile?.engine],
  );

  async function runProfile(force = false) {
    if (!workspaceId || !projectId || !datasetId || !canEdit) return;
    setProfilingBusy(true);
    setError('');
    setNotice('');
    try {
      const root = `/api/v1/workspaces/${workspaceId}/projects/${projectId}/datasets/${datasetId}`;
      const res = await request<DatasetProfileRecord>(
        `${root}/profile${force ? '?force=true' : ''}`,
        'POST',
      );
      setDetails((prev) =>
        prev
          ? { ...prev, profile: res }
          : { key, profile: res, reports: [], runs: [], errors: [] },
      );
      setNotice(
        res.status === 'ready'
          ? 'Profile is up to date.'
          : 'Profiling queued. Results will appear automatically.',
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to start profiling.');
    } finally {
      setProfilingBusy(false);
    }
  }

  async function handleSeedDemo() {
    if (!workspaceId || !projectId || !canEdit) return;
    setSeedingBusy(true);
    setError('');
    setNotice('');
    try {
      const created = await seedDemoDatasets(workspaceId, projectId);
      await reloadDatasets(workspaceId, projectId, created[0]?.id);
      setNotice(`Seeded ${created.length} pre-profiled multi-format demo datasets.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to seed demo datasets.');
    } finally {
      setSeedingBusy(false);
    }
  }

  function jumpToGridFilter(columnName: string, filterOp: string) {
    setInspectedColName(null);
    setGridColumnFilter({
      column: columnName,
      op: filterOp,
      label: `${columnName}: ${filterOp.replaceAll('_', ' ')}`,
    });
    setTab('grid');
  }

  async function signOut() {
    try {
      await request<void>('/api/v1/auth/logout', 'POST');
      router.replace('/login');
    } catch {
      setError('Could not sign out. Please retry.');
    }
  }

  const quickJumps = useMemo(
    () => [
      ...datasets.map((d) => ({
        id: `ds-${d.id}`,
        label: d.filename,
        group: 'Datasets',
        meta: (d.file_format ?? 'csv').toUpperCase(),
        onSelect: () => {
          setDatasetId(d.id);
          setDetails(null);
          setDetailsLoading(true);
          setGridColumnFilter(null);
        },
      })),
      ...TABS.map((t) => ({
        id: `tab-${t.id}`,
        label: `Switch tab: ${t.label}`,
        group: 'Studio',
        onSelect: () => setTab(t.id),
      })),
    ],
    [datasets],
  );

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--ss-canvas)] font-mono text-xs text-[var(--ss-muted)]" role="status">
        Loading data workbench…
      </main>
    );
  }

  return (
    <AppShell
      current="workbench"
      breadcrumb={[
        { label: 'Workspaces', href: '/workspaces' },
        ...(workspace ? [{ label: workspace.name, href: '/workspaces' }] : []),
        { label: dataset?.filename ?? 'Data workbench' },
      ]}
      account={account}
      onSignOut={() => void signOut()}
      quickJumps={quickJumps}
      sidebarExtra={
        workspace ? (
          <div className="rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-3 space-y-1">
            <span className="block font-mono text-[10px] tracking-[0.12em] uppercase text-[var(--ss-subtle)]">
              ACTIVE CONTEXT
            </span>
            <p className="truncate text-xs font-semibold text-[var(--ss-text)]">{workspace.name}</p>
            <p className="truncate text-[11px] text-[var(--ss-muted)]">
              {project?.name ?? 'No project'}
            </p>
          </div>
        ) : null
      }
      topbarActions={
        <Link
          href="/workspaces"
          className="inline-flex items-center gap-1 rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--ss-text)] hover:bg-[var(--ss-surface-hover)] no-underline"
        >
          <span>Workspaces</span>
          <ArrowUpRight className="h-3.5 w-3.5 text-[var(--ss-muted)]" />
        </Link>
      }
    >
      <div className="space-y-6">
        {/* Studio Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ss-primary)]">
              DATA INTELLIGENCE · STUDIO WORKBENCH
            </p>
            <h1 className="mt-1 text-2xl sm:text-[28px] font-semibold tracking-[-0.03em] text-[var(--ss-text)]">
              Know your data.
            </h1>
            <p className="mt-1 text-sm text-[var(--ss-muted)]">
              Inspect rows via DuckDB, audit statistical distributions and PII risk, and run evidence-grounded remediation.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canEdit && projectId && (
              <button
                type="button"
                onClick={() => void handleSeedDemo()}
                disabled={seedingBusy}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] px-3 text-xs font-medium text-[var(--ss-text)] hover:bg-[var(--ss-surface-hover)] disabled:opacity-50"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-[var(--ss-primary)]" />
                <span>{seedingBusy ? 'Seeding demo…' : 'Load sample datasets'}</span>
              </button>
            )}
            {canEdit && dataset?.status === 'ready' && (
              <button
                type="button"
                onClick={() => void runProfile(Boolean(profile))}
                disabled={profilingBusy || profilePending}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--ss-primary)] px-3.5 text-xs font-semibold text-white hover:bg-[var(--ss-primary-hover)] disabled:opacity-50"
              >
                {profile ? (
                  <RefreshCw className={cn('h-3.5 w-3.5', (profilingBusy || profilePending) && 'animate-spin')} />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                <span>
                  {profilePending
                    ? 'Profiling…'
                    : profile
                      ? 'Re-run profile'
                      : 'Run profiler'}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Context Selector Bar */}
        <section
          aria-label="Dataset selection"
          className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-lg border border-[var(--ss-border)] bg-[var(--ss-surface)] p-3.5"
        >
          <div className="space-y-1">
            <label
              htmlFor="ss-wb-workspace"
              className="block font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--ss-subtle)]"
            >
              Workspace
            </label>
            <select
              id="ss-wb-workspace"
              value={workspaceId}
              onChange={(e) => {
                setWorkspaceId(e.target.value);
                setProjects([]);
                setProjectId('');
                setDatasets([]);
                setDatasetId('');
                setDetails(null);
                setGridColumnFilter(null);
              }}
              className="h-9 w-full rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2.5 text-xs font-medium text-[var(--ss-text)]"
            >
              {!workspaces.length && <option value="">No workspaces</option>}
              {workspaces.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="ss-wb-project"
              className="block font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--ss-subtle)]"
            >
              Project
            </label>
            <select
              id="ss-wb-project"
              value={projectId}
              disabled={!workspaceId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setDatasets([]);
                setDatasetId('');
                setDetails(null);
                setGridColumnFilter(null);
              }}
              className="h-9 w-full rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2.5 text-xs font-medium text-[var(--ss-text)] disabled:opacity-50"
            >
              {!projects.length && <option value="">No projects</option>}
              {projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="ss-wb-dataset"
              className="block font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--ss-subtle)]"
            >
              Dataset
            </label>
            <select
              id="ss-wb-dataset"
              value={datasetId}
              disabled={!projectId}
              onChange={(e) => {
                setDatasetId(e.target.value);
                setDetails(null);
                setDetailsLoading(Boolean(e.target.value));
                setGridColumnFilter(null);
                setInspectedColName(null);
              }}
              className="h-9 w-full rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2.5 font-mono text-xs text-[var(--ss-text)] disabled:opacity-50"
            >
              {!datasets.length && <option value="">No datasets</option>}
              {datasets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.filename}
                </option>
              ))}
            </select>
          </div>
        </section>

        {error && (
          <div
            role="alert"
            className="rounded-md border border-[var(--ss-danger)]/35 bg-[var(--ss-danger-wash)] px-4 py-2.5 text-xs text-[var(--ss-danger)]"
          >
            {error}
          </div>
        )}
        {notice && (
          <div
            role="status"
            className="rounded-md border border-[var(--ss-primary-border)] bg-[var(--ss-primary-wash)] px-4 py-2.5 text-xs text-[var(--ss-primary)]"
          >
            {notice}
          </div>
        )}

        {!dataset ? (
          <section className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[var(--ss-border-strong)] bg-[var(--ss-surface)] px-6 py-16 text-center">
            <div className="grid h-11 w-11 place-items-center rounded-lg border border-[var(--ss-border)] bg-[var(--ss-canvas)] text-[var(--ss-primary)]">
              <Table2 className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-base font-semibold text-[var(--ss-text)]">
              No dataset selected
            </h2>
            <p className="mt-1 max-w-md text-xs text-[var(--ss-muted)]">
              Upload a CSV, TSV, Parquet, Excel, or JSON dataset from your workspace — or load our realistic sample bundle right here.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
              {canEdit && projectId && (
                <button
                  type="button"
                  onClick={() => void handleSeedDemo()}
                  disabled={seedingBusy}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--ss-primary)] px-4 text-xs font-semibold text-white hover:bg-[var(--ss-primary-hover)]"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  {seedingBusy ? 'Seeding…' : 'Load 3 sample datasets'}
                </button>
              )}
              <Link
                href="/workspaces"
                className="inline-flex h-9 items-center rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] px-4 text-xs font-medium text-[var(--ss-text)] no-underline hover:bg-[var(--ss-surface-hover)]"
              >
                Go to your workspaces
              </Link>
            </div>
          </section>
        ) : (
          <>
            {/* Active Dataset Spec Line */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--ss-border)] bg-[var(--ss-surface)] px-4 py-3">
              <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                <span className="rounded border border-[var(--ss-primary-border)] bg-[var(--ss-primary-wash)] px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-[var(--ss-primary)]">
                  {(dataset.file_format ?? 'csv').toUpperCase()}
                </span>
                <strong className="truncate font-mono text-sm font-semibold text-[var(--ss-text)]">
                  {dataset.filename}
                </strong>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase',
                    dataset.status === 'ready'
                      ? 'bg-[var(--ss-pass-wash)] text-[var(--ss-pass)]'
                      : dataset.status === 'failed'
                        ? 'bg-[var(--ss-danger-wash)] text-[var(--ss-danger)]'
                        : 'bg-[var(--ss-warn-wash)] text-[var(--ss-warn)]',
                  )}
                >
                  {dataset.status}
                </span>
                {sseConnected && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full border border-[var(--ss-primary-border)] bg-[var(--ss-primary-wash)] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-[var(--ss-primary)]"
                    title="Real-time Server-Sent Events stream active"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                    LIVE SSE
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-4 font-mono text-[11px] text-[var(--ss-muted)] tabular-nums">
                <span>{formatBytes(dataset.size_bytes)}</span>
                {dataset.sha256 && <span title={dataset.sha256}>sha256:{shortDigest(dataset.sha256)}</span>}
                {profile?.engine && <span className="text-[var(--ss-subtle)]">{profile.engine}</span>}
              </div>
            </div>

            {detailsLoading && !loaded && (
              <p className="font-mono text-xs text-[var(--ss-muted)]" role="status">
                Loading saved dataset analysis…
              </p>
            )}
            {loaded?.errors.map((message) => (
              <p
                key={message}
                className="rounded-md border border-[var(--ss-warn)]/35 bg-[var(--ss-warn-wash)] px-3.5 py-2 text-xs text-[var(--ss-warn)]"
                role="status"
              >
                {message}
              </p>
            ))}

            {/* 4-Card KPI Strip */}
            <section
              aria-label="Dataset metrics"
              className="grid grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[var(--ss-border)] overflow-hidden rounded-lg border border-[var(--ss-border)] bg-[var(--ss-surface)]"
            >
              <div className="p-4">
                <span className="block font-mono text-[10px] uppercase tracking-wider text-[var(--ss-subtle)]">
                  Rows
                </span>
                <strong className="mt-1.5 block font-mono text-2xl font-semibold tracking-tight tabular-nums text-[var(--ss-text)]">
                  {formatNumber(profile?.row_count ?? dataset.row_count)}
                </strong>
                <small className="mt-1 block text-[11px] text-[var(--ss-muted)]">
                  Immutable source rows
                </small>
              </div>
              <div className="p-4">
                <span className="block font-mono text-[10px] uppercase tracking-wider text-[var(--ss-subtle)]">
                  Columns
                </span>
                <strong className="mt-1.5 block font-mono text-2xl font-semibold tracking-tight tabular-nums text-[var(--ss-text)]">
                  {formatNumber(profile?.column_count ?? dataset.column_count)}
                </strong>
                <small className="mt-1 block text-[11px] text-[var(--ss-muted)]">
                  Inferred schema fields
                </small>
              </div>
              <div className="p-4">
                <span className="block font-mono text-[10px] uppercase tracking-wider text-[var(--ss-subtle)]">
                  Completeness
                </span>
                <strong className="mt-1.5 block font-mono text-2xl font-semibold tracking-tight tabular-nums text-[var(--ss-text)]">
                  {formatPercent(quality?.completeness_percent)}
                </strong>
                <small className="mt-1 block text-[11px] text-[var(--ss-muted)]">
                  {profile ? `${formatNumber(profile.missing_cells)} missing cells` : 'From saved profile'}
                </small>
              </div>
              <div className="p-4">
                <span className="block font-mono text-[10px] uppercase tracking-wider text-[var(--ss-subtle)]">
                  Exact duplicates
                </span>
                <strong className="mt-1.5 block font-mono text-2xl font-semibold tracking-tight tabular-nums text-[var(--ss-text)]">
                  {formatNumber(quality?.duplicate_rows ?? profile?.duplicate_rows)}
                </strong>
                <small className="mt-1 block text-[11px] text-[var(--ss-muted)]">
                  {profile?.pii_summary?.flagged_columns
                    ? `${profile.pii_summary.flagged_columns} PII column(s) flagged`
                    : 'Zero PII columns flagged'}
                </small>
              </div>
            </section>

            {/* Studio Tabbed Surface */}
            <section
              aria-label="Dataset workbench"
              className="overflow-hidden rounded-lg border border-[var(--ss-border)] bg-[var(--ss-surface)]"
            >
              <div
                role="tablist"
                aria-label="Dataset sections"
                className="flex items-center gap-1 overflow-x-auto border-b border-[var(--ss-border)] px-4"
              >
                {TABS.map(({ id, label, Icon }) => {
                  const selected = tab === id;
                  const count =
                    id === 'findings'
                      ? quality?.findings.length
                      : id === 'columns'
                        ? profile?.columns.length
                        : undefined;
                  return (
                    <button
                      key={id}
                      id={`ss-tab-${id}`}
                      type="button"
                      role="tab"
                      aria-controls={`ss-panel-${id}`}
                      aria-selected={selected}
                      onClick={() => {
                        setTab(id);
                        setQuery('');
                      }}
                      className={cn(
                        'relative inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-3.5 text-xs font-medium transition-colors',
                        selected
                          ? 'text-[var(--ss-primary)] font-semibold'
                          : 'text-[var(--ss-muted)] hover:text-[var(--ss-text)]',
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
                      <span>{label}</span>
                      {typeof count === 'number' && (
                        <span
                          aria-hidden={id === 'columns' ? true : undefined}
                          className="rounded bg-[var(--ss-surface-subtle)] px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-[var(--ss-muted)]"
                        >
                          {count}
                        </span>
                      )}
                      {selected && (
                        <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-[var(--ss-primary)]" />
                      )}
                    </button>
                  );
                })}
              </div>

              <div
                id={`ss-panel-${tab}`}
                role="tabpanel"
                aria-labelledby={`ss-tab-${tab}`}
                className="p-5 lg:p-6"
              >
                {/* TAB 1: OVERVIEW */}
                {tab === 'overview' && (
                  <div className="space-y-6">
                    {profile ? (
                      <>
                        {/* PII Alert Callout */}
                        {(profile.pii_summary?.flagged_columns ?? 0) > 0 && (
                          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--ss-pii)]/30 bg-[var(--ss-pii-wash)] px-4 py-3">
                            <div className="flex items-start gap-2.5">
                              <Lock className="h-4 w-4 shrink-0 text-[var(--ss-pii)] mt-0.5" />
                              <div className="text-xs">
                                <strong className="text-[var(--ss-text)]">
                                  Privacy Guard Active · {profile.pii_summary?.flagged_columns} sensitive column(s) detected
                                </strong>
                                <p className="mt-0.5 text-[var(--ss-muted)]">
                                  Types: {(profile.pii_summary?.kinds ?? []).join(', ').replaceAll('_', ' ')} ({formatNumber(profile.pii_summary?.total_matches)} cells). Masked by default in Data Grid and stripped from Gemini egress.
                                </p>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => setTab('grid')}
                              className="inline-flex items-center gap-1 rounded-md border border-[var(--ss-pii)]/35 bg-[var(--ss-surface)] px-2.5 py-1.5 font-mono text-[11px] font-medium text-[var(--ss-pii)] hover:opacity-90"
                            >
                              Open masked Grid
                              <ArrowUpRight className="h-3 w-3" />
                            </button>
                          </div>
                        )}

                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                          {/* Left: Composite Score & 5 Transparent Dimensions */}
                          <div className="lg:col-span-7 rounded-lg border border-[var(--ss-border)] bg-[var(--ss-canvas)]/60 p-5 space-y-5">
                            <div className="flex items-center justify-between gap-4">
                              <div>
                                <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--ss-subtle)]">
                                  TRANSPARENT QUALITY INDEX
                                </span>
                                <h2 className="mt-0.5 text-base font-semibold text-[var(--ss-text)]">
                                  5-Dimension Quality Breakdown
                                </h2>
                                <p className="mt-0.5 text-xs text-[var(--ss-muted)]">
                                  Deterministic weighted score; never replaces issue-level review.
                                </p>
                              </div>
                              <QualityScoreMeter score={quality?.overall_score ?? quality?.completeness_percent} />
                            </div>

                            {quality?.dimensions ? (
                              <QualityDimensionBars dimensions={quality.dimensions} />
                            ) : (
                              <div className="space-y-2">
                                <div className="flex justify-between text-xs">
                                  <span>Observed completeness</span>
                                  <strong className="font-mono">{formatPercent(quality?.completeness_percent)}</strong>
                                </div>
                                <div className="h-2 rounded-full bg-[var(--ss-surface-subtle)] overflow-hidden">
                                  <div
                                    className="h-full bg-[var(--ss-primary)]"
                                    style={{ width: `${Math.max(0, Math.min(100, quality?.completeness_percent ?? 0))}%` }}
                                  />
                                </div>
                                <p className="text-xs text-[var(--ss-muted)]">
                                  Click <strong>Re-run profile</strong> above to compute v2 distributions, PII scanning, and 5-dimension scores.
                                </p>
                              </div>
                            )}
                          </div>

                          {/* Right: Correlations + Quick Findings Summary */}
                          <div className="lg:col-span-5 flex flex-col gap-5">
                            <div className="rounded-lg border border-[var(--ss-border)] bg-[var(--ss-canvas)]/60 p-5 space-y-3">
                              <div>
                                <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--ss-subtle)]">
                                  NUMERIC RELATIONSHIPS
                                </span>
                                <h3 className="mt-0.5 text-sm font-semibold text-[var(--ss-text)]">
                                  Pearson Correlations
                                </h3>
                              </div>
                              <CorrelationHeatmap pairs={profile.correlations ?? []} />
                            </div>

                            <div className="rounded-lg border border-[var(--ss-border)] bg-[var(--ss-canvas)]/60 p-5">
                              <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--ss-subtle)]">
                                ACTIVITY SUMMARY
                              </span>
                              <div className="mt-3 grid grid-cols-3 gap-2">
                                <div className="rounded border border-[var(--ss-border)] bg-[var(--ss-surface)] p-2.5">
                                  <span className="block font-mono text-[10px] text-[var(--ss-subtle)]">FINDINGS</span>
                                  <strong className="mt-0.5 block font-mono text-lg tabular-nums">
                                    {formatNumber(quality?.findings.length ?? 0)}
                                  </strong>
                                </div>
                                <div className="rounded border border-[var(--ss-border)] bg-[var(--ss-surface)] p-2.5">
                                  <span className="block font-mono text-[10px] text-[var(--ss-subtle)]">AI RUNS</span>
                                  <strong className="mt-0.5 block font-mono text-lg tabular-nums">
                                    {formatNumber(loaded?.reports.length ?? 0)}
                                  </strong>
                                </div>
                                <div className="rounded border border-[var(--ss-border)] bg-[var(--ss-surface)] p-2.5">
                                  <span className="block font-mono text-[10px] text-[var(--ss-subtle)]">REMED.</span>
                                  <strong className="mt-0.5 block font-mono text-lg tabular-nums">
                                    {formatNumber(loaded?.runs.length ?? 0)}
                                  </strong>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="rounded-lg border border-dashed border-[var(--ss-border-strong)] p-8 text-center space-y-3">
                        <h3 className="text-sm font-semibold text-[var(--ss-text)]">
                          Profile not available
                        </h3>
                        <p className="text-xs text-[var(--ss-muted)]">
                          {profilePending
                            ? 'Profiling is currently running in the background. This panel updates automatically.'
                            : 'Run the deterministic Polars/DuckDB profiler to inspect distributions, PII risks, and quality dimensions.'}
                        </p>
                        {canEdit && !profilePending && dataset.status === 'ready' && (
                          <button
                            type="button"
                            onClick={() => void runProfile(false)}
                            disabled={profilingBusy}
                            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--ss-primary)] px-4 text-xs font-semibold text-white hover:bg-[var(--ss-primary-hover)]"
                          >
                            <Play className="h-3.5 w-3.5" />
                            Run profiler now
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 2: INTERACTIVE DATA GRID */}
                {tab === 'grid' && (
                  dataset.status === 'ready' ? (
                    <InteractiveDataGrid
                      key={`${workspaceId}:${projectId}:${dataset.id}`}
                      workspaceId={workspaceId}
                      projectId={projectId}
                      datasetId={dataset.id}
                      profileColumns={profile?.columns}
                      externalFilter={gridColumnFilter}
                      onClearExternalFilter={() => setGridColumnFilter(null)}
                      onInspectColumn={(col) => setInspectedColName(col)}
                    />
                  ) : (
                    <p className="py-10 text-center text-xs text-[var(--ss-muted)]">
                      Dataset must reach READY status before rows can be queried.
                    </p>
                  )
                )}

                {/* TAB 3: COLUMNS EXPLORER */}
                {tab === 'columns' && (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="text-sm font-semibold text-[var(--ss-text)]">
                          Column explorer
                        </h2>
                        <p className="text-xs text-[var(--ss-muted)]">
                          Click any column row to open the full quantile, histogram, and pattern-shape drawer.
                        </p>
                      </div>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ss-subtle)]" />
                        <input
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="Find a column…"
                          aria-label="Search columns"
                          className="h-8 w-56 rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] pl-8 pr-3 text-xs"
                        />
                      </div>
                    </div>

                    {filteredColumns.length ? (
                      <div className="overflow-x-auto rounded-lg border border-[var(--ss-border)]">
                        <table className="w-full border-collapse text-left text-xs">
                          <thead className="border-b border-[var(--ss-border)] bg-[var(--ss-surface-subtle)] font-mono text-[10px] uppercase tracking-wider text-[var(--ss-muted)]">
                            <tr>
                              <th scope="col" className="px-3.5 py-2.5">Column</th>
                              <th scope="col" className="px-3.5 py-2.5">Type / Domain</th>
                              <th scope="col" className="px-3.5 py-2.5">Missing</th>
                              <th scope="col" className="px-3.5 py-2.5">Distinct</th>
                              <th scope="col" className="px-3.5 py-2.5">Distribution</th>
                              <th scope="col" className="px-3.5 py-2.5">Signals</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--ss-border)]">
                            {filteredColumns.map((col) => {
                              const signals: string[] = [];
                              if ((col.pii_signals?.length ?? 0) > 0) signals.push('PII');
                              if ((col.distribution?.outlier_count_iqr ?? 0) > 0)
                                signals.push(`${col.distribution?.outlier_count_iqr} outliers`);
                              if ((col.text_stats?.whitespace_padding_count ?? 0) > 0)
                                signals.push(`${col.text_stats?.whitespace_padding_count} ws`);
                              if ((col.text_stats?.sentinel_null_count ?? 0) > 0)
                                signals.push(`${col.text_stats?.sentinel_null_count} sentinel`);

                              return (
                                <tr
                                  key={col.name}
                                  onClick={() => setInspectedColName(col.name)}
                                  className="cursor-pointer hover:bg-[var(--ss-surface-hover)] transition-colors"
                                >
                                  <td className="px-3.5 py-3 font-mono font-semibold text-[var(--ss-text)]">
                                    {col.name}
                                  </td>
                                  <td className="px-3.5 py-3">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span className="rounded border border-[var(--ss-border)] bg-[var(--ss-surface-subtle)] px-1.5 py-0.5 font-mono text-[10px]">
                                        {col.inferred_type}
                                      </span>
                                      {col.semantic_type && col.semantic_type !== col.inferred_type && (
                                        <span className="font-mono text-[10px] text-[var(--ss-muted)]">
                                          {col.semantic_type.replaceAll('_', ' ')}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-3.5 py-3 font-mono tabular-nums">
                                    {formatNumber(col.missing_count)}{' '}
                                    <span className="text-[var(--ss-subtle)]">
                                      ({formatPercent(col.missing_percent)})
                                    </span>
                                  </td>
                                  <td className="px-3.5 py-3 font-mono tabular-nums">
                                    {col.distinct_count !== null ? formatNumber(col.distinct_count) : '>2,048'}
                                  </td>
                                  <td className="px-3.5 py-3">
                                    {col.distribution?.histogram?.length ? (
                                      <MiniHistogramSparkline bins={col.distribution.histogram} width={84} height={20} />
                                    ) : col.numeric ? (
                                      <span className="font-mono text-[11px] tabular-nums text-[var(--ss-muted)]">
                                        {col.numeric.min} – {col.numeric.max}
                                      </span>
                                    ) : (
                                      <span className="text-[var(--ss-subtle)]">—</span>
                                    )}
                                  </td>
                                  <td className="px-3.5 py-3">
                                    <div className="flex flex-wrap gap-1">
                                      {signals.length ? (
                                        signals.map((sig) => (
                                          <span
                                            key={sig}
                                            className={cn(
                                              'rounded px-1.5 py-0.5 font-mono text-[10px] font-medium',
                                              sig === 'PII'
                                                ? 'bg-[var(--ss-pii-wash)] text-[var(--ss-pii)]'
                                                : 'bg-[var(--ss-warn-wash)] text-[var(--ss-warn)]',
                                            )}
                                          >
                                            {sig}
                                          </span>
                                        ))
                                      ) : (
                                        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-[var(--ss-pass)]">
                                          <CheckCircle2 className="h-3 w-3" />
                                          Clean
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="py-10 text-center text-xs text-[var(--ss-muted)]">
                        {profile ? 'No matching columns.' : 'No saved column profile yet.'}
                      </p>
                    )}
                  </div>
                )}

                {/* TAB 4: FINDINGS */}
                {tab === 'findings' && (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="text-sm font-semibold text-[var(--ss-text)]">
                          Quality findings
                        </h2>
                        <p className="text-xs text-[var(--ss-muted)]">
                          Deterministic observations with direct drill-down into affected Data Grid rows.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          aria-label="Filter by severity"
                          value={severity}
                          onChange={(e) => setSeverity(e.target.value)}
                          className="h-8 rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2.5 text-xs"
                        >
                          <option value="all">All severity</option>
                          <option value="high">High</option>
                          <option value="warning">Warning</option>
                          <option value="info">Info</option>
                        </select>
                        <input
                          aria-label="Search findings"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="Search findings…"
                          className="h-8 w-48 rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2.5 text-xs"
                        />
                      </div>
                    </div>

                    {filteredFindings.length ? (
                      <ul className="divide-y divide-[var(--ss-border)] rounded-lg border border-[var(--ss-border)]">
                        {filteredFindings.map((finding, idx) => {
                          const opMap: Record<string, string> = {
                            empty_column: 'is_null',
                            high_missingness: 'is_null',
                            some_missingness: 'is_null',
                            whitespace_padding: 'has_whitespace',
                            sentinel_nulls: 'is_sentinel_null',
                            numeric_outliers: 'is_outlier',
                          };
                          const jumpOp = finding.column ? opMap[finding.code] : undefined;

                          return (
                            <li
                              key={`${finding.code}:${finding.column}:${idx}`}
                              className="flex flex-wrap items-start justify-between gap-4 p-4"
                            >
                              <div className="flex items-start gap-3 min-w-0">
                                <span
                                  className={cn(
                                    'mt-0.5 inline-block w-16 shrink-0 rounded py-0.5 text-center font-mono text-[10px] font-semibold uppercase',
                                    finding.severity === 'high'
                                      ? 'bg-[var(--ss-danger-wash)] text-[var(--ss-danger)]'
                                      : finding.severity === 'warning'
                                        ? 'bg-[var(--ss-warn-wash)] text-[var(--ss-warn)]'
                                        : 'bg-[var(--ss-surface-subtle)] text-[var(--ss-muted)]',
                                  )}
                                >
                                  {finding.severity}
                                </span>
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <strong className="font-mono text-xs font-semibold text-[var(--ss-text)]">
                                      {finding.column || finding.code.replaceAll('_', ' ')}
                                    </strong>
                                    <code className="text-[10px] text-[var(--ss-subtle)]">
                                      {finding.code}
                                    </code>
                                    {finding.dimension && (
                                      <span className="rounded border border-[var(--ss-border)] px-1.5 py-px font-mono text-[9px] uppercase text-[var(--ss-muted)]">
                                        {finding.dimension.replaceAll('_', ' ')}
                                      </span>
                                    )}
                                  </div>
                                  <p className="mt-1 text-xs leading-relaxed text-[var(--ss-muted)]">
                                    {finding.message}
                                  </p>
                                </div>
                              </div>

                              {jumpOp && finding.column && (
                                <button
                                  type="button"
                                  onClick={() => jumpToGridFilter(finding.column!, jumpOp)}
                                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2.5 py-1.5 font-mono text-[11px] font-medium text-[var(--ss-text)] hover:border-[var(--ss-primary)] hover:text-[var(--ss-primary)]"
                                >
                                  Inspect rows
                                  <ArrowUpRight className="h-3 w-3" />
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="py-10 text-center text-xs text-[var(--ss-muted)]">
                        {quality ? 'No findings match this filter.' : 'No saved quality findings yet.'}
                      </p>
                    )}
                  </div>
                )}

                {/* TAB 5: VISUAL TRANSFORMATION PIPELINE */}
                {tab === 'pipeline' && (
                  dataset.status === 'ready' ? (
                    <PipelineBuilder
                      key={`${workspaceId}:${projectId}:${dataset.id}:${draftedPipeline?.revision ?? 0}`}
                      workspaceId={workspaceId}
                      projectId={projectId}
                      datasetId={dataset.id}
                      columns={profile?.columns.map((c) => c.name) ?? dataset.columns ?? []}
                      canEdit={canEdit}
                      initialSteps={draftedPipeline?.steps}
                      draftNotice={draftedPipeline?.note}
                      onDatasetDerived={(derivedId) => {
                        setDraftedPipeline(null);
                        void reloadDatasets(workspaceId, projectId, derivedId).then(() => {
                          setDatasetId(derivedId);
                          setDetails(null);
                          setDetailsLoading(true);
                          setTab('overview');
                        });
                      }}
                    />
                  ) : (
                    <p className="py-10 text-center text-xs text-[var(--ss-muted)]">
                      Dataset must reach READY status before building transformation pipelines.
                    </p>
                  )
                )}

                {/* TAB: ML DRIFT DETECTION */}
                {tab === 'drift' && (
                  <DriftInspector
                    workspaceId={workspaceId}
                    projectId={projectId}
                    datasets={datasets}
                    activeDatasetId={dataset.id}
                  />
                )}

                {/* TAB: DECLARATIVE DATA CONTRACTS */}
                {tab === 'contracts' && (
                  <ContractsPanel
                    key={`${workspaceId}:${projectId}:${dataset.id}`}
                    workspaceId={workspaceId}
                    projectId={projectId}
                    datasetId={dataset.id}
                    columns={profile?.columns.map((c) => c.name) ?? dataset.columns ?? []}
                    canEdit={canEdit}
                    datasetReady={dataset.status === 'ready'}
                  />
                )}

                {/* TAB 6: INTERACTIVE LINEAGE DAG */}
                {tab === 'lineage' && (
                  <LineageDag
                    workspaceId={workspaceId}
                    projectId={projectId}
                    activeDatasetId={dataset.id}
                    onSelectDataset={(selectedId) => {
                      setDatasetId(selectedId);
                      setDetails(null);
                      setDetailsLoading(true);
                      setGridColumnFilter(null);
                      setTab('overview');
                    }}
                  />
                )}

                {/* TAB 7: AI ANALYSIS & REMEDIATION */}
                {tab === 'analysis' && (
                  profile ? (
                    <AIRemediationPanel
                      key={`${workspaceId}:${projectId}:${dataset.id}`}
                      workspaceId={workspaceId}
                      projectId={projectId}
                      datasetId={dataset.id}
                      canRun={canEdit}
                      onLoadPipelineSteps={(steps, summaryNote) => {
                        setDraftedPipeline((prev) => ({
                          revision: (prev?.revision ?? 0) + 1,
                          steps,
                          note: summaryNote,
                        }));
                        setNotice(summaryNote);
                        setTab('pipeline');
                      }}
                    />
                  ) : (
                    <div className="py-10 text-center space-y-2">
                      <p className="text-xs text-[var(--ss-muted)]">
                        Complete deterministic profiling before running privacy-safe AI analysis or remediation.
                      </p>
                    </div>
                  )
                )}

                {/* TAB: AI EVAL WORKBENCH */}
                {tab === 'evals' && (
                  <AIEvalWorkbench
                    key={`${workspaceId}:${projectId}`}
                    workspaceId={workspaceId}
                    projectId={projectId}
                  />
                )}

                {/* TAB 6: LINEAGE & ACTIVITY */}
                {tab === 'history' && (
                  <div className="space-y-4">
                    <div>
                      <h2 className="text-sm font-semibold text-[var(--ss-text)]">
                        Recorded provenance & activity
                      </h2>
                      <p className="text-xs text-[var(--ss-muted)]">
                        Immutable timeline assembled from admission, profiling, AI evaluations, and approved remediations.
                      </p>
                    </div>

                    {history.length ? (
                      <ol className="relative ml-2 border-l border-[var(--ss-border-strong)] pl-6 space-y-5">
                        {history.map((entry) => (
                          <li key={entry.id} className="relative">
                            <span
                              aria-hidden="true"
                              className="absolute -left-[29px] top-1 h-2.5 w-2.5 rounded-full border-2 border-[var(--ss-primary)] bg-[var(--ss-surface)]"
                            />
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <strong className="text-xs font-semibold text-[var(--ss-text)]">
                                {entry.label}
                              </strong>
                              <time
                                dateTime={entry.date}
                                className="font-mono text-[11px] tabular-nums text-[var(--ss-subtle)]"
                              >
                                {formatDateTime(entry.date)}
                              </time>
                            </div>
                            {entry.detail && (
                              <p className="mt-0.5 font-mono text-[11px] text-[var(--ss-muted)]">
                                {entry.detail}
                              </p>
                            )}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="py-10 text-center text-xs text-[var(--ss-muted)]">
                        No timestamped activity available.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </div>

      {/* Slide-Over Column Inspector Drawer */}
      <ColumnInspectorDrawer
        column={inspectedColumn}
        rowCount={profile?.row_count ?? dataset?.row_count ?? 0}
        onClose={() => setInspectedColName(null)}
        onInspectFilter={jumpToGridFilter}
      />
    </AppShell>
  );
}
