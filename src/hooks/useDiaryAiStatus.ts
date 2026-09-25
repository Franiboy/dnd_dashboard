import { useEffect, useRef, useState } from 'react';
import { useI18n } from './useI18n';
import { getServerMessagePayload, localizeServerStatus } from '../i18n/serverMessages';

/**
 * Diary AI progress state fed by the per-user SSE stream: a status toast,
 * an operation flag and a readiness promise AI actions wait on so early
 * status messages are not lost before the stream is connected.
 */
export function useDiaryAiStatus() {
  const { t } = useI18n();
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [aiOperation, setAiOperation] = useState(false);
  const sseReadyRef = useRef(Promise.resolve());
  const tRef = useRef(t);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

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
        const localized = localizeServerStatus(payload, tRef.current);
        if (localized) setAiStatus(localized);
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

  return { aiStatus, setAiStatus, aiOperation, setAiOperation, sseReadyRef };
}
