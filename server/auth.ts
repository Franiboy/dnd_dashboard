import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import type { User } from '../shared/types.js';
import { findUserById } from './users.js';

const JWT_SECRET = process.env.JWT_SECRET || '';
const COOKIE_NAME = 'dnd_token';

if (!JWT_SECRET) {
  console.error('Fehler: JWT_SECRET ist nicht gesetzt. Bitte .env.example nach .env kopieren und anpassen.');
  process.exit(1);
}

export interface AuthRequest extends Request {
  user?: User;
}

export function createToken(user: User): string {
  return jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string): { userId: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { userId: string };
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

  const base: import('express').CookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
  };

  return {
    set: {
      ...base,
      maxAge: 1000 * 60 * 60 * 24 * 7,
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

function getCookieTokens(req: Request): string[] {
  const header = req.headers.cookie;
  if (!header || typeof header !== 'string') return [];
  const tokens: string[] = [];
  for (const part of header.split(';')) {
    const [name, value] = part.trim().split('=');
    if (name === COOKIE_NAME && value) {
      tokens.push(decodeURIComponent(value));
    }
  }
  return tokens;
}

function getBearerToken(req: Request): string | null {
  const auth = req.headers['authorization'];
  if (!auth) return null;
  const value = typeof auth === 'string' ? auth : auth[0];
  return value.replace(/^Bearer\s+/i, '');
}

export function getToken(req: Request): string | null {
  const candidates = [...getCookieTokens(req)];
  const bearer = getBearerToken(req);
  if (bearer) candidates.push(bearer);

  for (const token of candidates) {
    const payload = verifyToken(token);
    if (payload && findUserById(payload.userId)) {
      return token;
    }
  }
  return null;
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const token = getToken(req);
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const payload = verifyToken(token);
  const user = payload ? findUserById(payload.userId) : null;
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
