'use client';

import { useEffect, useRef, useState } from 'react';

export type DatasetStreamEvent = {
  dataset_id?: string;
  dataset_status?: string;
  row_count?: number | null;
  profile_status?: string | null;
  latest_ai_report_id?: string | null;
  latest_ai_report_status?: string | null;
  latest_contract_status?: string | null;
  pending: boolean;
  deleted?: boolean;
  timestamp: string;
};

type Options = {
  url: string | null;
  enabled: boolean;
  onUpdate: (event: DatasetStreamEvent) => void;
};

/**
 * Subscribe to real-time Server-Sent Events (SSE) for dataset ingestion/profiling jobs,
 * with graceful fallback polling if EventSource is unavailable.
 */
export function useDatasetEventStream({ url, enabled, onUpdate }: Options): {
  connected: boolean;
  lastEventAt: string | null;
} {
  const [connected, setConnected] = useState(false);
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    if (!enabled || !url) return;

    if (typeof EventSource === 'undefined') {
      const fallback = window.setInterval(() => {
        onUpdateRef.current({ pending: true, timestamp: new Date().toISOString() });
      }, 3500);
      return () => window.clearInterval(fallback);
    }

    let closed = false;
    let source: EventSource | null = null;
    let reconnectTimer: number | null = null;

    const connect = () => {
      if (closed) return;
      source = new EventSource(url, { withCredentials: true });
      source.onopen = () => {
        if (!closed) setConnected(true);
      };

      const handlePayload = (ev: MessageEvent, isDone: boolean) => {
        if (closed) return;
        try {
          const parsed = JSON.parse(String(ev.data)) as DatasetStreamEvent;
          setLastEventAt(parsed.timestamp);
          onUpdateRef.current(parsed);
          if (isDone) {
            source?.close();
            setConnected(false);
            if (parsed.pending) {
              reconnectTimer = window.setTimeout(connect, 1200);
            }
          }
        } catch {
          // Ignore malformed keepalive frames
        }
      };

      source.addEventListener('status', (ev) => handlePayload(ev as MessageEvent, false));
      source.addEventListener('done', (ev) => handlePayload(ev as MessageEvent, true));
      source.onerror = () => {
        source?.close();
        if (!closed) {
          setConnected(false);
          reconnectTimer = window.setTimeout(connect, 3000);
        }
      };
    };

    connect();

    return () => {
      closed = true;
      source?.close();
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    };
  }, [url, enabled]);

  return { connected: enabled && connected, lastEventAt };
}
