import { createLogger } from '../logger.js';
import { generateTimelineForSession } from '../ai/timeline.js';
import { listSessionsPendingTimeline } from '../repositories/timeline.js';
import type { McpSessionUser } from '../mcp/tokens.js';

const log = createLogger('timeline-scheduler');

const SCHEDULER_USER: McpSessionUser = { id: 'scheduler', isAdmin: true };

export interface TimelineRunProgress {
  /** Human-readable status line, forwarded to the SSE stream. */
  status: string;
  done: boolean;
  total: number;
  currentSessionName: string | null;
}

let running = false;

export function isTimelineRunRunning(): boolean {
  return running;
}

/**
 * Atomically reserves the single timeline-generation slot: the check-and-set
 * runs synchronously on the Node event loop, so two entry points can never
 * both acquire. Returns the release function, or null when a generation is
 * already active. Shared by the manual campaign run, the nightly job step and
 * the targeted single-session regeneration, so concurrent AI runs can never
 * interleave and overwrite each other's events.
 */
export function acquireTimelineRun(): (() => void) | null {
  if (running) return null;
  running = true;
  return () => {
    running = false;
  };
}

/**
 * Generates/refreshes the timeline events of every session that is pending
 * (no events yet, or stale after a newer summary or an arc re-assignment).
 * Shared by the nightly job (no status callback) and the manual
 * "Zeitleiste aktualisieren" route (SSE progress).
 */
export async function processPendingTimelineSessions(
  onProgress?: (progress: TimelineRunProgress) => void
): Promise<void> {
  const pending = listSessionsPendingTimeline();
  if (pending.length === 0) {
    log.info('No sessions pending timeline generation');
    onProgress?.({
      status: 'Zeitleiste ist bereits aktuell.',
      done: true,
      total: 0,
      currentSessionName: null,
    });
    return;
  }

  log.info(`Processing ${pending.length} session(s) pending timeline generation`);
  for (const [index, session] of pending.entries()) {
    onProgress?.({
      status: `Session „${session.name}“ (${index + 1}/${pending.length}) wird verarbeitet...`,
      done: false,
      total: pending.length,
      currentSessionName: session.name,
    });
    try {
      const ok = await generateTimelineForSession(session.id, SCHEDULER_USER, undefined);
      if (!ok) {
        log.warn(`Timeline generation failed for session ${session.id}`);
      }
    } catch (err) {
      log.error(`Failed to process timeline for session ${session.id}:`, err);
    }
  }
  log.info('Finished processing pending timeline sessions');
}

/** Fire-and-forget run with a concurrency guard; returns false when already running. */
export function runTimelineGenerationNow(
  onProgress?: (progress: TimelineRunProgress) => void
): boolean {
  const release = acquireTimelineRun();
  if (!release) {
    log.info('Timeline generation already running; skipping manual trigger');
    return false;
  }
  processPendingTimelineSessions(onProgress)
    .catch((err) => log.error(`Timeline generation failed: ${err}`))
    .finally(() => {
      release();
      onProgress?.({
        status: 'Aktualisierung der Zeitleiste abgeschlossen.',
        done: true,
        total: 0,
        currentSessionName: null,
      });
    });
  return true;
}
