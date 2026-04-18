import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  openApplicationEventStream,
  type ApplicationDetail,
  type ApplicationEventSnapshot,
  type ApplicationHeartbeat,
  type ExtractionProgress,
} from "@/lib/api";
import { queryKeys } from "@/lib/queries";

const MAX_RECONNECT_DELAY_MS = 5000;

function isNewerProgress(
  current: ExtractionProgress | undefined,
  next: ExtractionProgress,
) {
  if (!current) {
    return true;
  }
  return next.updated_at >= current.updated_at;
}

function isNewerDetail(
  current: ApplicationDetail | undefined,
  next: ApplicationDetail,
) {
  return !current || next.updated_at >= current.updated_at;
}

export function useApplicationEventStream(
  applicationId: string | undefined,
  enabled: boolean,
) {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const reconnectAttemptRef = useRef(0);

  useEffect(() => {
    if (!applicationId || !enabled) {
      setConnected(false);
      setLastEventAt(null);
      reconnectAttemptRef.current = 0;
      return;
    }

    let disposed = false;
    let reconnectTimer: number | null = null;
    let activeController: AbortController | null = null;

    const markEvent = () => {
      setConnected(true);
      setLastEventAt(new Date().toISOString());
      reconnectAttemptRef.current = 0;
    };

    const applySnapshot = (snapshot: ApplicationEventSnapshot) => {
      markEvent();
      queryClient.setQueryData(queryKeys.application(applicationId), (current: ApplicationDetail | undefined) =>
        isNewerDetail(current, snapshot.detail) ? snapshot.detail : current,
      );
      if (snapshot.progress) {
        queryClient.setQueryData(
          queryKeys.applicationProgress(applicationId),
          (current: ExtractionProgress | undefined) =>
            isNewerProgress(current, snapshot.progress as ExtractionProgress) ? snapshot.progress : current,
        );
      }
    };

    const applyProgress = (progress: ExtractionProgress) => {
      markEvent();
      queryClient.setQueryData(
        queryKeys.applicationProgress(applicationId),
        (current: ExtractionProgress | undefined) =>
          isNewerProgress(current, progress) ? progress : current,
      );
    };

    const applyDetail = (detail: ApplicationDetail) => {
      markEvent();
      queryClient.setQueryData(queryKeys.application(applicationId), (current: ApplicationDetail | undefined) =>
        isNewerDetail(current, detail) ? detail : current,
      );
    };

    const applyHeartbeat = (_heartbeat: ApplicationHeartbeat) => {
      markEvent();
    };

    const scheduleReconnect = () => {
      if (disposed) {
        return;
      }
      setConnected(false);
      reconnectAttemptRef.current += 1;
      const delay = Math.min(1000 * 2 ** (reconnectAttemptRef.current - 1), MAX_RECONNECT_DELAY_MS);
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, delay);
    };

    const connect = async () => {
      if (disposed) {
        return;
      }
      activeController = new AbortController();

      try {
        await openApplicationEventStream(applicationId, {
          signal: activeController.signal,
          onSnapshot: applySnapshot,
          onProgress: applyProgress,
          onDetail: applyDetail,
          onHeartbeat: applyHeartbeat,
        });
        if (!disposed) {
          scheduleReconnect();
        }
      } catch (error) {
        if (disposed || activeController.signal.aborted) {
          return;
        }
        scheduleReconnect();
      }
    };

    void connect();

    return () => {
      disposed = true;
      setConnected(false);
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      activeController?.abort();
    };
  }, [applicationId, enabled, queryClient]);

  return { connected, lastEventAt };
}
