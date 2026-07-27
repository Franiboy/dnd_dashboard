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
  disabledApps: string[];
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
  disabledApps: string[];
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
  recordingEnabled?: boolean;
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

export type RecordingStatus = 'recording' | 'pending_transcription' | 'processing' | 'completed' | 'error';

export interface RecordingFile {
  id: number;
  sessionId: number;
  userId: string;
  displayName: string;
  pcmPath: string;
  wavPath: string | null;
  duration: number | null;
  transcriptPath: string | null;
}

export interface RecordingSession {
  id: number;
  name: string;
  status: RecordingStatus;
  guildId: string;
  channelId: string;
  createdBy: string;
  startedAt: string;
  stoppedAt: string | null;
  directory: string;
  transcript: string | null;
  error: string | null;
  hasWavFiles?: boolean;
  files?: RecordingFile[];
}

export interface RecordingChannel {
  id: string;
  name: string;
  participants: string[];
}

export interface DiaryEntry {
  id: number;
  userId: string;
  title: string;
  content: string;
  summary: string | null;
  rewrittenContent: string | null;
  rewrittenFilePath?: string | null;
  rewriteSessionId?: string | null;
  persons: string[];
  organizations: string[];
  locations: string[];
  createdAt: string;
  updatedAt: string;
}

export type EntityType = 'persons' | 'organizations' | 'locations';

export interface EntitiesResponse {
  persons: string[];
  organizations: string[];
  locations: string[];
}

export interface EntityDetail {
  type: EntityType;
  canonical: string;
  aliases: string[];
}

export interface EntityUpdatePayload {
  type: EntityType;
  oldName: string;
  newName: string;
  aliases: string[];
}

export interface EntityKnowledgeEntry {
  id: number;
  entityType: EntityType;
  entityName: string;
  title: string | null;
  content: string;
  source: string;
  status: 'active' | 'deleted';
  statusReason: string | null;
  createdAt: string;
  updatedAt: string;
}
