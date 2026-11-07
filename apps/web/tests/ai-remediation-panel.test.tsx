import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AIRemediationPanel } from '../app/components/ai-remediation-panel';
import { request } from '../lib/client-api';

vi.mock('../app/components/remediation-workflow-panel', () => ({
  RemediationWorkflowPanel: () => null,
}));

vi.mock('../lib/client-api', () => ({ request: vi.fn() }));

const props = {
  workspaceId: 'w1', projectId: 'p1', datasetId: 'd1', canRun: true,
};

afterEach(() => {
  cleanup();
});

describe('AIRemediationPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(request).mockResolvedValue([]);
  });

  it('requires explicit consent before issuing a generative analysis request', async () => {
    render(<AIRemediationPanel {...props} />);
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    const button = screen.getByRole('button', { name: 'Generate recommendations' });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(button).toBeEnabled();
    vi.mocked(request).mockResolvedValueOnce({
      id: 'report-1', status: 'queued', result: {}, model: 'gemini-3.5-flash-lite',
      technique: 'few_shot', thinking_level: 'low', created_at: '2026-11-07T00:00:00Z',
    });
    fireEvent.click(button);
    await waitFor(() => expect(request).toHaveBeenCalledWith(
      '/api/v1/workspaces/w1/projects/p1/datasets/d1/ai-reports',
      'POST', expect.objectContaining({
        consent_external_processing: true, technique: 'few_shot',
        max_output_tokens: 3072, model: 'gemini-3.5-flash-lite',
      }),
    ));
  });

  it('renders saved recommendations but no action form for viewers', async () => {
    vi.mocked(request).mockResolvedValueOnce([{
      id: 'r1', status: 'ready', technique: 'role_based', model: 'gemini-3.5-flash-lite',
      created_at: '2026-11-07T00:00:00Z', error_code: '',
      result: { summary: 'Review duplicate rows.', limitations: ['No original rows sent.'],
        evidence: { columns: [], findings: [{ id: 'F1', code: 'duplicate_rows',
          column: '', message: '2 duplicates' }] },
        recommendations: [{ title: 'Inspect exact duplicate rows', action: 'review_duplicates',
          priority: 'medium', rationale: 'Repeated rows may be unintentional.',
          evidence_ids: ['F1'], steps: ['Inspect source records.'],
          verification: 'Compare duplicate counts.' }],
      },
    }]);
    render(<AIRemediationPanel {...props} canRun={false} />);
    expect(await screen.findByText('Review duplicate rows.')).toBeInTheDocument();
    expect(screen.getByText('Inspect exact duplicate rows')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate recommendations' })).not.toBeInTheDocument();
  });
});
