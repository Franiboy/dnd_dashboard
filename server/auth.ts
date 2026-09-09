import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import type { User } from '../shared/types.js';
import { findUserById } from './repositories/users.js';
import { createLogger } from './logger.js';

const log = createLogger('auth');

const JWT_SECRET = process.env.JWT_SECRET || '';
const COOKIE_NAME = 'dnd_token';
const OAUTH_STATE_COOKIE_NAME = 'dnd_oauth_state';
const OAUTH_STATE_MAX_AGE_MS = 5 * 60 * 1000;

// Session lifetime is configurable in days; defaults to 7 days.
const parsedJwtExpiresInDays = Number(process.env.JWT_EXPIRES_IN_DAYS || 7);
const JWT_EXPIRES_IN_DAYS =
  Number.isFinite(parsedJwtExpiresInDays) && parsedJwtExpiresInDays > 0
    ? parsedJwtExpiresInDays
    : 7;
const MS_PER_DAY = 1000 * 60 * 60 * 24;
const TOKEN_MAX_AGE_MS = JWT_EXPIRES_IN_DAYS * MS_PER_DAY;

if (!JWT_SECRET) {
  log.error(
    'Fehler: JWT_SECRET ist nicht gesetzt. Bitte .env.example nach .env kopieren und anpassen.'
  );
  process.exit(1);
}

import { AppError } from './errors.js';

export interface AuthRequest extends Request {
  user?: User;
}

/**
 * Returns the authenticated user or throws a 403 AppError. Use inside routers
 * that already run `authMiddleware` (+ `requireApproved`) to narrow the
 * optional `req.user` typing without repeating null checks.
 */
export function requireUser(req: AuthRequest): User {
  if (!req.user) {
    throw new AppError(403, 'Nicht autorisiert');
  }
  return req.user;
}

export function createToken(user: User): string {
  return jwt.sign({ userId: user.id }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: `${JWT_EXPIRES_IN_DAYS}d`,
  });
}

export function verifyToken(token: string): { userId: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as { userId: string };
  } catch {
    return null;
  }
}

function buildCookieOptions(res: Response): {
  set: import('express').CookieOptions;
  clearHostOnly: import('express').CookieOptions;
  clearDomain: import('express').CookieOptions | null;
} {
  const hostname = res.req?.hostname;
  const isLocalhost = hostname === 'localhost';
  const domain = isLocalhost ? 'localhost' : undefined;
  const secure = res.req?.secure === true;

  const base: import('express').CookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure,
  };

  return {
    set: {
      ...base,
      maxAge: TOKEN_MAX_AGE_MS,
      domain,
    },
    clearHostOnly: { ...base, path: '/' },
    clearDomain: domain ? { ...base, domain, path: '/' } : null,
  };
}

export function setAuthCookie(res: Response, token: string): void {
  const { set, clearHostOnly, clearDomain } = buildCookieOptions(res);

  // Clear stale cookies first so only one valid token remains.
  // This matters on localhost where browsers may hold both host-only and domain cookies for different ports.
  res.clearCookie(COOKIE_NAME, clearHostOnly);
  if (clearDomain) {
    res.clearCookie(COOKIE_NAME, clearDomain);
  }

  res.cookie(COOKIE_NAME, token, set);
}

export function clearAuthCookie(res: Response): void {
  const { clearHostOnly, clearDomain } = buildCookieOptions(res);

  res.clearCookie(COOKIE_NAME, clearHostOnly);
  if (clearDomain) {
    res.clearCookie(COOKIE_NAME, clearDomain);
  }
}

export function setOAuthStateCookie(res: Response, state: string): void {
  const { set, clearHostOnly, clearDomain } = buildCookieOptions(res);

  // Clear stale state cookies first to avoid ambiguity on localhost.
  res.clearCookie(OAUTH_STATE_COOKIE_NAME, clearHostOnly);
  if (clearDomain) {
    res.clearCookie(OAUTH_STATE_COOKIE_NAME, clearDomain);
  }

  res.cookie(OAUTH_STATE_COOKIE_NAME, state, { ...set, maxAge: OAUTH_STATE_MAX_AGE_MS });
}

export function clearOAuthStateCookie(res: Response): void {
  const { clearHostOnly, clearDomain } = buildCookieOptions(res);

  res.clearCookie(OAUTH_STATE_COOKIE_NAME, clearHostOnly);
  if (clearDomain) {
    res.clearCookie(OAUTH_STATE_COOKIE_NAME, clearDomain);
  }
}

export function getOAuthStateCookie(req: Request): string | null {
  const value = req.cookies?.[OAUTH_STATE_COOKIE_NAME];
  return typeof value === 'string' ? value : null;
}

function decodeCookieValue(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function getCookieTokens(req: Request): string[] {
  // Express with cookie-parser exposes req.cookies; Socket.io handshakes only have headers.cookie.
  const parsedCookies = (req as any).cookies;
  if (parsedCookies && typeof parsedCookies[COOKIE_NAME] === 'string') {
    const value = parsedCookies[COOKIE_NAME];
    if (value) return [value];
  }

  const header = req.headers?.cookie;
  if (typeof header !== 'string') return [];

  const tokens: string[] = [];
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const name = trimmed.slice(0, eqIndex);
    if (name !== COOKIE_NAME) continue;
    const value = trimmed.slice(eqIndex + 1);
    const decoded = value ? decodeCookieValue(value) : null;
    if (decoded) tokens.push(decoded);
  }
  return tokens;
}

function getBearerToken(req: Request): string | null {
  const auth = req.headers['authorization'];
  if (!auth) return null;
  const value = typeof auth === 'string' ? auth : auth[0];
  return value.replace(/^Bearer\s+/i, '');
}

export function getAuthenticatedUser(req: Request, extraTokens: string[] = []): User | null {
  const candidates = [...extraTokens, ...getCookieTokens(req)];
  const bearer = getBearerToken(req);
  if (bearer) candidates.push(bearer);

  for (const token of candidates) {
    const payload = verifyToken(token);
    if (payload) {
      const user = findUserById(payload.userId);
      if (user) return user;
    }
  }
  return null;
}

export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const user = getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  req.user = user;
  next();
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user?.isAdmin) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}

export function requireApproved(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user?.isApproved && !req.user?.isAdmin) {
    res.status(403).json({ error: 'Forbidden: Account not approved' });
    return;
  }
  next();
}
