/**
 * Timing rules for automatic voice recording.
 *
 * Recording starts only after a short settle window so users who join and leave
 * again immediately do not leave phantom sessions behind. Sessions that still
 * end without any audio inside that window are discarded instead of reported
 * as errors.
 */
export const AUTO_START_SETTLE_MS = 10_000;
export const AUTO_EMPTY_SESSION_MAX_MS = 120_000;

/**
 * Returns true when an automatically created session recorded no audio and was
 * stopped within the phantom-session window, so it can be removed silently.
 */
export function isDiscardableEmptyAutoSession(
  createdBy: string,
  startedAt: string,
  stoppedAt: string
): boolean {
  if (createdBy !== 'auto') return false;
  const startedMs = Date.parse(startedAt);
  const stoppedMs = Date.parse(stoppedAt);
  if (!Number.isFinite(startedMs) || !Number.isFinite(stoppedMs)) return false;
  const durationMs = stoppedMs - startedMs;
  return durationMs >= 0 && durationMs <= AUTO_EMPTY_SESSION_MAX_MS;
}
