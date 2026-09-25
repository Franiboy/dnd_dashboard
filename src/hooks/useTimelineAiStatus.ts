import { useEffect, useRef, useState } from 'react';
import { useI18n } from './useI18n';
import {
  getServerMessagePayload,
  isCompletedServerMessage,
  localizeServerStatus,
} from '../i18n/serverMessages';

/**
 * Timeline generation progress fed by the global SSE stream: a status toast
 * plus a readiness promise the manual "Update timeline" action waits on so
 * early status messages are not lost before the stream is connected. The
 * completion marker is structured and does not depend on translated text.
 */
export function useTimelineAiStatus(onDone?: () => void): {
  aiStatus: string | null;
  setAiStatus: (status: string | null) => void;
  sseReadyRef: React.RefObject<Promise<void>>;
} {
  const { t } = useI18n();
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const sseReadyRef = useRef(Promise.resolve());
  const onDoneRef = useRef(onDone);
  const tRef = useRef(t);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

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
          setAiStatus(null);
          onDoneRef.current?.();
          return;
        }
        const localized = localizeServerStatus(payload, tRef.current);
        if (localized) setAiStatus(localized);
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

  return { aiStatus, setAiStatus, sseReadyRef };
}
