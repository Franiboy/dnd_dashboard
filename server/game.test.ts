import { describe, expect, it } from 'vitest';
import {
  addTask,
  confirmOwnTask,
  confirmTask,
  finishAndResetGame,
  getGame,
  joinPlayer,
  lockBoard,
  removeTask,
  setGridSize,
  startGame,
  syncPlayersFromUsers,
  unconfirmOwnTask,
  unconfirmTask,
  unlockBoard,
  updateBoard,
  updateTask,
} from './game.js';
import { getGameForUser } from './socket.js';
import { createAdminUser, setUserRole } from './repositories/users.js';
import type { Cell, User } from '../shared/types.js';

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
  it('adds players and dungeon masters permanently to the player list', async () => {
    const dm = setUserRole(
      (await createAdminUser('dm-user', 'DM User', 'password')).id,
      'dungeon_master'
    )!;
    const player = setUserRole(
      (await createAdminUser('pl-user', 'PL User', 'password')).id,
      'player'
    )!;
    await createAdminUser('guest-user', 'Guest User', 'password');

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

describe('dm task pool', () => {
  function fakeUser(overrides: Partial<User>): User {
    return {
      id: 'u1',
      username: 'u1',
      displayName: 'U1',
      passwordHash: null,
      discordId: null,
      avatarUrl: null,
      isAdmin: false,
      isApproved: true,
      role: 'player',
      disabledApps: [],
      activePerson: null,
      autoSessionToDiary: false,
      autoAcceptSessionDiary: false,
      themePrimary: null,
      uiLanguage: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: new Date().toISOString(),
      ...overrides,
    } as User;
  }

  it('keeps the dm pool separate from player boards and global confirmations', () => {
    finishAndResetGame();
    setGridSize(3);
    for (let i = 0; i < 9; i += 1) {
      addTask(`Pool task ${i}`);
    }
    // Private flags are meaningless in the dm pool and are cleared.
    addTask('DM private attempt', { audience: 'dm', isPrivate: true, assignedTo: ['x'] });

    startGame();

    const playerTaskIds = getGame()
      .tasks.filter((t) => (t.audience ?? 'players') !== 'dm')
      .map((t) => t.id);

    const { playerId } = joinPlayer('Pool Player', undefined, null, 'player');

    // Players cannot place dm tasks on their board.
    const badBoard = fullBoard(playerTaskIds);
    const dmCellTask = getGame().tasks.find((t) => t.audience === 'dm')!;
    badBoard[0][0] = { taskId: dmCellTask.id, confirmedBy: null };
    expect(() => updateBoard(playerId, badBoard)).toThrow('Ungültiges Board');

    updateBoard(playerId, fullBoard(playerTaskIds));
    lockBoard(playerId);

    // Global confirmations never touch dm-pool tasks.
    confirmTask(playerId, dmCellTask.id);
    expect(getGame().players.find((p) => p.id === playerId)!.board![0][0].confirmedBy).toBeNull();

    // The dm task list is hidden from regular players but visible to dms.
    const playerView = getGameForUser(fakeUser({ role: 'player' }));
    expect(playerView.tasks.some((t) => t.audience === 'dm')).toBe(false);
    const dmView = getGameForUser(fakeUser({ role: 'dungeon_master' }));
    expect(dmView.tasks.some((t) => t.audience === 'dm')).toBe(true);
    const adminView = getGameForUser(fakeUser({ isAdmin: true }));
    expect(adminView.tasks.some((t) => t.audience === 'dm')).toBe(true);
  });

  it('lets dungeon masters mark dm tasks on their own board only', () => {
    finishAndResetGame();
    setGridSize(3);
    for (let i = 0; i < 9; i += 1) {
      addTask(`Round task ${i}`);
    }
    for (let i = 0; i < 9; i += 1) {
      addTask(`DM moment ${i}`, { audience: 'dm' });
    }
    startGame();

    const { playerId: plId } = joinPlayer('Solo Player', undefined, null, 'player');
    updateBoard(
      plId,
      fullBoard(
        getGame()
          .tasks.filter((t) => t.audience !== 'dm')
          .map((t) => t.id)
      )
    );
    lockBoard(plId);

    const { playerId: dmId } = joinPlayer('Table DM', undefined, null, 'dungeon_master');
    const dmTaskIds = getGame()
      .tasks.filter((t) => t.audience === 'dm')
      .map((t) => t.id);
    updateBoard(dmId, fullBoard(dmTaskIds));
    lockBoard(dmId);
    expect(getGame().players.find((p) => p.id === dmId)!.status).toBe('playing');

    // Own confirmation marks only the own board.
    confirmOwnTask(dmId, dmTaskIds[0]);
    const dmPlayer = getGame().players.find((p) => p.id === dmId)!;
    const soloPlayer = getGame().players.find((p) => p.id === plId)!;
    expect(dmPlayer.board![0][0].confirmedBy).toBe('Table DM');
    expect(soloPlayer.board![0][0].confirmedBy).toBeNull();

    // Completing a line on the own board grants exactly one win.
    confirmOwnTask(dmId, dmTaskIds[1]);
    confirmOwnTask(dmId, dmTaskIds[2]);
    expect(dmPlayer.status).toBe('bingo');
    expect(dmPlayer.wins).toBe(1);
    expect(dmPlayer.winCounted).toBe(true);

    // Unconfirming reverts the status without taking the win away.
    unconfirmOwnTask(dmId, dmTaskIds[0]);
    expect(getGame().players.find((p) => p.id === dmId)!.status).toBe('playing');
    expect(getGame().players.find((p) => p.id === dmId)!.wins).toBe(1);

    unconfirmTask(dmTaskIds[0]);
    expect(getGame().players.find((p) => p.id === dmId)!.board![0][0].confirmedBy).toBeNull();
  });
});
