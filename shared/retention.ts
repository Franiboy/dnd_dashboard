/**
 * Retention windows of the recording module. Shared by the server routes, the
 * background audio cleanup and the sessions page so client and server never
 * disagree about what is still deletable.
 */
export const RECORDING_RETENTION_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A recording session can only be deleted within this window after `startedAt`. */
export const SESSION_DELETE_WINDOW_MS = RECORDING_RETENTION_DAYS * DAY_MS;

/** Audio files are deleted automatically once the session is this old. */
export const AUDIO_RETENTION_WINDOW_MS = RECORDING_RETENTION_DAYS * DAY_MS;

/** True while a session that started at `startedAt` is still inside the delete window. */
export function isWithinDeleteWindow(startedAt: string, now: number = Date.now()): boolean {
  return now - new Date(startedAt).getTime() < SESSION_DELETE_WINDOW_MS;
}
