import type { ServerMessagePayload } from '../shared/types.js';
import { messagePayload } from './errors.js';
import { SseBroadcaster } from './utils/sse.js';

/**
 * One global SSE stream for timeline generation progress. Generation is
 * admin-triggered and campaign-wide, so every approved viewer with the
 * timeline page open watches the same progress (unlike the per-user diary
 * streams).
 */

export interface TimelineProgressMessage {
  status: string;
  done: boolean;
  total: number;
  current: number;
  currentSessionName: string | null;
  statusCode?: 'progress' | 'up-to-date' | 'completed';
}

export type TimelineStatusInput = string | ServerMessagePayload | TimelineProgressMessage;

const broadcaster = new SseBroadcaster();

export function getTimelineBroadcaster(): SseBroadcaster {
  return broadcaster;
}

/** The lifecycle marker is emitted here; clients never inspect translated text. */
function progressPayload(progress: TimelineProgressMessage): ServerMessagePayload {
  if (
    progress.statusCode === 'up-to-date' ||
    (progress.statusCode === undefined && progress.done && progress.total === 0)
  ) {
    return messagePayload(
      {
        message: 'Zeitleiste ist bereits aktuell.',
        messageKey: 'errors.status.upToDate',
        errorCode: 'errors.status.upToDate',
      },
      { statusCode: 'completed' }
    );
  }
  if (progress.done) {
    return messagePayload(
      {
        message: 'Aktualisierung der Zeitleiste abgeschlossen.',
        messageKey: 'errors.status.completed',
        errorCode: 'errors.status.completed',
      },
      { statusCode: 'completed' }
    );
  }
  return messagePayload(
    {
      message: progress.status,
      messageKey: 'errors.status.timelineSession',
      errorCode: 'errors.status.timelineSession',
      params: {
        session: progress.currentSessionName ?? '',
        current: progress.current,
        total: progress.total,
      },
    },
    { statusCode: 'progress' }
  );
}

function normalizeTimelineStatus(input: TimelineStatusInput): ServerMessagePayload {
  if (typeof input !== 'string' && 'done' in input) return progressPayload(input);
  const payload = messagePayload(input, { statusCode: 'progress' });
  if (
    payload.errorCode === 'errors.status.completed' ||
    payload.errorCode === 'errors.status.upToDate'
  ) {
    payload.statusCode = 'completed';
  }
  return payload;
}

export function sendTimelineStatus(input: TimelineStatusInput, statusCode?: string): void {
  if (broadcaster.size === 0) return;
  const payload = normalizeTimelineStatus(input);
  if (statusCode) payload.statusCode = statusCode;
  broadcaster.broadcast('log', JSON.stringify(payload));
}

/** Rotating status lines for long AI runs (diaryAiEvents pattern). */
export function startTimelineProgressMessages(initialMessage: TimelineStatusInput): () => void {
  const messages: TimelineStatusInput[] = [
    {
      message: 'KI-Modell wird geladen...',
      messageKey: 'errors.ai.modelLoading',
      errorCode: 'errors.ai.modelLoading',
    },
    {
      message: 'KI arbeitet an der Zeitleiste...',
      messageKey: 'errors.status.timelineWorking',
      errorCode: 'errors.status.timelineWorking',
    },
    {
      message: 'Ereignisse werden extrahiert...',
      messageKey: 'errors.status.extractingEvents',
      errorCode: 'errors.status.extractingEvents',
    },
    {
      message: 'Fast fertig...',
      messageKey: 'errors.ai.almostDone',
      errorCode: 'errors.ai.almostDone',
    },
  ];
  let index = 0;
  sendTimelineStatus(initialMessage);
  const interval = setInterval(() => {
    sendTimelineStatus(messages[index % messages.length]);
    index++;
  }, 3000);
  return () => clearInterval(interval);
}
