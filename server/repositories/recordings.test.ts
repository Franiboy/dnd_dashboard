import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../database.js';
import { setAiLanguageSettings } from './aiSettings.js';
import {
  createSession,
  deleteSession,
  getSessionById,
  listSessions,
  updateSession,
} from './recordings.js';

const createdSessionIds: number[] = [];

function createTestSession() {
  const session = createSession({
    name: 'Language persistence test',
    guildId: 'guild',
    channelId: 'channel',
    createdBy: 'tester',
    directory: '/tmp/language-test',
  });
  createdSessionIds.push(session.id);
  return session;
}

beforeEach(() => {
  setAiLanguageSettings('de');
});

afterEach(() => {
  for (const id of createdSessionIds.splice(0)) deleteSession(id);
});

describe('recording session transcription language', () => {
  it('captures the configured language when a session is created', () => {
    setAiLanguageSettings('en');

    const session = createTestSession();

    expect(session.transcriptionLanguage).toBe('en');
    expect(getSessionById(session.id)?.transcriptionLanguage).toBe('en');
    expect(listSessions().find((item) => item.id === session.id)?.transcriptionLanguage).toBe('en');
  });

  it('can backfill a legacy session without changing an existing capture', () => {
    const session = createTestSession();
    db.prepare('UPDATE recording_sessions SET transcription_language = NULL WHERE id = ?').run(
      session.id
    );

    updateSession(session.id, { transcriptionLanguage: 'en' });
    expect(getSessionById(session.id)?.transcriptionLanguage).toBe('en');

    updateSession(session.id, { transcriptionLanguage: 'de' });
    expect(getSessionById(session.id)?.transcriptionLanguage).toBe('de');
  });
});
