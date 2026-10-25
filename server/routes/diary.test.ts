import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiaryEntry } from '../../shared/types.js';

const state = vi.hoisted(() => ({
  user: { id: 'user-1', activePerson: 'Ruvan' },
  entryContent: '',
}));

vi.mock('../auth.js', () => ({
  authMiddleware: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = state.user;
    next();
  },
  requireApproved: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireActivePerson: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireUser: () => state.user,
}));

vi.mock('../ai/config.js', () => ({
  isAiEnabled: () => true,
}));

vi.mock('../utils/rateLimits.js', () => ({
  aiRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../diaryAiEvents.js', () => ({
  getUserBroadcaster: () => ({ add: () => () => {} }),
  notifyDiaryAiLog: vi.fn(),
  releaseUserBroadcaster: vi.fn(),
  sendDiaryAiStatus: vi.fn(),
  startProgressMessages: () => () => {},
}));

vi.mock('../ai/rewrite.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ai/rewrite.js')>();
  return {
    ...actual,
    processDiaryEntryAi: vi.fn(),
  };
});

vi.mock('../repositories/diary.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../repositories/diary.js')>();
  return {
    ...actual,
    getDiaryEntryById: (id: number) =>
      ({
        id,
        userId: 'user-1',
        content: state.entryContent,
      }) as DiaryEntry,
  };
});

import diaryRouter from './diary.js';
import { errorHandler } from '../errors.js';
import { processDiaryEntryAi } from '../ai/rewrite.js';

const app = express();
app.use(express.json());
app.use('/api/diary', diaryRouter);
app.use(errorHandler);

let server: Server;
let baseUrl: string;

async function postSummarize(id: number): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}/api/diary/entries/${id}/summarize`, {
    method: 'POST',
  });
  return { status: response.status, body: (await response.json()) as any };
}

beforeAll(async () => {
  server = await new Promise<Server>((resolve) => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

describe('POST /api/diary/entries/:id/summarize', () => {
  it('rejects empty entry content with 400 instead of 500', async () => {
    state.entryContent = '';

    const result = await postSummarize(69);

    expect(result.status).toBe(400);
    expect(result.body.messageKey).toBe('errors.validation.contentRequired');
    expect(processDiaryEntryAi).not.toHaveBeenCalled();
  });

  it('rejects whitespace-only HTML content with 400', async () => {
    state.entryContent = '<p>   </p><p><br></p>';

    const result = await postSummarize(69);

    expect(result.status).toBe(400);
    expect(result.body.messageKey).toBe('errors.validation.contentRequired');
    expect(processDiaryEntryAi).not.toHaveBeenCalled();
  });

  it('processes entries with real text content', async () => {
    state.entryContent = '<p>Der Kampf mit dem Drachen bei Goldenfields.</p>';
    vi.mocked(processDiaryEntryAi).mockResolvedValue(true);

    const result = await postSummarize(69);

    expect(result.status).toBe(200);
    expect(processDiaryEntryAi).toHaveBeenCalledTimes(1);
  });
});
