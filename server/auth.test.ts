import { describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import jwt from 'jsonwebtoken';
import { createToken, getSessionPublicKey, requireActivePerson, verifyToken } from './auth.js';
import type { AuthRequest } from './auth.js';
import type { User } from '../shared/types.js';

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

describe('requireActivePerson', () => {
  function authed(user: User): AuthRequest {
    return { user } as AuthRequest;
  }

  function mockRes(): Response {
    return { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
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
    requireActivePerson(authed({ ...baseUser, role: 'player', activePerson: 'Vimak' }), res, next);
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
