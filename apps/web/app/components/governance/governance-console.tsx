'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  KeyRound,
  Play,
  Plus,
  RefreshCw,
  ScrollText,
  Send,
  ShieldAlert,
  TerminalSquare,
  Trash2,
  Webhook,
  XCircle,
} from 'lucide-react';
import { AppShell } from '@/app/components/shell/app-shell';
import {
  createWorkspaceToken,
  createWorkspaceWebhook,
  deleteWorkspaceWebhook,
  fetchContracts,
  fetchWebhookDeliveries,
  fetchWorkspaceAuditLogs,
  fetchWorkspaceTokens,
  fetchWorkspaceWebhooks,
  request,
  revokeWorkspaceToken,
  runCiQualityGate,
  testWorkspaceWebhook,
  updateWorkspaceWebhook,
  type Account,
  type Dataset,
  type Project,
  type Workspace,
} from '@/lib/client-api';
import { cn, formatDateTime } from '@/lib/cn';
import type {
  AuditEventRecord,
  CIGateVerdict,
  DataContractRecord,
  PatScope,
  PersonalAccessTokenCreated,
  PersonalAccessTokenRecord,
  WebhookDeliveryRecord,
  WebhookEndpointCreated,
  WebhookEndpointRecord,
} from '@/lib/types';

type GovTab = 'tokens' | 'webhooks' | 'audit';
type ResultList<T> = T[] | { results: T[] };

const WEBHOOK_EVENTS = [
  { id: 'ci_gate.failed', label: 'CI Gate Failed' },
  { id: 'ci_gate.passed', label: 'CI Gate Passed' },
  { id: 'contract.failed', label: 'Contract Failed' },
  { id: 'drift.detected', label: 'ML Drift Detected' },
  { id: 'pipeline.applied', label: 'Pipeline Applied' },
] as const;

const PAT_SCOPES: ReadonlyArray<{ id: PatScope; label: string }> = [
  { id: 'read', label: 'read' },
  { id: 'gate:run', label: 'gate:run' },
  { id: 'write', label: 'write' },
];

function asList<T>(input: ResultList<T>): T[] {
  return Array.isArray(input) ? input : Array.isArray(input.results) ? input.results : [];
}

export function GovernanceConsole() {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [contracts, setContracts] = useState<DataContractRecord[]>([]);

  const [tab, setTab] = useState<GovTab>('tokens');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Tokens state
  const [tokens, setTokens] = useState<PersonalAccessTokenRecord[]>([]);
  const [tokenName, setTokenName] = useState('github-actions-ci');
  const [tokenScopes, setTokenScopes] = useState<PatScope[]>(['read', 'gate:run']);
  const [tokenExpiry, setTokenExpiry] = useState('90');
  const [freshToken, setFreshToken] = useState<PersonalAccessTokenCreated | null>(null);
  const [tokenBusy, setTokenBusy] = useState(false);

  // CI/CD Gate interactive runner state
  const [gateDatasetId, setGateDatasetId] = useState('');
  const [gateContractId, setGateContractId] = useState('');
  const [gateBaselineId, setGateBaselineId] = useState('');
  const [gateMinScore, setGateMinScore] = useState('80');
  const [gateFailPii, setGateFailPii] = useState(true);
  const [gateBusy, setGateBusy] = useState(false);
  const [gateVerdict, setGateVerdict] = useState<CIGateVerdict | null>(null);

  // Webhooks state
  const [webhooks, setWebhooks] = useState<WebhookEndpointRecord[]>([]);
  const [whName, setWhName] = useState('');
  const [whUrl, setWhUrl] = useState('');
  const [whEvents, setWhEvents] = useState<string[]>(['ci_gate.failed', 'contract.failed', 'drift.detected']);
  const [freshWebhook, setFreshWebhook] = useState<WebhookEndpointCreated | null>(null);
  const [whBusy, setWhBusy] = useState(false);
  const [expandedWhId, setExpandedWhId] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDeliveryRecord[]>([]);
  const [lastSignature, setLastSignature] = useState<{ webhookId: string; sig: string } | null>(null);

  // Audit trail state
  const [auditLogs, setAuditLogs] = useState<AuditEventRecord[]>([]);
  const [auditAction, setAuditAction] = useState('');
  const [auditOutcome, setAuditOutcome] = useState('');
  const [copiedKey, setCopiedKey] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([
      request<Account>('/api/v1/auth/me'),
      request<Workspace[]>('/api/v1/workspaces'),
    ])
      .then(([user, wsList]) => {
        if (!active) return;
        setAccount(user);
        setWorkspaces(wsList);
        setWorkspaceId(wsList[0]?.id ?? '');
      })
      .catch((cause: unknown) => {
        if (!active) return;
        if (cause instanceof Error && cause.message === 'Sign in to continue.') {
          router.replace('/login');
        } else {
          setError('Unable to load workspaces.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [router]);

  const workspace = workspaces.find((w) => w.id === workspaceId);
  const canManage = workspace?.role === 'owner' || workspace?.role === 'editor';

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    const calls = [
      request<Project[]>(`/api/v1/workspaces/${workspaceId}/projects`),
      fetchWorkspaceAuditLogs(workspaceId, { limit: 100 }),
      canManage ? fetchWorkspaceTokens(workspaceId) : Promise.resolve([]),
      canManage ? fetchWorkspaceWebhooks(workspaceId) : Promise.resolve([]),
    ] as const;

    Promise.allSettled(calls).then(([projRes, auditRes, tokRes, whRes]) => {
      if (!active) return;
      if (projRes.status === 'fulfilled') {
        setProjects(projRes.value);
        setProjectId(projRes.value[0]?.id ?? '');
      }
      if (auditRes.status === 'fulfilled') setAuditLogs(auditRes.value);
      if (tokRes.status === 'fulfilled') setTokens(tokRes.value);
      if (whRes.status === 'fulfilled') setWebhooks(whRes.value);
    });
    return () => {
      active = false;
    };
  }, [workspaceId, canManage]);

  useEffect(() => {
    if (!workspaceId || !projectId) return;
    let active = true;
    Promise.allSettled([
      request<ResultList<Dataset>>(
        `/api/v1/workspaces/${workspaceId}/projects/${projectId}/datasets`,
      ),
      fetchContracts(workspaceId, projectId),
    ]).then(([dsRes, cRes]) => {
      if (!active) return;
      if (dsRes.status === 'fulfilled') {
        const ready = asList(dsRes.value).filter((d) => d.status === 'ready');
        setDatasets(ready);
        setGateDatasetId(ready[0]?.id ?? '');
      }
      if (cRes.status === 'fulfilled') setContracts(cRes.value);
    });
    return () => {
      active = false;
    };
  }, [workspaceId, projectId]);

  async function refreshAudit(action = auditAction, outcome = auditOutcome) {
    if (!workspaceId) return;
    try {
      const items = await fetchWorkspaceAuditLogs(workspaceId, {
        action: action || undefined,
        outcome: outcome || undefined,
        limit: 100,
      });
      setAuditLogs(items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to refresh audit logs.');
    }
  }

  async function copyText(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(''), 1800);
    } catch {
      setError('Clipboard copy was blocked by your browser.');
    }
  }

  async function handleMintToken(event: FormEvent) {
    event.preventDefault();
    if (!workspaceId || !canManage || !tokenName.trim() || !tokenScopes.length) return;
    setTokenBusy(true);
    setError('');
    setNotice('');
    try {
      const created = await createWorkspaceToken(workspaceId, {
        name: tokenName.trim(),
        scopes: tokenScopes,
        expires_in_days: tokenExpiry ? Number(tokenExpiry) : null,
      });
      setFreshToken(created);
      setTokens((prev) => [created, ...prev]);
      setTokenName('');
      setNotice(`Minted Personal Access Token "${created.name}". Copy the raw secret now.`);
      void refreshAudit();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create token.');
    } finally {
      setTokenBusy(false);
    }
  }

  async function handleRevokeToken(tokenId: string) {
    if (!workspaceId || !canManage) return;
    setError('');
    try {
      await revokeWorkspaceToken(workspaceId, tokenId);
      setTokens((prev) =>
        prev.map((t) =>
          t.id === tokenId ? { ...t, is_revoked: true, revoked_at: new Date().toISOString() } : t,
        ),
      );
      setNotice('Personal Access Token revoked immediately.');
      void refreshAudit();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to revoke token.');
    }
  }

  async function handleRunCiGate() {
    if (!workspaceId || !projectId || !gateDatasetId) return;
    setGateBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await runCiQualityGate(workspaceId, projectId, {
        dataset_id: gateDatasetId,
        contract_id: gateContractId || null,
        baseline_dataset_id: gateBaselineId || null,
        min_quality_score: Number(gateMinScore) || 75,
        fail_on_pii: gateFailPii,
        dry_run_webhooks: true,
      });
      setGateVerdict(result);
      setNotice(
        `CI/CD Gate returned HTTP ${result.http_status} (${result.verdict.toUpperCase()} · exit_code=${result.exit_code}).`,
      );
      void refreshAudit();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'CI/CD Quality Gate failed to execute.');
    } finally {
      setGateBusy(false);
    }
  }

  async function handleCreateWebhook(event: FormEvent) {
    event.preventDefault();
    if (!workspaceId || !canManage || !whName.trim() || !whUrl.trim() || !whEvents.length) return;
    setWhBusy(true);
    setError('');
    setNotice('');
    try {
      const created = await createWorkspaceWebhook(workspaceId, {
        name: whName.trim(),
        url: whUrl.trim(),
        events: whEvents,
        is_active: true,
      });
      setFreshWebhook(created);
      setWebhooks((prev) => [created, ...prev]);
      setWhName('');
      setWhUrl('');
      setNotice(`Registered signed webhook "${created.name}".`);
      void refreshAudit();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Webhook registration rejected (verify HTTPS URL and non-private host).',
      );
    } finally {
      setWhBusy(false);
    }
  }

  async function handleToggleWebhook(ep: WebhookEndpointRecord) {
    if (!workspaceId || !canManage) return;
    try {
      const updated = await updateWorkspaceWebhook(workspaceId, ep.id, {
        is_active: !ep.is_active,
      });
      setWebhooks((prev) => prev.map((w) => (w.id === ep.id ? updated : w)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update webhook.');
    }
  }

  async function handleDeleteWebhook(webhookId: string) {
    if (!workspaceId || !canManage) return;
    try {
      await deleteWorkspaceWebhook(workspaceId, webhookId);
      setWebhooks((prev) => prev.filter((w) => w.id !== webhookId));
      if (expandedWhId === webhookId) setExpandedWhId(null);
      setNotice('Webhook deleted.');
      void refreshAudit();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to delete webhook.');
    }
  }

  async function handleTestWebhook(webhookId: string) {
    if (!workspaceId || !canManage) return;
    setError('');
    try {
      const res = await testWorkspaceWebhook(workspaceId, webhookId, true);
      setLastSignature({ webhookId, sig: res.signature_header });
      setExpandedWhId(webhookId);
      const list = await fetchWebhookDeliveries(workspaceId, webhookId);
      setDeliveries(list);
      setNotice('Generated dry-run HMAC-SHA256 webhook signature and recorded delivery.');
      void refreshAudit();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to test webhook.');
    }
  }

  async function handleInspectDeliveries(webhookId: string) {
    if (expandedWhId === webhookId) {
      setExpandedWhId(null);
      return;
    }
    setExpandedWhId(webhookId);
    try {
      const list = await fetchWebhookDeliveries(workspaceId, webhookId);
      setDeliveries(list);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load deliveries.');
    }
  }

  function exportAuditJson() {
    const blob = new Blob([JSON.stringify(auditLogs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `synthesift_audit_${workspaceId.slice(0, 8)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const ghActionsYaml = useMemo(() => {
    const ws = workspaceId || '<WORKSPACE_UUID>';
    const proj = projectId || '<PROJECT_UUID>';
    const contractLine = gateContractId ? `          -F "contract_id=${gateContractId}" \\\n` : '';
    return `name: SyntheSift Data Quality Gate
on:
  pull_request:
    paths: ["data/**/*.csv", "data/**/*.parquet"]

jobs:
  data-quality-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run SyntheSift Quality & PII Gate
        env:
          SYNTHESIFT_URL: \${{ secrets.SYNTHESIFT_URL }}
          SYNTHESIFT_TOKEN: \${{ secrets.SYNTHESIFT_TOKEN }}
        run: |
          curl --fail-with-body -sS -X POST \\
            "\${SYNTHESIFT_URL}/api/v1/workspaces/${ws}/projects/${proj}/ci/gate" \\
            -H "Authorization: Bearer \${SYNTHESIFT_TOKEN}" \\
            -F "file=@data/release_batch.csv" \\
${contractLine}            -F "min_quality_score=${gateMinScore || '80'}" \\
            -F "fail_on_pii=${gateFailPii ? 'true' : 'false'}"`;
  }, [workspaceId, projectId, gateContractId, gateMinScore, gateFailPii]);

  async function signOut() {
    await request<void>('/api/v1/auth/logout', 'POST');
    router.replace('/login');
  }

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--ss-canvas)] font-mono text-xs text-[var(--ss-muted)]">
        Loading Governance & CI/CD console…
      </main>
    );
  }

  return (
    <AppShell
      current="governance"
      breadcrumb={[
        { label: 'Workspaces', href: '/workspaces' },
        { label: 'CI/CD & Governance' },
      ]}
      account={account}
      onSignOut={() => void signOut()}
    >
      <div className="space-y-6">
        {/* Editorial Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h1 className="font-display text-4xl sm:text-[42px] leading-none text-[var(--ss-text)]">
            CI/CD Gates &amp; <em className="italic text-[var(--ss-primary)]">Governance</em>
          </h1>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Workspace"
              value={workspaceId}
              onChange={(e) => {
                setWorkspaceId(e.target.value);
                setFreshToken(null);
                setFreshWebhook(null);
                setGateVerdict(null);
              }}
              className="h-9 rounded-full border border-[var(--ss-border-strong)] bg-[var(--ss-surface)] px-3.5 text-xs font-medium text-[var(--ss-text)]"
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.role})
                </option>
              ))}
            </select>
          </div>
        </div>

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

        {/* Tab Surface */}
        <section className="overflow-hidden rounded-[22px] border border-[var(--ss-border)] bg-[var(--ss-surface)] shadow-[0_18px_50px_-30px_rgba(147,0,49,0.14)]">
          <div
            role="tablist"
            aria-label="Governance sections"
            className="flex flex-wrap items-center gap-1.5 border-b border-[var(--ss-border)] bg-[var(--ss-canvas)]/55 px-5 py-3"
          >
            {(
              [
                { id: 'tokens', label: 'API Tokens & CI/CD Gate', Icon: KeyRound },
                { id: 'webhooks', label: 'Signed Webhooks', Icon: Webhook },
                { id: 'audit', label: `Audit Trail (${auditLogs.length})`, Icon: ScrollText },
              ] as const
            ).map(({ id, label, Icon }) => {
              const selected = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setTab(id)}
                  className={cn(
                    'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs transition-all',
                    selected
                      ? 'bg-[var(--ss-primary)] text-white font-semibold shadow-xs'
                      : 'text-[var(--ss-muted)] hover:bg-[var(--ss-surface)] hover:text-[var(--ss-text)] font-medium',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>

          <div className="p-5 lg:p-6">
            {/* TAB 1: PATs & CI/CD QUALITY GATE */}
            {tab === 'tokens' && (
              <div className="space-y-8">
                {/* Section A: Personal Access Tokens */}
                <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
                  <form
                    onSubmit={(e) => void handleMintToken(e)}
                    className="xl:col-span-5 rounded-lg border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-4 sm:p-5 space-y-4"
                  >
                    <div>
                      <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--ss-subtle)]">
                        MINT WORKSPACE TOKEN
                      </span>
                      <h2 className="mt-0.5 text-sm font-semibold text-[var(--ss-text)]">
                        Personal Access Tokens (PAT)
                      </h2>
                      <p className="text-xs text-[var(--ss-muted)]">
                        Bearer tokens are scoped to this workspace and stored exclusively as SHA-256 hashes.
                      </p>
                    </div>

                    <label className="block space-y-1 text-xs">
                      <span className="font-mono text-[10px] uppercase text-[var(--ss-subtle)]">Token Label</span>
                      <input
                        aria-label="Token label"
                        value={tokenName}
                        onChange={(e) => setTokenName(e.target.value)}
                        placeholder="e.g. github-actions-prod"
                        disabled={!canManage}
                        required
                        className="h-9 w-full rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 font-mono text-xs"
                      />
                    </label>

                    <div className="space-y-1.5">
                      <span className="block font-mono text-[10px] uppercase text-[var(--ss-subtle)]">Scopes</span>
                      <div className="flex flex-wrap gap-2">
                        {PAT_SCOPES.map(({ id, label }) => {
                          const active = tokenScopes.includes(id);
                          return (
                            <label
                              key={id}
                              className={cn(
                                'inline-flex items-center gap-1.5 rounded border px-2.5 py-1 font-mono text-[11px] cursor-pointer',
                                active
                                  ? 'border-[var(--ss-primary)] bg-[var(--ss-primary-wash)] text-[var(--ss-primary)]'
                                  : 'border-[var(--ss-border)] bg-[var(--ss-surface)] text-[var(--ss-muted)]',
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={active}
                                disabled={!canManage}
                                onChange={(e) =>
                                  setTokenScopes((prev) =>
                                    e.target.checked ? [...prev, id] : prev.filter((s) => s !== id),
                                  )
                                }
                                className="accent-[var(--ss-primary)]"
                              />
                              {label}
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    <label className="block space-y-1 text-xs">
                      <span className="font-mono text-[10px] uppercase text-[var(--ss-subtle)]">
                        Expires in (days)
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={365}
                        value={tokenExpiry}
                        disabled={!canManage}
                        onChange={(e) => setTokenExpiry(e.target.value)}
                        className="h-9 w-32 rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 font-mono text-xs"
                      />
                    </label>

                    <button
                      type="submit"
                      disabled={!canManage || tokenBusy || !tokenScopes.length}
                      className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--ss-primary)] px-4 text-xs font-semibold text-white hover:bg-[var(--ss-primary-hover)] disabled:opacity-45"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {tokenBusy ? 'Minting…' : 'Generate Personal Access Token'}
                    </button>
                  </form>

                  <div className="xl:col-span-7 space-y-4">
                    {freshToken && (
                      <div className="rounded-lg border border-[var(--ss-primary)] bg-[var(--ss-primary-wash)] p-4 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <strong className="font-mono text-xs text-[var(--ss-primary)]">
                            ONE-TIME TOKEN SECRET — SAVE NOW
                          </strong>
                          <button
                            type="button"
                            onClick={() => void copyText('pat', freshToken.token)}
                            className="inline-flex items-center gap-1 rounded border border-[var(--ss-primary-border)] bg-[var(--ss-surface)] px-2.5 py-1 font-mono text-[11px] font-medium text-[var(--ss-text)]"
                          >
                            {copiedKey === 'pat' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                            {copiedKey === 'pat' ? 'Copied' : 'Copy secret'}
                          </button>
                        </div>
                        <code className="block break-all rounded border border-[var(--ss-border)] bg-[var(--ss-surface)] p-2.5 font-mono text-xs text-[var(--ss-text)]">
                          {freshToken.token}
                        </code>
                        <p className="text-[11px] text-[var(--ss-muted)]">
                          Store this in GitHub Actions as <code>SYNTHESIFT_TOKEN</code>. It cannot be viewed again after leaving this page.
                        </p>
                      </div>
                    )}

                    <div className="overflow-x-auto rounded-lg border border-[var(--ss-border)]">
                      <table className="w-full border-collapse text-left text-xs">
                        <thead className="border-b border-[var(--ss-border)] bg-[var(--ss-surface-subtle)] font-mono text-[10px] uppercase text-[var(--ss-muted)]">
                          <tr>
                            <th className="px-3 py-2.5">Name</th>
                            <th className="px-3 py-2.5">Prefix</th>
                            <th className="px-3 py-2.5">Scopes</th>
                            <th className="px-3 py-2.5">Status</th>
                            <th className="px-3 py-2.5 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--ss-border)] font-mono text-[11px]">
                          {tokens.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="px-3 py-6 text-center font-sans text-xs text-[var(--ss-muted)]">
                                No Personal Access Tokens minted for this workspace yet.
                              </td>
                            </tr>
                          ) : (
                            tokens.map((tok) => (
                              <tr key={tok.id}>
                                <td className="px-3 py-2.5 font-semibold text-[var(--ss-text)]">
                                  {tok.name}
                                  <span className="block font-normal text-[10px] text-[var(--ss-subtle)]">
                                    by {tok.created_by}
                                  </span>
                                </td>
                                <td className="px-3 py-2.5 text-[var(--ss-muted)]">{tok.token_prefix}…</td>
                                <td className="px-3 py-2.5">{tok.scopes.join(', ')}</td>
                                <td className="px-3 py-2.5">
                                  <span
                                    className={cn(
                                      'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                                      tok.is_revoked
                                        ? 'bg-[var(--ss-danger-wash)] text-[var(--ss-danger)]'
                                        : 'bg-[var(--ss-pass-wash)] text-[var(--ss-pass)]',
                                    )}
                                  >
                                    {tok.is_revoked ? 'revoked' : 'active'}
                                  </span>
                                </td>
                                <td className="px-3 py-2.5 text-right">
                                  {canManage && !tok.is_revoked && (
                                    <button
                                      type="button"
                                      onClick={() => void handleRevokeToken(tok.id)}
                                      className="rounded border border-[var(--ss-danger)]/35 px-2 py-1 text-[10px] text-[var(--ss-danger)] hover:bg-[var(--ss-danger-wash)]"
                                    >
                                      Revoke
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* Section B: Interactive CI/CD Quality Gate Runner & GitHub Actions Generator */}
                <div className="border-t border-[var(--ss-border)] pt-6 grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
                  <div className="xl:col-span-6 rounded-lg border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-4 sm:p-5 space-y-4">
                    <div className="flex items-center gap-2">
                      <TerminalSquare className="h-4 w-4 text-[var(--ss-primary)]" />
                      <div>
                        <h3 className="text-sm font-semibold text-[var(--ss-text)]">
                          Interactive CI/CD Quality Gate Simulator
                        </h3>
                        <p className="text-xs text-[var(--ss-muted)]">
                          Test the exact HTTP 200 / HTTP 422 headless gate endpoint before adding it to GitHub Actions.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <label className="space-y-1">
                        <span className="block font-mono text-[10px] uppercase text-[var(--ss-subtle)]">Project</span>
                        <select
                          aria-label="CI gate project"
                          value={projectId}
                          onChange={(e) => setProjectId(e.target.value)}
                          className="h-9 w-full rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 font-mono text-xs"
                        >
                          {projects.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </label>

                      <label className="space-y-1">
                        <span className="block font-mono text-[10px] uppercase text-[var(--ss-subtle)]">Candidate Dataset</span>
                        <select
                          aria-label="CI gate dataset"
                          value={gateDatasetId}
                          onChange={(e) => setGateDatasetId(e.target.value)}
                          className="h-9 w-full rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 font-mono text-xs"
                        >
                          {!datasets.length && <option value="">No ready datasets</option>}
                          {datasets.map((d) => (
                            <option key={d.id} value={d.id}>{d.filename}</option>
                          ))}
                        </select>
                      </label>

                      <label className="space-y-1">
                        <span className="block font-mono text-[10px] uppercase text-[var(--ss-subtle)]">
                          Data Contract (Optional)
                        </span>
                        <select
                          aria-label="CI gate contract"
                          value={gateContractId}
                          onChange={(e) => setGateContractId(e.target.value)}
                          className="h-9 w-full rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 font-mono text-xs"
                        >
                          <option value="">None</option>
                          {contracts.map((c) => (
                            <option key={c.id} value={c.id}>{c.name} (v{c.version})</option>
                          ))}
                        </select>
                      </label>

                      <label className="space-y-1">
                        <span className="block font-mono text-[10px] uppercase text-[var(--ss-subtle)]">
                          Drift Baseline (Optional)
                        </span>
                        <select
                          aria-label="CI gate baseline"
                          value={gateBaselineId}
                          onChange={(e) => setGateBaselineId(e.target.value)}
                          className="h-9 w-full rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 font-mono text-xs"
                        >
                          <option value="">Skip ML drift check</option>
                          {datasets.map((d) => (
                            <option key={d.id} value={d.id}>{d.filename}</option>
                          ))}
                        </select>
                      </label>

                      <label className="space-y-1">
                        <span className="block font-mono text-[10px] uppercase text-[var(--ss-subtle)]">
                          Min Quality Score (0..100)
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={gateMinScore}
                          onChange={(e) => setGateMinScore(e.target.value)}
                          className="h-9 w-full rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 font-mono text-xs"
                        />
                      </label>

                      <label className="flex items-center gap-2 pt-5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={gateFailPii}
                          onChange={(e) => setGateFailPii(e.target.checked)}
                          className="h-4 w-4 accent-[var(--ss-primary)]"
                        />
                        <span className="font-mono text-xs text-[var(--ss-text)]">Fail gate on any PII</span>
                      </label>
                    </div>

                    <button
                      type="button"
                      disabled={!canManage || gateBusy || !gateDatasetId}
                      onClick={() => void handleRunCiGate()}
                      className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--ss-primary)] px-4 text-xs font-semibold text-white hover:bg-[var(--ss-primary-hover)] disabled:opacity-45"
                    >
                      <Play className="h-3.5 w-3.5" />
                      {gateBusy ? 'Running CI/CD Gate…' : 'Run CI/CD Gate'}
                    </button>

                    {gateVerdict && (
                      <div className="space-y-3 pt-2 border-t border-[var(--ss-border)]">
                        <div
                          className={cn(
                            'flex items-center justify-between gap-2 rounded-md border px-3.5 py-2.5 font-mono text-xs',
                            gateVerdict.verdict === 'passed'
                              ? 'border-[var(--ss-pass)]/35 bg-[var(--ss-pass-wash)] text-[var(--ss-pass)]'
                              : 'border-[var(--ss-danger)]/35 bg-[var(--ss-danger-wash)] text-[var(--ss-danger)]',
                          )}
                        >
                          <span className="inline-flex items-center gap-1.5 font-semibold">
                            {gateVerdict.verdict === 'passed' ? (
                              <CheckCircle2 className="h-4 w-4" />
                            ) : (
                              <XCircle className="h-4 w-4" />
                            )}
                            HTTP {gateVerdict.http_status} · {gateVerdict.verdict.toUpperCase()} (exit {gateVerdict.exit_code})
                          </span>
                          <span>Score {gateVerdict.quality_score}/100</span>
                        </div>

                        <ul className="divide-y divide-[var(--ss-border)] rounded border border-[var(--ss-border)] bg-[var(--ss-surface)] font-mono text-[11px]">
                          {gateVerdict.checks.map((c) => (
                            <li key={c.name} className="flex items-center justify-between gap-2 px-3 py-2">
                              <div>
                                <strong className="text-[var(--ss-text)]">{c.name}</strong>
                                <span className="ml-2 text-[var(--ss-muted)]">
                                  {c.observed} (expected {c.expected})
                                </span>
                              </div>
                              <span
                                className={cn(
                                  'rounded px-1.5 py-0.5 text-[10px] font-semibold',
                                  c.passed
                                    ? 'bg-[var(--ss-pass-wash)] text-[var(--ss-pass)]'
                                    : 'bg-[var(--ss-danger-wash)] text-[var(--ss-danger)]',
                                )}
                              >
                                {c.passed ? 'PASS' : 'FAIL'}
                              </span>
                            </li>
                          ))}
                        </ul>

                        <details className="rounded border border-[var(--ss-border)] bg-[var(--ss-surface)] p-2.5">
                          <summary className="cursor-pointer font-mono text-[11px] font-medium text-[var(--ss-text)]">
                            GitHub PR Comment Markdown Preview
                          </summary>
                          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[10px] text-[var(--ss-muted)]">
                            {gateVerdict.markdown_summary}
                          </pre>
                        </details>
                      </div>
                    )}
                  </div>

                  {/* GitHub Actions Ready-to-Paste Snippet */}
                  <div className="xl:col-span-6 rounded-lg border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-4 sm:p-5 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--ss-subtle)]">
                          .github/workflows/synthesift-data-gate.yml
                        </span>
                        <h3 className="text-sm font-semibold text-[var(--ss-text)]">
                          Drop-In GitHub Actions Workflow
                        </h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => void copyText('gha', ghActionsYaml)}
                        className="inline-flex items-center gap-1 rounded border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--ss-text)] hover:border-[var(--ss-primary)]"
                      >
                        {copiedKey === 'gha' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        {copiedKey === 'gha' ? 'Copied YAML' : 'Copy YAML'}
                      </button>
                    </div>
                    <pre className="overflow-x-auto rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] p-3.5 font-mono text-[11px] leading-relaxed text-[var(--ss-text)]">
                      {ghActionsYaml}
                    </pre>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: SIGNED WEBHOOKS */}
            {tab === 'webhooks' && (
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
                <form
                  onSubmit={(e) => void handleCreateWebhook(e)}
                  className="xl:col-span-5 rounded-lg border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-4 sm:p-5 space-y-4"
                >
                  <div>
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--ss-subtle)]">
                      HMAC-SHA256 OUTBOUND ALERTS
                    </span>
                    <h2 className="mt-0.5 text-sm font-semibold text-[var(--ss-text)]">
                      Register Signed Webhook
                    </h2>
                    <p className="text-xs text-[var(--ss-muted)]">
                      Every delivery is signed with <code>X-SyntheSift-Signature: t=&lt;ts&gt;,v1=&lt;hmac&gt;</code> and protected by SSRF IP blocking.
                    </p>
                  </div>

                  <label className="block space-y-1 text-xs">
                    <span className="font-mono text-[10px] uppercase text-[var(--ss-subtle)]">Endpoint Name</span>
                    <input
                      aria-label="Webhook name"
                      value={whName}
                      onChange={(e) => setWhName(e.target.value)}
                      placeholder="e.g. #data-ops-alerts"
                      disabled={!canManage}
                      required
                      className="h-9 w-full rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 text-xs"
                    />
                  </label>

                  <label className="block space-y-1 text-xs">
                    <span className="font-mono text-[10px] uppercase text-[var(--ss-subtle)]">Destination HTTPS URL</span>
                    <input
                      aria-label="Webhook URL"
                      type="url"
                      value={whUrl}
                      onChange={(e) => setWhUrl(e.target.value)}
                      placeholder="https://hooks.slack.com/services/..."
                      disabled={!canManage}
                      required
                      className="h-9 w-full rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 font-mono text-xs"
                    />
                  </label>

                  <div className="space-y-1.5">
                    <span className="block font-mono text-[10px] uppercase text-[var(--ss-subtle)]">Subscribed Events</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {WEBHOOK_EVENTS.map((ev) => {
                        const checked = whEvents.includes(ev.id);
                        return (
                          <label
                            key={ev.id}
                            className="flex items-center gap-2 rounded border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 py-1.5 text-xs cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!canManage}
                              onChange={(e) =>
                                setWhEvents((prev) =>
                                  e.target.checked ? [...prev, ev.id] : prev.filter((x) => x !== ev.id),
                                )
                              }
                              className="accent-[var(--ss-primary)]"
                            />
                            <span>{ev.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={!canManage || whBusy || !whEvents.length}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--ss-primary)] px-4 text-xs font-semibold text-white hover:bg-[var(--ss-primary-hover)] disabled:opacity-45"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {whBusy ? 'Registering…' : 'Register Webhook'}
                  </button>
                </form>

                <div className="xl:col-span-7 space-y-4">
                  {freshWebhook && (
                    <div className="rounded-lg border border-[var(--ss-primary)] bg-[var(--ss-primary-wash)] p-4 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <strong className="font-mono text-xs text-[var(--ss-primary)]">
                          HMAC SIGNING SECRET — COPY NOW
                        </strong>
                        <button
                          type="button"
                          onClick={() => void copyText('whsec', freshWebhook.signing_secret)}
                          className="inline-flex items-center gap-1 rounded border border-[var(--ss-primary-border)] bg-[var(--ss-surface)] px-2.5 py-1 font-mono text-[11px]"
                        >
                          <Copy className="h-3 w-3" />
                          {copiedKey === 'whsec' ? 'Copied' : 'Copy secret'}
                        </button>
                      </div>
                      <code className="block break-all rounded border border-[var(--ss-border)] bg-[var(--ss-surface)] p-2 font-mono text-xs">
                        {freshWebhook.signing_secret}
                      </code>
                    </div>
                  )}

                  {webhooks.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-[var(--ss-border-strong)] p-8 text-center text-xs text-[var(--ss-muted)]">
                      No webhooks configured yet. Register an endpoint on the left to receive signed alerts on failed quality gates or ML drift.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {webhooks.map((ep) => (
                        <article
                          key={ep.id}
                          className="rounded-lg border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-4 space-y-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <strong className="text-sm font-semibold text-[var(--ss-text)]">{ep.name}</strong>
                                <span
                                  className={cn(
                                    'rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase',
                                    ep.is_active
                                      ? 'bg-[var(--ss-pass-wash)] text-[var(--ss-pass)]'
                                      : 'bg-[var(--ss-surface-subtle)] text-[var(--ss-muted)]',
                                  )}
                                >
                                  {ep.is_active ? 'active' : 'paused'}
                                </span>
                              </div>
                              <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--ss-muted)]">
                                {ep.url}
                              </p>
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {ep.events.map((ev) => (
                                  <span
                                    key={ev}
                                    className="rounded border border-[var(--ss-border)] bg-[var(--ss-surface)] px-1.5 py-px font-mono text-[10px] text-[var(--ss-muted)]"
                                  >
                                    {ev}
                                  </span>
                                ))}
                              </div>
                            </div>

                            {canManage && (
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => void handleTestWebhook(ep.id)}
                                  className="inline-flex items-center gap-1 rounded border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 py-1 font-mono text-[11px] hover:border-[var(--ss-primary)]"
                                >
                                  <Send className="h-3 w-3" />
                                  Dry-run test
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleToggleWebhook(ep)}
                                  className="rounded border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2 py-1 font-mono text-[11px]"
                                >
                                  {ep.is_active ? 'Pause' : 'Enable'}
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Delete webhook ${ep.name}`}
                                  onClick={() => void handleDeleteWebhook(ep.id)}
                                  className="rounded p-1.5 text-[var(--ss-muted)] hover:bg-[var(--ss-danger-wash)] hover:text-[var(--ss-danger)]"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )}
                          </div>

                          {lastSignature?.webhookId === ep.id && (
                            <div className="rounded border border-[var(--ss-border)] bg-[var(--ss-surface)] p-2.5 font-mono text-[10px] break-all text-[var(--ss-muted)]">
                              <strong className="text-[var(--ss-text)]">X-SyntheSift-Signature: </strong>
                              {lastSignature.sig}
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={() => void handleInspectDeliveries(ep.id)}
                            className="font-mono text-[11px] text-[var(--ss-primary)] hover:underline"
                          >
                            {expandedWhId === ep.id ? 'Hide delivery logs' : 'Inspect recent deliveries →'}
                          </button>

                          {expandedWhId === ep.id && (
                            <div className="overflow-x-auto rounded border border-[var(--ss-border)] bg-[var(--ss-surface)]">
                              <table className="w-full border-collapse text-left font-mono text-[11px]">
                                <thead className="border-b border-[var(--ss-border)] bg-[var(--ss-surface-subtle)] text-[10px] uppercase text-[var(--ss-muted)]">
                                  <tr>
                                    <th className="px-2.5 py-1.5">Event</th>
                                    <th className="px-2.5 py-1.5">Status</th>
                                    <th className="px-2.5 py-1.5">HTTP</th>
                                    <th className="px-2.5 py-1.5">Time</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-[var(--ss-border)]">
                                  {deliveries.length === 0 ? (
                                    <tr>
                                      <td colSpan={4} className="px-2.5 py-3 text-center text-[var(--ss-muted)]">
                                        No deliveries recorded yet.
                                      </td>
                                    </tr>
                                  ) : (
                                    deliveries.map((d) => (
                                      <tr key={d.id}>
                                        <td className="px-2.5 py-1.5">{d.event_type}</td>
                                        <td className="px-2.5 py-1.5 uppercase">{d.status}</td>
                                        <td className="px-2.5 py-1.5">{d.http_status ?? '—'}</td>
                                        <td className="px-2.5 py-1.5 text-[var(--ss-subtle)]">
                                          {formatDateTime(d.created_at)}
                                        </td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: IMMUTABLE AUDIT TRAIL */}
            {tab === 'audit' && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-[var(--ss-text)]">
                      Workspace Governance Audit Trail
                    </h2>
                    <p className="text-xs text-[var(--ss-muted)]">
                      Append-only record of PAT lifecycle, PII unmasking, Data Contract gates, Pipeline approvals, and CI/CD runs (zero raw rows stored).
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label="Filter audit action"
                      value={auditAction}
                      onChange={(e) => {
                        setAuditAction(e.target.value);
                        void refreshAudit(e.target.value, auditOutcome);
                      }}
                      className="h-8 rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2.5 font-mono text-xs"
                    >
                      <option value="">All actions</option>
                      <option value="ci_gate.evaluated">ci_gate.evaluated</option>
                      <option value="contract.evaluated">contract.evaluated</option>
                      <option value="pipeline.applied">pipeline.applied</option>
                      <option value="pii.unmasked">pii.unmasked</option>
                      <option value="pat.created">pat.created</option>
                      <option value="pat.revoked">pat.revoked</option>
                      <option value="webhook.created">webhook.created</option>
                      <option value="webhook.tested">webhook.tested</option>
                    </select>

                    <select
                      aria-label="Filter audit outcome"
                      value={auditOutcome}
                      onChange={(e) => {
                        setAuditOutcome(e.target.value);
                        void refreshAudit(auditAction, e.target.value);
                      }}
                      className="h-8 rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2.5 font-mono text-xs"
                    >
                      <option value="">All outcomes</option>
                      <option value="success">success</option>
                      <option value="warning">warning</option>
                      <option value="blocked">blocked</option>
                      <option value="failed">failed</option>
                    </select>

                    <button
                      type="button"
                      onClick={() => void refreshAudit()}
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2.5 text-xs"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Refresh
                    </button>

                    <button
                      type="button"
                      onClick={exportAuditJson}
                      disabled={!auditLogs.length}
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2.5 text-xs disabled:opacity-45"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Export JSON
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-lg border border-[var(--ss-border)]">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="border-b border-[var(--ss-border)] bg-[var(--ss-surface-subtle)] font-mono text-[10px] uppercase text-[var(--ss-muted)]">
                      <tr>
                        <th className="px-3 py-2.5">Timestamp</th>
                        <th className="px-3 py-2.5">Actor</th>
                        <th className="px-3 py-2.5">Action</th>
                        <th className="px-3 py-2.5">Resource</th>
                        <th className="px-3 py-2.5">Outcome</th>
                        <th className="px-3 py-2.5">Metadata</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--ss-border)] font-mono text-[11px]">
                      {auditLogs.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-3 py-8 text-center font-sans text-xs text-[var(--ss-muted)]">
                            <ShieldAlert className="mx-auto mb-1.5 h-4 w-4 text-[var(--ss-subtle)]" />
                            No governance events recorded for this filter yet.
                          </td>
                        </tr>
                      ) : (
                        auditLogs.map((ev) => (
                          <tr key={ev.id}>
                            <td className="px-3 py-2.5 whitespace-nowrap text-[var(--ss-subtle)]">
                              {formatDateTime(ev.created_at)}
                            </td>
                            <td className="px-3 py-2.5 font-semibold text-[var(--ss-text)]">
                              {ev.actor_label}
                            </td>
                            <td className="px-3 py-2.5 text-[var(--ss-primary)]">{ev.action}</td>
                            <td className="px-3 py-2.5 text-[var(--ss-muted)]">
                              {ev.resource_type}
                              {ev.resource_id ? `:${ev.resource_id.slice(0, 8)}` : ''}
                            </td>
                            <td className="px-3 py-2.5">
                              <span
                                className={cn(
                                  'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                                  ev.outcome === 'success'
                                    ? 'bg-[var(--ss-pass-wash)] text-[var(--ss-pass)]'
                                    : ev.outcome === 'warning'
                                      ? 'bg-[var(--ss-warn-wash)] text-[var(--ss-warn)]'
                                      : 'bg-[var(--ss-danger-wash)] text-[var(--ss-danger)]',
                                )}
                              >
                                {ev.outcome}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 max-w-[320px] truncate text-[var(--ss-muted)]">
                              {JSON.stringify(ev.metadata)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
