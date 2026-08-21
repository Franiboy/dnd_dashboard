import { describe, expect, it } from 'vitest';
import type { SafeUser, VersionInfo } from '../../shared/types';
import { APPS, getAppByPath, isAppVisible } from './apps';

function makeUser(overrides: Partial<SafeUser> = {}): SafeUser {
  return {
    id: 'user-1',
    username: 'player',
    displayName: 'Player',
    avatarUrl: null,
    isAdmin: false,
    isApproved: true,
    role: 'player',
    disabledApps: [],
    activePerson: null,
    autoSessionToDiary: false,
    autoAcceptSessionDiary: false,
    isInitialAdmin: false,
    ...overrides,
  };
}

const VERSION: VersionInfo = { aiEnabled: false, recordingEnabled: false };

describe('isAppVisible', () => {
  it('gives admins unrestricted access to every app', () => {
    const admin = makeUser({ isAdmin: true });
    for (const app of APPS) {
      expect(isAppVisible(app, admin, VERSION)).toBe(true);
    }
  });

  it('ignores per-user disabled apps for admins', () => {
    const admin = makeUser({ isAdmin: true, disabledApps: ['bingo', 'whiteboard'] });
    const bingo = getAppByPath('/bingo')!;
    expect(isAppVisible(bingo, admin, VERSION)).toBe(true);
  });

  it('hides disabled apps for regular users', () => {
    const user = makeUser({ disabledApps: ['notes'] });
    const notes = getAppByPath('/tagebuch')!;
    expect(isAppVisible(notes, user, VERSION)).toBe(false);
  });

  it('keeps admin-only apps hidden for regular users', () => {
    const user = makeUser();
    const admin = getAppByPath('/admin')!;
    expect(isAppVisible(admin, user, VERSION)).toBe(false);
    expect(isAppVisible(admin, makeUser({ isAdmin: true }), VERSION)).toBe(true);
  });

  it('respects the recording feature flag for regular users but not for admins', () => {
    const sessions = getAppByPath('/sessions')!;
    expect(isAppVisible(sessions, makeUser(), VERSION)).toBe(false);
    expect(isAppVisible(sessions, makeUser(), { ...VERSION, recordingEnabled: true })).toBe(true);
    expect(isAppVisible(sessions, makeUser({ isAdmin: true }), VERSION)).toBe(true);
  });
});
