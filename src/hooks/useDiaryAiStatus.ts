import { useEffect, useRef, useState } from 'react';

/**
 * Diary AI progress state fed by the per-user SSE stream: a status toast,
 * an operation flag and a readiness promise AI actions wait on so early
 * status messages are not lost before the stream is connected.
 */
export function useDiaryAiStatus() {
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [aiOperation, setAiOperation] = useState(false);
  const sseReadyRef = useRef(Promise.resolve());

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
        const { message } = JSON.parse(event.data);
        if (typeof message === 'string') {
          setAiStatus(message);
        }
      } catch {
        // ignore malformed SSE messages
      }
    });
    return () => {
      resolveReady?.();
      es.close();
    };
  }, []);

  return { aiStatus, setAiStatus, aiOperation, setAiOperation, sseReadyRef };
}
