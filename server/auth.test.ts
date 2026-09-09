import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { createToken, getSessionPublicKey, verifyToken } from './auth.js';

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
