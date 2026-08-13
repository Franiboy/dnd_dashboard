import { ensureSuggestionPool } from '../ai/bingoSuggestions.js';
import { createLogger } from '../logger.js';

const log = createLogger('bingo-suggestion-scheduler');

// Check the suggestion pool every minute to keep it pre-filled.
const CHECK_INTERVAL_MS = 60 * 1000;

let interval: ReturnType<typeof setInterval> | null = null;

export function startBingoSuggestionScheduler(): void {
  if (interval) return;

  // Fill the pool once at startup so suggestions are ready before the first request.
  ensureSuggestionPool().catch((err) =>
    log.error('Initial bingo suggestion pool fill failed:', err)
  );

  interval = setInterval(() => {
    ensureSuggestionPool().catch((err) => log.error('Bingo suggestion pool check failed:', err));
  }, CHECK_INTERVAL_MS);
}

export function stopBingoSuggestionScheduler(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
