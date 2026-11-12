'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';

import { RemediationWorkflowPanel } from '@/app/components/remediation-workflow-panel';
import { AIReportComparison } from '@/app/components/ai-report-comparison';

import { request } from '@/lib/client-api';

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
  const base = `/api/v1/workspaces/${workspaceId}/projects/${projectId}` +
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
      .then((value) => { if (active) setReports(Array.isArray(value) ? value : []); })
      .catch(() => { if (active) setError('Could not load AI analysis history.'); });
    return () => { active = false; };
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
          setReports((items) => items.map((item) => item.id === updated.id ? updated : item));
        })
        .catch(() => { if (active) setError('Analysis status could not refresh.'); });
    }, 5000);
    return () => { active = false; window.clearInterval(timer); };
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
    <section className="ss-ai-panel" aria-labelledby="ss-ai-title">
      <header className="ss-ai-heading">
        <div>
          <p className="ss-kicker">AI-assisted quality review</p>
          <h3 id="ss-ai-title">Remediation recommendations</h3>
          <p>Gemini interprets verified aggregate findings and proposes reviewable actions. No dataset changes are made.</p>
        </div>
        <button type="button" className="ss-button ss-button-outline"
          onClick={() => void refresh().catch(() => setError('Could not refresh reports.'))}
          disabled={busy}>Refresh</button>
      </header>

      {canRun && (
        <form className="ss-ai-config" onSubmit={(event) => void submit(event)}>
          <div className="ss-ai-fields">
            <label>Prompt technique
              <select value={technique} onChange={(e) => setTechnique(e.target.value)}>
                <option value="zero_shot">Zero-shot</option>
                <option value="few_shot">Few-shot</option>
                <option value="stepwise">Structured reasoning</option>
                <option value="role_based">Role-based</option>
              </select>
            </label>
            <label>Gemini model
              <select value={model} onChange={(e) => {
                setModel(e.target.value);
                if (e.target.value === 'gemini-3.8-flash' && thinking === 'minimal') setThinking('low');
              }}>
                <option value="gemini-3.5-flash-lite">3.5 Flash-Lite</option>
                <option value="gemini-3.8-flash">3.8 Flash</option>
                <option value="gemini-2.5-flash">2.5 Flash (legacy access)</option>
              </select>
            </label>
            {model === 'gemini-2.5-flash' ? (
              <label>Temperature
                <input type="number" min="0" max="1" step="0.05" value={temperature}
                  onChange={(e) => setTemperature(e.target.value)} required />
              </label>
            ) : (
              <label>Thinking level
                <select value={thinking} onChange={(e) => setThinking(e.target.value)}>
                  {model !== 'gemini-3.8-flash' && <option value="minimal">Minimal</option>}
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
            )}
            <label>Maximum output tokens
              <select value={maxTokens} onChange={(e) => setMaxTokens(Number(e.target.value))}>
                <option value={2048}>2,048</option>
                <option value={3072}>3,072</option>
                <option value={4096}>4,096</option>
                <option value={8192}>8,192</option>
              </select>
            </label>
          </div>
          <label className="ss-ai-user-prompt" htmlFor="ss-ai-user-prompt">
            Optional analysis guidance
            <small>For example: prioritize missingness in billing fields. Evidence and safety rules still apply. Do not include secrets or personal information.</small>
            <textarea id="ss-ai-user-prompt" value={userPrompt} maxLength={600} rows={3}
              placeholder="What should the analysis focus on? (optional)"
              onChange={(event) => setUserPrompt(event.target.value)} />
            <small>{userPrompt.length}/600 characters</small>
          </label>
          <label className="ss-ai-consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>I authorize sending this dataset’s aggregate profile, column names, and quality findings to Google Gemini. Original CSV rows are not sent. Optional guidance text is also sent to Google Gemini.</span>
          </label>
          <button className="ss-button ss-button-primary" type="submit" disabled={!consent || busy || pending}>
            {busy ? 'Submitting…' : 'Generate recommendations'}
          </button>
        </form>
      )}

      {!canRun && <p className="ss-ai-note">Only workspace owners and editors can request new AI analyses. Saved reports are readable here.</p>}
      {error && <p role="alert" className="ss-error-banner">{error}</p>}

      {reports.length > 1 && (
        <div className="ss-ai-history">
          <label htmlFor="ss-ai-report-choice">Saved analyses</label>
          <select id="ss-ai-report-choice" value={current?.id ?? ''}
            onChange={(e) => setChosenId(e.target.value)}>
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
        <p className="ss-ai-note">No AI analysis has been requested for this dataset.</p>
      ) : pending ? (
        <p role="status" className="ss-ai-note">{current.status === 'queued' ? 'Queued' : 'Analyzing'} — status refreshes automatically.</p>
      ) : current.status === 'failed' ? (
        <p role="alert" className="ss-ai-note">Analysis failed: {FAILURE[current.error_code] ?? 'Review the server logs and try again.'}</p>
      ) : (
        <div className="ss-ai-results">
          <p className="ss-ai-summary">{current.result.summary}</p>
          <p className="ss-ai-note">Model: {current.model} · Technique: {current.technique} · Proposals require human approval.</p>
          {(current.result.recommendations ?? []).map((item, index) => (
            <article key={`${index}-${item.title}`} className="ss-ai-rec">
              <div className="ss-ai-rec-title">
                <strong>{item.title}</strong>
                <span>{item.priority} priority</span>
              </div>
              <p>{item.rationale}</p>
              <p className="ss-ai-evidence"><strong>Supporting evidence:</strong>{' '}
                {item.evidence_ids.map((id) => evidenceLabel(id, current.result.evidence)).join('; ')}</p>
              <ol>{item.steps.map((step, stepIndex) => <li key={stepIndex}>{step}</li>)}</ol>
              <p className="ss-ai-verify"><strong>Verify:</strong> {item.verification}</p>
            </article>
          ))}
          {!!current.result.limitations?.length && (
            <div className="ss-ai-limitations">
              <strong>Limitations</strong>
              <ul>{current.result.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul>
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
