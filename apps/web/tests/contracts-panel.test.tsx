import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContractsPanel } from '@/app/components/studio/contracts-panel';

const fetchContractsMock = vi.fn();
const fetchContractRunsMock = vi.fn();
const autoGenerateContractMock = vi.fn();
const createContractMock = vi.fn();
const evaluateContractGateMock = vi.fn();
const importContractYamlMock = vi.fn();

vi.mock('@/lib/client-api', () => ({
  fetchContracts: (...args: unknown[]) => fetchContractsMock(...args),
  fetchContractRuns: (...args: unknown[]) => fetchContractRunsMock(...args),
  autoGenerateContract: (...args: unknown[]) => autoGenerateContractMock(...args),
  createContract: (...args: unknown[]) => createContractMock(...args),
  updateContract: vi.fn(),
  deleteContract: vi.fn(),
  exportContractYaml: vi.fn().mockResolvedValue({ yaml: 'name: billing_sla\nrules: []\n' }),
  importContractYaml: (...args: unknown[]) => importContractYamlMock(...args),
  evaluateContractGate: (...args: unknown[]) => evaluateContractGateMock(...args),
}));

describe('ContractsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchContractsMock.mockResolvedValue([
      {
        id: 'c1',
        project: 'p1',
        name: 'billing_sla',
        description: 'Zero PII and non-null invoice ID',
        version: 1,
        rules: [
          { type: 'expect_column_not_null', column: 'invoice_id', max_null_percent: 0, severity: 'error' },
        ],
        created_by: 'demo',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]);
    fetchContractRunsMock.mockResolvedValue([]);
  });

  it('evaluates a saved contract gate and renders pass/fail rule diagnostics', async () => {
    evaluateContractGateMock.mockResolvedValue({
      id: 'run-1',
      contract_id: 'c1',
      contract_name: 'billing_sla',
      dataset_id: 'd1',
      triggered_by: 'demo',
      status: 'failed',
      passed_rules: 0,
      failed_rules: 1,
      total_rules: 1,
      pass_rate: 0,
      results: [
        {
          rule_index: 1,
          type: 'expect_column_not_null',
          column: 'invoice_id',
          severity: 'error',
          passed: false,
          observed: '12.5% null (5 rows)',
          expected: '<= 0.0% null',
          failing_rows: 5,
        },
      ],
      created_at: '2026-01-02T00:00:00Z',
    });

    render(
      <ContractsPanel
        workspaceId="w1"
        projectId="p1"
        datasetId="d1"
        columns={['invoice_id', 'amount']}
        canEdit
        datasetReady
      />,
    );

    await waitFor(() => expect(screen.getByText('billing_sla')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /run contract gate/i }));

    expect(await screen.findByText(/gate verdict: failed/i)).toBeInTheDocument();
    expect(screen.getByText('12.5% null (5 rows)')).toBeInTheDocument();
    expect(screen.getByText('FAIL')).toBeInTheDocument();
  });

  it('auto-generates starter rules from profile and imports YAML', async () => {
    autoGenerateContractMock.mockResolvedValue({
      name: 'orders_contract',
      rules: [
        { type: 'expect_column_to_exist', column: 'amount', severity: 'error' },
      ],
      yaml: 'name: orders_contract\nrules:\n  - type: expect_column_to_exist\n    column: amount\n    severity: error\n',
    });
    importContractYamlMock.mockResolvedValue({
      id: 'c2',
      project: 'p1',
      name: 'orders_contract',
      description: '',
      version: 1,
      rules: [{ type: 'expect_column_to_exist', column: 'amount', severity: 'error' }],
      created_by: 'demo',
      created_at: '2026-01-02T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    });

    render(
      <ContractsPanel
        workspaceId="w1"
        projectId="p1"
        datasetId="d1"
        columns={['invoice_id', 'amount']}
        canEdit
        datasetReady
      />,
    );

    await waitFor(() => expect(screen.getByText('billing_sla')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /auto-generate from profile/i }));
    expect(await screen.findByText(/generated 1 starter rules/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /yaml editor/i }));
    fireEvent.click(screen.getByRole('button', { name: /import yaml as contract/i }));

    expect(importContractYamlMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/imported yaml contract/i)).toBeInTheDocument();
  });
});
