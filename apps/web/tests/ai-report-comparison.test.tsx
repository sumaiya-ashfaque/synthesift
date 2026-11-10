import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AIReportComparison } from '../app/components/ai-report-comparison';

const first = {
  id: 'one', status: 'ready', technique: 'few_shot', model: 'gemini-test',
  created_at: '2026-11-07T00:00:00Z',
  result: {
    evidence: { findings: [{ id: 'F1' }], columns: [{ id: 'C1' }] },
    recommendations: [{ evidence_ids: ['F1', 'missing'] }],
  },
};
const second = {
  id: 'two', status: 'failed', technique: 'zero_shot', model: 'gemini-test',
  created_at: '2026-11-07T01:00:00Z', result: {},
};

describe('AIReportComparison', () => {
  it('does not show a comparison for a single analysis', () => {
    render(<AIReportComparison reports={[first]} />);
    expect(screen.queryByText(/Compare saved analyses/)).not.toBeInTheDocument();
  });

  it('compares real saved fields without treating failed requests as suggestions', () => {
    render(<AIReportComparison reports={[first, second]} />);
    fireEvent.click(screen.getByText('Compare saved analyses (2)'));
    const table = screen.getByRole('table', { name: 'Saved AI analysis comparison' });
    expect(table).toBeInTheDocument();
    expect(screen.getByText('few shot')).toBeInTheDocument();
    expect(screen.getByText('1/2 recognized')).toBeInTheDocument();
    expect(screen.getByText(/not controlled accuracy scores/)).toBeInTheDocument();
  });
});
