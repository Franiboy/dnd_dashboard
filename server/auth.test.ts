import { describe, expect, it } from 'vitest';
import { createToken, verifyToken } from './auth.js';

describe('auth tokens', () => {
  it('creates a token that can be verified', () => {
    const user = {
      id: 'user-123',
      username: 'testuser',
      displayName: 'Test User',
      passwordHash: null,
      discordId: null,
      avatarUrl: null,
      isAdmin: false,
      isApproved: true,
      disabledApps: [],
      activePerson: null,
      autoSessionToDiary: false,
      autoAcceptSessionDiary: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: new Date().toISOString(),
    };

    const token = createToken(user);
    const decoded = verifyToken(token);
    expect(decoded).toBeTruthy();
    expect(decoded!.userId).toBe(user.id);
  });

  it('returns null for an invalid token', () => {
    expect(verifyToken('invalid-token')).toBeNull();
  });

  it('returns null for a tampered token', () => {
    const user = {
      id: 'user-456',
      username: 'hacker',
      displayName: 'Hacker',
      passwordHash: null,
      discordId: null,
      avatarUrl: null,
      isAdmin: false,
      isApproved: true,
      disabledApps: [],
      activePerson: null,
      autoSessionToDiary: false,
      autoAcceptSessionDiary: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: new Date().toISOString(),
    };

    const token = createToken(user);
    const tampered = token.slice(0, -3) + 'xxx';
    expect(verifyToken(tampered)).toBeNull();
  });
});
