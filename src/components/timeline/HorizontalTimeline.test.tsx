import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { StoryArc, TimelineEvent } from '../../../shared/types';
import { renderWithProviders } from '../../test-utils';
import { HorizontalTimeline } from './HorizontalTimeline';

vi.mock('../../hooks/useEntityMappings', () => ({
  useEntityMappings: () => ({ mappings: [] }),
}));

const event: TimelineEvent = {
  id: 1,
  gameDay: 12,
  arcId: 1,
  sessionId: 7,
  sessionName: 'User-authored session name',
  title: 'AI-generated event title',
  description: '<p>AI-generated description</p>',
  generatedAt: '2026-09-24T12:00:00.000Z',
  updatedAt: '2026-09-24T12:00:00.000Z',
  scenes: [],
  diaryLinks: [{ entryId: 3, title: 'User-authored diary title', displayName: 'Example User' }],
};

const arc: StoryArc = {
  id: 1,
  name: 'User-authored arc name',
  description: null,
  status: 'active',
  chapterNumber: 1234,
  sessionCount: 2,
  diaryEntryCount: 3,
  entityCount: 4,
  gameDayStart: 2,
  gameDayEnd: 8,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('HorizontalTimeline', () => {
  it('localizes controls and numbers in English without changing generated or user content', () => {
    renderWithProviders(<HorizontalTimeline events={[event]} arcs={[arc]} />, {
      language: 'en',
    });

    expect(screen.getByText('Mouse wheel / swipe')).toBeDefined();
    expect(screen.getByText('Ctrl+mouse wheel / two fingers')).toBeDefined();
    expect(screen.getByText('Click')).toBeDefined();
    expect(screen.getAllByText('Session').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Diary').length).toBeGreaterThan(0);
    expect(screen.getByText('Chapter 1,234')).toBeDefined();
    expect(screen.getByText('Game day 2–8')).toBeDefined();
    expect(screen.getAllByText('Game day 12 · current').length).toBeGreaterThan(0);
    expect(screen.getByText('No sub-events recorded.')).toBeDefined();

    expect(screen.getAllByText('AI-generated event title').length).toBeGreaterThan(0);
    expect(screen.queryByText('User-authored session name')).toBeNull();
    expect(screen.getByTitle('Diary by Example User')).toBeDefined();
  });

  it('renders German navigation hints by default', () => {
    renderWithProviders(<HorizontalTimeline events={[event]} arcs={[arc]} />, {
      language: 'de',
    });

    expect(screen.getByText('Mausrad / Wischen')).toBeDefined();
    expect(screen.getByTitle('Klicken für Details')).toBeDefined();
    expect(screen.getByText('Kapitel 1.234')).toBeDefined();
  });
});
