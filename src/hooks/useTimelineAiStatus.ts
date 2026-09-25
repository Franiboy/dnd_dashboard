import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from './useI18n';
import {
  getServerMessagePayload,
  isCompletedServerMessage,
  localizeServerStatus,
  type ServerMessageLike,
} from '../i18n/serverMessages';

/**
 * Timeline generation progress fed by the global SSE stream: a status toast
 * plus a readiness promise the manual "Update timeline" action waits on so
 * early status messages are not lost before the stream is connected. The
 * completion marker is structured and does not depend on translated text.
 */
export function useTimelineAiStatus(onDone?: () => void): {
  aiStatus: string | null;
  setAiStatus: (status: string | ServerMessageLike | null) => void;
  sseReadyRef: React.RefObject<Promise<void>>;
} {
  const { t } = useI18n();
  const [statusPayload, setStatusPayload] = useState<string | ServerMessageLike | null>(null);
  const sseReadyRef = useRef(Promise.resolve());
  const onDoneRef = useRef(onDone);
  const aiStatus = useMemo(
    () =>
      typeof statusPayload === 'string'
        ? statusPayload
        : statusPayload
          ? (localizeServerStatus(statusPayload, t) ?? null)
          : null,
    [statusPayload, t]
  );

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    let resolveReady: (() => void) | null = null;
    sseReadyRef.current = new Promise((resolve) => {
      resolveReady = resolve;
    });

    const es = new EventSource('/api/timeline/ai-events', { withCredentials: true });
    es.addEventListener('open', () => {
      resolveReady?.();
    });
    es.addEventListener('log', (event) => {
      try {
        const parsed = JSON.parse((event as MessageEvent<string>).data) as unknown;
        const payload = getServerMessagePayload(parsed);
        if (!payload) return;
        if (isCompletedServerMessage(payload)) {
          setStatusPayload(null);
          onDoneRef.current?.();
          return;
        }
        setStatusPayload(payload);
      } catch {
        // Ignore malformed SSE messages; a later structured event can still
        // provide a useful status.
      }
    });
    return () => {
      resolveReady?.();
      es.close();
    };
  }, []);

  return { aiStatus, setAiStatus: setStatusPayload, sseReadyRef };
}
