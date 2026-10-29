export type ServiceState = 'ok' | 'unavailable';

export interface HealthSnapshot {
  status: ServiceState;
  dependencies: {
    database: ServiceState;
    redis: ServiceState;
  };
}

export interface SystemStatus {
  reachable: boolean;
  live: boolean;
  ready: boolean;
  dependencies: HealthSnapshot['dependencies'];
}

export const unavailableStatus: SystemStatus = {
  reachable: false,
  live: false,
  ready: false,
  dependencies: { database: 'unavailable', redis: 'unavailable' },
};

export function parseHealthSnapshot(value: unknown): HealthSnapshot | null {
  if (typeof value !== 'object' || value === null) return null;
  const root = value as Record<string, unknown>;
  if (root.status !== 'ok' && root.status !== 'unavailable') return null;
  if (typeof root.dependencies !== 'object' || root.dependencies === null) return null;
  const dependencies = root.dependencies as Record<string, unknown>;
  if (!['ok', 'unavailable'].includes(String(dependencies.database))) return null;
  if (!['ok', 'unavailable'].includes(String(dependencies.redis))) return null;
  return {
    status: root.status,
    dependencies: {
      database: dependencies.database as ServiceState,
      redis: dependencies.redis as ServiceState,
    },
  };
}

export async function getSystemStatus(): Promise<SystemStatus> {
  const origin = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:8000';
  try {
    const [liveResponse, readyResponse] = await Promise.all([
      fetch(`${origin}/api/v1/health/live`, { cache: 'no-store', signal: AbortSignal.timeout(2500) }),
      fetch(`${origin}/api/v1/health/ready`, { cache: 'no-store', signal: AbortSignal.timeout(2500) }),
    ]);
    const live = liveResponse.ok;
    const snapshot = parseHealthSnapshot(await readyResponse.json());
    if (!snapshot) return { ...unavailableStatus, reachable: live, live };
    return {
      reachable: true,
      live,
      ready: readyResponse.ok && snapshot.status === 'ok',
      dependencies: snapshot.dependencies,
    };
  } catch {
    return unavailableStatus;
  }
}
