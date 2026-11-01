
export type Account = {
  id: number;
  username: string;
  email: string;
};

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

export type Dataset = {
  id: string;
  project: string;
  filename: string;
  size_bytes: number;
  sha256: string;
  status: 'queued' | 'processing' | 'ready' | 'failed';
  row_count: number | null;
  column_count: number | null;
  columns: string[];
  error_code: string;
  created_at: string;
  completed_at: string | null;
};

export type DatasetPage = {
  count: number;
  next: string | null;
  previous: string | null;
  results: Dataset[];
};

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

function readCookie(name: string): string | undefined {
  const entry = document.cookie
    .split('; ')
    .find((part) => part.startsWith(`${name}=`));

  return entry
    ? decodeURIComponent(entry.slice(name.length + 1))
    : undefined;
}

async function csrfToken(): Promise<string> {
  const response = await fetch('/api/v1/auth/csrf', {
    credentials: 'same-origin',
  });

  if (!response.ok) {
    throw new Error(
      'Unable to initialize the session. Please retry.',
    );
  }

  const token = readCookie('csrftoken');

  if (!token) {
    throw new Error(
      'Security cookie unavailable. Enable cookies and retry.',
    );
  }

  return token;
}

export async function request<T>(
  path: string,
  method: Method = 'GET',
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (method !== 'GET') {
    headers['X-CSRFToken'] = await csrfToken();

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
  }

  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers,
    body: body === undefined
      ? undefined
      : JSON.stringify(body),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Sign in to continue.');
    }

    if (response.status === 403) {
      throw new Error(
        'You do not have permission for this action.',
      );
    }

    if (response.status === 409) {
      throw new Error(
        'This item has changed. Reload and retry.',
      );
    }

    if (response.status === 429) {
      throw new Error(
        'Too many attempts. Please retry later.',
      );
    }

    throw new Error(
      `Request failed (${response.status}). Check the input and try again.`,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function uploadDataset(
  workspaceId: string,
  projectId: string,
  file: File,
): Promise<Dataset> {
  if (!file.size) {
    throw new Error('Choose a non-empty CSV file.');
  }

  if (file.size > 10 * 1024 * 1024) {
    throw new Error('CSV files must be 10 MB or smaller.');
  }

  if (!file.name.toLowerCase().endsWith('.csv')) {
    throw new Error('Choose a .csv file.');
  }

  const token = await csrfToken();

  const form = new FormData();
  form.append('file', file, file.name);

  const response = await fetch(
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}/datasets`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'X-CSRFToken': token,
      },
      body: form,
    },
  );

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Sign in to continue.');
    }

    if (response.status === 403) {
      throw new Error(
        'You do not have permission to upload here.',
      );
    }

    if (response.status === 413) {
      throw new Error(
        'CSV files must be 10 MB or smaller.',
      );
    }

    if (response.status === 503) {
      throw new Error(
        'Dataset storage is unavailable. Please retry.',
      );
    }

    if (response.status === 429) {
      throw new Error(
        'Too many attempts. Please retry later.',
      );
    }

    if (response.status === 400) {
      const payload: unknown = await response
        .json()
        .catch(() => null);

      if (
        payload &&
        typeof payload === 'object' &&
        'file' in payload
      ) {
        const fileError = (
          payload as { file?: unknown }
        ).file;

        if (
          Array.isArray(fileError) &&
          typeof fileError[0] === 'string'
        ) {
          throw new Error(fileError[0]);
        }
      }

      throw new Error(
        'Invalid CSV upload. Check the file and try again.',
      );
    }

    throw new Error(
      `Upload failed (${response.status}). Please retry.`,
    );
  }

  return (await response.json()) as Dataset;
}
