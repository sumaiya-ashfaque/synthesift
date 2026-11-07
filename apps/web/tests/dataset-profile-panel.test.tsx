import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DatasetProfilePanel } from '../app/components/dataset-profile-panel';
import { request, type Dataset } from '../lib/client-api';
vi.mock('@/app/components/ai-remediation-panel', () => ({
  AIRemediationPanel: () => null,
}));

vi.mock('../lib/client-api', () => ({ request: vi.fn() }));

const data: Dataset = {
  id: 'dataset-1', project: 'project-1', filename: 'customers.csv',
  size_bytes: 42, sha256: 'x', status: 'ready', row_count: 3,
  column_count: 1, columns: ['name'], error_code: '',
  created_at: '2026-11-01T10:00:00Z', completed_at: null,
};

const props = {
  workspaceId: 'workspace-1', projectId: 'project-1',
  datasets: [data], canProfile: true,
};

const readyProfile = {
  dataset: data.id, status: 'ready', error_code: '', completed_at: null,
  result: {
    row_count: 3, column_count: 1, missing_cells: 1, duplicate_rows: 1,
    columns: [{ name: 'name', inferred_type: 'text', missing_count: 1,
      missing_percent: 33.33, populated_count: 2, distinct_count: 2,
      distinct_count_exact: true, numeric: null }],
    quality: { completeness_percent: 66.67, duplicate_rows: 1, duplicate_percent: 33.33,
      finding_counts: { high: 0, warning: 2, info: 0 }, method: 'deterministic-v1',
      findings: [{ code: 'high_missingness', severity: 'warning', column: 'name',
        message: '33.33% of records are missing a value.' }] },
  },
};

describe('DatasetProfilePanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => readyProfile,
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders actual persisted profile measurements and findings', async () => {
    render(<DatasetProfilePanel {...props} />);
    expect(await screen.findByText('66.67%')).toBeInTheDocument();
    expect(screen.getByText('1 (33.33%)')).toBeInTheDocument();
    expect(screen.getByText(/33.33% of records are missing/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Inferred column types' })).toBeInTheDocument();
    expect(screen.getByText('customers.csv · ready')).toBeInTheDocument();
  });

  it('lets an owner start a missing profile', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404 }));
    vi.mocked(request).mockResolvedValueOnce({
      ...readyProfile, status: 'queued', result: {},
    });
    render(<DatasetProfilePanel {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Analyze dataset' }));
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(vi.mocked(request).mock.calls[0][1]).toBe('POST');
    expect(await screen.findByText(/Profiling queued/)).toBeInTheDocument();
  });

  it('is read only for viewers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404 }));
    render(<DatasetProfilePanel {...props} canProfile={false} />);
    expect(await screen.findByText(/No profile has been generated/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Analyze dataset' })).not.toBeInTheDocument();
  });

  it('does not profile a dataset before admission finishes', () => {
    render(<DatasetProfilePanel {...props} datasets={[{ ...data, status: 'processing' }]} />);
    expect(screen.getByText(/Profiling is available when this dataset is ready/)).toBeInTheDocument();
    expect(vi.mocked(request)).not.toHaveBeenCalled();
  });
});
