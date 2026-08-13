import { cleanupOpenCodeSessions } from '../ai/opencode.js';
import { createLogger } from '../logger.js';
import { listActiveRewriteSessionIds } from '../repositories/diary.js';

const log = createLogger('session-cleanup-scheduler');

// Run every 30 minutes and delete dnd-* opencode sessions older than 1 hour
// that are not referenced by any diary entry rewriteSessionId.
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const MAX_AGE_MS = 60 * 60 * 1000;

let interval: ReturnType<typeof setInterval> | null = null;

async function runCleanup() {
  try {
    const keepSessionIds = new Set(listActiveRewriteSessionIds());
    const deleted = await cleanupOpenCodeSessions({
      keepSessionIds,
      maxAgeMs: MAX_AGE_MS,
      prefix: 'dnd-',
    });
    log.info(`Session cleanup finished, deleted ${deleted} sessions`);
  } catch (err) {
    log.warn(`Session cleanup failed: ${err}`);
  }
}

export function startSessionCleanupScheduler(): void {
  if (interval) return;

  // Run once at startup to clean up leftover sessions from previous runs.
  runCleanup().catch((err) => log.error(`Initial session cleanup failed: ${err}`));

  interval = setInterval(() => {
    runCleanup().catch((err) => log.error(`Scheduled session cleanup failed: ${err}`));
  }, CHECK_INTERVAL_MS);
}

export function stopSessionCleanupScheduler(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
