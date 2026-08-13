import { describe, expect, it } from 'vitest';
import { loadGame, saveGame } from './games.js';
import type { BingoGame } from '../../shared/types.js';

describe('games repository', () => {
  it('returns null when no game exists', () => {
    expect(loadGame()).toBeNull();
  });

  it('saves and loads a game', () => {
    const game: BingoGame = {
      id: 'game-1',
      status: 'setup',
      tasks: [{ id: 'task-1', text: 'Kill a dragon', createdAt: '2026-01-01T00:00:00.000Z' }],
      players: [],
      gridSize: 5,
      createdAt: '2026-01-01T00:00:00.000Z',
      finishedAt: null,
    };

    saveGame(game);
    const loaded = loadGame()!;
    expect(loaded.id).toBe(game.id);
    expect(loaded.tasks).toHaveLength(1);
    expect(loaded.tasks[0].text).toBe('Kill a dragon');
  });

  it('overwrites an existing game', () => {
    const game1: BingoGame = {
      id: 'game-1',
      status: 'setup',
      tasks: [],
      players: [],
      gridSize: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
      finishedAt: null,
    };

    saveGame(game1);

    const game2: BingoGame = {
      ...game1,
      gridSize: 5,
      tasks: [{ id: 'task-2', text: 'Find treasure', createdAt: '2026-01-02T00:00:00.000Z' }],
    };

    saveGame(game2);
    const loaded = loadGame()!;
    expect(loaded.gridSize).toBe(5);
    expect(loaded.tasks).toHaveLength(1);
  });
});
