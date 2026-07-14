import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authMiddleware, clearAuthCookie, createToken, setAuthCookie, type AuthRequest } from '../auth.js';
import { getGame } from '../game.js';
import {
  ADMIN_PASSWORD,
  checkLoginAllowed,
  createDiscordUser,
  findUserByDiscordId,
  findUserById,
  findUserByUsername,
  resetFailedLogins,
  toSafeUser,
  updateDiscordProfile,
} from '../users.js';

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anmeldeversuche. Bitte später erneut versuchen.' },
  skip: (req) => req.method !== 'POST',
});

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || 'http://localhost:5173/auth/discord';

function getDiscordAvatarUrl(discordId: string, avatar: string | null): string | null {
  if (!avatar) return null;
  return `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.png`;
}

const router = Router();

router.get('/auth/discord', (req, res) => {
  if (!DISCORD_CLIENT_ID) {
    return res.status(500).json({ error: 'Discord OAuth ist nicht konfiguriert' });
  }
  const state = crypto.randomUUID();
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', DISCORD_CLIENT_ID);
  url.searchParams.set('redirect_uri', DISCORD_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('state', state);
  res.json({ url: url.toString(), state });
});

router.post('/auth/discord/callback', authRateLimit, async (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: 'Code fehlt' });
  }
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
    return res.status(500).json({ error: 'Discord OAuth ist nicht konfiguriert' });
  }

  try {
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: DISCORD_REDIRECT_URI,
      }),
    });
    if (!tokenResponse.ok) {
      const text = await tokenResponse.text();
      console.error('Discord token error:', text);
      return res.status(401).json({ error: 'Discord Authentifizierung fehlgeschlagen' });
    }
    const tokenData = await tokenResponse.json();

    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userResponse.ok) {
      const text = await userResponse.text();
      console.error('Discord user error:', text);
      return res.status(401).json({ error: 'Discord Profil konnte nicht geladen werden' });
    }
    const discordUser = await userResponse.json();

    let user = findUserByDiscordId(discordUser.id);
    const avatarUrl = getDiscordAvatarUrl(discordUser.id, discordUser.avatar);
    const displayName = discordUser.global_name || discordUser.username;
    const username = discordUser.username;

    if (!user) {
      const existingByUsername = findUserByUsername(username);
      if (existingByUsername) {
        return res.status(400).json({ error: 'Ein Account mit diesem Username existiert bereits' });
      }
      const created = createDiscordUser(discordUser.id, username, displayName, avatarUrl);
      user = findUserById(created.id);
    } else {
      if (user.displayName !== displayName || user.avatarUrl !== avatarUrl) {
        updateDiscordProfile(user.id, displayName, avatarUrl);
      }
    }

    if (!user) {
      return res.status(500).json({ error: 'Benutzer konnte nicht erstellt werden' });
    }

    if (!user.isApproved) {
      const token = createToken(user);
      setAuthCookie(res, token);
      return res.status(403).json({ error: 'Account wurde noch nicht freigegeben', user: toSafeUser(user), token });
    }

    const allowed = checkLoginAllowed(user);
    if (!allowed.allowed) {
      return res.status(403).json({ error: allowed.reason });
    }

    resetFailedLogins(user);
    const token = createToken(user);
    setAuthCookie(res, token);
    res.json({ ok: true, user: toSafeUser(user), token });
  } catch (err) {
    console.error('Discord callback error:', err);
    res.status(500).json({ error: 'Interner Fehler' });
  }
});

router.post('/admin/login', authRateLimit, (req, res) => {
  const { username, password } = req.body;
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin Login ist nicht konfiguriert' });
  }
  if (username !== 'admin' || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Falsche Anmeldedaten' });
  }

  const user = findUserByUsername('admin');
  if (!user) {
    return res.status(401).json({ error: 'Admin nicht gefunden' });
  }

  const token = createToken(user);
  setAuthCookie(res, token);
  res.json({ ok: true, user: toSafeUser(user), token });
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

export default router;
