import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InteractiveDataGrid } from '../app/components/studio/interactive-data-grid';
import { ColumnInspectorDrawer } from '../app/components/studio/column-inspector-drawer';
import { fetchDatasetRows } from '../lib/client-api';
import type { ColumnProfileV2, DatasetRowsResponse } from '../lib/types';

vi.mock('../lib/client-api', () => ({
  fetchDatasetRows: vi.fn(),
}));

const sampleColumns: ColumnProfileV2[] = [
  {
    name: 'email',
    inferred_type: 'text',
    semantic_type: 'email',
    missing_count: 1,
    missing_percent: 20,
    populated_count: 4,
    distinct_count: 4,
    distinct_count_exact: true,
    numeric: null,
    pii_signals: [{ kind: 'email', count: 4, percent: 100, severity: 'warning' }],
    text_stats: {
      min_length: 12,
      max_length: 22,
      mean_length: 17.5,
      whitespace_padding_count: 0,
      sentinel_null_count: 0,
      case_variant_groups: 0,
      pattern_shapes: [{ shape: 'aaaa@aaaa.aa', count: 4, percent: 100 }],
    },
  },
  {
    name: 'mrr_usd',
    inferred_type: 'decimal',
    semantic_type: 'numeric_continuous',
    missing_count: 0,
    missing_percent: 0,
    populated_count: 5,
    distinct_count: 5,
    distinct_count_exact: true,
    numeric: { min: '100', max: '95000', mean: '19089' },
    distribution: {
      p5: 100,
      p25: 110,
      p50: 115,
      p75: 120,
      p95: 95000,
      std: 42430,
      iqr: 10,
      skewness: 2.23,
      zero_count: 0,
      negative_count: 0,
      outlier_count_iqr: 1,
      outlier_percent_iqr: 20,
      outlier_bounds: { lower: 95, upper: 135 },
      histogram: [
        { bin_start: 100, bin_end: 24000, count: 4 },
        { bin_start: 24000, bin_end: 95000, count: 1 },
      ],
    },
  },
];

const rowsPayload: DatasetRowsResponse = {
  total_rows: 5,
  filtered_rows: 5,
  limit: 50,
  offset: 0,
  mask_pii: true,
  can_unmask_pii: true,
  pii_columns: ['email'],
  columns: ['email', 'mrr_usd'],
  rows: [
    {
      row_index: 1,
      cells: { email: 'a•••@acme.io', mrr_usd: '100' },
      flags: { email: ['pii_masked'] },
    },
    {
      row_index: 2,
      cells: { email: '', mrr_usd: '95000' },
      flags: { email: ['null'], mrr_usd: ['outlier'] },
    },
  ],
};

beforeEach(() => {
  vi.mocked(fetchDatasetRows).mockResolvedValue(rowsPayload);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('InteractiveDataGrid & ColumnInspectorDrawer', () => {
  it('renders DuckDB rows with masked PII, NULL tokens, IQR flags, and toggles PII reveal', async () => {
    const onInspect = vi.fn();
    render(
      <InteractiveDataGrid
        workspaceId="w1"
        projectId="p1"
        datasetId="d1"
        profileColumns={sampleColumns}
        onInspectColumn={onInspect}
      />,
    );

    expect(await screen.findByText('a•••@acme.io')).toBeInTheDocument();
    expect(screen.getByText('NULL')).toBeInTheDocument();
    expect(screen.getByText('IQR')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /PII Masked/ }));
    await waitFor(() =>
      expect(fetchDatasetRows).toHaveBeenCalledWith(
        'w1',
        'p1',
        'd1',
        expect.objectContaining({ maskPii: false }),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Inspect mrr_usd' }));
    expect(onInspect).toHaveBeenCalledWith('mrr_usd');
  });

  it('renders numeric distribution and triggers grid drill-down from ColumnInspectorDrawer', () => {
    const onClose = vi.fn();
    const onInspectFilter = vi.fn();
    render(
      <ColumnInspectorDrawer
        column={sampleColumns[1]}
        rowCount={5}
        onClose={onClose}
        onInspectFilter={onInspectFilter}
      />,
    );

    expect(screen.getByText('mrr_usd')).toBeInTheDocument();
    expect(screen.getByLabelText('Numeric value histogram')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Show outlier rows/ }));
    expect(onInspectFilter).toHaveBeenCalledWith('mrr_usd', 'is_outlier');
  });
});
