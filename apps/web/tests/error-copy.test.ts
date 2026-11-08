import { describe, expect, it } from 'vitest';
import { apiErrorMessage } from '@/lib/error-copy';

describe('safe API error presentation', () => {
  it('keeps existing generic request copy when no request ID is present', () => {
    expect(apiErrorMessage(500, null)).toBe('Request failed (500). Check the input and try again.');
  });

  it('gives actionable provider-unavailable copy', () => {
    expect(apiErrorMessage(503, null)).toContain('Retry shortly');
  });

  it('does not reflect arbitrary header values into the UI', () => {
    expect(apiErrorMessage(500, 'secret-token-not-a-uuid')).not.toContain('secret-token');
  });

  it('allows only a validated request UUID as an opaque support reference', () => {
    const id = 'b8934120-198e-49ee-b792-0188e4ea35fa';
    expect(apiErrorMessage(500, id)).toContain(`Support reference: ${id}`);
  });

  it('maintains the upload-specific message', () => {
    expect(apiErrorMessage(400, null, 'upload')).toContain('Verify the CSV file');
  });
});
