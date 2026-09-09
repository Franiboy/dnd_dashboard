import { SseBroadcaster } from './utils/sse.js';

/**
 * Per-user SSE streams for diary AI progress. Long-running AI jobs push
 * status/log lines to the diary page while the HTTP request is still open.
 */

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

export function sendDiaryAiStatus(userId: string, message: string) {
  const broadcaster = sseClients.get(userId);
  if (!broadcaster || broadcaster.size === 0) return;

  broadcaster.broadcast('log', JSON.stringify({ message }));
}

export function startProgressMessages(userId: string, initialMessage: string): () => void {
  const messages = [
    'KI-Modell wird geladen...',
    'KI-Anfrage wird vorbereitet...',
    'KI generiert Zusammenfassung und Personen...',
    'KI arbeitet noch...',
    'Fast fertig...',
  ];
  let index = 0;
  sendDiaryAiStatus(userId, initialMessage);
  const interval = setInterval(() => {
    sendDiaryAiStatus(userId, messages[index % messages.length]);
    index++;
  }, 3000);
  return () => clearInterval(interval);
}

function mapOpencodeStatus(line: string): string | null {
  const [action] = line.split('·').map((s) => s.trim());
  switch (action.toLowerCase()) {
    case 'build':
      return 'KI-Modell wird geladen...';
    case 'run':
      return 'KI-Anfrage wird ausgeführt...';
    default:
      return `KI arbeitet: ${action}`;
  }
}

export function notifyDiaryAiLog(userId: string, raw: string) {
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
      // Forward short diagnostic/error lines from OpenCode.
      if (/^(error|fehler|warn|warning|opencode|spawn)/i.test(line)) {
        return [line];
      }
      // Ignore raw AI output (summary text, JSON, code blocks);
      // the final result is delivered via the normal HTTP response.
      return [];
    });

  for (const message of messages) {
    broadcaster.broadcast('log', JSON.stringify({ message }));
  }
}
