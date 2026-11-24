import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DriftInspector } from '../app/components/studio/drift-inspector';
import { compareDatasetDrift, type Dataset } from '../lib/client-api';

vi.mock('../lib/client-api', () => ({
  compareDatasetDrift: vi.fn(),
}));

const datasets: Dataset[] = [
  {
    id: 'd1', project: 'p1', filename: 'train_q3.csv', file_format: 'csv',
    size_bytes: 200, sha256: 'a', status: 'ready', row_count: 100, column_count: 3,
    columns: ['spend', 'tier'], error_code: '', created_at: '2026-11-01T00:00:00Z', completed_at: null,
  },
  {
    id: 'd2', project: 'p1', filename: 'prod_q4.csv', file_format: 'csv',
    size_bytes: 220, sha256: 'b', status: 'ready', row_count: 110, column_count: 3,
    columns: ['spend', 'tier', 'new_col'], error_code: '', created_at: '2026-11-10T00:00:00Z', completed_at: null,
  },
];

beforeEach(() => {
  vi.mocked(compareDatasetDrift).mockResolvedValue({
    baseline: { id: 'd1', filename: 'train_q3.csv', file_format: 'csv', row_count: 100, column_count: 2, overall_score: 92 },
    candidate: { id: 'd2', filename: 'prod_q4.csv', file_format: 'csv', row_count: 110, column_count: 3, overall_score: 88 },
    summary: {
      status: 'drifted', row_count_delta: 10, row_count_pct_change: 10, score_delta: -4,
      drifted_columns: 1, moderate_columns: 0, stable_columns: 1, max_psi: 0.42, max_ks: 0.65, max_jsd: 0.02,
    },
    schema_drift: { added_columns: ['new_col'], removed_columns: [], type_changes: [], common_column_count: 2 },
    columns: [
      {
        column: 'spend', baseline_type: 'decimal', candidate_type: 'decimal', kind: 'numeric',
        baseline_missing_pct: 0, candidate_missing_pct: 0, missing_delta_pct: 0, status: 'drifted',
        numeric: {
          psi: 0.42, ks_stat: 0.65, ks_p_value: 0.0001, baseline_mean: 110, candidate_mean: 490,
          mean_shift_pct: 345, baseline_p50: 108, candidate_p50: 485, status: 'drifted',
          aligned_bins: [
            { bin_start: 100, bin_end: 300, baseline_pct: 90, candidate_pct: 15 },
            { bin_start: 300, bin_end: 600, baseline_pct: 10, candidate_pct: 85 },
          ],
        },
        categorical: null,
      },
    ],
  });
});

afterEach(() => vi.resetAllMocks());

describe('DriftInspector', () => {
  it('runs statistical drift comparison and renders schema diff, PSI, KS, and overlaid histogram', async () => {
    render(
      <DriftInspector workspaceId="w1" projectId="p1" datasets={datasets} activeDatasetId="d1" />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Run drift analysis/ }));
    expect(await screen.findByText(/DRIFT VERDICT: drifted/i)).toBeInTheDocument();
    expect(screen.getByText('+ new_col')).toBeInTheDocument();
    expect(screen.getByText('PSI 0.420')).toBeInTheDocument();
    expect(screen.getByLabelText('Overlaid drift distribution for spend')).toBeInTheDocument();
  });
});
