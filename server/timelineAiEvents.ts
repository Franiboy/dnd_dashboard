import { SseBroadcaster } from './utils/sse.js';

/**
 * One global SSE stream for timeline generation progress. Generation is
 * admin-triggered and campaign-wide, so every approved viewer with the
 * timeline page open watches the same progress (unlike the per-user diary
 * streams).
 */

const broadcaster = new SseBroadcaster();

export function getTimelineBroadcaster(): SseBroadcaster {
  return broadcaster;
}

export function sendTimelineStatus(message: string): void {
  if (broadcaster.size === 0) return;
  broadcaster.broadcast('log', JSON.stringify({ message }));
}

/** Rotating status lines for long AI runs (diaryAiEvents pattern). */
export function startTimelineProgressMessages(initialMessage: string): () => void {
  const messages = [
    'KI-Modell wird geladen...',
    'KI arbeitet an der Zeitleiste...',
    'Ereignisse werden extrahiert...',
    'Fast fertig...',
  ];
  let index = 0;
  sendTimelineStatus(initialMessage);
  const interval = setInterval(() => {
    sendTimelineStatus(messages[index % messages.length]);
    index++;
  }, 3000);
  return () => clearInterval(interval);
}
