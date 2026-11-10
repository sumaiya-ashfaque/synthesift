/** Compare persisted AI report metadata without claiming model quality superiority. */

type ComparableReport = {
  id: string;
  status: string;
  technique: string;
  model: string;
  created_at: string;
  result?: {
    evidence?: {
      columns?: { id: string }[];
      findings?: { id: string }[];
    };
    recommendations?: { evidence_ids: string[] }[];
  };
};

type Props = { reports: readonly ComparableReport[] };

function referenceCounts(report: ComparableReport): { cited: number; valid: number } {
  const result = report.result;
  if (report.status !== 'ready' || !result) return { cited: 0, valid: 0 };
  const allowed = new Set([
    ...(result.evidence?.columns ?? []).map((item) => item.id),
    ...(result.evidence?.findings ?? []).map((item) => item.id),
  ]);
  const ids = (result.recommendations ?? []).flatMap((item) => item.evidence_ids ?? []);
  return { cited: ids.length, valid: ids.filter((id) => allowed.has(id)).length };
}

export function AIReportComparison({ reports }: Props) {
  if (reports.length < 2) return null;
  return (
    <details className="ss-ai-compare">
      <summary>Compare saved analyses ({reports.length})</summary>
      <div className="ss-ai-compare-scroll">
        <table aria-label="Saved AI analysis comparison">
          <thead>
            <tr>
              <th scope="col">Technique</th>
              <th scope="col">Model</th>
              <th scope="col">Status</th>
              <th scope="col">Proposals</th>
              <th scope="col">Evidence references</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((report) => {
              const counts = referenceCounts(report);
              const ready = report.status === 'ready';
              return (
                <tr key={report.id}>
                  <td>{report.technique.replaceAll('_', ' ')}</td>
                  <td>{report.model}</td>
                  <td>{report.status}</td>
                  <td>{ready ? (report.result?.recommendations?.length ?? 0) : '—'}</td>
                  <td>{ready ? `${counts.valid}/${counts.cited} recognized` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="ss-ai-note">
        These are descriptive results from saved analyses, not controlled accuracy scores.
        More proposals or references do not imply better recommendations. Review each
        report and its evidence before approving a change.
      </p>
    </details>
  );
}
