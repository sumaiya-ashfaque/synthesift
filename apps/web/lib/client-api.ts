import { apiErrorMessage } from './error-copy';
import type {
  AuditEventRecord,
  CIGateVerdict,
  ContractRule,
  ContractRunRecord,
  DataContractRecord,
  DatasetRowsResponse,
  DraftPipelineResponse,
  DriftComparisonReport,
  DSLStep,
  GuardrailBenchmarkResponse,
  PatScope,
  PersonalAccessTokenCreated,
  PersonalAccessTokenRecord,
  PipelineRunRecord,
  ProjectAIEvalsResponse,
  ProjectLineageGraph,
  TransformationRecipeRecord,
  WebhookDeliveryRecord,
  WebhookEndpointCreated,
  WebhookEndpointRecord,
  WorkspaceMember,
} from './types';

export type Account = {
  id: number;
  username: string;
  email: string;
};

export type Workspace = {
  id: string;
  name: string;
  description: string;
  owner: string;
  role: 'owner' | 'editor' | 'viewer';
  created_at: string;
  updated_at: string;
};

export type Project = {
  id: string;
  workspace: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
};

export type DatasetFormat = 'csv' | 'tsv' | 'parquet' | 'xlsx' | 'json' | 'ndjson';

export type Dataset = {
  id: string;
  project: string;
  filename: string;
  file_format?: DatasetFormat;
  size_bytes: number;
  sha256: string;
  status: 'queued' | 'processing' | 'ready' | 'failed';
  row_count: number | null;
  column_count: number | null;
  columns: string[];
  error_code: string;
  created_at: string;
  completed_at: string | null;
};

export type DatasetPage = {
  count: number;
  next: string | null;
  previous: string | null;
  results: Dataset[];
};

export const SUPPORTED_DATASET_EXTENSIONS = [
  '.csv',
  '.tsv',
  '.parquet',
  '.xlsx',
  '.json',
  '.jsonl',
  '.ndjson',
] as const;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

function readCookie(name: string): string | undefined {
  const entry = document.cookie
    .split('; ')
    .find((part) => part.startsWith(`${name}=`));

  return entry
    ? decodeURIComponent(entry.slice(name.length + 1))
    : undefined;
}

async function csrfToken(): Promise<string> {
  const response = await fetch('/api/v1/auth/csrf', {
    credentials: 'same-origin',
  });

  if (!response.ok) {
    throw new Error(
      'Unable to initialize the session. Please retry.',
    );
  }

  const token = readCookie('csrftoken');

  if (!token) {
    throw new Error(
      'Security cookie unavailable. Enable cookies and retry.',
    );
  }

  return token;
}

export async function request<T>(
  path: string,
  method: Method = 'GET',
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (method !== 'GET') {
    headers['X-CSRFToken'] = await csrfToken();

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
  }

  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers,
    body: body === undefined
      ? undefined
      : JSON.stringify(body),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Sign in to continue.');
    }

    if (response.status === 403) {
      throw new Error(
        'You do not have permission for this action.',
      );
    }

    if (response.status === 409) {
      throw new Error(
        'This item has changed. Reload and retry.',
      );
    }

    if (response.status === 429) {
      throw new Error(
        'Too many attempts. Please retry later.',
      );
    }

    throw new Error(
      apiErrorMessage(response.status, response.headers.get('X-Request-ID')),
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function uploadDataset(
  workspaceId: string,
  projectId: string,
  file: File,
): Promise<Dataset> {
  if (!file.size) {
    throw new Error('Choose a non-empty dataset file.');
  }

  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Dataset files must be 10 MB or smaller.');
  }

  const lower = file.name.toLowerCase();
  const validExt = SUPPORTED_DATASET_EXTENSIONS.some((ext) => lower.endsWith(ext));
  if (!validExt) {
    throw new Error('Choose a CSV, TSV, Parquet, Excel (.xlsx), or JSON/NDJSON file.');
  }

  const token = await csrfToken();

  const form = new FormData();
  form.append('file', file, file.name);

  const response = await fetch(
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}/datasets`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'X-CSRFToken': token,
      },
      body: form,
    },
  );

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Sign in to continue.');
    }

    if (response.status === 403) {
      throw new Error(
        'You do not have permission to upload here.',
      );
    }

    if (response.status === 413) {
      throw new Error(
        'Dataset files must be 10 MB or smaller.',
      );
    }

    if (response.status === 503) {
      throw new Error(
        'Dataset storage is unavailable. Please retry.',
      );
    }

    if (response.status === 429) {
      throw new Error(
        'Too many attempts. Please retry later.',
      );
    }

    if (response.status === 400) {
      const payload: unknown = await response
        .json()
        .catch(() => null);

      if (
        payload &&
        typeof payload === 'object' &&
        'file' in payload
      ) {
        const fileError = (
          payload as { file?: unknown }
        ).file;

        if (
          Array.isArray(fileError) &&
          typeof fileError[0] === 'string'
        ) {
          throw new Error(fileError[0]);
        }
      }

      throw new Error(
        'Invalid dataset upload. Check the file and try again.',
      );
    }

    throw new Error(
      apiErrorMessage(response.status, response.headers.get('X-Request-ID'), 'upload'),
    );
  }

  return (await response.json()) as Dataset;
}

export type RowsQueryParams = {
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  search?: string;
  filterCol?: string;
  filterOp?: string;
  filterVal?: string;
  issueOnly?: 'all' | 'any' | 'nulls' | 'whitespace' | 'sentinel' | 'outliers';
  maskPii?: boolean;
};

export async function fetchDatasetRows(
  workspaceId: string,
  projectId: string,
  datasetId: string,
  params: RowsQueryParams = {},
): Promise<DatasetRowsResponse> {
  const qs = new URLSearchParams();
  if (params.limit != null) qs.set('limit', String(params.limit));
  if (params.offset != null) qs.set('offset', String(params.offset));
  if (params.sortBy) qs.set('sort_by', params.sortBy);
  if (params.sortDir) qs.set('sort_dir', params.sortDir);
  if (params.search) qs.set('search', params.search);
  if (params.filterCol) qs.set('filter_col', params.filterCol);
  if (params.filterOp) qs.set('filter_op', params.filterOp);
  if (params.filterVal) qs.set('filter_val', params.filterVal);
  if (params.issueOnly && params.issueOnly !== 'all') qs.set('issue_only', params.issueOnly);
  if (params.maskPii != null) qs.set('mask_pii', String(params.maskPii));

  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return request<DatasetRowsResponse>(
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}/datasets/${datasetId}/rows${suffix}`,
  );
}

export async function seedDemoDatasets(
  workspaceId: string,
  projectId: string,
): Promise<Dataset[]> {
  return request<Dataset[]>(
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}/datasets/seed-demo`,
    'POST',
  );
}

export async function fetchWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  return request<WorkspaceMember[]>(`/api/v1/workspaces/${workspaceId}/members`);
}

export async function addWorkspaceMember(
  workspaceId: string,
  username: string,
  role: 'editor' | 'viewer',
): Promise<WorkspaceMember> {
  return request<WorkspaceMember>(`/api/v1/workspaces/${workspaceId}/members`, 'POST', {
    username,
    role,
  });
}

export async function removeWorkspaceMember(
  workspaceId: string,
  userId: number,
): Promise<void> {
  return request<void>(`/api/v1/workspaces/${workspaceId}/members/${userId}`, 'DELETE');
}

export async function fetchProjectRecipes(
  workspaceId: string,
  projectId: string,
): Promise<TransformationRecipeRecord[]> {
  return request<TransformationRecipeRecord[]>(
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}/recipes`,
  );
}

export async function createProjectRecipe(
  workspaceId: string,
  projectId: string,
  payload: { name: string; description?: string; steps: DSLStep[] },
): Promise<TransformationRecipeRecord> {
  return request<TransformationRecipeRecord>(
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}/recipes`,
    'POST',
    payload,
  );
}

export async function fetchPipelineRuns(
  workspaceId: string,
  projectId: string,
  datasetId: string,
): Promise<PipelineRunRecord[]> {
  return request<PipelineRunRecord[]>(
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}/datasets/${datasetId}/pipelines`,
  );
}

export async function suggestPipelineSteps(
  workspaceId: string,
  projectId: string,
  datasetId: string,
): Promise<{ steps: DSLStep[]; count?: number; reason?: string }> {
  return request<{ steps: DSLStep[]; count?: number; reason?: string }>(
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}/datasets/${datasetId}/pipelines/suggest`,
    'POST',
  );
}

export async function previewPipelineRun(
  workspaceId: string,
  projectId: string,
  datasetId: string,
  payload: { steps: DSLStep[]; recipe_id?: string | null; mask_pii?: boolean },
): Promise<PipelineRunRecord> {
  return request<PipelineRunRecord>(
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}/datasets/${datasetId}/pipelines`,
    'POST',
    payload,
  );
}

export async function approvePipelineRun(
  workspaceId: string,
  projectId: string,
  datasetId: string,
  runId: string,
  outputFilename?: string,
): Promise<PipelineRunRecord> {
  return request<PipelineRunRecord>(
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}/datasets/${datasetId}/pipelines/${runId}/approve`,
    'POST',
    { approve: true, ...(outputFilename ? { output_filename: outputFilename } : {}) },
  );
}

export async function exportPipelineCode(
  workspaceId: string,
  projectId: string,
  datasetId: string,
  steps: DSLStep[],
  language: 'polars' | 'pandas' | 'sql',
): Promise<{ language: string; code: string }> {
  return request<{ language: string; code: string }>(
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}/datasets/${datasetId}/pipelines/export-code`,
    'POST',
    { steps, language },
  );
}

export async function fetchProjectLineage(
  workspaceId: string,
  projectId: string,
): Promise<ProjectLineageGraph> {
  return request<ProjectLineageGraph>(
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}/lineage`,
  );
}

export async function compareDatasetDrift(
  workspaceId: string,
  projectId: string,
  baselineDatasetId: string,
  candidateDatasetId: string,
): Promise<DriftComparisonReport> {
  return request<DriftComparisonReport>(
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}/drift/compare`,
    'POST',
    {
      baseline_dataset_id: baselineDatasetId,
      candidate_dataset_id: candidateDatasetId,
    },
  );
}

export async function fetchContracts(
  workspaceId: string,
  projectId: string,
): Promise<DataContractRecord[]> {
  return request<DataContractRecord[]>(
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}/contracts`,
  );
}

export async function createContract(
  workspaceId: string,
  projectId: string,
  payload: { name: string; description?: string; rules: ContractRule[] },
): Promise<DataContractRecord> {
  return request<DataContractRecord>(
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}/contracts`,
    'POST',
    payload,
  );
}

export async function updateContract(
  workspaceId: string,
  projectId: string,
  contractId: string,
  payload: Partial<{ name: string; description: string; rules: ContractRule[] }>,
): Promise<DataContractRecord> {
  return request<DataContractRecord>(
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}/contracts/${contractId}`,
    'PATCH',
    payload,
  );
}

export async function deleteContract(
  workspaceId: string,
  projectId: string,
  contractId: string,
): Promise<void> {
  return request<void>(
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}/contracts/${contractId}`,
    'DELETE',
  );
}

export async function exportContractYaml(
  workspaceId: string,
  projectId: string,
  contractId: string,
): Promise<{ yaml: string }> {
  return request<{ yaml: string }>(
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}/contracts/${contractId}/yaml`,
  );
}

export async function importContractYaml(
  workspaceId: string,
  projectId: string,
  yaml: string,
): Promise<DataContractRecord> {
  return request<DataContractRecord>(
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}/contracts/import-yaml`,
    'POST',
    { yaml },
  );
}

export async function autoGenerateContract(
  workspaceId: string,
  projectId: string,
  datasetId: string,
): Promise<{ name?: string; rules: ContractRule[]; yaml: string; reason?: string }> {
  return request<{ name?: string; rules: ContractRule[]; yaml: string; reason?: string }>(
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}/datasets/${datasetId}/contracts/auto-generate`,
    'POST',
  );
}

export async function evaluateContractGate(
  workspaceId: string,
  projectId: string,
  datasetId: string,
  contractId: string,
): Promise<ContractRunRecord> {
  return request<ContractRunRecord>(
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}/datasets/${datasetId}/contracts/${contractId}/evaluate`,
    'POST',
  );
}

export async function fetchContractRuns(
  workspaceId: string,
  projectId: string,
  datasetId: string,
): Promise<ContractRunRecord[]> {
  return request<ContractRunRecord[]>(
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}/datasets/${datasetId}/contract-runs`,
  );
}

export async function fetchProjectAiEvals(
  workspaceId: string,
  projectId: string,
): Promise<ProjectAIEvalsResponse> {
  return request<ProjectAIEvalsResponse>(
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}/ai-evals`,
  );
}

export async function runAiGuardrailBenchmark(
  workspaceId: string,
  projectId: string,
): Promise<GuardrailBenchmarkResponse> {
  return request<GuardrailBenchmarkResponse>(
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}/ai-evals/offline-benchmark`,
    'POST',
  );
}

export async function draftPipelineFromAiReport(
  workspaceId: string,
  projectId: string,
  datasetId: string,
  reportId: string,
): Promise<DraftPipelineResponse> {
  return request<DraftPipelineResponse>(
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}/datasets/${datasetId}/ai-reports/${reportId}/draft-pipeline`,
    'POST',
  );
}

export async function fetchWorkspaceTokens(
  workspaceId: string,
): Promise<PersonalAccessTokenRecord[]> {
  return request<PersonalAccessTokenRecord[]>(`/api/v1/workspaces/${workspaceId}/tokens`);
}

export async function createWorkspaceToken(
  workspaceId: string,
  payload: { name: string; scopes: PatScope[]; expires_in_days?: number | null },
): Promise<PersonalAccessTokenCreated> {
  return request<PersonalAccessTokenCreated>(
    `/api/v1/workspaces/${workspaceId}/tokens`,
    'POST',
    payload,
  );
}

export async function revokeWorkspaceToken(workspaceId: string, tokenId: string): Promise<void> {
  return request<void>(`/api/v1/workspaces/${workspaceId}/tokens/${tokenId}`, 'DELETE');
}

export async function fetchWorkspaceAuditLogs(
  workspaceId: string,
  params?: { action?: string; outcome?: string; limit?: number },
): Promise<AuditEventRecord[]> {
  const qs = new URLSearchParams();
  if (params?.action) qs.set('action', params.action);
  if (params?.outcome) qs.set('outcome', params.outcome);
  if (params?.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return request<AuditEventRecord[]>(`/api/v1/workspaces/${workspaceId}/audit-logs${suffix}`);
}

export async function fetchWorkspaceWebhooks(
  workspaceId: string,
): Promise<WebhookEndpointRecord[]> {
  return request<WebhookEndpointRecord[]>(`/api/v1/workspaces/${workspaceId}/webhooks`);
}

export async function createWorkspaceWebhook(
  workspaceId: string,
  payload: { name: string; url: string; events: string[]; is_active?: boolean },
): Promise<WebhookEndpointCreated> {
  return request<WebhookEndpointCreated>(
    `/api/v1/workspaces/${workspaceId}/webhooks`,
    'POST',
    payload,
  );
}

export async function updateWorkspaceWebhook(
  workspaceId: string,
  webhookId: string,
  payload: Partial<{ name: string; is_active: boolean; events: string[] }>,
): Promise<WebhookEndpointRecord> {
  return request<WebhookEndpointRecord>(
    `/api/v1/workspaces/${workspaceId}/webhooks/${webhookId}`,
    'PATCH',
    payload,
  );
}

export async function deleteWorkspaceWebhook(
  workspaceId: string,
  webhookId: string,
): Promise<void> {
  return request<void>(`/api/v1/workspaces/${workspaceId}/webhooks/${webhookId}`, 'DELETE');
}

export async function testWorkspaceWebhook(
  workspaceId: string,
  webhookId: string,
  dryRun = true,
): Promise<{ delivery: WebhookDeliveryRecord; signature_header: string }> {
  return request<{ delivery: WebhookDeliveryRecord; signature_header: string }>(
    `/api/v1/workspaces/${workspaceId}/webhooks/${webhookId}/test`,
    'POST',
    { dry_run: dryRun },
  );
}

export async function fetchWebhookDeliveries(
  workspaceId: string,
  webhookId: string,
): Promise<WebhookDeliveryRecord[]> {
  return request<WebhookDeliveryRecord[]>(
    `/api/v1/workspaces/${workspaceId}/webhooks/${webhookId}/deliveries`,
  );
}

export async function runCiQualityGate(
  workspaceId: string,
  projectId: string,
  payload: {
    dataset_id: string;
    contract_id?: string | null;
    baseline_dataset_id?: string | null;
    min_quality_score?: number;
    max_psi?: number;
    fail_on_pii?: boolean;
    dry_run_webhooks?: boolean;
  },
): Promise<CIGateVerdict> {
  const token = await csrfToken();
  const response = await fetch(
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}/ci/gate`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-CSRFToken': token,
      },
      body: JSON.stringify(payload),
    },
  );

  if (response.status === 200 || response.status === 422) {
    const data = (await response.json()) as Omit<CIGateVerdict, 'http_status'>;
    return { ...data, http_status: response.status };
  }
  if (response.status === 401) throw new Error('Sign in to continue.');
  if (response.status === 403) throw new Error('You do not have permission for this action.');
  throw new Error(apiErrorMessage(response.status, response.headers.get('X-Request-ID')));
}
