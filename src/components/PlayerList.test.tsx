import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { BingoGame } from '../../shared/types';
import { createTestUser, renderWithProviders } from '../test-utils';
import { PlayerList } from './PlayerList';

const user = createTestUser();

const game: BingoGame = {
  id: 'game-1',
  status: 'playing',
  tasks: [],
  gridSize: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
  finishedAt: null,
  players: [
    {
      id: 'player-1',
      userId: user.id,
      name: 'Riven',
      role: 'player',
      status: 'playing',
      board: null,
      locked: true,
      online: true,
      joinedAt: '2026-01-01T00:00:00.000Z',
      wins: 1234,
    },
  ],
};

describe('PlayerList localization', () => {
  it.each([
    ['de', '1.234 Siege', 'Spielt'],
    ['en', '1,234 wins', 'Playing'],
  ] as const)('translates status and win labels for %s', (language, wins, status) => {
    renderWithProviders(<PlayerList game={game} playerId="player-1" />, { user, language });

    expect(screen.getByTitle(wins)).not.toBeNull();
    expect(screen.getByText(status)).not.toBeNull();
    expect(screen.getByText(/Riven/)).not.toBeNull();
  });
});
