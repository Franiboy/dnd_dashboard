import { processDiaryEntryAi } from '../ai/rewrite.js';
import { createLogger } from '../logger.js';
import { listDirtyDiaryEntries } from '../repositories/diary.js';

const log = createLogger('diary-summary-scheduler');

const NIGHT_HOUR = 3;
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const BATCH_SIZE = 10;

let interval: ReturnType<typeof setInterval> | null = null;

async function processDirtyDiaryEntries() {
  const dirty = listDirtyDiaryEntries(BATCH_SIZE);
  if (dirty.length === 0) return;

  log.info(`Processing ${dirty.length} dirty diary entries`);
  for (const entry of dirty) {
    try {
      await processDiaryEntryAi(entry.id);
    } catch (err) {
      log.warn(`Failed to process diary entry ${entry.id}: ${err}`);
    }
  }
  log.info('Finished processing dirty diary entries');
}

function shouldRunNow(): boolean {
  const now = new Date();
  return now.getHours() === NIGHT_HOUR;
}

export function startDiarySummaryScheduler(): void {
  if (interval) return;

  // Run once at startup in case the server starts around the target hour.
  if (shouldRunNow()) {
    processDirtyDiaryEntries().catch((err) => log.error(`Scheduled run failed: ${err}`));
  }

  interval = setInterval(() => {
    if (shouldRunNow()) {
      processDirtyDiaryEntries().catch((err) => log.error(`Scheduled run failed: ${err}`));
    }
  }, CHECK_INTERVAL_MS);
}

export function stopDiarySummaryScheduler(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
