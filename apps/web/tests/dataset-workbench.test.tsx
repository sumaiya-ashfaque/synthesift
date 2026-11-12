import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DatasetWorkbench } from '../app/components/dataset-workbench';
import { request } from '../lib/client-api';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('@/app/components/brand', () => ({ Brand: () => <span>SyntheSift</span> }));
vi.mock('../lib/client-api', () => ({ request: vi.fn() }));

const profile = { status: 'ready', completed_at: '2026-11-01T12:00:00Z', result: {
  row_count: 5, column_count: 2, missing_cells: 1, duplicate_rows: 0,
  columns: [{ name: 'email', inferred_type: 'text', missing_count: 1,
    missing_percent: 20, distinct_count: 4, numeric: null }],
  quality: { completeness_percent: 90, duplicate_rows: 0,
    findings: [{ code: 'high_missingness', severity: 'warning', column: 'email',
      message: 'Email contains missing values.' }] },
} };

beforeEach(() => {
  vi.mocked(request).mockImplementation(async (path) => {
    if (path === '/api/v1/auth/me') return { id: 1, username: 'demo', email: 'demo@example.test' } as never;
    if (path === '/api/v1/workspaces') return [{ id: 'w1', name: 'Retail', role: 'owner' }] as never;
    if (path.endsWith('/projects')) return [{ id: 'p1', name: 'Customers' }] as never;
    if (path.endsWith('/datasets')) return [{ id: 'd1', filename: 'customers.csv', status: 'ready' }] as never;
    if (path.endsWith('/ai-reports') || path.endsWith('/remediations')) return [] as never;
    throw new Error(`Unexpected endpoint ${path}`);
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => profile }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe('DatasetWorkbench', () => {
  it('shows saved profile metrics, columns, findings and read-only history', async () => {
    render(<DatasetWorkbench />);
    expect(await screen.findByRole('heading', { name: 'Know your data.' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('90.0%').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('tab', { name: 'Columns' }));
    expect(screen.getByText('email')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Findings/ }));
    expect(screen.getByText('Email contains missing values.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(screen.getByText('Profile completed')).toBeInTheDocument();
    expect(vi.mocked(request).mock.calls.every((call) => call[1] == null || call[1] === 'GET')).toBe(true);
  });

  it('handles a missing profile without inventing metrics', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404, ok: false }));
    render(<DatasetWorkbench />);
    expect(await screen.findByText('Profile not available')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('—').length).toBeGreaterThan(0));
  });
});
