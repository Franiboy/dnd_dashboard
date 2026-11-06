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
import { AppError, errorPayload } from './errors.js';

const log = createLogger('auth');

// Session tokens are signed with RS256. The key pair lives under data/keys/
// (mount or symlink this directory to relocate it) and is generated once on
// first start. Existing HS256 tokens become invalid after the migration.
const COOKIE_NAME = 'dnd_token';
const OAUTH_STATE_COOKIE_NAME = 'dnd_oauth_state';
export const VIEW_AS_USER_HEADER = 'x-dnd-view-as-user';
const OAUTH_STATE_MAX_AGE_MS = 5 * 60 * 1000;

// Session lifetime is configurable in days; defaults to 14 days. The cookie is
// renewed on authenticated activity, so the window is an inactivity timeout
// rather than a hard cutoff from the login time.
const parsedJwtExpiresInDays = Number(process.env.JWT_EXPIRES_IN_DAYS || 14);
const JWT_EXPIRES_IN_DAYS =
  Number.isFinite(parsedJwtExpiresInDays) && parsedJwtExpiresInDays > 0
    ? parsedJwtExpiresInDays
    : 14;
const MS_PER_DAY = 1000 * 60 * 60 * 24;
const TOKEN_MAX_AGE_MS = JWT_EXPIRES_IN_DAYS * MS_PER_DAY;

// Absolute cap from the original login. Renewals keep the original authTime,
// so a stolen cookie cannot stay valid forever.
const parsedJwtMaxSessionDays = Number(process.env.JWT_MAX_SESSION_DAYS || 90);
const JWT_MAX_SESSION_DAYS =
  Number.isFinite(parsedJwtMaxSessionDays) && parsedJwtMaxSessionDays > 0
    ? parsedJwtMaxSessionDays
    : 90;
const MAX_SESSION_AGE_MS = JWT_MAX_SESSION_DAYS * MS_PER_DAY;

// Renew a session at most once per day, and at most once per minute per user
// to avoid issuing a new cookie for every parallel request at the threshold.
export const SESSION_RENEW_AFTER_MS = MS_PER_DAY;
const RENEW_THROTTLE_MS = 60 * 1000;

export interface VerifiedSession {
  userId: string;
  issuedAtMs: number;
  authTimeMs: number;
}

interface SessionPayload {
  userId: string;
  authTime?: number;
  iat?: number;
}

/** Returns false once the absolute session cap (measured from the first login) is exceeded. */
export function isSessionWithinMaxAge(authTimeMs: number, nowMs = Date.now()): boolean {
  if (!Number.isFinite(authTimeMs)) return false;
  // Tolerate small clock skew, but reject tokens that claim to start in the future.
  if (authTimeMs > nowMs + 5 * 60 * 1000) return false;
  return nowMs - authTimeMs <= MAX_SESSION_AGE_MS;
}

/** True when the token is old enough to refresh its cookie on the next request. */
export function shouldRenewSession(
  session: Pick<VerifiedSession, 'issuedAtMs'>,
  nowMs = Date.now()
): boolean {
  return nowMs - session.issuedAtMs >= SESSION_RENEW_AFTER_MS;
}

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

export interface AuthRequest extends Request {
  user?: User;
  /** Validated admin simulation target; never used for authorization. */
  viewAsUser?: User;
}

/**
 * Returns the authenticated user or throws a 403 AppError. Use inside routers
 * that already run `authMiddleware` (+ `requireApproved`) to narrow the
 * optional `req.user` typing without repeating null checks.
 */
export function requireUser(req: AuthRequest): User {
  if (!req.user) {
    throw new AppError(403, 'Nicht autorisiert', { messageKey: 'errors.unauthorized' });
  }
  return req.user;
}

const JWT_SIGN_OPTIONS: jwt.SignOptions = {
  algorithm: 'RS256',
  expiresIn: `${JWT_EXPIRES_IN_DAYS}d`,
};
const JWT_VERIFY_OPTIONS: jwt.VerifyOptions = { algorithms: ['RS256'] };

/**
 * Issues a session token. `authTimeMs` is the original login time and must be
 * preserved when an existing session is renewed, so the absolute cap still
 * applies across renewals.
 */
export function createToken(user: User, authTimeMs: number = Date.now()): string {
  const authTime = Math.floor(authTimeMs / 1000);
  return jwt.sign({ userId: user.id, authTime }, JWT_KEY_PAIR.privateKey, JWT_SIGN_OPTIONS);
}

export function verifyToken(token: string): VerifiedSession | null {
  try {
    const payload = jwt.verify(token, JWT_KEY_PAIR.publicKey, JWT_VERIFY_OPTIONS) as SessionPayload;
    if (!payload || typeof payload.userId !== 'string') return null;
    if (typeof payload.iat !== 'number') return null;

    const issuedAtMs = payload.iat * 1000;
    // Legacy tokens without authTime fall back to their issue time.
    const authTimeMs = typeof payload.authTime === 'number' ? payload.authTime * 1000 : issuedAtMs;
    if (!isSessionWithinMaxAge(authTimeMs)) return null;

    return { userId: payload.userId, issuedAtMs, authTimeMs };
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

export interface AuthenticatedSession {
  user: User;
  session: VerifiedSession;
  token: string;
  source: 'cookie' | 'bearer';
}

export function getAuthenticatedSession(
  req: Request,
  extraTokens: string[] = []
): AuthenticatedSession | null {
  const candidates: Array<{ token: string; source: 'cookie' | 'bearer' }> = [
    ...extraTokens.filter(Boolean).map((token) => ({ token, source: 'bearer' as const })),
    ...getCookieTokens(req).map((token) => ({ token, source: 'cookie' as const })),
  ];
  const bearer = getBearerToken(req);
  if (bearer) candidates.push({ token: bearer, source: 'bearer' });

  for (const candidate of candidates) {
    const session = verifyToken(candidate.token);
    if (!session) continue;
    const user = findUserById(session.userId);
    if (user) return { user, session, token: candidate.token, source: candidate.source };
  }
  return null;
}

export function getAuthenticatedUser(req: Request, extraTokens: string[] = []): User | null {
  return getAuthenticatedSession(req, extraTokens)?.user ?? null;
}

const lastRenewalByUser = new Map<string, number>();

/** Re-issues the cookie for active sessions while preserving the absolute login time. */
function renewSessionCookie(res: Response, authenticated: AuthenticatedSession): void {
  if (authenticated.source !== 'cookie') return;
  const now = Date.now();
  if (!shouldRenewSession(authenticated.session, now)) return;

  const lastRenewal = lastRenewalByUser.get(authenticated.user.id) ?? 0;
  if (now - lastRenewal < RENEW_THROTTLE_MS) return;
  lastRenewalByUser.set(authenticated.user.id, now);

  setAuthCookie(res, createToken(authenticated.user, authenticated.session.authTimeMs));
}

export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authenticated = getAuthenticatedSession(req);
  if (!authenticated) {
    clearAuthCookie(res);
    res.status(401).json(errorPayload('Unauthorized'));
    return;
  }
  req.user = authenticated.user;
  renewSessionCookie(res, authenticated);
  next();
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user?.isAdmin) {
    res.status(403).json(errorPayload('Forbidden'));
    return;
  }
  next();
}

export function requireApproved(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user?.isApproved && !req.user?.isAdmin) {
    res.status(403).json(errorPayload('Forbidden: Account not approved'));
    return;
  }
  next();
}

/**
 * Validates the optional display context used by an administrator's simulated
 * view. The requester's real account remains the authorization identity; this
 * context only changes how approved, user-specific display data is rendered.
 */
export function resolveViewAsUser(req: AuthRequest, res: Response, next: NextFunction): void {
  const raw = req.headers[VIEW_AS_USER_HEADER];
  if (raw === undefined) {
    next();
    return;
  }

  const targetId = typeof raw === 'string' ? raw.trim() : '';
  if (!req.user?.isAdmin || !targetId) {
    res.status(403).json(errorPayload('Forbidden'));
    return;
  }

  const target = findUserById(targetId);
  if (!target || !target.isApproved) {
    res.status(403).json(errorPayload('Forbidden'));
    return;
  }

  req.viewAsUser = target;
  next();
}

/**
 * Blocks players without an admin-assigned character. Dungeon masters and
 * admins always pass.
 */
export function requireActivePerson(req: AuthRequest, res: Response, next: NextFunction): void {
  const user = req.user;
  if (user && user.role === 'player' && !user.activePerson && !user.isAdmin) {
    res.status(403).json(errorPayload('Forbidden: Kein Charakter zugewiesen'));
    return;
  }
  next();
}
