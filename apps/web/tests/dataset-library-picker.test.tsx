import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DatasetLibraryPicker } from '../app/components/dataset-library-picker';
import { request } from '../lib/client-api';

vi.mock('../lib/client-api', () => ({ request: vi.fn() }));

describe('DatasetLibraryPicker', () => {
  it('imports only authorized ready datasets into a different project', async () => {
    vi.mocked(request).mockImplementation(async (path) => {
      if (path === '/api/v1/dataset-library') return { results: [
        { id: 'source', filename: 'safe.csv', status: 'ready', can_reuse: true,
          project_id: 'p1', project_name: 'Original', workspace_name: 'Quality', workspace_id: 'w1' },
        { id: 'viewer', filename: 'private.csv', status: 'ready', can_reuse: false,
          project_id: 'p3', project_name: 'Restricted', workspace_name: 'Other', workspace_id: 'w2' },
      ], limit: 200 } as never;
      if (path.endsWith('/datasets/import')) return { id: 'new' } as never;
      throw new Error(`Unexpected ${path}`);
    });
    const refreshed = vi.fn().mockResolvedValue(undefined);
    render(<DatasetLibraryPicker workspaceId="w1" projectId="p2" onImported={refreshed} />);
    fireEvent.click(screen.getByRole('button', { name: /Choose from dataset library/ }));
    expect(await screen.findByRole('option', { name: /safe.csv/ })).toBeInTheDocument();
    expect(screen.queryByText(/private.csv/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Existing dataset'), { target: { value: 'source' } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy into this project' }));
    await waitFor(() => expect(refreshed).toHaveBeenCalled());
    expect(vi.mocked(request)).toHaveBeenCalledWith(
      '/api/v1/workspaces/w1/projects/p2/datasets/import', 'POST', { source_dataset_id: 'source' },
    );
  });
});
