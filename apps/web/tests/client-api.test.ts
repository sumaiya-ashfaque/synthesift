import { afterEach, describe, expect, it, vi } from 'vitest';
import { request } from '@/lib/client-api';

const fetchMock = vi.fn<typeof fetch>();

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  document.cookie = 'csrftoken=; Max-Age=0; Path=/';
});

describe('same-origin session API', () => {
  it('includes a CSRF token on mutations', async () => {
    document.cookie = 'csrftoken=valid%2Btoken; Path=/';
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response('{"id":"123"}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    const value = await request<{ id: string }>('/api/v1/workspaces', 'POST', { name: 'A' });
    expect(value.id).toBe('123');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/v1/workspaces', expect.objectContaining({
      credentials: 'same-origin',
      headers: expect.objectContaining({ 'X-CSRFToken': 'valid+token' }),
    }));
  });

  it('rejects mutations when CSRF cookie is missing', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(request('/api/v1/workspaces', 'POST', { name: 'A' })).rejects.toThrow('Security cookie unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns meaningful errors for expired sessions', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(request('/api/v1/auth/me')).rejects.toThrow('Sign in to continue.');
  });
});
