export interface Task {
  id: string;
  text: string;
  createdAt: string;
  isPrivate?: boolean;
  assignedTo?: string[];
}

export interface Cell {
  taskId: string | null;
  confirmedBy: string | null;
}

export interface Player {
  id: string;
  userId?: string;
  avatarUrl?: string | null;
  name: string;
  status: 'lobby' | 'playing' | 'bingo';
  board: Cell[][] | null;
  locked: boolean;
  online: boolean;
  joinedAt: string;
}

export interface BingoGame {
  id: string;
  status: 'setup' | 'playing' | 'finished';
  tasks: Task[];
  players: Player[];
  gridSize: number;
  createdAt: string;
  finishedAt: string | null;
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
  canAccessPreviews: boolean;
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
  canAccessPreviews: boolean;
  isInitialAdmin: boolean;
}

export type LogType = 'system' | 'prompt' | 'ai' | 'build' | 'diff' | 'error' | 'summary';

export interface LogEntry {
  type: LogType;
  text: string;
  timestamp: string;
}

export interface FeatureRequest {
  id: number;
  requestedBy: string;
  title: string;
  description: string;
  status: 'pending' | 'running' | 'preview_ready' | 'failed' | 'merged';
  branch: string | null;
  worktreePath: string | null;
  previewPort: number | null;
  previewUrl: string | null;
  previewPid: number | null;
  sessionTitle: string | null;
  sessionId: string | null;
  logs: LogEntry[];
  behind?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface VersionInfo {
  mainVersion: number;
  currentVersion: number;
  branch: string;
  ahead: number;
  behind: number;
  aiEnabled: boolean;
  previewFeatureRequestId?: number | null;
  mainServerUrl?: string | null;
}

export interface ClientToServerEvents {
  join: () => void;
  addTask: (payload: { text: string; isPrivate?: boolean; assignedTo?: string[] }) => void;
  removeTask: (taskId: string) => void;
  updateTask: (payload: { taskId: string; text?: string; isPrivate?: boolean; assignedTo?: string[] }) => void;
  setGridSize: (gridSize: number) => void;
  startGame: () => void;
  updateBoard: (board: Cell[][]) => void;
  lockBoard: () => void;
  unlockBoard: () => void;
  confirmTask: (taskId: string) => void;
  confirmTaskFor: (payload: { playerId: string; taskId: string }) => void;
  unconfirmTask: (taskId: string) => void;
  resetGame: () => void;
}
