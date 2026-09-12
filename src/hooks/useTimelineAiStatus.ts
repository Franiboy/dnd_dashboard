import { useEffect, useRef, useState } from 'react';

/**
 * Timeline generation progress fed by the global SSE stream: a status toast
 * plus a readiness promise the manual "Zeitleiste aktualisieren" action waits
 * on so early status messages are not lost before the stream is connected
 * (same pattern as the diary AI status hook). The completion message clears
 * the status itself; `onDone` only triggers the reload.
 */
export function useTimelineAiStatus(onDone?: () => void): {
  aiStatus: string | null;
  setAiStatus: (status: string | null) => void;
  sseReadyRef: React.RefObject<Promise<void>>;
} {
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const sseReadyRef = useRef(Promise.resolve());
  const onDoneRef = useRef(onDone);

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
        const { message } = JSON.parse(event.data);
        if (typeof message === 'string') {
          if (message.includes('abgeschlossen')) {
            setAiStatus(null);
            onDoneRef.current?.();
          } else {
            setAiStatus(message);
          }
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

  return { aiStatus, setAiStatus, sseReadyRef };
}
