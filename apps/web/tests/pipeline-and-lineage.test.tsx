import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LineageDag } from '../app/components/studio/lineage-dag';
import { PipelineBuilder } from '../app/components/studio/pipeline-builder';
import {
  exportPipelineCode,
  fetchPipelineRuns,
  fetchProjectLineage,
  fetchProjectRecipes,
  previewPipelineRun,
  suggestPipelineSteps,
} from '../lib/client-api';

vi.mock('../lib/client-api', () => ({
  fetchProjectRecipes: vi.fn(),
  createProjectRecipe: vi.fn(),
  fetchPipelineRuns: vi.fn(),
  suggestPipelineSteps: vi.fn(),
  previewPipelineRun: vi.fn(),
  approvePipelineRun: vi.fn(),
  exportPipelineCode: vi.fn(),
  fetchProjectLineage: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(fetchProjectRecipes).mockResolvedValue([]);
  vi.mocked(fetchPipelineRuns).mockResolvedValue([]);
  vi.mocked(suggestPipelineSteps).mockResolvedValue({
    steps: [{ op: 'trim_whitespace', column: '*', side: 'both' }],
  });
  vi.mocked(previewPipelineRun).mockResolvedValue({
    id: 'run-1',
    source_dataset_id: 'd1',
    recipe_id: null,
    created_by: 'demo',
    steps: [{ op: 'trim_whitespace', column: '*', side: 'both' }],
    status: 'previewed',
    source_sha256: 'abc',
    preview_summary: {
      before: { rows: 10, columns: 2, missing_cells: 0, exact_duplicates: 0, whitespace_cells: 2, sentinel_nulls: 0 },
      after: { rows: 10, columns: 2, missing_cells: 0, exact_duplicates: 0, whitespace_cells: 0, sentinel_nulls: 0 },
      total_cells_changed: 2,
      total_rows_removed: 0,
      modified_row_count: 2,
      removed_row_count: 0,
      step_telemetry: [
        { step_index: 1, op: 'trim_whitespace', column: '*', cells_changed: 2, rows_removed: 0, columns_added: [], columns_removed: [], duration_ms: 0.4 },
      ],
      diff_rows: [
        { row_index: 1, status: 'modified', changes: [{ column: 'tier', before: ' Growth ', after: 'Growth' }] },
      ],
      diff_truncated: false,
      output_sha256: 'def',
      output_size_bytes: 120,
      warnings: [],
    },
    validation: {},
    result_dataset_id: null,
    created_at: '2026-11-24T00:00:00Z',
    applied_at: null,
  });
  vi.mocked(exportPipelineCode).mockResolvedValue({
    language: 'polars',
    code: 'import polars as pl\ndf = df.with_columns(pl.all().str.strip_chars())',
  });
  vi.mocked(fetchProjectLineage).mockResolvedValue({
    nodes: [
      { id: 'd1', filename: 'raw.csv', file_format: 'csv', status: 'ready', row_count: 10, column_count: 2, size_bytes: 200, sha256: '1111111111', overall_score: 78.0, completeness_percent: 90, is_derived: false, created_at: '2026-11-24T00:00:00Z' },
      { id: 'd2', filename: 'raw_v1.csv', file_format: 'csv', status: 'ready', row_count: 9, column_count: 2, size_bytes: 180, sha256: '2222222222', overall_score: 96.5, completeness_percent: 100, is_derived: true, created_at: '2026-11-24T00:05:00Z' },
    ],
    edges: [
      { id: 'pipe:1', kind: 'pipeline', source: 'd1', target: 'd2', label: 'Monthly Clean', step_count: 2, operations: ['trim_whitespace', 'drop_duplicate_rows'], rows_removed: 1, cells_changed: 3, score_delta: 18.5, applied_at: '2026-11-24T00:05:00Z' },
    ],
  });
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('PipelineBuilder & LineageDag', () => {
  it('auto-drafts steps, runs dry-run preview showing Git-style cell diffs, and exports Polars code', async () => {
    render(
      <PipelineBuilder
        workspaceId="w1"
        projectId="p1"
        datasetId="d1"
        columns={['tier', 'mrr_usd']}
        canEdit={true}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Auto-draft from findings/ }));
    expect(await screen.findByText(/Drafted 1 deterministic cleaning step/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Dry-run preview/ }));
    expect(await screen.findByText(/Row #1/)).toBeInTheDocument();
    expect(screen.getAllByText('Growth').length).toBe(2);

    fireEvent.click(screen.getByRole('button', { name: /Reproducible code/ }));
    await waitFor(() => expect(screen.getByText(/import polars as pl/)).toBeInTheDocument());
  });

  it('renders project lineage DAG nodes and lets user switch version on click', async () => {
    const onSelect = vi.fn();
    render(
      <LineageDag
        workspaceId="w1"
        projectId="p1"
        activeDatasetId="d1"
        onSelectDataset={onSelect}
      />,
    );

    const derivedNode = await screen.findByRole('button', { name: /raw_v1\.csv/ });
    expect(screen.getByText('+18.5 pts')).toBeInTheDocument();
    fireEvent.click(derivedNode);
    expect(onSelect).toHaveBeenCalledWith('d2');
  });
});
