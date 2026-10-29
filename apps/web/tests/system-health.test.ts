import { describe, expect, it } from 'vitest';
import { parseHealthSnapshot } from '../lib/system-health';

describe('readiness payload parser', () => {
  it('accepts a complete readiness payload', () => {
    expect(parseHealthSnapshot({ status: 'ok', dependencies: { database: 'ok', redis: 'ok' } })).toEqual({
      status: 'ok',
      dependencies: { database: 'ok', redis: 'ok' },
    });
  });

  it('rejects malformed states and missing dependencies', () => {
    expect(parseHealthSnapshot({ status: 'ok', dependencies: {} })).toBeNull();
    expect(parseHealthSnapshot({ status: 'unknown', dependencies: { database: 'ok', redis: 'ok' } })).toBeNull();
    expect(parseHealthSnapshot(null)).toBeNull();
  });
});
