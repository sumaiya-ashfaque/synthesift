import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RemediationWorkflowPanel } from '../app/components/remediation-workflow-panel';
import { request } from '../lib/client-api';

vi.mock('../lib/client-api', () => ({ request: vi.fn() }));

afterEach(() => cleanup());

const base = {
  workspaceId: 'w1', projectId: 'p1', datasetId: 'd1', reportId: 'r1', canApply: true,
};
const preview = {
  id: 'run-1', status: 'previewed', report_id: 'r1', result_dataset_id: null,
  operations: ['trim_whitespace'], created_at: '2026-11-07T01:00:00Z', applied_at: null,
  preview: {
    before: { rows: 4, missing_cells: 1, exact_duplicates: 1 },
    after: { rows: 3, missing_cells: 1, exact_duplicates: 0 },
    changed_cells: 2, removed_duplicate_rows: 1,
    warnings: ['Check whether repeated records are meaningful.'],
  },
};

describe('RemediationWorkflowPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(request).mockResolvedValue([]);
  });

  it('requires preview and a second explicit approval before creating data', async () => {
    vi.mocked(request).mockResolvedValueOnce([]);
    render(<RemediationWorkflowPanel {...base} />);
    const approve = screen.queryByRole('button', { name: 'Approve and create derived dataset' });
    expect(approve).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Trim leading and trailing whitespace from cells'));
    vi.mocked(request).mockResolvedValueOnce(preview);
    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
    expect(await screen.findByText('Preview only — no file changed')).toBeInTheDocument();
    const apply = screen.getByRole('button', { name: 'Approve and create derived dataset' });
    expect(apply).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/I reviewed the preview/));
    expect(apply).toBeEnabled();
    vi.mocked(request).mockResolvedValueOnce({ ...preview, status: 'applied', result_dataset_id: 'derived-1' });
    fireEvent.click(apply);
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        '/api/v1/workspaces/w1/projects/p1/datasets/d1/remediations/run-1',
        'POST', { approve: true },
      );
    });
    expect(await screen.findByText('Download derived CSV')).toBeInTheDocument();
    expect(screen.getByText('Download audit PDF')).toBeInTheDocument();
  });

  it('provides read-only history without execution controls for viewers', async () => {
    vi.mocked(request).mockResolvedValueOnce([{ ...preview, status: 'applied', result_dataset_id: 'derived-1' }]);
    render(<RemediationWorkflowPanel {...base} canApply={false} />);
    expect(await screen.findByText('Download audit PDF')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Preview changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve and create derived dataset' })).not.toBeInTheDocument();
  });
});
