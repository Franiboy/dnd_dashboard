import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test-utils';
import { Timeline } from './Timeline';

vi.mock('../hooks/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useAuth')>()),
  useAuth: () => ({ user: { isAdmin: true } }),
}));

vi.mock('../hooks/useError', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useError')>()),
  useError: () => ({ showSuccess: vi.fn() }),
}));

vi.mock('../hooks/useStoryArcs', () => ({
  useStoryArcs: () => ({ arcs: [], selectedArcId: null }),
}));

vi.mock('../hooks/useTimeline', () => ({
  useTimeline: () => ({
    events: [],
    pendingCount: 1234,
    running: false,
    aiEnabled: true,
    loading: false,
    loadTimeline: vi.fn(),
    regenerate: vi.fn().mockResolvedValue(true),
  }),
}));

vi.mock('../hooks/useTimelineAiStatus', () => ({
  useTimelineAiStatus: () => ({
    aiStatus: 'Ereignisse werden extrahiert...',
    setAiStatus: vi.fn(),
    sseReadyRef: { current: Promise.resolve() },
  }),
}));

describe('Timeline', () => {
  it('localizes the empty state, status, drawer, and formatted pending count in English', () => {
    renderWithProviders(<Timeline />, { language: 'en' });

    expect(screen.getByText('No timeline events yet.')).toBeDefined();
    expect(screen.getByText('Extracting events...')).toBeDefined();
    expect(
      screen.getByText(
        'Open “Update” in the side drawer to generate events for the sessions so far.'
      )
    ).toBeDefined();

    fireEvent.click(screen.getByText('Update'));
    expect(screen.getByText('Update timeline')).toBeDefined();
    expect(screen.getByText('1,234 sessions without current events')).toBeDefined();
    expect(screen.queryByText(/Zeitleiste/)).toBeNull();
  });

  it('keeps the German empty state in German', () => {
    renderWithProviders(<Timeline />, { language: 'de' });

    expect(screen.getByText('Noch keine Zeitleisten-Ereignisse vorhanden.')).toBeDefined();
    expect(screen.getByText('Ereignisse werden extrahiert...')).toBeDefined();
  });
});
