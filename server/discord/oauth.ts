import { createLogger } from '../logger.js';
import {
  clearDiscordTokens,
  findUserByDiscordId,
  getDiscordTokens,
  storeDiscordTokens,
  updateDiscordProfile,
} from '../repositories/users.js';

const log = createLogger('discord-oauth');

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
export const DISCORD_REDIRECT_URI =
  process.env.DISCORD_REDIRECT_URI || 'http://localhost:5173/auth/discord';

const REQUEST_TIMEOUT_MS = 10_000;

interface DiscordTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
  discriminator?: string | null;
}

export interface DiscordAuthResult {
  discordId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export class DiscordOAuthError extends Error {
  constructor(
    message: string,
    public status: number,
    public discordError?: string,
    public discordErrorDescription?: string
  ) {
    super(message);
    this.name = 'DiscordOAuthError';
  }
}

function timeoutSignal(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  timer.unref();
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

export function getDiscordAvatarUrl(
  discordId: string,
  avatar: string | null,
  discriminator: string | null = null
): string {
  if (avatar) {
    return `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.png`;
  }
  const index =
    discriminator && discriminator !== '0'
      ? parseInt(discriminator, 10) % 5
      : Number((BigInt(discordId) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

export function isDiscordOAuthConfigured(): boolean {
  return !!DISCORD_CLIENT_ID && !!DISCORD_CLIENT_SECRET;
}

function parseDiscordError(text: string): { error?: string; error_description?: string } {
  try {
    const parsed = JSON.parse(text) as { error?: string; error_description?: string };
    if (typeof parsed.error === 'string') {
      return { error: parsed.error, error_description: parsed.error_description };
    }
  } catch {
    // response was not JSON
  }
  return {};
}

function assertDiscordUser(data: unknown): DiscordUser {
  const u = data as Record<string, unknown>;
  if (typeof u.id !== 'string' || typeof u.username !== 'string') {
    throw new Error('Invalid Discord user response: missing id or username');
  }
  return {
    id: u.id,
    username: u.username,
    global_name: typeof u.global_name === 'string' ? u.global_name : null,
    avatar: typeof u.avatar === 'string' ? u.avatar : null,
    discriminator: typeof u.discriminator === 'string' ? u.discriminator : null,
  };
}

function assertTokenResponse(data: unknown): DiscordTokenResponse {
  const d = data as Record<string, unknown>;
  if (
    typeof d.access_token !== 'string' ||
    typeof d.refresh_token !== 'string' ||
    typeof d.expires_in !== 'number' ||
    !Number.isFinite(d.expires_in) ||
    d.expires_in <= 0
  ) {
    throw new Error(
      'Invalid Discord token response: missing access_token, refresh_token, or valid expires_in'
    );
  }
  return {
    access_token: d.access_token,
    token_type: typeof d.token_type === 'string' ? d.token_type : 'Bearer',
    expires_in: d.expires_in,
    refresh_token: d.refresh_token,
    scope: typeof d.scope === 'string' ? d.scope : 'identify',
  };
}

async function fetchDiscordToken(body: URLSearchParams): Promise<DiscordTokenResponse> {
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
    throw new Error('Discord OAuth is not configured');
  }

  body.set('client_id', DISCORD_CLIENT_ID);
  body.set('client_secret', DISCORD_CLIENT_SECRET);

  const { signal, clear } = timeoutSignal(REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal,
    });

    if (!res.ok) {
      const text = await res.text();
      const { error, error_description } = parseDiscordError(text);
      log.error('Discord token request failed:', { status: res.status, error, error_description });
      throw new DiscordOAuthError(
        `Discord token request failed: ${res.status}`,
        res.status,
        error,
        error_description
      );
    }

    return assertTokenResponse(await res.json());
  } finally {
    clear();
  }
}

export async function exchangeDiscordCode(code: string): Promise<DiscordAuthResult> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: DISCORD_REDIRECT_URI,
  });

  const tokenData = await fetchDiscordToken(body);
  return fetchDiscordAuthResult(tokenData);
}

export async function refreshDiscordAccessToken(refreshToken: string): Promise<DiscordAuthResult> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const tokenData = await fetchDiscordToken(body);
  return fetchDiscordAuthResult(tokenData);
}

async function fetchDiscordAuthResult(tokenData: DiscordTokenResponse): Promise<DiscordAuthResult> {
  if (!Number.isFinite(tokenData.expires_in) || tokenData.expires_in <= 0) {
    throw new Error(`Invalid Discord token response: expires_in=${tokenData.expires_in}`);
  }

  const { signal, clear } = timeoutSignal(REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      signal,
    });

    if (!res.ok) {
      const text = await res.text();
      const { error, error_description } = parseDiscordError(text);
      log.error('Discord user request failed:', { status: res.status, error, error_description });
      throw new DiscordOAuthError(
        `Discord user request failed: ${res.status}`,
        res.status,
        error,
        error_description
      );
    }

    const discordUser = assertDiscordUser(await res.json());
    const displayName = discordUser.global_name || discordUser.username;
    const avatarUrl = getDiscordAvatarUrl(
      discordUser.id,
      discordUser.avatar,
      discordUser.discriminator
    );
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

    return {
      discordId: discordUser.id,
      username: discordUser.username,
      displayName,
      avatarUrl,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt,
    };
  } finally {
    clear();
  }
}

function isTokenInvalid(err: unknown): boolean {
  return err instanceof DiscordOAuthError && err.discordError === 'invalid_grant';
}

export async function syncDiscordUser(discordId: string): Promise<boolean> {
  const user = findUserByDiscordId(discordId);
  if (!user) return false;

  const tokens = getDiscordTokens(user.id);
  if (!tokens) return false;

  let result: DiscordAuthResult;
  try {
    if (!tokens.expiresAt || tokens.expiresAt.getTime() < Date.now() + 24 * 60 * 60 * 1000) {
      result = await refreshDiscordAccessToken(tokens.refreshToken);
    } else {
      try {
        result = await fetchDiscordAuthResult({
          access_token: tokens.accessToken,
          token_type: 'Bearer',
          expires_in: Math.max(0, Math.floor((tokens.expiresAt.getTime() - Date.now()) / 1000)),
          refresh_token: tokens.refreshToken,
          scope: 'identify',
        });
      } catch (err) {
        if (err instanceof DiscordOAuthError && err.status === 401) {
          // The cached access token was rejected; try to refresh it.
          result = await refreshDiscordAccessToken(tokens.refreshToken);
        } else {
          throw err;
        }
      }
    }
  } catch (err) {
    if (isTokenInvalid(err)) {
      log.warn(`Discord tokens invalid for user ${discordId}; clearing stored tokens`);
      clearDiscordTokens(user.id);
    } else {
      log.warn(`Failed to sync Discord user ${discordId}:`, err);
    }
    return false;
  }

  try {
    storeDiscordTokens(user.id, result.accessToken, result.refreshToken, result.expiresAt);
    if (user.displayName !== result.displayName || user.avatarUrl !== result.avatarUrl) {
      updateDiscordProfile(user.id, result.displayName, result.avatarUrl);
    }
    return true;
  } catch (storageErr) {
    log.error(`Failed to persist Discord tokens for user ${discordId}:`, storageErr);
    return false;
  }
}
