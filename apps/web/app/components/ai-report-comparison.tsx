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
    <details className="rounded-lg border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-3.5">
      <summary className="cursor-pointer font-mono text-xs font-semibold text-[var(--ss-text)]">
        Compare saved analyses ({reports.length})
      </summary>
      <div className="mt-3 overflow-x-auto rounded border border-[var(--ss-border)] bg-[var(--ss-surface)]">
        <table
          aria-label="Saved AI analysis comparison"
          className="w-full border-collapse text-left text-xs"
        >
          <thead className="border-b border-[var(--ss-border)] bg-[var(--ss-surface-subtle)] font-mono text-[10px] uppercase tracking-wider text-[var(--ss-muted)]">
            <tr>
              <th scope="col" className="px-3 py-2">Technique</th>
              <th scope="col" className="px-3 py-2">Model</th>
              <th scope="col" className="px-3 py-2">Status</th>
              <th scope="col" className="px-3 py-2">Proposals</th>
              <th scope="col" className="px-3 py-2">Evidence references</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ss-border)] font-mono text-[11px]">
            {reports.map((report) => {
              const counts = referenceCounts(report);
              const ready = report.status === 'ready';
              return (
                <tr key={report.id}>
                  <td className="px-3 py-2">{report.technique.replaceAll('_', ' ')}</td>
                  <td className="px-3 py-2 text-[var(--ss-muted)]">{report.model}</td>
                  <td className="px-3 py-2">{report.status}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {ready ? (report.result?.recommendations?.length ?? 0) : '—'}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {ready ? `${counts.valid}/${counts.cited} recognized` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--ss-muted)]">
        These are descriptive results from saved analyses, not controlled accuracy scores.
        More proposals or references do not imply better recommendations. Review each
        report and its evidence before approving a change.
      </p>
    </details>
  );
}
