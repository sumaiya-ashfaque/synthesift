import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusPanel } from '../app/components/status-panel';

describe('StatusPanel', () => {
  it('renders health and dependency information accessibly', () => {
    render(<StatusPanel status={{ reachable: true, live: true, ready: false, dependencies: { database: 'ok', redis: 'unavailable' } }} />);
    expect(screen.getByRole('heading', { name: 'System readiness' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Degraded');
    expect(screen.getByText('Redis')).toBeInTheDocument();
    expect(screen.getAllByText('Unavailable')).toHaveLength(1);
  });
});
