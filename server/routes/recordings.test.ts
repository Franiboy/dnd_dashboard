import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Language, RecordingSession, SafeUser } from '../../shared/types.js';

const state = vi.hoisted(() => {
  const users: SafeUser[] = [
    {
      id: 'dm',
      username: 'marek',
      displayName: 'Marek',
      avatarUrl: null,
      isAdmin: false,
      isApproved: true,
      role: 'dungeon_master',
      disabledApps: [],
      activePerson: null,
      autoSessionToDiary: false,
      autoAcceptSessionDiary: false,
      themePrimary: null,
      uiLanguage: null,
      isInitialAdmin: false,
    },
  ];
  const session: RecordingSession = {
    id: 1,
    name: 'Test session',
    status: 'completed',
    guildId: 'guild',
    channelId: 'channel',
    createdBy: 'dm',
    startedAt: '2026-01-01T00:00:00.000Z',
    stoppedAt: '2026-01-01T01:00:00.000Z',
    directory: '/tmp/test-recording',
    transcript: '[00:00] Marek: Welcome.',
    error: null,
    trimStartSeconds: null,
    trimEndSeconds: null,
    transcribedTrimStartSeconds: null,
    transcribedTrimEndSeconds: null,
    transcriptImprovedAt: null,
    summary: null,
    summaryGeneratedAt: null,
    longSummary: null,
    longSummaryGeneratedAt: null,
    gameStartSeconds: null,
    gameEndSeconds: null,
    gameBoundaryDetectedAt: null,
    gameDay: 1,
    gameDayEnd: 1,
    arcId: null,
  };

  return {
    user: { id: 'viewer', uiLanguage: null as Language | null },
    session,
    users,
    broadcasts: [] as Array<{ event: string; data: Record<string, unknown> }>,
  };
});

vi.mock('../auth.js', () => ({
  authMiddleware: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = state.user;
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireApproved: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../discord/bot.js', () => ({
  getBotStatus: () => ({ ready: false, enabled: true }),
  getAllVoiceChannels: vi.fn(),
  finishRecording: vi.fn(),
  getActiveRecording: () => null,
  getMonitoredChannel: () => null,
}));

vi.mock('../discord/config.js', () => ({
  isRecordingFeatureEnabled: () => true,
}));

vi.mock('../discord/files.js', () => ({
  deleteSessionAudioFiles: vi.fn(),
}));

vi.mock('../discord/transcriber.js', () => ({
  getTranscriptionProgress: vi.fn(),
  runTranscription: vi.fn(),
}));

vi.mock('../ai/config.js', () => ({
  isAiEnabled: () => true,
}));

vi.mock('../ai/sessionRewrite.js', () => ({
  improveSessionTranscriptWithAi: vi.fn(),
}));

vi.mock('../ai/sessionSummary.js', () => ({
  processSessionSummaryEntities: vi.fn(),
}));

vi.mock('../ai/sessionToDiary.js', () => ({
  generateSessionDiaryDraft: vi.fn(),
}));

vi.mock('../ai/sessionGameDay.js', () => ({
  detectSessionGameDay: vi.fn(),
}));

vi.mock('../repositories/users.js', () => ({
  getAllUsers: () => state.users,
}));

vi.mock('../discord/recordingsEvents.js', () => ({
  emitSessionsUpdated: vi.fn(),
  onProgressUpdated: vi.fn(),
  onSessionsUpdated: vi.fn(),
  onStatusUpdated: vi.fn(),
}));

vi.mock('../repositories/recordings.js', () => ({
  deleteSession: vi.fn(),
  getFilesBySessionId: () => [],
  getRecordingConfig: () => ({ channelId: null }),
  getSessionById: () => state.session,
  getSessionToDiaryTransfer: () => ({
    entryId: 2,
    transferredAt: '2026-01-01T01:00:00.000Z',
    autoAccepted: false,
    isOutdated: false,
  }),
  listAllSessionDiaryEntryLinks: () => [],
  listSessions: () => [],
  listSessionToDiaryTransfers: () => [],
  recordSessionToDiaryTransfer: vi.fn(),
  setRecordingConfig: vi.fn(),
  updateSession: vi.fn(),
}));

vi.mock('../repositories/storyArcs.js', () => ({
  assignSessionToArc: vi.fn(),
}));

vi.mock('../utils/rateLimits.js', () => ({
  aiRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../utils/sse.js', () => ({
  SseBroadcaster: class {
    broadcast(event: string, data: string): void {
      state.broadcasts.push({ event, data: JSON.parse(data) as Record<string, unknown> });
    }

    add(): () => void {
      return () => {};
    }
  },
  writeSse: () => true,
}));

import { errorHandler } from '../errors.js';
import { detectSessionGameDay } from '../ai/sessionGameDay.js';
import { generateSessionDiaryDraft } from '../ai/sessionToDiary.js';
import { processSessionSummaryEntities } from '../ai/sessionSummary.js';
import { improveSessionTranscriptWithAi } from '../ai/sessionRewrite.js';
import recordingsRouter from './recordings.js';

const app = express();
app.use(express.json());
app.use('/api/recordings', recordingsRouter);
app.use(errorHandler);

let server: Server;
let baseUrl: string;

async function request(
  path: string,
  options: { method?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: options.headers,
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

function aiLogs(): Record<string, unknown>[] {
  return state.broadcasts.filter(({ event }) => event === 'aiLog').map(({ data }) => data);
}

beforeAll(async () => {
  server = await new Promise<Server>((resolve) => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  state.user.uiLanguage = null;
  state.broadcasts.length = 0;
  vi.mocked(improveSessionTranscriptWithAi).mockResolvedValue({
    transcript: state.session.transcript,
  });
  vi.mocked(processSessionSummaryEntities).mockResolvedValue({
    summary: 'Short summary',
    longSummary: 'Long summary',
  });
  vi.mocked(generateSessionDiaryDraft).mockResolvedValue({ id: 2 } as never);
  vi.mocked(detectSessionGameDay).mockResolvedValue({ gameDay: 2, gameDayEnd: 3 });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

describe('recording AI progress payloads', () => {
  it('uses an in-progress status while improving a transcript', async () => {
    const response = await request('/api/recordings/1/improve-transcript', { method: 'POST' });
    const logs = aiLogs();

    expect(response.status).toBe(200);
    expect(logs[0]).toMatchObject({
      messageKey: 'errors.status.transcriptImproving',
      errorCode: 'errors.status.transcriptImproving',
      statusCode: 'progress',
    });
    expect(logs[0].messageKey).not.toBe('errors.status.transcriptImproved');
  });

  it('uses structured in-progress payloads for summaries, diary drafts, and game days', async () => {
    const summary = await request('/api/recordings/1/summary', { method: 'POST' });
    expect(summary.status).toBe(200);
    expect(aiLogs()[0]).toMatchObject({
      messageKey: 'errors.status.summaryCreating',
      errorCode: 'errors.status.summaryCreating',
    });

    state.broadcasts.length = 0;
    const diary = await request('/api/recordings/1/diary-draft', { method: 'POST' });
    expect(diary.status).toBe(200);
    expect(aiLogs()[0]).toMatchObject({
      messageKey: 'errors.status.diaryDraftCreating',
      errorCode: 'errors.status.diaryDraftCreating',
    });

    state.broadcasts.length = 0;
    const gameDay = await request('/api/recordings/1/detect-game-day?force=true', {
      method: 'POST',
    });
    expect(gameDay.status).toBe(200);
    expect(aiLogs()[0]).toMatchObject({
      messageKey: 'errors.status.gameDayDetecting',
      errorCode: 'errors.status.gameDayDetecting',
    });
    expect(aiLogs().at(-1)).toMatchObject({
      messageKey: 'errors.status.gameDayDetected',
      params: { start: 2, end: 3 },
    });
  });
});

describe('recording transcript display language', () => {
  it('uses the requesting account language or its Accept-Language fallback', async () => {
    const english = await request('/api/recordings/1', {
      headers: { 'Accept-Language': 'en-US,en;q=0.9' },
    });
    expect((english.body.session as { transcript: string }).transcript).toContain(
      'Dungeon Master (Marek)'
    );

    state.user.uiLanguage = 'de';
    const german = await request('/api/recordings/1', {
      headers: { 'Accept-Language': 'en-US,en;q=0.9' },
    });
    expect((german.body.session as { transcript: string }).transcript).toContain(
      'Spielleiter (Marek)'
    );

    state.user.uiLanguage = null;
    const fallback = await request('/api/recordings/1', {
      headers: { 'Accept-Language': 'fr-FR' },
    });
    expect((fallback.body.session as { transcript: string }).transcript).toContain(
      'Spielleiter (Marek)'
    );
  });

  it('does not pass the request UI language to the diary AI run', async () => {
    state.user.uiLanguage = 'en';
    const response = await request('/api/recordings/1/diary-draft', { method: 'POST' });

    expect(response.status).toBe(200);
    expect(generateSessionDiaryDraft).toHaveBeenCalledWith(
      1,
      state.user,
      undefined,
      expect.any(Function)
    );
  });
});
