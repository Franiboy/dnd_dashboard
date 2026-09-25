import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntitySearchHit } from '../hooks/useGlobalSearch';
import type { SafeUser, SearchResult, VersionInfo } from '../../shared/types';
import { createTestUser, renderWithProviders } from '../test-utils/renderWithProviders';
import { GlobalSearch } from './GlobalSearch';

const searchState = vi.hoisted(() => ({
  entityHits: [] as EntitySearchHit[],
  results: [] as SearchResult[],
  loading: false,
}));
const openEntity = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useGlobalSearch', () => ({
  useGlobalSearch: vi.fn(() => searchState),
}));
vi.mock('../hooks/useEntityDialog', () => ({
  useEntityDialog: () => ({ openEntity }),
}));

const user: SafeUser = createTestUser({
  activePerson: 'Vimak',
  role: 'dungeon_master',
});
const version: VersionInfo = { aiEnabled: true, recordingEnabled: true };

const entityHit: EntitySearchHit = {
  source: 'entity',
  type: 'persons',
  name: 'Ada',
  qualifier: '',
  label: 'Ada',
  matchOn: 'alias',
};

const results: SearchResult[] = [
  {
    source: 'knowledge',
    id: 1,
    title: 'A fact',
    snippet: 'A fact about Ada',
    entityType: 'persons',
    entityName: 'Ada',
    entityQualifier: '',
    validFrom: null,
    validUntil: null,
  },
  {
    source: 'diary',
    id: 2,
    title: 'A diary entry',
    snippet: 'An entry',
    createdAt: '2026-01-02T12:00:00.000Z',
    gameDay: 4,
    arcId: null,
  },
  {
    source: 'session',
    id: 3,
    title: 'A session',
    snippet: 'A transcript',
    startedAt: '2026-01-03T12:00:00.000Z',
    gameDay: 5,
    arcId: null,
    transcriptTime: null,
  },
  {
    source: 'timeline',
    id: 4,
    title: 'A timeline event',
    snippet: 'An event',
    gameDay: 6,
    arcId: null,
    sessionId: 3,
    sessionName: 'A session',
  },
];

describe('GlobalSearch', () => {
  beforeEach(() => {
    searchState.entityHits = [];
    searchState.results = [];
    searchState.loading = false;
    openEntity.mockReset();
  });

  it('localizes the trigger, groups, hints, and metadata in English', () => {
    searchState.entityHits = [entityHit];
    searchState.results = results;
    renderWithProviders(<GlobalSearch user={user} version={version} />, {
      user,
      language: 'en',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Global search (Ctrl+K)' }));
    expect(screen.getByRole('dialog', { name: 'Global search' })).toBeDefined();
    expect(
      screen.getByPlaceholderText('Search diaries, sessions, timeline, and the world…')
    ).toBeDefined();
    expect(screen.getByText('matched via Alias')).toBeDefined();
    expect(screen.getByText('Knowledge')).toBeDefined();
    expect(screen.getAllByText('Diary')).toHaveLength(2);
    expect(screen.getAllByText('Sessions')).toHaveLength(2);
    expect(screen.getAllByText('Timeline')).toHaveLength(2);
    expect(screen.getByText(/Created on/)).toBeDefined();
    expect(screen.getByText(/Started on/)).toBeDefined();
    expect(screen.getByText('A diary entry')).toBeDefined();
    expect(screen.getByText('An entry')).toBeDefined();
  });

  it('shows localized guidance and no-result text in German', () => {
    renderWithProviders(<GlobalSearch user={user} version={version} />, {
      user,
      language: 'de',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Globale Suche (Ctrl+K)' }));
    expect(screen.getByText(/Tippe mindestens zwei Zeichen/)).toBeDefined();
    expect(
      screen.getByPlaceholderText('Tagebücher, Sessions, Zeitleiste und Welt durchsuchen…')
    ).toBeDefined();
  });
});
