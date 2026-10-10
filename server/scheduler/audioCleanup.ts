import { AUDIO_RETENTION_WINDOW_MS } from '../../shared/retention.js';
import { deleteSessionAudioFiles } from '../discord/files.js';
import { emitSessionsUpdated } from '../discord/recordingsEvents.js';
import { createLogger } from '../logger.js';
import { getSessionById, listSessionsWithExpiredAudio } from '../repositories/recordings.js';

const log = createLogger('audio-cleanup-scheduler');

// Audio is only kept for RECORDING_RETENTION_DAYS; after that a daily pass is
// plenty, the window is far coarser than the interval.
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface AudioCleanupResult {
  /** Sessions whose audio was cleaned up (including files already gone from disk). */
  sessions: number;
  /** Audio files actually removed from disk. */
  deletedFiles: number;
}

let interval: ReturnType<typeof setInterval> | null = null;

/**
 * Deletes the audio files of every session that is older than the retention
 * window, has a transcript and is neither recording nor being transcribed.
 * Sessions without a transcript (pending transcription or failed transcription)
 * keep their audio so a later manual transcription is still possible.
 */
export async function cleanupExpiredSessionAudio(
  now: number = Date.now()
): Promise<AudioCleanupResult> {
  const cutoff = new Date(now - AUDIO_RETENTION_WINDOW_MS).toISOString();
  const sessions = listSessionsWithExpiredAudio(cutoff);
  let cleanedSessions = 0;
  let deletedFiles = 0;

  for (const session of sessions) {
    try {
      // Re-read the status: a transcription started between the query and now
      // needs the WAV files, so the cleanup steps aside.
      const current = getSessionById(session.id);
      if (!current || current.status === 'recording' || current.status === 'processing') {
        continue;
      }
      const deleted = await deleteSessionAudioFiles(session.id, { notify: false });
      cleanedSessions++;
      deletedFiles += deleted;
      if (deleted > 0) {
        log.info(
          `Deleted ${deleted} audio file(s) of expired session ${session.id} (${session.name})`
        );
      }
    } catch (err) {
      log.warn(`Audio cleanup failed for session ${session.id}:`, err);
    }
  }

  if (cleanedSessions > 0) {
    emitSessionsUpdated();
  }

  log.info(
    `Audio cleanup finished, removed ${deletedFiles} file(s) from ${cleanedSessions} session(s)`
  );
  return { sessions: cleanedSessions, deletedFiles };
}

async function runCleanup(): Promise<void> {
  try {
    await cleanupExpiredSessionAudio();
  } catch (err) {
    log.warn(`Audio cleanup failed: ${err}`);
  }
}

export function startAudioCleanupScheduler(): void {
  if (interval) return;

  // Run once at startup so audio that expired while the server was down is
  // dropped immediately instead of after the first interval.
  runCleanup().catch((err) => log.error(`Initial audio cleanup failed: ${err}`));

  interval = setInterval(() => {
    runCleanup().catch((err) => log.error(`Scheduled audio cleanup failed: ${err}`));
  }, CHECK_INTERVAL_MS);
}

export function stopAudioCleanupScheduler(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
