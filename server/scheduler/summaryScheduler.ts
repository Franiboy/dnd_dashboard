import { createLogger } from '../logger.js';
import { processPendingSessions } from './sessionAi.js';
import { processDirtyDiaryEntries } from './diarySummaries.js';
import { processDirtySummaries } from './entitySummaries.js';

const log = createLogger('summary-scheduler');

const NIGHT_HOUR = 3;
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let interval: ReturnType<typeof setInterval> | null = null;

function shouldRunNow(): boolean {
  const now = new Date();
  return now.getHours() === NIGHT_HOUR;
}

async function processNightlySummaries() {
  try {
    await processPendingSessions();
  } catch (err) {
    log.error(`Session AI processing failed: ${err}`);
  }
  try {
    await processDirtyDiaryEntries();
  } catch (err) {
    log.error(`Diary summary processing failed: ${err}`);
  }
  try {
    await processDirtySummaries();
  } catch (err) {
    log.error(`Entity summary processing failed: ${err}`);
  }
}

export function startSummaryScheduler(): void {
  if (interval) return;

  // Run once at startup in case the server starts around the target hour.
  if (shouldRunNow()) {
    processNightlySummaries().catch((err) => log.error(`Scheduled run failed: ${err}`));
  }

  interval = setInterval(() => {
    if (shouldRunNow()) {
      processNightlySummaries().catch((err) => log.error(`Scheduled run failed: ${err}`));
    }
  }, CHECK_INTERVAL_MS);
}

export function stopSummaryScheduler(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
