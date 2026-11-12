import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProductNavigation } from '../app/components/product-navigation';

describe('ProductNavigation', () => {
  it('connects existing pages and marks the current route', () => {
    render(<ProductNavigation current="workbench" />);
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/workspaces');
    expect(screen.getByRole('link', { name: 'Data workbench' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Manage data' })).toHaveAttribute('href', '/manage-data');
  });
});
