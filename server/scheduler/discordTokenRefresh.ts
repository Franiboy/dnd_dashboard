import { getUsersWithDiscordTokens } from '../users.js';
import { createLogger } from '../logger.js';
import { isDiscordOAuthConfigured, syncDiscordUser } from '../discord/oauth.js';
import { isEncryptionConfigured } from '../encryption.js';

const log = createLogger('discord-token-refresh');

const parsedInterval = Number(process.env.DISCORD_TOKEN_REFRESH_INTERVAL_MS || 60 * 60 * 1000);
const CHECK_INTERVAL_MS = Number.isFinite(parsedInterval) && parsedInterval > 0 ? parsedInterval : 60 * 60 * 1000;

let interval: ReturnType<typeof setInterval> | null = null;
let running = false;

async function runRefresh() {
  if (running) {
    log.info('Discord token refresh already in progress, skipping this cycle');
    return;
  }
  running = true;

  try {
    const users = getUsersWithDiscordTokens();
    if (users.length === 0) return;

    log.info(`Refreshing Discord tokens for ${users.length} user(s)`);
    let refreshed = 0;
    let failed = 0;

    for (const user of users) {
      const success = await syncDiscordUser(user.discordId);
      if (success) {
        refreshed += 1;
      } else {
        failed += 1;
      }
    }

    log.info(`Discord token refresh finished: ${refreshed} refreshed, ${failed} failed`);
  } catch (err) {
    log.error('Discord token refresh failed:', err);
  } finally {
    running = false;
  }
}

export function startDiscordTokenRefreshScheduler(): void {
  if (interval) return;

  if (!isDiscordOAuthConfigured()) {
    log.info('Discord token refresh scheduler disabled: Discord OAuth is not configured');
    return;
  }

  if (!isEncryptionConfigured()) {
    log.warn('Discord token refresh scheduler disabled: TOKEN_ENCRYPTION_KEY is missing or invalid');
    return;
  }

  runRefresh().catch((err) => log.error(`Initial Discord token refresh failed: ${err}`));

  interval = setInterval(() => {
    runRefresh().catch((err) => log.error(`Scheduled Discord token refresh failed: ${err}`));
  }, CHECK_INTERVAL_MS);
}

export function stopDiscordTokenRefreshScheduler(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
