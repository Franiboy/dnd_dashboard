export interface Task {
  id: string;
  text: string;
  createdAt: string;
}

export interface Cell {
  taskId: string | null;
  confirmedBy: string | null;
}

export interface Player {
  id: string;
  name: string;
  status: 'lobby' | 'playing' | 'bingo';
  board: Cell[][] | null;
  joinedAt: string;
}

export interface BingoGame {
  id: string;
  status: 'setup' | 'playing' | 'finished';
  tasks: Task[];
  players: Player[];
  gridSize: number;
  history: HistoryEntry[];
  createdAt: string;
  finishedAt: string | null;
}

export interface HistoryEntry {
  id: string;
  type: 'start' | 'confirm' | 'bingo' | 'finish' | 'join' | 'leave';
  playerName: string;
  taskText?: string;
  timestamp: string;
  message: string;
}

export interface ServerToClientEvents {
  state: (game: BingoGame) => void;
  error: (message: string) => void;
  bingo: (playerName: string) => void;
  joined: (playerId: string) => void;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string | null;
  discordId: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
  isApproved: boolean;
  failedLoginAttempts: number;
  lockedUntil: string | null;
  createdAt: string;
}

export interface SafeUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  isApproved: boolean;
}

export interface ClientToServerEvents {
  join: () => void;
  addTask: (text: string) => void;
  removeTask: (taskId: string) => void;
  startGame: (gridSize: number) => void;
  updateBoard: (board: Cell[][]) => void;
  confirmTask: (taskId: string) => void;
  confirmTaskFor: (payload: { playerId: string; taskId: string }) => void;
  finishGame: () => void;
  resetGame: () => void;
}
