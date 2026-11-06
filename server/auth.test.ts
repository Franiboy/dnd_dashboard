import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import jwt from 'jsonwebtoken';
import {
  authMiddleware,
  createToken,
  getSessionPublicKey,
  isSessionWithinMaxAge,
  requireActivePerson,
  resolveViewAsUser,
  SESSION_RENEW_AFTER_MS,
  shouldRenewSession,
  verifyToken,
} from './auth.js';
import type { AuthRequest } from './auth.js';
import type { User } from '../shared/types.js';
import { db } from './database.js';

function mockRes(): Response {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
}

const baseUser = {
  id: 'user-123',
  username: 'testuser',
  displayName: 'Test User',
  passwordHash: null,
  discordId: null,
  avatarUrl: null,
  isAdmin: false,
  isApproved: true,
  role: 'guest' as const,
  disabledApps: [],
  activePerson: null,
  autoSessionToDiary: false,
  autoAcceptSessionDiary: false,
  themePrimary: null,
  uiLanguage: null,
  failedLoginAttempts: 0,
  lockedUntil: null,
  createdAt: new Date().toISOString(),
};

describe('auth tokens', () => {
  it('creates a token that can be verified', () => {
    const user = { ...baseUser };

    const token = createToken(user);
    const decoded = verifyToken(token);
    expect(decoded).toBeTruthy();
    expect(decoded!.userId).toBe(user.id);
  });

  it('returns null for an invalid token', () => {
    expect(verifyToken('invalid-token')).toBeNull();
  });

  it('returns null for a tampered token', () => {
    const user = { ...baseUser, id: 'user-456', username: 'hacker', displayName: 'Hacker' };

    const token = createToken(user);
    const tampered = token.slice(0, -3) + 'xxx';
    expect(verifyToken(tampered)).toBeNull();
  });

  it('rejects HS256 algorithm-confusion tokens', () => {
    // Classic RS256 confusion attack: an HS256 token signed with the public
    // key as the HMAC secret must not verify.
    const confusionOptions: jwt.SignOptions = { algorithm: 'HS256' };
    const confused = jwt.sign({ userId: baseUser.id }, getSessionPublicKey(), confusionOptions);
    expect(verifyToken(confused)).toBeNull();
  });
});

afterEach(() => {
  db.prepare("DELETE FROM users WHERE id IN ('view-as-target', 'view-as-unapproved')").run();
});

describe('resolveViewAsUser', () => {
  function insertTarget(id: string, approved: boolean): void {
    db.prepare(
      'INSERT INTO users (id, username, display_name, is_approved, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, id, id, approved ? 1 : 0, new Date().toISOString());
  }

  it('accepts an approved target only for an admin requester', () => {
    insertTarget('view-as-target', true);
    const req = {
      user: { ...baseUser, id: 'admin', isAdmin: true },
      headers: { 'x-dnd-view-as-user': 'view-as-target' },
    } as unknown as AuthRequest;
    const next = vi.fn();

    resolveViewAsUser(req, mockRes(), next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.viewAsUser?.id).toBe('view-as-target');
  });

  it('rejects non-admin requesters and unapproved targets', () => {
    insertTarget('view-as-unapproved', false);
    const res = mockRes();
    const next = vi.fn();

    resolveViewAsUser(
      {
        user: { ...baseUser, id: 'regular' },
        headers: { 'x-dnd-view-as-user': 'view-as-unapproved' },
      } as unknown as AuthRequest,
      res,
      next
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireActivePerson', () => {
  function authed(user: User): AuthRequest {
    return { user } as AuthRequest;
  }

  it('blocks players without an assigned character', () => {
    const res = mockRes();
    const next = vi.fn();
    requireActivePerson(authed({ ...baseUser, role: 'player' }), res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('lets players with an assigned character pass', () => {
    const res = mockRes();
    const next = vi.fn();
    requireActivePerson(authed({ ...baseUser, role: 'player', activePerson: 'Ruvan' }), res, next);
    expect(next).toHaveBeenCalled();
  });

  it('exempts dungeon masters and admins', () => {
    const res = mockRes();
    const next = vi.fn();
    requireActivePerson(authed({ ...baseUser, role: 'dungeon_master' }), res, next);
    requireActivePerson(authed({ ...baseUser, role: 'player', isAdmin: true }), res, next);
    expect(next).toHaveBeenCalledTimes(2);
  });
});

describe('sliding sessions', () => {
  const LOGIN_TIME = Date.parse('2026-01-01T00:00:00Z');
  const DAY = 24 * 60 * 60 * 1000;

  function insertSessionUser(id: string): void {
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, display_name, is_approved, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, id, id, 1, new Date().toISOString());
  }

  function mockCookieRes(): Response & { cookie: ReturnType<typeof vi.fn> } {
    return {
      req: { hostname: 'localhost', secure: false },
      cookie: vi.fn(),
      clearCookie: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response & { cookie: ReturnType<typeof vi.fn> };
  }

  afterEach(() => {
    vi.useRealTimers();
    db.prepare("DELETE FROM users WHERE id LIKE 'session-renew-%'").run();
  });

  it('renews an aged cookie and keeps the original login time', async () => {
    insertSessionUser('session-renew-active');
    vi.useFakeTimers();
    vi.setSystemTime(LOGIN_TIME);
    const token = createToken({ ...baseUser, id: 'session-renew-active' });
    vi.setSystemTime(LOGIN_TIME + 2 * DAY);

    const req = { cookies: { dnd_token: token }, headers: {} } as unknown as AuthRequest;
    const res = mockCookieRes();
    const next = vi.fn();
    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.cookie).toHaveBeenCalledOnce();
    const renewed = verifyToken(res.cookie.mock.calls[0][1] as string);
    expect(renewed?.authTimeMs).toBe(LOGIN_TIME);
    expect(renewed?.issuedAtMs).toBe(LOGIN_TIME + 2 * DAY);
  });

  it('does not renew a fresh cookie', async () => {
    insertSessionUser('session-renew-fresh');
    vi.useFakeTimers();
    vi.setSystemTime(LOGIN_TIME);
    const token = createToken({ ...baseUser, id: 'session-renew-fresh' });
    vi.setSystemTime(LOGIN_TIME + 60 * 60 * 1000);

    const req = { cookies: { dnd_token: token }, headers: {} } as unknown as AuthRequest;
    const res = mockCookieRes();
    const next = vi.fn();
    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('rejects and clears a session beyond the absolute cap', async () => {
    insertSessionUser('session-renew-expired');
    vi.useFakeTimers();
    vi.setSystemTime(LOGIN_TIME);
    const token = createToken({ ...baseUser, id: 'session-renew-expired' });
    vi.setSystemTime(LOGIN_TIME + 91 * DAY);

    const req = { cookies: { dnd_token: token }, headers: {} } as unknown as AuthRequest;
    const res = mockCookieRes();
    const next = vi.fn();
    await authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.clearCookie).toHaveBeenCalled();
  });

  it('exposes the renewal and absolute-cap boundaries', () => {
    expect(shouldRenewSession({ issuedAtMs: LOGIN_TIME }, LOGIN_TIME + 1000)).toBe(false);
    expect(
      shouldRenewSession({ issuedAtMs: LOGIN_TIME }, LOGIN_TIME + SESSION_RENEW_AFTER_MS)
    ).toBe(true);

    const login = Date.parse('2026-01-01T00:00:00Z');
    expect(isSessionWithinMaxAge(login, Date.parse('2026-03-01T00:00:00Z'))).toBe(true);
    expect(isSessionWithinMaxAge(login, Date.parse('2026-04-02T00:00:00Z'))).toBe(false);
  });
});
