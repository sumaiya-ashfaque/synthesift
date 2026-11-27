export type HistogramBin = {
  bin_start: number;
  bin_end: number;
  count: number;
};

export type ColumnDistribution = {
  p5: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p95: number | null;
  std: number | null;
  iqr: number | null;
  skewness: number | null;
  zero_count: number;
  negative_count: number;
  outlier_count_iqr: number;
  outlier_percent_iqr: number;
  outlier_bounds: { lower: number; upper: number } | null;
  histogram: HistogramBin[];
};

export type PatternShape = {
  shape: string;
  count: number;
  percent: number;
};

export type ColumnTextStats = {
  min_length: number | null;
  max_length: number;
  mean_length: number;
  whitespace_padding_count: number;
  sentinel_null_count: number;
  case_variant_groups: number;
  pattern_shapes: PatternShape[];
};

export type PiiSignal = {
  kind: string;
  count: number;
  percent: number;
  severity: 'high' | 'warning' | 'info';
};

export type ColumnProfileV2 = {
  name: string;
  inferred_type: string;
  semantic_type?: string;
  missing_count: number;
  missing_percent: number;
  populated_count?: number;
  distinct_count: number | null;
  distinct_count_exact?: boolean;
  numeric: { min: string; max: string; mean: string } | null;
  distribution?: ColumnDistribution | null;
  text_stats?: ColumnTextStats | null;
  pii_signals?: PiiSignal[];
};

export type QualityFinding = {
  code: string;
  severity: 'high' | 'warning' | 'info';
  message: string;
  column: string | null;
  dimension?: string;
  affected_count?: number;
};

export type QualityDimensions = {
  completeness: number;
  uniqueness: number;
  validity: number;
  consistency: number;
  privacy_safety: number;
};

export type ProfileQuality = {
  completeness_percent: number | null;
  duplicate_rows: number;
  duplicate_percent?: number;
  overall_score?: number;
  dimensions?: QualityDimensions;
  dimension_weights?: Record<string, number>;
  finding_counts?: Record<string, number>;
  findings: QualityFinding[];
  method?: string;
};

export type CorrelationPair = {
  col_a: string;
  col_b: string;
  r: number;
};

export type ProfileResultV2 = {
  profile_version?: number;
  engine?: string;
  row_count: number;
  column_count: number;
  missing_cells: number;
  duplicate_rows?: number;
  pii_summary?: {
    flagged_columns: number;
    total_matches: number;
    kinds: string[];
  };
  correlations?: CorrelationPair[];
  columns: ColumnProfileV2[];
  quality?: ProfileQuality;
};

export type DatasetProfileRecord = {
  dataset?: string;
  status: 'queued' | 'processing' | 'ready' | 'failed';
  schema_version?: number;
  result?: ProfileResultV2;
  error_code?: string;
  started_at?: string | null;
  completed_at?: string | null;
};

export type CellFlag = 'null' | 'sentinel_null' | 'whitespace' | 'outlier' | 'pii_masked';

export type GridRow = {
  row_index: number;
  cells: Record<string, string>;
  flags: Record<string, CellFlag[]>;
};

export type DatasetRowsResponse = {
  total_rows: number;
  filtered_rows: number;
  limit: number;
  offset: number;
  mask_pii: boolean;
  can_unmask_pii: boolean;
  pii_columns: string[];
  columns: string[];
  rows: GridRow[];
};

export type WorkspaceMember = {
  user_id: number;
  username: string;
  email?: string;
  role: 'owner' | 'editor' | 'viewer';
  created_at?: string;
};

export type AIReportRecord = {
  id: string;
  status: 'queued' | 'processing' | 'ready' | 'failed';
  error_code?: string;
  technique: string;
  model?: string;
  thinking_level?: string;
  max_output_tokens?: number;
  created_at: string;
  completed_at?: string | null;
  result?: {
    summary?: string;
    limitations?: string[];
    recommendations?: Array<{
      title: string;
      action: string;
      priority: 'high' | 'medium' | 'low';
      rationale: string;
      evidence_ids: string[];
      steps: string[];
      verification: string;
    }>;
    evidence?: {
      columns: Array<{ id: string; name: string; missing_percent: number | null }>;
      findings: Array<{ id: string; code: string; column: string; message: string }>;
    };
  };
};

export type RemediationRunRecord = {
  id: string;
  status: 'previewed' | 'applied';
  operations?: string[];
  report_id?: string;
  result_dataset_id?: string | null;
  created_at: string;
  applied_at?: string | null;
  validation?: {
    before_completeness_percent?: number | null;
    after_completeness_percent?: number | null;
    derived_profile_status?: string;
  };
  preview?: {
    before?: { rows?: number; missing_cells?: number; exact_duplicates?: number };
    after?: { rows?: number; missing_cells?: number; exact_duplicates?: number };
    changed_cells?: number;
    removed_duplicate_rows?: number;
    warnings?: string[];
  };
};

export type DSLOpName =
  | 'trim_whitespace'
  | 'normalize_case'
  | 'normalize_sentinel_nulls'
  | 'replace_values'
  | 'regex_replace'
  | 'fill_missing'
  | 'cast_type'
  | 'standardize_date'
  | 'clip_numeric'
  | 'drop_duplicate_rows'
  | 'filter_rows'
  | 'rename_column'
  | 'drop_columns'
  | 'split_column'
  | 'mask_pii';

export type DSLStep = {
  op: DSLOpName;
  column?: string;
  columns?: string[];
  side?: 'both' | 'left' | 'right';
  mode?: 'lower' | 'upper' | 'title';
  tokens?: string[];
  mapping?: Record<string, string>;
  pattern?: string;
  replacement?: string;
  strategy?: 'constant' | 'mean' | 'median' | 'mode' | 'ffill';
  value?: string;
  to_type?: 'integer' | 'decimal' | 'boolean' | 'date' | 'text';
  on_error?: 'null' | 'keep' | 'reject';
  output_format?: '%Y-%m-%d' | '%Y/%m/%d' | '%d-%m-%Y';
  use_iqr_bounds?: boolean;
  min_value?: number | null;
  max_value?: number | null;
  subset_columns?: string[];
  keep?: 'first' | 'last';
  condition?: 'not_null' | 'is_null' | 'eq' | 'neq' | 'contains' | 'gt' | 'lt';
  new_name?: string;
  delimiter?: string;
  new_columns?: [string, string];
  method?: 'partial_mask' | 'hash_sha256' | 'redact';
};

export type TransformationRecipeRecord = {
  id: string;
  project: string;
  name: string;
  description: string;
  steps: DSLStep[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type StepTelemetry = {
  step_index: number;
  op: string;
  column: string;
  cells_changed: number;
  rows_removed: number;
  columns_added: string[];
  columns_removed: string[];
  duration_ms: number;
  note?: string;
};

export type PipelineDiffCell = {
  column: string;
  before: string | null;
  after: string | null;
};

export type PipelineDiffRow = {
  row_index: number;
  status: 'modified' | 'removed';
  changes: PipelineDiffCell[];
};

export type PipelineTableMetrics = {
  rows: number;
  columns: number;
  missing_cells: number;
  exact_duplicates: number;
  whitespace_cells: number;
  sentinel_nulls: number;
};

export type PipelineRunRecord = {
  id: string;
  source_dataset_id: string;
  recipe_id: string | null;
  created_by: string | null;
  steps: DSLStep[];
  status: 'previewed' | 'applied';
  source_sha256: string;
  preview_summary: {
    before: PipelineTableMetrics;
    after: PipelineTableMetrics;
    total_cells_changed: number;
    total_rows_removed: number;
    modified_row_count: number;
    removed_row_count: number;
    step_telemetry: StepTelemetry[];
    diff_rows: PipelineDiffRow[];
    diff_truncated: boolean;
    output_sha256: string;
    output_size_bytes: number;
    warnings: string[];
  };
  validation: {
    before_overall_score?: number | null;
    after_overall_score?: number | null;
    score_delta?: number | null;
    before_completeness_percent?: number | null;
    after_completeness_percent?: number | null;
    derived_filename?: string;
  };
  result_dataset_id: string | null;
  created_at: string;
  applied_at: string | null;
};

export type LineageNode = {
  id: string;
  filename: string;
  file_format: string;
  status: string;
  row_count: number | null;
  column_count: number | null;
  size_bytes: number;
  sha256: string;
  overall_score: number | null;
  completeness_percent: number | null;
  is_derived: boolean;
  created_at: string;
};

export type LineageEdge = {
  id: string;
  kind: 'pipeline' | 'ai_remediation';
  source: string;
  target: string;
  label: string;
  step_count: number;
  operations: string[];
  rows_removed: number;
  cells_changed: number;
  score_delta: number | null;
  applied_at: string | null;
};

export type ProjectLineageGraph = {
  nodes: LineageNode[];
  edges: LineageEdge[];
};

export type DriftAlignedBin = {
  bin_start: number;
  bin_end: number;
  baseline_pct: number;
  candidate_pct: number;
};

export type DriftColumnReport = {
  column: string;
  baseline_type: string;
  candidate_type: string;
  kind: 'numeric' | 'categorical';
  baseline_missing_pct: number;
  candidate_missing_pct: number;
  missing_delta_pct: number;
  status: 'stable' | 'moderate' | 'drifted';
  numeric: {
    psi: number | null;
    ks_stat: number | null;
    ks_p_value: number | null;
    baseline_mean: number | null;
    candidate_mean: number | null;
    mean_shift_pct: number | null;
    baseline_p50: number | null;
    candidate_p50: number | null;
    aligned_bins: DriftAlignedBin[];
    status: string;
  } | null;
  categorical: {
    jsd: number;
    tvd: number;
    baseline_distinct: number;
    candidate_distinct: number;
    unseen_category_pct: number;
    status: string;
  } | null;
};

export type DriftComparisonReport = {
  baseline: {
    id: string;
    filename: string;
    file_format: string;
    row_count: number;
    column_count: number;
    overall_score: number | null;
  };
  candidate: {
    id: string;
    filename: string;
    file_format: string;
    row_count: number;
    column_count: number;
    overall_score: number | null;
  };
  summary: {
    status: 'stable' | 'moderate' | 'drifted';
    row_count_delta: number;
    row_count_pct_change: number;
    score_delta: number | null;
    drifted_columns: number;
    moderate_columns: number;
    stable_columns: number;
    max_psi: number;
    max_ks: number;
    max_jsd: number;
  };
  schema_drift: {
    added_columns: string[];
    removed_columns: string[];
    type_changes: Array<{ column: string; baseline_type: string; candidate_type: string }>;
    common_column_count: number;
  };
  columns: DriftColumnReport[];
};

export type ContractRuleType =
  | 'expect_column_to_exist'
  | 'expect_column_not_null'
  | 'expect_column_unique'
  | 'expect_column_values_between'
  | 'expect_column_values_in_set'
  | 'expect_column_regex_match'
  | 'expect_column_no_pii'
  | 'expect_column_no_whitespace_padding'
  | 'expect_table_row_count_between'
  | 'expect_column_mean_between';

export type ContractRule = {
  type: ContractRuleType;
  severity: 'error' | 'warning';
  column?: string;
  max_null_percent?: number;
  min_value?: number | null;
  max_value?: number | null;
  mostly?: number;
  allowed_values?: string[];
  case_sensitive?: boolean;
  pattern?: string;
  min_rows?: number | null;
  max_rows?: number | null;
  min_mean?: number | null;
  max_mean?: number | null;
};

export type DataContractRecord = {
  id: string;
  project: string;
  name: string;
  description: string;
  version: number;
  rules: ContractRule[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ContractRuleResult = {
  rule_index: number;
  type: ContractRuleType;
  column: string | null;
  severity: 'error' | 'warning';
  passed: boolean;
  observed: string;
  expected: string;
  failing_rows: number;
};

export type ContractRunRecord = {
  id: string;
  contract_id: string;
  contract_name: string;
  dataset_id: string;
  triggered_by: string | null;
  status: 'passed' | 'warning' | 'failed';
  passed_rules: number;
  failed_rules: number;
  total_rules: number;
  pass_rate: number;
  results: ContractRuleResult[];
  created_at: string;
};

export type AIEvalSummary = {
  total_reports: number;
  ready_reports: number;
  failed_reports: number;
  schema_compliance_rate: number;
  citation_grounding_rate: number;
  total_recommendations: number;
  safe_abstention_count: number;
  mean_latency_ms: number | null;
  p95_latency_ms: number | null;
  privacy_egress_policy: string;
};

export type AIEvalTechniqueRow = {
  technique: string;
  runs: number;
  ready: number;
  failed: number;
  citation_grounding_rate: number;
  avg_recommendations: number;
  mean_latency_ms: number | null;
};

export type AIEvalModelRow = {
  model: string;
  runs: number;
  ready: number;
  failed: number;
  citation_grounding_rate: number;
  avg_recommendations: number;
  mean_latency_ms: number | null;
};

export type AIEvalRecentRun = {
  id: string;
  dataset_id: string;
  dataset_filename: string;
  technique: string;
  model: string;
  status: string;
  error_code: string;
  recommendation_count: number;
  grounded_ratio: number;
  latency_ms: number | null;
  created_at: string;
};

export type ProjectAIEvalsResponse = {
  summary: AIEvalSummary;
  by_technique: AIEvalTechniqueRow[];
  by_model: AIEvalModelRow[];
  failure_breakdown: Record<string, number>;
  recent_runs: AIEvalRecentRun[];
};

export type GuardrailBenchmarkCase = {
  id: string;
  category: string;
  title: string;
  expected_outcome: 'accept' | 'reject';
  actual_outcome: 'accept' | 'reject';
  guardrail_code: string;
  passed: boolean;
  detail: string;
};

export type GuardrailBenchmarkResponse = {
  suite_version: string;
  total_cases: number;
  passed_cases: number;
  pass_rate: number;
  duration_ms: number;
  cases: GuardrailBenchmarkCase[];
};

export type DraftPipelineResponse = {
  report_id: string;
  source_recommendation_count: number;
  steps: DSLStep[];
  rationale_map: Array<{
    step_index: number;
    op: string;
    column: string;
    from_recommendation: string;
    evidence_ids: string[];
  }>;
  safety_notice: string;
};

export type PatScope = 'read' | 'write' | 'gate:run';

export type PersonalAccessTokenRecord = {
  id: string;
  workspace: string;
  name: string;
  token_prefix: string;
  scopes: PatScope[];
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  is_revoked: boolean;
  created_by: string;
  created_at: string;
};

export type PersonalAccessTokenCreated = PersonalAccessTokenRecord & {
  token: string;
};

export type AuditEventRecord = {
  id: string;
  workspace: string;
  actor_label: string;
  action: string;
  resource_type: string;
  resource_id: string;
  outcome: 'success' | 'warning' | 'blocked' | 'failed';
  metadata: Record<string, unknown>;
  created_at: string;
};

export type WebhookEndpointRecord = {
  id: string;
  workspace: string;
  name: string;
  url: string;
  events: string[];
  is_active: boolean;
  secret_preview: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type WebhookEndpointCreated = WebhookEndpointRecord & {
  signing_secret: string;
};

export type WebhookDeliveryRecord = {
  id: string;
  endpoint: string;
  event_type: string;
  status: 'delivered' | 'failed' | 'dry_run';
  http_status: number | null;
  response_excerpt: string;
  payload_summary: Record<string, unknown>;
  duration_ms: number | null;
  created_at: string;
};

export type CIGateCheck = {
  name: string;
  passed: boolean;
  expected: string;
  observed: string;
};

export type CIGateVerdict = {
  http_status: number;
  verdict: 'passed' | 'failed';
  exit_code: 0 | 1;
  dataset: {
    id: string;
    filename: string;
    file_format: string;
    row_count: number | null;
    column_count: number | null;
    sha256: string;
  };
  quality_score: number;
  pii_flagged_columns: number;
  checks: CIGateCheck[];
  contract_run: {
    run_id: string;
    contract_name: string;
    status: string;
    pass_rate: number;
    passed_rules: number;
    failed_rules: number;
  } | null;
  drift_summary: {
    baseline_filename: string;
    status: string;
    max_psi: number;
    max_ks: number;
    drifted_columns: number;
  } | null;
  markdown_summary: string;
};
