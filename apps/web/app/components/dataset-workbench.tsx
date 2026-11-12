'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { Brand } from '@/app/components/brand';
import { ProductNavigation } from '@/app/components/product-navigation';
import { request, type Account, type Project, type Workspace } from '@/lib/client-api';

type Dataset = { id: string; filename: string; status: string; size_bytes?: number; created_at?: string };
type ResultList<T> = T[] | { results: T[] };
type Finding = { code: string; severity: 'high' | 'warning' | 'info'; message: string; column: string | null };
type Column = { name: string; inferred_type: string; missing_count: number; missing_percent: number;
  distinct_count: number | null; numeric: { min: string; max: string; mean: string } | null };
type Profile = { status: string; completed_at?: string | null; error_code?: string;
  result?: { row_count: number; column_count: number; missing_cells: number; duplicate_rows?: number;
    columns?: Column[]; quality?: { completeness_percent: number | null; duplicate_rows: number;
      findings: Finding[]; finding_counts?: Record<string, number> } } };
type AIReport = { id: string; status: string; technique: string; created_at: string; model?: string;
  result?: { summary?: string; recommendations?: unknown[] } };
type RemediationRun = { id: string; status: string; created_at: string; applied_at?: string | null;
  operations?: string[]; preview?: { before?: { rows?: number }; after?: { rows?: number };
    changed_cells?: number; removed_duplicate_rows?: number } };
type Tab = 'overview' | 'columns' | 'findings' | 'analysis' | 'history';
const tabs: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' }, { id: 'columns', label: 'Columns' },
  { id: 'findings', label: 'Findings' }, { id: 'analysis', label: 'AI & remediation' },
  { id: 'history', label: 'History' },
];

type Details = { key: string; profile: Profile | null; reports: AIReport[];
  runs: RemediationRun[]; errors: string[] };

function asList<T>(input: ResultList<T>): T[] {
  return Array.isArray(input) ? input : (Array.isArray(input.results) ? input.results : []);
}

async function readProfile(url: string): Promise<Profile | null> {
  const response = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  if (response.status === 404) return null;
  if (response.status === 401) throw new Error('Sign in to continue.');
  if (response.status === 403) throw new Error('You do not have permission to view this profile.');
  if (!response.ok) throw new Error('Could not load the saved dataset profile.');
  return (await response.json()) as Profile;
}

function dateLabel(value?: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString(undefined,
    { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatCount(value?: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '—';
}

function percent(value?: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}%` : '—';
}

export function DatasetWorkbench() {
  const router = useRouter();
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
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const [query, setQuery] = useState('');
  const [severity, setSeverity] = useState('all');

  useEffect(() => {
    let active = true;
    Promise.all([request<Account>('/api/v1/auth/me'), request<Workspace[]>('/api/v1/workspaces')])
      .then(([user, items]) => {
        if (!active) return;
        setAccount(user);
        setWorkspaces(items);
        setWorkspaceId(items[0]?.id ?? '');
      })
      .catch((reason: unknown) => {
        if (!active) return;
        if (reason instanceof Error && reason.message === 'Sign in to continue.') router.replace('/login');
        else setError('Unable to load your workspaces. Refresh to retry.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [router]);

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    request<Project[]>(`/api/v1/workspaces/${workspaceId}/projects`)
      .then((items) => {
        if (!active) return;
        setProjects(items);
        setProjectId(items[0]?.id ?? '');
      })
      .catch(() => { if (active) setError('Unable to load projects in this workspace.'); });
    return () => { active = false; };
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || !projectId) return;
    let active = true;
    request<ResultList<Dataset>>(`/api/v1/workspaces/${workspaceId}/projects/${projectId}/datasets`)
      .then((items) => {
        if (!active) return;
        const list = asList(items);
        setDatasets(list);
        setDatasetId(list[0]?.id ?? '');
      })
      .catch(() => { if (active) setError('Unable to load datasets in this project.'); });
    return () => { active = false; };
  }, [workspaceId, projectId]);

  const key = `${workspaceId}:${projectId}:${datasetId}`;
  useEffect(() => {
    if (!workspaceId || !projectId || !datasetId) return;
    let active = true;
    const root = `/api/v1/workspaces/${workspaceId}/projects/${projectId}/datasets/${datasetId}`;
    const load = async () => {
      const [profile, reports, runs] = await Promise.allSettled([
        readProfile(`${root}/profile`), request<ResultList<AIReport>>(`${root}/ai-reports`),
        request<ResultList<RemediationRun>>(`${root}/remediations`),
      ]);
      if (!active) return;
      const issues: string[] = [];
      if (profile.status === 'rejected') issues.push('Dataset profile could not be loaded.');
      if (reports.status === 'rejected') issues.push('Saved AI analyses could not be loaded.');
      if (runs.status === 'rejected') issues.push('Remediation history could not be loaded.');
      setDetails({
        key,
        profile: profile.status === 'fulfilled' ? profile.value : null,
        reports: reports.status === 'fulfilled' ? asList(reports.value) : [],
        runs: runs.status === 'fulfilled' ? asList(runs.value) : [],
        errors: issues,
      });
      setDetailsLoading(false);
    };
    void load();
    return () => { active = false; };
  }, [workspaceId, projectId, datasetId, key]);

  const workspace = workspaces.find((item) => item.id === workspaceId);
  const project = projects.find((item) => item.id === projectId);
  const dataset = datasets.find((item) => item.id === datasetId);
  const loaded = details?.key === key ? details : null;
  const profile = loaded?.profile?.status === 'ready' ? loaded.profile.result : undefined;
  const quality = profile?.quality;
  const columns = useMemo(() => (profile?.columns ?? []).filter((item) =>
    `${item.name} ${item.inferred_type}`.toLowerCase().includes(query.toLowerCase())), [profile?.columns, query]);
  const findings = (quality?.findings ?? []).filter((item) => severity === 'all' || item.severity === severity)
    .filter((item) => `${item.code} ${item.column ?? ''} ${item.message}`.toLowerCase().includes(query.toLowerCase()));
  const reportCount = loaded?.reports.length ?? 0;
  const runCount = loaded?.runs.length ?? 0;
  const history = [
    ...(dataset?.created_at ? [{ id: `dataset:${dataset.id}`, label: 'Dataset uploaded', date: dataset.created_at }] : []),
    ...(loaded?.profile?.completed_at ? [{ id: 'profile', label: 'Profile completed', date: loaded.profile.completed_at }] : []),
    ...(loaded?.reports ?? []).map((r) => ({ id: `report:${r.id}`, label: `AI analysis · ${r.technique.replaceAll('_', ' ')}`, date: r.created_at })),
    ...(loaded?.runs ?? []).map((r) => ({ id: `run:${r.id}`, label: `Remediation · ${r.status}`, date: r.applied_at || r.created_at })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  function chooseWorkspace(id: string) {
    setWorkspaceId(id); setProjects([]); setProjectId(''); setDatasets([]); setDatasetId('');
    setDetails(null); setError(''); setQuery(''); setTab('overview');
  }
  function chooseProject(id: string) {
    setProjectId(id); setDatasets([]); setDatasetId(''); setDetails(null);
    setError(''); setQuery(''); setTab('overview');
  }
  function chooseDataset(id: string) {
    setDatasetId(id); setDetails(null); setDetailsLoading(Boolean(id));
    setError(''); setQuery(''); setSeverity('all'); setTab('overview');
  }
  async function signOut() {
    try { await request<void>('/api/v1/auth/logout', 'POST'); router.replace('/login'); }
    catch { setError('Could not sign out. Please retry.'); }
  }

  if (loading) return <main className="ss-loading-page" role="status">Loading data workbench…</main>;
  return (
    <div className="ss-app-shell ss-experience-shell">
      <aside className="ss-sidebar" aria-label="Product navigation">
        <div className="ss-sidebar-brand"><Brand /></div>
        <div className="ss-sidebar-content"><ProductNavigation current="workbench" />
          <div className="ss-nav-context"><span className="ss-product-nav-label">CURRENT WORKSPACE</span>
            <strong>{workspace?.name ?? 'No workspace selected'}</strong>
            <span>{project?.name ?? 'Choose a project'}</span>
          </div>
        </div>
        <div className="ss-sidebar-bottom"><span className="ss-sidebar-label">SyntheSift</span><p>Data quality workbench</p></div>
      </aside>
      <div className="ss-main-column">
        <header className="ss-app-topbar ss-experience-topbar">
          <div className="ss-breadcrumb"><Link href="/workspaces">Workspaces</Link><span aria-hidden="true">/</span>
            <strong>{workspace?.name ?? 'Data workbench'}</strong></div>
          <div className="ss-user-actions"><span className="ss-account-label" title={account?.email || account?.username}>
            {account?.email || account?.username}</span><button className="ss-topbar-account" type="button" onClick={() => void signOut()}>Sign out</button></div>
        </header>
        <main id="main-content" className="ss-app-main ss-workbench-main">
          <div className="ss-page-heading ss-workbench-heading"><div>
            <p className="ss-kicker">DATA INTELLIGENCE / WORKBENCH</p>
            <h1>Know your data.</h1>
            <p className="ss-page-subtitle">Explore saved profiles, inspect findings, and trace reviewed remediation.</p>
          </div><Link href="/workspaces" className="ss-workbench-action">Open workspace <span aria-hidden="true">↗</span></Link></div>
          {error && <p className="ss-error-banner" role="alert">{error}</p>}
          <section className="ss-workbench-choose" aria-label="Dataset selection">
            <div><label htmlFor="ss-wb-workspace">Workspace</label><select id="ss-wb-workspace" value={workspaceId} onChange={(e) => chooseWorkspace(e.target.value)}>
              {!workspaces.length && <option value="">No workspaces</option>}
              {workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></div>
            <div><label htmlFor="ss-wb-project">Project</label><select id="ss-wb-project" value={projectId} disabled={!workspaceId} onChange={(e) => chooseProject(e.target.value)}>
              {!projects.length && <option value="">No projects</option>}
              {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></div>
            <div><label htmlFor="ss-wb-dataset">Dataset</label><select id="ss-wb-dataset" value={datasetId} disabled={!projectId} onChange={(e) => chooseDataset(e.target.value)}>
              {!datasets.length && <option value="">No datasets</option>}
              {datasets.map((item) => <option key={item.id} value={item.id}>{item.filename}</option>)}
            </select></div>
          </section>
          {!dataset ? (
            <section className="ss-workbench-empty"><span className="ss-workbench-empty-symbol" aria-hidden="true">◎</span>
              <h2>No dataset selected</h2><p>Choose a workspace, project and uploaded CSV to open its workbench.</p>
              <Link href="/workspaces">Go to your workspaces</Link></section>
          ) : <>
            <div className="ss-workbench-fileline"><div><span className="ss-filetype">CSV</span><strong>{dataset.filename}</strong>
              <span className={`ss-dataset-state ss-state-${dataset.status}`}>{dataset.status}</span></div>
              <span className="ss-workbench-secondary">{dataset.size_bytes == null ? 'Size unavailable' : `${(dataset.size_bytes / 1024).toFixed(1)} KB`}</span>
            </div>
            {detailsLoading && !loaded && <p className="ss-workbench-loading" role="status">Loading saved dataset analysis…</p>}
            {loaded?.errors.map((message) => <p key={message} className="ss-workbench-notice" role="status">{message}</p>)}
            <section className="ss-workbench-metrics" aria-label="Dataset metrics">
              <div><span>Rows</span><strong>{formatCount(profile?.row_count)}</strong><small>From saved profile</small></div>
              <div><span>Columns</span><strong>{formatCount(profile?.column_count)}</strong><small>Inferred schema</small></div>
              <div><span>Completeness</span><strong>{percent(quality?.completeness_percent)}</strong><small>Non-missing cells</small></div>
              <div><span>Exact duplicates</span><strong>{formatCount(quality?.duplicate_rows ?? profile?.duplicate_rows)}</strong><small>Repeated records</small></div>
            </section>
            <section className="ss-workbench-detail" aria-label="Dataset workbench">
              <div role="tablist" aria-label="Dataset sections" className="ss-workbench-tabs">
                {tabs.map((item) => <button key={item.id} id={`ss-tab-${item.id}`} type="button" role="tab"
                  aria-controls={`ss-panel-${item.id}`} aria-selected={tab === item.id}
                  onClick={() => { setTab(item.id); setQuery(''); }} className={tab === item.id ? 'is-selected' : ''}>
                  {item.label}{item.id === 'findings' && quality?.findings ? <span>{quality.findings.length}</span> : null}
                </button>)}
              </div>
              <div id={`ss-panel-${tab}`} role="tabpanel" aria-labelledby={`ss-tab-${tab}`} className="ss-workbench-panel">
                {tab === 'overview' && <>
                  <div className="ss-section-heading"><div><h2>Profile overview</h2><p>Measured data quality from the latest saved profile.</p></div>
                    <span className="ss-meta">{loaded?.profile ? `Profile: ${loaded.profile.status}` : 'Not analyzed'}</span></div>
                  {profile ? <>
                    <div className="ss-quality-bar-label"><span>Observed completeness</span><strong>{percent(quality?.completeness_percent)}</strong></div>
                    <div className="ss-quality-bar" role="meter" aria-label="Completeness" aria-valuemin={0} aria-valuemax={100}
                      aria-valuenow={typeof quality?.completeness_percent === 'number' ? quality.completeness_percent : undefined}>
                      <div style={{ width: `${Math.max(0, Math.min(100, quality?.completeness_percent ?? 0))}%` }} /></div>
                    <div className="ss-workbench-summary-grid"><div><span>Missing cells</span><strong>{formatCount(profile.missing_cells)}</strong></div>
                      <div><span>Saved findings</span><strong>{quality ? formatCount(quality.findings.length) : '—'}</strong></div>
                      <div><span>AI reports</span><strong>{formatCount(reportCount)}</strong></div>
                      <div><span>Remediation runs</span><strong>{formatCount(runCount)}</strong></div></div>
                    {!quality && <p className="ss-workbench-notice">This profile predates saved quality findings. Re-profiling may be needed.</p>}
                  </> : <div className="ss-workbench-empty-inline"><h3>Profile not available</h3><p>
                    {loaded?.profile?.status === 'queued' || loaded?.profile?.status === 'processing'
                      ? 'Profiling is in progress. Refresh this page after it completes.'
                      : 'Analyze this dataset from its workspace to populate the workbench.'}</p>
                    <Link href="/workspaces">Open workspace</Link></div>}
                </>}
                {tab === 'columns' && <>
                  <div className="ss-section-heading"><div><h2>Column explorer</h2><p>Inferred types and distribution summaries, not raw records.</p></div>
                    <label className="ss-workbench-search"><span className="ss-visually-hidden">Search columns</span><input value={query}
                      onChange={(e) => setQuery(e.target.value)} placeholder="Find a column…" /></label></div>
                  {columns.length ? <div className="ss-workbench-table-scroll"><table className="ss-workbench-table"><thead><tr>
                    <th scope="col">Column</th><th scope="col">Inferred type</th><th scope="col">Missing</th>
                    <th scope="col">Distinct</th><th scope="col">Numeric range</th>
                  </tr></thead><tbody>{columns.map((item) => <tr key={item.name}><td><strong>{item.name}</strong></td>
                    <td><span className="ss-type-token">{item.inferred_type}</span></td>
                    <td>{formatCount(item.missing_count)} <small>({percent(item.missing_percent)})</small></td>
                    <td>{formatCount(item.distinct_count)}</td><td>{item.numeric ? `${item.numeric.min} – ${item.numeric.max}` : '—'}</td>
                  </tr>)}</tbody></table></div> : <p className="ss-workbench-empty-inline">{profile ? 'No matching columns.' : 'No saved column profile yet.'}</p>}
                </>}
                {tab === 'findings' && <>
                  <div className="ss-section-heading"><div><h2>Quality findings</h2><p>Deterministic observations, not automatically confirmed business-rule violations.</p></div>
                    <div className="ss-workbench-filters"><label><span className="ss-visually-hidden">Filter by severity</span>
                      <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
                        <option value="all">All severity</option><option value="high">High</option>
                        <option value="warning">Warning</option><option value="info">Info</option>
                      </select></label><label className="ss-workbench-search"><span className="ss-visually-hidden">Search findings</span>
                        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search findings…" /></label></div></div>
                  {findings.length ? <ul className="ss-finding-list">{findings.map((finding, i) => <li key={`${finding.code}:${finding.column}:${i}`}>
                    <span className={`ss-finding-severity ss-finding-${finding.severity}`}>{finding.severity}</span>
                    <div><strong>{finding.column || finding.code.replaceAll('_', ' ')}</strong><p>{finding.message}</p>
                      <small>{finding.code}</small></div></li>)}</ul>
                    : <p className="ss-workbench-empty-inline">{quality ? 'No findings match this filter.' : 'No saved quality findings yet.'}</p>}
                </>}
                {tab === 'analysis' && <>
                  <div className="ss-section-heading"><div><h2>AI analysis and remediation</h2><p>Saved reports and human-reviewed operations.</p></div>
                    <Link href="/workspaces" className="ss-workbench-inline-link">Open analysis tools <span aria-hidden="true">↗</span></Link></div>
                  <div className="ss-workbench-two-up"><section><h3>Saved AI reports <span>{reportCount}</span></h3>
                    {loaded?.reports.length ? <ul className="ss-workbench-activity">{loaded.reports.map((report) => <li key={report.id}>
                      <strong>{report.technique.replaceAll('_', ' ')}</strong><span>{report.status}</span>
                      <small>{dateLabel(report.created_at)} · {report.result?.recommendations?.length ?? 0} proposals</small></li>)}</ul>
                      : <p className="ss-workbench-muted">No saved AI reports for this dataset.</p>}</section>
                    <section><h3>Remediation history <span>{runCount}</span></h3>
                      {loaded?.runs.length ? <ul className="ss-workbench-activity">{loaded.runs.map((run) => <li key={run.id}>
                        <strong>{(run.operations ?? []).join(', ').replaceAll('_', ' ') || 'Remediation review'}</strong>
                        <span>{run.status}</span><small>{dateLabel(run.applied_at || run.created_at)}
                          {run.preview?.changed_cells != null ? ` · ${run.preview.changed_cells} cells changed` : ''}
                          {run.preview?.before?.rows != null && run.preview?.after?.rows != null
                            ? ` · rows ${run.preview.before.rows} → ${run.preview.after.rows}` : ''}</small></li>)}</ul>
                        : <p className="ss-workbench-muted">No remediation previews or applied runs.</p>}</section></div>
                  <p className="ss-workbench-disclaimer">AI suggestions require evidence review. A preview is not an applied change; operations are only shown as applied when the saved run says so.</p>
                </>}
                {tab === 'history' && <>
                  <div className="ss-section-heading"><div><h2>Recorded activity</h2><p>Events assembled from saved dataset, profile, AI and remediation timestamps.</p></div></div>
                  {history.length ? <ol className="ss-workbench-timeline">{history.map((entry) => <li key={entry.id}>
                    <span className="ss-workbench-timeline-dot" aria-hidden="true" />
                    <div><strong>{entry.label}</strong><time dateTime={entry.date}>{dateLabel(entry.date)}</time></div>
                  </li>)}</ol> : <p className="ss-workbench-empty-inline">No timestamped activity available.</p>}
                  <p className="ss-workbench-disclaimer">This is a derived timeline, not a complete administrative audit log.</p>
                </>}
              </div>
            </section>
          </>}
          <footer className="ss-workbench-footer"><span>SyntheSift / Data integrity by design</span>
            <span>Analysis is read-only here. Use your workspace for uploads, AI runs and approvals.</span></footer>
        </main>
      </div>
    </div>
  );
}
