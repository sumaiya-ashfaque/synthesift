import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ResourceManagement } from '../app/components/resource-management';
import { request } from '../lib/client-api';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('@/app/components/brand', () => ({ Brand: () => <span>SyntheSift</span> }));
vi.mock('../lib/client-api', () => ({ request: vi.fn() }));

const workspace = {
  id: 'w1', name: 'Quality', role: 'owner', owner: 'user1', description: '',
  created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
};
const project = { id: 'p1', workspace: 'w1', name: 'Customers', description: '',
  created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' };
const dataset = { id: 'd1', project: 'p1', filename: 'sample.csv', sha256: 'x',
  size_bytes: 2048, status: 'ready', row_count: 2, column_count: 1, columns: ['name'],
  error_code: '', created_at: '2026-11-01T00:00:00Z', completed_at: null };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(request).mockImplementation(async (path, method = 'GET') => {
    if (method === 'DELETE') return undefined as never;
    if (path === '/api/v1/workspaces') return [workspace] as never;
    if (path.endsWith('/projects')) return [project] as never;
    if (path.endsWith('/datasets')) return [dataset] as never;
    throw new Error(`Unexpected request ${path}`);
  });
});
afterEach(cleanup);

describe('ResourceManagement', () => {
  it('requires typing the exact file name before deleting', async () => {
    render(<ResourceManagement />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete CSV' }));
    const confirm = screen.getByRole('button', { name: 'Delete dataset' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Type.*sample.csv.*to confirm/), { target: { value: 'wrong.csv' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Type.*sample.csv.*to confirm/), { target: { value: 'sample.csv' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(request).toHaveBeenCalledWith(
      '/api/v1/workspaces/w1/projects/p1/datasets/d1', 'DELETE',
    ));
  });

  it('keeps all destructive controls hidden for viewers', async () => {
    vi.mocked(request).mockImplementation(async (path) => {
      if (path === '/api/v1/workspaces') return [{ ...workspace, role: 'viewer' }] as never;
      if (path.endsWith('/projects')) return [project] as never;
      if (path.endsWith('/datasets')) return [dataset] as never;
      throw new Error('Unexpected request');
    });
    render(<ResourceManagement />);
    expect(await screen.findByText('sample.csv')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete (CSV|project|workspace)/ })).not.toBeInTheDocument();
  });
});
