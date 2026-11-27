'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
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

type TabItem = {
  id: StudioTab;
  label: string;
  group: 'Inspect' | 'Engineer' | 'Intelligence';
  Icon: typeof Activity;
};

const TABS: ReadonlyArray<TabItem> = [
  { id: 'overview', label: 'Overview', group: 'Inspect', Icon: Activity },
  { id: 'grid', label: 'Data grid', group: 'Inspect', Icon: Table2 },
  { id: 'columns', label: 'Columns', group: 'Inspect', Icon: Columns3 },
  { id: 'findings', label: 'Findings', group: 'Inspect', Icon: AlertTriangle },
  { id: 'pipeline', label: 'Pipeline', group: 'Engineer', Icon: SlidersHorizontal },
  { id: 'drift', label: 'Drift', group: 'Engineer', Icon: GitCompareArrows },
  { id: 'contracts', label: 'Contracts', group: 'Engineer', Icon: ShieldCheck },
  { id: 'lineage', label: 'Lineage', group: 'Engineer', Icon: Network },
  { id: 'analysis', label: 'AI & remediation', group: 'Intelligence', Icon: Sparkles },
  { id: 'evals', label: 'AI evals', group: 'Intelligence', Icon: FlaskConical },
  { id: 'history', label: 'History', group: 'Intelligence', Icon: GitBranch },
];

const TAB_GROUPS: ReadonlyArray<TabItem['group']> = ['Inspect', 'Engineer', 'Intelligence'];

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
          ? [{ id: 'profile', label: 'Profile completed', detail: `${formatNumber(profile?.row_count)} rows analyzed`, date: loaded.profile.completed_at }]
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
    [dataset, loaded, profile?.row_count],
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
          ? 'Profile refreshed.'
          : 'Profiling started — updates stream live.',
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
      setNotice(`Loaded ${created.length} sample datasets.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load sample datasets.');
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
        label: `Switch view: ${t.label}`,
        group: 'Workbench',
        onSelect: () => setTab(t.id),
      })),
    ],
    [datasets],
  );

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--ss-canvas)] font-mono text-xs text-[var(--ss-muted)]" role="status">
        Loading studio…
      </main>
    );
  }

  return (
    <AppShell
      current="workbench"
      breadcrumb={[
        { label: workspace?.name ?? 'Workspaces', href: '/workspaces' },
        { label: dataset?.filename ?? 'Workbench' },
      ]}
      account={account}
      onSignOut={() => void signOut()}
      quickJumps={quickJumps}
    >
      <div className="space-y-6">
        <h1 className="sr-only">Know your data.</h1>

        {/* Compact Inline Context Strip — Zero Nested Boxes */}
        <section
          aria-label="Dataset selection"
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <select
              id="ss-wb-workspace"
              aria-label="Workspace"
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
              className="h-9 rounded-full border border-[var(--ss-border-strong)]/80 bg-[var(--ss-surface)] px-3.5 text-xs font-medium text-[var(--ss-text)] shadow-2xs"
            >
              {!workspaces.length && <option value="">No workspaces</option>}
              {workspaces.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>

            <ChevronRight className="h-3.5 w-3.5 text-[var(--ss-subtle)]" aria-hidden="true" />

            <select
              id="ss-wb-project"
              aria-label="Project"
              value={projectId}
              disabled={!workspaceId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setDatasets([]);
                setDatasetId('');
                setDetails(null);
                setGridColumnFilter(null);
              }}
              className="h-9 rounded-full border border-[var(--ss-border-strong)]/80 bg-[var(--ss-surface)] px-3.5 text-xs font-medium text-[var(--ss-text)] shadow-2xs disabled:opacity-50"
            >
              {!projects.length && <option value="">No projects</option>}
              {projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>

            <ChevronRight className="h-3.5 w-3.5 text-[var(--ss-subtle)]" aria-hidden="true" />

            <select
              id="ss-wb-dataset"
              aria-label="Dataset"
              value={datasetId}
              disabled={!projectId}
              onChange={(e) => {
                setDatasetId(e.target.value);
                setDetails(null);
                setDetailsLoading(Boolean(e.target.value));
                setGridColumnFilter(null);
                setInspectedColName(null);
              }}
              className="h-9 rounded-full border border-[var(--ss-primary-border)] bg-[var(--ss-surface)] px-3.5 font-mono text-xs font-semibold text-[var(--ss-primary)] shadow-2xs disabled:opacity-50"
            >
              {!datasets.length && <option value="">No datasets</option>}
              {datasets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.filename}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canEdit && projectId && (
              <button
                type="button"
                onClick={() => void handleSeedDemo()}
                disabled={seedingBusy}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--ss-border-strong)]/80 bg-[var(--ss-surface)] px-3.5 text-xs font-medium text-[var(--ss-text)] hover:bg-[var(--ss-surface-hover)] disabled:opacity-50 transition-colors"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-[var(--ss-amber)]" />
                <span>{seedingBusy ? 'Loading…' : 'Load sample datasets'}</span>
              </button>
            )}
            {canEdit && dataset?.status === 'ready' && (
              <button
                type="button"
                onClick={() => void runProfile(Boolean(profile))}
                disabled={profilingBusy || profilePending}
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-gradient-to-r from-[#930031] to-[#B60A43] px-4 text-xs font-semibold text-white shadow-[0_8px_20px_-8px_rgba(147,0,49,0.6)] hover:brightness-110 disabled:opacity-50 transition-all"
              >
                {profile ? (
                  <RefreshCw className={cn('h-3.5 w-3.5', (profilingBusy || profilePending) && 'animate-spin')} />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                <span>
                  {profilePending ? 'Profiling…' : profile ? 'Re-run profile' : 'Run profiler'}
                </span>
              </button>
            )}
          </div>
        </section>

        {error && (
          <div
            role="alert"
            className="rounded-xl border border-[var(--ss-danger)]/35 bg-[var(--ss-danger-wash)] px-4 py-2.5 text-xs font-medium text-[var(--ss-danger)]"
          >
            {error}
          </div>
        )}
        {notice && (
          <div
            role="status"
            className="rounded-xl border border-[var(--ss-primary-border)] bg-[var(--ss-primary-wash)] px-4 py-2.5 text-xs font-medium text-[var(--ss-primary)]"
          >
            {notice}
          </div>
        )}

        {!dataset ? (
          <section className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-[var(--ss-border-strong)] bg-[var(--ss-surface)]/80 px-6 py-20 text-center">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--ss-warn-wash)] text-[var(--ss-primary)]">
              <Table2 className="h-5 w-5" />
            </div>
            <h2 className="mt-4 font-display text-3xl text-[var(--ss-text)]">
              No dataset selected
            </h2>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
              {canEdit && projectId && (
                <button
                  type="button"
                  onClick={() => void handleSeedDemo()}
                  disabled={seedingBusy}
                  className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[var(--ss-primary)] px-5 text-xs font-semibold text-white hover:bg-[var(--ss-primary-hover)]"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  {seedingBusy ? 'Loading…' : 'Load 3 sample datasets'}
                </button>
              )}
              <Link
                href="/workspaces"
                className="inline-flex h-10 items-center rounded-full border border-[var(--ss-border-strong)] bg-[var(--ss-surface)] px-5 text-xs font-medium text-[var(--ss-text)] no-underline hover:bg-[var(--ss-surface-hover)]"
              >
                Upload in workspaces
              </Link>
            </div>
          </section>
        ) : (
          <>
            {/* Unified Sculpted Venetian Burgundy Hero Strip — replaces 4 stacked boxes */}
            <section
              aria-label="Dataset metrics"
              className="ss-burgundy-stage relative overflow-hidden rounded-[22px] p-5 sm:p-6 text-white shadow-[0_24px_60px_-24px_rgba(147,0,49,0.45)]"
            >
              <div className="relative z-10 flex flex-wrap items-center justify-between gap-6">
                {/* Left Identity & PII Quick Action */}
                <div className="min-w-0 space-y-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[#FFF2A7] px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-[#740026]">
                      {(dataset.file_format ?? 'csv').toUpperCase()}
                    </span>
                    <span className="rounded-full bg-[#BEDEFF]/20 border border-[#BEDEFF]/35 px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-[#BEDEFF]">
                      {dataset.status}
                    </span>
                    {sseConnected && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#FFA500]/25 border border-[#FFA500]/50 px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-[#FFF2A7]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#FFA500] animate-pulse" />
                        LIVE
                      </span>
                    )}
                    <span className="font-mono text-[11px] text-white/65 tabular-nums">
                      {formatBytes(dataset.size_bytes)}
                      {dataset.sha256 ? ` · ${shortDigest(dataset.sha256)}` : ''}
                    </span>
                  </div>

                  <h2 className="truncate font-display text-3xl sm:text-[36px] leading-none text-white">
                    {dataset.filename}
                  </h2>

                  {(profile?.pii_summary?.flagged_columns ?? 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => setTab('grid')}
                      className="inline-flex items-center gap-2 rounded-full border border-[#FFA500]/55 bg-black/25 px-3 py-1 text-xs font-medium text-[#FFF2A7] hover:bg-black/40 transition-colors"
                    >
                      <Lock className="h-3 w-3 text-[#FFA500]" />
                      <span>
                        {profile?.pii_summary?.flagged_columns} PII column(s) masked ({formatNumber(profile?.pii_summary?.total_matches)} cells)
                      </span>
                      <ArrowUpRight className="h-3 w-3 text-[#BEDEFF]" />
                    </button>
                  )}
                </div>

                {/* Right Live Telemetry + Score Ring */}
                <div className="flex flex-wrap items-center gap-6">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-5 sm:gap-6 font-mono">
                    <div>
                      <span className="block text-[10px] uppercase tracking-wider text-white/60">Rows</span>
                      <strong className="mt-1 block text-xl font-semibold tabular-nums text-white">
                        {formatNumber(profile?.row_count ?? dataset.row_count)}
                      </strong>
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase tracking-wider text-white/60">Columns</span>
                      <strong className="mt-1 block text-xl font-semibold tabular-nums text-white">
                        {formatNumber(profile?.column_count ?? dataset.column_count)}
                      </strong>
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase tracking-wider text-white/60">Complete</span>
                      <strong className="mt-1 block text-xl font-semibold tabular-nums text-[#BEDEFF]">
                        {formatPercent(quality?.completeness_percent)}
                      </strong>
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase tracking-wider text-white/60">Duplicates</span>
                      <strong className="mt-1 block text-xl font-semibold tabular-nums text-[#FFF2A7]">
                        {formatNumber(quality?.duplicate_rows ?? profile?.duplicate_rows)}
                      </strong>
                    </div>
                  </div>

                  <QualityScoreMeter
                    score={quality?.overall_score ?? quality?.completeness_percent}
                    inverted
                  />
                </div>
              </div>
            </section>

            {detailsLoading && !loaded && (
              <p className="font-mono text-xs text-[var(--ss-muted)]" role="status">
                Loading analysis…
              </p>
            )}
            {loaded?.errors.map((message) => (
              <p
                key={message}
                className="rounded-xl border border-[var(--ss-amber)]/45 bg-[var(--ss-warn-wash)] px-4 py-2.5 text-xs text-[var(--ss-warn)]"
                role="status"
              >
                {message}
              </p>
            ))}

            {/* Spatial 2-Column Workbench: Clean Vertical Grouped Tool Rail (NO horizontal scrollbar!) + Open Canvas */}
            <section
              aria-label="Dataset workbench"
              className="grid grid-cols-1 lg:grid-cols-[204px_minmax(0,1fr)] gap-6 items-start"
            >
              {/* Vertical Studio Rail (Desktop) / Clean Wrap Pill Group (Mobile) */}
              <div
                role="tablist"
                aria-label="Dataset sections"
                className="lg:sticky lg:top-24 flex flex-wrap lg:flex-col gap-1.5 lg:gap-5"
              >
                {TAB_GROUPS.map((groupName) => (
                  <div key={groupName} className="contents lg:block lg:space-y-1">
                    <span className="hidden lg:block px-3 pb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ss-subtle)]">
                      {groupName}
                    </span>
                    {TABS.filter((t) => t.group === groupName).map(({ id, label, Icon }) => {
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
                            'inline-flex lg:w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs transition-all',
                            selected
                              ? 'bg-[var(--ss-primary)] text-white font-semibold shadow-[0_8px_18px_-8px_rgba(147,0,49,0.65)]'
                              : 'text-[var(--ss-muted)] hover:bg-[var(--ss-surface)] hover:text-[var(--ss-text)] font-medium',
                          )}
                        >
                          <span className="inline-flex items-center gap-2.5 min-w-0">
                            <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                            <span className="truncate">{label}</span>
                          </span>
                          {typeof count === 'number' && (
                            <span
                              aria-hidden={id === 'columns' ? true : undefined}
                              className={cn(
                                'rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums',
                                selected
                                  ? 'bg-white/20 text-[#FFF2A7]'
                                  : 'bg-[var(--ss-surface-subtle)] text-[var(--ss-muted)]',
                              )}
                            >
                              {count}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>

              {/* Active Tool Surface — Clean Single Canvas (No Nested Box Soup) */}
              <div
                id={`ss-panel-${tab}`}
                role="tabpanel"
                aria-labelledby={`ss-tab-${tab}`}
                className="min-w-0 rounded-[22px] border border-[var(--ss-border)] bg-[var(--ss-surface)] p-5 sm:p-7 shadow-[0_18px_50px_-30px_rgba(147,0,49,0.16)]"
              >
                {/* TAB 1: OVERVIEW */}
                {tab === 'overview' && (
                  <div>
                    {profile ? (
                      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 xl:gap-0 xl:divide-x xl:divide-[var(--ss-border)]">
                        {/* Left: 5-Dimension Breakdown (Open Surface, Zero Nested Card) */}
                        <div className="xl:col-span-7 xl:pr-8 space-y-5">
                          <div className="flex items-baseline justify-between">
                            <h3 className="font-display text-2xl text-[var(--ss-text)]">
                              Quality breakdown
                            </h3>
                            <span className="font-mono text-xs text-[var(--ss-subtle)] tabular-nums">
                              {formatNumber(profile.missing_cells)} missing cells
                            </span>
                          </div>

                          {quality?.dimensions ? (
                            <QualityDimensionBars dimensions={quality.dimensions} />
                          ) : (
                            <div className="space-y-3">
                              <div className="flex justify-between text-xs">
                                <span>Completeness</span>
                                <strong className="font-mono">{formatPercent(quality?.completeness_percent)}</strong>
                              </div>
                              <div className="h-2 rounded-full bg-[var(--ss-surface-subtle)] overflow-hidden">
                                <div
                                  className="h-full bg-[var(--ss-primary)]"
                                  style={{ width: `${Math.max(0, Math.min(100, quality?.completeness_percent ?? 0))}%` }}
                                />
                              </div>
                              <p className="text-xs text-[var(--ss-muted)]">
                                Click <strong>Re-run profile</strong> above to compute distributions, PII scanning, and 5-dimension scores.
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Right: Correlations + Quick Navigation Links */}
                        <div className="xl:col-span-5 xl:pl-8 flex flex-col justify-between gap-7">
                          <div className="space-y-4">
                            <h3 className="font-display text-2xl text-[var(--ss-text)]">
                              Correlations
                            </h3>
                            <CorrelationHeatmap pairs={profile.correlations ?? []} />
                          </div>

                          <div className="border-t border-[var(--ss-border)] pt-5 divide-y divide-[var(--ss-border)]">
                            <button
                              type="button"
                              onClick={() => setTab('findings')}
                              className="flex w-full items-center justify-between py-2.5 text-left text-xs hover:text-[var(--ss-primary)] transition-colors"
                            >
                              <span className="font-medium text-[var(--ss-muted)]">Quality findings</span>
                              <span className="inline-flex items-center gap-1.5 font-mono font-semibold tabular-nums text-[var(--ss-text)]">
                                {formatNumber(quality?.findings.length ?? 0)}
                                <ArrowUpRight className="h-3.5 w-3.5 text-[var(--ss-primary)]" />
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setTab('analysis')}
                              className="flex w-full items-center justify-between py-2.5 text-left text-xs hover:text-[var(--ss-primary)] transition-colors"
                            >
                              <span className="font-medium text-[var(--ss-muted)]">AI reviews</span>
                              <span className="inline-flex items-center gap-1.5 font-mono font-semibold tabular-nums text-[var(--ss-text)]">
                                {formatNumber(loaded?.reports.length ?? 0)}
                                <ArrowUpRight className="h-3.5 w-3.5 text-[var(--ss-primary)]" />
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setTab('pipeline')}
                              className="flex w-full items-center justify-between py-2.5 text-left text-xs hover:text-[var(--ss-primary)] transition-colors"
                            >
                              <span className="font-medium text-[var(--ss-muted)]">Remediation runs</span>
                              <span className="inline-flex items-center gap-1.5 font-mono font-semibold tabular-nums text-[var(--ss-text)]">
                                {formatNumber(loaded?.runs.length ?? 0)}
                                <ArrowUpRight className="h-3.5 w-3.5 text-[var(--ss-primary)]" />
                              </span>
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="py-12 text-center space-y-3">
                        <h3 className="font-display text-2xl text-[var(--ss-text)]">
                          Profile not available
                        </h3>
                        {canEdit && !profilePending && dataset.status === 'ready' && (
                          <button
                            type="button"
                            onClick={() => void runProfile(false)}
                            disabled={profilingBusy}
                            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--ss-primary)] px-5 text-xs font-semibold text-white hover:bg-[var(--ss-primary-hover)]"
                          >
                            <Play className="h-3.5 w-3.5" />
                            Run profiler
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
                      <h3 className="font-display text-2xl text-[var(--ss-text)]">Columns</h3>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ss-subtle)]" />
                        <input
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="Find a column…"
                          aria-label="Search columns"
                          className="h-9 w-56 rounded-full border border-[var(--ss-border)] bg-[var(--ss-canvas)] pl-9 pr-3 text-xs"
                        />
                      </div>
                    </div>

                    {filteredColumns.length ? (
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-left text-xs">
                          <thead className="border-b border-[var(--ss-border)] font-mono text-[10px] uppercase tracking-wider text-[var(--ss-subtle)]">
                            <tr>
                              <th scope="col" className="px-3 py-2.5">Column</th>
                              <th scope="col" className="px-3 py-2.5">Type</th>
                              <th scope="col" className="px-3 py-2.5">Missing</th>
                              <th scope="col" className="px-3 py-2.5">Distinct</th>
                              <th scope="col" className="px-3 py-2.5">Distribution</th>
                              <th scope="col" className="px-3 py-2.5">Signals</th>
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
                                  className="cursor-pointer hover:bg-[var(--ss-surface-hover)]/75 transition-colors"
                                >
                                  <td className="px-3 py-3 font-mono font-semibold text-[var(--ss-text)]">
                                    {col.name}
                                  </td>
                                  <td className="px-3 py-3">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span className="rounded-full bg-[var(--ss-surface-subtle)] px-2 py-0.5 font-mono text-[10px] text-[var(--ss-pass)]">
                                        {col.inferred_type}
                                      </span>
                                      {col.semantic_type && col.semantic_type !== col.inferred_type && (
                                        <span className="font-mono text-[10px] text-[var(--ss-muted)]">
                                          {col.semantic_type.replaceAll('_', ' ')}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-3 py-3 font-mono tabular-nums">
                                    {formatNumber(col.missing_count)}{' '}
                                    <span className="text-[var(--ss-subtle)]">
                                      ({formatPercent(col.missing_percent)})
                                    </span>
                                  </td>
                                  <td className="px-3 py-3 font-mono tabular-nums">
                                    {col.distinct_count !== null ? formatNumber(col.distinct_count) : '>2,048'}
                                  </td>
                                  <td className="px-3 py-3">
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
                                  <td className="px-3 py-3">
                                    <div className="flex flex-wrap gap-1">
                                      {signals.length ? (
                                        signals.map((sig) => (
                                          <span
                                            key={sig}
                                            className={cn(
                                              'rounded-full px-2 py-0.5 font-mono text-[10px] font-medium',
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
                      <h3 className="font-display text-2xl text-[var(--ss-text)]">Findings</h3>
                      <div className="flex items-center gap-2">
                        <select
                          aria-label="Filter by severity"
                          value={severity}
                          onChange={(e) => setSeverity(e.target.value)}
                          className="h-9 rounded-full border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-3 text-xs"
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
                          className="h-9 w-48 rounded-full border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-3.5 text-xs"
                        />
                      </div>
                    </div>

                    {filteredFindings.length ? (
                      <ul className="divide-y divide-[var(--ss-border)]">
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
                              className="flex flex-wrap items-start justify-between gap-4 py-4"
                            >
                              <div className="flex items-start gap-3 min-w-0">
                                <span
                                  className={cn(
                                    'mt-0.5 inline-block w-16 shrink-0 rounded-full py-0.5 text-center font-mono text-[10px] font-semibold uppercase',
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
                                  className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--ss-border-strong)] bg-[var(--ss-canvas)] px-3 py-1 font-mono text-[11px] font-medium text-[var(--ss-text)] hover:border-[var(--ss-primary)] hover:text-[var(--ss-primary)]"
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

                {/* TAB 5: PIPELINE */}
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
                      Dataset must reach READY status before building pipelines.
                    </p>
                  )
                )}

                {/* TAB 6: DRIFT */}
                {tab === 'drift' && (
                  <DriftInspector
                    workspaceId={workspaceId}
                    projectId={projectId}
                    datasets={datasets}
                    activeDatasetId={dataset.id}
                  />
                )}

                {/* TAB 7: CONTRACTS */}
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

                {/* TAB 8: LINEAGE */}
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

                {/* TAB 9: AI & REMEDIATION */}
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
                    <p className="py-10 text-center text-xs text-[var(--ss-muted)]">
                      Run profiling first to unlock AI analysis.
                    </p>
                  )
                )}

                {/* TAB 10: AI EVALS */}
                {tab === 'evals' && (
                  <AIEvalWorkbench
                    key={`${workspaceId}:${projectId}`}
                    workspaceId={workspaceId}
                    projectId={projectId}
                  />
                )}

                {/* TAB 11: HISTORY */}
                {tab === 'history' && (
                  <div className="space-y-5">
                    <h3 className="font-display text-2xl text-[var(--ss-text)]">Activity & provenance</h3>

                    {history.length ? (
                      <ol className="relative ml-2 border-l border-[var(--ss-border-strong)] pl-6 space-y-5">
                        {history.map((entry) => (
                          <li key={entry.id} className="relative">
                            <span
                              aria-hidden="true"
                              className="absolute -left-[29px] top-1 h-2.5 w-2.5 rounded-full border-2 border-[var(--ss-primary)] bg-[var(--ss-warn-wash)]"
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
