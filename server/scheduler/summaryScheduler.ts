import { createLogger } from '../logger.js';
import { processPendingSessions } from './sessionAi.js';
import { processSessionToDiary } from './sessionToDiary.js';
import { processDirtyDiaryEntries } from './diarySummaries.js';
import { processDirtySummaries } from './entitySummaries.js';

const log = createLogger('summary-scheduler');

const NIGHT_HOUR = 3;
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let interval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
// Initialized to today so a server started at e.g. 16:00 does not
// immediately fire the nightly job on its first hourly tick.
let lastRunDay = new Date().toDateString();

function shouldRunNow(): boolean {
  const now = new Date();
  // Any hour at/after NIGHT_HOUR counts as long as the job has not run today,
  // so a machine that slept through 03:00 catches up on the next tick.
  return now.getHours() >= NIGHT_HOUR && lastRunDay !== now.toDateString();
}

async function processNightlySummaries() {
  try {
    await processPendingSessions();
  } catch (err) {
    log.error(`Session AI processing failed: ${err}`);
  }
  try {
    await processSessionToDiary();
  } catch (err) {
    log.error(`Session-to-diary transfer failed: ${err}`);
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

export function isNightlyJobRunning(): boolean {
  return isRunning;
}

export function runNightlyJobNow(): boolean {
  if (isRunning) {
    log.info('Nightly job already running; skipping manual/scheduled trigger');
    return false;
  }

  isRunning = true;
  lastRunDay = new Date().toDateString();
  processNightlySummaries()
    .catch((err) => log.error(`Nightly job failed: ${err}`))
    .finally(() => {
      isRunning = false;
    });
  return true;
}

export function startSummaryScheduler(): void {
  if (interval) return;

  // Run once at startup in case the server starts around the target hour.
  if (shouldRunNow()) {
    runNightlyJobNow();
  }

  interval = setInterval(() => {
    if (shouldRunNow()) {
      runNightlyJobNow();
    }
  }, CHECK_INTERVAL_MS);
}

export function stopSummaryScheduler(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
