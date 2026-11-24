'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Lock, RefreshCw, Sparkles } from 'lucide-react';
import { AIReportComparison } from '@/app/components/ai-report-comparison';
import { RemediationWorkflowPanel } from '@/app/components/remediation-workflow-panel';
import { request } from '@/lib/client-api';
import { cn } from '@/lib/cn';

type Evidence = {
  columns: { id: string; name: string; missing_percent: number | null }[];
  findings: { id: string; code: string; column: string; message: string }[];
};

type Recommendation = {
  title: string;
  action: string;
  priority: 'high' | 'medium' | 'low';
  rationale: string;
  evidence_ids: string[];
  steps: string[];
  verification: string;
};

type AIReport = {
  id: string;
  status: 'queued' | 'processing' | 'ready' | 'failed';
  error_code: string;
  technique: string;
  model: string;
  thinking_level: string;
  max_output_tokens: number;
  created_at: string;
  result: {
    summary?: string;
    limitations?: string[];
    recommendations?: Recommendation[];
    evidence?: Evidence;
    approval_required?: boolean;
  };
};

type Props = {
  workspaceId: string;
  projectId: string;
  datasetId: string;
  canRun: boolean;
};

const FAILURE: Record<string, string> = {
  provider_not_configured: 'Gemini is not configured on the server.',
  provider_auth_failed: 'Gemini credentials were rejected.',
  provider_rate_limited: 'Gemini request limit reached. Try again later.',
  provider_unavailable: 'Gemini is temporarily unavailable.',
  invalid_ai_output: 'Gemini returned recommendations that did not pass validation.',
  invalid_provider_response: 'Gemini returned an invalid response.',
  profile_changed: 'The saved profile changed during this analysis.',
  queue_unavailable: 'The background processing queue is unavailable.',
  processing_error: 'An unexpected processing error occurred.',
};

function evidenceLabel(id: string, evidence: Evidence | undefined): string {
  const finding = evidence?.findings.find((item) => item.id === id);
  if (finding) return `${id} · ${finding.code}${finding.column ? ` (${finding.column})` : ''}`;
  const column = evidence?.columns.find((item) => item.id === id);
  if (column) return `${id} · ${column.name}`;
  return id;
}

export function AIRemediationPanel({ workspaceId, projectId, datasetId, canRun }: Props) {
  const base =
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}` +
    `/datasets/${datasetId}/ai-reports`;
  const [reports, setReports] = useState<AIReport[]>([]);
  const [chosenId, setChosenId] = useState('');
  const [technique, setTechnique] = useState('few_shot');
  const [model, setModel] = useState('gemini-3.5-flash-lite');
  const [thinking, setThinking] = useState('low');
  const [maxTokens, setMaxTokens] = useState(3072);
  const [temperature, setTemperature] = useState('0.20');
  const [consent, setConsent] = useState(false);
  const [userPrompt, setUserPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const loaded = await request<AIReport[]>(base);
    setReports(Array.isArray(loaded) ? loaded : []);
  }, [base]);

  useEffect(() => {
    let active = true;
    void request<AIReport[]>(base)
      .then((value) => {
        if (active) setReports(Array.isArray(value) ? value : []);
      })
      .catch(() => {
        if (active) setError('Could not load AI analysis history.');
      });
    return () => {
      active = false;
    };
  }, [base]);

  const current = reports.find((item) => item.id === chosenId) ?? reports[0];
  const pending = current?.status === 'queued' || current?.status === 'processing';

  useEffect(() => {
    if (!pending || !current) return;
    let active = true;
    const timer = window.setInterval(() => {
      void request<AIReport>(`${base}/${current.id}`)
        .then((updated) => {
          if (!active) return;
          setReports((items) => items.map((item) => (item.id === updated.id ? updated : item)));
        })
        .catch(() => {
          if (active) setError('Analysis status could not refresh.');
        });
    }, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [base, current, pending]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canRun || !consent) return;
    setBusy(true);
    setError('');
    try {
      const report = await request<AIReport>(base, 'POST', {
        technique,
        model,
        thinking_level: model === 'gemini-2.5-flash' ? 'low' : thinking,
        ...(model === 'gemini-2.5-flash' ? { temperature } : {}),
        max_output_tokens: maxTokens,
        consent_external_processing: true,
        ...(userPrompt.trim() ? { user_prompt: userPrompt.trim() } : {}),
      });
      setReports((previous) => [report, ...previous].slice(0, 10));
      setChosenId(report.id);
      setConsent(false);
      setUserPrompt('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Analysis could not start.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-5" aria-labelledby="ss-ai-title">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ss-primary)]">
            AI-assisted quality review
          </p>
          <h3 id="ss-ai-title" className="mt-0.5 text-base font-semibold text-[var(--ss-text)]">
            Remediation recommendations
          </h3>
          <p className="mt-0.5 text-xs text-[var(--ss-muted)]">
            Gemini interprets verified aggregate findings and proposes reviewable actions. No dataset changes are made.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh().catch(() => setError('Could not refresh reports.'))}
          disabled={busy}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2.5 text-xs font-medium text-[var(--ss-text)] hover:bg-[var(--ss-surface-hover)]"
        >
          <RefreshCw className="h-3 w-3" />
          <span>Refresh</span>
        </button>
      </header>

      {canRun && (
        <form
          className="rounded-lg border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-4 sm:p-5 space-y-4"
          onSubmit={(event) => void submit(event)}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="space-y-1 text-xs font-medium text-[var(--ss-muted)]">
              <span>Prompt technique</span>
              <select
                value={technique}
                onChange={(e) => setTechnique(e.target.value)}
                className="h-9 w-full rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 text-xs text-[var(--ss-text)]"
              >
                <option value="zero_shot">Zero-shot</option>
                <option value="few_shot">Few-shot</option>
                <option value="stepwise">Structured reasoning</option>
                <option value="role_based">Role-based</option>
              </select>
            </label>

            <label className="space-y-1 text-xs font-medium text-[var(--ss-muted)]">
              <span>Gemini model</span>
              <select
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  if (e.target.value === 'gemini-3.8-flash' && thinking === 'minimal') {
                    setThinking('low');
                  }
                }}
                className="h-9 w-full rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 text-xs text-[var(--ss-text)]"
              >
                <option value="gemini-3.5-flash-lite">3.5 Flash-Lite</option>
                <option value="gemini-3.8-flash">3.8 Flash</option>
                <option value="gemini-2.5-flash">2.5 Flash (legacy access)</option>
              </select>
            </label>

            {model === 'gemini-2.5-flash' ? (
              <label className="space-y-1 text-xs font-medium text-[var(--ss-muted)]">
                <span>Temperature</span>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                  required
                  className="h-9 w-full rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 text-xs text-[var(--ss-text)]"
                />
              </label>
            ) : (
              <label className="space-y-1 text-xs font-medium text-[var(--ss-muted)]">
                <span>Thinking level</span>
                <select
                  value={thinking}
                  onChange={(e) => setThinking(e.target.value)}
                  className="h-9 w-full rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 text-xs text-[var(--ss-text)]"
                >
                  {model !== 'gemini-3.8-flash' && <option value="minimal">Minimal</option>}
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
            )}

            <label className="space-y-1 text-xs font-medium text-[var(--ss-muted)]">
              <span>Maximum output tokens</span>
              <select
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value))}
                className="h-9 w-full rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 text-xs text-[var(--ss-text)]"
              >
                <option value={2048}>2,048</option>
                <option value={3072}>3,072</option>
                <option value={4096}>4,096</option>
                <option value={8192}>8,192</option>
              </select>
            </label>
          </div>

          <label className="block space-y-1.5 text-xs font-medium text-[var(--ss-text)]" htmlFor="ss-ai-user-prompt">
            <span>Optional analysis guidance</span>
            <small className="block font-normal text-[var(--ss-muted)]">
              For example: prioritize missingness in billing fields. Evidence and safety rules still apply. Do not include secrets or personal information.
            </small>
            <textarea
              id="ss-ai-user-prompt"
              value={userPrompt}
              maxLength={600}
              rows={3}
              placeholder="What should the analysis focus on? (optional)"
              onChange={(event) => setUserPrompt(event.target.value)}
              className="w-full rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] p-2.5 text-xs text-[var(--ss-text)] placeholder:text-[var(--ss-subtle)]"
            />
            <small className="block font-mono text-[10px] text-[var(--ss-subtle)]">
              {userPrompt.length}/600 characters
            </small>
          </label>

          <label className="flex items-start gap-2.5 rounded-md border border-[var(--ss-pii)]/25 bg-[var(--ss-pii-wash)]/50 p-3 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded accent-[var(--ss-primary)]"
            />
            <span className="leading-relaxed text-[var(--ss-text)]">
              <Lock className="inline h-3 w-3 mr-1 text-[var(--ss-pii)]" />
              I authorize sending this dataset’s aggregate profile, column names, and quality findings to Google Gemini. Original CSV rows are not sent. Optional guidance text is also sent to Google Gemini.
            </span>
          </label>

          <button
            type="submit"
            disabled={!consent || busy || pending}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--ss-primary)] px-4 text-xs font-semibold text-white hover:bg-[var(--ss-primary-hover)] disabled:opacity-45"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>{busy ? 'Submitting…' : 'Generate recommendations'}</span>
          </button>
        </form>
      )}

      {!canRun && (
        <p className="text-xs text-[var(--ss-muted)]">
          Only workspace owners and editors can request new AI analyses. Saved reports are readable here.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-md border border-[var(--ss-danger)]/35 bg-[var(--ss-danger-wash)] px-3.5 py-2.5 text-xs text-[var(--ss-danger)]"
        >
          {error}
        </p>
      )}

      {reports.length > 1 && (
        <div className="flex flex-wrap items-center gap-3">
          <label
            htmlFor="ss-ai-report-choice"
            className="font-mono text-[11px] uppercase tracking-wider text-[var(--ss-subtle)]"
          >
            Saved analyses
          </label>
          <select
            id="ss-ai-report-choice"
            value={current?.id ?? ''}
            onChange={(e) => setChosenId(e.target.value)}
            className="h-8 rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2.5 font-mono text-xs text-[var(--ss-text)]"
          >
            {reports.map((item) => (
              <option key={item.id} value={item.id}>
                {new Date(item.created_at).toLocaleString()} · {item.technique} · {item.status}
              </option>
            ))}
          </select>
        </div>
      )}

      {reports.length > 1 && <AIReportComparison reports={reports} />}

      {!current ? (
        <p className="text-xs text-[var(--ss-muted)]">
          No AI analysis has been requested for this dataset.
        </p>
      ) : pending ? (
        <p role="status" className="font-mono text-xs text-[var(--ss-primary)]">
          {current.status === 'queued' ? 'Queued' : 'Analyzing'} — status refreshes automatically.
        </p>
      ) : current.status === 'failed' ? (
        <p
          role="alert"
          className="rounded-md border border-[var(--ss-danger)]/35 bg-[var(--ss-danger-wash)] px-3.5 py-2.5 text-xs text-[var(--ss-danger)]"
        >
          Analysis failed: {FAILURE[current.error_code] ?? 'Review the server logs and try again.'}
        </p>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-4 space-y-1.5">
            <p className="text-sm font-medium text-[var(--ss-text)]">{current.result.summary}</p>
            <p className="font-mono text-[11px] text-[var(--ss-muted)]">
              Model: {current.model} · Technique: {current.technique} · Proposals require human approval.
            </p>
          </div>

          <div className="space-y-3">
            {(current.result.recommendations ?? []).map((item, index) => (
              <article
                key={`${index}-${item.title}`}
                className="rounded-lg border border-[var(--ss-border)] bg-[var(--ss-surface)] p-4 space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-sm font-semibold text-[var(--ss-text)]">{item.title}</strong>
                  <span
                    className={cn(
                      'rounded px-2 py-0.5 font-mono text-[10px] font-semibold uppercase',
                      item.priority === 'high'
                        ? 'bg-[var(--ss-danger-wash)] text-[var(--ss-danger)]'
                        : item.priority === 'medium'
                          ? 'bg-[var(--ss-warn-wash)] text-[var(--ss-warn)]'
                          : 'bg-[var(--ss-surface-subtle)] text-[var(--ss-muted)]',
                    )}
                  >
                    {item.priority} priority
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-[var(--ss-muted)]">{item.rationale}</p>
                <p className="font-mono text-[11px] text-[var(--ss-text)]">
                  <strong className="text-[var(--ss-subtle)] font-medium">Supporting evidence:</strong>{' '}
                  {item.evidence_ids.map((id) => evidenceLabel(id, current.result.evidence)).join('; ')}
                </p>
                <ol className="list-decimal pl-5 space-y-1 text-xs text-[var(--ss-text)]">
                  {item.steps.map((step, stepIndex) => (
                    <li key={stepIndex}>{step}</li>
                  ))}
                </ol>
                <p className="pt-2 border-t border-[var(--ss-border)] text-xs text-[var(--ss-muted)]">
                  <strong className="text-[var(--ss-text)]">Verify:</strong> {item.verification}
                </p>
              </article>
            ))}
          </div>

          {!!current.result.limitations?.length && (
            <div className="rounded-md border border-[var(--ss-warn)]/30 bg-[var(--ss-warn-wash)] p-3.5 text-xs space-y-1">
              <strong className="text-[var(--ss-warn)]">Limitations</strong>
              <ul className="list-disc pl-5 space-y-0.5 text-[var(--ss-muted)]">
                {current.result.limitations.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          <RemediationWorkflowPanel
            key={`${workspaceId}:${projectId}:${datasetId}:${current.id}`}
            workspaceId={workspaceId}
            projectId={projectId}
            datasetId={datasetId}
            reportId={current.id}
            canApply={canRun}
          />
        </div>
      )}
    </section>
  );
}
