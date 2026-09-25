import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BingoGame } from '../../shared/types';
import { useSocket } from '../hooks/useSocket';
import { createTestUser, renderWithProviders } from '../test-utils';
import { Bingo } from './Bingo';

vi.mock('../hooks/useSocket', () => ({
  useSocket: vi.fn(),
}));

const user = createTestUser({ displayName: 'Test Player' });

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
      name: 'Alex',
      role: 'player',
      status: 'bingo',
      board: null,
      locked: false,
      online: true,
      joinedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
};

beforeEach(() => {
  vi.mocked(useSocket).mockReturnValue({
    game,
    socket: null,
    playerId: null,
    bingo: null,
  });
});

describe('Bingo page localization', () => {
  it.each([
    ['de', 'Alex hat BINGO!', 'Trete dem Spiel bei...'],
    ['en', 'Alex has BINGO!', 'Joining the game...'],
  ] as const)('renders the %s board state and join message', (language, announcement, joining) => {
    renderWithProviders(<Bingo user={user} />, { user, language });

    expect(screen.getByText(announcement)).not.toBeNull();
    expect(screen.getByText(joining)).not.toBeNull();
  });
});
