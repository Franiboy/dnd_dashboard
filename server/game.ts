import { randomBytes, randomUUID } from 'crypto';
import type { BingoGame, Cell, HistoryEntry, Player, Task } from '../shared/types.js';
import { loadGame, saveGame } from './db.js';

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
    history: [],
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
}

let game: BingoGame = loadGame() || defaultGame();

export function getGame(): BingoGame {
  return game;
}

function persist(): void {
  saveGame(game);
}

function addHistory(type: HistoryEntry['type'], playerName: string, message: string, taskText?: string): void {
  game.history.unshift({
    id: createId(),
    type,
    playerName,
    message,
    taskText,
    timestamp: new Date().toISOString(),
  });
  persist();
}

export function addTask(text: string): BingoGame {
  game.tasks.push({ id: createId(), text: text.trim(), createdAt: new Date().toISOString() });
  persist();
  return game;
}

export function removeTask(taskId: string): BingoGame {
  game.tasks = game.tasks.filter((t) => t.id !== taskId);
  persist();
  return game;
}

export function joinPlayer(name: string): { game: BingoGame; playerId: string } {
  const id = createId();
  const player: Player = {
    id,
    name: name.trim(),
    status: 'lobby',
    board: null,
    joinedAt: new Date().toISOString(),
  };
  game.players.push(player);
  addHistory('join', player.name, `${player.name} ist dem Spiel beigetreten.`);
  return { game, playerId: id };
}

export function updatePlayerName(playerId: string, name: string): BingoGame {
  const player = game.players.find((p) => p.id === playerId);
  if (player) player.name = name.trim();
  persist();
  return game;
}

export function startGame(gridSize: number): BingoGame {
  if (game.tasks.length < gridSize * gridSize) {
    throw new Error(`Mindestens ${gridSize * gridSize} Aufgaben nötig.`);
  }
  game.gridSize = gridSize;
  game.status = 'playing';
  const shuffled = [...game.tasks].sort(() => Math.random() - 0.5);
  game.players.forEach((p) => {
    p.status = 'playing';
    p.board = createBoard(shuffled, gridSize);
  });
  addHistory('start', 'System', `Spiel gestartet mit ${gridSize}x${gridSize} Feld.`);
  persist();
  return game;
}

function createBoard(tasks: Task[], size: number): Cell[][] {
  const selected = tasks.slice(0, size * size);
  const board: Cell[][] = [];
  for (let r = 0; r < size; r++) {
    board[r] = [];
    for (let c = 0; c < size; c++) {
      board[r][c] = { taskId: selected[r * size + c].id, confirmedBy: null };
    }
  }
  return board;
}

export function updateBoard(playerId: string, board: Cell[][]): BingoGame {
  const player = game.players.find((p) => p.id === playerId);
  if (!player) return game;
  player.board = board;
  if (player.status === 'lobby') player.status = 'playing';
  persist();
  return game;
}

export function confirmTask(playerId: string, taskId: string, confirmedByName?: string): BingoGame {
  const player = game.players.find((p) => p.id === playerId);
  if (!player || !player.board) return game;

  const task = game.tasks.find((t) => t.id === taskId);
  const taskText = task?.text;

  let changed = false;
  for (let r = 0; r < player.board.length; r++) {
    for (let c = 0; c < player.board[r].length; c++) {
      const cell = player.board[r][c];
      if (cell.taskId === taskId && !cell.confirmedBy) {
        cell.confirmedBy = confirmedByName || player.name;
        changed = true;
      }
    }
  }

  if (changed) {
    addHistory('confirm', player.name, `${player.name} hat "${taskText || taskId}" erledigt.`, taskText);
    if (hasBingo(player.board)) {
      player.status = 'bingo';
      addHistory('bingo', player.name, `${player.name} hat BINGO!`);
    }
    persist();
  }

  return game;
}

export function confirmTaskFor(targetPlayerId: string, taskId: string, sourceName: string): BingoGame {
  const target = game.players.find((p) => p.id === targetPlayerId);
  if (!target) return game;
  return confirmTask(targetPlayerId, taskId, sourceName);
}

function hasBingo(board: Cell[][]): boolean {
  const size = board.length;
  // rows
  for (let r = 0; r < size; r++) {
    if (board[r].every((cell) => cell.confirmedBy)) return true;
  }
  // cols
  for (let c = 0; c < size; c++) {
    if (board.every((row) => row[c].confirmedBy)) return true;
  }
  // diagonals
  if (board.every((row, i) => row[i].confirmedBy)) return true;
  if (board.every((row, i) => row[size - 1 - i].confirmedBy)) return true;
  return false;
}

export function finishGame(): BingoGame {
  game.status = 'finished';
  game.finishedAt = new Date().toISOString();
  addHistory('finish', 'System', 'Spiel beendet.');
  persist();
  return game;
}

export function resetGame(): BingoGame {
  game = defaultGame();
  persist();
  return game;
}
