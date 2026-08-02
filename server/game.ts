import { randomBytes, randomUUID } from 'crypto';
import type { BingoGame, Cell, Player, Task } from '../shared/types.js';
import { loadGame, saveGame } from './repositories/games.js';
import { runMigrations } from './migrations.js';

function createId(): string {
  return randomUUID ? randomUUID() : randomBytes(16).toString('hex');
}

function defaultGame(): BingoGame {
  return {
    id: createId(),
    status: 'setup',
    tasks: [],
    players: [],
    gridSize: 5,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
}

runMigrations();

let game: BingoGame = loadGame() || defaultGame();

export function getGame(): BingoGame {
  return game;
}

function persist(): void {
  saveGame(game);
}

function createEmptyBoard(size: number): Cell[][] {
  const board: Cell[][] = [];
  for (let r = 0; r < size; r++) {
    board[r] = [];
    for (let c = 0; c < size; c++) {
      board[r][c] = { taskId: null, confirmedBy: null };
    }
  }
  return board;
}

function isValidBoard(board: Cell[][], size: number, userId?: string): boolean {
  if (!Array.isArray(board) || board.length !== size) return false;
  for (let r = 0; r < size; r++) {
    const row = board[r];
    if (!Array.isArray(row) || row.length !== size) return false;
    for (let c = 0; c < size; c++) {
      const cell = row[c];
      if (cell.taskId === null) continue;
      const task = game.tasks.find((t) => t.id === cell.taskId);
      if (!task) return false;
      if (task.isPrivate && (!userId || !task.assignedTo?.includes(userId))) return false;
    }
  }
  return true;
}

export function addTask(
  text: string,
  { isPrivate = false, assignedTo = [] }: { isPrivate?: boolean; assignedTo?: string[] } = {},
): Task {
  const task: Task = {
    id: createId(),
    text: text.trim(),
    createdAt: new Date().toISOString(),
    isPrivate,
    assignedTo,
  };
  game.tasks.push(task);
  persist();
  return task;
}

export function updateTask(
  taskId: string,
  updates: { text?: string; isPrivate?: boolean; assignedTo?: string[] },
): BingoGame {
  const task = game.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error('Aufgabe nicht gefunden.');
  if (game.status !== 'setup') throw new Error('Aufgaben können nur vor Spielstart bearbeitet werden.');

  if (updates.text !== undefined) {
    const text = updates.text.trim();
    if (!text) throw new Error('Text darf nicht leer sein.');
    task.text = text;
  }

  if (updates.isPrivate !== undefined) {
    task.isPrivate = updates.isPrivate;
  }

  if (task.isPrivate) {
    const assignedTo = updates.assignedTo ?? task.assignedTo ?? [];
    if (assignedTo.length === 0) throw new Error('Private Aufgaben müssen mindestens einer Person zugewiesen werden.');
    task.assignedTo = assignedTo;
  } else {
    task.assignedTo = [];
  }

  persist();
  return game;
}

export function removeTask(taskId: string): BingoGame {
  game.tasks = game.tasks.filter((t) => t.id !== taskId);
  game.players.forEach((p) => {
    if (!p.board) return;
    let changed = false;
    for (let r = 0; r < p.board.length; r++) {
      for (let c = 0; c < p.board[r].length; c++) {
        if (p.board[r][c].taskId === taskId) {
          p.board[r][c] = { ...p.board[r][c], taskId: null };
          p.locked = false;
          changed = true;
        }
      }
    }
    if (changed) p.locked = false;
  });
  persist();
  return game;
}

export function joinPlayer(name: string, userId?: string, avatarUrl?: string | null): { game: BingoGame; playerId: string } {
  const id = createId();
  const player: Player = {
    id,
    userId,
    avatarUrl,
    name: name.trim(),
    status: 'lobby',
    board: createEmptyBoard(game.gridSize),
    locked: false,
    online: true,
    joinedAt: new Date().toISOString(),
  };
  game.players.push(player);
  persist();
  return { game, playerId: id };
}

export function setPlayerOnline(playerId: string, online: boolean): BingoGame {
  const player = game.players.find((p) => p.id === playerId);
  if (player) player.online = online;
  persist();
  return game;
}

export function updatePlayerName(playerId: string, name: string): BingoGame {
  const player = game.players.find((p) => p.id === playerId);
  if (player) player.name = name.trim();
  persist();
  return game;
}

export function setGridSize(gridSize: number): BingoGame {
  if (game.status !== 'setup') {
    throw new Error('Feldgröße kann nur in der Setup-Phase geändert werden.');
  }
  if (gridSize < 3 || gridSize > 5) {
    throw new Error('Ungültige Feldgröße.');
  }
  game.gridSize = gridSize;
  game.players.forEach((p) => {
    p.board = createEmptyBoard(gridSize);
    p.locked = false;
  });
  persist();
  return game;
}

export function startGame(): BingoGame {
  if (game.status !== 'setup') {
    throw new Error('Spiel kann nur aus der Setup-Phase gestartet werden.');
  }
  const needed = game.gridSize * game.gridSize;
  if (game.tasks.length < needed) {
    throw new Error(`Mindestens ${needed} Aufgaben nötig.`);
  }
  const onlinePlayers = game.players.filter((p) => p.online);
  if (onlinePlayers.length === 0) {
    throw new Error('Mindestens ein Spieler muss beigetreten sein.');
  }
  const notLocked = onlinePlayers.find((p) => !p.locked);
  if (notLocked) {
    throw new Error('Alle Spieler müssen ihr Board einlocken.');
  }
  const invalidBoard = onlinePlayers.find(
    (p) =>
      !p.board ||
      !isValidBoard(p.board, game.gridSize, p.userId) ||
      p.board.some((row) => row.some((cell) => !cell.taskId))
  );
  if (invalidBoard) {
    throw new Error('Nicht alle Boards sind vollständig ausgefüllt.');
  }
  game.status = 'playing';
  game.players.forEach((p) => {
    p.status = 'playing';
  });
  persist();
  return game;
}

export function updateBoard(playerId: string, board: Cell[][]): BingoGame {
  const player = game.players.find((p) => p.id === playerId);
  if (!player) throw new Error('Spieler nicht gefunden.');
  if (game.status !== 'setup') throw new Error('Board kann nur vor Spielstart bearbeitet werden.');
  if (player.locked) throw new Error('Board ist gesperrt. Entsperre es, um Änderungen vorzunehmen.');
  if (!isValidBoard(board, game.gridSize, player.userId)) throw new Error('Ungültiges Board.');
  player.board = board;
  persist();
  return game;
}

export function lockBoard(playerId: string): BingoGame {
  const player = game.players.find((p) => p.id === playerId);
  if (!player) throw new Error('Spieler nicht gefunden.');
  if (game.status !== 'setup') throw new Error('Board kann nur vor Spielstart eingelockt werden.');
  if (!player.board || !isValidBoard(player.board, game.gridSize, player.userId)) {
    throw new Error('Board ist ungültig.');
  }
  if (player.board.some((row) => row.some((cell) => !cell.taskId))) {
    throw new Error('Board muss vollständig ausgefüllt sein, bevor es eingelockt wird.');
  }
  player.locked = true;
  persist();
  return game;
}

export function unlockBoard(playerId: string): BingoGame {
  const player = game.players.find((p) => p.id === playerId);
  if (!player) throw new Error('Spieler nicht gefunden.');
  if (game.status !== 'setup') throw new Error('Board kann nur vor Spielstart entsperrt werden.');
  player.locked = false;
  persist();
  return game;
}

export function confirmTask(sourcePlayerId: string, taskId: string, confirmedByName?: string): BingoGame {
  if (game.status !== 'playing') return game;
  const source = game.players.find((p) => p.id === sourcePlayerId);
  const confirmedBy = confirmedByName || source?.name || 'Unbekannt';

  let anyChanged = false;
  for (const player of game.players) {
    if (!player.board) continue;
    let playerChanged = false;
    for (let r = 0; r < player.board.length; r++) {
      for (let c = 0; c < player.board[r].length; c++) {
        const cell = player.board[r][c];
        if (cell.taskId === taskId && !cell.confirmedBy) {
          cell.confirmedBy = confirmedBy;
          playerChanged = true;
          anyChanged = true;
        }
      }
    }
    if (playerChanged && hasBingo(player.board)) {
      player.status = 'bingo';
    }
  }

  if (anyChanged) {
    persist();
  }

  return game;
}

export function confirmTaskFor(targetPlayerId: string, taskId: string, sourceName: string): BingoGame {
  const target = game.players.find((p) => p.id === targetPlayerId);
  if (!target) return game;
  return confirmTask(targetPlayerId, taskId, sourceName);
}

export function unconfirmTask(taskId: string): BingoGame {
  if (game.status !== 'playing') return game;
  let changed = false;
  for (const player of game.players) {
    if (!player.board) continue;
    for (let r = 0; r < player.board.length; r++) {
      for (let c = 0; c < player.board[r].length; c++) {
        const cell = player.board[r][c];
        if (cell.taskId === taskId && cell.confirmedBy) {
          cell.confirmedBy = null;
          changed = true;
        }
      }
    }
    if (hasBingo(player.board)) {
      if (player.status !== 'bingo') player.status = 'bingo';
    } else {
      if (player.status === 'bingo') player.status = 'playing';
    }
  }
  if (changed) persist();
  return game;
}

function hasBingo(board: Cell[][]): boolean {
  const size = board.length;
  for (let r = 0; r < size; r++) {
    if (board[r].every((cell) => cell.confirmedBy)) return true;
  }
  for (let c = 0; c < size; c++) {
    if (board.every((row) => row[c].confirmedBy)) return true;
  }
  if (board.every((row, i) => row[i].confirmedBy)) return true;
  if (board.every((row, i) => row[size - 1 - i].confirmedBy)) return true;
  return false;
}

export function finishAndResetGame(): BingoGame {
  game.finishedAt = new Date().toISOString();
  game.status = 'setup';
  game.players.forEach((p) => {
    p.status = 'lobby';
    p.board = createEmptyBoard(game.gridSize);
    p.locked = false;
  });
  persist();
  return game;
}
