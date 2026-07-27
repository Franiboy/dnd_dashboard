import { generateEntitySummary } from '../ai/knowledge.js';
import { createLogger } from '../logger.js';
import { listDirtyEntitySummaries } from '../repositories/entitySummaries.js';

const log = createLogger('entity-summary-scheduler');

const NIGHT_HOUR = 3;
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let interval: ReturnType<typeof setInterval> | null = null;

async function processDirtySummaries() {
  const dirty = listDirtyEntitySummaries();
  if (dirty.length === 0) return;

  log.info(`Processing ${dirty.length} dirty entity summaries`);
  for (const { entityType, entityName } of dirty) {
    try {
      await generateEntitySummary(entityType, entityName);
    } catch (err) {
      log.warn(`Failed to generate summary for ${entityType}/${entityName}: ${err}`);
    }
  }
  log.info('Finished processing dirty entity summaries');
}

function shouldRunNow(): boolean {
  const now = new Date();
  return now.getHours() === NIGHT_HOUR;
}

export function startEntitySummaryScheduler(): void {
  if (interval) return;

  // Check once at startup in case the server starts around the target hour.
  if (shouldRunNow()) {
    processDirtySummaries().catch((err) => log.error(`Scheduled run failed: ${err}`));
  }

  interval = setInterval(() => {
    if (shouldRunNow()) {
      processDirtySummaries().catch((err) => log.error(`Scheduled run failed: ${err}`));
    }
  }, CHECK_INTERVAL_MS);
}

export function stopEntitySummaryScheduler(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
