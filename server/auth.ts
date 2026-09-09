import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import type { User } from '../shared/types.js';
import { findUserById } from './repositories/users.js';
import { createLogger } from './logger.js';

const log = createLogger('auth');

// Session tokens are signed with RS256. The key pair lives under data/keys/
// (mount or symlink this directory to relocate it) and is generated once on
// first start. Existing HS256 tokens become invalid after the migration.
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

function generateRsaKeyPair(): { privateKey: string; publicKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { privateKey, publicKey };
}

function loadKeyPair(): { privateKey: string; publicKey: string } {
  // Tests get an ephemeral in-memory pair: no filesystem writes and no
  // cross-process races between parallel test forks.
  if (process.env.NODE_ENV === 'test') {
    return generateRsaKeyPair();
  }
  const privatePath = 'data/keys/jwt-private.pem';
  const publicPath = 'data/keys/jwt-public.pem';
  if (existsSync(privatePath) !== existsSync(publicPath)) {
    log.error(
      'Fehler: Nur einer der JWT-Schlüssel liegt unter data/keys. Bitte beide Dateien löschen oder ergänzen.'
    );
    process.exit(1);
  }
  if (existsSync(privatePath) && existsSync(publicPath)) {
    try {
      return {
        privateKey: readFileSync(privatePath, 'utf8'),
        publicKey: readFileSync(publicPath, 'utf8'),
      };
    } catch (err) {
      log.error(`Fehler: JWT-Schlüsseldateien konnten nicht gelesen werden: ${err}`);
      process.exit(1);
    }
  }
  mkdirSync('data/keys', { recursive: true, mode: 0o700 });
  const lockPath = 'data/keys/.jwt-key-pair.lock';

  // Lock the pair creation as the two PEM renames are not one atomic operation.
  while (true) {
    try {
      mkdirSync(lockPath);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      try {
        // Recover if a process was terminated while holding the initialization lock.
        if (Date.now() - statSync(lockPath).mtimeMs > 30_000) {
          rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }

  try {
    // Another process may have completed generation while this process waited.
    if (existsSync(privatePath) && existsSync(publicPath)) {
      return {
        privateKey: readFileSync(privatePath, 'utf8'),
        publicKey: readFileSync(publicPath, 'utf8'),
      };
    }

    log.info('Keine JWT-Schlüssel vorhanden – erzeuge neues RSA-Schlüsselpaar unter data/keys/.');
    const { publicKey, privateKey } = generateRsaKeyPair();
    // Write to temp files and rename, so a concurrent start never reads a half-written PEM.
    const privateTmp = `${privatePath}.${process.pid}.tmp`;
    const publicTmp = `${publicPath}.${process.pid}.tmp`;
    writeFileSync(privateTmp, privateKey, { mode: 0o600 });
    writeFileSync(publicTmp, publicKey, { mode: 0o644 });
    renameSync(privateTmp, privatePath);
    renameSync(publicTmp, publicPath);
    return { privateKey, publicKey };
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

const JWT_KEY_PAIR = loadKeyPair();

/** Public half of the session key pair; exposed for tests and Socket.io auth. */
export function getSessionPublicKey(): string {
  return JWT_KEY_PAIR.publicKey;
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

const JWT_SIGN_OPTIONS: jwt.SignOptions = {
  algorithm: 'RS256',
  expiresIn: `${JWT_EXPIRES_IN_DAYS}d`,
};
const JWT_VERIFY_OPTIONS: jwt.VerifyOptions = { algorithms: ['RS256'] };

export function createToken(user: User): string {
  return jwt.sign({ userId: user.id }, JWT_KEY_PAIR.privateKey, JWT_SIGN_OPTIONS);
}

export function verifyToken(token: string): { userId: string } | null {
  try {
    return jwt.verify(token, JWT_KEY_PAIR.publicKey, JWT_VERIFY_OPTIONS) as {
      userId: string;
    };
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
