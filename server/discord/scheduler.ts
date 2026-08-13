import {
  listPendingTranscriptionSessions,
  getFilesBySessionId,
  updateSession,
} from '../repositories/recordings.js';
import { runTranscription, isShuttingDown } from './transcriber.js';
import { isRecordingFeatureEnabled } from './config.js';
import { createLogger } from '../logger.js';

const log = createLogger('transcription-scheduler');

let timeout: NodeJS.Timeout | null = null;
let interval: NodeJS.Timeout | null = null;
let isRunning = false;

function getDelayUntilNext2AM(): number {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 2, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

async function processPendingTranscriptions(): Promise<void> {
  if (!isRecordingFeatureEnabled()) {
    return;
  }

  const sessions = listPendingTranscriptionSessions();
  if (sessions.length === 0) {
    return;
  }

  log.info(`[transcription scheduler] Processing ${sessions.length} pending session(s)`);

  for (const session of sessions) {
    if (isShuttingDown()) {
      log.info('[transcription scheduler] Shutdown in progress, stopping backlog processing');
      break;
    }

    updateSession(session.id, { status: 'processing' });
    const files = getFilesBySessionId(session.id);

    try {
      await runTranscription(session.id, files);
      log.info(`[transcription scheduler] Completed session ${session.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`[transcription scheduler] Failed session ${session.id}:`, err);
      updateSession(session.id, { status: 'error', error: message });
    }
  }
}

export function isTranscriptionJobRunning(): boolean {
  return isRunning;
}

export function runTranscriptionJobsNow(): boolean {
  if (isRunning) {
    log.info('[transcription scheduler] Already running; skipping manual/scheduled trigger');
    return false;
  }
  if (!isRecordingFeatureEnabled()) {
    log.info('[transcription scheduler] Recording feature disabled; skipping');
    return false;
  }

  isRunning = true;
  processPendingTranscriptions()
    .catch((err) => log.error('[transcription scheduler] Manual/scheduled run failed:', err))
    .finally(() => {
      isRunning = false;
    });
  return true;
}

export function startTranscriptionScheduler(): void {
  if (!isRecordingFeatureEnabled()) {
    return;
  }

  const delay = getDelayUntilNext2AM();
  const nextRun = new Date(Date.now() + delay).toISOString();
  log.info(`[transcription scheduler] Next run at ${nextRun}`);

  timeout = setTimeout(() => {
    runTranscriptionJobsNow();
    interval = setInterval(
      () => {
        runTranscriptionJobsNow();
      },
      24 * 60 * 60 * 1000
    );
  }, delay);
}

export function stopTranscriptionScheduler(): void {
  if (timeout) {
    clearTimeout(timeout);
    timeout = null;
  }
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
