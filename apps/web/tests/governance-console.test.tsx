import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GovernanceConsole } from '@/app/components/governance/governance-console';

const pushMock = vi.fn();
const replaceMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
}));

const requestMock = vi.fn();
const fetchTokensMock = vi.fn();
const createTokenMock = vi.fn();
const fetchWebhooksMock = vi.fn();
const fetchAuditMock = vi.fn();
const fetchContractsMock = vi.fn();
const runCiGateMock = vi.fn();

vi.mock('@/lib/client-api', () => ({
  request: (...args: unknown[]) => requestMock(...args),
  fetchWorkspaceTokens: (...args: unknown[]) => fetchTokensMock(...args),
  createWorkspaceToken: (...args: unknown[]) => createTokenMock(...args),
  revokeWorkspaceToken: vi.fn(),
  fetchWorkspaceWebhooks: (...args: unknown[]) => fetchWebhooksMock(...args),
  createWorkspaceWebhook: vi.fn(),
  updateWorkspaceWebhook: vi.fn(),
  deleteWorkspaceWebhook: vi.fn(),
  testWorkspaceWebhook: vi.fn(),
  fetchWebhookDeliveries: vi.fn(),
  fetchWorkspaceAuditLogs: (...args: unknown[]) => fetchAuditMock(...args),
  fetchContracts: (...args: unknown[]) => fetchContractsMock(...args),
  runCiQualityGate: (...args: unknown[]) => runCiGateMock(...args),
}));

describe('GovernanceConsole', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestMock.mockImplementation((url: string) => {
      if (url === '/api/v1/auth/me') return Promise.resolve({ id: 1, username: 'demo', email: 'demo@synthesift.io' });
      if (url === '/api/v1/workspaces') {
        return Promise.resolve([{ id: 'w1', name: 'SyntheSift Studio', role: 'owner', owner: 'demo', description: '' }]);
      }
      if (url === '/api/v1/workspaces/w1/projects') {
        return Promise.resolve([{ id: 'p1', workspace: 'w1', name: 'Revenue Quality', description: '' }]);
      }
      if (url === '/api/v1/workspaces/w1/projects/p1/datasets') {
        return Promise.resolve([{ id: 'd1', project: 'p1', filename: 'billing.csv', status: 'ready' }]);
      }
      return Promise.resolve([]);
    });
    fetchTokensMock.mockResolvedValue([]);
    fetchWebhooksMock.mockResolvedValue([]);
    fetchContractsMock.mockResolvedValue([]);
    fetchAuditMock.mockResolvedValue([
      {
        id: 'ev1',
        workspace: 'w1',
        actor_label: 'demo',
        action: 'ci_gate.evaluated',
        resource_type: 'dataset',
        resource_id: 'd1',
        outcome: 'blocked',
        metadata: { quality_score: 62 },
        created_at: '2026-01-01T00:00:00Z',
      },
    ]);
  });

  it('mints a one-time PAT, simulates a failing CI/CD quality gate (HTTP 422), and displays the audit trail', async () => {
    createTokenMock.mockResolvedValue({
      id: 'tok1',
      workspace: 'w1',
      name: 'github-actions-ci',
      token_prefix: 'ss_pat_demo1234',
      token: 'ss_pat_demo1234_secret_value_once',
      scopes: ['read', 'gate:run'],
      expires_at: null,
      last_used_at: null,
      revoked_at: null,
      is_revoked: false,
      created_by: 'demo',
      created_at: '2026-01-01T00:00:00Z',
    });
    runCiGateMock.mockResolvedValue({
      http_status: 422,
      verdict: 'failed',
      exit_code: 1,
      dataset: { id: 'd1', filename: 'billing.csv', file_format: 'csv', row_count: 50, column_count: 4, sha256: 'abc' },
      quality_score: 64.5,
      pii_flagged_columns: 1,
      checks: [
        { name: 'zero_pii_policy', passed: false, expected: '0 PII columns', observed: '1 PII column(s)' },
      ],
      contract_run: null,
      drift_summary: null,
      markdown_summary: '### SyntheSift Quality Gate — FAIL',
    });

    render(<GovernanceConsole />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /generate personal access token/i })).toBeEnabled(),
    );

    fireEvent.click(screen.getByRole('button', { name: /generate personal access token/i }));
    expect(await screen.findByText('ss_pat_demo1234_secret_value_once')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /run ci\/cd gate/i }));
    expect(await screen.findByText(/HTTP 422 · FAILED \(exit 1\)/i)).toBeInTheDocument();
    expect(screen.getByText('zero_pii_policy')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /audit trail/i }));
    expect(await screen.findByRole('cell', { name: 'ci_gate.evaluated' })).toBeInTheDocument();
  });
});
