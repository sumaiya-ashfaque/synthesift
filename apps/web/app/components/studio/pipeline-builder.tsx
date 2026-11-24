'use client';

import { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BookmarkPlus,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  Download,
  GitCompare,
  History,
  Play,
  Plus,
  ShieldCheck,
  Trash2,
  Wand2,
} from 'lucide-react';
import {
  approvePipelineRun,
  createProjectRecipe,
  exportPipelineCode,
  fetchPipelineRuns,
  fetchProjectRecipes,
  previewPipelineRun,
  suggestPipelineSteps,
} from '@/lib/client-api';
import { cn, formatDateTime, formatNumber } from '@/lib/cn';
import type {
  DSLOpName,
  DSLStep,
  PipelineRunRecord,
  TransformationRecipeRecord,
} from '@/lib/types';

type Props = {
  workspaceId: string;
  projectId: string;
  datasetId: string;
  columns: string[];
  canEdit: boolean;
  onDatasetDerived?: (derivedDatasetId: string) => void;
};

type OpCatalogItem = {
  op: DSLOpName;
  label: string;
  group: 'Hygiene' | 'Missing & Types' | 'Rows & Outliers' | 'Schema' | 'Privacy';
  buildDefault: (firstCol: string) => DSLStep;
};

const OP_CATALOG: ReadonlyArray<OpCatalogItem> = [
  {
    op: 'trim_whitespace',
    label: 'Trim whitespace',
    group: 'Hygiene',
    buildDefault: () => ({ op: 'trim_whitespace', column: '*', side: 'both' }),
  },
  {
    op: 'normalize_sentinel_nulls',
    label: 'Normalize sentinel nulls (N/A, null)',
    group: 'Hygiene',
    buildDefault: () => ({ op: 'normalize_sentinel_nulls', column: '*' }),
  },
  {
    op: 'normalize_case',
    label: 'Normalize text case',
    group: 'Hygiene',
    buildDefault: (col) => ({ op: 'normalize_case', column: col, mode: 'title' }),
  },
  {
    op: 'replace_values',
    label: 'Exact value mapping',
    group: 'Hygiene',
    buildDefault: (col) => ({ op: 'replace_values', column: col, mapping: { old_val: 'new_val' } }),
  },
  {
    op: 'regex_replace',
    label: 'Regex replace',
    group: 'Hygiene',
    buildDefault: (col) => ({ op: 'regex_replace', column: col, pattern: '\\s+', replacement: ' ' }),
  },
  {
    op: 'fill_missing',
    label: 'Fill missing values',
    group: 'Missing & Types',
    buildDefault: (col) => ({ op: 'fill_missing', column: col, strategy: 'constant', value: 'UNKNOWN' }),
  },
  {
    op: 'cast_type',
    label: 'Cast column type',
    group: 'Missing & Types',
    buildDefault: (col) => ({ op: 'cast_type', column: col, to_type: 'decimal', on_error: 'keep' }),
  },
  {
    op: 'standardize_date',
    label: 'Standardize dates (ISO-8601)',
    group: 'Missing & Types',
    buildDefault: (col) => ({ op: 'standardize_date', column: col, output_format: '%Y-%m-%d' }),
  },
  {
    op: 'clip_numeric',
    label: 'Clip numeric outliers (IQR / bounds)',
    group: 'Rows & Outliers',
    buildDefault: (col) => ({ op: 'clip_numeric', column: col, use_iqr_bounds: true, min_value: null, max_value: null }),
  },
  {
    op: 'drop_duplicate_rows',
    label: 'Drop duplicate rows',
    group: 'Rows & Outliers',
    buildDefault: () => ({ op: 'drop_duplicate_rows', subset_columns: [], keep: 'first' }),
  },
  {
    op: 'filter_rows',
    label: 'Filter rows by condition',
    group: 'Rows & Outliers',
    buildDefault: (col) => ({ op: 'filter_rows', column: col, condition: 'not_null', value: '' }),
  },
  {
    op: 'rename_column',
    label: 'Rename column',
    group: 'Schema',
    buildDefault: (col) => ({ op: 'rename_column', column: col, new_name: `${col}_clean` }),
  },
  {
    op: 'drop_columns',
    label: 'Drop column(s)',
    group: 'Schema',
    buildDefault: (col) => ({ op: 'drop_columns', columns: col ? [col] : [] }),
  },
  {
    op: 'split_column',
    label: 'Split column by delimiter',
    group: 'Schema',
    buildDefault: (col) => ({ op: 'split_column', column: col, delimiter: '-', new_columns: [`${col}_a`, `${col}_b`] }),
  },
  {
    op: 'mask_pii',
    label: 'Mask / hash PII column',
    group: 'Privacy',
    buildDefault: (col) => ({ op: 'mask_pii', column: col, method: 'partial_mask' }),
  },
];

const OP_LABEL_MAP = Object.fromEntries(OP_CATALOG.map((item) => [item.op, item]));

export function PipelineBuilder({
  workspaceId,
  projectId,
  datasetId,
  columns,
  canEdit,
  onDatasetDerived,
}: Props) {
  const [steps, setSteps] = useState<DSLStep[]>([]);
  const [recipes, setRecipes] = useState<TransformationRecipeRecord[]>([]);
  const [selectedRecipeId, setSelectedRecipeId] = useState<string>('');
  const [runs, setRuns] = useState<PipelineRunRecord[]>([]);
  const [activeRun, setActiveRun] = useState<PipelineRunRecord | null>(null);

  const [rightTab, setRightTab] = useState<'diff' | 'code' | 'history'>('diff');
  const [codeLang, setCodeLang] = useState<'polars' | 'pandas' | 'sql'>('polars');
  const [generatedCode, setGeneratedCode] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);

  const [addOpPicker, setAddOpPicker] = useState<DSLOpName>('trim_whitespace');
  const [saveOpen, setSaveOpen] = useState(false);
  const [recipeName, setRecipeName] = useState('');
  const [outputName, setOutputName] = useState('');
  const [approved, setApproved] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      fetchProjectRecipes(workspaceId, projectId),
      fetchPipelineRuns(workspaceId, projectId, datasetId),
    ]).then(([recRes, runRes]) => {
      if (!active) return;
      if (recRes.status === 'fulfilled') setRecipes(recRes.value);
      if (runRes.status === 'fulfilled') setRuns(runRes.value);
    });
    return () => {
      active = false;
    };
  }, [workspaceId, projectId, datasetId]);

  const firstCol = columns[0] ?? '';

  function addStep(opName: DSLOpName) {
    const def = OP_LABEL_MAP[opName];
    if (!def) return;
    setSteps((prev) => [...prev, def.buildDefault(firstCol)]);
    setActiveRun(null);
    setApproved(false);
    setError('');
  }

  function updateStep(index: number, patch: Partial<DSLStep>) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
    setActiveRun(null);
    setApproved(false);
  }

  function moveStep(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= steps.length) return;
    setSteps((prev) => {
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
    setActiveRun(null);
    setApproved(false);
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
    setActiveRun(null);
    setApproved(false);
  }

  async function handleSuggest() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await suggestPipelineSteps(workspaceId, projectId, datasetId);
      if (res.steps.length === 0) {
        setNotice(res.reason || 'No automatic hygiene steps needed for this dataset.');
      } else {
        setSteps(res.steps);
        setActiveRun(null);
        setApproved(false);
        setNotice(`Drafted ${res.steps.length} deterministic cleaning step(s) from profile findings.`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to suggest starter steps.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveRecipe() {
    if (!recipeName.trim() || !steps.length) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const created = await createProjectRecipe(workspaceId, projectId, {
        name: recipeName.trim(),
        steps,
      });
      setRecipes((prev) => [created, ...prev]);
      setSelectedRecipeId(created.id);
      setRecipeName('');
      setSaveOpen(false);
      setNotice(`Saved reusable recipe “${created.name}”.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save recipe.');
    } finally {
      setBusy(false);
    }
  }

  async function handlePreview() {
    if (!steps.length || !canEdit) return;
    setBusy(true);
    setError('');
    setNotice('');
    setApproved(false);
    try {
      const run = await previewPipelineRun(workspaceId, projectId, datasetId, {
        steps,
        recipe_id: selectedRecipeId || null,
        mask_pii: true,
      });
      setActiveRun(run);
      setRuns((prev) => [run, ...prev.filter((r) => r.id !== run.id)]);
      setRightTab('diff');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Dry-run preview failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove() {
    if (!activeRun || activeRun.status !== 'previewed' || !approved || !canEdit) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const applied = await approvePipelineRun(
        workspaceId,
        projectId,
        datasetId,
        activeRun.id,
        outputName.trim() || undefined,
      );
      setActiveRun(applied);
      setRuns((prev) => prev.map((r) => (r.id === applied.id ? applied : r)));
      setApproved(false);
      setNotice(
        `Materialized immutable derived dataset ${applied.validation.derived_filename ?? ''}. Original file untouched.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Approval failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerateCode(lang: 'polars' | 'pandas' | 'sql') {
    setCodeLang(lang);
    setRightTab('code');
    if (!steps.length) {
      setGeneratedCode('');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await exportPipelineCode(workspaceId, projectId, datasetId, steps, lang);
      setGeneratedCode(res.code);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to generate code.');
    } finally {
      setBusy(false);
    }
  }

  async function copyCode() {
    if (!generatedCode) return;
    await navigator.clipboard.writeText(generatedCode);
    setCopiedCode(true);
    window.setTimeout(() => setCopiedCode(false), 1800);
  }

  const exportBase = `/api/v1/workspaces/${workspaceId}/projects/${projectId}/datasets/${datasetId}/pipelines`;

  return (
    <div className="space-y-4">
      {/* Header Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--ss-text)]">
            Visual Transformation Pipeline (15-op Safe DSL)
          </h2>
          <p className="text-xs text-[var(--ss-muted)]">
            Compose typed operations, preview Git-style cell diffs, export Polars/Pandas/SQL code, and materialize immutable versions.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleSuggest()}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--ss-primary-border)] bg-[var(--ss-primary-wash)] px-3 text-xs font-semibold text-[var(--ss-primary)] hover:opacity-90 disabled:opacity-50"
          >
            <Wand2 className="h-3.5 w-3.5" />
            <span>Auto-draft from findings</span>
          </button>

          {canEdit && (
            <button
              type="button"
              disabled={busy || !steps.length}
              onClick={() => void handlePreview()}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--ss-primary)] px-3.5 text-xs font-semibold text-white hover:bg-[var(--ss-primary-hover)] disabled:opacity-45"
            >
              <Play className="h-3.5 w-3.5" />
              <span>{busy ? 'Running…' : 'Dry-run preview'}</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-[var(--ss-danger)]/35 bg-[var(--ss-danger-wash)] px-3.5 py-2.5 text-xs text-[var(--ss-danger)]"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="rounded-md border border-[var(--ss-primary-border)] bg-[var(--ss-primary-wash)] px-3.5 py-2.5 text-xs text-[var(--ss-primary)]"
        >
          {notice}
        </div>
      )}

      {/* Split IDE Workbench */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* LEFT: Step Composer & Saved Recipes */}
        <div className="xl:col-span-5 space-y-3 rounded-lg border border-[var(--ss-border)] bg-[var(--ss-canvas)]/70 p-4">
          {/* Recipe Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--ss-border)]">
            <select
              aria-label="Load saved recipe"
              value={selectedRecipeId}
              onChange={(e) => {
                const id = e.target.value;
                setSelectedRecipeId(id);
                const found = recipes.find((r) => r.id === id);
                if (found) {
                  setSteps(found.steps);
                  setActiveRun(null);
                  setApproved(false);
                }
              }}
              className="h-8 flex-1 min-w-[160px] rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2 text-xs text-[var(--ss-text)]"
            >
              <option value="">Load saved recipe ({recipes.length})</option>
              {recipes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.steps.length} steps)
                </option>
              ))}
            </select>

            {canEdit && (
              <button
                type="button"
                disabled={!steps.length}
                onClick={() => setSaveOpen((prev) => !prev)}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 text-xs font-medium text-[var(--ss-text)] hover:bg-[var(--ss-surface-hover)] disabled:opacity-45"
              >
                <BookmarkPlus className="h-3.5 w-3.5 text-[var(--ss-primary)]" />
                <span>Save recipe</span>
              </button>
            )}
          </div>

          {saveOpen && (
            <div className="flex items-center gap-2 rounded-md border border-[var(--ss-primary-border)] bg-[var(--ss-surface)] p-2.5">
              <input
                value={recipeName}
                onChange={(e) => setRecipeName(e.target.value)}
                placeholder="Recipe name (e.g. Monthly Billing Clean)"
                className="h-8 flex-1 rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2.5 text-xs"
              />
              <button
                type="button"
                disabled={busy || !recipeName.trim()}
                onClick={() => void handleSaveRecipe()}
                className="h-8 rounded bg-[var(--ss-primary)] px-3 text-xs font-semibold text-white"
              >
                Save
              </button>
            </div>
          )}

          {/* Ordered Step Cards */}
          {steps.length === 0 ? (
            <div className="rounded-md border border-dashed border-[var(--ss-border-strong)] bg-[var(--ss-surface)] p-6 text-center space-y-2">
              <p className="text-xs font-medium text-[var(--ss-text)]">No transformation steps yet</p>
              <p className="text-[11px] text-[var(--ss-muted)]">
                Click <strong>Auto-draft from findings</strong> above or add individual operations below.
              </p>
            </div>
          ) : (
            <ol className="space-y-2.5">
              {steps.map((step, idx) => {
                const meta = OP_LABEL_MAP[step.op];
                const allowWildcard =
                  step.op === 'trim_whitespace' || step.op === 'normalize_sentinel_nulls';
                return (
                  <li
                    key={`${step.op}-${idx}`}
                    className="rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] p-3 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-[10px] font-semibold text-[var(--ss-subtle)] tabular-nums">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        <span className="truncate text-xs font-semibold text-[var(--ss-text)]">
                          {meta?.label ?? step.op}
                        </span>
                        <span className="rounded bg-[var(--ss-surface-subtle)] px-1.5 py-0.5 font-mono text-[9px] uppercase text-[var(--ss-muted)]">
                          {meta?.group}
                        </span>
                      </div>
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => moveStep(idx, -1)}
                          disabled={idx === 0}
                          aria-label="Move step up"
                          className="rounded p-1 text-[var(--ss-muted)] hover:bg-[var(--ss-surface-hover)] disabled:opacity-30"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveStep(idx, 1)}
                          disabled={idx === steps.length - 1}
                          aria-label="Move step down"
                          className="rounded p-1 text-[var(--ss-muted)] hover:bg-[var(--ss-surface-hover)] disabled:opacity-30"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeStep(idx)}
                          aria-label="Remove step"
                          className="rounded p-1 text-[var(--ss-muted)] hover:text-[var(--ss-danger)]"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Step Parameter Editors */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      {step.op !== 'drop_duplicate_rows' && step.op !== 'drop_columns' && (
                        <label className="space-y-1">
                          <span className="block font-mono text-[10px] text-[var(--ss-subtle)]">COLUMN</span>
                          <select
                            value={step.column ?? firstCol}
                            onChange={(e) => updateStep(idx, { column: e.target.value })}
                            className="h-8 w-full rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 font-mono text-[11px]"
                          >
                            {allowWildcard && <option value="*">* (All columns)</option>}
                            {columns.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}

                      {step.op === 'trim_whitespace' && (
                        <label className="space-y-1">
                          <span className="block font-mono text-[10px] text-[var(--ss-subtle)]">SIDE</span>
                          <select
                            value={step.side ?? 'both'}
                            onChange={(e) =>
                              updateStep(idx, { side: e.target.value as 'both' | 'left' | 'right' })
                            }
                            className="h-8 w-full rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 text-xs"
                          >
                            <option value="both">Both sides</option>
                            <option value="left">Leading only</option>
                            <option value="right">Trailing only</option>
                          </select>
                        </label>
                      )}

                      {step.op === 'normalize_case' && (
                        <label className="space-y-1">
                          <span className="block font-mono text-[10px] text-[var(--ss-subtle)]">CASE MODE</span>
                          <select
                            value={step.mode ?? 'title'}
                            onChange={(e) =>
                              updateStep(idx, { mode: e.target.value as 'lower' | 'upper' | 'title' })
                            }
                            className="h-8 w-full rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 text-xs"
                          >
                            <option value="title">Title Case</option>
                            <option value="lower">lowercase</option>
                            <option value="upper">UPPERCASE</option>
                          </select>
                        </label>
                      )}

                      {step.op === 'fill_missing' && (
                        <>
                          <label className="space-y-1">
                            <span className="block font-mono text-[10px] text-[var(--ss-subtle)]">STRATEGY</span>
                            <select
                              value={step.strategy ?? 'constant'}
                              onChange={(e) =>
                                updateStep(idx, {
                                  strategy: e.target.value as DSLStep['strategy'],
                                })
                              }
                              className="h-8 w-full rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 text-xs"
                            >
                              <option value="constant">Constant value</option>
                              <option value="mean">Mean (numeric)</option>
                              <option value="median">Median (numeric)</option>
                              <option value="mode">Most frequent (mode)</option>
                              <option value="ffill">Forward fill</option>
                            </select>
                          </label>
                          {step.strategy === 'constant' && (
                            <label className="space-y-1 sm:col-span-2">
                              <span className="block font-mono text-[10px] text-[var(--ss-subtle)]">VALUE</span>
                              <input
                                value={step.value ?? ''}
                                onChange={(e) => updateStep(idx, { value: e.target.value })}
                                className="h-8 w-full rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 font-mono text-xs"
                              />
                            </label>
                          )}
                        </>
                      )}

                      {step.op === 'cast_type' && (
                        <>
                          <label className="space-y-1">
                            <span className="block font-mono text-[10px] text-[var(--ss-subtle)]">TARGET TYPE</span>
                            <select
                              value={step.to_type ?? 'decimal'}
                              onChange={(e) =>
                                updateStep(idx, { to_type: e.target.value as DSLStep['to_type'] })
                              }
                              className="h-8 w-full rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 text-xs"
                            >
                              <option value="integer">Integer</option>
                              <option value="decimal">Decimal</option>
                              <option value="boolean">Boolean</option>
                              <option value="date">ISO Date</option>
                              <option value="text">Text</option>
                            </select>
                          </label>
                          <label className="space-y-1 sm:col-span-2">
                            <span className="block font-mono text-[10px] text-[var(--ss-subtle)]">ON PARSE ERROR</span>
                            <select
                              value={step.on_error ?? 'keep'}
                              onChange={(e) =>
                                updateStep(idx, { on_error: e.target.value as DSLStep['on_error'] })
                              }
                              className="h-8 w-full rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 text-xs"
                            >
                              <option value="keep">Keep original string</option>
                              <option value="null">Coerce to NULL</option>
                              <option value="reject">Fail pipeline strictly</option>
                            </select>
                          </label>
                        </>
                      )}

                      {step.op === 'standardize_date' && (
                        <label className="space-y-1">
                          <span className="block font-mono text-[10px] text-[var(--ss-subtle)]">FORMAT</span>
                          <select
                            value={step.output_format ?? '%Y-%m-%d'}
                            onChange={(e) =>
                              updateStep(idx, {
                                output_format: e.target.value as DSLStep['output_format'],
                              })
                            }
                            className="h-8 w-full rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 font-mono text-xs"
                          >
                            <option value="%Y-%m-%d">YYYY-MM-DD</option>
                            <option value="%Y/%m/%d">YYYY/MM/DD</option>
                            <option value="%d-%m-%Y">DD-MM-YYYY</option>
                          </select>
                        </label>
                      )}

                      {step.op === 'clip_numeric' && (
                        <div className="space-y-2 sm:col-span-2">
                          <label className="flex items-center gap-2 text-xs cursor-pointer">
                            <input
                              type="checkbox"
                              checked={Boolean(step.use_iqr_bounds)}
                              onChange={(e) =>
                                updateStep(idx, { use_iqr_bounds: e.target.checked })
                              }
                              className="accent-[var(--ss-primary)]"
                            />
                            <span>Auto-clip to 1.5× IQR outlier bounds</span>
                          </label>
                          {!step.use_iqr_bounds && (
                            <div className="grid grid-cols-2 gap-2">
                              <input
                                type="number"
                                placeholder="Min bound"
                                value={step.min_value ?? ''}
                                onChange={(e) =>
                                  updateStep(idx, {
                                    min_value: e.target.value === '' ? null : Number(e.target.value),
                                  })
                                }
                                className="h-8 rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 font-mono text-xs"
                              />
                              <input
                                type="number"
                                placeholder="Max bound"
                                value={step.max_value ?? ''}
                                onChange={(e) =>
                                  updateStep(idx, {
                                    max_value: e.target.value === '' ? null : Number(e.target.value),
                                  })
                                }
                                className="h-8 rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 font-mono text-xs"
                              />
                            </div>
                          )}
                        </div>
                      )}

                      {step.op === 'drop_duplicate_rows' && (
                        <label className="space-y-1 sm:col-span-2">
                          <span className="block font-mono text-[10px] text-[var(--ss-subtle)]">RETENTION</span>
                          <select
                            value={step.keep ?? 'first'}
                            onChange={(e) =>
                              updateStep(idx, { keep: e.target.value as 'first' | 'last' })
                            }
                            className="h-8 w-full rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 text-xs"
                          >
                            <option value="first">Keep first occurrence</option>
                            <option value="last">Keep last occurrence</option>
                          </select>
                        </label>
                      )}

                      {step.op === 'filter_rows' && (
                        <>
                          <label className="space-y-1">
                            <span className="block font-mono text-[10px] text-[var(--ss-subtle)]">CONDITION</span>
                            <select
                              value={step.condition ?? 'not_null'}
                              onChange={(e) =>
                                updateStep(idx, { condition: e.target.value as DSLStep['condition'] })
                              }
                              className="h-8 w-full rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 text-xs"
                            >
                              <option value="not_null">Is not null</option>
                              <option value="is_null">Is null</option>
                              <option value="eq">Equals</option>
                              <option value="neq">Not equals</option>
                              <option value="contains">Contains</option>
                              <option value="gt">Greater than (&gt;)</option>
                              <option value="lt">Less than (&lt;)</option>
                            </select>
                          </label>
                          {step.condition && !['not_null', 'is_null'].includes(step.condition) && (
                            <label className="space-y-1 sm:col-span-2">
                              <span className="block font-mono text-[10px] text-[var(--ss-subtle)]">COMPARE VALUE</span>
                              <input
                                value={step.value ?? ''}
                                onChange={(e) => updateStep(idx, { value: e.target.value })}
                                className="h-8 w-full rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 font-mono text-xs"
                              />
                            </label>
                          )}
                        </>
                      )}

                      {step.op === 'regex_replace' && (
                        <>
                          <label className="space-y-1">
                            <span className="block font-mono text-[10px] text-[var(--ss-subtle)]">PATTERN</span>
                            <input
                              value={step.pattern ?? ''}
                              onChange={(e) => updateStep(idx, { pattern: e.target.value })}
                              className="h-8 w-full rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 font-mono text-xs"
                            />
                          </label>
                          <label className="space-y-1 sm:col-span-2">
                            <span className="block font-mono text-[10px] text-[var(--ss-subtle)]">REPLACEMENT</span>
                            <input
                              value={step.replacement ?? ''}
                              onChange={(e) => updateStep(idx, { replacement: e.target.value })}
                              className="h-8 w-full rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 font-mono text-xs"
                            />
                          </label>
                        </>
                      )}

                      {step.op === 'replace_values' && (
                        <div className="sm:col-span-2 grid grid-cols-2 gap-2">
                          <input
                            placeholder="Match value"
                            value={Object.keys(step.mapping ?? {})[0] ?? ''}
                            onChange={(e) => {
                              const currentVal = Object.values(step.mapping ?? {})[0] ?? '';
                              updateStep(idx, { mapping: { [e.target.value]: currentVal } });
                            }}
                            className="h-8 rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 font-mono text-xs"
                          />
                          <input
                            placeholder="Replace with"
                            value={Object.values(step.mapping ?? {})[0] ?? ''}
                            onChange={(e) => {
                              const currentKey = Object.keys(step.mapping ?? {})[0] ?? 'old';
                              updateStep(idx, { mapping: { [currentKey]: e.target.value } });
                            }}
                            className="h-8 rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 font-mono text-xs"
                          />
                        </div>
                      )}

                      {step.op === 'rename_column' && (
                        <label className="space-y-1">
                          <span className="block font-mono text-[10px] text-[var(--ss-subtle)]">NEW NAME</span>
                          <input
                            value={step.new_name ?? ''}
                            onChange={(e) => updateStep(idx, { new_name: e.target.value })}
                            className="h-8 w-full rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 font-mono text-xs"
                          />
                        </label>
                      )}

                      {step.op === 'drop_columns' && (
                        <label className="space-y-1 sm:col-span-2">
                          <span className="block font-mono text-[10px] text-[var(--ss-subtle)]">COLUMN TO DROP</span>
                          <select
                            value={step.columns?.[0] ?? firstCol}
                            onChange={(e) => updateStep(idx, { columns: [e.target.value] })}
                            className="h-8 w-full rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 font-mono text-xs"
                          >
                            {columns.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}

                      {step.op === 'split_column' && (
                        <>
                          <label className="space-y-1">
                            <span className="block font-mono text-[10px] text-[var(--ss-subtle)]">DELIMITER</span>
                            <input
                              value={step.delimiter ?? '-'}
                              onChange={(e) => updateStep(idx, { delimiter: e.target.value })}
                              className="h-8 w-full rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 font-mono text-xs"
                            />
                          </label>
                          <div className="sm:col-span-2 grid grid-cols-2 gap-2">
                            <input
                              placeholder="Left column"
                              value={step.new_columns?.[0] ?? ''}
                              onChange={(e) =>
                                updateStep(idx, {
                                  new_columns: [e.target.value, step.new_columns?.[1] ?? 'part_2'],
                                })
                              }
                              className="h-8 rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 font-mono text-xs"
                            />
                            <input
                              placeholder="Right column"
                              value={step.new_columns?.[1] ?? ''}
                              onChange={(e) =>
                                updateStep(idx, {
                                  new_columns: [step.new_columns?.[0] ?? 'part_1', e.target.value],
                                })
                              }
                              className="h-8 rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 font-mono text-xs"
                            />
                          </div>
                        </>
                      )}

                      {step.op === 'mask_pii' && (
                        <label className="space-y-1">
                          <span className="block font-mono text-[10px] text-[var(--ss-subtle)]">MASKING METHOD</span>
                          <select
                            value={step.method ?? 'partial_mask'}
                            onChange={(e) =>
                              updateStep(idx, { method: e.target.value as DSLStep['method'] })
                            }
                            className="h-8 w-full rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2 text-xs"
                          >
                            <option value="partial_mask">Partial mask (a•••@domain)</option>
                            <option value="hash_sha256">Deterministic SHA-256 token</option>
                            <option value="redact">Full redaction ([REDACTED])</option>
                          </select>
                        </label>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          {/* Add Operation Control */}
          {canEdit && (
            <div className="flex items-center gap-2 pt-2 border-t border-[var(--ss-border)]">
              <select
                aria-label="Choose transformation operation"
                value={addOpPicker}
                onChange={(e) => setAddOpPicker(e.target.value as DSLOpName)}
                className="h-9 flex-1 rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 text-xs text-[var(--ss-text)]"
              >
                {(['Hygiene', 'Missing & Types', 'Rows & Outliers', 'Schema', 'Privacy'] as const).map(
                  (grp) => (
                    <optgroup key={grp} label={grp}>
                      {OP_CATALOG.filter((o) => o.group === grp).map((o) => (
                        <option key={o.op} value={o.op}>
                          {o.label}
                        </option>
                      ))}
                    </optgroup>
                  ),
                )}
              </select>
              <button
                type="button"
                onClick={() => addStep(addOpPicker)}
                className="inline-flex h-9 items-center gap-1 rounded-md border border-[var(--ss-border-strong)] bg-[var(--ss-surface)] px-3 text-xs font-semibold text-[var(--ss-text)] hover:bg-[var(--ss-surface-hover)]"
              >
                <Plus className="h-3.5 w-3.5 text-[var(--ss-primary)]" />
                <span>Add step</span>
              </button>
            </div>
          )}
        </div>

        {/* RIGHT: Live Preview, Cell Diff, Reproducible Code & Approval Gate */}
        <div className="xl:col-span-7 overflow-hidden rounded-lg border border-[var(--ss-border)] bg-[var(--ss-surface)]">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--ss-border)] bg-[var(--ss-surface-subtle)] px-4">
            <div className="flex items-center gap-1">
              {[
                { id: 'diff' as const, label: 'Cell diff & approval', Icon: GitCompare },
                { id: 'code' as const, label: 'Reproducible code', Icon: Code2 },
                { id: 'history' as const, label: `Runs (${runs.length})`, Icon: History },
              ].map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    if (id === 'code') void handleGenerateCode(codeLang);
                    else setRightTab(id);
                  }}
                  className={cn(
                    'relative inline-flex items-center gap-1.5 px-3 py-3 text-xs font-medium',
                    rightTab === id
                      ? 'text-[var(--ss-primary)] font-semibold'
                      : 'text-[var(--ss-muted)] hover:text-[var(--ss-text)]',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{label}</span>
                  {rightTab === id && (
                    <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-[var(--ss-primary)]" />
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="p-5 space-y-5">
            {/* SUB-TAB 1: DIFF & APPROVAL */}
            {rightTab === 'diff' && (
              activeRun ? (
                <>
                  {/* Before -> After Metric Strip */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {[
                      ['Rows', activeRun.preview_summary.before.rows, activeRun.preview_summary.after.rows],
                      ['Missing', activeRun.preview_summary.before.missing_cells, activeRun.preview_summary.after.missing_cells],
                      ['Duplicates', activeRun.preview_summary.before.exact_duplicates, activeRun.preview_summary.after.exact_duplicates],
                      ['Whitespace', activeRun.preview_summary.before.whitespace_cells, activeRun.preview_summary.after.whitespace_cells],
                    ].map(([label, before, after]) => (
                      <div
                        key={String(label)}
                        className="rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-3"
                      >
                        <span className="block font-mono text-[10px] uppercase text-[var(--ss-subtle)]">
                          {label}
                        </span>
                        <div className="mt-1 flex items-center gap-1.5 font-mono text-xs tabular-nums">
                          <span className="text-[var(--ss-muted)]">{formatNumber(Number(before))}</span>
                          <ArrowRight className="h-3 w-3 text-[var(--ss-subtle)]" />
                          <strong className="text-[var(--ss-primary)]">{formatNumber(Number(after))}</strong>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Step Telemetry Table */}
                  <div className="overflow-x-auto rounded border border-[var(--ss-border)]">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead className="border-b border-[var(--ss-border)] bg-[var(--ss-surface-subtle)] font-mono text-[10px] uppercase text-[var(--ss-muted)]">
                        <tr>
                          <th className="px-3 py-2">#</th>
                          <th className="px-3 py-2">Operation</th>
                          <th className="px-3 py-2">Target</th>
                          <th className="px-3 py-2">Impact</th>
                          <th className="px-3 py-2 text-right">Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--ss-border)] font-mono text-[11px]">
                        {activeRun.preview_summary.step_telemetry.map((t) => (
                          <tr key={t.step_index}>
                            <td className="px-3 py-2 text-[var(--ss-subtle)]">{t.step_index}</td>
                            <td className="px-3 py-2 font-semibold text-[var(--ss-text)]">{t.op}</td>
                            <td className="px-3 py-2 text-[var(--ss-muted)]">{t.column}</td>
                            <td className="px-3 py-2 tabular-nums">
                              {t.cells_changed > 0 && (
                                <span className="mr-2 text-[var(--ss-primary)]">
                                  {t.cells_changed} cells
                                </span>
                              )}
                              {t.rows_removed > 0 && (
                                <span className="mr-2 text-[var(--ss-danger)]">
                                  -{t.rows_removed} rows
                                </span>
                              )}
                              {t.note && <span className="text-[var(--ss-subtle)]">{t.note}</span>}
                              {t.cells_changed === 0 && t.rows_removed === 0 && !t.note && (
                                <span className="text-[var(--ss-subtle)]">no-op</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-[var(--ss-subtle)]">
                              {t.duration_ms}ms
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Git-Style Cell Diff Viewer */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--ss-subtle)]">
                        GIT-STYLE CELL DIFF ({activeRun.preview_summary.modified_row_count} modified ·{' '}
                        {activeRun.preview_summary.removed_row_count} removed)
                      </span>
                      {activeRun.preview_summary.diff_truncated && (
                        <span className="font-mono text-[10px] text-[var(--ss-subtle)]">
                          Showing first 40 rows
                        </span>
                      )}
                    </div>

                    {activeRun.preview_summary.diff_rows.length === 0 ? (
                      <p className="rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-4 text-xs text-[var(--ss-muted)]">
                        These steps produced zero row or cell differences.
                      </p>
                    ) : (
                      <div className="max-h-[300px] overflow-auto divide-y divide-[var(--ss-border)] rounded-md border border-[var(--ss-border)] font-mono text-[11px]">
                        {activeRun.preview_summary.diff_rows.map((row) => (
                          <div
                            key={`${row.status}-${row.row_index}`}
                            className={cn(
                              'px-3 py-2 space-y-1',
                              row.status === 'removed'
                                ? 'bg-[var(--ss-danger-wash)]/55'
                                : 'bg-[var(--ss-surface)]',
                            )}
                          >
                            <div className="flex items-center gap-2 text-[10px]">
                              <span
                                className={cn(
                                  'inline-block w-4 text-center font-bold',
                                  row.status === 'removed'
                                    ? 'text-[var(--ss-danger)]'
                                    : 'text-[var(--ss-primary)]',
                                )}
                              >
                                {row.status === 'removed' ? '−' : '~'}
                              </span>
                              <span className="text-[var(--ss-subtle)] tabular-nums">
                                Row #{row.row_index}
                              </span>
                              <span className="uppercase text-[9px] text-[var(--ss-muted)]">
                                {row.status}
                              </span>
                            </div>

                            <div className="pl-6 space-y-1">
                              {row.changes.map((ch, ci) => (
                                <div key={`${ch.column}-${ci}`} className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-[var(--ss-muted)]">{ch.column}:</span>
                                  {ch.before !== null && (
                                    <span className="rounded bg-[var(--ss-danger-wash)] px-1.5 py-0.5 text-[var(--ss-danger)] line-through">
                                      {ch.before === '' ? 'NULL' : ch.before}
                                    </span>
                                  )}
                                  {row.status === 'modified' && (
                                    <>
                                      <ArrowRight className="h-3 w-3 text-[var(--ss-subtle)]" />
                                      <span className="rounded bg-[var(--ss-pass-wash)] px-1.5 py-0.5 font-semibold text-[var(--ss-pass)]">
                                        {ch.after === '' || ch.after === null ? 'NULL' : ch.after}
                                      </span>
                                    </>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Warnings */}
                  {activeRun.preview_summary.warnings.length > 0 && (
                    <ul className="rounded-md border border-[var(--ss-warn)]/30 bg-[var(--ss-warn-wash)] p-3 pl-7 list-disc text-xs text-[var(--ss-warn)] space-y-1">
                      {activeRun.preview_summary.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  )}

                  {/* Explicit Human Approval Gate */}
                  {activeRun.status === 'previewed' && canEdit && (
                    <div className="rounded-lg border border-[var(--ss-primary-border)] bg-[var(--ss-primary-wash)]/45 p-4 space-y-3">
                      <div className="flex items-center gap-2 text-xs font-semibold text-[var(--ss-primary)]">
                        <ShieldCheck className="h-4 w-4" />
                        <span>Explicit Approval Gate</span>
                      </div>
                      <input
                        value={outputName}
                        onChange={(e) => setOutputName(e.target.value)}
                        placeholder="Optional derived dataset name (e.g. billing_q4_cleaned)"
                        className="h-8 w-full rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 font-mono text-xs"
                      />
                      <label className="flex items-start gap-2.5 text-xs text-[var(--ss-text)] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={approved}
                          onChange={(e) => setApproved(e.target.checked)}
                          className="mt-0.5 h-4 w-4 accent-[var(--ss-primary)]"
                        />
                        <span>
                          I inspected the cell diff and approve materializing a new immutable derived dataset version. The source dataset remains untouched.
                        </span>
                      </label>
                      <button
                        type="button"
                        disabled={!approved || busy}
                        onClick={() => void handleApprove()}
                        className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--ss-primary)] px-4 text-xs font-semibold text-white hover:bg-[var(--ss-primary-hover)] disabled:opacity-45"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Approve & materialize derived dataset</span>
                      </button>
                    </div>
                  )}

                  {/* Applied Result & Multi-Format Export */}
                  {activeRun.status === 'applied' && activeRun.result_dataset_id && (
                    <div className="rounded-lg border border-[var(--ss-pass)]/35 bg-[var(--ss-pass-wash)]/55 p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--ss-pass)]">
                          <CheckCircle2 className="h-4 w-4" />
                          <span>Materialized: {activeRun.validation.derived_filename}</span>
                        </div>
                        {typeof activeRun.validation.after_overall_score === 'number' && (
                          <span className="rounded-full bg-[var(--ss-surface)] px-2.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-[var(--ss-text)]">
                            Score {activeRun.validation.before_overall_score ?? '—'} →{' '}
                            <strong className="text-[var(--ss-pass)]">
                              {activeRun.validation.after_overall_score}
                            </strong>
                            {typeof activeRun.validation.score_delta === 'number' && (
                              <span className="ml-1 text-[var(--ss-pass)]">
                                ({activeRun.validation.score_delta >= 0 ? '+' : ''}
                                {activeRun.validation.score_delta})
                              </span>
                            )}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {(['csv', 'parquet', 'xlsx'] as const).map((fmt) => (
                          <a
                            key={fmt}
                            href={`${exportBase}/${activeRun.id}/export?download=${fmt}`}
                            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--ss-border-strong)] bg-[var(--ss-surface)] px-3 font-mono text-[11px] font-semibold uppercase text-[var(--ss-text)] no-underline hover:bg-[var(--ss-surface-hover)]"
                          >
                            <Download className="h-3.5 w-3.5 text-[var(--ss-primary)]" />
                            <span>{fmt}</span>
                          </a>
                        ))}

                        {onDatasetDerived && (
                          <button
                            type="button"
                            onClick={() => onDatasetDerived(activeRun.result_dataset_id!)}
                            className="ml-auto inline-flex h-8 items-center gap-1 rounded-md bg-[var(--ss-primary)] px-3 text-xs font-semibold text-white hover:bg-[var(--ss-primary-hover)]"
                          >
                            <span>Open derived version</span>
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="py-12 text-center space-y-2">
                  <GitCompare className="mx-auto h-6 w-6 text-[var(--ss-subtle)]" />
                  <p className="text-xs font-medium text-[var(--ss-text)]">
                    Build steps on the left and click Dry-run preview
                  </p>
                  <p className="text-[11px] text-[var(--ss-muted)]">
                    You will see per-step impact metrics, Git-style cell diffs, and the approval gate before any derived file is created.
                  </p>
                </div>
              )
            )}

            {/* SUB-TAB 2: REPRODUCIBLE CODE EXPORT */}
            {rightTab === 'code' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="inline-flex rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-0.5">
                    {(
                      [
                        ['polars', 'Python · Polars'],
                        ['pandas', 'Python · Pandas'],
                        ['sql', 'DuckDB SQL'],
                      ] as const
                    ).map(([lang, label]) => (
                      <button
                        key={lang}
                        type="button"
                        onClick={() => void handleGenerateCode(lang)}
                        className={cn(
                          'rounded px-2.5 py-1 text-xs font-medium',
                          codeLang === lang
                            ? 'bg-[var(--ss-surface)] text-[var(--ss-text)] shadow-xs font-semibold'
                            : 'text-[var(--ss-muted)] hover:text-[var(--ss-text)]',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    disabled={!generatedCode}
                    onClick={() => void copyCode()}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2.5 font-mono text-[11px] font-medium text-[var(--ss-text)] hover:bg-[var(--ss-surface-hover)] disabled:opacity-45"
                  >
                    {copiedCode ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-[var(--ss-pass)]" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>Copy script</span>
                      </>
                    )}
                  </button>
                </div>

                {generatedCode ? (
                  <pre className="max-h-[440px] overflow-auto rounded-lg border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-4 font-mono text-[11px] leading-relaxed text-[var(--ss-text)]">
                    <code>{generatedCode}</code>
                  </pre>
                ) : (
                  <p className="py-10 text-center text-xs text-[var(--ss-muted)]">
                    Add at least one transformation step on the left to generate reproducible code.
                  </p>
                )}
              </div>
            )}

            {/* SUB-TAB 3: RUN HISTORY */}
            {rightTab === 'history' && (
              runs.length ? (
                <ul className="divide-y divide-[var(--ss-border)] rounded-md border border-[var(--ss-border)]">
                  {runs.map((r) => (
                    <li
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs hover:bg-[var(--ss-surface-hover)]"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <strong className="font-mono">{r.steps.length} step(s)</strong>
                          <span
                            className={cn(
                              'rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase',
                              r.status === 'applied'
                                ? 'bg-[var(--ss-pass-wash)] text-[var(--ss-pass)]'
                                : 'bg-[var(--ss-warn-wash)] text-[var(--ss-warn)]',
                            )}
                          >
                            {r.status}
                          </span>
                        </div>
                        <p className="font-mono text-[11px] text-[var(--ss-muted)]">
                          {formatDateTime(r.applied_at || r.created_at)} ·{' '}
                          {r.preview_summary.total_cells_changed} cells changed ·{' '}
                          {r.preview_summary.total_rows_removed} rows removed
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveRun(r);
                          setSteps(r.steps);
                          setRightTab('diff');
                        }}
                        className="rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2.5 py-1 font-mono text-[11px] font-medium hover:border-[var(--ss-primary)]"
                      >
                        Inspect
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-10 text-center text-xs text-[var(--ss-muted)]">
                  No pipeline previews or applied runs recorded for this dataset yet.
                </p>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
