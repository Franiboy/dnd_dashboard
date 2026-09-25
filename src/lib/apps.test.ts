import { describe, expect, it } from 'vitest';
import type { SafeUser, VersionInfo } from '../../shared/types';
import { createTranslator } from '../i18n';
import {
  APPS,
  getAppByPath,
  getAppDescription,
  getAppLabel,
  getAppUiText,
  isAppVisible,
} from './apps';

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
    themePrimary: null,
    uiLanguage: null,
    isInitialAdmin: false,
    ...overrides,
  };
}

const VERSION: VersionInfo = { aiEnabled: false, recordingEnabled: false };

describe('localized app metadata', () => {
  it('keeps stable ids and paths while translating user-facing names', () => {
    const notes = getAppByPath('/tagebuch')!;
    expect(notes.id).toBe('notes');
    expect(getAppLabel(notes, createTranslator('de'))).toBe('Tagebuch');
    expect(getAppLabel(notes, createTranslator('en'))).toBe('Diary');
    expect(getAppDescription(notes, createTranslator('en'))).toContain('personal diary');
  });

  it('returns a complete translated UI text bundle for cards and menus', () => {
    const bingo = getAppByPath('/bingo')!;
    expect(getAppUiText(bingo, createTranslator('en'))).toEqual({
      label: 'Bingo',
      description: 'Collect tasks, start a bingo round, and play against each other.',
    });
  });
});

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

  it('hides the diary for players without an assigned character', () => {
    const notes = getAppByPath('/tagebuch')!;
    expect(isAppVisible(notes, makeUser({ activePerson: null }), VERSION)).toBe(false);
  });

  it('shows the diary for players with an assigned character', () => {
    const notes = getAppByPath('/tagebuch')!;
    expect(isAppVisible(notes, makeUser({ activePerson: 'Vimak' }), VERSION)).toBe(true);
  });

  it('exempts dungeon masters and admins from the character requirement', () => {
    const notes = getAppByPath('/tagebuch')!;
    expect(isAppVisible(notes, makeUser({ role: 'dungeon_master' }), VERSION)).toBe(true);
    expect(isAppVisible(notes, makeUser({ isAdmin: true }), VERSION)).toBe(true);
  });

  it('does not require a character for apps without the flag', () => {
    const bingo = getAppByPath('/bingo')!;
    expect(isAppVisible(bingo, makeUser({ activePerson: null }), VERSION)).toBe(true);
  });
});
