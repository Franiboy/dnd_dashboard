import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { AppError, parseWith } from '../errors.js';
import {
  authMiddleware,
  clearAuthCookie,
  clearOAuthStateCookie,
  createToken,
  getOAuthStateCookie,
  requireApproved,
  setAuthCookie,
  setOAuthStateCookie,
  type AuthRequest,
} from '../auth.js';
import { getGame } from '../game.js';
import { createLogger } from '../logger.js';
import { isDevAutoLoginEnabled } from '../env.js';
import {
  DISCORD_REDIRECT_URI,
  DiscordOAuthError,
  exchangeDiscordCode,
  isDiscordOAuthConfigured,
} from '../discord/oauth.js';
import {
  checkLoginAllowed,
  createDiscordUser,
  findUserByDiscordId,
  findUserById,
  findUserByUsername,
  getAllUsers,
  isInitialAdmin,
  recordFailedLogin,
  resetFailedLogins,
  setUserSessionDiarySettings,
  storeDiscordTokens,
  toSafeUser,
  updateDiscordProfile,
  verifyPassword,
} from '../repositories/users.js';

const log = createLogger('auth-routes');

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anmeldeversuche. Bitte später erneut versuchen.' },
  // The app runs behind nginx on a loopback-bound socket; nginx appends the real
  // client IP as the last X-Forwarded-For entry, so trusting proxies is safe.
  validate: { trustProxy: false },
  skip: (req) => req.method !== 'POST',
});

const router = Router();

const callbackSchema = z.object({
  code: z.string({ error: 'Code oder State fehlt' }).min(1, 'Code oder State fehlt'),
  state: z.string({ error: 'Code oder State fehlt' }),
});

const booleanFlag = z.preprocess((v) => (typeof v === 'boolean' ? v : false), z.boolean());

const sessionDiarySettingsSchema = z.object({
  autoSessionToDiary: booleanFlag,
  autoAcceptSessionDiary: booleanFlag,
});

const loginSchema = z.object({
  username: z.string({ error: 'Benutzername und Passwort sind erforderlich' }),
  password: z.string({ error: 'Benutzername und Passwort sind erforderlich' }),
});

function requireOAuthConfigured(): string {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!isDiscordOAuthConfigured() || !clientId) {
    throw new AppError(500, 'Discord OAuth ist nicht konfiguriert');
  }
  return clientId;
}

function isValidState(expected: string, actual: string): boolean {
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(actual);
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

function requireInitialAdmin() {
  const user = findUserByUsername('admin');
  if (!user || !user.isAdmin || !isInitialAdmin(user)) {
    throw new AppError(500, 'Admin-Konto fehlt');
  }
  return user;
}

router.get('/auth/discord', (req, res) => {
  const clientId = requireOAuthConfigured();
  const state = crypto.randomUUID();
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', DISCORD_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('state', state);
  setOAuthStateCookie(res, state);
  res.json({ url: url.toString() });
});

router.post('/auth/discord/callback', authRateLimit, async (req, res) => {
  const { code, state } = parseWith(callbackSchema, req.body);
  requireOAuthConfigured();

  const expectedState = getOAuthStateCookie(req);
  if (!expectedState || !isValidState(expectedState, state)) {
    clearOAuthStateCookie(res);
    throw new AppError(401, 'Ungültiger OAuth State');
  }
  clearOAuthStateCookie(res);

  try {
    const discordAuth = await exchangeDiscordCode(code);

    let user = findUserByDiscordId(discordAuth.discordId);
    if (!user) {
      const existingByUsername = findUserByUsername(discordAuth.username);
      if (existingByUsername) {
        throw new AppError(400, 'Ein Account mit diesem Username existiert bereits');
      }
      const created = createDiscordUser(
        discordAuth.discordId,
        discordAuth.username,
        discordAuth.displayName,
        discordAuth.avatarUrl
      );
      user = findUserById(created.id);
    } else if (
      user.displayName !== discordAuth.displayName ||
      user.avatarUrl !== discordAuth.avatarUrl
    ) {
      updateDiscordProfile(user.id, discordAuth.displayName, discordAuth.avatarUrl);
      user = findUserById(user.id);
    }

    if (!user) {
      throw new AppError(500, 'Benutzer konnte nicht erstellt werden');
    }

    if (!user.isApproved) {
      const token = createToken(user);
      setAuthCookie(res, token);
      storeDiscordTokens(
        user.id,
        discordAuth.accessToken,
        discordAuth.refreshToken,
        discordAuth.expiresAt
      );
      res
        .status(403)
        .json({ error: 'Account wurde noch nicht freigegeben', user: toSafeUser(user) });
      return;
    }

    const allowed = checkLoginAllowed(user);
    if (!allowed.allowed) {
      throw new AppError(403, allowed.reason);
    }

    resetFailedLogins(user);
    storeDiscordTokens(
      user.id,
      discordAuth.accessToken,
      discordAuth.refreshToken,
      discordAuth.expiresAt
    );
    const token = createToken(user);
    setAuthCookie(res, token);
    res.json({ ok: true, user: toSafeUser(user) });
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof DiscordOAuthError) {
      log.warn('Discord OAuth callback failed:', {
        status: err.status,
        discordError: err.discordError,
        discordErrorDescription: err.discordErrorDescription,
      });
      const status = err.status >= 400 && err.status < 500 ? err.status : 400;
      throw new AppError(status, 'Discord Authentifizierung fehlgeschlagen');
    }
    log.error('Discord callback error:', err);
    throw new AppError(500, 'Interner Fehler', { cause: err });
  }
});

router.post('/admin/login', authRateLimit, async (req, res) => {
  const { username, password } = parseWith(loginSchema, req.body);

  const user = findUserByUsername(username);
  if (!user || !user.isAdmin || !isInitialAdmin(user)) {
    throw new AppError(401, 'Falsche Anmeldedaten');
  }

  const allowed = checkLoginAllowed(user);
  if (!allowed.allowed) {
    throw new AppError(403, allowed.reason);
  }

  if (!password || !(await verifyPassword(user, password))) {
    recordFailedLogin(user);
    throw new AppError(401, 'Falsche Anmeldedaten');
  }

  resetFailedLogins(user);
  const token = createToken(user);
  setAuthCookie(res, token);
  res.json({ ok: true, user: toSafeUser(user) });
});

router.post('/auth/dev-session', (req, res) => {
  if (!isDevAutoLoginEnabled()) {
    throw new AppError(404, 'Nicht verfügbar');
  }
  const user = requireInitialAdmin();
  resetFailedLogins(user);
  setAuthCookie(res, createToken(user));
  res.json({ ok: true, user: toSafeUser(user) });
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', authMiddleware, (req: AuthRequest, res) => {
  res.json({ ok: true, user: toSafeUser(req.user!) });
});

router.put('/me/session-diary-settings', authMiddleware, (req: AuthRequest, res) => {
  const { autoSessionToDiary, autoAcceptSessionDiary } = parseWith(
    sessionDiarySettingsSchema,
    req.body
  );

  const user = setUserSessionDiarySettings(
    req.user!.id,
    autoSessionToDiary,
    autoAcceptSessionDiary
  );
  if (!user) {
    throw new AppError(500, 'Speichern fehlgeschlagen');
  }
  res.json({ ok: true, user });
});

router.get('/state', authMiddleware, (req: AuthRequest, res) => {
  if (!req.user!.isApproved) {
    throw new AppError(403, 'Account wurde noch nicht freigegeben');
  }
  res.json(getGame());
});

router.get('/users', authMiddleware, requireApproved, (_req: AuthRequest, res) => {
  res.json(getAllUsers());
});

export default router;
