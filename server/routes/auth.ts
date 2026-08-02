import crypto from 'node:crypto';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
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
  storeDiscordTokens,
  toSafeUser,
  updateDiscordProfile,
  verifyPassword,
} from '../users.js';

const log = createLogger('auth-routes');

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anmeldeversuche. Bitte später erneut versuchen.' },
  skip: (req) => req.method !== 'POST',
});

const router = Router();

router.get('/auth/discord', (req, res) => {
  if (!isDiscordOAuthConfigured()) {
    return res.status(500).json({ error: 'Discord OAuth ist nicht konfiguriert' });
  }
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: 'Discord OAuth ist nicht konfiguriert' });
  }
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

function isValidState(expected: string, actual: string): boolean {
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(actual);
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

router.post('/auth/discord/callback', authRateLimit, async (req, res) => {
  const { code, state } = req.body;
  if (typeof code !== 'string' || !code || typeof state !== 'string') {
    return res.status(400).json({ error: 'Code oder State fehlt' });
  }
  if (!isDiscordOAuthConfigured()) {
    return res.status(500).json({ error: 'Discord OAuth ist nicht konfiguriert' });
  }

  const expectedState = getOAuthStateCookie(req);
  if (!expectedState || !isValidState(expectedState, state)) {
    clearOAuthStateCookie(res);
    return res.status(401).json({ error: 'Ungültiger OAuth State' });
  }
  clearOAuthStateCookie(res);

  try {
    const discordAuth = await exchangeDiscordCode(code);

    let user = findUserByDiscordId(discordAuth.discordId);
    if (!user) {
      const existingByUsername = findUserByUsername(discordAuth.username);
      if (existingByUsername) {
        return res.status(400).json({ error: 'Ein Account mit diesem Username existiert bereits' });
      }
      const created = createDiscordUser(discordAuth.discordId, discordAuth.username, discordAuth.displayName, discordAuth.avatarUrl);
      user = findUserById(created.id);
    } else if (user.displayName !== discordAuth.displayName || user.avatarUrl !== discordAuth.avatarUrl) {
      updateDiscordProfile(user.id, discordAuth.displayName, discordAuth.avatarUrl);
      user = findUserById(user.id);
    }

    if (!user) {
      return res.status(500).json({ error: 'Benutzer konnte nicht erstellt werden' });
    }

    if (!user.isApproved) {
      const token = createToken(user);
      setAuthCookie(res, token);
      storeDiscordTokens(user.id, discordAuth.accessToken, discordAuth.refreshToken, discordAuth.expiresAt);
      return res.status(403).json({ error: 'Account wurde noch nicht freigegeben', user: toSafeUser(user) });
    }

    const allowed = checkLoginAllowed(user);
    if (!allowed.allowed) {
      return res.status(403).json({ error: allowed.reason });
    }

    resetFailedLogins(user);
    storeDiscordTokens(user.id, discordAuth.accessToken, discordAuth.refreshToken, discordAuth.expiresAt);
    const token = createToken(user);
    setAuthCookie(res, token);
    res.json({ ok: true, user: toSafeUser(user) });
  } catch (err) {
    if (err instanceof DiscordOAuthError) {
      log.warn('Discord OAuth callback failed:', {
        status: err.status,
        discordError: err.discordError,
        discordErrorDescription: err.discordErrorDescription,
      });
      const status = err.status >= 400 && err.status < 500 ? err.status : 400;
      return res.status(status).json({ error: 'Discord Authentifizierung fehlgeschlagen' });
    }
    log.error('Discord callback error:', err);
    res.status(500).json({ error: 'Interner Fehler' });
  }
});

router.post('/admin/login', authRateLimit, (req, res) => {
  const { username, password } = req.body;
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Benutzername und Passwort sind erforderlich' });
  }

  const user = findUserByUsername(username);
  if (!user || !user.isAdmin || !isInitialAdmin(user)) {
    return res.status(401).json({ error: 'Falsche Anmeldedaten' });
  }

  const allowed = checkLoginAllowed(user);
  if (!allowed.allowed) {
    return res.status(403).json({ error: allowed.reason });
  }

  if (!password || !verifyPassword(user, password)) {
    recordFailedLogin(user);
    return res.status(401).json({ error: 'Falsche Anmeldedaten' });
  }

  resetFailedLogins(user);
  const token = createToken(user);
  setAuthCookie(res, token);
  res.json({ ok: true, user: toSafeUser(user) });
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', authMiddleware, (req: AuthRequest, res) => {
  res.json({ ok: true, user: toSafeUser(req.user!) });
});

router.get('/state', authMiddleware, (req: AuthRequest, res) => {
  if (!req.user!.isApproved) {
    return res.status(403).json({ error: 'Account wurde noch nicht freigegeben' });
  }
  res.json(getGame());
});

router.get('/users', authMiddleware, requireApproved, (req: AuthRequest, res) => {
  res.json(getAllUsers());
});

export default router;
