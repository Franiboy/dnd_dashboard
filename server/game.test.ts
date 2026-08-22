import { describe, expect, it } from 'vitest';
import {
  addTask,
  confirmTask,
  finishAndResetGame,
  getGame,
  joinPlayer,
  lockBoard,
  removeTask,
  setGridSize,
  startGame,
  syncPlayersFromUsers,
  unconfirmTask,
  unlockBoard,
  updateBoard,
  updateTask,
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

  it('locks task management while the round is running', () => {
    expect(getGame().status).toBe('playing');
    const someTaskId = getGame().tasks[0].id;

    expect(() => addTask('Mid-game task')).toThrow('nur vor Spielstart');
    expect(() => removeTask(someTaskId)).toThrow('nur vor Spielstart');
    expect(() => updateTask(someTaskId, { text: 'Geändert' })).toThrow('nur vor Spielstart');

    // Ending the round unlocks task management again.
    finishAndResetGame();
    const task = addTask('Post-reset task');
    expect(getGame().tasks.some((t) => t.id === task.id)).toBe(true);
  });

  it('rejects joins from users who are not players or dungeon masters', () => {
    expect(() => joinPlayer('Spectator', undefined, null, 'guest')).toThrow(
      'Nur Spieler und Dungeon Master'
    );
    expect(() => joinPlayer('Roleless', undefined, null, undefined)).toThrow(
      'Nur Spieler und Dungeon Master'
    );
    expect(getGame().players.find((p) => p.name === 'Spectator')).toBeUndefined();
  });

  it('lets unchecked-in players join a running game and lock their board', () => {
    startGame();
    expect(getGame().status).toBe('playing');

    const { playerId } = joinPlayer('Late Joiner', undefined, null, 'player');
    const taskIds = getGame().tasks.map((t) => t.id);

    // Board editing is allowed during the running game until locked.
    updateBoard(playerId, fullBoard(taskIds));
    lockBoard(playerId);
    expect(getGame().players.find((p) => p.id === playerId)?.status).toBe('playing');

    // Locked boards cannot be retro-edited during a running game.
    expect(() => unlockBoard(playerId)).toThrow('nur vor Spielstart');
  });

  it('counts at most one win per player per round across unconfirms and multiple lines', () => {
    const playerId = getGame().players.find((p) => p.name === 'Late Joiner')!.id;
    const taskIds = getGame().tasks.map((t) => t.id);

    // Complete the first row: bingo, exactly one win.
    for (let c = 0; c < 3; c += 1) {
      confirmTask(playerId, taskIds[c]);
    }
    let player = getGame().players.find((p) => p.id === playerId)!;
    expect(player.status).toBe('bingo');
    expect(player.wins).toBe(1);
    expect(player.winCounted).toBe(true);

    // Unconfirming drops the bingo state but never takes the win away ...
    unconfirmTask(taskIds[0]);
    player = getGame().players.find((p) => p.id === playerId)!;
    expect(player.status).toBe('playing');
    expect(player.wins).toBe(1);

    // ... and re-confirming must not inflate the tally.
    confirmTask(playerId, taskIds[0]);
    player = getGame().players.find((p) => p.id === playerId)!;
    expect(player.status).toBe('bingo');
    expect(player.wins).toBe(1);

    // Completing additional lines in the same round counts once.
    for (let c = 3; c < 6; c += 1) {
      confirmTask(playerId, taskIds[c]);
    }
    unconfirmTask(taskIds[3]);
    confirmTask(playerId, taskIds[3]);
    player = getGame().players.find((p) => p.id === playerId)!;
    expect(player.wins).toBe(1);

    // A new round resets win counting.
    finishAndResetGame();
    startGame();
    updateBoard(playerId, fullBoard(getGame().tasks.map((t) => t.id)));
    lockBoard(playerId);
    for (let c = 0; c < 3; c += 1) {
      confirmTask(playerId, getGame().tasks[c].id);
    }
    player = getGame().players.find((p) => p.id === playerId)!;
    expect(player.status).toBe('bingo');
    expect(player.wins).toBe(2);
  });

  it('resets the round back to setup and keeps role-based participants', () => {
    const finished = finishAndResetGame();
    expect(finished.status).toBe('setup');
    expect(finished.players.find((p) => p.name === 'DM User')).toBeTruthy();
    expect(finished.players.find((p) => p.name === 'PL User')?.board).not.toBeNull();
  });
});
