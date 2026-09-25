import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecordingSession } from '../../shared/types';
import { createTestUser, renderWithProviders } from '../test-utils';
import { Sessions } from './Recordings';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  updateUser: vi.fn(),
  refresh: vi.fn(),
  showError: vi.fn(),
  showSuccess: vi.fn(),
  storyArc: {
    id: 1,
    name: 'User-authored arc name',
    description: 'User-authored arc description',
    status: 'active',
    chapterNumber: 1234,
    sessionCount: 2,
    diaryEntryCount: 3,
    entityCount: 4,
    gameDayStart: 1234,
    gameDayEnd: 1240,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
}));

const session: RecordingSession = {
  id: 7,
  name: 'User-authored session name',
  status: 'error',
  guildId: 'guild',
  channelId: 'channel',
  createdBy: 'user',
  startedAt: '2026-09-24T12:00:00.000Z',
  transcriptionLanguage: 'de',
  stoppedAt: '2026-09-24T14:00:00.000Z',
  directory: '/tmp/session',
  transcript: null,
  error: 'Transkription fehlgeschlagen: whisper failed',
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
  gameDay: 1234,
  gameDayEnd: 1240,
  arcId: 1,
  hasWavFiles: true,
};

vi.mock('../hooks/useApi', () => ({
  useApi: () => ({ request: mocks.request }),
}));

vi.mock('../hooks/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useAuth')>()),
  useAuth: () => ({ updateUser: mocks.updateUser }),
}));

vi.mock('../hooks/useEntityDialog', () => ({
  useEntityDialog: () => ({ openEntity: vi.fn() }),
}));

vi.mock('../hooks/useEntityMappings', () => ({
  useEntityMappings: () => ({ mappings: [] }),
}));

vi.mock('../hooks/useError', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useError')>()),
  useError: () => ({ showError: mocks.showError, showSuccess: mocks.showSuccess }),
}));

vi.mock('../hooks/useStoryArcs', () => ({
  useStoryArcs: () => ({
    arcs: [mocks.storyArc],
    selectedArcId: null,
    refresh: mocks.refresh,
  }),
}));

class MockEventSource {
  onerror: unknown = null;

  addEventListener(type: string, listener: EventListener): void {
    if (type !== 'sessions') return;
    queueMicrotask(() => {
      (listener as (event: MessageEvent) => void)({
        data: JSON.stringify({ sessions: [session] }),
      } as MessageEvent);
    });
  }

  close(): void {}
}

const user = createTestUser({ isAdmin: true });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('EventSource', MockEventSource);
  mocks.request.mockImplementation(async (path: string) => {
    if (path === '/api/version') {
      return { data: { recordingEnabled: true, aiEnabled: true }, error: null };
    }
    if (path === '/api/campaign/days') {
      return { data: { days: [{ day: 1234 }], currentGameDay: 1234 }, error: null };
    }
    if (path === '/api/recordings/diary-transfers') {
      return { data: { transfers: {} }, error: null };
    }
    if (path === '/api/recordings/session-diary-entries') {
      return { data: { entries: {} }, error: null };
    }
    return { data: {}, error: null };
  });
});

describe('Sessions localization', () => {
  it('localizes settings, technical statuses, admin actions, story-arc counts, and errors in English', async () => {
    renderWithProviders(<Sessions user={user} />, { language: 'en' });

    expect(await screen.findByText('User-authored session name')).toBeDefined();
    const metadata = screen.getByText(/Status: Error/).closest('p');
    expect(metadata?.textContent).toContain('Game day 1,234–1,240');
    expect(screen.getByText('Transcription failed: whisper failed')).toBeDefined();
    expect(screen.queryByText('pending_transcription')).toBeNull();

    fireEvent.click(
      screen.getByRole('button', { name: 'More actions for User-authored session name' })
    );
    expect(screen.getByText('Retry transcription')).toBeDefined();
    expect(screen.getByText('Delete audio files')).toBeDefined();
    expect(screen.getByText('Delete session')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByText('Diary automation')).toBeDefined();
    expect(screen.getByText('Automatically transfer completed sessions to my diary')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Story arcs' }));
    expect(screen.getAllByText('Chapter 1,234 ·').length).toBeGreaterThan(0);
    expect(
      screen.getByText('Game day 1,234–1,240 · 2 sessions · 3 entries · 4 entities')
    ).toBeDefined();
    expect(screen.getByText('User-authored arc description')).toBeDefined();
  });

  it('keeps German UI labels in German', async () => {
    renderWithProviders(<Sessions user={user} />, { language: 'de' });

    expect(await screen.findByText('Einstellungen')).toBeDefined();
    expect(screen.getByText('Story Arcs')).toBeDefined();
    expect(screen.getByText(/Status: Fehler/)).toBeDefined();
    expect(
      screen.getByRole('button', { name: 'Weitere Aktionen für User-authored session name' })
    ).toBeDefined();
  });
});
