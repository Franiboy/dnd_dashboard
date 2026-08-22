import { ensureSuggestionPool } from '../ai/bingoSuggestions.js';
import type { TaskAudience } from '../../shared/types.js';
import { createLogger } from '../logger.js';

const log = createLogger('bingo-suggestion-scheduler');

// Check the suggestion pools every minute to keep them pre-filled.
const CHECK_INTERVAL_MS = 60 * 1000;

const POOLS: TaskAudience[] = ['players', 'dm'];

let interval: ReturnType<typeof setInterval> | null = null;

export function startBingoSuggestionScheduler(): void {
  if (interval) return;

  // Fill both pools once at startup so suggestions are ready before the first request.
  for (const audience of POOLS) {
    ensureSuggestionPool({ audience }).catch((err) =>
      log.error(`Initial bingo suggestion pool fill (${audience}) failed:`, err)
    );
  }

  interval = setInterval(() => {
    for (const audience of POOLS) {
      ensureSuggestionPool({ audience }).catch((err) =>
        log.error(`Bingo suggestion pool check (${audience}) failed:`, err)
      );
    }
  }, CHECK_INTERVAL_MS);
}

export function stopBingoSuggestionScheduler(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
