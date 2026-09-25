import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from './useI18n';
import {
  getServerMessagePayload,
  localizeServerStatus,
  type ServerMessageLike,
} from '../i18n/serverMessages';

/**
 * Diary AI progress state fed by the per-user SSE stream: a status toast,
 * an operation flag and a readiness promise AI actions wait on so early
 * status messages are not lost before the stream is connected.
 */
export function useDiaryAiStatus() {
  const { t } = useI18n();
  const [statusPayload, setStatusPayload] = useState<string | ServerMessageLike | null>(null);
  const [aiOperation, setAiOperation] = useState(false);
  const sseReadyRef = useRef(Promise.resolve());
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
    let resolveReady: (() => void) | null = null;
    sseReadyRef.current = new Promise((resolve) => {
      resolveReady = resolve;
    });

    const es = new EventSource('/api/diary/ai-events', { withCredentials: true });
    es.addEventListener('open', () => {
      resolveReady?.();
    });
    es.addEventListener('log', (event) => {
      try {
        const parsed = JSON.parse((event as MessageEvent<string>).data) as unknown;
        const payload = getServerMessagePayload(parsed);
        if (!payload) return;
        setStatusPayload(payload);
      } catch {
        // Ignore malformed SSE messages; the next structured event can still
        // provide a useful status.
      }
    });
    return () => {
      resolveReady?.();
      es.close();
    };
  }, []);

  return {
    aiStatus,
    setAiStatus: setStatusPayload,
    aiOperation,
    setAiOperation,
    sseReadyRef,
  };
}
