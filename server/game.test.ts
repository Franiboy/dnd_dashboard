import { describe, expect, it } from 'vitest';
import {
  addTask,
  finishAndResetGame,
  getGame,
  joinPlayer,
  lockBoard,
  setGridSize,
  startGame,
  syncPlayersFromUsers,
  unlockBoard,
  updateBoard,
} from './game.js';
import { createAdminUser, setUserRole } from './users.js';
import type { Cell } from '../shared/types.js';

function fullBoard(taskIds: string[], size = 3): Cell[][] {
  const board: Cell[][] = [];
  let i = 0;
  for (let r = 0; r < size; r++) {
    const row: Cell[] = [];
    for (let c = 0; c < size; c++) {
      row.push({ taskId: taskIds[i++] ?? null, confirmedBy: null });
    }
    board.push(row);
  }
  return board;
}

describe('bingo game with roles', () => {
  it('adds players and dungeon masters permanently to the player list', () => {
    const dm = setUserRole(createAdminUser('dm-user', 'DM User', 'password').id, 'dungeon_master')!;
    const player = setUserRole(createAdminUser('pl-user', 'PL User', 'password').id, 'player')!;
    createAdminUser('guest-user', 'Guest User', 'password');

    syncPlayersFromUsers();

    const players = getGame().players;
    const dmEntry = players.find((p) => p.userId === dm.id);
    const playerEntry = players.find((p) => p.userId === player.id);
    expect(dmEntry?.role).toBe('dungeon_master');
    expect(playerEntry?.role).toBe('player');
    // Permanent participants are listed before checking in.
    expect(dmEntry?.online).toBe(false);
    expect(playerEntry?.online).toBe(false);
    // Guests do not appear until they actively join.
    expect(players.find((p) => p.name === 'Guest User')).toBeUndefined();
  });

  it('starts the game at any time without checked-in or locked players', () => {
    finishAndResetGame();
    setGridSize(3);
    const needed = 9;
    for (let i = 0; i < needed - 1; i += 1) {
      addTask(`Setup task ${i}`);
    }
    expect(() => startGame()).toThrow('Mindestens 9 Aufgaben nötig.');

    addTask('Setup task 9');
    const started = startGame();
    expect(started.status).toBe('playing');
    // Nobody locked a board, so everyone starts in the lobby.
    expect(started.players.every((p) => p.status === 'lobby')).toBe(true);
  });

  it('lets unchecked-in players join a running game and lock their board', () => {
    expect(getGame().status).toBe('playing');

    const { playerId } = joinPlayer('Late Joiner');
    const taskIds = getGame().tasks.map((t) => t.id);

    // Board editing is allowed during the running game until locked.
    updateBoard(playerId, fullBoard(taskIds));
    lockBoard(playerId);
    expect(getGame().players.find((p) => p.id === playerId)?.status).toBe('playing');

    // Locked boards cannot be retro-edited during a running game.
    expect(() => unlockBoard(playerId)).toThrow('nur vor Spielstart');
  });

  it('resets the round back to setup and keeps role-based participants', () => {
    const finished = finishAndResetGame();
    expect(finished.status).toBe('setup');
    expect(finished.players.find((p) => p.name === 'DM User')).toBeTruthy();
    expect(finished.players.find((p) => p.name === 'PL User')?.board).not.toBeNull();
  });
});
