'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  Copy,
  Download,
  FileCheck2,
  Play,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import {
  autoGenerateContract,
  createContract,
  deleteContract,
  evaluateContractGate,
  exportContractYaml,
  fetchContractRuns,
  fetchContracts,
  importContractYaml,
  updateContract,
} from '@/lib/client-api';
import { cn, formatDateTime, formatNumber } from '@/lib/cn';
import type {
  ContractRule,
  ContractRuleType,
  ContractRunRecord,
  DataContractRecord,
} from '@/lib/types';

type Props = {
  workspaceId: string;
  projectId: string;
  datasetId: string;
  columns: string[];
  canEdit: boolean;
  datasetReady: boolean;
};

type RuleCatalogItem = {
  type: ContractRuleType;
  label: string;
  needsColumn: boolean;
  supportsWildcard?: boolean;
};

const RULE_CATALOG: RuleCatalogItem[] = [
  { type: 'expect_column_to_exist', label: 'Column exists', needsColumn: true },
  { type: 'expect_column_not_null', label: 'Column not null', needsColumn: true },
  { type: 'expect_column_unique', label: 'Column unique', needsColumn: true },
  { type: 'expect_column_values_between', label: 'Values between [min, max]', needsColumn: true },
  { type: 'expect_column_values_in_set', label: 'Values in allowed set', needsColumn: true },
  { type: 'expect_column_regex_match', label: 'Regex pattern match', needsColumn: true },
  { type: 'expect_column_no_pii', label: 'Zero PII detected', needsColumn: true, supportsWildcard: true },
  {
    type: 'expect_column_no_whitespace_padding',
    label: 'No whitespace padding',
    needsColumn: true,
    supportsWildcard: true,
  },
  { type: 'expect_table_row_count_between', label: 'Table row count between', needsColumn: false },
  { type: 'expect_column_mean_between', label: 'Column mean between', needsColumn: true },
];

function defaultRuleForType(type: ContractRuleType, firstCol: string): ContractRule {
  const col = firstCol || 'id';
  switch (type) {
    case 'expect_table_row_count_between':
      return { type, severity: 'error', min_rows: 1, max_rows: 100000 };
    case 'expect_column_not_null':
      return { type, column: col, severity: 'error', max_null_percent: 0 };
    case 'expect_column_values_between':
      return { type, column: col, severity: 'warning', min_value: 0, max_value: 10000, mostly: 0.98 };
    case 'expect_column_values_in_set':
      return { type, column: col, severity: 'warning', allowed_values: ['active', 'trial'], case_sensitive: false, mostly: 1.0 };
    case 'expect_column_regex_match':
      return { type, column: col, severity: 'warning', pattern: '^[A-Za-z0-9_-]+$', mostly: 0.95 };
    case 'expect_column_mean_between':
      return { type, column: col, severity: 'warning', min_mean: 0, max_mean: 1000 };
    case 'expect_column_no_pii':
      return { type, column: col, severity: 'error' };
    case 'expect_column_no_whitespace_padding':
      return { type, column: '*', severity: 'warning' };
    case 'expect_column_unique':
      return { type, column: col, severity: 'error' };
    case 'expect_column_to_exist':
    default:
      return { type: 'expect_column_to_exist', column: col, severity: 'error' };
  }
}

function parseOptionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function ContractsPanel({
  workspaceId,
  projectId,
  datasetId,
  columns,
  canEdit,
  datasetReady,
}: Props) {
  const [contracts, setContracts] = useState<DataContractRecord[]>([]);
  const [runs, setRuns] = useState<ContractRunRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [mode, setMode] = useState<'visual' | 'yaml'>('visual');

  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftRules, setDraftRules] = useState<ContractRule[]>([
    defaultRuleForType('expect_column_to_exist', columns[0] ?? 'id'),
  ]);
  const [yamlText, setYamlText] = useState('');

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([
      fetchContracts(workspaceId, projectId),
      fetchContractRuns(workspaceId, projectId, datasetId),
    ])
      .then(([cList, rList]) => {
        if (!active) return;
        setContracts(cList);
        setRuns(rList);
        if (rList.length > 0) {
          setActiveRunId((prev) => (prev && rList.some((r) => r.id === prev) ? prev : rList[0].id));
        }
        if (cList.length > 0) {
          const current = cList[0];
          setSelectedId((prev) => {
            const keep = prev && cList.some((c) => c.id === prev);
            if (keep) return prev;
            setDraftName(current.name);
            setDraftDescription(current.description);
            setDraftRules(current.rules);
            return current.id;
          });
        }
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : 'Unable to load Data Contracts.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workspaceId, projectId, datasetId]);

  const selectedContract = contracts.find((c) => c.id === selectedId) ?? null;
  const activeRun = runs.find((r) => r.id === activeRunId) ?? runs[0] ?? null;

  function selectContract(item: DataContractRecord) {
    setSelectedId(item.id);
    setDraftName(item.name);
    setDraftDescription(item.description);
    setDraftRules(item.rules.map((r) => ({ ...r })));
    setError('');
    setNotice('');
  }

  function startNewContract() {
    setSelectedId(null);
    setDraftName('');
    setDraftDescription('');
    setDraftRules([defaultRuleForType('expect_column_to_exist', columns[0] ?? 'id')]);
    setYamlText('');
    setError('');
    setNotice('');
  }

  async function handleAutoGenerate() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const generated = await autoGenerateContract(workspaceId, projectId, datasetId);
      if (!generated.rules.length) {
        setError(generated.reason || 'Profile the dataset first to auto-generate rules.');
        return;
      }
      setSelectedId(null);
      setDraftName(generated.name || 'dataset_contract');
      setDraftDescription('Auto-generated starter Data Contract from verified dataset profile.');
      setDraftRules(generated.rules);
      setYamlText(generated.yaml);
      setNotice(`Generated ${generated.rules.length} starter rules. Review and click Save contract.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to auto-generate contract.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveVisual() {
    if (!canEdit) return;
    const trimmedName = draftName.trim();
    if (!trimmedName) {
      setError('Provide a contract name before saving.');
      return;
    }
    if (!draftRules.length) {
      setError('Add at least one expectation rule.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      let saved: DataContractRecord;
      if (selectedContract) {
        saved = await updateContract(workspaceId, projectId, selectedContract.id, {
          name: trimmedName,
          description: draftDescription.trim(),
          rules: draftRules,
        });
        setContracts((prev) => prev.map((c) => (c.id === saved.id ? saved : c)));
        setNotice(`Updated "${saved.name}" to v${saved.version}.`);
      } else {
        saved = await createContract(workspaceId, projectId, {
          name: trimmedName,
          description: draftDescription.trim(),
          rules: draftRules,
        });
        setContracts((prev) => [saved, ...prev]);
        setSelectedId(saved.id);
        setNotice(`Saved new Data Contract "${saved.name}" (v${saved.version}).`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save contract.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!canEdit) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await deleteContract(workspaceId, projectId, id);
      const remaining = contracts.filter((c) => c.id !== id);
      setContracts(remaining);
      if (selectedId === id) {
        if (remaining[0]) selectContract(remaining[0]);
        else startNewContract();
      }
      setNotice('Contract removed.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to delete contract.');
    } finally {
      setBusy(false);
    }
  }

  async function handleLoadYaml(contractId: string) {
    setBusy(true);
    setError('');
    try {
      const res = await exportContractYaml(workspaceId, projectId, contractId);
      setYamlText(res.yaml);
      setMode('yaml');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to export contract YAML.');
    } finally {
      setBusy(false);
    }
  }

  async function handleImportYaml() {
    if (!canEdit || !yamlText.trim()) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const created = await importContractYaml(workspaceId, projectId, yamlText);
      setContracts((prev) => [created, ...prev]);
      selectContract(created);
      setMode('visual');
      setNotice(`Imported YAML contract "${created.name}" (${created.rules.length} rules).`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'YAML import failed. Check syntax and rule fields.');
    } finally {
      setBusy(false);
    }
  }

  async function handleEvaluate(contractId: string) {
    if (!canEdit || !datasetReady) return;
    setEvaluating(true);
    setError('');
    setNotice('');
    try {
      const run = await evaluateContractGate(workspaceId, projectId, datasetId, contractId);
      setRuns((prev) => [run, ...prev]);
      setActiveRunId(run.id);
      setNotice(
        `Contract gate finished: ${run.status.toUpperCase()} (${run.passed_rules}/${run.total_rules} rules passed · ${run.pass_rate}%).`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to run contract evaluation.');
    } finally {
      setEvaluating(false);
    }
  }

  function updateRule(idx: number, patch: Partial<ContractRule>) {
    setDraftRules((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function changeRuleType(idx: number, nextType: ContractRuleType) {
    const existingCol = draftRules[idx]?.column || columns[0] || 'id';
    const fresh = defaultRuleForType(nextType, existingCol);
    fresh.severity = draftRules[idx]?.severity ?? fresh.severity;
    setDraftRules((prev) => prev.map((r, i) => (i === idx ? fresh : r)));
  }

  function addRule() {
    setDraftRules((prev) => [...prev, defaultRuleForType('expect_column_not_null', columns[0] ?? 'id')]);
  }

  function removeRule(idx: number) {
    setDraftRules((prev) => prev.filter((_, i) => i !== idx));
  }

  async function copyYaml() {
    if (!yamlText) return;
    try {
      await navigator.clipboard.writeText(yamlText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Clipboard access denied by browser.');
    }
  }

  return (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ss-primary)]">
            QUALITY GATES · YAML & VISUAL EXPECTATIONS
          </span>
          <h2 className="mt-0.5 text-sm font-semibold text-[var(--ss-text)]">
            Declarative Data Contracts
          </h2>
          <p className="text-xs text-[var(--ss-muted)]">
            Define strict schema, nullability, range, regex, and zero-PII expectations, export as Git-ready YAML, and gate datasets deterministically.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-0.5">
            <button
              type="button"
              onClick={() => setMode('visual')}
              className={cn(
                'inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition-colors',
                mode === 'visual'
                  ? 'bg-[var(--ss-surface)] text-[var(--ss-text)] shadow-2xs'
                  : 'text-[var(--ss-muted)] hover:text-[var(--ss-text)]',
              )}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Visual Builder
            </button>
            <button
              type="button"
              onClick={() => {
                if (selectedContract && !yamlText) {
                  void handleLoadYaml(selectedContract.id);
                } else {
                  setMode('yaml');
                }
              }}
              className={cn(
                'inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition-colors',
                mode === 'yaml'
                  ? 'bg-[var(--ss-surface)] text-[var(--ss-text)] shadow-2xs'
                  : 'text-[var(--ss-muted)] hover:text-[var(--ss-text)]',
              )}
            >
              <Code2 className="h-3.5 w-3.5" />
              YAML Editor
            </button>
          </div>

          {canEdit && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleAutoGenerate()}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--ss-primary-border)] bg-[var(--ss-primary-wash)] px-3 text-xs font-medium text-[var(--ss-primary)] hover:opacity-90 disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Auto-generate from profile
            </button>
          )}
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-[var(--ss-danger)]/35 bg-[var(--ss-danger-wash)] px-3.5 py-2.5 text-xs text-[var(--ss-danger)]"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-md border border-[var(--ss-primary-border)] bg-[var(--ss-primary-wash)] px-3.5 py-2.5 text-xs text-[var(--ss-primary)]"
        >
          {notice}
        </p>
      )}

      {/* Main Split: Saved Contracts Sidebar + Active Builder / YAML Editor */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Left: Saved Contracts */}
        <aside className="xl:col-span-4 rounded-lg border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--ss-subtle)]">
              PROJECT CONTRACTS ({contracts.length})
            </span>
            {canEdit && (
              <button
                type="button"
                onClick={startNewContract}
                className="inline-flex items-center gap-1 rounded border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2 py-1 font-mono text-[10px] font-medium text-[var(--ss-text)] hover:border-[var(--ss-primary)]"
              >
                <Plus className="h-3 w-3" />
                New
              </button>
            )}
          </div>

          {loading ? (
            <p className="py-4 font-mono text-xs text-[var(--ss-muted)]">Loading contracts…</p>
          ) : contracts.length === 0 ? (
            <div className="rounded-md border border-dashed border-[var(--ss-border-strong)] p-4 text-center space-y-1.5">
              <FileCheck2 className="mx-auto h-5 w-5 text-[var(--ss-subtle)]" />
              <p className="text-xs font-medium text-[var(--ss-text)]">No saved contracts yet</p>
              <p className="text-[11px] text-[var(--ss-muted)]">
                Auto-generate a starter contract from this dataset’s profile or build rules on the right.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {contracts.map((item) => {
                const isSelected = selectedId === item.id;
                return (
                  <li
                    key={item.id}
                    className={cn(
                      'rounded-md border p-3 transition-colors',
                      isSelected
                        ? 'border-[var(--ss-primary)] bg-[var(--ss-primary-wash)]/45'
                        : 'border-[var(--ss-border)] bg-[var(--ss-surface)] hover:bg-[var(--ss-surface-hover)]',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => selectContract(item)}
                        className="text-left min-w-0 flex-1"
                      >
                        <div className="flex items-center gap-1.5">
                          <strong className="truncate font-mono text-xs font-semibold text-[var(--ss-text)]">
                            {item.name}
                          </strong>
                          <span className="rounded bg-[var(--ss-surface-subtle)] px-1.5 py-px font-mono text-[10px] text-[var(--ss-muted)]">
                            v{item.version}
                          </span>
                        </div>
                        <p className="mt-0.5 font-mono text-[10px] text-[var(--ss-muted)]">
                          {item.rules.length} rule(s)
                          {item.created_by ? ` · by ${item.created_by}` : ''}
                        </p>
                      </button>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          title="View YAML"
                          aria-label={`View YAML for ${item.name}`}
                          onClick={() => void handleLoadYaml(item.id)}
                          className="rounded p-1 text-[var(--ss-muted)] hover:bg-[var(--ss-surface-subtle)] hover:text-[var(--ss-text)]"
                        >
                          <Code2 className="h-3.5 w-3.5" />
                        </button>
                        {canEdit && (
                          <button
                            type="button"
                            title="Delete contract"
                            aria-label={`Delete ${item.name}`}
                            onClick={() => void handleDelete(item.id)}
                            className="rounded p-1 text-[var(--ss-muted)] hover:bg-[var(--ss-danger-wash)] hover:text-[var(--ss-danger)]"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {canEdit && (
                      <div className="mt-2.5 pt-2 border-t border-[var(--ss-border)]/70 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          disabled={evaluating || !datasetReady}
                          onClick={() => void handleEvaluate(item.id)}
                          className="inline-flex h-7 items-center gap-1.5 rounded bg-[var(--ss-primary)] px-2.5 font-mono text-[11px] font-semibold text-white hover:bg-[var(--ss-primary-hover)] disabled:opacity-45"
                        >
                          <Play className="h-3 w-3" />
                          {evaluating ? 'Running gate…' : 'Run Contract Gate'}
                        </button>
                        <a
                          href={`/api/v1/workspaces/${workspaceId}/projects/${projectId}/contracts/${item.id}/yaml?raw=1`}
                          download={`${item.name}.yaml`}
                          className="inline-flex items-center gap-1 font-mono text-[10px] text-[var(--ss-muted)] hover:text-[var(--ss-text)] no-underline"
                        >
                          <Download className="h-3 w-3" />
                          .yaml
                        </a>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* Right: Visual Rule Builder or YAML Editor */}
        <div className="xl:col-span-8 rounded-lg border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-4 sm:p-5 space-y-4">
          {mode === 'visual' ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1 text-xs">
                  <span className="block font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--ss-subtle)]">
                    Contract Name
                  </span>
                  <input
                    aria-label="Contract name"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    placeholder="e.g. billing_sla_v1"
                    disabled={!canEdit}
                    className="h-9 w-full rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 font-mono text-xs text-[var(--ss-text)]"
                  />
                </label>
                <label className="space-y-1 text-xs">
                  <span className="block font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--ss-subtle)]">
                    Description
                  </span>
                  <input
                    aria-label="Contract description"
                    value={draftDescription}
                    onChange={(e) => setDraftDescription(e.target.value)}
                    placeholder="Optional SLA or ingestion invariant notes"
                    disabled={!canEdit}
                    className="h-9 w-full rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 text-xs text-[var(--ss-text)]"
                  />
                </label>
              </div>

              {/* Rules List */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--ss-subtle)]">
                    EXPECTATION RULES ({draftRules.length})
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={addRule}
                      className="inline-flex items-center gap-1 rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 py-1 text-xs font-medium text-[var(--ss-text)] hover:border-[var(--ss-primary)]"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add rule
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  {draftRules.map((rule, idx) => {
                    const meta = RULE_CATALOG.find((c) => c.type === rule.type) ?? RULE_CATALOG[0];
                    return (
                      <div
                        key={idx}
                        className="rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] p-3 space-y-2.5"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[10px] text-[var(--ss-subtle)] w-5">
                            #{idx + 1}
                          </span>
                          <select
                            aria-label={`Rule ${idx + 1} type`}
                            value={rule.type}
                            disabled={!canEdit}
                            onChange={(e) => changeRuleType(idx, e.target.value as ContractRuleType)}
                            className="h-8 flex-1 min-w-[180px] rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 font-mono text-[11px]"
                          >
                            {RULE_CATALOG.map((item) => (
                              <option key={item.type} value={item.type}>
                                {item.label}
                              </option>
                            ))}
                          </select>

                          {meta.needsColumn && (
                            <select
                              aria-label={`Rule ${idx + 1} column`}
                              value={rule.column ?? ''}
                              disabled={!canEdit}
                              onChange={(e) => updateRule(idx, { column: e.target.value })}
                              className="h-8 min-w-[140px] rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 font-mono text-[11px]"
                            >
                              {meta.supportsWildcard && <option value="*">* (all columns)</option>}
                              {columns.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                              {rule.column &&
                                rule.column !== '*' &&
                                !columns.includes(rule.column) && (
                                  <option value={rule.column}>{rule.column}</option>
                                )}
                            </select>
                          )}

                          <select
                            aria-label={`Rule ${idx + 1} severity`}
                            value={rule.severity}
                            disabled={!canEdit}
                            onChange={(e) =>
                              updateRule(idx, { severity: e.target.value as 'error' | 'warning' })
                            }
                            className="h-8 rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 font-mono text-[11px]"
                          >
                            <option value="error">Error (blocks)</option>
                            <option value="warning">Warning</option>
                          </select>

                          {canEdit && draftRules.length > 1 && (
                            <button
                              type="button"
                              aria-label={`Remove rule ${idx + 1}`}
                              onClick={() => removeRule(idx)}
                              className="rounded p-1.5 text-[var(--ss-muted)] hover:bg-[var(--ss-danger-wash)] hover:text-[var(--ss-danger)]"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>

                        {/* Rule-specific parameters */}
                        {rule.type === 'expect_column_not_null' && (
                          <div className="flex items-center gap-2 pl-7 text-[11px] font-mono">
                            <label className="flex items-center gap-1.5 text-[var(--ss-muted)]">
                              max_null_%
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step={0.5}
                                disabled={!canEdit}
                                value={rule.max_null_percent ?? 0}
                                onChange={(e) =>
                                  updateRule(idx, { max_null_percent: Number(e.target.value) || 0 })
                                }
                                className="h-7 w-20 rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 text-[var(--ss-text)]"
                              />
                            </label>
                          </div>
                        )}

                        {rule.type === 'expect_column_values_between' && (
                          <div className="flex flex-wrap items-center gap-3 pl-7 text-[11px] font-mono">
                            <label className="flex items-center gap-1.5 text-[var(--ss-muted)]">
                              min
                              <input
                                type="number"
                                disabled={!canEdit}
                                value={rule.min_value ?? ''}
                                onChange={(e) =>
                                  updateRule(idx, { min_value: parseOptionalNumber(e.target.value) })
                                }
                                className="h-7 w-24 rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 text-[var(--ss-text)]"
                              />
                            </label>
                            <label className="flex items-center gap-1.5 text-[var(--ss-muted)]">
                              max
                              <input
                                type="number"
                                disabled={!canEdit}
                                value={rule.max_value ?? ''}
                                onChange={(e) =>
                                  updateRule(idx, { max_value: parseOptionalNumber(e.target.value) })
                                }
                                className="h-7 w-24 rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 text-[var(--ss-text)]"
                              />
                            </label>
                            <label className="flex items-center gap-1.5 text-[var(--ss-muted)]">
                              mostly (0..1)
                              <input
                                type="number"
                                min={0}
                                max={1}
                                step={0.01}
                                disabled={!canEdit}
                                value={rule.mostly ?? 1}
                                onChange={(e) =>
                                  updateRule(idx, { mostly: Number(e.target.value) || 0 })
                                }
                                className="h-7 w-20 rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 text-[var(--ss-text)]"
                              />
                            </label>
                          </div>
                        )}

                        {rule.type === 'expect_column_values_in_set' && (
                          <div className="flex flex-wrap items-center gap-3 pl-7 text-[11px] font-mono">
                            <label className="flex-1 min-w-[200px] flex items-center gap-1.5 text-[var(--ss-muted)]">
                              allowed (csv)
                              <input
                                type="text"
                                disabled={!canEdit}
                                value={(rule.allowed_values ?? []).join(', ')}
                                onChange={(e) =>
                                  updateRule(idx, {
                                    allowed_values: e.target.value
                                      .split(',')
                                      .map((v) => v.trim())
                                      .filter(Boolean),
                                  })
                                }
                                className="h-7 flex-1 rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 text-[var(--ss-text)]"
                              />
                            </label>
                            <label className="flex items-center gap-1.5 text-[var(--ss-muted)]">
                              mostly
                              <input
                                type="number"
                                min={0}
                                max={1}
                                step={0.01}
                                disabled={!canEdit}
                                value={rule.mostly ?? 1}
                                onChange={(e) =>
                                  updateRule(idx, { mostly: Number(e.target.value) || 0 })
                                }
                                className="h-7 w-20 rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 text-[var(--ss-text)]"
                              />
                            </label>
                          </div>
                        )}

                        {rule.type === 'expect_column_regex_match' && (
                          <div className="flex flex-wrap items-center gap-3 pl-7 text-[11px] font-mono">
                            <label className="flex-1 min-w-[200px] flex items-center gap-1.5 text-[var(--ss-muted)]">
                              regex
                              <input
                                type="text"
                                disabled={!canEdit}
                                value={rule.pattern ?? ''}
                                onChange={(e) => updateRule(idx, { pattern: e.target.value })}
                                className="h-7 flex-1 rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 text-[var(--ss-text)]"
                              />
                            </label>
                            <label className="flex items-center gap-1.5 text-[var(--ss-muted)]">
                              mostly
                              <input
                                type="number"
                                min={0}
                                max={1}
                                step={0.01}
                                disabled={!canEdit}
                                value={rule.mostly ?? 1}
                                onChange={(e) =>
                                  updateRule(idx, { mostly: Number(e.target.value) || 0 })
                                }
                                className="h-7 w-20 rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 text-[var(--ss-text)]"
                              />
                            </label>
                          </div>
                        )}

                        {rule.type === 'expect_table_row_count_between' && (
                          <div className="flex flex-wrap items-center gap-3 pl-7 text-[11px] font-mono">
                            <label className="flex items-center gap-1.5 text-[var(--ss-muted)]">
                              min_rows
                              <input
                                type="number"
                                min={0}
                                disabled={!canEdit}
                                value={rule.min_rows ?? ''}
                                onChange={(e) =>
                                  updateRule(idx, { min_rows: parseOptionalNumber(e.target.value) })
                                }
                                className="h-7 w-24 rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 text-[var(--ss-text)]"
                              />
                            </label>
                            <label className="flex items-center gap-1.5 text-[var(--ss-muted)]">
                              max_rows
                              <input
                                type="number"
                                min={0}
                                disabled={!canEdit}
                                value={rule.max_rows ?? ''}
                                onChange={(e) =>
                                  updateRule(idx, { max_rows: parseOptionalNumber(e.target.value) })
                                }
                                className="h-7 w-24 rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 text-[var(--ss-text)]"
                              />
                            </label>
                          </div>
                        )}

                        {rule.type === 'expect_column_mean_between' && (
                          <div className="flex flex-wrap items-center gap-3 pl-7 text-[11px] font-mono">
                            <label className="flex items-center gap-1.5 text-[var(--ss-muted)]">
                              min_mean
                              <input
                                type="number"
                                disabled={!canEdit}
                                value={rule.min_mean ?? ''}
                                onChange={(e) =>
                                  updateRule(idx, { min_mean: parseOptionalNumber(e.target.value) })
                                }
                                className="h-7 w-24 rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 text-[var(--ss-text)]"
                              />
                            </label>
                            <label className="flex items-center gap-1.5 text-[var(--ss-muted)]">
                              max_mean
                              <input
                                type="number"
                                disabled={!canEdit}
                                value={rule.max_mean ?? ''}
                                onChange={(e) =>
                                  updateRule(idx, { max_mean: parseOptionalNumber(e.target.value) })
                                }
                                className="h-7 w-24 rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 text-[var(--ss-text)]"
                              />
                            </label>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {canEdit && (
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--ss-border)]">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleSaveVisual()}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--ss-primary)] px-4 text-xs font-semibold text-white hover:bg-[var(--ss-primary-hover)] disabled:opacity-50"
                  >
                    <Save className="h-3.5 w-3.5" />
                    {selectedContract ? `Update v${selectedContract.version}` : 'Save contract'}
                  </button>

                  {selectedContract && (
                    <button
                      type="button"
                      disabled={evaluating || !datasetReady}
                      onClick={() => void handleEvaluate(selectedContract.id)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--ss-primary-border)] bg-[var(--ss-primary-wash)] px-4 text-xs font-semibold text-[var(--ss-primary)] hover:opacity-90 disabled:opacity-45"
                    >
                      <Play className="h-3.5 w-3.5" />
                      {evaluating ? 'Evaluating…' : 'Evaluate on this dataset'}
                    </button>
                  )}
                </div>
              )}
            </>
          ) : (
            /* YAML EDITOR MODE */
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--ss-subtle)]">
                  DECLARATIVE YAML SPECIFICATION (synthesift.contract/v1)
                </span>
                <div className="flex items-center gap-2">
                  {selectedContract && (
                    <button
                      type="button"
                      onClick={() => void handleLoadYaml(selectedContract.id)}
                      className="rounded border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 py-1 font-mono text-[11px] text-[var(--ss-text)] hover:border-[var(--ss-primary)]"
                    >
                      Load selected
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void copyYaml()}
                    disabled={!yamlText}
                    className="inline-flex items-center gap-1 rounded border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 py-1 font-mono text-[11px] text-[var(--ss-text)] disabled:opacity-45"
                  >
                    <Copy className="h-3 w-3" />
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              <textarea
                aria-label="Contract YAML specification"
                value={yamlText}
                onChange={(e) => setYamlText(e.target.value)}
                rows={14}
                placeholder={`schema_version: synthesift.contract/v1\nname: production_billing_gate\ndescription: Zero-PII and completeness gate\nrules:\n  - type: expect_column_not_null\n    column: invoice_id\n    max_null_percent: 0.0\n    severity: error`}
                className="w-full rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] p-3 font-mono text-xs leading-relaxed text-[var(--ss-text)]"
              />

              {canEdit && (
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={busy || !yamlText.trim()}
                    onClick={() => void handleImportYaml()}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--ss-primary)] px-4 text-xs font-semibold text-white hover:bg-[var(--ss-primary-hover)] disabled:opacity-45"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Import YAML as contract
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Quality Gate Verdict & Per-Rule Evaluation Table */}
      {activeRun && (
        <section className="space-y-4 rounded-lg border border-[var(--ss-border)] bg-[var(--ss-surface)] p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {activeRun.status === 'passed' ? (
                <CheckCircle2 className="h-5 w-5 text-[var(--ss-pass)] shrink-0" />
              ) : activeRun.status === 'warning' ? (
                <AlertTriangle className="h-5 w-5 text-[var(--ss-warn)] shrink-0" />
              ) : (
                <XCircle className="h-5 w-5 text-[var(--ss-danger)] shrink-0" />
              )}
              <div>
                <div className="flex items-center gap-2">
                  <strong className="font-mono text-xs uppercase tracking-wider text-[var(--ss-text)]">
                    GATE VERDICT: {activeRun.status}
                  </strong>
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase',
                      activeRun.status === 'passed'
                        ? 'bg-[var(--ss-pass-wash)] text-[var(--ss-pass)]'
                        : activeRun.status === 'warning'
                          ? 'bg-[var(--ss-warn-wash)] text-[var(--ss-warn)]'
                          : 'bg-[var(--ss-danger-wash)] text-[var(--ss-danger)]',
                    )}
                  >
                    {activeRun.pass_rate}% pass rate
                  </span>
                </div>
                <p className="mt-0.5 font-mono text-[11px] text-[var(--ss-muted)]">
                  Contract: {activeRun.contract_name} · {activeRun.passed_rules}/{activeRun.total_rules}{' '}
                  passed · {formatDateTime(activeRun.created_at)}
                </p>
              </div>
            </div>

            {runs.length > 1 && (
              <select
                aria-label="Contract run history"
                value={activeRun.id}
                onChange={(e) => setActiveRunId(e.target.value)}
                className="h-8 rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2.5 font-mono text-[11px]"
              >
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.contract_name} · {r.status.toUpperCase()} ({r.pass_rate}%)
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="overflow-x-auto rounded-md border border-[var(--ss-border)]">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="border-b border-[var(--ss-border)] bg-[var(--ss-surface-subtle)] font-mono text-[10px] uppercase text-[var(--ss-muted)]">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Rule</th>
                  <th className="px-3 py-2">Column</th>
                  <th className="px-3 py-2">Expected</th>
                  <th className="px-3 py-2">Observed</th>
                  <th className="px-3 py-2">Failing Rows</th>
                  <th className="px-3 py-2">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ss-border)] font-mono text-[11px]">
                {activeRun.results.map((res) => (
                  <tr key={res.rule_index}>
                    <td className="px-3 py-2.5 text-[var(--ss-subtle)]">{res.rule_index}</td>
                    <td className="px-3 py-2.5 text-[var(--ss-text)]">{res.type}</td>
                    <td className="px-3 py-2.5 text-[var(--ss-muted)]">{res.column ?? 'table'}</td>
                    <td className="px-3 py-2.5 text-[var(--ss-muted)]">{res.expected}</td>
                    <td className="px-3 py-2.5 text-[var(--ss-text)]">{res.observed}</td>
                    <td className="px-3 py-2.5 tabular-nums text-[var(--ss-muted)]">
                      {formatNumber(res.failing_rows)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                          res.passed
                            ? 'bg-[var(--ss-pass-wash)] text-[var(--ss-pass)]'
                            : res.severity === 'error'
                              ? 'bg-[var(--ss-danger-wash)] text-[var(--ss-danger)]'
                              : 'bg-[var(--ss-warn-wash)] text-[var(--ss-warn)]',
                        )}
                      >
                        {res.passed ? 'PASS' : res.severity === 'error' ? 'FAIL' : 'WARN'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
