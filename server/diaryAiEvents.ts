import type { ServerMessagePayload } from '../shared/types.js';
import { messagePayload } from './errors.js';
import { SseBroadcaster } from './utils/sse.js';

/**
 * Per-user SSE streams for diary AI progress. Long-running AI jobs push
 * structured status/log lines to the diary page while the HTTP request is
 * still open.
 */

export type DiaryStatusInput = string | ServerMessagePayload;

const sseClients = new Map<string, SseBroadcaster>();

export function getUserBroadcaster(userId: string): SseBroadcaster {
  let broadcaster = sseClients.get(userId);
  if (!broadcaster) {
    broadcaster = new SseBroadcaster();
    sseClients.set(userId, broadcaster);
  }
  return broadcaster;
}

/** Drops the per-user broadcaster once its last client disconnected. */
export function releaseUserBroadcaster(userId: string, broadcaster: SseBroadcaster): void {
  if (broadcaster.size === 0 && sseClients.get(userId) === broadcaster) {
    sseClients.delete(userId);
  }
}

function statusPayload(
  input: DiaryStatusInput,
  statusCode = 'progress',
  technical = false
): ServerMessagePayload {
  const payload = messagePayload(input, { statusCode, technical });
  if (
    payload.errorCode === 'errors.status.completed' ||
    payload.errorCode === 'errors.status.upToDate'
  ) {
    payload.statusCode = 'completed';
  }
  return payload;
}

export function sendDiaryAiStatus(
  userId: string,
  input: DiaryStatusInput,
  statusCode = 'progress'
): void {
  const broadcaster = sseClients.get(userId);
  if (!broadcaster || broadcaster.size === 0) return;

  broadcaster.broadcast('log', JSON.stringify(statusPayload(input, statusCode)));
}

export function startProgressMessages(
  userId: string,
  initialMessage: DiaryStatusInput
): () => void {
  const messages: DiaryStatusInput[] = [
    {
      message: 'KI-Modell wird geladen...',
      messageKey: 'errors.ai.modelLoading',
      errorCode: 'errors.ai.modelLoading',
    },
    {
      message: 'KI-Anfrage wird vorbereitet...',
      messageKey: 'errors.ai.requestPreparing',
      errorCode: 'errors.ai.requestPreparing',
    },
    {
      message: 'KI generiert Zusammenfassung und Personen...',
      messageKey: 'errors.ai.generatingSummaryPeople',
      errorCode: 'errors.ai.generatingSummaryPeople',
    },
    {
      message: 'KI arbeitet noch...',
      messageKey: 'errors.ai.working',
      errorCode: 'errors.ai.working',
    },
    {
      message: 'Fast fertig...',
      messageKey: 'errors.ai.almostDone',
      errorCode: 'errors.ai.almostDone',
    },
  ];
  let index = 0;
  sendDiaryAiStatus(userId, initialMessage);
  const interval = setInterval(() => {
    sendDiaryAiStatus(userId, messages[index % messages.length]);
    index++;
  }, 3000);
  return () => clearInterval(interval);
}

function mapOpencodeStatus(line: string): ServerMessagePayload | null {
  const [action] = line.split('·').map((s) => s.trim());
  switch (action.toLowerCase()) {
    case 'build':
      return messagePayload(
        {
          message: 'KI-Modell wird geladen...',
          messageKey: 'errors.ai.modelLoading',
          errorCode: 'errors.ai.modelLoading',
        },
        { statusCode: 'progress' }
      );
    case 'run':
      return messagePayload(
        {
          message: 'KI-Anfrage wird ausgeführt...',
          messageKey: 'errors.ai.requestRunning',
          errorCode: 'errors.ai.requestRunning',
        },
        { statusCode: 'progress' }
      );
    default:
      return messagePayload(
        {
          message: `KI arbeitet: ${action}`,
          messageKey: 'errors.ai.workingAction',
          errorCode: 'errors.ai.workingAction',
          params: { action },
        },
        { statusCode: 'progress' }
      );
  }
}

export function notifyDiaryAiLog(userId: string, raw: string): void {
  const broadcaster = sseClients.get(userId);
  if (!broadcaster || broadcaster.size === 0) return;

  const messages = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line)
    .flatMap((line) => {
      const statusMatch = line.match(/^>\s*(.+)$/);
      if (statusMatch) {
        const mapped = mapOpencodeStatus(statusMatch[1]);
        return mapped ? [mapped] : [];
      }
      // Forward short diagnostic/error lines from OpenCode. These are
      // intentionally marked technical: their content can be a Python
      // traceback, command name, or provider-specific debug text and must not
      // be guessed at or translated by the UI.
      if (/^(error|fehler|warn|warning|opencode|spawn)/i.test(line)) {
        return [statusPayload(line, 'diagnostic', true)];
      }
      // Ignore raw AI output (summary text, JSON, code blocks); the final
      // result is delivered through the normal HTTP response.
      return [];
    });

  for (const payload of messages) {
    broadcaster.broadcast('log', JSON.stringify(payload));
  }
}
