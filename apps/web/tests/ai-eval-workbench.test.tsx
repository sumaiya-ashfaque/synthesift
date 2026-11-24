import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIEvalWorkbench } from '@/app/components/studio/ai-eval-workbench';

const fetchProjectAiEvalsMock = vi.fn();
const runAiGuardrailBenchmarkMock = vi.fn();

vi.mock('@/lib/client-api', () => ({
  fetchProjectAiEvals: (...args: unknown[]) => fetchProjectAiEvalsMock(...args),
  runAiGuardrailBenchmark: (...args: unknown[]) => runAiGuardrailBenchmarkMock(...args),
}));

describe('AIEvalWorkbench', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchProjectAiEvalsMock.mockResolvedValue({
      summary: {
        total_reports: 4,
        ready_reports: 3,
        failed_reports: 1,
        schema_compliance_rate: 75.0,
        citation_grounding_rate: 100.0,
        total_recommendations: 6,
        safe_abstention_count: 1,
        mean_latency_ms: 610.5,
        p95_latency_ms: 920.0,
        privacy_egress_policy: 'aggregate_only_zero_raw_rows',
      },
      by_technique: [
        {
          technique: 'few_shot',
          runs: 3,
          ready: 3,
          failed: 0,
          citation_grounding_rate: 100.0,
          avg_recommendations: 2.0,
          mean_latency_ms: 610.5,
        },
      ],
      by_model: [
        {
          model: 'gemini-3.5-flash-lite',
          runs: 4,
          ready: 3,
          failed: 1,
          citation_grounding_rate: 100.0,
          avg_recommendations: 2.0,
          mean_latency_ms: 610.5,
        },
      ],
      failure_breakdown: { invalid_ai_output: 1 },
      recent_runs: [
        {
          id: 'rep-1',
          dataset_id: 'ds-1',
          dataset_filename: 'saas_billing_q4.csv',
          technique: 'few_shot',
          model: 'gemini-3.5-flash-lite',
          status: 'ready',
          error_code: '',
          recommendation_count: 2,
          grounded_ratio: 100.0,
          latency_ms: 610.5,
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
    });
  });

  it('displays live project AI eval KPIs and executes the adversarial guardrail benchmark suite', async () => {
    runAiGuardrailBenchmarkMock.mockResolvedValue({
      suite_version: 'synthesift.evals/v1',
      total_cases: 6,
      passed_cases: 6,
      pass_rate: 100.0,
      duration_ms: 1.8,
      cases: [
        {
          id: 'hallucinated_evidence_id',
          category: 'citation_grounding',
          title: 'Reject hallucinated evidence citation (F999)',
          expected_outcome: 'reject',
          actual_outcome: 'reject',
          guardrail_code: 'invalid_evidence_reference',
          passed: true,
          detail: 'Blocks ungrounded citations.',
        },
      ],
    });

    render(<AIEvalWorkbench workspaceId="w1" projectId="p1" />);

    await waitFor(() => expect(screen.getByText('75%')).toBeInTheDocument());
    expect(screen.getByText('Zero Raw Rows')).toBeInTheDocument();
    expect(screen.getByText('saas_billing_q4.csv')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /run adversarial guardrail suite/i }));

    expect(await screen.findByText(/6\/6 passed \(100%\)/i)).toBeInTheDocument();
    expect(screen.getByText(/reject hallucinated evidence citation \(f999\)/i)).toBeInTheDocument();
    expect(screen.getByText('invalid_evidence_reference')).toBeInTheDocument();
  });
});
