export type Account = { id: number; username: string; email: string };
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

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

function readCookie(name: string): string | undefined {
  const entry = document.cookie.split('; ').find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : undefined;
}

export async function request<T>(path: string, method: Method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') {
    const csrf = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' });
    if (!csrf.ok) throw new Error('Unable to initialize the session. Please retry.');
    const token = readCookie('csrftoken');
    if (!token) throw new Error('Security cookie unavailable. Enable cookies and retry.');
    headers['X-CSRFToken'] = token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error('Sign in to continue.');
    if (response.status === 403) throw new Error('You do not have permission for this action.');
    if (response.status === 409) throw new Error('This item has changed. Reload and retry.');
    if (response.status === 429) throw new Error('Too many attempts. Please retry later.');
    throw new Error(`Request failed (${response.status}). Check the input and try again.`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
